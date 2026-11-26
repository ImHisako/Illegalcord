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

async function load(name, dependencies = {}, globals = {}, suffix = "") {
    const source = await readFile(new URL(`../../src/${name}`, import.meta.url), "utf8");
    const { code } = await transform(source + suffix, { loader: "ts", format: "cjs" });
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
const recordKey = id => `${key}:channel:${id}`;
const deleted = Symbol("deleted");
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
    const reads = [];
    let fullReads = 0;
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
                    if (value === deleted) data.delete(key);
                    else data.set(key, value);
                    errors.delete(key);
                });
                transaction.oncomplete?.({ target: transaction });
                resolveDone();
            }

            function request(action, request = new Request()) {
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

            const matches = range => [...data.keys()].filter(key => !range || range.includes(key)).sort();
            const objectStore = {
                transaction,
                getAllKeys: range => request(() => ({ value: matches(range) })),
                getAll: range => request(() => {
                    fullReads++;
                    const keys = matches(range);
                    const error = keys.map(key => errors.get(key)).find(Boolean);
                    return error ? { error } : { value: keys.map(key => structuredClone(data.get(key))) };
                }),
                delete(key) {
                    assert.equal(mode, "readwrite");
                    return request(() => {
                        for (const entry of typeof key === "string" ? [key] : matches(key)) changes.set(entry, deleted);
                        return { value: undefined };
                    });
                },
                openCursor(range) {
                    const keys = matches(range);
                    const cursorRequest = new Request();
                    const next = index => request(() => errors.has(keys[index]) ? { error: errors.get(keys[index]) } : { value: index < keys.length ? {
                        key: keys[index], value: structuredClone(data.get(keys[index])),
                        delete: () => objectStore.delete(keys[index]), continue: () => next(index + 1)
                    } : null }, cursorRequest);
                    return next(0);
                },
                get: key => request(() => {
                    reads.push(key);
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
            };
            const output = callback(objectStore);
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
        "@utils/Logger": { Logger: class { warn() {} error() {} } },
        "@utils/misc": { sleep: async duration => { retries.push(duration); state.onRetry?.(); } },
        "@webpack/common": { React: {}, UserStore: { getCurrentUser: () => ({ id: "owner" }) } }
    }, { IS_REPORTER: false, IDBRequest: Request, IDBKeyRange: { bound: (lower, upper) => ({ includes: key => key >= lower && key <= upper }) } }, "\nexport const retainedRecords = () => recordCache.size;");
    return { store, values, readErrors, notifications, writes, state, legacyValues, legacyReadErrors, legacyWrites, databaseNames, retries, reads,
        fullReads: () => fullReads,
        records: () => [...values].filter(([entry]) => entry.startsWith(key + ":")).map(([, value]) => value).sort((a, b) => b.timestamp - a.timestamp)
    };
}

test("Existing history is migrated to individual entries without modifying other accounts", async () => {
    const f = await fixture([record("old")]);
    await f.store.appendSentTrailRecord(record("new", 2));
    assert.equal(f.values.get(key), true);
    assert.deepEqual(await f.store.getSentTrailRecords("owner"), [record("new", 2), record("old")]);
    assert.deepEqual(f.values.get("unrelated-plugin"), { saved: true });
    assert.deepEqual(f.values.get("kamidere-send-trail:other"), [record("other")]);
});

test("Readable original history is migrated without writes to the original database", async () => {
    const f = await fixture([], { fresh: true, legacyRecords: [record("old")] });
    await f.store.appendSentTrailRecord(record("new", 2));
    assert.deepEqual(f.records(), [record("new", 2), record("old")]);
    assert.deepEqual(f.legacyValues.get(key), [record("old")]);
    assert.deepEqual(f.legacyWrites, []);
});

test("Unreadable original archives cannot block tracking and are left intact", async () => {
    for (const error of [lostFile(), new DOMException("", "UnknownError")]) {
        const f = await fixture([], { fresh: true, legacyRecords: [record("old")] });
        f.legacyReadErrors.set(key, error);
        await f.store.appendSentTrailRecord(record("new", 2));
        assert.deepEqual(f.records(), [record("new", 2)]);
        assert.deepEqual(f.legacyValues.get(key), [record("old")]);
        assert.equal(f.notifications.length, 1);
    }
});

test("An irrecoverable old array is repaired without touching unrelated history", async () => {
    const f = await fixture([record("lost")]);
    f.readErrors.set(key, lostFile());
    await f.store.appendSentTrailRecord(record("new", 2));
    assert.deepEqual(f.records(), [record("new", 2)]);
    assert.equal(f.notifications.length, 1);
    assert.deepEqual(f.values.get("unrelated-plugin"), { saved: true });
});

test("Concurrent migration and sends preserve and deduplicate every new message", async () => {
    const f = await fixture([record("old")]);
    await Promise.all(Array.from({ length: 20 }, (_, i) => f.store.appendSentTrailRecord(record(String(i), i + 2))));
    await f.store.appendSentTrailRecord(record("19", 21));
    assert.equal(f.records().length, 21);
    assert.equal(f.records()[0].messageId, "19");
    assert.equal(f.records().at(-1).messageId, "old");
});

test("Failed migrations are atomic and can be retried without losing the previous archive", async () => {
    const f = await fixture([record("old")]);
    f.state.writeError = new DOMException("Storage is full.", "QuotaExceededError");
    await assert.rejects(f.store.appendSentTrailRecord(record("new", 2)), error => error === f.state.writeError);
    assert.deepEqual(f.values.get(key), [record("old")]);
    assert.deepEqual(f.records(), []);
    f.state.writeError = null;
    await f.store.appendSentTrailRecord(record("new", 2));
    assert.deepEqual(f.records(), [record("new", 2), record("old")]);
});

test("Sending into a large archive reads and writes only the affected message", async () => {
    const f = await fixture(Array.from({ length: 2000 }, (_, i) => record(String(i), i)));
    await f.store.getSentTrailRecords("owner");
    f.reads.length = 0;
    f.writes.length = 0;
    const fullReads = f.fullReads();
    await f.store.appendSentTrailRecord(record("new", 3000));
    assert.deepEqual(f.reads, [recordKey("new")]);
    assert.deepEqual(f.writes, [recordKey("new")]);
    assert.equal(f.fullReads(), fullReads);
    assert.equal(f.records().length, 2001);
});

test("Media enrichment finds older entries directly and avoids duplicate media", async () => {
    const f = await fixture(Array.from({ length: 300 }, (_, i) => record(String(i), i)));
    await f.store.getSentTrailRecords("owner");
    const media = { source: "attachment", kind: "image", url: "image" };
    f.writes.length = 0;
    await f.store.mergeSentTrailRecordMedia("channel", "0", [media], { guildNameSnapshot: "Guild" });
    await f.store.mergeSentTrailRecordMedia("channel", "0", [media], { guildNameSnapshot: "Guild" });
    assert.deepEqual(f.values.get(recordKey("0")).media, [media]);
    assert.deepEqual(f.writes, [recordKey("0")]);
    assert.equal(await f.store.hasSentTrailRecord("owner", "channel", "0"), true);
});

test("Selective and complete deletion preserve other accounts and never restore legacy entries", async () => {
    const f = await fixture([record("one"), record("two", 2)]);
    await f.store.clearSentTrailRecordsWhere("owner", entry => entry.messageId === "one");
    assert.deepEqual(f.records(), [record("two", 2)]);
    await f.store.clearSentTrailRecords("owner");
    assert.deepEqual(await f.store.getSentTrailRecords("owner"), []);
    assert.equal(f.values.get(key), true);
    assert.deepEqual(f.values.get("kamidere-send-trail:other"), [record("other")]);
    await f.store.appendSentTrailRecord(record("three", 3));
    await f.store.removeSentTrailRecord("owner", "channel", "three");
    assert.deepEqual(f.records(), []);
});

test("A damaged individual entry is recovered from memory without rewriting the archive", async () => {
    const f = await fixture([record("one"), record("two", 2)]);
    await f.store.getSentTrailRecords("owner");
    f.readErrors.set(recordKey("one"), lostFile());
    f.writes.length = 0;
    assert.equal(await f.store.hasSentTrailRecord("owner", "channel", "one"), true);
    assert.deepEqual(f.writes, [recordKey("one")]);
    assert.equal(f.records().length, 2);
    assert.equal(f.notifications.length, 1);
});

test("Reading an archive with one irrecoverable entry preserves all readable entries", async () => {
    const f = await fixture([record("one"), record("two", 2)]);
    await f.store.getSentTrailRecords("owner");
    f.store.stopStore();
    f.readErrors.set(recordKey("one"), lostFile());
    assert.deepEqual(await f.store.getSentTrailRecords("owner"), [record("two", 2)]);
    assert.equal(f.notifications.length, 1);
});

test("Temporary database open failures create a fresh connection and retry once", async () => {
    const f = await fixture([record("old")]);
    f.state.openFailures = 1;
    await f.store.appendSentTrailRecord(record("new", 2));
    assert.deepEqual(f.records(), [record("new", 2), record("old")]);
    assert.deepEqual(f.retries, [250]);
    assert.deepEqual(f.databaseNames, ["SendTrailData", "SendTrailData"]);
});

test("Temporary read and write failures are retried without duplicate entries", async () => {
    for (const failure of ["readFailures", "writeFailures"]) {
        const f = await fixture([record("old")]);
        await f.store.getSentTrailRecords("owner");
        f.state[failure] = 1;
        await f.store.appendSentTrailRecord(record("new", 2));
        assert.deepEqual(f.records(), [record("new", 2), record("old")]);
        assert.deepEqual(f.retries, [250]);
    }
});

test("Persistent failures preserve existing records and retain the cause", async () => {
    const f = await fixture([record("old")]);
    await f.store.getSentTrailRecords("owner");
    const error = f.state.writeError = new DOMException("", "UnknownError");
    await assert.rejects(f.store.appendSentTrailRecord(record("new", 2)), cause => cause.cause === error);
    assert.deepEqual(f.records(), [record("old")]);
    assert.deepEqual(f.retries, [250]);
    assert.equal(f.notifications.length, 0);
});

test("Other read failures do not silently reset history", async () => {
    const f = await fixture([record("old")]);
    f.readErrors.set(key, new DOMException("Storage is unavailable.", "NotReadableError"));
    await assert.rejects(f.store.getSentTrailRecords("owner"));
    assert.deepEqual(f.values.get(key), [record("old")]);
    assert.deepEqual(f.writes, []);
});

test("SendTrail bounds its recovery cache and releases it on stop", async () => {
    const f = await fixture(Array.from({ length: 1000 }, (_, i) => record(String(i), i)));
    assert.equal((await f.store.getSentTrailRecords("owner")).length, 1000);
    assert.equal(f.store.retainedRecords(), 200);
    f.store.stopStore();
    assert.equal(f.store.retainedRecords(), 0);
    const loading = f.store.getSentTrailRecords("owner");
    f.store.stopStore();
    await loading;
    assert.equal(f.store.retainedRecords(), 0);
});

test("SendTrail retries read-modify-write with fresh data after a failed recovery write", async () => {
    const f = await fixture([record("old")]);
    await f.store.getSentTrailRecords("owner");
    f.readErrors.set(recordKey("old"), lostFile());
    f.state.writeFailures = 1;
    f.state.onRetry = () => {
        f.readErrors.delete(recordKey("old"));
        f.values.set(recordKey("old"), { ...record("old"), content: "external" });
    };
    await f.store.appendSentTrailRecord(record("old", 2));
    assert.equal(f.values.get(recordKey("old")).content, "external");
    assert.equal(f.notifications.length, 0);
});

test("SendTrail reports a recovery burst once instead of accumulating notifications", async () => {
    const f = await fixture(Array.from({ length: 20 }, (_, i) => record(String(i), i)));
    await f.store.getSentTrailRecords("owner");
    for (let i = 0; i < 20; i++) f.readErrors.set(recordKey(String(i)), lostFile());
    await f.store.getSentTrailRecords("owner");
    assert.equal(f.notifications.length, 1);
    assert.equal(f.records().length, 20);
});

test("Selective deletion repairs an irrecoverable entry before retrying the cursor", async () => {
    const f = await fixture([record("one"), record("two", 2)]);
    await f.store.getSentTrailRecords("owner");
    f.readErrors.set(recordKey("one"), lostFile());
    await f.store.clearSentTrailRecordsWhere("owner", entry => entry.messageId === "one");
    assert.deepEqual(f.records(), [record("two", 2)]);
    assert.equal(f.notifications.length, 1);
});
