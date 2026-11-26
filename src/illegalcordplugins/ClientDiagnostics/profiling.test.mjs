/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { compileFunction } from "node:vm";

import { transformSync } from "esbuild";

const source = transformSync(readFileSync(new URL("index.tsx", import.meta.url), "utf8"), { loader: "tsx", format: "cjs" }).code;

function fixture(lazyDefaults = false) {
    const f = {
        now: 2_000_000_000_000, cpuTime: 0, heap: 1000, heapReads: 0, weakRefs: 0, timers: new Map(), probes: [], notifications: [], errors: [],
        workload() {}, notificationError: false, ghost: false
    };
    let nextTimer = 0;
    class Target extends EventTarget {
        addEventListener(type, listener, options) {
            if (this instanceof AbortSignal && type === "abort") f.probes.push({ signal: new WeakRef(this), callback: new WeakRef(listener) });
            super.addEventListener(type, listener, options);
        }
    }
    f.target = new Target();
    const window = {
        setTimeout(callback, delay) { f.timers.set(++nextTimer, { callback, delay }); return nextTimer; },
        setInterval(callback, delay) { f.timers.set(++nextTimer, { callback, delay }); return nextTimer; },
        clearTimeout(id) { f.timers.delete(id); },
        clearInterval(id) { f.timers.delete(id); },
        requestAnimationFrame() { return ++nextTimer; }, cancelAnimationFrame() {}
    };
    f.window = window;
    f.sample = { name: "AuditPlugin", start() { return f.workload(); } };
    f.plugins = { AuditPlugin: f.sample };
    const dependencies = {
        "./style.css": {},
        "@api/Notifications": { async showNotification(data) {
            if (f.notificationError) throw new Error("Notification unavailable");
            f.notifications.push(data);
        } },
        "@api/PluginManager": { plugins: f.plugins, isPluginEnabled: () => true },
        "@api/Settings": { definePluginSettings(def) {
            const defaults = Object.fromEntries(Object.entries(def).map(([key, value]) => [key, value.default ?? value.options?.find(option => option.default)?.value]));
            const values = lazyDefaults ? {} : { ...defaults };
            return {
                store: new Proxy(values, { get(target, key) {
                    if (!Object.hasOwn(target, key)) target[key] = defaults[key];
                    return target[key];
                } }),
                def, withPrivateSettings() { return this; },
                get plain() { return values; }
            };
        } },
        "@components/ErrorBoundary": { __esModule: true, default: { wrap: component => component } },
        "@illegalcordplugins/ghostClient/settings": { isGhostClientActive: () => f.ghost },
        "@plugins/_core/settings": { __esModule: true, default: { customEntries: [] } },
        "@utils/constants": { EquicordDevs: { irritably: {} } },
        "@utils/css": { classNameFactory: () => () => "" },
        "@utils/Logger": { Logger: class { error(...args) { f.errors.push(args); } } },
        "@utils/misc": {
            isObject: value => typeof value === "object" && value !== null,
            removeFromArray(array, predicate) { const index = array.findIndex(predicate); if (index >= 0) array.splice(index, 1); }
        },
        "@utils/types": { __esModule: true, default: plugin => plugin, OptionType: {}, StartAt: {} },
        "@webpack/common": { React: {} },
        "./causes": { recordHealthCallback() {} },
        "./health": { resetHealth() {}, startHealth() {}, stopHealth() {} },
        "./resourceMonitor": { startResourceMonitor() {}, stopResourceMonitor() {} }
    };
    for (const name of ["@components/BaseText", "@components/Button", "@components/CodeBlock", "@components/Flex", "@components/FormSwitch", "@components/Icons", "@utils/discord", "@utils/react"]) dependencies[name] = {};
    dependencies["@utils/discord"] = { copyWithToast: text => { f.report = text; } };
    const module = { exports: {} };
    compileFunction(source + "\nmodule.exports.audit = { snippets: () => sourceSnippets.get('AuditPlugin') ?? [], rows: () => buildRows(true, true, 'impact'), reset: resetStats, report: copyReport };",
        ["module", "require", "window", "EventTarget", "IS_WEB", "Date", "performance", "WeakRef"])(module, name => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
    }, window, Target, true, { now: () => f.now }, {
        now: () => f.cpuTime,
        get memory() { f.heapReads++; return { usedJSHeapSize: f.heap }; }
    }, class extends WeakRef { constructor(value) { super(value); f.weakRefs++; } });
    f.plugin = module.exports.default;
    f.audit = module.exports.audit;
    f.setProfiling = enabled => {
        f.plugin.settings.store.profilingEnabled = enabled;
        f.plugin.settings.def.profilingEnabled.onChange();
    };
    f.tickLag = (elapsed = 11 * 60_000) => {
        f.now += elapsed;
        const interval = [...f.timers.values()].find(timer => timer.delay === 30_000);
        assert.ok(interval);
        interval.callback();
    };
    f.activeProbes = () => f.probes.filter(probe => {
        const signal = probe.signal.deref();
        const callback = probe.callback.deref();
        return signal && callback && getEventListeners(signal, "abort").includes(callback);
    }).length;
    f.plugin.start();
    assert.equal(f.errors.length, 0);
    return f;
}

test("Manual listener removal also removes every profiler abort callback", () => {
    const f = fixture();
    const controller = new AbortController();
    f.workload = () => {
        for (let index = 0; index < 100; index++) {
            const callback = () => index;
            f.target.addEventListener("audit", callback, { signal: controller.signal });
            f.target.removeEventListener("audit", callback);
        }
    };
    f.sample.start();
    assert.equal(getEventListeners(f.target, "audit").length, 0);
    assert.equal(f.activeProbes(), 0);
    assert.equal(f.audit.rows()[0].listeners, 0);
    f.plugin.stop();
});

test("Heap sampling reduces reads while preserving all callback timings and counts", () => {
    const f = fixture();
    f.workload = () => { f.cpuTime++; f.heap += 10; };
    for (let index = 0; index < 1000; index++) f.sample.start();
    const row = f.audit.rows()[0];
    assert.equal(row.calls, 1000);
    assert.equal(row.totalMs, 1000);
    assert.equal(row.maxMs, 1);
    assert.equal(row.memorySamples, 10);
    assert.equal(row.heapIncrease, 100);
    assert.equal(f.heapReads, 20);
    f.audit.reset();
    f.sample.start();
    assert.equal(f.audit.rows()[0].memorySamples, 1);
    f.plugin.stop();
});

test("Profiling uses default sampling and slow call thresholds before opening settings", () => {
    const f = fixture(true);
    f.workload = () => { f.cpuTime += 60; };
    f.sample.start();
    assert.equal(f.heapReads, 2);
    assert.equal(f.audit.rows()[0].slowCalls, 1);
    assert.equal(f.audit.rows()[0].memorySamples, 1);
    f.plugin.stop();
});

test("Reports include the default sampling interval and the number of heap samples", () => {
    const f = fixture(true);
    f.workload = () => { f.cpuTime++; };
    f.sample.start();
    f.audit.report();
    assert.match(f.report, /Memory sampling interval: 100 ms per plugin/);
    assert.match(f.report, /Heap samples/);
    f.plugin.stop();
});

test("Full heap collection remains available and disabling it preserves callback measurements", () => {
    const f = fixture();
    f.workload = () => { f.cpuTime++; };
    f.plugin.settings.store.memorySamplingMs = 1000;
    f.sample.start();
    f.plugin.settings.store.memorySamplingMs = 0;
    for (let index = 0; index < 100; index++) f.sample.start();
    assert.equal(f.heapReads, 202);
    assert.equal(f.audit.rows()[0].memorySamples, 101);
    f.plugin.settings.store.trackMemory = false;
    for (let index = 0; index < 100; index++) f.sample.start();
    assert.equal(f.heapReads, 202);
    assert.equal(f.audit.rows()[0].calls, 201);
    f.plugin.stop();
});

test("Callback return values, synchronous errors and asynchronous failures remain measured", async () => {
    const f = fixture();
    f.workload = () => { f.cpuTime += 60; return 42; };
    assert.equal(f.sample.start(), 42);
    const error = new Error("Callback failed");
    f.workload = () => { throw error; };
    assert.throws(() => f.sample.start(), error);
    const result = Promise.reject(error);
    f.workload = () => result;
    assert.equal(f.sample.start(), result);
    await assert.rejects(result, error);
    await setImmediate();
    const row = f.audit.rows()[0];
    assert.equal(row.calls, 3);
    assert.equal(row.slowCalls, 1);
    assert.equal(row.errors, 2);
    assert.equal(row.asyncCalls, 1);
    assert.equal(row.maxMs, 60);
    f.plugin.stop();
});

test("Repeated source registrations reuse their weak reference", () => {
    const f = fixture();
    const callback = () => {};
    const before = f.weakRefs;
    f.workload = () => {
        for (let index = 0; index < 100; index++) {
            f.target.addEventListener("audit", callback);
            f.target.removeEventListener("audit", callback);
        }
    };
    f.sample.start();
    assert.equal(f.weakRefs - before, 1);
    f.plugin.stop();
});

test("Scheduled callbacks keep their owner after another plugin runs and profiling resumes", () => {
    const f = fixture();
    let timerId;
    f.workload = () => { timerId = f.window.setInterval(() => {}, 25); };
    f.sample.start();
    f.plugins.Other = { name: "Other", start() {} };
    f.setProfiling(false);
    f.setProfiling(true);
    f.plugins.Other.start();
    f.timers.get(timerId).callback();
    const row = f.audit.rows().find(item => item.name === "AuditPlugin");
    assert.equal(row.surfaces.interval.calls, 1);
    f.window.clearInterval(timerId);
    f.plugin.stop();
});

test("Duplicate subscriptions add one probe and capture modes are cleaned independently", () => {
    const f = fixture();
    const controller = new AbortController();
    const callback = () => {};
    f.workload = () => {
        for (let index = 0; index < 10; index++) f.target.addEventListener("audit", callback, { signal: controller.signal });
        f.target.addEventListener("audit", callback, { signal: controller.signal, capture: true });
    };
    f.sample.start();
    assert.equal(f.activeProbes(), 2);
    f.target.removeEventListener("audit", callback);
    assert.equal(f.activeProbes(), 1);
    f.target.removeEventListener("audit", callback, { capture: true });
    assert.equal(f.activeProbes(), 0);
    f.plugin.stop();
});

for (const action of ["abort", "pause", "stop"]) {
    test(`${action} releases outstanding profiler abort callbacks`, () => {
        const f = fixture();
        const controller = new AbortController();
        f.workload = () => f.target.addEventListener("audit", () => {}, { signal: controller.signal });
        f.sample.start();
        assert.equal(f.activeProbes(), 1);
        if (action === "abort") controller.abort();
        else if (action === "pause") f.setProfiling(false);
        else f.plugin.stop();
        assert.equal(f.activeProbes(), 0);
        if (action === "abort") assert.equal(f.audit.rows()[0].listeners, 0);
        else assert.equal(getEventListeners(f.target, "audit").length, 1);
        f.plugin.stop();
    });
}

for (const withSignal of [false, true]) {
    test(withSignal ? "Removed profiler hooks can be collected while the original abort signal stays active" : "Discarded callbacks and captured data can be collected", { skip: !global.gc }, async () => {
        const f = fixture();
        const controller = new AbortController();
        const references = [];
        f.workload = () => {
            const payload = { content: "Captured data" };
            const callback = () => payload;
            if (!withSignal) references.push(new WeakRef(callback), new WeakRef(payload));
            f.target.addEventListener("audit", callback, withSignal ? { signal: controller.signal } : undefined);
            f.target.removeEventListener("audit", callback);
        };
        f.sample.start();
        if (withSignal) references.push(f.probes[0].callback, f.probes[0].signal);
        assert.ok(f.audit.snippets().some(snippet => snippet.code.includes("payload")));
        f.workload = () => {};
        for (let attempt = 0; attempt < 20; attempt++) {
            await setImmediate();
            global.gc();
            await setImmediate();
            if (references.every(reference => reference.deref() === undefined)) break;
        }
        assert.ok(references.every(reference => reference.deref() === undefined));
        assert.ok(f.audit.snippets().some(snippet => snippet.code.includes("payload")));
        assert.equal(controller.signal.aborted, false);
        f.plugin.stop();
    });
}

test("Stopping clears snippet metadata and resuming restores sources without nesting wrappers", () => {
    const f = fixture();
    const wrapped = f.sample.start;
    assert.ok(f.audit.snippets().some(snippet => snippet.surface === "start" && snippet.code));
    f.setProfiling(false);
    assert.equal(f.audit.snippets().length, 0);
    f.setProfiling(true);
    assert.equal(f.sample.start, wrapped);
    assert.ok(f.audit.snippets().some(snippet => snippet.surface === "start" && snippet.code));
    f.plugin.stop();
    assert.equal(f.audit.snippets().length, 0);
    assert.equal(f.timers.size, 0);
});

test("An open or queued lag warning blocks more warnings across cooldowns and profiling restarts", () => {
    const f = fixture();
    f.workload = () => { f.cpuTime += 1000; };
    f.sample.start();
    f.tickLag(30_000);
    assert.equal(f.notifications.length, 1);
    assert.notEqual(f.notifications[0].permanent, true);
    for (let index = 0; index < 20; index++) f.tickLag();
    assert.equal(f.notifications.length, 1);
    f.setProfiling(false);
    f.setProfiling(true);
    f.sample.start();
    f.tickLag();
    assert.equal(f.notifications.length, 1);
    f.plugin.stop();
    f.plugin.start();
    f.sample.start();
    f.tickLag();
    assert.equal(f.notifications.length, 1);
    f.notifications[0].onClose();
    f.tickLag();
    assert.equal(f.notifications.length, 2);
    f.plugin.stop();
});

test("A notification failure releases the pending warning so future warnings can be delivered", async () => {
    const f = fixture();
    f.workload = () => { f.cpuTime += 1000; };
    f.sample.start();
    f.notificationError = true;
    f.tickLag(30_000);
    await setImmediate();
    assert.equal(f.notifications.length, 0);
    assert.equal(f.errors.length, 1);
    f.notificationError = false;
    f.tickLag();
    assert.equal(f.notifications.length, 1);
    f.plugin.stop();
});
