/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type SurveillanceEventType =
    | "activity_start"
    | "activity_stop"
    | "activity_update"
    | "message"
    | "message_delete"
    | "message_edit"
    | "status"
    | "typing"
    | "voice_join"
    | "voice_leave"
    | "voice_move"
    | "voice_update";

export interface SurveillanceEvent {
    id: string;
    timestamp: number;
    type: SurveillanceEventType;
    userId: string;
    username: string;
    details: string;
    channelId?: string;
    channelName?: string;
    guildId?: string;
    guildName?: string;
    content?: string;
    before?: string;
    after?: string;
    metadata?: Record<string, string | number | boolean | null>;
}

export interface MessageSnapshot {
    userId: string;
    username: string;
    channelId: string;
    guildId?: string;
    content: string;
}

export interface VoiceState {
    guildId?: string;
    channelId?: string;
    oldChannelId?: string;
    userId: string;
    mute?: boolean;
    deaf?: boolean;
    selfMute?: boolean;
    selfDeaf?: boolean;
    selfVideo?: boolean;
    selfStream?: boolean;
    suppress?: boolean;
}

export type VoiceStateFlag = "deaf" | "mute" | "selfDeaf" | "selfMute" | "selfStream" | "selfVideo" | "suppress";
