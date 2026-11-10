/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { CloudUpload, EmbedMedia, Message, MessageAttachment } from "@vencord/discord-types";

export type SentTrailMediaKind = "image" | "video";
export type SentTrailMediaSource = "attachment" | "embed";

export interface SentTrailMediaItem {
    kind: SentTrailMediaKind;
    source: SentTrailMediaSource;
    url: string;
    filename?: string;
    contentType?: string;
    width?: number;
    height?: number;
}

export interface SentTrailRecord {
    id: string;
    messageId: string;
    channelId: string;
    guildId: string;
    timestamp: number;
    content: string;
    preview: string;
    hasText: boolean;
    hasMedia: boolean;
    jumpLink: string;
    media: SentTrailMediaItem[];
    channelNameSnapshot?: string;
    guildNameSnapshot?: string;
    recipientUserIds?: string[];
    replyMessageId?: string;
}

export interface PendingSendDraft {
    localId: string;
    ownerId: string;
    channelId: string;
    createdAt: number;
    content: string;
    normalizedContent: string;
    hasText: boolean;
    mediaHint: boolean;
    uploadSignature: string;
    replyMessageId?: string;
}

export interface MessageCreatePayload {
    type: "MESSAGE_CREATE";
    optimistic: boolean;
    channelId: string;
    guildId?: string;
    message: SendTrailMessage;
}

export interface MessageUpdatePayload {
    type: "MESSAGE_UPDATE";
    guildId?: string;
    message: SendTrailMessage;
}

export interface MessageDeletePayload {
    type: "MESSAGE_DELETE";
    channelId: string;
    id: string;
}

export type SendTrailEmbedMedia = Pick<EmbedMedia, "url"> & Partial<Pick<EmbedMedia, "width" | "height" | "contentType">>;

export interface MediaExtractionInput {
    content?: string;
    attachments?: MessageAttachment[];
    embeds?: {
        image?: SendTrailEmbedMedia;
        images?: SendTrailEmbedMedia[];
        thumbnail?: SendTrailEmbedMedia;
        video?: SendTrailEmbedMedia;
    }[];
}

export interface SendTrailMessage extends MediaExtractionInput, Pick<Message, "id" | "channel_id"> {
    author?: Pick<Message["author"], "id">;
    timestamp?: Message["timestamp"] | string;
    state?: Message["state"];
    flags?: Message["flags"];
    hasFlag?: Message["hasFlag"];
    messageReference?: Message["messageReference"];
    message_reference?: Message["messageReference"];
    messageSnapshots?: { message: MediaExtractionInput; }[];
    message_snapshots?: { message: MediaExtractionInput; }[];
    guild_id?: string;
}

export interface UploadSignatureInput {
    uploads?: CloudUpload[];
}
