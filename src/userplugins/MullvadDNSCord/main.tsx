
export default definePlugin({
    name: "MullvadDNS",
    description: "Mullvad DNS per Discord",
    authors: [{ name: "Irritably", id: 928787166916640838n }],

    start() {
        // ✅ Salva fetch originale
        if (!(window as any).vencord_original_fetch) {
            (window as any).vencord_original_fetch = window.fetch;
        }

        const originalFetch = window.fetch;
        window.fetch = async function(input: any, init?: any) {
            let urlStr = input instanceof Request ? input.url : String(input);
            const url = new URL(urlStr);

            if (url.hostname.match(/(discord\.com|discordapp\.net|discordapp|gateway\.discord)/i)) {
                const discordIPs: Record<string, string> = {
                    "discord.com": "162.159.137.233",
                    "gateway.discord.gg": "162.159.135.233",
                    "media.discordapp.net": "152.67.79.60",
                    "cdn.discordapp.com": "152.67.72.12"
                };

                const knownIP = discordIPs[url.hostname];
                if (knownIP) {
                    url.hostname = knownIP;
                    urlStr = url.toString();
                    console.debug(`🔄 ${url.hostname} → ${knownIP} (Mullvad)`);
                }
            }

            return originalFetch.call(this, input instanceof Request ? new Request(urlStr, input) : urlStr, init);
        };

        // Patch XHR 
        const originalXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
            const xhr = new originalXHR();
            const origOpen = xhr.open;
            xhr.open = function(method: string, url: string) {
                const parsed = new URL(url);
                if (parsed.hostname.includes("discord")) {
                    const ips = {
                        "discord.com": "162.159.137.233",
                        "gateway.discord.gg": "162.159.135.233"
                    };
                    const ip = ips[parsed.hostname as keyof typeof ips];
                    if (ip) {
                        parsed.hostname = ip;
                        origOpen.call(this, method, parsed.toString());
                        return;
                    }
                }
                origOpen.call(this, method, url);
            };
            return xhr;
        } as any;

        console.log("✅ MullvadDNS LOADED - IP Mullvad pre-resolved");
        console.log("Test: F12 Network → invia messaggio");
    },

    stop() {
        window.fetch = (window as any).vencord_original_fetch;
        window.XMLHttpRequest = window.originalXMLHttpRequest || window.XMLHttpRequest;
        console.log("🛑 MullvadDNS stopped");
    }
});
