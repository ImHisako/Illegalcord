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

export interface RequestRuleSettings {
    blockedRequestUrls?: string;
    allowedRequestUrls?: string;
}

export type RequestRuleDecision = "Block" | "Allow" | null;

export interface NetworkSettings extends RequestRuleSettings {
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
let requestRules: { blocked: string; allowed: string; blocklist: Set<string>; allowlist: Set<string>; } | undefined;

export function getRequestRuleTarget(value: string | URL): string | null {
    let url: URL;
    try {
        url = typeof value === "string" ? new URL(value) : value;
    } catch {
        return null;
    }
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password
        || /\[redacted\]|%5bredacted%5d/i.test(url.pathname)) return null;
    const target = `${url.origin}${url.pathname}`;
    return target.length < 2048 ? target : null;
}

export function validateRequestRuleList(value: string): true | string {
    const lines = value.split("\n").map((line: string) => line.trim()).filter(Boolean);
    if (value.length > 65_536 || lines.length > 200) return "Keep each request rule list within 200 URLs and 65536 characters.";
    return lines.every((line: string) => !/[?#*]/.test(line) && getRequestRuleTarget(line) !== null)
        || "Enter complete HTTP, HTTPS, WS or WSS URLs without queries, fragments, credentials or wildcards.";
}

export function getRequestRuleDecision(url: string | URL, settings: RequestRuleSettings): RequestRuleDecision {
    const blocked = typeof settings.blockedRequestUrls === "string" && settings.blockedRequestUrls.length <= 65_536 ? settings.blockedRequestUrls : "";
    const allowed = typeof settings.allowedRequestUrls === "string" && settings.allowedRequestUrls.length <= 65_536 ? settings.allowedRequestUrls : "";
    if (!blocked && !allowed) return null;
    const target = getRequestRuleTarget(url);
    if (!target) return null;
    if (!requestRules || requestRules.blocked !== blocked || requestRules.allowed !== allowed) {
        requestRules = {
            blocked, allowed,
            blocklist: new Set(blocked.split("\n").filter((line: string) => line.trim()).slice(0, 200).map((line: string) => getRequestRuleTarget(line.trim())).filter((value: string | null): value is string => value !== null)),
            allowlist: new Set(allowed.split("\n").filter((line: string) => line.trim()).slice(0, 200).map((line: string) => getRequestRuleTarget(line.trim())).filter((value: string | null): value is string => value !== null)),
        };
    }
    if (requestRules.allowlist.has(target)) return "Allow";
    return requestRules.blocklist.has(target) ? "Block" : null;
}

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
    const decision = getRequestRuleDecision(url, settings);
    if (decision === "Allow") return null;
    if (decision === "Block") return "Request rule";

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
