/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { compileFunction } from "node:vm";

import { transform } from "esbuild";

async function load(name, dependencies = {}, globals = {}) {
    const source = await readFile(new URL(`../../src/${name}`, import.meta.url), "utf8");
    const { code } = await transform(source, { loader: "ts", format: "cjs" });
    const module = { exports: {} };
    compileFunction(code, ["require", "module", "exports", ...Object.keys(globals)])(name => {
        assert.ok(Object.hasOwn(dependencies, name), name);
        return dependencies[name];
    }, module, module.exports, ...Object.values(globals));
    return module.exports;
}

const DataStore = await load("api/DataStore/index.ts");
const key = "kamidere-send-trail:owner";
const lostFile = () => new DOMException("Data lost due to missing file. Affected record should be considered irrecoverable", "NotReadableError");
const record = (messageId, timestamp = 1) => ({ channelId: "channel", messageId, timestamp, media: [] });

class Request {
    error = null;
    result = undefined;
}

async function fixture(records = [], options = {}) {
    const values = new Map([[key, structuredClone(records)], ["unrelated-plugin", { saved: true }], ["kamidere-send-trail:other", [record("other")]]]);
    if (options.fresh) values.delete(key);
    const legacyValues = new Map([[key, structuredClone(options.legacyRecords ?? [])], ["unrelated-plugin", { saved: true }]]);
    const readErrors = new Map();
    const legacyReadErrors = new Map();
    const notifications = [];
    const writes = [];
    const legacyWrites = [];
    const databaseNames = [];
    const retries = [];
    const state = { writeError: null, openFailures: 0, readFailures: 0, writeFailures: 0, onRetry: null };
    let tail = Promise.resolve();

    function useStore(mode, callback, legacy) {
        const data = legacy ? legacyValues : values;
        const errors = legacy ? legacyReadErrors : readErrors;
        const result = tail.then(() => {
            let resolveDone;
            let rejectDone;
            const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
            const transaction = { error: null };
            const changes = new Map();
            let pending = 0;
            let finished = false;

            function complete() {
                if (pending || finished) return;
                finished = true;
                changes.forEach((value, key) => {
                    data.set(key, value);
                    errors.delete(key);
                });
                transaction.oncomplete?.({ target: transaction });
                resolveDone();
            }

            function request(action) {
                const request = new Request();
                pending++;
                setImmediate(() => {
                    const result = action();
                    const event = {
                        target: request,
                        defaultPrevented: false,
                        cancelBubble: false,
                        preventDefault() { this.defaultPrevented = true; },
                        stopPropagation() { this.cancelBubble = true; }
                    };
                    if (result.error) {
                        request.error = result.error;
                        request.onerror?.call(request, event);
                        if (!event.cancelBubble) transaction.onerror?.(event);
                        if (!event.defaultPrevented) {
                            finished = true;
                            transaction.error = result.error;
                            transaction.onabort?.({ target: transaction });
                            rejectDone(result.error);
                        }
                    } else {
                        request.result = result.value;
                        request.onsuccess?.call(request, event);
                    }
                    pending--;
                    complete();
                });
                return request;
            }

            const output = callback({
                transaction,
                getAllKeys: () => request(() => ({ value: [...data.keys()] })),
                get: key => request(() => {
                    if (!legacy && state.readFailures > 0) {
                        state.readFailures--;
                        return { error: new DOMException("Temporary read failure.", "UnknownError") };
                    }
                    return errors.has(key) ? { error: errors.get(key) } : { value: structuredClone(data.get(key)) };
                }),
                put(value, key) {
                    assert.equal(mode, "readwrite");
                    (legacy ? legacyWrites : writes).push(key);
                    const copy = structuredClone(value);
                    return request(() => {
                        if (state.writeError) return { error: state.writeError };
                        if (!legacy && state.writeFailures > 0) {
                            state.writeFailures--;
                            return { error: new DOMException("Temporary write failure.", "UnknownError") };
                        }
                        changes.set(key, copy);
                        return { value: key };
                    });
                }
            });
            return Promise.all([output, done]).then(([value]) => value);
        });
        tail = result.then(() => undefined, () => undefined);
        return result;
    }

    const store = await load("illegalcordplugins/sendTrail/store.ts", {
        "@api/DataStore": {
            ...DataStore,
            createStore(databaseName) {
                databaseNames.push(databaseName);
                const legacy = databaseName === "VencordData";
                const failed = !legacy && state.openFailures > 0;
                if (failed) state.openFailures--;
                return (mode, callback) => failed
                    ? Promise.reject(new DOMException("Could not open the database.", "UnknownError"))
                    : useStore(mode, callback, legacy);
            }
        },
        "@api/Notifications": { showNotification: async notification => { notifications.push(notification); } },
        "@utils/lazy": { makeLazy: factory => { let value; return () => value ??= factory(); } },
        "@utils/Logger": { Logger: class { warn() {} } },
        "@utils/misc": { sleep: async duration => { retries.push(duration); state.onRetry?.(); } },
        "@webpack/common": { React: {}, UserStore: { getCurrentUser: () => ({ id: "owner" }) } }
    }, { IS_REPORTER: false, IDBRequest: Request });
    return { store, values, readErrors, notifications, writes, state, legacyValues, legacyReadErrors, legacyWrites, databaseNames, retries };
}

test("A new message repairs only the unreadable Send Trail history", async () => {
    const f = await fixture([record("lost")]);
    f.readErrors.set(key, lostFile());
    await f.store.appendSentTrailRecord(record("new", 2));
    assert.deepEqual(f.values.get(key), [record("new", 2)]);
    assert.deepEqual(f.values.get("unrelated-plugin"), { saved: true });
    assert.deepEqual(f.values.get("kamidere-send-trail:other"), [record("other")]);
    assert.equal(f.notifications.length, 1);
    await f.store.appendSentTrailRecord(record("next", 3));
    assert.deepEqual(f.values.get(key).map(record => record.messageId), ["next", "new"]);
    assert.equal(f.notifications.length, 1);
});

test("Recovery preserves the entries still in memory", async () => {
    const f = await fixture([record("old")]);
    await f.store.getSentTrailRecords("owner");
    f.readErrors.set(key, lostFile());
    await f.store.appendSentTrailRecord(record("new", 2));
    assert.deepEqual(f.values.get(key), [record("new", 2), record("old")]);
    assert.equal(f.store.hasSentTrailRecord("owner", "channel", "old"), true);
});

test("Opening history repairs an unreadable record even when no messages are sent", async () => {
    const f = await fixture([record("lost")]);
    f.readErrors.set(key, lostFile());
    assert.deepEqual(await f.store.getSentTrailRecords("owner"), []);
    assert.deepEqual(f.values.get(key), []);
    assert.equal(f.notifications.length, 1);
});

test("Concurrent recovery and sends preserve every new message", async () => {
    const f = await fixture();
    f.readErrors.set(key, lostFile());
    const [records] = await Promise.all([
        f.store.getSentTrailRecords("owner"),
        f.store.appendSentTrailRecord(record("first", 2)),
        f.store.appendSentTrailRecord(record("second", 3))
    ]);
    assert.deepEqual(records, [record("second", 3), record("first", 2)]);
    assert.deepEqual(f.values.get(key), records);
    assert.equal(f.notifications.length, 1);
});

test("A failed recovery write leaves the cache and saved data unchanged", async () => {
    const f = await fixture([record("old")]);
    await f.store.getSentTrailRecords("owner");
    f.readErrors.set(key, lostFile());
    f.state.writeError = new DOMException("Storage is full.", "QuotaExceededError");
    await assert.rejects(f.store.appendSentTrailRecord(record("new", 2)), error => error === f.state.writeError);
    assert.deepEqual(f.values.get(key), [record("old")]);
    assert.equal(f.store.hasSentTrailRecord("owner", "channel", "new"), false);
    assert.equal(f.store.hasSentTrailRecord("owner", "channel", "old"), true);
    assert.equal(f.readErrors.has(key), true);
    assert.equal(f.notifications.length, 0);
});

test("Other read failures never reset history", async () => {
    for (const error of [new DOMException("Temporary read failure.", "UnknownError"), new DOMException("Storage is unavailable.", "NotReadableError")]) {
        const f = await fixture([record("old")]);
        f.readErrors.set(key, error);
        await assert.rejects(f.store.getSentTrailRecords("owner"), cause => cause === error || cause.cause === error);
        await assert.rejects(f.store.appendSentTrailRecord(record("new", 2)), cause => cause === error || cause.cause === error);
        assert.deepEqual(f.values.get(key), [record("old")]);
        assert.deepEqual(f.writes, []);
        assert.equal(f.notifications.length, 0);
    }
});

test("Write errors do not trigger history recovery", async () => {
    const f = await fixture([record("old")]);
    f.state.writeError = lostFile();
    await assert.rejects(f.store.appendSentTrailRecord(record("new", 2)), error => error === f.state.writeError);
    assert.deepEqual(f.values.get(key), [record("old")]);
    assert.equal(f.notifications.length, 0);
});

test("Deleting an unknown message repairs the damaged value without adding history", async () => {
    const f = await fixture([record("lost")]);
    f.readErrors.set(key, lostFile());
    await f.store.removeSentTrailRecord("owner", "channel", "untracked");
    assert.deepEqual(f.values.get(key), []);
    assert.equal(f.notifications.length, 1);
});

test("Readable legacy history is copied without modifying the original archive", async () => {
    const f = await fixture([], { fresh: true, legacyRecords: [record("old")] });
    await f.store.appendSentTrailRecord(record("new", 2));
    assert.deepEqual(f.values.get(key), [record("new", 2), record("old")]);
    assert.deepEqual(f.legacyValues.get(key), [record("old")]);
    assert.deepEqual(f.legacyWrites, []);
    assert.deepEqual(f.databaseNames, ["SendTrailData", "VencordData"]);
    assert.equal(f.notifications.length, 0);
});

test("An unreadable original archive cannot block new sends or bulk deletions", async () => {
    for (const error of [lostFile(), new DOMException("", "UnknownError")]) {
        const f = await fixture([], { fresh: true, legacyRecords: [record("old")] });
        f.legacyReadErrors.set(key, error);
        await f.store.appendSentTrailRecord(record("new", 2));
        assert.deepEqual(f.values.get(key), [record("new", 2)]);
        await f.store.clearSentTrailRecordsWhere("owner", record => record.messageId === "new");
        assert.deepEqual(f.values.get(key), []);
        assert.deepEqual(f.legacyValues.get(key), [record("old")]);
        assert.deepEqual(f.legacyValues.get("unrelated-plugin"), { saved: true });
        assert.deepEqual(f.legacyWrites, []);
        assert.equal(f.notifications.length, 1);
    }
});

test("A failed migration can be attempted again without dropping legacy history", async () => {
    const f = await fixture([], { fresh: true, legacyRecords: [record("old")] });
    f.state.writeError = new DOMException("Storage is full.", "QuotaExceededError");
    await assert.rejects(f.store.appendSentTrailRecord(record("new", 2)), error => error === f.state.writeError);
    assert.equal(f.values.has(key), false);
    f.state.writeError = null;
    await f.store.appendSentTrailRecord(record("new", 2));
    assert.deepEqual(f.values.get(key), [record("new", 2), record("old")]);
    assert.deepEqual(f.legacyWrites, []);
});

test("A failed database open is retried with a fresh connection", async () => {
    const f = await fixture([record("old")]);
    f.state.openFailures = 1;
    await f.store.appendSentTrailRecord(record("new", 2));
    assert.deepEqual(f.values.get(key), [record("new", 2), record("old")]);
    assert.deepEqual(f.databaseNames, ["SendTrailData", "SendTrailData"]);
    assert.deepEqual(f.retries, [250]);
});

test("Temporary read and write failures are retried once without duplicate messages", async () => {
    for (const failure of ["readFailures", "writeFailures"]) {
        const f = await fixture([record("old")]);
        f.state[failure] = 1;
        await f.store.appendSentTrailRecord(record("new", 2));
        assert.deepEqual(f.values.get(key), [record("new", 2), record("old")]);
        assert.deepEqual(f.retries, [250]);
        assert.equal(f.notifications.length, 0);
    }
});

test("Persistent unknown errors stop after one retry and retain their original cause", async () => {
    const f = await fixture([record("old")]);
    const error = new DOMException("", "UnknownError");
    f.state.writeError = error;
    await assert.rejects(f.store.appendSentTrailRecord(record("new", 2)), cause => cause.cause === error && cause.message.includes("after retrying"));
    assert.deepEqual(f.retries, [250]);
    assert.deepEqual(f.values.get(key), [record("old")]);
    assert.equal(f.notifications.length, 0);
});

test("A retry uses fresh saved data instead of a previous recovery snapshot", async () => {
    const f = await fixture([record("old")]);
    await f.store.getSentTrailRecords("owner");
    f.readErrors.set(key, lostFile());
    f.state.writeFailures = 1;
    f.state.onRetry = () => {
        f.readErrors.delete(key);
        f.values.set(key, [record("external", 3)]);
    };
    await f.store.appendSentTrailRecord(record("new", 2));
    assert.deepEqual(f.values.get(key), [record("external", 3), record("new", 2)]);
    assert.equal(f.notifications.length, 0);
});
