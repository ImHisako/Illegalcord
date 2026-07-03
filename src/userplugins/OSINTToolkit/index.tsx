/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Margins } from "@components/margins";
import { Notice } from "@components/Notice";
import { copyWithToast } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { parseUrl } from "@utils/misc";
import { formatDuration, makeCodeblock } from "@utils/text";
import definePlugin, { OptionType } from "@utils/types";
import type { CommandArgument, CommandContext, User } from "@vencord/discord-types";
import { IconUtils, Menu } from "@webpack/common";

interface DomainInfo {
    domain: string;
    registrar?: string;
    registrationDate?: string;
    expirationDate?: string;
    updatedAt?: string;
    status: string[];
    nameServers: string[];
    dnssec: "Signed" | "Unsigned" | "Unknown";
}

interface IPInfo {
    ip: string;
    city?: string;
    region?: string;
    countryCode?: string;
    countryName?: string;
    lat?: number;
    lon?: number;
    org?: string;
    isp?: string;
    timezone?: string;
    zip?: string;
}

interface MessageContextProps {
    message?: {
        author?: User;
    };
}

const REQUEST_TIMEOUT_MS = 12_000;
const logger = new Logger("OSINTToolkit");
const activeRequests = new Set<AbortController>();
let pluginActive = true;

const OSINT_TOOLS = [
    { id: "see-know", name: "See-Know", url: "https://see-know.eu/", description: "Searches public web signals." },
    { id: "epieos", name: "Epieos", url: "https://epieos.com/", description: "Checks public email and phone traces." },
    { id: "osintx", name: "Osintx_", url: "https://www.osintx.io/", description: "Collects OSINT links and workflows." },
    { id: "socialeye", name: "SocialEye", url: "https://socialeye.net/", description: "Searches usernames across public sites." },
    { id: "cloudsint", name: "Cloudsint", url: "https://cloudsint.net/", description: "Checks cloud storage exposure." },
    { id: "proximity", name: "Proximity OSINT", url: "https://www.proximityosint.com/", description: "Provides OSINT workflows and resources." },
    { id: "deadeye", name: "DeadEye", url: "https://deadeye.cc/", description: "Searches public profile signals." },
    { id: "indicia", name: "Indicia", url: "https://indicia.app/", description: "Enriches public indicators." },
    { id: "tempemail", name: "Snapmail", url: "https://www.snapmail.in/", description: "Creates temporary email inboxes." }
] as const;

const OSINT_RESOURCES = [
    { id: "pikaosint", name: "PikaOSINT", url: "https://pikaosint.pages.dev/", description: "Curated OSINT tools collection." },
    { id: "osintframework", name: "OSINT Framework", url: "https://osintframework.com/", description: "Categorized OSINT resource index." },
    { id: "photo-osint", name: "Photo OSINT", url: "https://start.me/p/0PgzqO/photo-osint", description: "Photo investigation resource board." }
] as const;

const settings = definePluginSettings({
    enableLogging: {
        type: OptionType.BOOLEAN,
        description: "Log lookup details while debugging.",
        default: false
    }
});

function OSINTToolkitSettingsAbout() {
    return (
        <Notice.Warning className={Margins.bottom8}>
            <p>Commands: /domain, /iplookup, /myip and /usersearch.</p>
            <p>Right click a message to copy author identifiers, open username searches and browse OSINT resource lists.</p>
        </Notice.Warning>
    );
}

const SafeOSINTToolkitSettingsAbout = ErrorBoundary.wrap(OSINTToolkitSettingsAbout, { noop: true });

function debug(...args: unknown[]) {
    if (settings.store.enableLogging) logger.debug(...args);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    if (typeof value !== "string") return undefined;

    const trimmed = value.trim();
    return trimmed || undefined;
}

function getNumber(record: Record<string, unknown>, key: string): number | undefined {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return undefined;

    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function getStringArray(record: Record<string, unknown>, key: string): string[] {
    const value = record[key];
    if (!Array.isArray(value)) return [];

    return value.flatMap(item => {
        if (typeof item !== "string") return [];

        const trimmed = item.trim();
        return trimmed ? [trimmed] : [];
    });
}

function firstString(value: unknown): string | undefined {
    if (!Array.isArray(value)) return undefined;

    for (const item of value) {
        if (typeof item === "string" && item.trim()) return item.trim();
    }
}

function normalizeDomain(input: string): string {
    const trimmed = input.trim();
    const parsed = parseUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = parsed?.hostname ?? trimmed;

    return host
        .toLowerCase()
        .replace(/^www\./, "")
        .replace(/\.$/, "");
}

function isValidDomain(domain: string): boolean {
    if (domain.length > 253) return false;

    const labels = domain.split(".");
    if (labels.length < 2) return false;

    return labels.every(label =>
        label.length >= 1
        && label.length <= 63
        && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    );
}

function parseIPv4(ip: string): number[] | undefined {
    const parts = ip.split(".");
    if (parts.length !== 4) return undefined;

    const octets = parts.map(part => {
        if (!/^\d{1,3}$/.test(part)) return Number.NaN;

        return Number(part);
    });

    return octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255)
        ? octets
        : undefined;
}

function isPublicIPv4(ip: string): boolean {
    const octets = parseIPv4(ip);
    if (!octets) return false;

    const [first, second, third, fourth] = octets;

    return !(
        first === 0
        || first === 10
        || first === 127
        || first >= 224
        || (first === 100 && second >= 64 && second <= 127)
        || (first === 169 && second === 254)
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168)
        || (first === 198 && (second === 18 || second === 19))
        || (first === 255 && second === 255 && third === 255 && fourth === 255)
    );
}

function normalizeUsername(input: string): string {
    return input.trim().replace(/^@+/, "");
}

async function fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    activeRequests.add(controller);

    try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }

        return await response.json() as unknown;
    } finally {
        clearTimeout(timeout);
        activeRequests.delete(controller);
    }
}

function getRegistrar(entities: unknown): string | undefined {
    if (!Array.isArray(entities)) return undefined;

    for (const entity of entities) {
        if (!isRecord(entity) || !Array.isArray(entity.roles) || !entity.roles.includes("registrar")) continue;

        const vcardRows = Array.isArray(entity.vcardArray) ? entity.vcardArray[1] : undefined;
        if (!Array.isArray(vcardRows)) continue;

        for (const row of vcardRows) {
            if (Array.isArray(row) && row[0] === "fn" && typeof row[3] === "string" && row[3].trim()) {
                return row[3].trim();
            }
        }
    }
}

function getEventDate(events: unknown, actions: string[]): string | undefined {
    if (!Array.isArray(events)) return undefined;

    for (const event of events) {
        if (!isRecord(event)) continue;

        const action = getString(event, "eventAction");
        if (action && actions.includes(action)) return getString(event, "eventDate");
    }
}

function getNameServers(nameServers: unknown): string[] {
    if (!Array.isArray(nameServers)) return [];

    return nameServers.flatMap(nameServer => {
        if (!isRecord(nameServer)) return [];

        const name = getString(nameServer, "ldhName");
        return name ? [name] : [];
    });
}

async function getDomainInfo(domain: string): Promise<DomainInfo | undefined> {
    const data = await fetchJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
    if (!isRecord(data)) return undefined;

    const { secureDNS } = data;
    const dnssec = isRecord(secureDNS)
        ? secureDNS.delegationSigned === true ? "Signed" : "Unsigned"
        : "Unknown";

    return {
        domain: getString(data, "ldhName") ?? domain,
        registrar: getRegistrar(data.entities),
        registrationDate: getEventDate(data.events, ["registration", "registered"]),
        expirationDate: getEventDate(data.events, ["expiration", "expire"]),
        updatedAt: getEventDate(data.events, ["last changed", "last update of RDAP database"]),
        status: getStringArray(data, "status"),
        nameServers: getNameServers(data.nameservers),
        dnssec
    };
}

function getTimezone(data: Record<string, unknown>): string | undefined {
    return firstString(data.timeZones) ?? getString(data, "timeZone") ?? getString(data, "timezone");
}

async function getIPInfo(ip?: string): Promise<IPInfo | undefined> {
    const data = await fetchJson(`https://free.freeipapi.com/api/json${ip ? `/${encodeURIComponent(ip)}` : ""}`);
    if (!isRecord(data)) return undefined;

    const resolvedIp = getString(data, "ipAddress") ?? getString(data, "ip") ?? ip;
    if (!resolvedIp) return undefined;

    return {
        ip: resolvedIp,
        city: getString(data, "cityName") ?? getString(data, "city"),
        region: getString(data, "regionName") ?? getString(data, "region"),
        countryCode: getString(data, "countryCode"),
        countryName: getString(data, "countryName") ?? getString(data, "country"),
        lat: getNumber(data, "latitude"),
        lon: getNumber(data, "longitude"),
        org: getString(data, "organization") ?? getString(data, "asnOrganization") ?? getString(data, "org"),
        isp: getString(data, "isp") ?? getString(data, "asnOrganization"),
        timezone: getTimezone(data),
        zip: getString(data, "zipCode") ?? getString(data, "zip")
    };
}

function calculateDomainAge(registrationDate: string): string {
    const timestamp = Date.parse(registrationDate);
    if (Number.isNaN(timestamp)) return "Unknown";

    const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
    return formatDuration(days, "days", true);
}

function formatDate(value?: string): string {
    if (!value) return "N/A";

    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? value : new Date(timestamp).toLocaleString();
}

function formatLimited(values: string[], limit = 4): string {
    if (!values.length) return "N/A";
    if (values.length <= limit) return values.join(", ");

    return `${values.slice(0, limit).join(", ")} and ${values.length - limit} more`;
}

function createDomainMessage(info: DomainInfo): string {
    const ageText = info.registrationDate ? calculateDomainAge(info.registrationDate) : "Unknown";

    return makeCodeblock([
        `[DOMAIN LOOKUP] ${info.domain}`,
        `Registration : ${formatDate(info.registrationDate)}`,
        `Age          : ${ageText}`,
        `Expiration   : ${formatDate(info.expirationDate)}`,
        `Registrar    : ${info.registrar ?? "Unknown"}`,
        `Updated      : ${formatDate(info.updatedAt)}`,
        `DNSSEC       : ${info.dnssec}`,
        `Status       : ${formatLimited(info.status)}`,
        `Name servers : ${formatLimited(info.nameServers)}`
    ].join("\n"), "txt");
}

function createIPMessage(info: IPInfo): string {
    const coordinates =
        typeof info.lat === "number" && typeof info.lon === "number"
            ? `${info.lat}, ${info.lon}`
            : "Unknown";
    const country = info.countryName
        ? info.countryCode ? `${info.countryName} (${info.countryCode})` : info.countryName
        : "Unknown";

    return makeCodeblock([
        `[IP LOOKUP] ${info.ip}`,
        `City         : ${info.city ?? "Unknown"}`,
        `Region       : ${info.region ?? "Unknown"}`,
        `Country      : ${country}`,
        `Timezone     : ${info.timezone ?? "Unknown"}`,
        `ZIP Code     : ${info.zip ?? "Unknown"}`,
        `ISP          : ${info.isp ?? "Unknown"}`,
        `Organization : ${info.org ?? "Unknown"}`,
        `Coordinates  : ${coordinates}`
    ].join("\n"), "txt");
}

function getUsernameSearchUrls(username: string) {
    const encoded = encodeURIComponent(username);

    return {
        userSearch: `https://usersearch.org/results.php?type=standard&URL_username=${encoded}`,
        whatsMyName: `https://whatsmyname.app/?q=${encoded}`
    };
}

function createUserSearchMessage(username: string): string {
    const urls = getUsernameSearchUrls(username);

    return makeCodeblock([
        `[USER SEARCH] ${username}`,
        `UserSearch  : ${urls.userSearch}`,
        `WhatsMyName : ${urls.whatsMyName}`
    ].join("\n"), "txt");
}

function getDiscordUserUrl(user: User): string {
    return `https://discord.com/users/${encodeURIComponent(user.id)}`;
}

function getAvatarSearchUrl(avatarUrl: string): string {
    return `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(avatarUrl)}`;
}

function openExternal(url: string) {
    VencordNative.native.openExternal(url);
}

function abortActiveRequests() {
    activeRequests.forEach(controller => controller.abort());
    activeRequests.clear();
}

const messageContextMenuPatch: NavContextMenuPatchCallback = (children, { message }: MessageContextProps) => {
    const author = message?.author;
    if (!author || children.find(child => child?.props?.id === "vc-osint-toolkit-group")) return;

    const username = normalizeUsername(author.username);
    const urls = getUsernameSearchUrls(username);
    const avatarUrl = IconUtils.getUserAvatarURL(author, true, 512);

    children.push(
        <Menu.MenuGroup id="vc-osint-toolkit-group">
            <Menu.MenuItem id="vc-osint-toolkit" label="OSINT Toolkit">
                <Menu.MenuItem id="vc-osint-author" label="Message Author">
                    <Menu.MenuItem
                        id="vc-osint-copy-user-id"
                        label="Copy User ID"
                        action={() => void copyWithToast(author.id, "User ID copied.")}
                    />
                    <Menu.MenuItem
                        id="vc-osint-copy-user-url"
                        label="Copy User URL"
                        action={() => void copyWithToast(getDiscordUserUrl(author), "User URL copied.")}
                    />
                    <Menu.MenuItem
                        id="vc-osint-open-user-url"
                        label="Open User URL"
                        action={() => openExternal(getDiscordUserUrl(author))}
                    />
                    <Menu.MenuItem
                        id="vc-osint-search-usersearch"
                        label="Search with UserSearch"
                        action={() => openExternal(urls.userSearch)}
                    />
                    <Menu.MenuItem
                        id="vc-osint-search-whatsmyname"
                        label="Search with WhatsMyName"
                        action={() => openExternal(urls.whatsMyName)}
                    />
                    {avatarUrl
                        ? (
                            <Menu.MenuItem
                                id="vc-osint-search-avatar"
                                label="Reverse Search Avatar"
                                action={() => openExternal(getAvatarSearchUrl(avatarUrl))}
                            />
                        )
                        : null}
                </Menu.MenuItem>
                <Menu.MenuItem id="vc-osint-lookup-tools" label="Lookup Tools">
                    {OSINT_TOOLS.map(tool => (
                        <Menu.MenuItem
                            key={`vc-osint-tool-${tool.id}`}
                            id={`vc-osint-tool-${tool.id}`}
                            label={tool.name}
                            hint={tool.description}
                            action={() => openExternal(tool.url)}
                        />
                    ))}
                </Menu.MenuItem>
                <Menu.MenuItem id="vc-osint-resource-lists" label="Resource Lists">
                    {OSINT_RESOURCES.map(resource => (
                        <Menu.MenuItem
                            key={`vc-osint-resource-${resource.id}`}
                            id={`vc-osint-resource-${resource.id}`}
                            label={resource.name}
                            hint={resource.description}
                            action={() => openExternal(resource.url)}
                        />
                    ))}
                </Menu.MenuItem>
            </Menu.MenuItem>
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "OSINTToolkit",
    description: "Adds OSINT commands and quick lookup links for public domain, IP and username checks.",
    tags: ["Utility", "Privacy"],
    authors: [{ name: "irritably", id: 928787166916640838n }],
    settings,
    settingsAboutComponent: SafeOSINTToolkitSettingsAbout,

    contextMenus: {
        message: messageContextMenuPatch
    },

    start() {
        pluginActive = true;
        activeRequests.clear();
    },

    commands: [
        {
            name: "domain",
            description: "Looks up public RDAP registration information for a domain.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "domain",
                    description: "Domain to look up, like example.com.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const domainInput = findOption<string>(args, "domain", "");
                const domain = normalizeDomain(domainInput);

                if (!isValidDomain(domain)) {
                    sendBotMessage(ctx.channel.id, { content: "Invalid domain. Use a root domain like example.com." });
                    return;
                }

                debug("Looking up domain", domain);

                try {
                    const info = await getDomainInfo(domain);
                    if (!pluginActive) return;

                    if (!info) {
                        sendBotMessage(ctx.channel.id, { content: `Could not retrieve public RDAP information for **${domain}**.` });
                        return;
                    }

                    sendBotMessage(ctx.channel.id, { content: createDomainMessage(info) });
                } catch (error) {
                    debug("Domain lookup failed", error);
                    sendBotMessage(ctx.channel.id, { content: `Could not complete the domain lookup for **${domain}**.` });
                }
            }
        },
        {
            name: "iplookup",
            description: "Looks up public geolocation and network information for an IPv4 address.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "ip",
                    description: "Public IPv4 address to look up.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const ip = findOption<string>(args, "ip", "").trim();

                if (!isPublicIPv4(ip)) {
                    sendBotMessage(ctx.channel.id, { content: "Invalid public IPv4 address. Use an address like 8.8.8.8." });
                    return;
                }

                debug("Looking up IP", ip);

                try {
                    const info = await getIPInfo(ip);
                    if (!pluginActive) return;

                    if (!info) {
                        sendBotMessage(ctx.channel.id, { content: `Could not retrieve public IP information for **${ip}**.` });
                        return;
                    }

                    sendBotMessage(ctx.channel.id, { content: createIPMessage(info) });
                } catch (error) {
                    debug("IP lookup failed", error);
                    sendBotMessage(ctx.channel.id, { content: `Could not complete the IP lookup for **${ip}**.` });
                }
            }
        },
        {
            name: "myip",
            description: "Shows your public IP address and approximate geolocation.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_args: CommandArgument[], ctx: CommandContext) => {
                try {
                    const info = await getIPInfo();
                    if (!pluginActive) return;

                    if (!info) {
                        sendBotMessage(ctx.channel.id, { content: "Could not retrieve your public IP information." });
                        return;
                    }

                    sendBotMessage(ctx.channel.id, { content: createIPMessage(info) });
                } catch (error) {
                    debug("My IP lookup failed", error);
                    sendBotMessage(ctx.channel.id, { content: "Could not complete your public IP lookup." });
                }
            }
        },
        {
            name: "usersearch",
            description: "Generates public username search links.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "username",
                    description: "Username to search.",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            execute: async (args: CommandArgument[], ctx: CommandContext) => {
                const username = normalizeUsername(findOption<string>(args, "username", ""));

                if (!username) {
                    sendBotMessage(ctx.channel.id, { content: "Invalid username." });
                    return;
                }

                debug("Generating username search links", username);
                sendBotMessage(ctx.channel.id, { content: createUserSearchMessage(username) });
            }
        }
    ],

    stop() {
        pluginActive = false;
        abortActiveRequests();
    }
});
