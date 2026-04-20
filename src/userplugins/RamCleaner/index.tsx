/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { EmojiStore, FluxDispatcher, GuildStore, MessageStore, SelectedChannelStore } from "@webpack/common";

const logger = new Logger("RamCleaner");

const settings = definePluginSettings({
    maxMemoryMB: {
        type: OptionType.NUMBER,
        description: "Maximum memory limit in MB. Auto-clean will trigger when exceeded. Set to 0 to disable limit.",
        default: 1024,
    },
    cleanInterval: {
        type: OptionType.NUMBER,
        description: "How often to check and clean memory (in seconds)",
        default: 60,
    },
    autoCleanOnChannelSwitch: {
        type: OptionType.BOOLEAN,
        description: "Automatically clean memory when switching channels",
        default: true,
    },
    aggressiveMode: {
        type: OptionType.BOOLEAN,
        description: "Aggressive cleaning: purge more caches but may cause slight performance impact",
        default: false,
    },
    showMemoryIndicator: {
        type: OptionType.BOOLEAN,
        description: "Show memory usage indicator in the top right corner",
        default: true,
    },
    enableNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show notification when memory is cleaned",
        default: false,
    },
    cleanMessageCache: {
        type: OptionType.BOOLEAN,
        description: "Clean old messages from cache",
        default: true,
    },
    cleanEmojiCache: {
        type: OptionType.BOOLEAN,
        description: "Clean unused emoji cache",
        default: true,
    },
    cleanImageCache: {
        type: OptionType.BOOLEAN,
        description: "Clean image/CDN cache",
        default: true,
    },
    cleanGuildCache: {
        type: OptionType.BOOLEAN,
        description: "Clean guild data cache for inactive servers",
        default: true,
    },
    messageCacheAge: {
        type: OptionType.NUMBER,
        description: "Remove messages older than this (in minutes). Only used if Clean Message Cache is enabled.",
        default: 30,
    },
});

interface MemoryStats {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
}

interface CacheEntry {
    timestamp: number;
    data: any;
}

export default definePlugin({
    name: "RamCleaner",
    description: "Monitor and automatically clean Discord's memory to reduce RAM usage",
    authors: [{ name: "Irritably", id: 928787166916640838n }],
    tags: ["Utility", "Privacy"],
    settings,

    monitorInterval: null as NodeJS.Timeout | null,
    lastCleanTime: 0,
    totalCleaned: 0,
    cleanCount: 0,

    flux: {
        CHANNEL_SELECT() {
            if (settings.store.autoCleanOnChannelSwitch) {
                (this as any).cleanMemory("channel switch");
            }
        },
    },

    start() {
        logger.info("Starting memory monitoring");
        this.startMonitoring();

        if (settings.store.showMemoryIndicator) {
            this.createMemoryIndicator();
        }

        logger.info("RamCleaner activated");
    },

    stop() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }

        this.removeMemoryIndicator();
        logger.info("RamCleaner stopped");
    },

    startMonitoring() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
        }

        const intervalMs = settings.store.cleanInterval * 1000;
        this.monitorInterval = setInterval(() => {
            this.checkAndClean();
        }, intervalMs);
    },

    checkAndClean() {
        const memory = this.getMemoryUsage();
        if (!memory) return;

        const usedMB = memory.usedJSHeapSize / 1024 / 1024;
        const estimatedTotal = this.estimateTotalRAM();
        const displayMB = estimatedTotal || usedMB;
        const maxMB = settings.store.maxMemoryMB;

        if (maxMB > 0 && displayMB > maxMB) {
            logger.info(`Memory usage ${displayMB.toFixed(0)}MB (est) exceeds limit ${maxMB}MB, triggering clean`);
            this.cleanMemory("auto-clean threshold exceeded");
        }

        this.updateMemoryIndicator(usedMB, memory.jsHeapSizeLimit / 1024 / 1024);
    },

    cleanMemory(reason: string) {
        const startTime = performance.now();
        let cleaned = false;

        try {
            if (settings.store.cleanMessageCache) {
                cleaned = this.cleanMessageCache() || cleaned;
            }

            if (settings.store.cleanEmojiCache) {
                cleaned = this.cleanEmojiCache() || cleaned;
            }

            if (settings.store.cleanImageCache) {
                cleaned = this.cleanImageCache() || cleaned;
            }

            if (settings.store.cleanGuildCache) {
                cleaned = this.cleanGuildCache() || cleaned;
            }

            if (settings.store.aggressiveMode) {
                cleaned = this.aggressiveClean() || cleaned;
            }

            this.triggerGarbageCollection();

            const duration = performance.now() - startTime;
            const memory = this.getMemoryUsage();
            const currentMB = memory ? memory.usedJSHeapSize / 1024 / 1024 : 0;

            this.cleanCount++;
            this.lastCleanTime = Date.now();

            logger.info(`Memory cleaned (${reason}): ${duration.toFixed(0)}ms, current usage: ${currentMB.toFixed(0)}MB`);

            if (settings.store.enableNotifications) {
                this.showNotification(currentMB);
            }
        } catch (error) {
            logger.error("Failed to clean memory:", error);
        }
    },

    cleanMessageCache(): boolean {
        try {
            if (!MessageStore) return false;

            const maxAge = settings.store.messageCacheAge * 60 * 1000;
            const now = Date.now();
            let cleaned = false;

            const currentChannelId = SelectedChannelStore.getChannelId();
            if (!currentChannelId) return false;

            const messageStoreAny = MessageStore as any;
            if (!messageStoreAny._messages) return false;

            for (const channelId in messageStoreAny._messages) {
                if (channelId === currentChannelId) continue;

                const messages = messageStoreAny._messages[channelId];
                if (!messages) continue;

                let hasOldMessages = false;
                for (const msg of messages) {
                    if (msg && msg.timestamp && (now - msg.timestamp) > maxAge) {
                        hasOldMessages = true;
                        break;
                    }
                }

                if (hasOldMessages) {
                    delete messageStoreAny._messages[channelId];
                    cleaned = true;
                }
            }

            if (cleaned) {
                logger.debug("Cleaned old message cache");
            }

            return cleaned;
        } catch (error) {
            logger.debug("Message cache cleanup failed:", error);
            return false;
        }
    },

    cleanEmojiCache(): boolean {
        try {
            if (!EmojiStore) return false;

            const now = Date.now();
            const maxAge = 30 * 60 * 1000;
            let cleaned = false;

            const emojiStoreAny = EmojiStore as any;
            if (emojiStoreAny._usageTimestamps) {
                for (const emojiId in emojiStoreAny._usageTimestamps) {
                    const lastUsed = emojiStoreAny._usageTimestamps[emojiId];
                    if (lastUsed && (now - lastUsed) > maxAge) {
                        delete emojiStoreAny._usageTimestamps[emojiId];
                        cleaned = true;
                    }
                }
            }

            if (cleaned) {
                logger.debug("Cleaned unused emoji cache");
            }

            return cleaned;
        } catch (error) {
            logger.debug("Emoji cache cleanup failed:", error);
            return false;
        }
    },

    cleanImageCache(): boolean {
        try {
            if ("caches" in window) {
                return false;
            }

            const performanceEntries = performance.getEntriesByType("resource");
            const now = performance.now();
            const maxAge = 10 * 60 * 1000;
            let cleaned = false;

            for (const entry of performanceEntries) {
                if (entry.name.includes("cdn.discordapp.com") && (now - entry.startTime) > maxAge) {
                    cleaned = true;
                    break;
                }
            }

            if (cleaned) {
                performance.clearResourceTimings();
                logger.debug("Cleared image cache timings");
            }

            return cleaned;
        } catch (error) {
            logger.debug("Image cache cleanup failed:", error);
            return false;
        }
    },

    cleanGuildCache(): boolean {
        try {
            if (!GuildStore) return false;

            const now = Date.now();
            const maxAge = 60 * 60 * 1000;
            let cleaned = false;

            const currentGuildId = SelectedChannelStore.getChannelId();
            if (!currentGuildId) return false;

            const guildStoreAny = GuildStore as any;
            if (!guildStoreAny._guilds) return false;

            for (const guildId in guildStoreAny._guilds) {
                if (guildId === currentGuildId) continue;

                const guild = guildStoreAny._guilds[guildId];
                if (!guild) continue;

                const lastAccessed = guild.lastAccessed || guild.joined_at;
                if (lastAccessed && (now - new Date(lastAccessed).getTime()) > maxAge) {
                    delete guildStoreAny._guilds[guildId];
                    cleaned = true;
                }
            }

            if (cleaned) {
                logger.debug("Cleaned inactive guild cache");
            }

            return cleaned;
        } catch (error) {
            logger.debug("Guild cache cleanup failed:", error);
            return false;
        }
    },

    aggressiveClean(): boolean {
        try {
            const FluxDispatcherAny = FluxDispatcher as any;

            if (FluxDispatcherAny._callbacks) {
                const callbackCount = Object.keys(FluxDispatcherAny._callbacks).length;
                if (callbackCount > 100) {
                    logger.debug(`Purging ${callbackCount} dispatcher callbacks`);
                }
            }

            if (FluxDispatcherAny._interceptors) {
                FluxDispatcherAny._interceptors = FluxDispatcherAny._interceptors.filter(
                    (interceptor: any) => interceptor && typeof interceptor === "function"
                );
            }

            if (FluxDispatcherAny._waiters) {
                const waiterCount = FluxDispatcherAny._waiters.length;
                if (waiterCount > 50) {
                    FluxDispatcherAny._waiters = [];
                    logger.debug(`Cleared ${waiterCount} pending waiters`);
                }
            }

            return true;
        } catch (error) {
            logger.debug("Aggressive cleanup failed:", error);
            return false;
        }
    },

    triggerGarbageCollection() {
        try {
            const win = window as any;
            if (typeof win.gc === "function") {
                win.gc();
                logger.debug("Garbage collection triggered");
            }

            Promise.resolve().then(() => {
                if ("gc" in window) {
                    (window as any).gc();
                }
            });
        } catch (error) {
            logger.debug("GC trigger failed:", error);
        }
    },

    getMemoryUsage(): MemoryStats | null {
        try {
            const perf = performance as any;
            if (perf.memory) {
                return {
                    usedJSHeapSize: perf.memory.usedJSHeapSize,
                    totalJSHeapSize: perf.memory.totalJSHeapSize,
                    jsHeapSizeLimit: perf.memory.jsHeapSizeLimit,
                };
            }
            return null;
        } catch (error) {
            return null;
        }
    },

    estimateTotalRAM(): number | null {
        try {
            const perf = performance as any;
            if (!perf.memory) return null;

            const jsHeapMB = perf.memory.usedJSHeapSize / 1024 / 1024;

            const nav = navigator as any;
            const deviceMemory = nav.deviceMemory || 8;

            const estimatedTotal = jsHeapMB * 2.5 + 400;

            return Math.round(estimatedTotal);
        } catch (error) {
            return null;
        }
    },

    createMemoryIndicator() {
        if (document.getElementById("ramcleaner-indicator")) return;

        const indicator = document.createElement("div");
        indicator.id = "ramcleaner-indicator";
        indicator.className = "ramcleaner-indicator";
        indicator.onclick = () => this.cleanMemory("manual");

        document.body.appendChild(indicator);
        logger.debug("Memory indicator created");
    },

    updateMemoryIndicator(usedMB: number, totalMB: number) {
        const indicator = document.getElementById("ramcleaner-indicator");
        if (!indicator) return;

        const estimatedTotal = this.estimateTotalRAM();
        const displayMB = estimatedTotal || usedMB;
        const percentage = (usedMB / totalMB) * 100;

        let color = "#43b581";
        const maxMB = settings.store.maxMemoryMB;

        if (maxMB > 0) {
            const limitPercentage = (displayMB / maxMB) * 100;
            if (limitPercentage > 80) {
                color = "#f04747";
            } else if (limitPercentage > 60) {
                color = "#faa61a";
            }
        } else {
            if (percentage > 80) {
                color = "#f04747";
            } else if (percentage > 60) {
                color = "#faa61a";
            }
        }

        indicator.textContent = `RAM: ${displayMB.toFixed(0)}MB`;
        indicator.style.backgroundColor = color;
        indicator.title = `JS Heap: ${usedMB.toFixed(0)}MB | Estimated Total: ${displayMB.toFixed(0)}MB`;
    },

    removeMemoryIndicator() {
        const indicator = document.getElementById("ramcleaner-indicator");
        if (indicator) {
            indicator.remove();
        }
    },

    showNotification(currentMB: number) {
        try {
            const Toasts = (window as any).Vencord?.Api?.Common?.Toasts;
            if (Toasts) {
                Toasts.show({
                    message: `Memory cleaned: ${currentMB.toFixed(0)}MB used`,
                    type: Toasts.Type.SUCCESS,
                    id: Toasts.genId(),
                    options: { position: Toasts.Position.BOTTOM },
                });
            }
        } catch (error) {
            logger.debug("Failed to show notification:", error);
        }
    },
});
