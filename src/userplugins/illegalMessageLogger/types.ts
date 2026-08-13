/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { MessageJSON } from "@vencord/discord-types";

export const LogStatus = {
    DELETED: "DELETED",
    EDITED: "EDITED",
    GHOST_PINGED: "GHOST_PINGED"
} as const;

export type LogStatus = typeof LogStatus[keyof typeof LogStatus];
export type LogViewStatus = LogStatus | "ALL";

export interface EditRecord {
    content: string;
    timestamp: string;
}

type LoggedAuthor = MessageJSON["author"] & {
    global_name?: string;
    globalName?: string;
    email?: string;
    phone?: string;
};

export type LoggedMessage = Omit<MessageJSON, "author" | "timestamp"> & {
    author: LoggedAuthor;
    timestamp: string;
    guildId?: string;
    guild_id?: string;
    deleted?: boolean;
    deletedTimestamp?: string;
    editHistory?: EditRecord[];
    ghostPinged?: boolean;
    mentioned?: boolean;
    ourCache?: boolean;
    customRenderedContent?: unknown;
    __messageloggerDiff?: unknown;
    __messageloggerDiffKey?: unknown;
    __messageloggerAggregated?: unknown;
    __messageloggerLastAppliedKey?: unknown;
};

export interface LogRecord {
    message_id: string;
    channel_id: string;
    status: LogStatus;
    message: LoggedMessage;
    protected?: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface MessageCreatePayload {
    channelId: string;
    guildId?: string;
    message: MessageJSON;
}

export interface MessageUpdatePayload {
    guildId?: string;
    message: Partial<MessageJSON> & Pick<MessageJSON, "id" | "channel_id">;
}

export interface MessageDeletePayload {
    channelId: string;
    guildId?: string;
    id: string;
    mlDeleted?: boolean;
}

export interface MessageDeleteBulkPayload {
    channelId: string;
    guildId?: string;
    ids: string[];
    mlDeleted?: boolean;
}

export interface FetchMessagesResponse {
    ok: boolean;
    body: (LoggedMessage[] & { extra?: LoggedMessage[]; });
}

export interface LoadMessagesPayload {
    hasMoreAfter: boolean;
    hasMoreBefore: boolean;
    isAfter: boolean;
    isBefore: boolean;
}

export interface LogPage {
    records: LogRecord[];
    cursor?: string;
    hasMore: boolean;
    total: number;
}

export interface LogStats {
    total: number;
    deleted: number;
    edited: number;
    ghostPinged: number;
    protected: number;
    estimatedBytes: number;
}

export interface LogExport {
    format: "IllegalMessageLogger";
    version: 1;
    exportedAt: string;
    messages: LogRecord[];
}
