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

const sources = Object.fromEntries(["index.ts", "native.ts"].map(file => [file,
    transformSync(readFileSync(new URL(file, import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code
]));

function load(file, dependencies, globals = {}) {
    const module = { exports: {} };
    compileFunction(sources[file], ["require", "module", "exports", ...Object.keys(globals)])(name => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
    }, module, module.exports, ...Object.values(globals));
    return module.exports;
}

function renderer(persisted = {}) {
    const f = { now: 2_000_000_000_000, hidden: true, rtc: "DISCONNECTED", incoming: false, streams: [], timers: new Map(), calls: [], replies: [] };
    let timerId = 0;
    const documentListeners = new Set();
    const store = methods => ({
        ...methods, listeners: new Set(),
        addChangeListener(callback) { this.listeners.add(callback); },
        removeChangeListener(callback) { assert.ok(this.listeners.delete(callback)); }
    });
    f.stores = {
        RTCConnectionStore: store({ getState: () => f.rtc }),
        IncomingCallStore: store({ hasIncomingCalls: () => f.incoming }),
        ApplicationStreamingStore: store({ getAllActiveStreams: () => f.streams })
    };
    const plain = { plugins: { RamOptimizer: { ...persisted } } };
    f.native = {
        configure: (...args) => f.calls.push(["configure", ...args]),
        restore: () => f.calls.push(["restore"]),
        optimize: async (...args) => {
            f.calls.push(["optimize", ...args]);
            return { status: "belowThreshold", snapshot: { processes: [] } };
        }
    };
    f.plugin = load("index.ts", {
        "@api/Commands": { ApplicationCommandInputType: {}, sendBotMessage: (channel, message) => f.replies.push(message.content) },
        "@api/Settings": {
            PlainSettings: plain, Settings: plain,
            migratePluginSetting(plugin, newKey, oldKey) {
                const settings = plain.plugins[plugin];
                if (Object.hasOwn(settings, oldKey) && !Object.hasOwn(settings, newKey)) {
                    settings[newKey] = settings[oldKey];
                    delete settings[oldKey];
                }
            },
            definePluginSettings(def) {
                const defaults = Object.fromEntries(Object.entries(def).map(([key, option]) => [key,
                    option.default ?? option.options?.find(choice => choice.default)?.value
                ]));
                const values = { ...defaults, ...plain.plugins.RamOptimizer };
                const settings = new Proxy(values, { set(target, key, value) {
                    target[key] = value;
                    def[key].onChange?.(value);
                    return true;
                } });
                return { store: settings, def };
            }
        },
        "@utils/constants": { EquicordDevs: {} },
        "@utils/Logger": { Logger: class { warn() {} error() {} } },
        "@utils/types": { __esModule: true, default: plugin => plugin, OptionType: {} },
        "@webpack/common": f.stores,
        "../ClientDiagnostics": { getMemoryRecommendations: () => [] }
    }, {
        VencordNative: { pluginHelpers: { RamOptimizer: f.native } },
        Date: { now: () => f.now },
        document: {
            get hidden() { return f.hidden; },
            addEventListener(type, callback) { assert.equal(type, "visibilitychange"); documentListeners.add(callback); },
            removeEventListener(type, callback) { assert.equal(type, "visibilitychange"); assert.ok(documentListeners.delete(callback)); }
        },
        window: {
            setTimeout(callback, delay) { f.timers.set(++timerId, { callback, at: f.now + delay }); return timerId; },
            clearTimeout(id) { f.timers.delete(id); }
        }
    }).default;
    f.emit = () => { for (const callback of f.stores.RTCConnectionStore.listeners) callback(); };
    f.advance = async ms => {
        f.now += ms;
        for (const [id, timer] of [...f.timers]) {
            if (timer.at > f.now) continue;
            f.timers.delete(id);
            await timer.callback();
        }
    };
    return f;
}

function native() {
    const f = { memoryMb: 900, freePercent: 50, audible: false, attached: false, commands: [], images: [], spellChecker: true, detachments: 0 };
    f.event = { sender: {
        id: 1, getOSProcessId: () => 1, isDestroyed: () => false, isCurrentlyAudible: () => f.audible, isDevToolsOpened: () => false,
        setImageAnimationPolicy: policy => f.images.push(policy),
        session: { isSpellCheckerEnabled: () => f.spellChecker, setSpellCheckerEnabled: value => f.spellChecker = value },
        debugger: {
            isAttached: () => f.attached,
            attach() { f.attached = true; },
            detach() { f.attached = false; f.detachments++; },
            async sendCommand(command, args) { f.commands.push([command, args]); await f.onCommand?.(command); }
        }
    } };
    f.api = load("native.ts", { electron: { app: {
        getAppMetrics: () => [{ pid: 1, type: "Tab", memory: { privateBytes: f.memoryMb * 1024 } }]
    } } }, { process: { getSystemMemoryInfo: () => ({ total: 1024 * 1000, free: 1024 * 10 * f.freePercent }) } });
    f.optimize = (force = false, aggressive = false) => f.api.optimize(f.event, 768, 15, force, aggressive);
    return f;
}

test("Automatic cleanup requires low system memory and Discord above its threshold", async () => {
    const f = native();
    assert.equal((await f.optimize()).status, "belowThreshold");
    f.freePercent = 10;
    f.memoryMb = 500;
    assert.equal((await f.optimize()).status, "belowThreshold");
    assert.equal(f.commands.length, 0);
    f.memoryMb = 900;
    const result = await f.optimize(false, true);
    assert.equal(result.status, "optimized");
    assert.equal(result.aggressive, false);
    assert.deepEqual(f.commands, [["Memory.simulatePressureNotification", { level: "moderate" }]]);
    assert.equal(f.attached, false);
});

test("Audio and attached debuggers prevent cleanup and explicit manual GC remains optional", async () => {
    const f = native();
    f.audible = true;
    assert.equal((await f.optimize(true, true)).status, "audioActive");
    f.audible = false;
    f.attached = true;
    assert.equal((await f.optimize(true, true)).status, "debuggerBusy");
    assert.equal(f.commands.length, 0);
    f.attached = false;
    assert.equal((await f.optimize(true, true)).status, "optimized");
    assert.deepEqual(f.commands.map(([command]) => command), ["Memory.simulatePressureNotification", "HeapProfiler.collectGarbage"]);
    assert.equal(f.commands[0][1].level, "critical");
    assert.equal(f.detachments, 1);
});

test("Notifications starting during cleanup prevent a later forced collection and failures detach the debugger", async () => {
    const f = native();
    f.onCommand = () => { f.audible = true; };
    await f.optimize(true, true);
    assert.equal(f.commands.length, 1);
    f.audible = false;
    f.onCommand = () => { throw new Error("Private native details"); };
    assert.deepEqual(await f.optimize(true), { status: "error", error: "Chromium could not release unused memory." });
    assert.equal(f.attached, false);
    assert.equal(f.detachments, 2);
});

test("Image policies do not change background throttling and spell checking is restored", () => {
    const f = native();
    assert.equal(f.api.configure(f.event, "noAnimation", true), true);
    assert.equal(f.spellChecker, false);
    assert.equal(f.api.configure(f.event, "invalid", false), false);
    assert.equal(f.api.restore(f.event), true);
    assert.equal(f.spellChecker, true);
    assert.deepEqual(f.images, ["noAnimation", "animate"]);
});

test("Existing animation preferences migrate without overwriting a selected policy", () => {
    assert.equal(renderer({ limitAnimatedImages: true }).plugin.settings.store.imageAnimationPolicy, "animateOnce");
    assert.equal(renderer({ limitAnimatedImages: false }).plugin.settings.store.imageAnimationPolicy, "animate");
    assert.equal(renderer({ limitAnimatedImages: true, imageAnimationPolicy: "noAnimation" }).plugin.settings.store.imageAnimationPolicy, "noAnimation");
    assert.equal(renderer().plugin.settings.store.imageAnimationPolicy, "animateOnce");
});

test("Incoming calls, connecting calls and streams cancel cleanup even with the legacy protection disabled", async () => {
    for (const [key, value] of [["rtc", "CONNECTING"], ["rtc", "RTC_CONNECTED"], ["incoming", true], ["streams", [{}]]]) {
        const f = renderer({ pauseDuringCalls: false, aggressiveCleanup: true });
        f.plugin.start();
        assert.equal(f.timers.size, 1);
        f[key] = value;
        f.emit();
        assert.equal(f.timers.size, 0);
        await f.advance(120_000);
        await f.plugin.commands[0].execute([], { channel: { id: "channel" } });
        assert.equal(f.calls.filter(([name]) => name === "optimize").length, 0);
        assert.match(f.replies[0], /call or stream/);
        f.plugin.stop();
        for (const store of Object.values(f.stores)) assert.equal(store.listeners.size, 0);
    }
});

test("Cleanup rechecks activity, waits after a call and never forces automatic GC", async () => {
    const f = renderer({ aggressiveCleanup: true });
    f.plugin.start();
    f.rtc = "CONNECTING";
    await f.advance(60_000);
    assert.equal(f.calls.filter(([name]) => name === "optimize").length, 0);
    assert.equal(f.timers.size, 0);
    f.rtc = "DISCONNECTED";
    f.emit();
    await f.advance(59_999);
    assert.equal(f.calls.filter(([name]) => name === "optimize").length, 0);
    await f.advance(1);
    assert.deepEqual(f.calls.find(([name]) => name === "optimize"), ["optimize", 768, 15, false, false]);
    f.hidden = false;
    f.emit();
    assert.equal(f.timers.size, 0);
    f.plugin.stop();
    assert.equal(f.calls.at(-1)[0], "restore");
});
