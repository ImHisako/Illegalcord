/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// @ts-ignore
import { definePluginSettings } from "@api/Settings";
// @ts-ignore
import definePlugin, { PluginNative } from "@utils/types";
// @ts-ignore
import { OptionType } from "@utils/types";

const Native = VencordNative.pluginHelpers.MullvadDNS as PluginNative<typeof import("./native")>;

// Plugin settings
const settings = definePluginSettings({
    enableLogging: {
        type: OptionType.BOOLEAN,
        description: "Enable detailed logging",
        default: true
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show toast notifications for DNS resolutions",
        default: false
    },
    autoStart: {
        type: OptionType.BOOLEAN,
        description: "Auto-start plugin on load",
        default: true
    }
});

// @ts-ignore
export default definePlugin({
    name: "MullvadDNS",
    description: "Force Discord to use Mullvad DNS servers for enhanced privacy",
    tags: ["Privacy", "Utility"],
    authors: [{ name: "Irritably", id: 928787166916640838n }],
    settings,

    start() {
        const PLUGIN_NAME = "MullvadDNS";
        const VERSION = "2.0.0";
        const MULLVAD_DNS_SERVER = "194.242.2.4";

        const originalFetch = window.fetch;
        let isActive = false;
        const dnsCache = new Map<string, string>();
        const statistics = {
            totalRequests: 0,
            successfulResolutions: 0,
            failedResolutions: 0,
            cacheHits: 0,
            nativeCalls: 0
        };

        const log = {
            info: (msg: string) => {
                if (settings.store.enableLogging) {
                    console.log(`%c[${PLUGIN_NAME}] %cINFO: ${msg}`, "color: #4CAF50; font-weight: bold", "color: #4CAF50");
                }
            },
            warn: (msg: string) => {
                if (settings.store.enableLogging) {
                    console.warn(`%c[${PLUGIN_NAME}] %cWARN: ${msg}`, "color: #FF9800; font-weight: bold", "color: #FF9800");
                }
            },
            error: (msg: string) => {
                if (settings.store.enableLogging) {
                    console.error(`%c[${PLUGIN_NAME}] %cERROR: ${msg}`, "color: #F44336; font-weight: bold", "color: #F44336");
                }
            }
        };

        const EXCLUDED_PATHS = [
            "/api/v9/oauth2",
            "/api/oauth2",
            "/api/v9/users/@me/settings-proto",
            "/api/v9/auth",
            "/api/v9/verify",
            "/attachments"
        ];

        function shouldExcludeURL(url: URL): boolean {
            return EXCLUDED_PATHS.some(path => url.pathname.includes(path));
        }

        async function getDNSRecord(hostname: string): Promise<string | null> {
            if (dnsCache.has(hostname)) {
                statistics.cacheHits++;
                return dnsCache.get(hostname)!;
            }

            if (!Native) {
                log.warn("Native module not available");
                return null;
            }

            try {
                statistics.nativeCalls++;
                const result = await Native.resolveDNS(hostname, MULLVAD_DNS_SERVER);

                if (result.success && result.addresses.length > 0) {
                    const ip = result.addresses[0];
                    dnsCache.set(hostname, ip);
                    log.info(`Resolved ${hostname} -> ${ip} via ${result.server}`);
                    return ip;
                }

                log.warn(`No DNS record for ${hostname}: ${result.error || "empty response"}`);
                return null;
            } catch (error) {
                log.error(`DNS resolution failed for ${hostname}: ${error}`);
                return null;
            }
        }

        async function patchFetch() {
            if (!originalFetch) {
                log.error("Original fetch not found!");
                return false;
            }

            window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
                try {
                    const urlStr = (input instanceof Request) ? input.url : String(input);
                    const url = new URL(urlStr);

                    statistics.totalRequests++;

                    if (url.hostname.includes("discord") && !url.hostname.includes("mullvad") && !shouldExcludeURL(url)) {
                        const ip = await getDNSRecord(url.hostname);

                        if (ip) {
                            const newUrl = new URL(urlStr);
                            newUrl.hostname = ip;
                            const modifiedUrl = newUrl.toString();

                            statistics.successfulResolutions++;
                            log.info(`Resolved ${url.hostname} -> ${ip} (Mullvad)`);

                            if (settings.store.showNotifications) {
                                showNotification(`DNS: ${url.hostname} -> ${ip}`, "success");
                            }

                            const request = (input instanceof Request)
                                ? new Request(modifiedUrl, input)
                                : modifiedUrl;

                            return originalFetch(request, init);
                        } else {
                            statistics.failedResolutions++;
                        }
                    }

                    return originalFetch(input, init);
                } catch (error) {
                    statistics.failedResolutions++;
                    log.error(`Fetch patch error: ${error}`);
                    return originalFetch(input, init);
                }
            };

            log.info("Fetch patched successfully");
            return true;
        }

        function showNotification(message: string, type = "info") {
            try {
                const toastModule = (window as any).Vencord?.Plugins?.Plugins?.Toasts;
                if (toastModule) {
                    toastModule.show({
                        message: `🔒 ${message}`,
                        type: type === "success"
                            ? toastModule.Type.SUCCESS
                            : type === "error"
                                ? toastModule.Type.FAILURE
                                : toastModule.Type.MESSAGE,
                        id: Date.now(),
                        options: { position: toastModule.Position.BOTTOM }
                    });
                }
            } catch (e) {
                // Toast system not available
            }
        }

        const MullvadDNS = {
            name: PLUGIN_NAME,
            version: VERSION,
            isActive: () => isActive,
            statistics,

            start: async () => {
                if (isActive) {
                    log.warn("Plugin is already active!");
                    return;
                }

                if (!Native) {
                    log.error("Native module not available - plugin cannot function");
                    showNotification("MullvadDNS: Native module not found", "error");
                    return;
                }

                try {
                    log.info(`Starting ${PLUGIN_NAME} v${VERSION}`);
                    log.info(`Using Mullvad DNS: ${MULLVAD_DNS_SERVER}`);

                    // Preload DNS records
                    log.info("Preloading DNS records...");
                    const preloaded = await Native.preloadDNS();
                    log.info(`Preloaded ${Object.keys(preloaded).length} DNS records`);

                    const fetchSuccess = await patchFetch();

                    if (fetchSuccess) {
                        isActive = true;
                        showNotification(`${PLUGIN_NAME} activated`, "success");
                        log.info(`Plugin started - using Mullvad DNS ${MULLVAD_DNS_SERVER}`);
                    } else {
                        throw new Error("Failed to patch fetch");
                    }
                } catch (error) {
                    log.error(`Failed to start plugin: ${error}`);
                    showNotification(`${PLUGIN_NAME} failed to start`, "error");
                }
            },

            stop: () => {
                if (!isActive) {
                    log.warn("Plugin is not active!");
                    return;
                }

                try {
                    log.info(`Stopping ${PLUGIN_NAME}`);

                    if (originalFetch) {
                        window.fetch = originalFetch;
                        log.info("Fetch restored");
                    }

                    dnsCache.clear();
                    isActive = false;

                    showNotification(`${PLUGIN_NAME} deactivated`, "info");
                    log.info("Plugin stopped");
                } catch (error) {
                    log.error(`Error stopping plugin: ${error}`);
                }
            },

            getDNSTable: () => ({ ...Object.fromEntries(dnsCache) }),
            getStatistics: () => ({ ...statistics }),
            clearStatistics: () => {
                statistics.totalRequests = 0;
                statistics.successfulResolutions = 0;
                statistics.failedResolutions = 0;
                statistics.cacheHits = 0;
                statistics.nativeCalls = 0;
                log.info("Statistics cleared");
            },
            clearCache: () => {
                const { size } = dnsCache;
                dnsCache.clear();
                log.info(`Cleared ${size} DNS cache entries`);
                return size;
            }
        };

        if (settings.store.autoStart) {
            setTimeout(() => {
                MullvadDNS.start();
            }, 2000);
        } else {
            log.info("Auto-start disabled");
            showNotification(`${PLUGIN_NAME} loaded - start manually`, "info");
        }

        // @ts-ignore
        window.MullvadDNS = MullvadDNS;

        log.info(`${PLUGIN_NAME} v${VERSION} loaded`);
    },

    stop() {
        // Clean shutdown
        try {
            if (typeof (window as any).MullvadDNS?.stop === "function") {
                (window as any).MullvadDNS.stop();
            }
            console.log("[MullvadDNS] Plugin stopped");
        } catch (error) {
            console.error("[MullvadDNS] Error during shutdown:", error);
        }
    }
});
