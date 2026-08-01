/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Guild } from "@vencord/discord-types";

import { CloneOptions } from "../types";
import { TaskQueue } from "../utils/TaskQueue";

export interface CloneRole {
    color: number;
    hoist: boolean;
    icon?: string;
    id: string;
    managed: boolean;
    mentionable: boolean;
    name: string;
    permissions: bigint | string;
    position: number;
    unicodeEmoji?: string;
    unicode_emoji?: string;
}

export interface PermissionOverwrite {
    allow: bigint | number | string;
    deny: bigint | number | string;
    id: string;
    type: number;
}

export interface ForumTag {
    emoji_id: string | null;
    emoji_name: string | null;
    moderated: boolean;
    name: string;
}

export interface CloneChannel {
    available_tags: ForumTag[] | null;
    bitrate: number | null;
    default_auto_archive_duration: number | null;
    default_forum_layout: number | null;
    default_reaction_emoji: { emoji_id: string | null; emoji_name: string | null; } | null;
    default_sort_order: number | null;
    guild_id: string;
    id: string;
    name: string;
    nsfw: boolean;
    parent_id: string | null;
    permission_overwrites: PermissionOverwrite[];
    position: number;
    rate_limit_per_user: number | null;
    topic: string | null;
    type: number;
    user_limit: number | null;
}

export interface FullGuildData {
    afk_channel_id?: string | null;
    description?: string | null;
    features: string[];
    public_updates_channel_id?: string | null;
    rules_channel_id?: string | null;
    safety_alerts_channel_id?: string | null;
    system_channel_id?: string | null;
}

export interface CloneEmoji {
    animated?: boolean;
    id: string;
    name: string;
}

export interface CloneSticker {
    description?: string;
    format_type: number;
    id: string;
    name: string;
    tags?: string;
}

export interface CloneSound {
    emoji_id?: string | null;
    emoji_name?: string | null;
    name: string;
    sound_id: string;
    volume?: number;
}

export interface OnboardingOption {
    channel_ids?: string[];
    description?: string;
    emoji?: { animated?: boolean; id?: string; name?: string; };
    emoji_animated?: boolean;
    emoji_id?: string | null;
    emoji_name?: string | null;
    id?: string;
    role_ids?: string[];
    title?: string;
}

export interface OnboardingPrompt {
    id?: string;
    in_onboarding?: boolean;
    options?: OnboardingOption[];
    required?: boolean;
    single_select?: boolean;
    title?: string;
    type?: number;
}

export interface OnboardingData {
    default_channel_ids?: string[];
    enabled?: boolean;
    mode?: number;
    prompts?: OnboardingPrompt[];
}

export interface DiscordApiError {
    body?: {
        code?: number;
        errors?: Record<string, unknown>;
        message?: string;
    };
    code?: number;
    headers?: Record<string, string>;
    message?: string;
    retry_after?: number | string;
    status?: number;
    text?: string;
}

export interface CloneContext {
    sourceGuild: Guild;
    fullGuildData: FullGuildData;
    newGuildId: string;
    options: CloneOptions;
    roleIdMap: Record<string, string>;
    channelIdMap: Record<string, string>;
    taskQueue: TaskQueue;
    roleQueue: TaskQueue;
    channelQueue: TaskQueue;
    deleteQueue: TaskQueue;
    assetQueue: TaskQueue;
    estimateChannels: CloneChannel[];
    estimateRoles: CloneRole[];
    rolesProgressStart: number;
    rolesProgressEnd: number;
    channelsProgressStart: number;
    channelsProgressEnd: number;
    settingsProgressEnd: number;
    onboardingProgressStart: number;
    stickersProgressStart: number;
    stickersProgressEnd: number;
    soundboardProgressStart: number;
    soundboardProgressEnd: number;
}
