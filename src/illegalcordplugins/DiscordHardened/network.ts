/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { escapeRegExp } from "@utils/text";

import type { BlockCategory } from "./session";

const logger = new Logger("DiscordHardened");

export const DEFAULT_FIREWALL_URLS = [
    "https://*/api/v*/science",
    "https://*/api/v*/applications/detectable",
    "https://*/api/v*/auth/location-metadata",
    "https://*/api/v*/premium-marketing",
    "https://*/api/v*/scheduled-maintenances/upcoming.json",
    "https://*/error-reporting-proxy/*",
    "https://www.youtube.com/youtubei/v*/next?*",
    "https://www.youtube.com/s/desktop/*",
    "https://www.youtube.com/youtubei/v*/log_event?*",
].join("\n");

export const DEFAULT_BLOCKED_PATTERNS = ["sentry", "google", "tracking", "stats", "\\.spotify", "pagead", "analytics", "doubleclick"].join("\n");
export const DEFAULT_ALLOWED_PATTERNS = ["videoplayback", "discord-attachments", "googleapis", "search", "api.spotify", "discord.com/assets/sentry."].join("\n");

export interface NetworkSettings {
    questCompatibility?: boolean;
    blockTelemetry: boolean;
    blockSentry: boolean;
    blockTracing: boolean;
    blockTypingIndicator: boolean;
    blockFingerprinting: boolean;
    goofCordFirewall: boolean;
    firewallBlocklist: string;
    firewallBlockedPatterns: string;
    firewallAllowedPatterns: string;
}

const DISCORD_HOSTS = [
    "discord.com",
    "discordapp.com",
    "discordapp.net",
    "discord.gg",
    "discord.media",
] as const;

interface FirewallRules {
    key: string;
    blocklist: RegExp[];
    blocked: RegExp | null;
    allowed: RegExp | null;
}

let firewallRules: FirewallRules | null = null;

function matchesHost(hostname: string, root: string): boolean {
    return hostname === root || hostname.endsWith(`.${root}`);
}

export function isDiscordHost(hostname: string): boolean {
    return DISCORD_HOSTS.some(root => matchesHost(hostname, root));
}

function getLines(value: string): string[] {
    return value.split("\n").map(item => item.trim()).filter(Boolean);
}

function getCombinedRegex(value: string): RegExp | null {
    const patterns = getLines(value);
    return patterns.length ? new RegExp(patterns.map(pattern => `(?:${pattern})`).join("|"), "i") : null;
}

function getFirewallRules(settings: NetworkSettings): FirewallRules | null {
    const key = `${settings.firewallBlocklist}\0${settings.firewallBlockedPatterns}\0${settings.firewallAllowedPatterns}`;
    if (firewallRules?.key === key) return firewallRules;

    try {
        firewallRules = {
            key,
            blocklist: getLines(settings.firewallBlocklist).map(pattern => new RegExp(`^${escapeRegExp(pattern).replaceAll("\\*", ".*")}$`, "i")),
            blocked: getCombinedRegex(settings.firewallBlockedPatterns),
            allowed: getCombinedRegex(settings.firewallAllowedPatterns),
        };
        return firewallRules;
    } catch (error) {
        firewallRules = null;
        logger.warn("Could not compile the GoofCord firewall rules.", error);
        return null;
    }
}

function isBlockedByGoofCord(url: URL, settings: NetworkSettings): boolean {
    if (!settings.goofCordFirewall) return false;

    const rules = getFirewallRules(settings);
    if (!rules) return false;
    if (rules.blocklist.some(pattern => pattern.test(url.href))) return true;
    return Boolean(rules.blocked?.test(url.href) && !rules.allowed?.test(url.href));
}

export function getBlockedRequestKind(url: URL | null, settings: NetworkSettings, noTrackEnabled: boolean): BlockCategory | null {
    if (!url) return null;

    const { pathname } = url;

    if (isBlockedByGoofCord(url, settings)) return "GoofCord firewall";

    if (isDiscordHost(url.hostname)) {
        if (settings.blockTracing && pathname.endsWith("/tracing")) return "tracing";

        if (!noTrackEnabled && settings.blockTelemetry && (
            pathname.endsWith("/science") ||
            pathname.endsWith("/track")
        )) return "telemetry";

        if (settings.blockTypingIndicator && pathname.endsWith("/typing")) return "typing indicator";
    }

    if (!noTrackEnabled && settings.blockSentry && (
        matchesHost(url.hostname, "sentry.io") ||
        (/\/assets\/sentry\..+\.js$/).test(pathname)
    )) return "Sentry";

    if (settings.blockFingerprinting && !(settings.questCompatibility !== false && matchesHost(url.hostname, "hcaptcha.com")) && (
        pathname.startsWith("/cdn-cgi/") ||
        pathname.endsWith("/api.js")
    )) return "fingerprinting";

    return null;
}
