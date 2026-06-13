/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";

const logger = new Logger("ScamLinkDetector", "#ff4444");

const SCAM_LIST_URL = "https://raw.githubusercontent.com/Discord-AntiScam/scam-links/main/list.txt";

let scamLinks: Set<string> = new Set();
let lastFetchTime = 0;
let fetchPromise: Promise<void> | null = null;
const CACHE_DURATION = 15 * 60 * 1000;

interface IMessageCreate {
    type: "MESSAGE_CREATE";
    optimistic: boolean;
    channelId: string;
    message: Message;
}

const urlRegex = /(?:https?:\/\/)?(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&//=]*)/gi;

const settings = definePluginSettings({
    enableDebugLogs: {
        type: OptionType.BOOLEAN,
        description: "Enable detailed debug logging in console",
        default: false
    },
    blockMessage: {
        type: OptionType.BOOLEAN,
        description: "Delete the message containing scam links",
        default: false
    },
    notifyInDMs: {
        type: OptionType.BOOLEAN,
        description: "Send warning notification in DMs instead of channel",
        default: false
    }
});

async function fetchScamList(): Promise<void> {
    const now = Date.now();
    if (now - lastFetchTime < CACHE_DURATION && scamLinks.size > 0) {
        return;
    }

    if (fetchPromise) {
        if (settings.store.enableDebugLogs) {
            logger.debug("Fetch already in progress, waiting...");
        }
        await fetchPromise;
        return;
    }

    fetchPromise = (async () => {
        try {
            logger.info("Fetching scam link database...");
            const response = await fetch(SCAM_LIST_URL);

            if (!response.ok) {
                logger.error(`Failed to fetch scam list: ${response.status} ${response.statusText}`);
                return;
            }

            const text = await response.text();
            const lines = text.split("\n")
                .map(line => line.trim().toLowerCase())
                .filter(line => line && !line.startsWith("#"));

            scamLinks = new Set(lines);
            lastFetchTime = now;

            logger.info(`Successfully loaded ${scamLinks.size} scam domains from AntiScam database`);
        } catch (error) {
            logger.error("Error fetching scam list:", error);
        } finally {
            fetchPromise = null;
        }
    })();

    await fetchPromise;
}

function extractDomains(content: string): string[] {
    const urls = content.match(urlRegex) || [];
    const domains: string[] = [];

    if (settings.store.enableDebugLogs) {
        logger.debug(`Found ${urls.length} URL(s) in message:`, urls);
    }

    for (const url of urls) {
        try {
            let cleanedUrl = url.replace(/[)>.,;:!?'"]+$/, "");

            // Add protocol if missing for URL parsing
            if (!cleanedUrl.startsWith("http://") && !cleanedUrl.startsWith("https://")) {
                cleanedUrl = "https://" + cleanedUrl;
            }

            const hostname = new URL(cleanedUrl).hostname.toLowerCase();

            // Remove www. prefix if present
            const domain = hostname.replace(/^www\./, "");

            domains.push(domain);
            if (settings.store.enableDebugLogs) {
                logger.debug(`Extracted domain: ${domain} from ${url}`);
            }
        } catch (error) {
            if (settings.store.enableDebugLogs) {
                logger.debug(`Failed to parse URL: ${url}`, error);
            }
            continue;
        }
    }

    return domains;
}

function checkForScamLinks(content: string): string[] {
    if (!content) {
        if (settings.store.enableDebugLogs) {
            logger.debug("Message has no content, skipping");
        }
        return [];
    }

    if (scamLinks.size === 0) {
        if (settings.store.enableDebugLogs) {
            logger.debug("Scam list is empty, skipping check");
        }
        return [];
    }

    const domains = extractDomains(content);

    if (domains.length === 0) {
        if (settings.store.enableDebugLogs) {
            logger.debug("No domains extracted from message");
        }
        return [];
    }

    const detectedScams: string[] = [];

    for (const domain of domains) {
        if (scamLinks.has(domain)) {
            detectedScams.push(domain);
            logger.warn(`MATCH FOUND: ${domain} is in the scam database!`);
        } else {
            if (settings.store.enableDebugLogs) {
                logger.debug(`✓ ${domain} is not in scam database`);
            }
        }
    }

    return detectedScams;
}

export default definePlugin({
    name: "ScamLinkDetector",
    description: "Detects and warns about scam links using the Discord AntiScam database",
    tags: ["Privacy", "Chat"],
    authors: [{ name: "irritably", id: 928787166916640838n }],
    settings,

    flux: {
        async MESSAGE_CREATE({ optimistic, type, message, channelId }: IMessageCreate) {
            if (optimistic || type !== "MESSAGE_CREATE") return;
            if (message.state === "SENDING") return;
            if (!message.content) return;
            if (message.author?.bot) return;

            if (scamLinks.size === 0) {
                if (settings.store.enableDebugLogs) {
                    logger.debug("Scam list not loaded yet, skipping check");
                }
                return;
            }

            if (settings.store.enableDebugLogs) {
                logger.debug(`Processing message from ${message.author.username}#${message.author.discriminator} in channel ${channelId}`);
            }

            const scamDomains = checkForScamLinks(message.content);

            if (scamDomains.length === 0) {
                return;
            }

            logger.warn(`🚨 SCAM LINKS DETECTED! Found ${scamDomains.length} scam domain(s): ${scamDomains.join(", ")}`);
            logger.warn(`Author: ${message.author.username}#${message.author.discriminator} (${message.author.id})`);
            logger.warn(`Channel: ${channelId}`);

            const domainList = scamDomains.map(d => `\`${d}\``).join(", ");
            const warningMessage = `⚠️ **Scam Link Detected**\n\nThis message from **${message.author.username}** contains known scam/malicious links:\n${domainList}\n\nThese domains are flagged in the Discord AntiScam database. Do not click them!`;

            if (settings.store.blockMessage) {
                try {
                    logger.info(`Attempting to delete scam message ${message.id}...`);
                    await fetch(`/api/v9/channels/${channelId}/messages/${message.id}`, {
                        method: "DELETE"
                    });
                    logger.info(`Successfully deleted scam message ${message.id}`);
                } catch (error) {
                    logger.error("Failed to delete scam message:", error);
                }
            }

            sendBotMessage(channelId, {
                content: warningMessage
            });
        }
    },

    async start() {
        await fetchScamList();
    }
});
