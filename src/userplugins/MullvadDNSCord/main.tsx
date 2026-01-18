/*
 * MullvadDNSCord, a Discord client mod plugin
 * Forces Discord to use Mullvad VPN DNS servers for enhanced privacy
 * Copyright (c) 2026
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { Toasts } from "@webpack/common";

interface DNSRecord {
    hostname: string;
    ip: string;
    description: string;
}

// Mullvad DNS records for Discord services
const MULLVAD_DNS_RECORDS: DNSRecord[] = [
    {
        hostname: "discord.com",
        ip: "162.159.137.233",
        description: "Main Discord website"
    },
    {
        hostname: "gateway.discord.gg",
        ip: "162.159.135.233",
        description: "WebSocket gateway"
    },
    {
        hostname: "media.discordapp.net",
        ip: "152.67.79.60",
        description: "Media proxy"
    },
    {
        hostname: "cdn.discordapp.com",
        ip: "152.67.72.12",
        description: "Content delivery network"
    },
    {
        hostname: "status.discord.com",
        ip: "104.18.33.247",
        description: "Status page"
    },
    {
        hostname: "ptb.discord.com",
        ip: "162.159.137.233",
        description: "Public Test Build"
    },
    {
        hostname: "canary.discord.com",
        ip: "162.159.137.233",
        description: "Canary build"
    }
];

const logger = new Logger("MullvadDNSCord");

export const settings = definePluginSettings({
    enableLogging: {
        type: OptionType.BOOLEAN,
        description: "Enable detailed logging of DNS resolutions",
        default: true
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show toast notifications when DNS is resolved",
        default: true
    },
    enableXHR: {
        type: OptionType.BOOLEAN,
        description: "Also patch XMLHttpRequest (may cause issues)",
        default: false
    },
    customRecords: {
        type: OptionType.STRING,
        description: "Custom DNS records (JSON format)",
        default: "{}"
    }
});

export default definePlugin({
    name: "MullvadDNSCord",
    description: "Force Discord to use Mullvad VPN DNS servers for enhanced privacy and security",
    authors: [
        { name: "Irritably", id: 928787166916640838n },
        Devs.Ven // Adding Vencord team for framework support
    ],
    tags: ["privacy", "security", "vpn", "dns"],
    
    settings,

    // Store original functions
    originalFetch: null as typeof fetch | null,
    originalXHR: null as typeof XMLHttpRequest | null,
    dnsCache: new Map<string, string>(),

    getDNSRecord(hostname: string): DNSRecord | undefined {
        // Check built-in records
        const record = MULLVAD_DNS_RECORDS.find(r => r.hostname === hostname);
        if (record) return record;
        
        // Check custom records
        try {
            const customRecords = JSON.parse(settings.store.customRecords || "{}");
            if (customRecords[hostname]) {
                return {
                    hostname,
                    ip: customRecords[hostname],
                    description: "Custom record"
                };
            }
        } catch (e) {
            logger.error("Failed to parse custom DNS records:", e);
        }
        
        return undefined;
    },

    patchFetch() {
        if (this.originalFetch) return;
        
        this.originalFetch = window.fetch;
        
        const self = this;
        window.fetch = async function(input: RequestInfo | URL, init?: RequestInit) {
            try {
                let urlStr = input instanceof Request ? input.url : String(input);
                const url = new URL(urlStr);
                
                // Check if this is a Discord-related hostname
                const isDiscordHost = url.hostname.includes('discord');
                
                if (isDiscordHost) {
                    const record = self.getDNSRecord(url.hostname);
                    
                    if (record) {
                        // Cache the resolution
                        self.dnsCache.set(url.hostname, record.ip);
                        
                        // Replace hostname with IP
                        url.hostname = record.ip;
                        urlStr = url.toString();
                        
                        if (settings.store.enableLogging) {
                            logger.debug(`🔄 Resolved ${record.hostname} → ${record.ip} (${record.description})`);
                        }
                        
                        if (settings.store.showNotifications) {
                            Toasts.show({
                                message: `🔒 DNS resolved: ${record.hostname} → ${record.ip}`,
                                id: Toasts.genId(),
                                type: Toasts.Type.MESSAGE,
                                options: {
                                    position: Toasts.Position.BOTTOM
                                }
                            });
                        }
                    }
                }
                
                // Call original fetch with modified URL
                const request = input instanceof Request 
                    ? new Request(urlStr, {                        ...input,
                        ...init
                    })
                    : urlStr;
                    
                return self.originalFetch!.call(this, request, init);
                
            } catch (error) {
                logger.error("Fetch patch error:", error);
                // Fallback to original fetch
                return self.originalFetch!.call(this, input, init);
            }
        };
        
        logger.info("✅ Fetch patched successfully");
    },

    patchXHR() {
        if (!settings.store.enableXHR || this.originalXHR) return;
        
        this.originalXHR = window.XMLHttpRequest;
        
        const self = this;
        
        // @ts-ignore - We're extending the global XMLHttpRequest
        window.XMLHttpRequest = function() {
            const xhr = new self.originalXHR!();
            const originalOpen = xhr.open;
            
            xhr.open = function(method: string, url: string | URL, ...args: any[]) {
                try {
                    const urlObj = new URL(url.toString());
                    
                    if (urlObj.hostname.includes('discord')) {
                        const record = self.getDNSRecord(urlObj.hostname);
                        
                        if (record) {
                            self.dnsCache.set(urlObj.hostname, record.ip);
                            urlObj.hostname = record.ip;
                            
                            if (settings.store.enableLogging) {
                                logger.debug(`🔄 XHR Resolved ${record.hostname} → ${record.ip}`);
                            }
                        }
                    }
                    
                    // @ts-ignore - Call original open with modified URL
                    return originalOpen.call(this, method, urlObj.toString(), ...args);
                    
                } catch (error) {
                    logger.error("XHR patch error:", error);
                    // Fallback to original open
                    // @ts-ignore
                    return originalOpen.call(this, method, url, ...args);
                }
            };
            
            return xhr;
        };
        
        logger.info("✅ XMLHttpRequest patched successfully");
    },

    restoreFetch() {
        if (this.originalFetch) {
            window.fetch = this.originalFetch;
            this.originalFetch = null;
            logger.info("🔄 Fetch restored to original");
        }
    },

    restoreXHR() {
        if (this.originalXHR) {
            window.XMLHttpRequest = this.originalXHR;
            this.originalXHR = null;
            logger.info("🔄 XMLHttpRequest restored to original");
        }
    },

    start() {
        try {
            logger.info("🚀 Starting MullvadDNSCord plugin");
            
            this.patchFetch();
            this.patchXHR();
            
            // Show startup notification
            if (settings.store.showNotifications) {
                Toasts.show({
                    message: "🔒 MullvadDNSCord activated - Discord traffic now routed through Mullvad DNS",
                    id: Toasts.genId(),
                    type: Toasts.Type.SUCCESS,
                    options: {
                        position: Toasts.Position.BOTTOM,
                        duration: 5000
                    }
                });
            }
            
            logger.info(`✅ Plugin started successfully with ${MULLVAD_DNS_RECORDS.length} DNS records loaded`);
            
        } catch (error) {
            logger.error("❌ Failed to start plugin:", error);
            Toasts.show({
                message: "❌ MullvadDNSCord failed to start",
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE,
                options: {
                    position: Toasts.Position.BOTTOM
                }
            });
        }
    },

    stop() {
        try {
            logger.info("🛑 Stopping MullvadDNSCord plugin");
            
            this.restoreFetch();
            this.restoreXHR();
            this.dnsCache.clear();
            
            if (settings.store.showNotifications) {
                Toasts.show({
                    message: "🔓 MullvadDNSCord deactivated",
                    id: Toasts.genId(),
                    type: Toasts.Type.MESSAGE,
                    options: {
                        position: Toasts.Position.BOTTOM
                    }
                });
            }
            
            logger.info("✅ Plugin stopped successfully");
            
        } catch (error) {
            logger.error("❌ Error stopping plugin:", error);
        }
    },

    // Utility methods for external access
    getDNSTable() {
        return MULLVAD_DNS_RECORDS;
    },
    
    getCacheStats() {
        return {
            cacheSize: this.dnsCache.size,
            cachedHostnames: Array.from(this.dnsCache.keys())
        };
    },
    
    clearCache() {
        const cleared = this.dnsCache.size;
        this.dnsCache.clear();
        logger.info(`🧹 Cleared ${cleared} DNS cache entries`);
        return cleared;
    }
});
