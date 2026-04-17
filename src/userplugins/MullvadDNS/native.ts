/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Resolver } from "dns";

// Mullvad DNS servers
const MULLVAD_DNS_PRIMARY = "194.242.2.4";
const MULLVAD_DNS_SECONDARY = "194.242.2.5";

// DNS resolver cache
const resolverCache = new Map<string, Resolver>();

function getResolver(server: string): Resolver {
    if (!resolverCache.has(server)) {
        const resolver = new Resolver();
        resolver.setServers([server]);
        resolverCache.set(server, resolver);
    }
    return resolverCache.get(server)!;
}

export async function resolveDNS(_event: Electron.IpcMainInvokeEvent, hostname: string, server?: string) {
    try {
        const dnsServer = server || MULLVAD_DNS_PRIMARY;
        const resolver = getResolver(dnsServer);

        const addresses = await new Promise<string[]>((resolve, reject) => {
            resolver.resolve4(hostname, (err, addresses) => {
                if (err) reject(err);
                else resolve(addresses || []);
            });
        });

        return {
            success: true,
            hostname,
            server: dnsServer,
            addresses
        };
    } catch (error) {
        return {
            success: false,
            hostname,
            error: error instanceof Error ? error.message : "Unknown error",
            addresses: []
        };
    }
}

export async function preloadDNS(_event: Electron.IpcMainInvokeEvent) {
    const domains = [
        "discord.com",
        "gateway.discord.gg",
        "media.discordapp.net",
        "cdn.discordapp.com",
        "status.discord.com",
        "ptb.discord.com",
        "canary.discord.com",
        "discordapp.net"
    ];

    const results: Record<string, string[]> = {};

    for (const domain of domains) {
        try {
            const resolver = getResolver(MULLVAD_DNS_PRIMARY);
            const addresses = await new Promise<string[]>((resolve, reject) => {
                resolver.resolve4(domain, (err, addresses) => {
                    if (err) reject(err);
                    else resolve(addresses || []);
                });
            });

            if (addresses.length > 0) {
                results[domain] = addresses;
            }
        } catch (error) {
            // Skip failed resolutions
        }
    }

    return results;
}
