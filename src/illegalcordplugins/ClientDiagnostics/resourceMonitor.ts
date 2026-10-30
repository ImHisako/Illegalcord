/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { isGhostClientActive } from "@illegalcordplugins/ghostClient/settings";
import { Logger } from "@utils/Logger";
import { relaunch } from "@utils/native";
import type { PluginNative } from "@utils/types";
import { onceReady } from "@webpack";
import { ApplicationStreamingStore, RTCConnectionStore } from "@webpack/common";

interface ResourceRestartSettings {
    autoRestart: boolean;
    restartCpuPercent: number;
    restartMemoryMb: number;
    restartAfterSeconds: number;
    restartCooldownMinutes: number;
    restartPauseDuringCalls: boolean;
    lastResourceRestartAt?: number;
}

const logger = new Logger("ClientDiagnostics");
let stopMonitor: (() => void) | undefined;

export function stopResourceMonitor() {
    stopMonitor?.();
    stopMonitor = undefined;
}

export function startResourceMonitor(getSettings: () => ResourceRestartSettings, recordRestart: (timestamp: number) => void) {
    stopResourceMonitor();
    if (IS_WEB) return;

    const Native = VencordNative.pluginHelpers.ClientDiagnostics as PluginNative<typeof import("./native")>;
    const readyAt = performance.now() + 60_000;
    let stopped = false;
    let pending = false;
    let timer: number | undefined;
    let cpuSince: number | undefined;
    let memorySince: number | undefined;
    let lastSampleAt: number | undefined;

    function cancelRestart() {
        if (stopped || !pending) return;
        window.clearTimeout(timer);
        pending = false;
        cpuSince = memorySince = lastSampleAt = undefined;
        timer = window.setTimeout(checkUsage, 5000);
    }

    async function restart(cpuExceeded: boolean, memoryExceeded: boolean) {
        if (stopped) return;
        try {
            const usage = await Native.getResourceUsage();
            if (stopped || !pending) return;
            const options = getSettings();
            if (!options.autoRestart || options.restartPauseDuringCalls
                && (RTCConnectionStore.isConnected() || ApplicationStreamingStore.getCurrentUserActiveStream() !== null)
                || !usage.success || !(cpuExceeded && usage.cpuPercent >= options.restartCpuPercent
                    || memoryExceeded && (usage.memoryMb ?? 0) >= options.restartMemoryMb)) {
                cancelRestart();
                return;
            }
            stopped = true;
            relaunch();
        } catch (error) {
            logger.error("Could not restart Discord automatically.", error);
            cancelRestart();
        }
    }

    async function checkUsage() {
        const options = getSettings();
        try {
            if (!options.autoRestart || performance.now() < readyAt
                || Date.now() < (options.lastResourceRestartAt ?? 0) + options.restartCooldownMinutes * 60_000
                || options.restartPauseDuringCalls
                && (RTCConnectionStore.isConnected() || ApplicationStreamingStore.getCurrentUserActiveStream() !== null)
                || options.restartCpuPercent === 0 && options.restartMemoryMb === 0) {
                cpuSince = memorySince = lastSampleAt = undefined;
                return;
            }

            const usage = await Native.getResourceUsage();
            if (stopped) return;
            if (!usage.success) {
                cpuSince = memorySince = lastSampleAt = undefined;
                logger.warn(usage.error);
                return;
            }

            const now = performance.now();
            if (lastSampleAt !== undefined && now - lastSampleAt > 15_000) cpuSince = memorySince = undefined;
            lastSampleAt = now;
            const memoryMb = usage.memoryMb ?? 0;
            cpuSince = options.restartCpuPercent > 0 && usage.cpuPercent >= options.restartCpuPercent ? cpuSince ?? now : undefined;
            memorySince = options.restartMemoryMb > 0 && memoryMb >= options.restartMemoryMb ? memorySince ?? now : undefined;
            const cpuExceeded = cpuSince !== undefined && now - cpuSince >= options.restartAfterSeconds * 1000;
            const memoryExceeded = memorySince !== undefined && now - memorySince >= options.restartAfterSeconds * 1000;
            if (!cpuExceeded && !memoryExceeded) return;

            const reason = cpuExceeded ? `CPU usage reached ${usage.cpuPercent.toFixed(1)}%` : `RAM usage reached ${memoryMb.toFixed(0)} MiB`;
            recordRestart(Date.now());
            pending = true;
            timer = window.setTimeout(() => restart(cpuExceeded, memoryExceeded), 10_000);
            logger.info(`Automatic restart scheduled. ${reason}.`);
            if (!isGhostClientActive()) {
                void showNotification({
                    title: "Client Diagnostics",
                    body: `${reason}. Discord will restart in 10 seconds. Click to cancel.`,
                    onClick: cancelRestart
                });
            }
        } catch (error) {
            cpuSince = memorySince = lastSampleAt = undefined;
            logger.error("Could not check Discord resource usage.", error);
        } finally {
            if (!stopped && !pending) timer = window.setTimeout(checkUsage, 5000);
        }
    }

    stopMonitor = () => {
        stopped = true;
        window.clearTimeout(timer);
    };
    void onceReady.then(() => {
        if (!stopped) timer = window.setTimeout(checkUsage, 5000);
    });
}
