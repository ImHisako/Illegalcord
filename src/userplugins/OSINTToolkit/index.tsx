/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { sendBotMessage } from "@api/Commands";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

interface DomainInfo {
    domain: string;
    registrar?: string;
    registrationDate?: string;
    expirationDate?: string;
    updatedAt?: string;
    status?: string[];
    nameServers?: string[];
    dnssec?: string;
}

interface IPInfo {
    ip: string;
    city?: string;
    region?: string;
    country?: string;
    countryName?: string;
    lat?: number;
    lon?: number;
    org?: string;
    isp?: string;
    timezone?: string;
    zip?: string;
}

const settings = definePluginSettings({
    enableLogging: {
        type: OptionType.BOOLEAN,
        description: "Enable debug logging",
        default: false
    }
});

async function getDomainInfo(domain: string): Promise<DomainInfo | null> {
    try {
        // Using rdap.org for RDAP lookup - completely FREE, no API key required
        const response = await fetch(`https://rdap.org/domain/${domain}`);

        if (!response.ok) {
            throw new Error(`Domain not found or RDAP lookup failed`);
        }

        const data = await response.json();

        // Extract registrar information
        let registrar = "Unknown";
        if (data.entities && Array.isArray(data.entities)) {
            const registrarEntity = data.entities.find((e: any) =>
                e.roles && e.roles.includes('registrar')
            );
            if (registrarEntity?.vcardArray?.[1]) {
                const fn = registrarEntity.vcardArray[1].find((p: any) => p[0] === 'fn');
                if (fn && fn[3]) {
                    registrar = fn[3];
                }
            }
        }

        const info: DomainInfo = {
            domain: data.ldhName || domain,
            registrar: registrar,
            registrationDate: data.events?.find((e: any) =>
                e.eventAction === 'registration'
            )?.eventDate,
            expirationDate: data.events?.find((e: any) =>
                e.eventAction === 'expiration'
            )?.eventDate,
            updatedAt: data.events?.find((e: any) =>
                e.eventAction === 'last changed'
            )?.eventDate,
            status: data.status,
            nameServers: data.nameservers?.map((ns: any) => ns.ldhName),
            dnssec: data.secureDNS?.delegationSigned ? 'signed' : 'unsigned'
        };

        return info;
    } catch (error) {
        console.error("Domain lookup error:", error);
        return null;
    }
}

async function getIPInfo(ip: string): Promise<IPInfo | null> {
    try {
        // Using ip-api.com FREE tier - no API key required (45 req/min limit)
        const response = await fetch(`http://ip-api.com/json/${ip}`);

        if (!response.ok) {
            throw new Error("IP lookup failed");
        }

        const data = await response.json();

        if (data.status === "fail") {
            throw new Error(data.message || "IP lookup failed");
        }

        const info: IPInfo = {
            ip: data.query,
            city: data.city,
            region: data.regionName,
            country: data.countryCode,
            countryName: data.country,
            lat: data.lat,
            lon: data.lon,
            org: data.org,
            isp: data.isp,
            timezone: data.timezone,
            zip: data.zip
        };

        return info;
    } catch (error) {
        console.error("IP lookup error:", error);
        return null;
    }
}

function calculateDomainAge(registrationDate: string): string {
    const now = new Date();
    const regDate = new Date(registrationDate);
    const diffTime = Math.abs(now.getTime() - regDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const years = Math.floor(diffDays / 365);
    const months = Math.floor((diffDays % 365) / 30);
    const days = (diffDays % 365) % 30;

    return `${years}y ${months}m ${days}d`;
}

function createDomainEmbed(info: DomainInfo) {
    const ageText = info.registrationDate ? calculateDomainAge(info.registrationDate) : "Unknown";

    return {
        content: "",
        embeds: [{
            title: `🔍 Domain Information: ${info.domain}`,
            color: 0x5865F2, // Discord Blurple
            fields: [
                {
                    name: "📅 Registration Date",
                    value: info.registrationDate || "N/A",
                    inline: true
                },
                {
                    name: "⏰ Domain Age",
                    value: ageText,
                    inline: true
                },
                {
                    name: "🗓️ Expiration Date",
                    value: info.expirationDate || "N/A",
                    inline: true
                },
                {
                    name: "🏢 Registrar",
                    value: info.registrar || "Unknown",
                    inline: false
                },
                {
                    name: "🔄 Last Updated",
                    value: info.updatedAt || "N/A",
                    inline: true
                },
                {
                    name: "🔒 DNSSEC",
                    value: info.dnssec || "N/A",
                    inline: true
                },
                {
                    name: "📊 Status",
                    value: info.status?.join(", ") || "N/A",
                    inline: false
                }
            ],
            footer: {
                text: "OSINT • 🔥",
                icon_url: "https://cdn.discordapp.com/embed/avatars/0.png"
            },
            timestamp: new Date().toISOString()
        }] as any
    };
}

function createIPEmbed(info: IPInfo) {
    const mapUrl = `https://www.google.com/maps?q=${info.lat},${info.lon}`;
    const flagUrl = `https://flagcdn.com/w80/${info.country?.toLowerCase()}.png`;

    return {
        content: "",
        embeds: [{
            title: `🌐 IP Information: ${info.ip}`,
            color: 0x57F287, // Discord Green
            fields: [
                {
                    name: "📍 Location",
                    value: `${info.city || "Unknown"}, ${info.region || "Unknown"}\n${info.countryName || "Unknown"} (${info.country || "?"})`,
                    inline: true
                },
                {
                    name: "🕐 Timezone",
                    value: info.timezone || "Unknown",
                    inline: true
                },
                {
                    name: "📮 ZIP Code",
                    value: info.zip || "Unknown",
                    inline: true
                },
                {
                    name: "🏢 ISP",
                    value: info.isp || "Unknown",
                    inline: false
                },
                {
                    name: "🌐 Organization",
                    value: info.org || "Unknown",
                    inline: false
                },
                {
                    name: "🗺️ Coordinates",
                    value: `[${info.lat}, ${info.lon}](${mapUrl})`,
                    inline: false
                }
            ],
            thumbnail: {
                url: flagUrl
            },
            footer: {
                text: "OSINT • 🔥",
                icon_url: "https://cdn.discordapp.com/embed/avatars/0.png"
            },
            timestamp: new Date().toISOString()
        }] as any
    };
}

export default definePlugin({
    name: "OSINTToolkit",
    description: "OSINT - Domain age lookup & IP information",
    authors: [{ name: "Irritably", id: 928787166916640838n }],
    settings,

    commands: [
        {
            name: "domain",
            description: "Get domain registration information and age (FREE - No API key)",
            predicate: () => true,
            options: [
                {
                    name: "domain",
                    description: "The domain to lookup (e.g., google.com)",
                    type: 3,
                    required: true
                }
            ],
            execute: async (args: any[], ctx: any) => {
                const domainInput = args[0]?.value as string;

                if (!domainInput) {
                    sendBotMessage(ctx.channel.id, {
                        content: "Please provide a domain name!"
                    });
                    return;
                }

                // Clean domain input
                let domain = domainInput.toLowerCase().trim();
                domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

                if (settings.store.enableLogging) {
                    console.log("[OSINT] Looking up domain:", domain);
                }

                sendBotMessage(ctx.channel.id, {
                    content: "Looking up domain information..."
                });

                const info = await getDomainInfo(domain);

                if (!info) {
                    sendBotMessage(ctx.channel.id, {
                        content: `Failed to retrieve information for **${domain}**\nPossible reasons:\n• Domain doesn't exist\n• RDAP server unavailable\n• Invalid domain format`
                    });
                    return;
                }

                const embed = createDomainEmbed(info);
                sendBotMessage(ctx.channel.id, embed);
            }
        },
        {
            name: "iplookup",
            description: "Get geolocation and network information for an IP (FREE - No API key)",
            predicate: () => true,
            options: [
                {
                    name: "ip",
                    description: "The IP address to lookup (IPv4)",
                    type: 3,
                    required: true
                }
            ],
            execute: async (args: any[], ctx: any) => {
                const ipInput = args[0]?.value as string;

                if (!ipInput) {
                    sendBotMessage(ctx.channel.id, {
                        content: "Please provide an IP address!"
                    });
                    return;
                }

                // Validate IP format
                const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
                const ip = ipInput.trim();

                if (!ipRegex.test(ip)) {
                    sendBotMessage(ctx.channel.id, {
                        content: "Invalid IP address format! Please use IPv4 format (e.g., 8.8.8.8)"
                    });
                    return;
                }

                // Additional validation for each octet
                const octets = ip.split('.');
                const validOctets = octets.every(octet => {
                    const num = parseInt(octet);
                    return num >= 0 && num <= 255;
                });

                if (!validOctets) {
                    sendBotMessage(ctx.channel.id, {
                        content: "Invalid IP address! Each number must be between 0-255"
                    });
                    return;
                }

                if (settings.store.enableLogging) {
                    console.log("[OSINT] Looking up IP:", ip);
                }

                sendBotMessage(ctx.channel.id, {
                    content: "Looking up IP information..."
                });

                const info = await getIPInfo(ip);

                if (!info) {
                    sendBotMessage(ctx.channel.id, {
                        content: `Failed to retrieve information for **${ip}**\nPossible reasons:\n• Private/local IP address\n• IP-API rate limit exceeded (45 req/min)\n• Network error`
                    });
                    return;
                }

                const embed = createIPEmbed(info);
                sendBotMessage(ctx.channel.id, embed);
            }
        }
    ]
});
