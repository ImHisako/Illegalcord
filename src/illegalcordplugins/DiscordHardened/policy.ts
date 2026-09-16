/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Embed } from "@vencord/discord-types";

export const DEFAULT_EMBED_DOMAINS = "discord.com\ndiscordapp.com\ndiscordapp.net\nyoutube.com\nyoutu.be\nyoutube-nocookie.com\nytimg.com\ngooglevideo.com\ntenor.com\ngiphy.com";

export function parseDomainList(value: string): string[] {
    return value.split(/[\n,]/).map(domain => domain.trim().toLowerCase()).filter(Boolean);
}

export function validateDomainList(value: string): true | string {
    if (value.length > 4096) return "Keep the domain list under 4096 characters.";
    return parseDomainList(value).every(domain => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))
        || "Enter domain names without protocols, paths, ports or wildcards.";
}

export function isAllowedEmbedUrl(value: string, domains: readonly string[]): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password && !url.port
            && domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    } catch {
        return false;
    }
}

export function isAllowedEmbed(embed: Embed, domains: readonly string[]): boolean {
    const urls = [
        embed.url, embed.provider?.url, embed.author?.url, embed.author?.iconURL,
        embed.footer?.iconURL, embed.image?.url, embed.thumbnail?.url, embed.video?.url,
        ...embed.images?.map(image => image.url) ?? [],
    ].filter((url): url is string => Boolean(url));
    return urls.every(url => isAllowedEmbedUrl(url, domains));
}

interface ContentSettings {
    enabled?: boolean;
    blockUnknownEmbeds?: boolean;
    allowedEmbedDomains?: string;
    blockThirdPartyScripts?: boolean;
    minimumPrivilege?: boolean;
    questCompatibility?: boolean;
}

export function addContentPolicy(headers: Record<string, string[]>, settings: ContentSettings | undefined): void {
    if (!settings?.enabled) return;
    const directives: string[] = [];
    const captchaSources = settings.questCompatibility !== false ? " https://hcaptcha.com https://*.hcaptcha.com" : "";
    if (settings.minimumPrivilege !== false) directives.push("object-src 'none'", "base-uri 'self'");
    if (settings.blockUnknownEmbeds !== false) {
        const configured = settings.allowedEmbedDomains ?? DEFAULT_EMBED_DOMAINS;
        const domains = parseDomainList(validateDomainList(configured) === true ? configured : DEFAULT_EMBED_DOMAINS);
        const origins = domains.flatMap(domain => [`https://${domain}`, `https://*.${domain}`]);
        directives.push(`frame-src 'self' https://*.discordsays.com https://*.discordsez.com ${origins.join(" ")}${captchaSources}`);
    }
    if (settings.blockThirdPartyScripts) directives.push(`script-src-elem 'self' 'unsafe-inline' blob:${captchaSources}`);
    if (!directives.length) return;
    const key = Object.keys(headers).find(key => key.toLowerCase() === "content-security-policy") ?? "Content-Security-Policy";
    headers[key] = [...headers[key] ?? [], directives.join("; ")];
}
