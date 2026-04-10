/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { RelationshipStore, SelectedChannelStore } from "@webpack/common";

const logger = new Logger("ScamLinkDetector", "#ff4444");

const SCAM_LIST_URL = "https://raw.githubusercontent.com/Discord-AntiScam/scam-links/main/list.txt";

let scamLinks: Set<string> = new Set();
let lastFetchTime = 0;
const CACHE_DURATION = 15 * 60 * 1000;

interface IMessageCreate {
    type: "MESSAGE_CREATE";
    optimistic: boolean;
    channelId: string;
    message: Message;
}

const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

const settings = definePluginSettings({
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

        logger.info(`Loaded ${scamLinks.size} scam domains`);
    } catch (error) {
        logger.error("Error fetching scam list:", error);
    }
}

function extractDomains(content: string): string[] {
    const urls = content.match(urlRegex) || [];
    const domains: string[] = [];

    for (const url of urls) {
        try {
            const cleanedUrl = url.replace(/[)>.,;:!?'"]+$/, "");
            const hostname = new URL(cleanedUrl).hostname.toLowerCase();
            domains.push(hostname);
        } catch {
            continue;
        }
    }

    return domains;
}

function checkForScamLinks(content: string): string[] {
    if (!content || scamLinks.size === 0) return [];

    const domains = extractDomains(content);
    const detectedScams: string[] = [];

    for (const domain of domains) {
        if (scamLinks.has(domain)) {
            detectedScams.push(domain);
        }
    }

    return detectedScams;
}

export default definePlugin({
    name: "ScamLinkDetector",
    description: "Detects and warns about scam links using the Discord AntiScam database",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    settings,

    flux: {
        async MESSAGE_CREATE({ optimistic, type, message, channelId }: IMessageCreate) {
            if (optimistic || type !== "MESSAGE_CREATE") return;
            if (message.state === "SENDING") return;
            if (RelationshipStore.isBlocked(message.author?.id)) return;
            if (channelId !== SelectedChannelStore.getChannelId()) return;
            if (!message.content) return;

            await fetchScamList();

            const scamDomains = checkForScamLinks(message.content);

            if (scamDomains.length === 0) return;

            const domainList = scamDomains.map(d => `\`${d}\``).join(", ");
            const warningMessage = `⚠️ **Scam Link Detected**\n\nThis message contains known scam/malicious links:\n${domainList}\n\nThese domains are flagged in the Discord AntiScam database. Do not click them!`;

            if (settings.store.blockMessage) {
                try {
                    await fetch(`/api/v9/channels/${channelId}/messages/${message.id}`, {
                        method: "DELETE"
                    });
                } catch (error) {
                    logger.error("Failed to delete scam message:", error);
                }
            }

            sendBotMessage(channelId, {
                content: warningMessage
            });

            logger.warn(`Detected scam links in channel ${channelId}: ${scamDomains.join(", ")}`);
        }
    },

    async start() {
        await fetchScamList();
    }
});
