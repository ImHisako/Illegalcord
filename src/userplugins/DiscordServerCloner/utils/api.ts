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
        const channelsData = GuildChannelStore.getChannels(guildId, includeHidden);
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
