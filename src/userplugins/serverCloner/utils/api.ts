import { RestAPI, GuildRoleStore, GuildChannelStore, GuildStore } from "@webpack/common";
import { arrayBufferToBase64 } from "./helpers";

export async function fetchGuildRoles(guildId: string): Promise<any[]> {
    try {
        const rolesFromStore = GuildRoleStore.getSortedRoles(guildId);
        if (rolesFromStore && rolesFromStore.length > 0) {
            return rolesFromStore;
        }
        const response = await RestAPI.get({ url: `/guilds/${guildId}/roles` });
        return response.body || [];
    } catch (e) {
        return [];
    }
}

export async function fetchGuildData(guildId: string): Promise<any> {
    try {
        const response = await RestAPI.get({ url: `/guilds/${guildId}` });
        return response.body || null;
    } catch (e) {
        return null;
    }
}

export function extractChannels(guildId: string, includeHidden = false): any[] {
    try {
        const channelsData = (GuildChannelStore as any).getChannels(guildId, includeHidden);
        if (!channelsData) return [];

        const channels: any[] = [];
        const seen = new Set<string>();

        if (Array.isArray(channelsData)) {
            channelsData.forEach((item: any) => {
                const channel = item?.channel || item;
                if (channel?.id && !seen.has(channel.id)) {
                    seen.add(channel.id);
                    channels.push(channel);
                }
            });
        } else if (typeof channelsData === "object") {
            for (const key in channelsData) {
                const value = (channelsData as any)[key];
                if (Array.isArray(value)) {
                    value.forEach((item: any) => {
                        const channel = item?.channel || item;
                        if (channel?.id && !seen.has(channel.id)) {
                            seen.add(channel.id);
                            channels.push(channel);
                        }
                    });
                }
            }
        }

        return channels;
    } catch (e) {
        return [];
    }
}

export function checkGuildExistence(sourceId: string, targetId: string) {
    if (!GuildStore.getGuild(sourceId)) throw new Error("Original server is gone");
    if (!GuildStore.getGuild(targetId)) throw new Error("Target server is gone");
}

export async function fetchAssetBase64(url: string, fallback: string | null = null): Promise<string | null> {
    try {
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.arrayBuffer();
            return `data:image/png;base64,${arrayBufferToBase64(data)}`;
        }
    } catch (e) {
        console.warn(`[ServerCloner] Failed to fetch asset from ${url}:`, e);
    }
    return fallback;
}

export function normalizeChannel(ch: any): any {
    if (!ch) return ch;

    let permissionOverwrites = ch.permission_overwrites;
    if (!permissionOverwrites && ch.permissionOverwrites) {
        permissionOverwrites = Object.values(ch.permissionOverwrites).map((ow: any) => ({
            id: ow.id,
            type: ow.type,
            allow: ow.allow?.toString() ?? "0",
            deny: ow.deny?.toString() ?? "0"
        }));
    } else if (Array.isArray(permissionOverwrites)) {
        permissionOverwrites = permissionOverwrites.map((ow: any) => ({
            id: ow.id,
            type: ow.type,
            allow: ow.allow?.toString() ?? "0",
            deny: ow.deny?.toString() ?? "0"
        }));
    }

    let defaultReactionEmoji = ch.default_reaction_emoji ?? ch.defaultReactionEmoji;
    if (defaultReactionEmoji) {
        defaultReactionEmoji = {
            emoji_id: defaultReactionEmoji.emoji_id ?? defaultReactionEmoji.emojiId ?? null,
            emoji_name: defaultReactionEmoji.emoji_name ?? defaultReactionEmoji.emojiName ?? null
        };
    }

    let availableTags = ch.available_tags ?? ch.availableTags;
    if (availableTags && Array.isArray(availableTags)) {
        availableTags = availableTags.map((tag: any) => ({
            id: tag.id,
            name: tag.name,
            emoji_id: tag.emoji_id ?? tag.emojiId ?? null,
            emoji_name: tag.emoji_name ?? tag.emojiName ?? null,
            moderated: tag.moderated ?? false
        }));
    }

    return {
        ...ch,
        id: ch.id,
        type: ch.type,
        guild_id: ch.guild_id ?? ch.guildId,
        name: ch.name,
        position: ch.position,
        parent_id: ch.parent_id ?? ch.parentId ?? null,
        topic: ch.topic ?? null,
        nsfw: ch.nsfw ?? false,
        last_message_id: ch.last_message_id ?? ch.lastMessageId ?? null,
        bitrate: ch.bitrate ?? null,
        user_limit: ch.user_limit ?? ch.userLimit ?? null,
        rate_limit_per_user: ch.rate_limit_per_user ?? ch.rateLimitPerUser ?? null,
        permission_overwrites: permissionOverwrites || [],
        default_auto_archive_duration: ch.default_auto_archive_duration ?? ch.defaultAutoArchiveDuration ?? null,
        available_tags: availableTags ?? null,
        default_reaction_emoji: defaultReactionEmoji ?? null,
        default_sort_order: ch.default_sort_order ?? ch.defaultSortOrder ?? null,
        default_forum_layout: ch.default_forum_layout ?? ch.defaultForumLayout ?? null
    };
}