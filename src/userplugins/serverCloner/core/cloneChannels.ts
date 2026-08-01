/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Constants, GuildStore, RestAPI } from "@webpack/common";

import { state } from "../store";
import { checkGuildExistence, fetchGuildChannels } from "../utils/api";
import { handleCloneError } from "../utils/errorHandler";
import { isRecord, replaceEmojis, sleep } from "../utils/helpers";
import { updateWithTime } from "../utils/notifications";
import { CloneChannel, CloneContext } from "./types";

interface ChannelResponse {
    body?: { id?: unknown; };
}

function isRateLimitExhausted(error: unknown): boolean {
    return isRecord(error) && error.rateLimitExhausted === true;
}

function mappedOverwrites(channel: CloneChannel, sourceGuildId: string, targetGuildId: string, roleIdMap: Record<string, string>) {
    return channel.permission_overwrites
        .filter(overwrite => overwrite.type === 0 && (roleIdMap[overwrite.id] || overwrite.id === sourceGuildId))
        .map(overwrite => ({
            id: overwrite.id === sourceGuildId ? targetGuildId : roleIdMap[overwrite.id],
            type: 0,
            allow: overwrite.allow,
            deny: overwrite.deny
        }));
}

export async function cloneChannels(context: CloneContext): Promise<number> {
    const {
        sourceGuild, fullGuildData, newGuildId, options, estimateChannels, channelIdMap, roleIdMap,
        channelQueue, channelsProgressStart, channelsProgressEnd
    } = context;
    const categories = estimateChannels.filter(channel => channel.type === 4).sort((a, b) => a.position - b.position);
    const otherChannels = estimateChannels.filter(channel => channel.type !== 4).sort((a, b) => a.position - b.position);
    const existingTargetChannels = options.resumeMode ? await fetchGuildChannels(newGuildId) : [];
    const usedTargetIds = new Set<string>();

    if (options.resumeMode) {
        for (const category of categories) {
            const match = existingTargetChannels.find(target =>
                !usedTargetIds.has(target.id) && target.type === 4 && target.name === category.name
            );
            if (!match) continue;
            channelIdMap[category.id] = match.id;
            usedTargetIds.add(match.id);
        }

        for (const channel of otherChannels) {
            const mappedParentId = channel.parent_id ? channelIdMap[channel.parent_id] : null;
            const match = existingTargetChannels.find(target =>
                !usedTargetIds.has(target.id)
                && target.type === channel.type
                && target.name === channel.name
                && target.parent_id === mappedParentId
            );
            if (!match) continue;
            channelIdMap[channel.id] = match.id;
            usedTargetIds.add(match.id);
        }
    }

    const categoriesToCreate = categories.filter(category => !channelIdMap[category.id]);
    const channelsToCreate = otherChannels.filter(channel => !channelIdMap[channel.id]);
    const actionLabel = options.resumeMode ? "Resuming" : "Cloning";
    let channelsFailed = 0;
    let categoriesCreated = 0;

    await Promise.all(categoriesToCreate.map(async category => {
        if (!state.isCloning) return;
        try {
            checkGuildExistence(sourceGuild.id, newGuildId);
            const response: ChannelResponse = await channelQueue.execute(() => RestAPI.post({
                url: `/guilds/${newGuildId}/channels`,
                body: {
                    name: category.name,
                    type: 4,
                    position: category.position,
                    permission_overwrites: mappedOverwrites(category, sourceGuild.id, newGuildId, roleIdMap)
                }
            }));
            if (typeof response.body?.id !== "string") throw new Error("Discord did not return the new category ID");
            channelIdMap[category.id] = response.body.id;
            categoriesCreated++;
            updateWithTime(`${actionLabel} category ${categoriesCreated}/${categoriesToCreate.length}: ${category.name}`, channelsProgressStart);
        } catch (error: unknown) {
            channelsFailed++;
            handleCloneError("Category", error, category.name);
        }
    }));

    const isCommunity = fullGuildData.features.includes("COMMUNITY") || otherChannels.some(channel => [5, 13, 15, 16].includes(channel.type));
    if (isCommunity && !options.resumeMode) {
        try {
            const createCommunityChannel = async (source: CloneChannel | undefined, fallbackName: string): Promise<string> => {
                const response: ChannelResponse = await channelQueue.execute(() => RestAPI.post({
                    url: `/guilds/${newGuildId}/channels`,
                    body: {
                        name: source?.name ?? fallbackName,
                        parent_id: source?.parent_id ? channelIdMap[source.parent_id] : undefined,
                        position: source?.position,
                        topic: source?.topic ?? undefined,
                        type: source?.type ?? 0
                    }
                }));
                if (typeof response.body?.id !== "string") throw new Error("Discord did not return the community channel ID");
                if (source) channelIdMap[source.id] = response.body.id;
                return response.body.id;
            };

            const rulesSource = otherChannels.find(channel => channel.id === fullGuildData.rules_channel_id);
            const updatesSource = otherChannels.find(channel => channel.id === fullGuildData.public_updates_channel_id);
            const rulesChannelId = await createCommunityChannel(rulesSource, "rules");
            const updatesChannelId = await createCommunityChannel(updatesSource, "updates");

            await RestAPI.patch({
                url: Constants.Endpoints.GUILD(newGuildId),
                body: {
                    explicit_content_filter: 2,
                    features: ["COMMUNITY"],
                    public_updates_channel_id: updatesChannelId,
                    rules_channel_id: rulesChannelId,
                    verification_level: 1
                }
            });
            await sleep(500);
        } catch (error: unknown) {
            handleCloneError("Community settings", error);
        }
    }

    if (options.resumeMode) {
        for (const source of otherChannels.filter(channel => channelIdMap[channel.id])) {
            const targetId = channelIdMap[source.id];
            const target = existingTargetChannels.find(channel => channel.id === targetId);
            if (!target) continue;

            const expectedName = replaceEmojis(source.name) ?? source.name;
            const expectedTopic = replaceEmojis(source.topic) ?? source.topic;
            if (target.name === expectedName && target.topic === expectedTopic) continue;

            const body: Record<string, unknown> = {};
            if (target.name !== expectedName) body.name = expectedName;
            if (target.topic !== expectedTopic) body.topic = expectedTopic;
            try {
                await RestAPI.patch({ url: Constants.Endpoints.CHANNEL(target.id), body });
            } catch (error: unknown) {
                handleCloneError("Channel update", error, source.name);
            }
        }
    }

    let channelsCreated = 0;
    let skipRemaining = false;
    await Promise.all(channelsToCreate.filter(channel => !channelIdMap[channel.id]).map(async channel => {
        if (!state.isCloning || skipRemaining) return;

        try {
            checkGuildExistence(sourceGuild.id, newGuildId);
            const body: Record<string, unknown> = {
                name: replaceEmojis(channel.name),
                nsfw: channel.nsfw,
                parent_id: channel.parent_id ? channelIdMap[channel.parent_id] : undefined,
                permission_overwrites: mappedOverwrites(channel, sourceGuild.id, newGuildId, roleIdMap),
                position: channel.position,
                rate_limit_per_user: channel.rate_limit_per_user,
                topic: replaceEmojis(channel.topic),
                type: channel.type
            };

            if (channel.type === 2 || channel.type === 13) {
                const tier = GuildStore.getGuild(newGuildId)?.premiumTier ?? 0;
                const maxBitrate = tier >= 3 ? 384000 : tier >= 2 ? 256000 : tier >= 1 ? 128000 : 96000;
                body.bitrate = Math.min(channel.bitrate ?? 64000, maxBitrate);
                body.user_limit = channel.user_limit ?? 0;
            }

            if (channel.type === 15 || channel.type === 16) {
                body.available_tags = channel.available_tags?.map(tag => ({
                    name: replaceEmojis(tag.name),
                    emoji_id: tag.emoji_id ? state.emojiIdMap[tag.emoji_id] ?? null : null,
                    emoji_name: tag.emoji_name,
                    moderated: tag.moderated
                }));
                const reaction = channel.default_reaction_emoji;
                if (reaction?.emoji_id && state.emojiIdMap[reaction.emoji_id]) {
                    body.default_reaction_emoji = { emoji_id: state.emojiIdMap[reaction.emoji_id], emoji_name: reaction.emoji_name };
                } else if (reaction?.emoji_name && !reaction.emoji_id) {
                    body.default_reaction_emoji = { emoji_id: null, emoji_name: reaction.emoji_name };
                }
                body.default_sort_order = channel.default_sort_order;
                body.default_forum_layout = channel.default_forum_layout;
            }

            const response: ChannelResponse = await channelQueue.execute(
                () => RestAPI.post({ url: `/guilds/${newGuildId}/channels`, body }),
                message => updateWithTime(message, channelsProgressStart)
            );
            if (typeof response.body?.id !== "string") throw new Error("Discord did not return the new channel ID");
            channelIdMap[channel.id] = response.body.id;
            channelsCreated++;
            const progress = channelsProgressStart + channelsCreated / Math.max(channelsToCreate.length, 1) * (channelsProgressEnd - channelsProgressStart);
            updateWithTime(`${actionLabel} channel ${channelsCreated}/${channelsToCreate.length}: ${channel.name}`, progress);
        } catch (error: unknown) {
            if (isRateLimitExhausted(error)) {
                channelsFailed += channelsToCreate.length - channelsCreated;
                skipRemaining = true;
                return;
            }
            channelsFailed++;
            handleCloneError("Channel", error, channel.name);
        }
    }));

    return channelsFailed;
}
