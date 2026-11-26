/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, type IpcMainInvokeEvent } from "electron";

export type ImageAnimationPolicy = "animate" | "animateOnce" | "noAnimation";

export interface ProcessMemory {
    name: string;
    type: string;
    memoryMb: number;
}

export interface MemorySnapshot {
    totalMb: number;
    rendererMb: number;
    systemFreeMb: number;
    systemTotalMb: number;
    systemFreePercent: number;
    processes: ProcessMemory[];
}

export type OptimizationResult =
    | { status: "optimized"; snapshot: MemorySnapshot; beforeMb: number; aggressive: boolean; }
    | { status: "belowThreshold"; snapshot: MemorySnapshot; }
    | { status: "debuggerBusy"; snapshot: MemorySnapshot; }
    | { status: "audioActive"; snapshot: MemorySnapshot; }
    | { status: "error"; error: string; };

interface PreviousSettings {
    spellChecker: boolean;
}

const previousSettings = new Map<number, PreviousSettings>();

function toMb(kilobytes: number) {
    return Math.round(kilobytes / 1024);
}

function createMemorySnapshot(event: IpcMainInvokeEvent): MemorySnapshot {
    const rendererPid = event.sender.getOSProcessId();
    const metrics = app.getAppMetrics();
    const system = process.getSystemMemoryInfo();
    const processes = metrics.map(metric => ({
        name: metric.name ?? metric.serviceName ?? metric.type,
        type: metric.pid === rendererPid ? "Renderer" : metric.type,
        memoryMb: toMb(metric.memory.privateBytes ?? metric.memory.workingSetSize)
    })).sort((a, b) => b.memoryMb - a.memoryMb);

    return {
        totalMb: processes.reduce((total, process) => total + process.memoryMb, 0),
        rendererMb: processes.find(process => process.type === "Renderer")?.memoryMb ?? 0,
        systemFreeMb: toMb(system.free),
        systemTotalMb: toMb(system.total),
        systemFreePercent: Math.round(system.free / system.total * 1000) / 10,
        processes
    };
}

export function getMemorySnapshot(event: IpcMainInvokeEvent) {
    return createMemorySnapshot(event);
}

export function configure(
    event: IpcMainInvokeEvent,
    imageAnimationPolicy: ImageAnimationPolicy,
    disableSpellChecker: boolean
) {
    if (imageAnimationPolicy !== "animate" && imageAnimationPolicy !== "animateOnce" && imageAnimationPolicy !== "noAnimation") return false;
    if (typeof disableSpellChecker !== "boolean" || event.sender.isDestroyed()) return false;

    try {
        if (!previousSettings.has(event.sender.id)) {
            previousSettings.set(event.sender.id, {
                spellChecker: event.sender.session.isSpellCheckerEnabled()
            });
        }

        event.sender.setImageAnimationPolicy(imageAnimationPolicy);
        const previous = previousSettings.get(event.sender.id);
        if (previous) event.sender.session.setSpellCheckerEnabled(disableSpellChecker ? false : previous.spellChecker);
        return true;
    } catch {
        return false;
    }
}

export function restore(event: IpcMainInvokeEvent) {
    const previous = previousSettings.get(event.sender.id);
    if (!previous) return false;

    if (event.sender.isDestroyed()) {
        previousSettings.delete(event.sender.id);
        return false;
    }

    try {
        event.sender.setImageAnimationPolicy("animate");
        event.sender.session.setSpellCheckerEnabled(previous.spellChecker);
        previousSettings.delete(event.sender.id);
        return true;
    } catch {
        return false;
    }
}

export async function optimize(
    event: IpcMainInvokeEvent,
    minimumTotalMemoryMb: number,
    minimumSystemFreePercent: number,
    force: boolean,
    aggressive: boolean
): Promise<OptimizationResult> {
    if (!Number.isFinite(minimumTotalMemoryMb) || minimumTotalMemoryMb < 0 || minimumTotalMemoryMb > 65_536) {
        return { status: "error", error: "The Discord memory threshold is invalid." };
    }

    if (!Number.isFinite(minimumSystemFreePercent) || minimumSystemFreePercent < 0 || minimumSystemFreePercent > 100) {
        return { status: "error", error: "The system memory threshold is invalid." };
    }

    if (typeof force !== "boolean" || typeof aggressive !== "boolean" || event.sender.isDestroyed()) {
        return { status: "error", error: "The Discord renderer is not available." };
    }

    const snapshot = createMemorySnapshot(event);
    const systemMemoryLow = snapshot.systemFreePercent <= minimumSystemFreePercent;
    if (!force && (!systemMemoryLow || snapshot.totalMb < minimumTotalMemoryMb)) {
        return { status: "belowThreshold", snapshot };
    }

    if (event.sender.isCurrentlyAudible()) return { status: "audioActive", snapshot };

    const chromeDebugger = event.sender.debugger;
    if (event.sender.isDevToolsOpened() || chromeDebugger.isAttached()) {
        return { status: "debuggerBusy", snapshot };
    }

    let attachedByPlugin = false;

    try {
        chromeDebugger.attach();
        attachedByPlugin = true;
        await chromeDebugger.sendCommand("Memory.simulatePressureNotification", {
            level: force && aggressive ? "critical" : "moderate"
        });
        if (force && aggressive && !event.sender.isCurrentlyAudible()) await chromeDebugger.sendCommand("HeapProfiler.collectGarbage");
        return { status: "optimized", snapshot: createMemorySnapshot(event), beforeMb: snapshot.totalMb, aggressive: force && aggressive };
    } catch {
        return { status: "error", error: "Chromium could not release unused memory." };
    } finally {
        if (attachedByPlugin && chromeDebugger.isAttached()) chromeDebugger.detach();
    }
}
