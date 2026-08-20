/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { definePluginSettings, migratePluginSetting } from "@api/Settings";
import { EquicordDevs } from "@utils/constants";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { ApplicationStreamingStore, RTCConnectionStore } from "@webpack/common";

import { getMemoryRecommendations } from "../ClientDiagnostics";
import type { ImageAnimationPolicy, MemorySnapshot, OptimizationResult } from "./native";

const Native = VencordNative.pluginHelpers.RamOptimizer as PluginNative<typeof import("./native")>;
const CLEANUP_COOLDOWN_MS = 5 * 60_000;

let cleanupTimer: number | undefined;
let lastCleanupAt = 0;
let started = false;

migratePluginSetting("RamOptimizer", "minimumTotalMemoryMb", "minimumMemoryMb");

function clearCleanupTimer() {
    if (cleanupTimer === undefined) return;

    window.clearTimeout(cleanupTimer);
    cleanupTimer = undefined;
}

function hasRealtimeActivity() {
    return settings.store.pauseDuringCalls && (
        RTCConnectionStore.isConnected() ||
        ApplicationStreamingStore.getCurrentUserActiveStream() !== null
    );
}

function scheduleCleanup(delayMs: number) {
    clearCleanupTimer();
    if (!started || !document.hidden) return;

    cleanupTimer = window.setTimeout(runAutomaticCleanup, delayMs);
}

function scheduleInitialCleanup() {
    const cooldownRemaining = Math.max(0, lastCleanupAt + CLEANUP_COOLDOWN_MS - Date.now());
    scheduleCleanup(Math.max(settings.store.backgroundDelaySeconds * 1000, cooldownRemaining));
}

function scheduleNextCleanup() {
    scheduleCleanup(settings.store.repeatCleanupMinutes * 60_000);
}

async function runAutomaticCleanup() {
    cleanupTimer = undefined;
    if (!started || !document.hidden) return;

    if (!hasRealtimeActivity()) {
        const result = await Native.optimize(
            settings.store.minimumTotalMemoryMb,
            settings.store.minimumSystemFreePercent,
            false,
            settings.store.aggressiveCleanup
        );
        if (result.status === "optimized") lastCleanupAt = Date.now();
    }

    if (started && document.hidden) scheduleNextCleanup();
}

function handleVisibilityChange() {
    if (document.hidden) scheduleInitialCleanup();
    else clearCleanupTimer();
}

function applySettings() {
    if (!started) return;

    const imagePolicy: ImageAnimationPolicy = settings.store.limitAnimatedImages ? "animateOnce" : "animate";
    void Native.configure(imagePolicy, settings.store.disableSpellChecker);
    handleVisibilityChange();
}

function formatSnapshot(snapshot: MemorySnapshot) {
    const processes = snapshot.processes
        .slice(0, 8)
        .map(process => `• ${process.name} (${process.type}): ${process.memoryMb} MB`)
        .join("\n");

    const recommendations = getMemoryRecommendations(3);
    const pluginSignals = recommendations.length === 0
        ? "**Plugin signals:** Client Diagnostics has not observed meaningful heap growth yet."
        : `**Plugin signals:**\n${recommendations.map(plugin =>
            `• ${plugin.name}: ${(plugin.heapGrowthBytes / 1024 / 1024).toFixed(1)} MB observed heap growth`
        ).join("\n")}`;

    return [
        `**Discord:** ${snapshot.totalMb} MB total, ${snapshot.rendererMb} MB renderer.`,
        `**System:** ${snapshot.systemFreeMb} MB free of ${snapshot.systemTotalMb} MB (${snapshot.systemFreePercent}%).`,
        `**Largest processes:**\n${processes}`,
        pluginSignals
    ].join("\n");
}

function formatResult(result: OptimizationResult) {
    switch (result.status) {
        case "optimized":
            return `${result.aggressive ? "Aggressive" : "Adaptive"} memory cleanup completed.\n${formatSnapshot(result.snapshot)}`;
        case "belowThreshold":
            return `No cleanup was needed.\n${formatSnapshot(result.snapshot)}`;
        case "debuggerBusy":
            return `Memory cleanup was skipped because DevTools or another debugger is active.\n${formatSnapshot(result.snapshot)}`;
        case "error":
            return result.error;
    }
}

const settings = definePluginSettings({
    backgroundDelaySeconds: {
        type: OptionType.SLIDER,
        description: "Wait before releasing unused memory while Discord is in the background.",
        markers: [15, 30, 60, 120, 300],
        default: 60,
        onChange: handleVisibilityChange
    },
    repeatCleanupMinutes: {
        type: OptionType.SLIDER,
        description: "Repeat adaptive cleanup while Discord remains in the background.",
        markers: [5, 15, 30, 60],
        default: 15,
        onChange: handleVisibilityChange
    },
    minimumTotalMemoryMb: {
        type: OptionType.SLIDER,
        description: "Run automatic cleanup when all Discord processes exceed this memory usage.",
        markers: [512, 768, 1024, 1536, 2048],
        default: 768
    },
    minimumSystemFreePercent: {
        type: OptionType.SLIDER,
        description: "Run cleanup when free system memory falls to this percentage.",
        markers: [5, 10, 15, 20, 25],
        default: 15
    },
    pauseDuringCalls: {
        type: OptionType.BOOLEAN,
        description: "Pause automatic cleanup during voice calls and screen sharing.",
        default: true,
        onChange: handleVisibilityChange
    },
    aggressiveCleanup: {
        type: OptionType.BOOLEAN,
        description: "Force V8 garbage collection during cleanup. This can briefly stutter Discord.",
        default: false
    },
    limitAnimatedImages: {
        type: OptionType.BOOLEAN,
        description: "Play newly loaded animated images once instead of looping them.",
        default: false,
        onChange: applySettings
    },
    disableSpellChecker: {
        type: OptionType.BOOLEAN,
        description: "Disable Electron's spell checker to save some memory.",
        default: false,
        onChange: applySettings
    }
});

export default definePlugin({
    name: "RamOptimizer",
    description: "Adaptively reduces memory used by Discord's Electron processes while in the background.",
    authors: [EquicordDevs.irritably],
    tags: ["Utility"],
    searchTerms: ["memory", "ram", "electron", "performance"],
    settings,

    commands: [
        {
            name: "optimize-ram",
            description: "Release unused Discord memory.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            async execute(_, ctx) {
                if (hasRealtimeActivity()) {
                    sendBotMessage(ctx.channel.id, { content: "Memory cleanup was skipped because a call or stream is active." });
                    return;
                }

                const result = await Native.optimize(
                    settings.store.minimumTotalMemoryMb,
                    settings.store.minimumSystemFreePercent,
                    true,
                    settings.store.aggressiveCleanup
                );
                if (result.status === "optimized") lastCleanupAt = Date.now();
                sendBotMessage(ctx.channel.id, { content: formatResult(result) });
            }
        },
        {
            name: "ram-status",
            description: "Show memory used by Discord's Electron processes.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            async execute(_, ctx) {
                sendBotMessage(ctx.channel.id, { content: formatSnapshot(await Native.getMemorySnapshot()) });
            }
        }
    ],

    start() {
        started = true;
        document.addEventListener("visibilitychange", handleVisibilityChange);
        applySettings();
    },

    stop() {
        started = false;
        clearCleanupTimer();
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        void Native.restore();
    }
});
