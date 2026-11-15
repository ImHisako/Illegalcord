/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, unlink, utimes, watch, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { compileFunction } from "node:vm";

import { transform } from "esbuild";

async function compile(name) {
    const source = await readFile(new URL(`../../src/illegalcordplugins/DiscordCleaner.desktop/${name}.ts`, import.meta.url), "utf8");
    const { code } = await transform(source, { loader: "ts", format: "cjs" });
    return code;
}

const [code, scheduleCode, watcherCode] = await Promise.all([compile("native"), compile("schedule"), compile("watchFiles")]);
const require = createRequire(import.meta.url);
const scheduleModule = { exports: {} };
compileFunction(scheduleCode, ["module", "exports"])(scheduleModule, scheduleModule.exports);

async function fixture(t, platform = "win32") {
    const temp = await realpath(tmpdir());
    const root = await mkdtemp(join(temp, "illegalcord-cleaner-test-"));
    const profile = platform === "linux" ? join(root, ".config", "discord") : join(root, "discord");
    await mkdir(profile, { recursive: true });
    const calls = [];
    const timers = new Map();
    const watches = [];
    const listeners = new Set();
    const plain = { plugins: {} };
    const app = Object.assign(new EventEmitter(), {
        whenReady: async () => {},
        getPath: name => name === "userData" ? profile : join(profile, "Crashpad"),
        getName: () => "Discord",
    });
    t.after(async () => {
        app.emit("will-quit");
        const target = await realpath(root);
        assert.equal(dirname(target), temp);
        assert.ok(basename(target).startsWith("illegalcord-cleaner-test-"));
        await rm(target, { recursive: true });
    });
    const session = {
        getStoragePath: () => profile,
        async clearCache() { calls.push("HTTP"); },
        async clearCodeCaches(options) { calls.push(options); },
        async clearStorageData(options) { calls.push(options); },
    };
    const dependencies = {
        "@illegalcordplugins/DiscordHardened/nativeSecurity": { isTrustedSender: event => event.trusted },
        "@main/settings": { RendererSettings: {
            plain,
            addGlobalChangeListener: callback => listeners.add(callback),
            removeGlobalChangeListener: callback => listeners.delete(callback),
        } },
        "./schedule": scheduleModule.exports,
        "lodash/throttle": require("lodash/throttle"),
        electron: { app, session: { defaultSession: session } },
        "fs/promises": {
            ...await import("node:fs/promises"),
            watch: (dir, options) => {
                watches.push({ dir, signal: options.signal });
                return watch(dir, options);
            },
            unlink: async file => {
                if (basename(file) === "locked.log") throw Object.assign(new Error("Locked"), { code: "EBUSY" });
                await unlink(file);
            },
        },
        path: await import("node:path"),
    };
    const module = { exports: {} };
    const watcherModule = { exports: {} };
    compileFunction(watcherCode, ["require", "module", "exports"])(name => dependencies[name], watcherModule, watcherModule.exports);
    dependencies["./watchFiles"] = watcherModule.exports;
    const setInterval = (callback, duration) => {
        const id = Symbol();
        timers.set(id, { callback, duration });
        return id;
    };
    compileFunction(code, ["require", "module", "exports", "process", "setInterval", "clearInterval"])(
        name => dependencies[name], module, module.exports, { platform }, setInterval, id => timers.delete(id),
    );
    const event = { trusted: true, sender: { session } };

    async function addFile(name, old = false) {
        const file = join(profile, name);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, "test");
        if (old) {
            const date = new Date(Date.now() - 48 * 60 * 60 * 1000);
            await utimes(file, date, date);
        }
    }

    function configure(options) {
        plain.plugins.DiscordCleaner = options;
        for (const listener of listeners) listener();
    }

    return { root, profile, calls, event, addFile, clean: module.exports.clean, app, configure, listeners, timers, watches };
}

test("Cleans explicit caches, logs and old temporary files while keeping profile data", async t => {
    const { profile, calls, event, addFile, clean } = await fixture(t);
    const old = ["leftover.tmp", "temp/export.temp", "Crashpad/reports/old.dmp"];
    const logs = ["logs/renderer_js.old.log", "logs/discord-last-webrtc_0"];
    const keep = ["fresh.tmp", "logs/locked.log", "Network/Cookies", "Local Storage/user.log", "Crashpad/settings.dat", "Crashpad/pending/old.dmp", "settings.json"];
    for (const file of old) await addFile(file, true);
    for (const file of [...logs, ...keep]) await addFile(file);

    assert.deepEqual(await clean(event, true, true, true), { success: true, files: { removed: 5, failed: 1 }, failedCaches: [] });
    assert.deepEqual(calls, ["HTTP", {}, { storages: ["shadercache", "cachestorage"] }]);
    for (const file of [...old, ...logs]) await assert.rejects(access(join(profile, file)), { code: "ENOENT" });
    for (const file of keep) await access(join(profile, file));
});

test("Rejects untrusted requests and skips directories redirected outside the client profile", async t => {
    const { root, profile, calls, event, clean } = await fixture(t);
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "important.log"), "test");
    await symlink(outside, join(profile, "logs"), "junction");

    assert.equal((await clean({ ...event, trusted: false }, true, true, true)).success, false);
    assert.equal((await clean(event, true, "C:\\", false)).success, false);
    assert.deepEqual(await clean(event, false, true, false), { success: true, files: { removed: 0, failed: 1 }, failedCaches: [] });
    assert.deepEqual(calls, []);
    await access(join(outside, "important.log"));
});

test("Runs scheduled categories in the default session and replaces or stops the timer when settings change", async t => {
    const { calls, addFile, profile, configure, timers, app, listeners } = await fixture(t, "linux");
    const options = { enabled: true, frequency: 15, cache: false, logs: false, temporary: true };
    await addFile("Crash Reports/older.dmp", true);
    await addFile("Crashpad/completed/older.dmp", true);
    await addFile("logs/keep.log");
    configure(options);
    const [[id, timer]] = timers;
    assert.equal(timer.duration, 15 * 60_000);
    configure({ ...options });
    assert.deepEqual([...timers.keys()], [id]);
    assert.deepEqual(await timer.callback(), { success: true, files: { removed: 2, failed: 0 }, failedCaches: [] });
    await access(join(profile, "logs", "keep.log"));
    assert.deepEqual(calls, []);

    configure({ ...options, frequency: 60, cache: true });
    assert.equal(timers.has(id), false);
    const [next] = timers.values();
    assert.equal(next.duration, 60 * 60_000);
    await next.callback();
    assert.equal(calls[0], "HTTP");
    configure({ ...options, frequency: 0 });
    assert.equal(timers.size, 0);
    configure(options);
    app.emit("will-quit");
    assert.equal(timers.size, 0);
    assert.equal(listeners.size, 0);
});

test("Immediate mode deletes new logs and temporary files and stops when disabled", async t => {
    const { addFile, profile, configure, timers, watches } = await fixture(t);
    await mkdir(join(profile, "logs"));
    configure({ enabled: true, frequency: -1, cache: false });
    const [timer] = timers.values();
    assert.equal(timer.duration, 60_000);
    await waitUntil(() => watches.some(({ dir }) => dir === join(profile, "logs")) && watches.filter(({ dir }) => dir === profile).length === 2);
    const log = join(profile, "logs", "new.log");
    const temporary = join(profile, "fresh.tmp");
    await addFile("logs/new.part");
    await rename(join(profile, "logs", "new.part"), log);
    await addFile("fresh.part");
    await rename(join(profile, "fresh.part"), temporary);
    await addFile("Crashpad/reports/fresh.dmp");
    await waitUntil(async () => !await exists(log) && !await exists(temporary));
    await assert.rejects(access(log), { code: "ENOENT" });
    await assert.rejects(access(temporary), { code: "ENOENT" });
    await timer.callback();
    await access(join(profile, "Crashpad", "reports", "fresh.dmp"));

    configure({ enabled: false, frequency: -1 });
    assert.ok(watches.every(({ signal }) => signal.aborted));
    assert.equal(timers.size, 0);
    await addFile("logs/kept.log");
    await access(join(profile, "logs", "kept.log"));
});

test("Immediate mode clears new cache files through Electron and ignores cache metadata", async t => {
    const { addFile, calls, profile, configure, watches } = await fixture(t);
    const dir = join(profile, "Cache", "Cache_Data");
    configure({ enabled: true, frequency: -1, logs: false, temporary: false });
    await waitUntil(() => watches.some(watched => watched.dir === profile));
    await mkdir(dir, { recursive: true });
    await waitUntil(() => watches.some(watched => watched.dir === join(profile, "Cache")));
    await addFile("Cache/Cache_Data/index");
    await delay(300);
    assert.deepEqual(calls, []);
    await addFile("Cache/Cache_Data/0123456789abcdef_0");
    await waitUntil(() => calls.length === 3);
    assert.deepEqual(calls, ["HTTP", {}, { storages: ["shadercache", "cachestorage"] }]);
});

async function waitUntil(ready) {
    for (let attempts = 0; attempts < 200; attempts++) {
        if (await ready()) return;
        await delay(10);
    }
    assert.fail("The file watcher did not react in time.");
}

function exists(file) {
    return access(file).then(() => true, () => false);
}
