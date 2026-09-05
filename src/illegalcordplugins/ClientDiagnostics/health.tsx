/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { useFixedTimer } from "@utils/react";
import { React } from "@webpack/common";

interface HealthSample {
    time: number;
    heap?: number;
    limit?: number;
    fps?: number;
    p95?: number;
    worst?: number;
    stalls: number;
    longTasks: number;
    blocking: number;
}

const cl = classNameFactory("vc-client-diagnostics-");
const requestFrame = window.requestAnimationFrame.bind(window);
const cancelFrame = window.cancelAnimationFrame.bind(window);
const schedule = window.setInterval.bind(window);
const unschedule = window.clearInterval.bind(window);
const samples: HealthSample[] = [];
const frameBuckets = new Uint32Array(1001);
let timer: number | undefined;
let frame: number | undefined;
let observer: PerformanceObserver | undefined;
let previousFrame = 0;
let frameCount = 0;
let frameTime = 0;
let worstFrame = 0;
let stalls = 0;
let longTasks = 0;
let blocking = 0;

function clearWindow() {
    previousFrame = 0;
    frameCount = frameTime = worstFrame = stalls = longTasks = blocking = 0;
    frameBuckets.fill(0);
}

export function resetHealth() {
    samples.length = 0;
    observer?.takeRecords();
    clearWindow();
}

function recordFrame(time: number) {
    if (previousFrame) {
        const duration = time - previousFrame;
        frameCount++;
        frameTime += duration;
        worstFrame = Math.max(worstFrame, duration);
        frameBuckets[Math.min(1000, Math.round(duration))]++;
        if (duration > 50) stalls++;
    }
    previousFrame = time;
    frame = requestFrame(recordFrame);
}

function visibilityChanged() {
    if (frame !== undefined) cancelFrame(frame);
    frame = undefined;
    observer?.takeRecords();
    clearWindow();
    if (!document.hidden) frame = requestFrame(recordFrame);
}

function sampleHealth() {
    if (document.hidden) return;
    const { memory } = performance as Performance & {
        memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number; };
    };
    let count = 0;
    let p95 = 0;
    for (; p95 < 1000; p95++) {
        count += frameBuckets[p95];
        if (count >= frameCount * 0.95) break;
    }
    samples.push({
        time: performance.now(),
        heap: memory?.usedJSHeapSize,
        limit: memory?.jsHeapSizeLimit,
        fps: frameTime ? frameCount * 1000 / frameTime : undefined,
        p95: frameCount ? p95 : undefined,
        worst: frameCount ? worstFrame : undefined,
        stalls, longTasks, blocking
    });
    while (samples.length > 120 || samples[0].time < performance.now() - 600_000) samples.shift();
    const lastFrame = previousFrame;
    clearWindow();
    previousFrame = lastFrame;
}

export function startHealth() {
    stopHealth();
    if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("longtask")) {
        observer = new PerformanceObserver(list => {
            if (document.hidden) return;
            for (const entry of list.getEntries()) {
                longTasks++;
                blocking += Math.max(0, entry.duration - 50);
            }
        });
        observer.observe({ entryTypes: ["longtask"] });
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    visibilityChanged();
    timer = schedule(sampleHealth, 5000);
}

export function stopHealth() {
    if (timer !== undefined) unschedule(timer);
    if (frame !== undefined) cancelFrame(frame);
    timer = frame = undefined;
    observer?.disconnect();
    observer = undefined;
    document.removeEventListener("visibilitychange", visibilityChanged);
    resetHealth();
}

function memoryTrend() {
    const buckets = new Map<number, { floor: number; count: number; }>();
    for (const sample of samples) {
        if (sample.heap === undefined) continue;
        const key = Math.floor(sample.time / 60_000);
        const bucket = buckets.get(key);
        buckets.set(key, { floor: Math.min(bucket?.floor ?? Infinity, sample.heap), count: (bucket?.count ?? 0) + 1 });
    }
    const complete = [...buckets].filter(([, bucket]) => bucket.count >= 10);
    const recent = complete.slice(-5);
    if (recent.length < 5 || recent[4][0] - recent[0][0] !== 4 || recent[4][0] < Math.floor(performance.now() / 60_000) - 1) return undefined;
    const growth = recent[4][1].floor - recent[0][1].floor;
    const rising = recent.slice(1).every(([, bucket], index) => bucket.floor > recent[index][1].floor);
    return { growth, perMinute: growth / 4, suspected: rising && growth > Math.max(16 * 1024 ** 2, recent[0][1].floor * 0.05) };
}

function mb(value: number | undefined) {
    return value === undefined ? "Unavailable" : `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

interface HealthMetricProps {
    label: string;
    value: string;
    detail: string;
}

function HealthMetric({ label, value, detail }: HealthMetricProps) {
    return <div className={cl("metric")}>
        <BaseText size="sm" color="text-muted">{label}</BaseText>
        <BaseText size="xl" weight="semibold" tabularNumbers>{value}</BaseText>
        <BaseText size="xs" color="text-muted">{detail}</BaseText>
    </div>;
}

export function ClientHealthPage() {
    useFixedTimer({ interval: 1000 });
    const latest = samples.at(-1);
    const trend = memoryTrend();
    const status = latest?.heap === undefined ? "Heap data unavailable" : !trend ? "Collecting baseline" : trend.suspected ? "Possible memory leak" : "No persistent growth signal";
    const ms = (value: number | undefined) => value === undefined ? "Collecting" : `${value.toFixed(1)} ms`;
    return <div className={cl("page")}>
        <div className={cl("toolbar")}>
            <div>
                <BaseText tag="h2" size="xl" weight="semibold">Client health</BaseText>
                <BaseText size="sm" color="text-muted">Memory trends and foreground responsiveness. Samples update every five seconds, with up to ten minutes of history.</BaseText>
            </div>
            <div className={cl("actions")}>
                <Button variant="secondary" onClick={() => copyWithToast(JSON.stringify({ status, trend, longTasksSupported: observer !== undefined, samples }, null, 2))}>Copy health report</Button>
                <Button variant="secondary" onClick={resetHealth}>Reset health</Button>
            </div>
        </div>
        <BaseText tag="h3" size="lg" weight="semibold">Memory and possible leaks</BaseText>
        <div className={cl("metrics")}>
            <HealthMetric label="JavaScript heap" value={mb(latest?.heap)} detail="Client renderer only, not total process RAM." />
            <HealthMetric label="Heap pressure" value={latest?.heap !== undefined && latest.limit ? `${(latest.heap / latest.limit * 100).toFixed(1)}%` : "Unavailable"} detail="Used heap relative to the JavaScript heap limit." />
            <HealthMetric label="Baseline growth" value={mb(trend?.growth)} detail="Difference between the first and last minute minima." />
            <HealthMetric label="Growth rate" value={trend ? `${mb(trend.perMinute)}/min` : "Collecting"} detail="Requires five consecutive minutes with enough samples." />
        </div>
        <div className={cl("guide-section")}>
            <BaseText size="md" weight="semibold">{status}</BaseText>
            <BaseText size="sm" color="text-muted">A possible leak is flagged when five consecutive minute minima rise by more than both 16 MiB and 5%. Caches and normal activity can also cause growth. This estimate cannot measure leaked bytes or identify retained objects. Confirm with heap snapshots and repeat the same actions with suspected plugins disabled.</BaseText>
            <BaseText size="sm" color="text-muted">Chromium heap readings can be coarse or shared with other contexts. A falling heap may reflect garbage collection, but does not prove that leaks are absent.</BaseText>
        </div>
        <BaseText tag="h3" size="lg" weight="semibold">Client smoothness</BaseText>
        <div className={cl("metrics")}>
            <HealthMetric label="Frame cadence" value={latest?.fps === undefined ? "Collecting" : `${latest.fps.toFixed(1)} FPS`} detail="Animation callback cadence, not GPU presentation FPS." />
            <HealthMetric label="Frame time P95" value={ms(latest?.p95)} detail="95% of frame intervals are below this value. Capped at 1000 ms." />
            <HealthMetric label="Worst frame" value={ms(latest?.worst)} detail="Longest frame interval in the latest sample." />
            <HealthMetric label="Stutters" value={String(latest?.stalls ?? 0)} detail="Frame intervals above 50 ms in the latest sample." />
            <HealthMetric label="Long tasks" value={observer ? String(latest?.longTasks ?? 0) : "Unavailable"} detail="Main thread tasks over 50 ms in the latest sample." />
            <HealthMetric label="Blocking time" value={observer ? ms(latest?.blocking) : "Unavailable"} detail="Sum of long task duration beyond 50 ms." />
        </div>
        <BaseText size="sm" color="text-muted">Hidden windows are excluded. Refresh rate, power saving, Discord itself and this profiler affect these numbers. These signals cannot attribute a freeze to a specific plugin.</BaseText>
        <div className={cl("table")}>
            <table className={cl("health-history")}>
                <caption>Recent samples</caption>
                <thead><tr>{["Age", "Heap", "FPS", "P95", "Stutters"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
                <tbody>{samples.slice(-12).reverse().map(sample => <tr key={sample.time}>
                    <td>{Math.round((performance.now() - sample.time) / 1000)} s</td>
                    <td>{mb(sample.heap)}</td><td>{sample.fps?.toFixed(1) ?? "Collecting"}</td><td>{ms(sample.p95)}</td><td>{sample.stalls}</td>
                </tr>)}</tbody>
            </table>
        </div>
    </div>;
}
