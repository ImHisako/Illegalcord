/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelStore, GuildStore } from "@webpack/common";

import { LogRecord, LogStatus } from "./types";

interface SearchTerm {
    key: string;
    value: string;
    negated: boolean;
}

const SEARCH_KEYS = new Set(["from", "user", "channel", "in", "guild", "server", "id", "message", "before", "after", "has", "is", "text", "content"]);

function parseSearch(query: string): SearchTerm[] {
    return (query.match(/-?(?:[\w-]+:)?(?:"[^"]*"|\S+)/g) ?? []).map(rawTerm => {
        const negated = rawTerm.startsWith("-");
        const raw = negated ? rawTerm.slice(1) : rawTerm;
        const term = raw.replace(/^"|"$/g, "");
        const separator = term.indexOf(":");

        return raw.startsWith('"') || separator === -1 || !SEARCH_KEYS.has(term.slice(0, separator).toLowerCase())
            ? { key: "text", value: term.toLowerCase(), negated }
            : { key: term.slice(0, separator).toLowerCase(), value: term.slice(separator + 1).replace(/^"|"$/g, "").toLowerCase(), negated };
    }).filter(term => term.value.length > 0);
}

export function createSearchMatcher(query: string) {
    const terms = parseSearch(query.trim()).map(term => ({
        ...term,
        time: term.key === "before" || term.key === "after" ? Date.parse(term.value) : NaN
    }));
    if (terms.length === 0) return () => true;
    const needsText = terms.some(term => term.key === "text" || term.key === "content");
    const needsGuild = needsText || terms.some(term => term.key === "guild" || term.key === "server");
    const needsChannel = needsGuild || terms.some(term => term.key === "channel" || term.key === "in");
    const needsTime = terms.some(term => term.key === "before" || term.key === "after");

    return (record: LogRecord) => {
        const { message } = record;
        const authorName = message.author.global_name ?? message.author.globalName ?? message.author.username;
        const channel = needsChannel ? ChannelStore.getChannel(message.channel_id) : undefined;
        const guildId = message.guild_id ?? message.guildId ?? channel?.guild_id;
        const channelName = channel?.name?.toLowerCase() ?? "";
        const guildName = needsGuild && guildId ? GuildStore.getGuild(guildId)?.name.toLowerCase() ?? "" : "";
        const timestamp = needsTime ? Date.parse(message.timestamp) : NaN;
        const text = needsText ? [message.content, authorName, message.author.username, channelName, guildName, message.id,
            message.author.id, message.channel_id, guildId ?? "", ...(message.editHistory?.map(edit => edit.content) ?? [])]
            .map(candidate => candidate.toLowerCase()) : [];

        return terms.every(term => {
            const { value } = term;
            let matches: boolean;

            switch (term.key) {
                case "from":
                case "user":
                    matches = message.author.id === value || authorName.toLowerCase().includes(value) || message.author.username.toLowerCase().includes(value);
                    break;
                case "channel":
                case "in":
                    matches = message.channel_id === value || channelName.includes(value);
                    break;
                case "guild":
                case "server":
                    matches = guildId === value || guildName.includes(value);
                    break;
                case "id":
                case "message":
                    matches = message.id === value;
                    break;
                case "before": {
                    matches = timestamp < term.time;
                    break;
                }
                case "after": {
                    matches = timestamp > term.time;
                    break;
                }
                case "has":
                    matches = value === "attachment" && message.attachments.length > 0
                        || value === "embed" && message.embeds.length > 0
                        || value === "edit" && !!message.editHistory?.length
                        || value === "link" && /(?:https?:\/\/|www\.)/i.test(message.content);
                    break;
                case "is":
                    matches = value === "protected" && !!record.protected
                        || value === "deleted" && record.status === LogStatus.DELETED
                        || value === "edited" && record.status === LogStatus.EDITED
                        || ["ghost", "ghostping", "ghost-ping"].includes(value) && record.status === LogStatus.GHOST_PINGED;
                    break;
                case "text":
                case "content":
                    matches = text.some(candidate => candidate.includes(value));
                    break;
                default:
                    matches = false;
            }

            return term.negated ? !matches : matches;
        });
    };
}
