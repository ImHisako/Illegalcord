/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileFunction } from "node:vm";

import { transformSync } from "esbuild";

const sources = Object.fromEntries(["health.tsx", "causes.tsx"].map(file => [file,
    transformSync(readFileSync(new URL(file, import.meta.url), "utf8"), { loader: "tsx", format: "cjs" }).code
]));

function fixture() {
    const f = { now: 0, heap: 128 * 1024 ** 2, frames: new Map(), timers: new Map(), frameCalls: 0, cleanups: [] };
    let nextId = 0;
    const document = Object.assign(new EventTarget(), { hidden: false });
    const window = {
        requestAnimationFrame(callback) {
            f.frames.set(++nextId, { at: (Math.floor(f.now / 16) + 1) * 16, callback });
            return nextId;
        },
        cancelAnimationFrame(id) { f.frames.delete(id); },
        setInterval(callback, delay) { f.timers.set(++nextId, { at: f.now + delay, callback, delay }); return nextId; },
        clearInterval(id) { f.timers.delete(id); }
    };
    const dependencies = {
        "@components/BaseText": {}, "@components/Button": {}, "@utils/discord": {},
        "@utils/css": { classNameFactory: () => () => "" },
        "@utils/react": { useFixedTimer() {} },
        "@webpack/common": { React: {
            createElement: (type, props) => ({ type, props }),
            useMemo: callback => callback(),
            useEffect: callback => f.cleanups.push(callback())
        } }
    };
    function load(file, inspect) {
        const module = { exports: {} };
        compileFunction(sources[file] + inspect, ["module", "require", "window", "document", "performance", "PerformanceObserver"])(module, name => {
            assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
            return dependencies[name];
        }, window, document, {
            now: () => f.now,
            get memory() { return { usedJSHeapSize: f.heap, jsHeapSizeLimit: 4 * 1024 ** 3 }; }
        }, class {
            static supportedEntryTypes = ["longtask"];
            constructor(callback) { this.callback = callback; this.records = []; f.observer = this; }
            observe() {}
            takeRecords() { return this.records.splice(0); }
            disconnect() { this.disconnected = true; }
        });
        return module.exports;
    }
    f.causes = dependencies["./causes"] = load("causes.tsx", "");
    f.health = load("health.tsx", "\nmodule.exports.audit = { samples, memoryTrend };");
    f.advance = elapsed => {
        const until = f.now + elapsed;
        for (;;) {
            const frame = [...f.frames].sort(([, a], [, b]) => a.at - b.at)[0];
            const timer = [...f.timers].sort(([, a], [, b]) => a.at - b.at)[0];
            const nextTime = Math.min(frame?.[1].at ?? Infinity, timer?.[1].at ?? Infinity);
            if (nextTime > until) break;
            f.now = nextTime;
            if (frame && frame[1].at === nextTime) {
                f.frames.delete(frame[0]);
                f.frameCalls++;
                frame[1].callback(f.now);
            } else {
                timer[1].at += timer[1].delay;
                timer[1].callback();
            }
        }
        f.now = until;
    };
    f.setHidden = hidden => { document.hidden = hidden; document.dispatchEvent(new Event("visibilitychange")); };
    f.document = document;
    f.health.startHealth();
    return f;
}

test("Closed health pages sample frames in short windows without counting the gaps as stalls", () => {
    const f = fixture();
    f.advance(10_000);
    assert.ok(f.frameCalls <= 140);
    assert.equal(f.health.audit.samples.length, 2);
    for (const sample of f.health.audit.samples) {
        assert.equal(sample.fps, 62.5);
        assert.equal(sample.worst, 16);
        assert.equal(sample.stalls, 0);
        assert.ok(sample.frameSampleMs >= 1000 && sample.frameSampleMs < 1100);
    }
    f.health.stopHealth();
});

test("Opening the health page resumes continuous frames and closing it restores sampling", () => {
    const f = fixture();
    f.advance(2000);
    assert.equal(f.frames.size, 0);
    const before = f.frameCalls;
    f.health.ClientHealthPage();
    f.advance(3000);
    assert.ok(f.frameCalls - before >= 180);
    assert.equal(f.health.audit.samples[0].worst, 16);
    assert.equal(f.health.audit.samples[0].stalls, 0);
    f.cleanups.forEach(cleanup => cleanup());
    const after = f.frameCalls;
    f.advance(10_000);
    assert.ok(f.frameCalls - after <= 140);
    f.health.stopHealth();
});

test("Long tasks and their plugin attribution remain active between frame sampling windows", () => {
    const f = fixture();
    f.advance(2100);
    assert.equal(f.frames.size, 0);
    f.causes.recordHealthCallback("AuditPlugin", "event", 2050, 2080);
    f.observer.records.push({ startTime: 2000, duration: 100 });
    f.advance(2900);
    const sample = f.health.audit.samples[0];
    assert.equal(sample.longTasks, 1);
    assert.equal(sample.blocking, 50);
    assert.equal(sample.causes.plugins[0].plugin, "AuditPlugin");
    assert.equal(sample.causes.plugins[0].blocking, 30);
    f.health.stopHealth();
});

test("Hidden windows and stopped health monitoring cannot keep frame callbacks alive", () => {
    const f = fixture();
    f.setHidden(true);
    const before = f.frameCalls;
    f.advance(20_000);
    assert.equal(f.frameCalls, before);
    assert.equal(f.health.audit.samples.length, 0);
    f.setHidden(false);
    f.advance(5000);
    assert.equal(f.health.audit.samples[0].worst, 16);
    f.health.stopHealth();
    assert.equal(f.frames.size, 0);
    assert.equal(f.timers.size, 0);
    assert.equal(f.observer.disconnected, true);
    assert.equal(getEventListeners(f.document, "visibilitychange").length, 0);
    f.advance(20_000);
    assert.equal(f.health.audit.samples.length, 0);
});

test("Resetting health restarts a stopped frame window without introducing false frame gaps", () => {
    const f = fixture();
    f.advance(2000);
    assert.equal(f.frames.size, 0);
    f.health.resetHealth();
    assert.equal(f.frames.size, 1);
    f.advance(3000);
    assert.equal(f.health.audit.samples[0].worst, 16);
    f.health.stopHealth();
});

test("Memory trend detection and the ten minute history limit remain available", () => {
    const f = fixture();
    for (let minute = 0; minute < 6; minute++) {
        f.heap += 10 * 1024 ** 2;
        f.advance(60_000);
    }
    assert.equal(f.health.audit.memoryTrend().suspected, true);
    f.advance(300_000);
    assert.equal(f.health.audit.samples.length, 120);
    f.health.stopHealth();
});

test("Long task attribution remains correct after the callback buffer wraps", () => {
    const f = fixture();
    const recorded = [];
    for (let index = 0; index < 2100; index++) {
        const start = index * 2;
        recorded.push({ start, end: start + 1 });
        f.causes.recordHealthCallback("AuditPlugin", "event", start, start + 1);
    }
    const expected = recorded.slice(-2048).reduce((sum, span) => sum + Math.max(0, Math.min(span.end, 4200) - Math.max(span.start, 4150)), 0);
    f.causes.correlateTask(4100, 100);
    const snapshot = f.causes.takeCauses(50);
    assert.equal(snapshot.plugins[0].blocking, expected);
    assert.equal(snapshot.overwritten, 52);
    f.causes.correlateTask(5000, 100);
    assert.equal(f.causes.takeCauses(50).plugins.length, 0);
    f.health.stopHealth();
});
