/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";

import { createRequestLog, type RequestLogSettings } from "./requestLog";
import { installVoiceRequestLog } from "./voiceRequestLog";

const logger = new Logger("DiscordHardened");
let activeSettings: RequestLogSettings = { enabled: false };
let observer: PerformanceObserver | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let configureDesktop: ((webSockets: boolean, localResources: boolean) => Promise<unknown>) | undefined;
let desktopOperation = Promise.resolve();
let stopVoiceLogging: (() => void) | null = null;
let voiceStatus = "Disabled";
export const browserRequestLog = createRequestLog(() => activeSettings);

export function getVoiceLoggingStatus(): string {
    return voiceStatus;
}

export function refreshRequestLogging(): void {
    const enabled = activeSettings.enabled !== false && activeSettings.recordNetworkRequests !== false;
    stopVoiceLogging?.();
    stopVoiceLogging = null;
    voiceStatus = "Disabled";
    if (enabled && activeSettings.recordVoiceDiagnostics) {
        stopVoiceLogging = installVoiceRequestLog(browserRequestLog);
        voiceStatus = stopVoiceLogging ? "Listening" : "Unavailable";
    }
    const configure = configureDesktop;
    if (configure) {
        const webSockets = enabled && activeSettings.recordWebSocketMessages === true;
        const localResources = enabled && activeSettings.recordLocalResources === true;
        desktopOperation = desktopOperation.then(async () => {
            await configure(webSockets, localResources);
        }).catch(() => logger.warn("Could not configure advanced request capture."));
    }
}

export function startRequestLogging(settings: RequestLogSettings, desktop: boolean, configure?: typeof configureDesktop): void {
    activeSettings = settings;
    configureDesktop = configure;
    refreshRequestLogging();
    timer = setInterval(browserRequestLog.prune, 30_000);
    if (desktop || typeof PerformanceObserver === "undefined") return;
    const startedAt = performance.now();
    observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
            if (!(entry instanceof PerformanceResourceTiming) || entry.startTime < startedAt) continue;
            browserRequestLog.record({
                time: performance.timeOrigin + entry.startTime,
                url: entry.name,
                method: "Unknown",
                resourceType: entry.initiatorType || "other",
                source: /^(?:blob|data):/.test(entry.name) ? "Local" : "Browser",
                state: entry.responseStatus >= 400 ? "Failed" : "Completed",
                status: entry.responseStatus || undefined,
                duration: entry.duration,
            });
        }
    });
    observer.observe({ type: "resource", buffered: true });
}

export function stopRequestLogging(): Promise<void> {
    observer?.disconnect();
    observer = undefined;
    clearInterval(timer);
    timer = undefined;
    activeSettings = { enabled: false };
    refreshRequestLogging();
    configureDesktop = undefined;
    browserRequestLog.clear();
    return desktopOperation;
}
