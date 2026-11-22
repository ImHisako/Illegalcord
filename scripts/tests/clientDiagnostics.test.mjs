/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileFunction } from "node:vm";

import { transformSync } from "esbuild";

const source = readFileSync(new URL("../../src/illegalcordplugins/ClientDiagnostics/index.tsx", import.meta.url), "utf8");
const { code } = transformSync(`${source}\nexport const testApi = { buildRows, buildImpactAnalysis, getRelevantSnippets, getLagNotificationCandidates, SnippetList };`, { loader: "tsx", format: "cjs" });

function fixture(options = {}) {
    let nextId = 0;
    const f = {
        time: 0, patchReads: 0, findReads: 0, disabledPatchReads: 0,
        conversions: new Map(), timers: new Map(), intervals: new Map(), frames: new Map(), errors: [],
        watch(fn, text) {
            fn.toString = () => {
                f.conversions.set(fn, (f.conversions.get(fn) ?? 0) + 1);
                f.time += 10;
                return text;
            };
            return fn;
        }
    };
    const window = {
        setTimeout(callback, delay, ...args) { const id = ++nextId; f.timers.set(id, () => callback(...args)); return id; },
        clearTimeout: id => f.timers.delete(id),
        setInterval(callback, delay, ...args) { const id = ++nextId; f.intervals.set(id, () => callback(...args)); return id; },
        clearInterval: id => f.intervals.delete(id),
        requestAnimationFrame(callback) { const id = ++nextId; f.frames.set(id, () => callback(f.time)); return id; },
        cancelAnimationFrame: id => f.frames.delete(id)
    };
    class Target extends EventTarget { }
    const callback = f.watch(() => { f.time += 3; }, "function callback() { work(); }");
    const start = f.watch(() => { f.time += 17; return "started"; }, "function start() { initialize(); }");
    const disabledStart = f.watch(() => {}, "function disabledStart() { initializeDisabled(); }");
    const replacement = f.watch(() => "patched", "function replace() { return 'patched'; }");
    const observed = {
        name: "Observed", start,
        get patches() {
            f.patchReads++;
            return [{
                get find() { f.findReads++; return "stable anchor"; },
                replacement: { match: /original/, replace: replacement }
            }];
        }
    };
    const disabled = {
        name: "Disabled", start: disabledStart,
        get patches() { f.disabledPatchReads++; return [{ find: "disabled anchor", replacement: { match: /original/, replace: "patched" } }]; }
    };
    const plugins = { Observed: observed, Disabled: disabled };
    const dependencies = {
        "./style.css": {},
        "@api/Notifications": { showNotification() {} },
        "@api/PluginManager": { plugins, isPluginEnabled: name => name !== "Disabled" },
        "@api/Settings": { definePluginSettings(def) {
            const values = Object.fromEntries(Object.entries(def).map(([key, option]) => [key, option.default ?? option.options?.find(choice => choice.default)?.value]));
            Object.assign(values, { lagNotifications: false, trackMemory: false }, options);
            const store = new Proxy(values, { set(target, key, value) {
                target[key] = value;
                def[key]?.onChange?.(value);
                return true;
            } });
            return { store, def, withPrivateSettings() { return this; } };
        } },
        "@components/BaseText": {}, "@components/Button": {}, "@components/CodeBlock": {},
        "@components/ErrorBoundary": { wrap: component => component },
        "@components/Flex": {}, "@components/FormSwitch": {}, "@components/Icons": {},
        "@illegalcordplugins/ghostClient/settings": { isGhostClientActive: () => false },
        "@plugins/_core/settings": { customEntries: [] },
        "@utils/constants": { EquicordDevs: {}, IS_LINUX: false },
        "@utils/css": { classNameFactory: () => (...classes) => classes.join(" ") },
        "@utils/discord": {},
        "@utils/Logger": { Logger: class { error(...args) { f.errors.push(args); } } },
        "@utils/misc": {
            isObject: value => value !== null && typeof value === "object" && !Array.isArray(value),
            removeFromArray: (array, predicate) => { const index = array.findIndex(predicate); if (index !== -1) array.splice(index, 1); }
        },
        "@utils/react": {},
        "@utils/types": { __esModule: true, default: plugin => plugin, OptionType: {}, StartAt: { Init: "Init" } },
        "@webpack/common": { React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) } },
        "./causes": { recordHealthCallback() {} },
        "./health": { startHealth() {}, stopHealth() {} },
        "./resourceMonitor": { startResourceMonitor() {}, stopResourceMonitor() {} }
    };
    const module = { exports: {} };
    compileFunction(code, ["require", "module", "exports", "window", "EventTarget", "performance", "Date", "IS_WEB"])(name => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
    }, module, module.exports, window, Target, { now: () => f.time }, { now: () => 2_000_000_000_000 + f.time }, false);
    const plugin = module.exports.default;
    return Object.assign(f, {
        plugin, api: module.exports.testApi, settings: plugin.settings.store, observed, disabled,
        window, target: new Target(), callback, originalStart: start, disabledStart, replacement,
        row: () => module.exports.testApi.buildRows(true, true, "impact").find(row => row.name === "Observed")
    });
}

test("startup and background analysis do not stringify callbacks or inspect patches", t => {
    const f = fixture();
    f.plugin.start();
    t.after(() => f.plugin.stop());
    assert.equal(f.observed.start(), "started");
    assert.equal(f.row().surfaces.start.totalMs, 17);
    assert.equal(f.row().calls, 1);
    assert.equal(f.api.buildImpactAnalysis(f.api.buildRows(true, true, "impact")).length, 1);
    f.api.getLagNotificationCandidates();
    assert.equal(f.patchReads, 0);
    assert.equal(f.disabledPatchReads, 0);
    assert.equal(f.conversions.size, 0);
    assert.equal(f.errors.length, 0);
});

test("opening related code resolves only that plugin and reuses formatted snippets", t => {
    const f = fixture();
    f.plugin.start();
    t.after(() => f.plugin.stop());
    f.observed.start();
    const [item] = f.api.buildImpactAnalysis(f.api.buildRows(false, false, "impact"));
    assert.equal(f.conversions.size, 0);
    f.api.SnippetList({ item });
    assert.equal(f.patchReads, 1);
    assert.equal(f.findReads, 1);
    assert.equal(f.conversions.get(f.originalStart), 1);
    assert.equal(f.conversions.get(f.replacement), 1);
    assert.equal(f.disabledPatchReads, 0);
    assert.equal(f.conversions.has(f.disabledStart), false);
    const snippets = f.api.getRelevantSnippets(f.row());
    assert.equal(snippets[0].label, "start callback");
    assert.equal(snippets[0].code, "function start() { initialize(); }");
    assert.match(snippets[1].code, /find: stable anchor\nmatch: \/original\/\nreplace: function replace/);
    f.api.SnippetList({ item });
    assert.equal(f.patchReads, 1);
    assert.equal(f.findReads, 1);
    assert.equal(f.conversions.get(f.originalStart), 1);
    assert.equal(f.conversions.get(f.replacement), 1);
});

test("deduplicates recurring callback references without losing resource counts or start code", t => {
    const f = fixture();
    f.observed.start = f.watch(() => {
        for (let i = 0; i < 80; i++) {
            f.window.setTimeout(f.callback, 100);
            f.window.setInterval(f.callback, 100);
            f.window.requestAnimationFrame(f.callback);
            f.target.addEventListener("click", f.callback);
        }
    }, "function start() { registerCallbacks(); }");
    const originalStart = f.observed.start;
    f.plugin.start();
    t.after(() => f.plugin.stop());
    f.observed.start();
    const row = f.row();
    assert.equal(row.pendingTimeouts, 80);
    assert.equal(row.intervals, 80);
    assert.equal(row.animationFrames, 80);
    assert.equal(row.listeners, 1);
    assert.equal(f.conversions.size, 0);
    const snippets = f.api.getRelevantSnippets({ ...row, hotSurface: "start" });
    assert.equal(snippets[0].code, "function start() { registerCallbacks(); }");
    assert.equal(snippets.filter(snippet => snippet.code === "function callback() { work(); }").length, 4);
    assert.equal(f.conversions.get(f.callback), 1);
    assert.equal(f.conversions.get(originalStart), 1);
    const [id, timeout] = f.timers.entries().next().value;
    f.timers.delete(id);
    timeout();
    assert.equal(f.row().pendingTimeouts, 79);
    assert.equal(f.row().surfaces.timeout.calls, 1);
    assert.equal(f.row().surfaces.timeout.totalMs, 3);
    f.target.removeEventListener("click", f.callback);
    assert.equal(f.row().listeners, 0);
});

test("formats only the visible patch snippets and keeps native callbacks out of related code", t => {
    const f = fixture();
    let reads = 0;
    const patches = Array.from({ length: 20 }, (_, index) => ({
        get find() { reads++; return `anchor ${index}`; },
        replacement: { match: /original/, replace: "patched" }
    }));
    Object.defineProperty(f.observed, "patches", { get: () => patches });
    f.observed.flux = { NATIVE: f.watch(() => {}, "function boundNative() { [native code] }") };
    Object.defineProperty(f.disabled, "patches", { get: () => [] });
    const native = f.watch(() => {}, "function native() { [native code] }");
    f.disabled.flux = { NATIVE: native };
    f.plugin.start();
    t.after(() => f.plugin.stop());
    assert.equal(reads, 0);
    const snippets = f.api.getRelevantSnippets({ name: "Observed", hotSurface: "No samples" });
    assert.equal(snippets.length, 6);
    assert.ok(snippets.every(snippet => snippet.surface === "patch"));
    assert.equal(reads, 6);
    f.api.getRelevantSnippets({ name: "Observed", hotSurface: "No samples" });
    assert.equal(reads, 6);
    assert.equal(f.conversions.size, 0);
    const disabledSnippets = f.api.getRelevantSnippets({ name: "Disabled", hotSurface: "flux NATIVE" });
    assert.equal(disabledSnippets.length, 1);
    assert.equal(disabledSnippets[0].code, "function disabledStart() { initializeDisabled(); }");
    assert.equal(f.conversions.get(native), 1);
});

test("retains code size limits and merges identical code only when displaying details", t => {
    const f = fixture();
    const text = `\n\nfunction listener() {\n\n\n\n${"x".repeat(7000)}\n}\n`;
    const first = f.watch(() => {}, text);
    const second = f.watch(() => {}, text);
    f.observed.start = f.watch(() => {
        f.target.addEventListener("click", first);
        f.target.addEventListener("click", second);
    }, "function start() { listen(); }");
    f.plugin.start();
    t.after(() => f.plugin.stop());
    f.observed.start();
    assert.equal(f.row().listeners, 2);
    assert.equal(f.conversions.size, 0);
    const snippets = f.api.getRelevantSnippets({ ...f.row(), hotSurface: "event listener click" });
    const listeners = snippets.filter(snippet => snippet.surface === "event listener click");
    assert.equal(listeners.length, 1);
    assert.equal(listeners[0].code.length, 6000);
    assert.ok(!listeners[0].code.includes("\n\n\n"));
    assert.equal(f.conversions.get(first), 1);
    assert.equal(f.conversions.get(second), 1);
});

test("collection can be enabled and paused without changing callback behavior", t => {
    const f = fixture({ profilingEnabled: false });
    f.plugin.start();
    t.after(() => f.plugin.stop());
    assert.equal(f.observed.start(), "started");
    assert.equal(f.row().calls, 0);
    assert.equal(f.conversions.size, 0);
    f.settings.profilingEnabled = true;
    f.observed.start();
    assert.equal(f.row().calls, 1);
    assert.equal(f.row().totalMs, 17);
    f.settings.profilingEnabled = false;
    assert.equal(f.observed.start(), "started");
    assert.equal(f.row().calls, 0);
    f.settings.profilingEnabled = true;
    f.observed.start();
    assert.equal(f.row().calls, 1);
    assert.equal(f.conversions.size, 0);
});

test("keeps errors and asynchronous timings observable without formatting code", async t => {
    const f = fixture();
    const failure = new Error("Callback failed.");
    f.observed.flux = {
        FAIL: f.watch(() => { f.time += 4; throw failure; }, "function fail() { throw failure; }"),
        ASYNC: f.watch(async () => { f.time += 2; return 42; }, "async function asyncCallback() { return 42; }")
    };
    f.plugin.start();
    t.after(() => f.plugin.stop());
    assert.throws(() => f.observed.flux.FAIL(), error => error === failure);
    assert.equal(await f.observed.flux.ASYNC(), 42);
    assert.equal(f.row().errors, 1);
    assert.equal(f.row().asyncCalls, 1);
    assert.equal(f.row().surfaces["flux FAIL"].totalMs, 4);
    assert.equal(f.row().surfaces["flux ASYNC"].totalMs, 2);
    assert.equal(f.conversions.size, 0);
    assert.equal(f.patchReads, 0);
});
