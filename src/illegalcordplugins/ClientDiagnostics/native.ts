/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, type IpcMainInvokeEvent } from "electron";

export function getResourceUsage(_event: IpcMainInvokeEvent) {
    try {
        const metrics = app.getAppMetrics();
        return {
            success: true as const,
            cpuPercent: metrics.reduce((total, metric) => total + metric.cpu.percentCPUUsage, 0),
            memoryMb: process.platform === "linux" ? undefined : metrics.reduce((total, metric) => total + metric.memory.workingSetSize, 0) / 1024
        };
    } catch {
        return { success: false as const, error: "Discord resource usage is unavailable." };
    }
}
