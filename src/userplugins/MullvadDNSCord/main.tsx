import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

interface IPResolution {
    hostname: string;
    ips: string[];
    type: "A" | "AAAA";
    ttl?: number;
}

// IP cache with 5min TTL
const ipCache = new Map<string, { ips: string[]; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000;

// Mullvad DoH endpoint (POST with DNS wire-format)
const DOH_URL = "https://dns.mullvad.net/dns-query";

async function encodeDNSQuery(name: string, type: number = 1): Promise<Uint8Array> {  // 1=A, 28=AAAA
    const labels = name.split(".");
    const buf = new Uint8Array(512);
    let offset = 12;  // Fixed 12-byte header

    // Questions count = 1
    buf[4] = 0x00; buf[5] = 0x01;
    buf[6] = 0x00; buf[7] = 0x00;
    buf[8] = 0x00; buf[9] = 0x01;
    buf[10] = 0x00; buf[11] = 0x01;

    // Name labels
    for (const label of labels) {
        buf[offset++] = label.length;
        for (const char of label) buf[offset++] = char.charCodeAt(0);
    }
    buf[offset++] = 0;  // End name

    // Type/CLASS
    new DataView(buf.buffer).setUint16(offset, type, true); offset += 2;
    new DataView(buf.buffer).setUint16(offset, 1, true);    // IN class

    return buf.slice(0, offset);
}

async function decodeDNSResponse(data: ArrayBuffer): Promise<string[]> {
    const view = new DataView(data);
    let offset = 12;  // Skip header

    // Skip questions
    while (view.getUint8(offset) !== 0) {
        offset += view.getUint8(offset) + 1;
    }
    offset += 5;  // Rest of question

    const ips: string[] = [];
    const count = view.getUint16(offset - 6, true);  // Answers count

    for (let i = 0; i < count; i++) {
        // Skip name (pointer/compressed)
        if ((view.getUint8(offset) & 0xC0) === 0xC0) offset += 2;
        else while (view.getUint8(offset) !== 0) offset += view.getUint8(offset) + 1;

        offset += 10;  // Type/class/ttl

        const type = view.getUint16(offset - 10, true);
        const rdlength = view.getUint16(offset - 2, true);
        
        if (type === 1 && rdlength === 4) {  // A record
            const ip = [
                view.getUint8(offset),
                view.getUint8(offset+1),
                view.getUint8(offset+2),
                view.getUint8(offset+3)
            ].join(".");
            ips.push(ip);
        } else if (type === 28 && rdlength === 16) {  // AAAA record
            let ipv6 = "";
            for (let j = 0; j < 8; j++) {
                const word = view.getUint16(offset + j*2, true);
                ipv6 += word.toString(16).padStart(4, "0");
                if (j < 7) ipv6 += ":";
            }
            ips.push(ipv6);
        }
        offset += rdlength;
    }
    return ips;
}

async function resolveWithMullvadDoH(hostname: string, preferIPv4: boolean = true): Promise<string> {
    const now = Date.now();
    const cached = ipCache.get(hostname);
    if (cached && cached.expires > now) return cached.ips[0];

    try {
        // Try A or AAAA records
        const dnsType = preferIPv4 ? 1 : 28;
        const query = await encodeDNSQuery(hostname, dnsType);
        const res = await fetch(DOH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/dns-message" },
            body: query,
            cache: "no-store"
        });
        if (!res.ok) throw new Error(`DoH HTTP ${res.status}`);

        const data = await res.arrayBuffer();
        const ips = await decodeDNSResponse(data);

        if (ips.length > 0) {
            const result = { ips, expires: now + CACHE_TTL };
            ipCache.set(hostname, result);
            return ips[0];
        }
    } catch (e) {
        console.warn(`Mullvad DoH failed for ${hostname}:`, e);
    }

    // System DNS fallback
    try {
        const { default: dns } = await import("dns/promises");
        const sysIPs = await dns.resolve4(hostname);
        return sysIPs[0];
    } catch {
        return hostname;
    }
}

export default definePlugin({
    name: "MullvadDNSDoH",
    description: "Uses Mullvad DoH (dns.mullvad.net) to resolve hostnames in Discord fetch/XHR/WebSocket requests",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    settings: {
        enabled: {
            type: OptionType.BOOLEAN,
            description: "Enable Mullvad DoH",
            default: true
        },
        preferIPv4: {
            type: OptionType.BOOLEAN,
            description: "Prefer IPv4 over IPv6",
            default: true
        }
    },

    async start() {
        if (!this.settings.enabled) return;

        // Save originals
        (window as any).vencord_original_fetch ||= window.fetch;
        window.originalXMLHttpRequest ||= window.XMLHttpRequest;
        window.originalWebSocket ||= window.WebSocket;

        // Patch fetch
        const originalFetch = window.fetch;
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const url = input instanceof Request ? new URL(input.url) : new URL(input as string);
            if (url.hostname && !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}|[0-9a-fA-F:]+(:[0-9a-fA-F:]+)*$/.test(url.hostname)) {
                try {
                    const ip = await resolveWithMullvadDoH(url.hostname, this.settings.preferIPv4);
                    url.hostname = ip;
                    input = url.toString();
                } catch (e) {
                    console.error("DoH resolve error:", e);
                }
            }
            return originalFetch.call(window, input, init);
        };

        // Patch XMLHttpRequest
        const originalXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
            const xhr = new originalXHR() as any;
            const originalOpen = xhr.open;
            xhr.open = async function(method: string, url: string | URL) {
                const parsed = new URL(url.toString());
                if (parsed.hostname && !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}|[0-9a-fA-F:]+(:[0-9a-fA-F:]+)*$/.test(parsed.hostname)) {
                    try {
                        const ip = await resolveWithMullvadDoH(parsed.hostname, (window as any).MullvadDNSDoH?.settings?.preferIPv4 ?? true);
                        parsed.hostname = ip;
                        return originalOpen.call(this, method, parsed.toString());
                    } catch {
                        return originalOpen.call(this, method, url);
                    }
                }
                return originalOpen.call(this, method, url);
            };
            return xhr;
        } as any;

        // Patch WebSocket (improved)
        const originalWS = window.WebSocket;
        window.WebSocket = function(url: string | URL, protocols?: string | string[]) {
            const parsed = new URL(url.toString());
            if (parsed.hostname && !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}|[0-9a-fA-F:]+(:[0-9a-fA-F:]+)*$/.test(parsed.hostname)) {
                resolveWithMullvadDoH(parsed.hostname, (window as any).MullvadDNSDoH?.settings?.preferIPv4 ?? true).then(ip => {
                    parsed.hostname = ip;
                    // @ts-ignore
                    new originalWS(parsed.toString(), protocols);
                }).catch(() => {
                    // @ts-ignore
                    new originalWS(url, protocols);
                });
                return null as any;  // Don't return instance (async pattern)
            }
            // @ts-ignore
            return new originalWS(url, protocols);
        } as any;

        (window as any).MullvadDNSDoH = this;
        console.log("✅ Mullvad DoH enabled (dns.mullvad.net)");
    },

    stop() {
        window.fetch = (window as any).vencord_original_fetch;
        window.XMLHttpRequest = window.originalXMLHttpRequest;
        window.WebSocket = window.originalWebSocket;
        ipCache.clear();
        delete (window as any).MullvadDNSDoH;
        console.log("❌ Mullvad DoH disabled");
    }
});
