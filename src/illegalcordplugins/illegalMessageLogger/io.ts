/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isObject } from "@utils/misc";
import { chooseFile, saveFile } from "@utils/web";

import { clearUnprotectedLogs, getAllLogs, importLogRecords } from "./db";
import { settings } from "./settings";
import { LogExport, LoggedMessage, LogRecord, LogStatus } from "./types";

const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

function isStatus(value: unknown): value is LogStatus {
    return value === LogStatus.DELETED || value === LogStatus.EDITED || value === LogStatus.GHOST_PINGED;
}

function inferStatus(message: LoggedMessage): LogStatus | undefined {
    if (message.ghostPinged) return LogStatus.GHOST_PINGED;
    if (message.deleted) return LogStatus.DELETED;
    if (message.editHistory?.length) return LogStatus.EDITED;
}

function normalizeRecord(value: unknown): LogRecord | undefined {
    if (!isObject(value) || !("message" in value) || !isObject(value.message)) return;

    const { message } = value;
    if (!("id" in message) || typeof message.id !== "string"
        || !("channel_id" in message) || typeof message.channel_id !== "string"
        || !("timestamp" in message) || typeof message.timestamp !== "string" || Number.isNaN(Date.parse(message.timestamp))
        || !("author" in message) || !isObject(message.author)
        || !("id" in message.author) || typeof message.author.id !== "string") return;

    const { author } = message;
    const normalizedMessage = {
        ...message,
        author: {
            ...author,
            username: "username" in author && typeof author.username === "string" ? author.username : "Unknown User"
        },
        content: "content" in message && typeof message.content === "string" ? message.content : "",
        attachments: "attachments" in message && Array.isArray(message.attachments) ? message.attachments : [],
        embeds: "embeds" in message && Array.isArray(message.embeds) ? message.embeds : [],
        mentions: "mentions" in message && Array.isArray(message.mentions) ? message.mentions : [],
        editHistory: "editHistory" in message && Array.isArray(message.editHistory) ? message.editHistory : []
    } as LoggedMessage;
    const status = "status" in value && isStatus(value.status) ? value.status : inferStatus(normalizedMessage);
    if (!status) return;

    return {
        message_id: normalizedMessage.id,
        channel_id: normalizedMessage.channel_id,
        status,
        message: normalizedMessage,
        protected: "protected" in value && value.protected === true ? true : undefined,
        createdAt: "createdAt" in value && typeof value.createdAt === "string" ? value.createdAt : undefined,
        updatedAt: "updatedAt" in value && typeof value.updatedAt === "string" ? value.updatedAt : undefined
    };
}

function collectRecords(value: unknown, output: LogRecord[], depth = 0) {
    if (depth > 3) return;
    if (Array.isArray(value)) {
        value.forEach(item => collectRecords(item, output, depth + 1));
        return;
    }

    const record = normalizeRecord(value);
    if (record) {
        output.push(record);
        return;
    }

    if (isObject(value) && "messages" in value) collectRecords(value.messages, output, depth + 1);
}

export async function exportLogs() {
    const messages = await getAllLogs();
    exportLogRecords(messages, "illegal-message-logger");
    return messages.length;
}

export function exportLogRecords(messages: LogRecord[], prefix: string) {
    const data: LogExport = {
        format: "IllegalMessageLogger",
        version: 1,
        exportedAt: new Date().toISOString(),
        messages
    };
    const filename = `${prefix}-${data.exportedAt.slice(0, 10)}.json`;
    saveFile(new File([JSON.stringify(data)], filename, { type: "application/json" }));
}

export async function importLogs() {
    const file = await chooseFile("application/json,.json");
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) throw new Error("The selected backup is larger than 100 MB.");

    const parsed: unknown = JSON.parse(await file.text());
    const records: LogRecord[] = [];
    collectRecords(parsed, records);
    if (records.length === 0) throw new Error("The selected file contains no compatible message logs.");

    const uniqueRecords = [...new Map(records.map(record => [record.message_id, record])).values()];
    if (settings.store.replaceOnImport) await clearUnprotectedLogs();
    await importLogRecords(uniqueRecords);
    return uniqueRecords.length;
}
