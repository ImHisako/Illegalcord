/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { classNameFactory } from "@utils/css";
import { React } from "@webpack/common";

interface CallbackSpan {
    plugin: string;
    surface: string;
    start: number;
    end: number;
}

interface Cause {
    plugin: string;
    blocking: number;
    tasks: number;
    longest: number;
    surfaces: Record<string, number>;
}

export interface CauseSnapshot {
    plugins: Cause[];
    unattributed: number;
    overwritten: number;
}

const cl = classNameFactory("vc-client-diagnostics-");
const spans: CallbackSpan[] = [];
const causes = new Map<string, Cause>();
let cursor = 0;
let overwritten = 0;
let attributed = 0;
let since = 0;
let running = false;

export function resetCauses(enabled: boolean) {
    running = enabled;
    spans.length = 0;
    causes.clear();
    cursor = overwritten = attributed = 0;
    since = performance.now();
}

export function recordHealthCallback(plugin: string, surface: string, start: number, end: number) {
    if (!running || document.hidden || start < since || end - start < 1) return;
    if (spans.length === 2048) overwritten++;
    spans[cursor] = { plugin, surface, start, end };
    cursor = (cursor + 1) % 2048;
}

export function correlateTask(start: number, duration: number) {
    if (start < since) return;
    const matched = new Set<string>();
    for (const span of spans) {
        const overlap = Math.min(span.end, start + duration) - Math.max(span.start, start + 50);
        if (overlap <= 0) continue;
        const cause = causes.get(span.plugin) ?? { plugin: span.plugin, blocking: 0, tasks: 0, longest: 0, surfaces: {} };
        cause.blocking += overlap;
        cause.longest = Math.max(cause.longest, span.end - span.start);
        cause.surfaces[span.surface] = (cause.surfaces[span.surface] ?? 0) + overlap;
        if (!matched.has(span.plugin)) cause.tasks++;
        matched.add(span.plugin);
        causes.set(span.plugin, cause);
        attributed += overlap;
    }
}

export function takeCauses(blocking: number): CauseSnapshot {
    const snapshot = {
        plugins: [...causes.values()].sort((a, b) => b.blocking - a.blocking),
        unattributed: Math.max(0, blocking - attributed),
        overwritten
    };
    causes.clear();
    attributed = overwritten = 0;
    return snapshot;
}

interface CausesProps {
    snapshot: CauseSnapshot | undefined;
    blocking: number;
    supported: boolean;
}

export function ClientCauses({ snapshot, blocking, supported }: CausesProps) {
    return <div className={cl("guide-section")}>
        <BaseText tag="h3" size="lg" weight="semibold">What caused the blocking?</BaseText>
        <BaseText size="sm" color="text-muted">Matches measured plugin callbacks against the blocking portion of long tasks in the latest sample. Nested calls are counted only under their outermost plugin entry point, including any Discord or other plugin code it invokes.</BaseText>
        {!supported ? <BaseText size="sm">Long task attribution is unavailable in this client.</BaseText> : !snapshot ? <BaseText size="sm">Collecting the first sample.</BaseText> : <>
            <BaseText size="sm" weight="semibold">{snapshot.unattributed.toFixed(1)} ms unattributed out of {blocking.toFixed(1)} ms blocking.</BaseText>
            {snapshot.plugins.length ? <div className={cl("table")}>
                <table className={cl("health-history")}>
                    <thead><tr>{["Plugin entry point", "Blocking overlap", "Share", "Tasks", "Longest callback", "Main surface"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
                    <tbody>{snapshot.plugins.slice(0, 8).map(cause => <tr key={cause.plugin}>
                        <td>{cause.plugin}</td><td>{cause.blocking.toFixed(1)} ms</td>
                        <td>{blocking ? (cause.blocking / blocking * 100).toFixed(1) : "0"}%</td>
                        <td>{cause.tasks}</td><td>{cause.longest.toFixed(1)} ms</td>
                        <td>{Object.entries(cause.surfaces).sort((a, b) => b[1] - a[1])[0]?.[0]}</td>
                    </tr>)}</tbody>
                </table>
            </div> : <BaseText size="sm">{blocking > 0 ? "Blocking was observed outside the captured plugin callbacks." : "No blocking was observed in this sample."}</BaseText>}
            {snapshot.overwritten > 0 ? <BaseText size="sm">The bounded callback buffer replaced {snapshot.overwritten} older spans. Some callbacks may be missing from attribution.</BaseText> : null}
        </>}
        <BaseText size="sm" color="text-muted">A large overlap identifies a suspect, not a confirmed cause. Unattributed time can include Discord rendering, garbage collection, profiler overhead, callbacks shorter than 1 ms and uninstrumented code. Missing attribution does not clear a plugin.</BaseText>
        <BaseText size="sm" color="text-muted">To check a suspect, copy a report, disable that plugin in settings, restart if required, and repeat the same activity with the same window and profiler settings. Compare several samples. If attribution stays low despite severe blocking, capture a Performance recording in Discord DevTools and inspect the main thread call stacks. To check profiler overhead, compare DevTools recordings with ClientDiagnostics enabled and disabled.</BaseText>
    </div>;
}
