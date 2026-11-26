/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { constants, readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { compileFunction } from "node:vm";

import { transformSync } from "esbuild";

const source = transformSync(readFileSync(new URL("native.ts", import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code;
const entry = index => ({ timestamp: "2026-11-26T12:00:00.000Z", userId: "42", username: "alice", action: "status_change", details: `Event ${index}`, metadata: { index } });

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "stalker-native-test-"));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(directory)).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
        assert.ok(path.basename(directory).startsWith("stalker-native-test-"));
        await fs.rm(directory, { recursive: true, force: true });
    });
    const f = { directory, opens: 0, closes: 0, readBytes: 0, writtenBytes: 0, fullReads: 0, shortWrites: false, failOpen: false };
    const dependencies = {
        "@main/utils/constants": { DATA_DIR: directory },
        electron: { shell: { async openPath() { return ""; } } },
        fs: { constants },
        "fs/promises": {
            ...fs,
            async readFile(...args) { f.fullReads++; return fs.readFile(...args); },
            async open(...args) {
                if (f.failOpen) throw new Error(`Private path: ${directory}`);
                const handle = await fs.open(...args);
                f.opens++;
                const read = handle.read.bind(handle);
                const write = handle.write.bind(handle);
                const close = handle.close.bind(handle);
                handle.read = async (...values) => {
                    const result = await read(...values);
                    f.readBytes += result.bytesRead;
                    return result;
                };
                handle.write = async (buffer, offset, length, position) => {
                    const result = await write(buffer, offset, f.shortWrites ? Math.min(length, 7) : length, position);
                    f.writtenBytes += result.bytesWritten;
                    return result;
                };
                handle.close = async () => { await close(); f.closes++; };
                return handle;
            }
        },
        path
    };
    const module = { exports: {} };
    compileFunction(source, ["module", "require", "Date"])(module, name => {
        assert.ok(Object.hasOwn(dependencies, name), name);
        return dependencies[name];
    }, class extends Date { constructor() { super("2026-11-26T12:00:00.000Z"); } });
    f.native = module.exports;
    f.file = path.join(directory, "Stalking", "@alice_42", "stalker-log-2026-11-26.json");
    f.append = value => f.native.appendStalkerLog({}, JSON.stringify(value), value.userId, value.username);
    return f;
}

test("Concurrent appends preserve every entry in order and close all file handles", async t => {
    const f = await fixture(t);
    const entries = Array.from({ length: 100 }, (_, index) => entry(index));
    const results = await Promise.all(entries.map(value => f.append(value)));
    assert.ok(results.every(result => result.success));
    assert.deepEqual(JSON.parse(await fs.readFile(f.file, "utf8")), entries);
    assert.equal(f.fullReads, 0);
    assert.equal(f.opens, f.closes);
    assert.ok(f.readBytes <= 128 * entries.length);
    assert.ok(f.writtenBytes < JSON.stringify(entries).length * 2);
});

test("Appending to a large legacy log reads only its edges and preserves its history", async t => {
    const f = await fixture(t);
    const existing = Array.from({ length: 2000 }, (_, index) => ({ ...entry(index), details: "Existing 日本語 😀 ".repeat(20) }));
    await fs.mkdir(path.dirname(f.file), { recursive: true });
    await fs.writeFile(f.file, JSON.stringify(existing, null, 2) + "\n\n");
    assert.equal((await f.append(entry(2000))).success, true);
    assert.deepEqual(JSON.parse(await fs.readFile(f.file, "utf8")), [...existing, entry(2000)]);
    assert.equal(f.fullReads, 0);
    assert.equal(f.readBytes, 128);
    assert.ok(f.writtenBytes < 512);
});

test("Empty JSON arrays and partial writes still produce valid logs", async t => {
    const f = await fixture(t);
    await fs.mkdir(path.dirname(f.file), { recursive: true });
    await fs.writeFile(f.file, "[\n  ]\n");
    f.shortWrites = true;
    assert.equal((await f.append(entry(0))).success, true);
    assert.deepEqual(JSON.parse(await fs.readFile(f.file, "utf8")), [entry(0)]);
    assert.equal(f.opens, f.closes);
});

test("Malformed logs remain unchanged and failed writes do not block later entries", async t => {
    const f = await fixture(t);
    await fs.mkdir(path.dirname(f.file), { recursive: true });
    await fs.writeFile(f.file, "Broken log data");
    assert.equal((await f.append(entry(0))).success, false);
    assert.equal(await fs.readFile(f.file, "utf8"), "Broken log data");
    await fs.writeFile(f.file, "[]");
    assert.equal((await f.append(entry(1))).success, true);
    assert.deepEqual(JSON.parse(await fs.readFile(f.file, "utf8")), [entry(1)]);
    assert.equal(f.opens, f.closes);
});

test("Invalid renderer arguments are rejected before opening any file and native errors are scrubbed", async t => {
    const f = await fixture(t);
    for (const [contents, userId, username] of [
        ["[]", "42", "alice"],
        [JSON.stringify(entry(0)), "../escape", "alice"],
        [JSON.stringify(entry(0)), "43", "alice"],
        [JSON.stringify(entry(0)), "42", "alice\0"],
        ["x".repeat(1024 * 1024 + 1), "42", "alice"]
    ]) assert.equal((await f.native.appendStalkerLog({}, contents, userId, username)).success, false);
    assert.equal(f.opens, 0);
    f.failOpen = true;
    const result = await f.append(entry(0));
    assert.equal(result.success, false);
    assert.equal(result.error.includes(f.directory), false);
});
