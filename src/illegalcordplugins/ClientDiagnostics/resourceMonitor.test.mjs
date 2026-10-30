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

const monitorCode = transformSync(readFileSync(new URL("resourceMonitor.ts", import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code;
const nativeCode = transformSync(readFileSync(new URL("native.ts", import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code;

function load(code, dependencies, globals) {
    const module = { exports: {} };
    compileFunction(code, ["module", "require", ...Object.keys(globals)])(module, name => {
        assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
        return dependencies[name];
    }, ...Object.values(globals));
    return module.exports;
}

async function fixture(overrides = {}, web = false) {
    const timers = new Map();
    let nextTimer = 0;
    const f = {
        now: 0, calls: false, sharing: false, ghost: false, reads: 0, restarts: 0, notifications: [],
        usage: { success: true, cpuPercent: 90, memoryMb: 1000 },
        options: {
            autoRestart: true, restartCpuPercent: 80, restartMemoryMb: 4096,
            restartAfterSeconds: 30, restartCooldownMinutes: 15, restartPauseDuringCalls: true, ...overrides
        },
        read: () => Promise.resolve(f.usage),
        timers,
        async advance(ms) {
            const end = f.now + ms;
            for (;;) {
                const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
                if (!next || next[1].at > end) break;
                f.now = Math.max(f.now, next[1].at);
                timers.delete(next[0]);
                await next[1].callback();
            }
            f.now = end;
        }
    };
    f.monitor = load(monitorCode, {
        "@api/Notifications": { showNotification: notification => f.notifications.push(notification) },
        "@illegalcordplugins/ghostClient/settings": { isGhostClientActive: () => f.ghost },
        "@utils/Logger": { Logger: class { info() { } warn() { } error() { } } },
        "@utils/native": { relaunch: () => f.restarts++ },
        "@webpack": { onceReady: Promise.resolve() },
        "@webpack/common": {
            RTCConnectionStore: { isConnected: () => f.calls },
            ApplicationStreamingStore: { getCurrentUserActiveStream: () => f.sharing ? {} : null }
        }
    }, {
        IS_WEB: web,
        VencordNative: { pluginHelpers: { ClientDiagnostics: { getResourceUsage: () => { f.reads++; return f.read(); } } } },
        performance: { now: () => f.now },
        Date: { now: () => 2_000_000_000_000 + f.now },
        window: {
            setTimeout(callback, delay) { timers.set(++nextTimer, { callback, at: f.now + delay }); return nextTimer; },
            clearTimeout(id) { timers.delete(id); }
        }
    });
    f.start = async () => {
        f.monitor.startResourceMonitor(() => f.options, timestamp => { f.options.lastResourceRestartAt = timestamp; });
        await Promise.resolve();
    };
    await f.start();
    return f;
}

test("Requires startup grace and sustained CPU usage, then restarts once after the warning", async () => {
    const f = await fixture();
    await f.advance(55_000);
    assert.equal(f.reads, 0);
    await f.advance(30_000);
    assert.equal(f.notifications.length, 0);
    await f.advance(5000);
    assert.equal(f.notifications.length, 1);
    assert.equal(f.options.lastResourceRestartAt, 2_000_000_090_000);
    await f.advance(9999);
    assert.equal(f.restarts, 0);
    await f.advance(60_001);
    assert.equal(f.restarts, 1);
    assert.equal(f.timers.size, 0);
});

test("Brief spikes and alternating CPU and RAM overload do not cause a restart", async () => {
    const f = await fixture();
    await f.advance(75_000);
    f.usage = { success: true, cpuPercent: 0, memoryMb: 1000 };
    await f.advance(5000);
    for (let index = 0; index < 12; index++) {
        f.usage = { success: true, cpuPercent: index % 2 ? 90 : 0, memoryMb: index % 2 ? 1000 : 5000 };
        await f.advance(5000);
    }
    assert.equal(f.notifications.length, 0);
    assert.equal(f.restarts, 0);
});

test("RAM can trigger independently with the CPU threshold disabled", async () => {
    const f = await fixture({ restartCpuPercent: 0 });
    await f.advance(100_000);
    assert.equal(f.notifications.length, 0);
    f.usage = { success: true, cpuPercent: 0, memoryMb: 5000 };
    await f.advance(35_000);
    assert.match(f.notifications[0].body, /RAM usage reached 5000 MiB/);
    await f.advance(10_000);
    assert.equal(f.restarts, 1);
});

test("A recovered resource cancels the restart during the warning period", async () => {
    const f = await fixture();
    await f.advance(90_000);
    f.usage = { success: true, cpuPercent: 10, memoryMb: 1000 };
    await f.advance(10_000);
    assert.equal(f.restarts, 0);
    assert.equal(f.timers.size, 1);
});

test("Cancelling a warning preserves cooldown across monitor restarts", async () => {
    const f = await fixture();
    await f.advance(90_000);
    f.notifications[0].onClick();
    await f.start();
    await f.advance(15 * 60_000 - 1);
    assert.equal(f.notifications.length, 1);
    assert.equal(f.restarts, 0);
    await f.advance(35_001);
    assert.equal(f.notifications.length, 2);
});

test("Cancelling while the final reading is in flight prevents the restart", async () => {
    const f = await fixture();
    await f.advance(90_000);
    let resolve;
    f.read = () => new Promise(done => { resolve = done; });
    const tick = f.advance(10_000);
    f.notifications[0].onClick();
    resolve(f.usage);
    await tick;
    assert.equal(f.restarts, 0);
    assert.equal(f.timers.size, 1);
});

test("Pauses during calls and checks again if screen sharing starts during the countdown", async () => {
    const f = await fixture();
    f.calls = true;
    await f.advance(120_000);
    assert.equal(f.reads, 0);
    f.calls = false;
    await f.advance(35_000);
    assert.equal(f.notifications.length, 1);
    f.sharing = true;
    await f.advance(10_000);
    assert.equal(f.restarts, 0);
});

test("Can restart during a call when the pause option is disabled", async () => {
    const f = await fixture({ restartPauseDuringCalls: false });
    f.calls = true;
    await f.advance(100_000);
    assert.equal(f.restarts, 1);
});

test("Missing readings and gaps in sampling reset the sustained usage window", async () => {
    const f = await fixture();
    await f.advance(80_000);
    f.usage = { success: false, error: "Unavailable" };
    await f.advance(5000);
    f.usage = { success: true, cpuPercent: 90, memoryMb: 1000 };
    await f.advance(15_000);
    f.now += 60_000;
    await f.advance(0);
    assert.equal(f.notifications.length, 0);
    await f.advance(30_000);
    assert.equal(f.notifications.length, 1);
});

test("Disabled thresholds, unavailable RAM and web builds cannot request a restart", async () => {
    for (const [options, web] of [[{ autoRestart: false }, false], [{ restartCpuPercent: 0, restartMemoryMb: 0 }, false], [{ restartCpuPercent: 0 }, false], [{}, true]]) {
        const f = await fixture(options, web);
        f.usage = { success: true, cpuPercent: 90, memoryMb: undefined };
        await f.advance(180_000);
        assert.equal(f.restarts, 0);
        assert.equal(f.notifications.length, 0);
    }
});

test("Stopping the plugin cancels countdowns and ignores outstanding IPC responses", async () => {
    const pending = await fixture();
    await pending.advance(90_000);
    pending.monitor.stopResourceMonitor();
    await pending.advance(30_000);
    assert.equal(pending.restarts, 0);
    assert.equal(pending.timers.size, 0);
    const f = await fixture();
    await f.advance(55_000);
    let resolve;
    f.read = () => new Promise(done => { resolve = done; });
    const tick = f.advance(5000);
    f.monitor.stopResourceMonitor();
    resolve(f.usage);
    await tick;
    assert.equal(f.notifications.length, 0);
    assert.equal(f.timers.size, 0);
});

test("GhostClient suppresses the warning without changing automatic restart preferences", async () => {
    const f = await fixture();
    f.ghost = true;
    await f.advance(100_000);
    assert.equal(f.notifications.length, 0);
    assert.equal(f.restarts, 1);
    assert.equal(f.options.autoRestart, true);
});

test("Native readings sum all app processes and convert RAM from KiB to MiB", () => {
    const native = load(nativeCode, {
        electron: { app: { getAppMetrics: () => [
            { cpu: { percentCPUUsage: 20 }, memory: { workingSetSize: 1_048_576 } },
            { cpu: { percentCPUUsage: 30 }, memory: { workingSetSize: 524_288 } }
        ] } }
    }, { process: { platform: "win32" } });
    assert.deepEqual(native.getResourceUsage({}), { success: true, cpuPercent: 50, memoryMb: 1536 });
});

test("Native readings handle unavailable Linux memory and return scrubbed errors", () => {
    const native = load(nativeCode, {
        electron: { app: { getAppMetrics: () => [{ cpu: { percentCPUUsage: 20 } }] } }
    }, { process: { platform: "linux" } });
    assert.deepEqual(native.getResourceUsage({}), { success: true, cpuPercent: 20, memoryMb: undefined });
    const failed = load(nativeCode, {
        electron: { app: { getAppMetrics() { throw new Error("Private native path"); } } }
    }, { process: { platform: "win32" } });
    assert.deepEqual(failed.getResourceUsage({}), { success: false, error: "Discord resource usage is unavailable." });
});
