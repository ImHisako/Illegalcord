/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RestAPI } from "@webpack/common";

import { state, throwIfCancelled } from "../store";
import { handleCloneError } from "../utils/errorHandler";
import { replaceEmojis } from "../utils/helpers";
import { updateWithTime } from "../utils/notifications";
import { CloneContext, OnboardingData, OnboardingOption } from "./types";

interface MappedOption {
    channel_ids: string[];
    description?: string | null;
    emoji_animated: boolean;
    emoji_id: string | null;
    emoji_name: string | null;
    id: string;
    role_ids: string[];
    title: string;
}

function mapOption(option: OnboardingOption, channelIdMap: Record<string, string>, roleIdMap: Record<string, string>, id: string): MappedOption | null {
    const channelIds = (option.channel_ids ?? []).map(channelId => channelIdMap[channelId]).filter(mapped => mapped !== undefined);
    const roleIds = (option.role_ids ?? []).map(roleId => roleIdMap[roleId]).filter(mapped => mapped !== undefined);
    if (channelIds.length === 0 && roleIds.length === 0) return null;

    const originalEmojiId = option.emoji_id ?? option.emoji?.id ?? null;
    const mappedEmojiId = originalEmojiId ? state.emojiIdMap[originalEmojiId] ?? null : null;
    const emojiName = originalEmojiId && !mappedEmojiId ? null : option.emoji_name ?? option.emoji?.name ?? null;

    return {
        channel_ids: channelIds,
        description: replaceEmojis(option.description),
        emoji_animated: mappedEmojiId !== null && (option.emoji_animated ?? option.emoji?.animated ?? false),
        emoji_id: mappedEmojiId,
        emoji_name: emojiName,
        id,
        role_ids: roleIds,
        title: replaceEmojis(option.title) ?? "Option"
    };
}

export async function cloneOnboarding(context: CloneContext): Promise<void> {
    const { sourceGuild, newGuildId, channelIdMap, roleIdMap, taskQueue, onboardingProgressStart } = context;

    try {
        throwIfCancelled();
        updateWithTime("Cloning onboarding settings.", onboardingProgressStart);

        const response: { body?: OnboardingData; } = await RestAPI.get({ url: `/guilds/${sourceGuild.id}/onboarding` });
        const onboarding = response.body;
        if (!onboarding) return;

        let sequence = 0n;
        const nextId = (): string => (((BigInt(Date.now()) - 1420070400000n) << 22n) | sequence++).toString();
        const prompts = (onboarding.prompts ?? []).map(prompt => ({
            id: nextId(),
            title: replaceEmojis(prompt.title) ?? "Prompt",
            type: prompt.type ?? 0,
            required: prompt.required ?? false,
            single_select: prompt.single_select ?? false,
            in_onboarding: prompt.in_onboarding ?? false,
            options: (prompt.options ?? [])
                .map(option => mapOption(option, channelIdMap, roleIdMap, nextId()))
                .filter(option => option !== null)
        })).filter(prompt => prompt.options.length > 0);
        const defaultChannelIds = (onboarding.default_channel_ids ?? [])
            .map(channelId => channelIdMap[channelId])
            .filter(mapped => mapped !== undefined);

        const putOnboarding = (enabled: boolean) => RestAPI.put({
            url: `/guilds/${newGuildId}/onboarding`,
            body: {
                prompts,
                default_channel_ids: defaultChannelIds,
                enabled,
                mode: onboarding.mode ?? 0
            }
        });

        await taskQueue.execute(async () => {
            try {
                await putOnboarding(onboarding.enabled ?? false);
            } catch (error: unknown) {
                if (!onboarding.enabled) throw error;
                await putOnboarding(false);
            }
        });
    } catch (error: unknown) {
        handleCloneError("Onboarding", error);
    }
}
