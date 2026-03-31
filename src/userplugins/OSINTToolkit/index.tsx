/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { sendBotMessage } from "@api/Commands";
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
        default: true
    }
});

function logDebug(...args: any[]) {
    if (settings.store.enableLogging) {
        console.log("[OSINT]", ...args);
    }
}

function normalizeDomain(input: string): string {
    return input
        .toLowerCase()
        .trim()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/.*$/, "")
        .replace(/\.$/, "");
}

async function getDomainInfo(domain: string): Promise<DomainInfo | null> {
    try {
        const response = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`);

        if (!response.ok) {
            throw new Error(`RDAP lookup failed with status ${response.status}`);
        }

        const data = await response.json();

        let registrar = "Unknown";
        if (Array.isArray(data.entities)) {
            const registrarEntity = data.entities.find((e: any) =>
                Array.isArray(e.roles) && e.roles.includes("registrar")
            );

            if (registrarEntity?.vcardArray?.[1]) {
                const fn = registrarEntity.vcardArray[1].find((p: any) => p[0] === "fn");
                if (fn?.[3]) registrar = fn[3];
            }
        }

        return {
            domain: data.ldhName || domain,
            registrar,
            registrationDate:
                data.events?.find((e: any) => e.eventAction === "registration")?.eventDate ??
                data.events?.find((e: any) => e.eventAction === "registered")?.eventDate,
            expirationDate:
                data.events?.find((e: any) => e.eventAction === "expiration")?.eventDate ??
                data.events?.find((e: any) => e.eventAction === "expire")?.eventDate,
            updatedAt:
                data.events?.find((e: any) => e.eventAction === "last changed")?.eventDate ??
                data.events?.find((e: any) => e.eventAction === "last update of RDAP database")?.eventDate,
            status: Array.isArray(data.status) ? data.status : [],
            nameServers: Array.isArray(data.nameservers)
                ? data.nameservers.map((ns: any) => ns.ldhName).filter(Boolean)
                : [],
            dnssec: data.secureDNS?.delegationSigned ? "signed" : "unsigned"
        };
    } catch (error) {
        console.error("Domain lookup error:", error);
        return null;
    }
}

async function getIPInfo(ip: string): Promise<IPInfo | null> {
    try {
        const url = `https://free.freeipapi.com/api/json/${encodeURIComponent(ip)}`;
        logDebug("Fetching IP URL:", url);

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`IP lookup failed with status ${response.status}`);
        }

        const data = await response.json();
        logDebug("IP API response:", data);

        const timezone =
            Array.isArray(data.timeZones) && data.timeZones.length > 0
                ? data.timeZones[0]
                : data.timeZone || data.timezone;

        const info: IPInfo = {
            ip: data.ipAddress || data.ip || ip,
            city: data.cityName || data.city,
            region: data.regionName || data.region,
            country: data.countryCode || data.country,
            countryName: data.countryName || data.country,
            lat: typeof data.latitude === "number" ? data.latitude : undefined,
            lon: typeof data.longitude === "number" ? data.longitude : undefined,
            org: data.organization || data.org,
            isp: data.isp,
            timezone,
            zip: data.zipCode || data.zip
        };

        logDebug("Parsed IP info:", info);
        return info;
    } catch (error) {
        console.error("IP lookup error:", error);
        return null;
    }
}

function calculateDomainAge(registrationDate: string): string {
    const now = new Date();
    const regDate = new Date(registrationDate);

    if (Number.isNaN(regDate.getTime())) return "Unknown";

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
            color: 0x5865F2,
            fields: [
                { name: "📅 Registration Date", value: info.registrationDate || "N/A", inline: true },
                { name: "⏰ Domain Age", value: ageText, inline: true },
                { name: "🗓️ Expiration Date", value: info.expirationDate || "N/A", inline: true },
                { name: "🏢 Registrar", value: info.registrar || "Unknown", inline: false },
                { name: "🔄 Last Updated", value: info.updatedAt || "N/A", inline: true },
                { name: "🔒 DNSSEC", value: info.dnssec || "N/A", inline: true },
                { name: "📊 Status", value: info.status?.length ? info.status.join(", ") : "N/A", inline: false }
            ],
            footer: {
                text: "OSINT • Domain Lookup"
            },
            timestamp: new Date().toISOString()
        }] as any
    };
}

function createIPEmbed(info: IPInfo) {
    const hasCoords = typeof info.lat === "number" && typeof info.lon === "number";
    const mapUrl = hasCoords ? `https://www.google.com/maps?q=${info.lat},${info.lon}` : null;

    return {
        content: "",
        embeds: [{
            title: `🌐 IP Information: ${info.ip}`,
            color: 0x57F287,
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
                    value: hasCoords && mapUrl ? `[${info.lat}, ${info.lon}](${mapUrl})` : "Unknown",
                    inline: false
                }
            ],
            footer: {
                text: "OSINT • IP Lookup"
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
            description: "Get domain registration information and age",
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
                    sendBotMessage(ctx.channel.id, { content: "Please provide a domain name!" });
                    return;
                }

                const domain = normalizeDomain(domainInput);
                logDebug("Looking up domain:", domain);

                sendBotMessage(ctx.channel.id, {
                    content: "Looking up domain information..."
                });

                const info = await getDomainInfo(domain);

                if (!info) {
                    sendBotMessage(ctx.channel.id, {
                        content: `Failed to retrieve information for **${domain}**`
                    });
                    return;
                }

                sendBotMessage(ctx.channel.id, createDomainEmbed(info));
            }
        },
        {
            name: "iplookup",
            description: "Get geolocation and network information for an IP",
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
                try {
                    const ipInput = args[0]?.value as string;

                    if (!ipInput) {
                        sendBotMessage(ctx.channel.id, { content: "Please provide an IP address!" });
                        return;
                    }

                    const ip = ipInput.trim();

                    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
                    if (!ipRegex.test(ip)) {
                        sendBotMessage(ctx.channel.id, {
                            content: "Invalid IP address format! Please use IPv4 format (e.g., 8.8.8.8)"
                        });
                        return;
                    }

                    const octets = ip.split(".");
                    const validOctets = octets.every(octet => {
                        const num = Number(octet);
                        return Number.isInteger(num) && num >= 0 && num <= 255;
                    });

                    if (!validOctets) {
                        sendBotMessage(ctx.channel.id, {
                            content: "Invalid IP address! Each number must be between 0-255"
                        });
                        return;
                    }

                    logDebug("Looking up IP:", ip);

                    sendBotMessage(ctx.channel.id, {
                        content: "Looking up IP information..."
                    });

                    const info = await getIPInfo(ip);

                    if (!info) {
                        sendBotMessage(ctx.channel.id, {
                            content: `Failed to retrieve information for **${ip}**\nPossible reasons:\n• Provider unavailable\n• Network/CORS error\n• Invalid API response`
                        });
                        return;
                    }

                    const embed = createIPEmbed(info);
                    logDebug("Sending embed:", embed);

                    sendBotMessage(ctx.channel.id, embed);
                } catch (error) {
                    console.error("IP command error:", error);
                    sendBotMessage(ctx.channel.id, {
                        content: `Unexpected error while looking up IP.`
                    });
                }
            }
        }
    ]
});
