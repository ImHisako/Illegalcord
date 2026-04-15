import { RestAPI } from "@webpack/common";
import { replaceEmojis, sleep } from "../utils/helpers";
import { checkGuildExistence } from "../utils/api";
import { updateWithTime } from "../utils/notifications";
import { handleCloneError } from "../utils/errorHandler";
import { state, throwIfCancelled } from "../store";
import { CloneContext } from "./types";

export async function cloneChannels(ctx: CloneContext): Promise<number> {
    let channelsFailed = 0;
    const { sourceGuild, fullGuildData, newGuildId, options, estimateChannels, channelIdMap, roleIdMap, channelRateLimiter, channelsProgressStart, channelsProgressEnd } = ctx;

    const allChannels = estimateChannels;

    const categories = allChannels.filter((c: any) => c.type === 4).sort((a: any, b: any) => a.position - b.position);
    const otherChannels = allChannels.filter((c: any) => c.type !== 4).sort((a: any, b: any) => a.position - b.position);

    let existingTargetChannels: any[] = [];
    if (options.resumeMode) {
        const targetChResponse = await RestAPI.get({ url: `/guilds/${newGuildId}/channels` });
        existingTargetChannels = targetChResponse.body || [];

        for (const cat of categories) {
            const match = existingTargetChannels.find((tc: any) => tc.name === cat.name && tc.type === 4);
            if (match) channelIdMap[cat.id] = match.id;
        }
        for (const ch of otherChannels) {
            const match = existingTargetChannels.find((tc: any) => tc.name === ch.name && tc.type === ch.type);
            if (match) channelIdMap[ch.id] = match.id;
        }
    }

    const categoriesToCreate = options.resumeMode ? categories.filter((c: any) => !channelIdMap[c.id]) : categories;
    const channelsToCreate = options.resumeMode ? otherChannels.filter((c: any) => !channelIdMap[c.id]) : otherChannels;
    const totalChannels = categoriesToCreate.length + channelsToCreate.length;
    const actionLabel = options.resumeMode ? "Resuming" : "Cloning";

    if (options.resumeMode && totalChannels === 0) {
        updateWithTime(`All channels already exist, skipping...`, channelsProgressEnd);
    } else {
        updateWithTime(`${actionLabel} ${totalChannels} channels...`, channelsProgressStart);
    }

    let catStored = 0;
    for (const cat of categoriesToCreate) {
        checkGuildExistence(sourceGuild.id, newGuildId);
        if (!state.isCloning) break;
        catStored++;

        try {
            const progress = channelsProgressStart + ((catStored / Math.max(categoriesToCreate.length, 1)) * ((channelsProgressEnd - channelsProgressStart) * 0.2));
            updateWithTime(`${actionLabel} category ${catStored}/${categoriesToCreate.length}: ${cat.name}`, progress);

            const catPayload: any = {
                name: cat.name,
                type: 4,
                position: cat.position,
                permission_overwrites: []
            };

            if (cat.permission_overwrites) {
                const mappedOverwrites = cat.permission_overwrites
                    .filter((ow: any) => ow.type === 0 && roleIdMap[ow.id])
                    .map((ow: any) => ({
                        id: roleIdMap[ow.id],
                        type: 0,
                        allow: ow.allow,
                        deny: ow.deny
                    }));
                if (mappedOverwrites.length > 0) catPayload.permission_overwrites = mappedOverwrites;
            }

            const response = await channelRateLimiter.execute(async () => {
                return await RestAPI.post({ url: `/guilds/${newGuildId}/channels`, body: catPayload });
            });

            if (response?.body?.id) {
                channelIdMap[cat.id] = response.body.id;
            }
        } catch (e) {
            channelsFailed++;
            handleCloneError("Category", e, cat.name);
        }
    }

    const isCommunity = fullGuildData.features?.includes("COMMUNITY") ||
        otherChannels.some((c: any) => [5, 13, 15, 16].includes(c.type));

    if (isCommunity && !options.resumeMode) {
        updateWithTime("Enabling Community features...", channelsProgressStart + ((channelsProgressEnd - channelsProgressStart) * 0.25));
        
        try {
            let rulesChannelNewId: string | null = null;
            let updatesChannelNewId: string | null = null;

            const sourceRulesChannel = fullGuildData.rules_channel_id
                ? otherChannels.find((c: any) => c.id === fullGuildData.rules_channel_id)
                : null;
            const sourceUpdatesChannel = fullGuildData.public_updates_channel_id
                ? otherChannels.find((c: any) => c.id === fullGuildData.public_updates_channel_id)
                : null;

            if (sourceRulesChannel) {
                const rulesPayload: any = {
                    name: sourceRulesChannel.name,
                    type: sourceRulesChannel.type || 0,
                    topic: sourceRulesChannel.topic || undefined,
                    position: sourceRulesChannel.position,
                };
                if (sourceRulesChannel.parent_id && channelIdMap[sourceRulesChannel.parent_id]) {
                    rulesPayload.parent_id = channelIdMap[sourceRulesChannel.parent_id];
                }
                const r1 = await channelRateLimiter.execute(() => RestAPI.post({ url: `/guilds/${newGuildId}/channels`, body: rulesPayload }));
                if (r1?.body?.id) {
                    rulesChannelNewId = r1.body.id;
                    channelIdMap[sourceRulesChannel.id] = r1.body.id;
                }
            }

            if (sourceUpdatesChannel) {
                const updatesPayload: any = {
                    name: sourceUpdatesChannel.name,
                    type: sourceUpdatesChannel.type || 0,
                    topic: sourceUpdatesChannel.topic || undefined,
                    position: sourceUpdatesChannel.position,
                };
                if (sourceUpdatesChannel.parent_id && channelIdMap[sourceUpdatesChannel.parent_id]) {
                    updatesPayload.parent_id = channelIdMap[sourceUpdatesChannel.parent_id];
                }
                const r2 = await channelRateLimiter.execute(() => RestAPI.post({ url: `/guilds/${newGuildId}/channels`, body: updatesPayload }));
                if (r2?.body?.id) {
                    updatesChannelNewId = r2.body.id;
                    channelIdMap[sourceUpdatesChannel.id] = r2.body.id;
                }
            }

            if (!rulesChannelNewId) {
                const fallback = await channelRateLimiter.execute(() => RestAPI.post({ url: `/guilds/${newGuildId}/channels`, body: { name: "rules", type: 0 } }));
                rulesChannelNewId = fallback?.body?.id || null;
            }
            if (!updatesChannelNewId) {
                const fallback = await channelRateLimiter.execute(() => RestAPI.post({ url: `/guilds/${newGuildId}/channels`, body: { name: "updates", type: 0 } }));
                updatesChannelNewId = fallback?.body?.id || null;
            }

            if (rulesChannelNewId && updatesChannelNewId) {
                await RestAPI.patch({
                    url: `/guilds/${newGuildId}`,
                    body: {
                        features: ["COMMUNITY"],
                        rules_channel_id: rulesChannelNewId,
                        public_updates_channel_id: updatesChannelNewId,
                        verification_level: 1,
                        explicit_content_filter: 2
                    }
                });
                await sleep(1500);
            }
        } catch (e) {
            console.warn("[ServerCloner] Failed to enable community:", e);
        }
    }

    const alreadyCloned = new Set(Object.keys(channelIdMap));

    if (options.resumeMode) {
        const skippedChannels = otherChannels.filter((c: any) => alreadyCloned.has(c.id));
        for (const ch of skippedChannels) {
            const matchId = channelIdMap[ch.id];
            if (!matchId) continue;

            const match = existingTargetChannels.find((tc: any) => tc.id === matchId);
            if (match) {
                const expectedName = replaceEmojis(ch.name) || ch.name;
                const expectedTopic = replaceEmojis(ch.topic) || ch.topic;

                if (match.name !== expectedName || match.topic !== expectedTopic) {
                    try {
                        const patchBody: any = {};
                        if (match.name !== expectedName) patchBody.name = expectedName;
                        if (match.topic !== expectedTopic) patchBody.topic = expectedTopic;

                        await RestAPI.patch({
                            url: `/guilds/${newGuildId}/channels/${match.id}`,
                            body: patchBody
                        });
                    } catch (e) {
                        console.warn(`[ServerCloner] Failed to patch existing channel emoji: ${ch.name}`, e);
                    }
                }
            }
        }
    }

    const remainingChannels = channelsToCreate.filter((c: any) => !alreadyCloned.has(c.id));

    let chStored = 0;
    for (const ch of remainingChannels) {
        checkGuildExistence(sourceGuild.id, newGuildId);
        if (!state.isCloning) break;
        chStored++;

        try {
            const progress = channelsProgressStart + ((channelsProgressEnd - channelsProgressStart) * 0.2) + ((chStored / Math.max(remainingChannels.length, 1)) * ((channelsProgressEnd - channelsProgressStart) * 0.8));
            updateWithTime(`${actionLabel} channel ${chStored}/${remainingChannels.length}: ${ch.name}`, progress);

            const chPayload: any = {
                name: replaceEmojis(ch.name),
                type: ch.type,
                position: ch.position,
                topic: replaceEmojis(ch.topic),
                nsfw: ch.nsfw,
                rate_limit_per_user: ch.rate_limit_per_user,
                permission_overwrites: []
            };

            if (ch.parent_id && channelIdMap[ch.parent_id]) {
                chPayload.parent_id = channelIdMap[ch.parent_id];
            }

            if (ch.type === 2 || ch.type === 13) {
                chPayload.bitrate = Math.min(ch.bitrate || 64000, 96000);
                chPayload.user_limit = ch.user_limit || 0;
            }

            if (ch.type === 15 || ch.type === 16) {
                if (ch.available_tags && Array.isArray(ch.available_tags)) {
                    chPayload.available_tags = ch.available_tags.map((tag: any) => ({
                        name: replaceEmojis(tag.name),
                        emoji_id: tag.emoji_id && state.emojiIdMap[tag.emoji_id] ? state.emojiIdMap[tag.emoji_id] : null,
                        emoji_name: tag.emoji_name || null,
                        moderated: tag.moderated || false
                    }));
                }
                if (ch.default_reaction_emoji) {
                    if (ch.default_reaction_emoji.emoji_id && state.emojiIdMap[ch.default_reaction_emoji.emoji_id]) {
                        chPayload.default_reaction_emoji = {
                            emoji_id: state.emojiIdMap[ch.default_reaction_emoji.emoji_id],
                            emoji_name: ch.default_reaction_emoji.emoji_name || null
                        };
                    } else if (ch.default_reaction_emoji.emoji_name && !ch.default_reaction_emoji.emoji_id) {
                        chPayload.default_reaction_emoji = {
                            emoji_id: null,
                            emoji_name: ch.default_reaction_emoji.emoji_name
                        };
                    }
                }
                if (ch.default_sort_order !== undefined) chPayload.default_sort_order = ch.default_sort_order;
                if (ch.default_forum_layout !== undefined) chPayload.default_forum_layout = ch.default_forum_layout;
            }

            if (ch.permission_overwrites) {
                const mappedOverwrites = ch.permission_overwrites
                    .filter((ow: any) => ow.type === 0 && roleIdMap[ow.id])
                    .map((ow: any) => ({
                        id: roleIdMap[ow.id],
                        type: 0,
                        allow: ow.allow,
                        deny: ow.deny
                    }));
                if (mappedOverwrites.length > 0) chPayload.permission_overwrites = mappedOverwrites;
            }

            const response = await channelRateLimiter.execute(async () => {
                return await RestAPI.post({ url: `/guilds/${newGuildId}/channels`, body: chPayload });
            });

            if (response?.body?.id) {
                channelIdMap[ch.id] = response.body.id;
            }
        } catch (e: any) {
            if (e?.rateLimitExhausted) {
                channelsFailed += (remainingChannels.length - chStored);
                updateWithTime(`Rate limited, skipping remaining channels...`, channelsProgressEnd);
                break;
            }
            channelsFailed++;
            handleCloneError("Channel", e, ch.name);
        }
    }

    return channelsFailed;
}
