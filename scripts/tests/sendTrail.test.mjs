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

async function fixture(records = []) {
    const values = new Map([[key, structuredClone(records)], ["unrelated-plugin", { saved: true }], ["kamidere-send-trail:other", [record("other")]]]);
    const readErrors = new Map();
    const notifications = [];
    const writes = [];
    const state = { writeError: null };
    let tail = Promise.resolve();

    function useStore(mode, callback) {
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
                    values.set(key, value);
                    readErrors.delete(key);
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
                get: key => request(() => readErrors.has(key) ? { error: readErrors.get(key) } : { value: structuredClone(values.get(key)) }),
                put(value, key) {
                    assert.equal(mode, "readwrite");
                    writes.push(key);
                    const copy = structuredClone(value);
                    return request(() => {
                        if (state.writeError) return { error: state.writeError };
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
        "@api/DataStore": { ...DataStore, createStore: () => useStore },
        "@api/Notifications": { showNotification: async notification => { notifications.push(notification); } },
        "@utils/lazy": { makeLazy: factory => { let value; return () => value ??= factory(); } },
        "@webpack/common": { React: {}, UserStore: { getCurrentUser: () => ({ id: "owner" }) } }
    }, { IS_REPORTER: false, IDBRequest: Request });
    return { store, values, readErrors, notifications, writes, state };
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
        await assert.rejects(f.store.getSentTrailRecords("owner"), cause => cause === error);
        await assert.rejects(f.store.appendSentTrailRecord(record("new", 2)), cause => cause === error);
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
