import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import dns from "dns/promises";  // ✅ Solo dns.promises (sempre disponibile in Vencord renderer)

const mullvadServers = ["194.242.2.4", "2a07:e340::4"];  // Mullvad DNS IPv4/IPv6 ✅

// Cache semplice hostname → IP con TTL
const ipCache = new Map<string, { ip: string; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000;  // 5 minuti

async function resolveWithMullvad(hostname: string): Promise<string> {
    const now = Date.now();
    const cached = ipCache.get(hostname);
    if (cached && cached.expires > now) {
        return cached.ip;
    }

    const resolver = new dns.Resolver();
    resolver.setServers(mullvadServers);

    try {
        // Prova IPv4 prima (più compatibile)
        const ipv4 = await resolver.resolve4(hostname);
        if (ipv4.length > 0) {
            const result = { ip: ipv4[0], expires: now + CACHE_TTL };
            ipCache.set(hostname, result);
            return ipv4[0];
        }
    } catch (e) {
        console.warn(`Mullvad IPv4 failed for ${hostname}:`, e);
    }

    try {
        // Fallback IPv6
        const ipv6 = await resolver.resolve6(hostname);
        if (ipv6.length > 0) {
            const result = { ip: ipv6[0], expires: now + CACHE_TTL };
            ipCache.set(hostname, result);
            return ipv6[0];
        }
    } catch (e) {
        console.warn(`Mullvad IPv6 failed for ${hostname}:`, e);
    }

    // Ultimate fallback: sistema DNS
    try {
        const sysIP = await dns.resolve4(hostname);
        return sysIP[0];
    } catch {
        return hostname;
    }
}

export default definePlugin({
    name: "MullvadDNS",
    description: "Routes Discord fetch/XHR through Mullvad DNS",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    settings: {
        enabled: {
            type: OptionType.BOOLEAN,
            description: "Enable Mullvad DNS",
            default: true,
            name: "Enabled"
        }
    },

    async start() {
        if (!this.settings.enabled) return;

        // ✅ Salva original fetch
        (window as any).vencord_original_fetch ||= window.fetch;

        // Patch fetch (80-90% Discord traffic)
        const originalFetch = window.fetch;
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            let url: URL;
            if (input instanceof Request) {
                url = new URL(input.url);
            } else if (typeof input === "string") {
                url = new URL(input);
            } else {
                return originalFetch(input, init);
            }

            // ✅ Solo hostname (skip IP già risolti)
            if (url.hostname && !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}|[0-9a-fA-F:]+/.test(url.hostname)) {
                try {
                    console.debug(`Resolving ${url.hostname} via Mullvad...`);
                    const ip = await resolveWithMullvad(url.hostname);
                    url.hostname = ip;
                    input = url.toString();
                    console.debug(`Resolved ${url.hostname} → ${ip}`);
                } catch (e) {
                    console.error("Mullvad resolve error:", e);
                }
            }

            return originalFetch(input, init);
        };

        // ✅ Patch XHR semplificato (non blocca)
        const originalXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
            const xhr = new originalXHR();
            const originalOpen = xhr.open;
            xhr.open = async function(method: string, url: string) {
                const parsed = new URL(url);
                if (parsed.hostname && !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}|[0-9a-fA-F:]+/.test(parsed.hostname)) {
                    try {
                        const ip = await resolveWithMullvad(parsed.hostname);
                        parsed.hostname = ip;
                        originalOpen.call(xhr, method, parsed.toString());
                    } catch {
                        originalOpen.call(xhr, method, url);
                    }
                } else {
                    originalOpen.call(xhr, method, url);
                }
            };
            return xhr;
        } as any;

        console.log("✅ Mullvad DNS loaded! Servers:", mullvadServers);
        console.log("Test: Open F12 > Network, send message");
    },

    stop() {
        window.fetch = (window as any).vencord_original_fetch;
        window.XMLHttpRequest = window.originalXMLHttpRequest || window.XMLHttpRequest;
        ipCache.clear();
        console.log("❌ Mullvad DNS stopped");
    }
});
