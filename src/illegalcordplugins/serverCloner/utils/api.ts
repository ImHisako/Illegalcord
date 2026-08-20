/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Channel } from "@vencord/discord-types";
import { GuildChannelStore, GuildRoleStore, GuildStore, RestAPI } from "@webpack/common";

import { CloneChannel, CloneRole, FullGuildData, PermissionOverwrite } from "../core/types";
import { state } from "../store";
import { arrayBufferToBase64, isRecord } from "./helpers";

const MAX_ASSET_BYTES = 10 * 1024 * 1024;

function isCloneRole(value: unknown): value is CloneRole {
    return isRecord(value)
        && typeof value.id === "string"
        && typeof value.name === "string"
        && typeof value.color === "number"
        && typeof value.managed === "boolean"
        && typeof value.position === "number"
        && (typeof value.permissions === "string" || typeof value.permissions === "bigint");
}

function getBody(value: unknown): unknown {
    return isRecord(value) ? value.body : undefined;
}

export async function fetchGuildRoles(guildId: string): Promise<CloneRole[]> {
    const rolesFromStore = GuildRoleStore.getSortedRoles(guildId);
    if (rolesFromStore.length > 0) return rolesFromStore;

    const response: unknown = await RestAPI.get({ url: `/guilds/${guildId}/roles` });
    const body = getBody(response);
    if (!Array.isArray(body) || !body.every(isCloneRole)) throw new Error("Discord returned invalid role data");
    return body;
}

export async function fetchGuildData(guildId: string): Promise<FullGuildData> {
    const response: unknown = await RestAPI.get({ url: `/guilds/${guildId}` });
    const body = getBody(response);
    if (!isRecord(body) || !Array.isArray(body.features)) throw new Error("Discord returned invalid server data");
    return {
        afk_channel_id: typeof body.afk_channel_id === "string" ? body.afk_channel_id : null,
        description: typeof body.description === "string" ? body.description : null,
        features: body.features.filter((feature): feature is string => typeof feature === "string"),
        public_updates_channel_id: typeof body.public_updates_channel_id === "string" ? body.public_updates_channel_id : null,
        rules_channel_id: typeof body.rules_channel_id === "string" ? body.rules_channel_id : null,
        safety_alerts_channel_id: typeof body.safety_alerts_channel_id === "string" ? body.safety_alerts_channel_id : null,
        system_channel_id: typeof body.system_channel_id === "string" ? body.system_channel_id : null
    };
}

function normalizeOverwrite(value: unknown): PermissionOverwrite | null {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.type !== "number") return null;
    const { allow } = value;
    const { deny } = value;
    if (!["bigint", "number", "string"].includes(typeof allow) || !["bigint", "number", "string"].includes(typeof deny)) return null;
    return {
        id: value.id,
        type: value.type,
        allow: allow as bigint | number | string,
        deny: deny as bigint | number | string
    };
}

export function normalizeChannel(value: unknown): CloneChannel | null {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.type !== "number") return null;

    const rawOverwrites = value.permission_overwrites ?? value.permissionOverwrites;
    const overwriteValues = Array.isArray(rawOverwrites)
        ? rawOverwrites
        : isRecord(rawOverwrites) ? Object.values(rawOverwrites) : [];
    const permissionOverwrites = overwriteValues.map(normalizeOverwrite).filter(overwrite => overwrite !== null);

    const rawTags = value.available_tags ?? value.availableTags;
    const availableTags = Array.isArray(rawTags)
        ? rawTags.filter(isRecord).map(tag => ({
            name: typeof tag.name === "string" ? tag.name : "Tag",
            emoji_id: typeof (tag.emoji_id ?? tag.emojiId) === "string" ? String(tag.emoji_id ?? tag.emojiId) : null,
            emoji_name: typeof (tag.emoji_name ?? tag.emojiName) === "string" ? String(tag.emoji_name ?? tag.emojiName) : null,
            moderated: tag.moderated === true
        }))
        : null;

    const reaction = value.default_reaction_emoji ?? value.defaultReactionEmoji;
    const defaultReactionEmoji = isRecord(reaction)
        ? {
            emoji_id: typeof (reaction.emoji_id ?? reaction.emojiId) === "string" ? String(reaction.emoji_id ?? reaction.emojiId) : null,
            emoji_name: typeof (reaction.emoji_name ?? reaction.emojiName) === "string" ? String(reaction.emoji_name ?? reaction.emojiName) : null
        }
        : null;

    const numberOrNull = (candidate: unknown): number | null => typeof candidate === "number" ? candidate : null;
    const stringOrNull = (candidate: unknown): string | null => typeof candidate === "string" ? candidate : null;

    return {
        available_tags: availableTags,
        bitrate: numberOrNull(value.bitrate),
        default_auto_archive_duration: numberOrNull(value.default_auto_archive_duration ?? value.defaultAutoArchiveDuration),
        default_forum_layout: numberOrNull(value.default_forum_layout ?? value.defaultForumLayout),
        default_reaction_emoji: defaultReactionEmoji,
        default_sort_order: numberOrNull(value.default_sort_order ?? value.defaultSortOrder),
        guild_id: stringOrNull(value.guild_id ?? value.guildId) ?? "",
        id: value.id,
        name: value.name,
        nsfw: value.nsfw === true,
        parent_id: stringOrNull(value.parent_id ?? value.parentId),
        permission_overwrites: permissionOverwrites,
        position: numberOrNull(value.position) ?? 0,
        rate_limit_per_user: numberOrNull(value.rate_limit_per_user ?? value.rateLimitPerUser),
        topic: stringOrNull(value.topic),
        type: value.type,
        user_limit: numberOrNull(value.user_limit ?? value.userLimit)
    };
}

export async function fetchGuildChannels(guildId: string): Promise<CloneChannel[]> {
    const response: unknown = await RestAPI.get({ url: `/guilds/${guildId}/channels` });
    const body = getBody(response);
    if (!Array.isArray(body)) throw new Error("Discord returned invalid channel data");
    return body.map(normalizeChannel).filter(channel => channel !== null);
}

export function extractChannels(guildId: string): CloneChannel[] {
    const channels = GuildChannelStore.getChannels(guildId);
    if (!channels) return [];

    const records = [
        ...channels.SELECTABLE,
        ...channels.VOCAL,
        ...channels[4]
    ];
    const seen = new Set<string>();
    const result: CloneChannel[] = [];

    for (const record of records) {
        const channel = "channel" in record ? record.channel : record as Channel;
        if (seen.has(channel.id)) continue;
        const normalized = normalizeChannel(channel);
        if (!normalized) continue;
        seen.add(channel.id);
        result.push(normalized);
    }

    return result;
}

export function checkGuildExistence(sourceId: string, targetId: string): void {
    if (!GuildStore.getGuild(sourceId)) throw new Error("Original server is gone");
    if (!GuildStore.getGuild(targetId)) throw new Error("Target server is gone");
}

export async function fetchAssetBase64(url: string, fallback: string | null = null): Promise<string | null> {
    try {
        const response = await fetch(url, { signal: state.abortController?.signal });
        if (!response.ok) return fallback;

        const declaredSize = Number(response.headers.get("content-length") ?? 0);
        if (declaredSize > MAX_ASSET_BYTES) return fallback;

        const data = await response.arrayBuffer();
        if (data.byteLength > MAX_ASSET_BYTES) return fallback;
        return `data:image/png;base64,${arrayBufferToBase64(data)}`;
    } catch {
        return fallback;
    }
}
