/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DBSchema, IDBPDatabase, openDB } from "idb";

import { createSearchMatcher } from "./search";
import { LogPage, LogRecord, LogStats, LogStatus, LogViewStatus } from "./types";

const DB_NAME = "MessageLoggerIDB";
const DB_VERSION = 2;

interface MessageLoggerDatabase extends DBSchema {
    messages: {
        key: string;
        value: LogRecord;
        indexes: {
            by_channel_id: string;
            by_status: LogStatus;
            by_status_and_id: [LogStatus, string];
            by_timestamp: string;
            by_timestamp_and_message_id: [string, string];
        };
    };
}

let databasePromise: Promise<IDBPDatabase<MessageLoggerDatabase>> | undefined;
let statsCache: LogStats | undefined;
let statsRevision = 0;

export function getDatabase() {
    return databasePromise ??= openDB<MessageLoggerDatabase>(DB_NAME, DB_VERSION, {
        upgrade(database, oldVersion, _newVersion, transaction) {
            if (oldVersion === 0) {
                const store = database.createObjectStore("messages", { keyPath: "message_id" });
                store.createIndex("by_channel_id", "channel_id");
                store.createIndex("by_status", "status");
                store.createIndex("by_timestamp", "message.timestamp");
                store.createIndex("by_timestamp_and_message_id", ["channel_id", "message.timestamp"]);
            }
            transaction.objectStore("messages").createIndex("by_status_and_id", ["status", "message_id"]);
        }
    });
}

export async function applyBatch(records: LogRecord[], deletedIds: string[]) {
    if (records.length === 0 && deletedIds.length === 0) return;

    const database = await getDatabase();
    const updatedAt = new Date().toISOString();
    for (let offset = 0; offset < Math.max(records.length, deletedIds.length); offset += 250) {
        const batch = records.slice(offset, offset + 250);
        const transaction = database.transaction("messages", "readwrite");
        const existingRecords = await Promise.all(batch.map(record => transaction.store.get(record.message_id)));
        await Promise.all([
            ...batch.map((record, index) => transaction.store.put({
                ...record,
                protected: record.protected ?? existingRecords[index]?.protected,
                createdAt: existingRecords[index]?.createdAt ?? record.createdAt ?? updatedAt,
                updatedAt
            })),
            ...deletedIds.slice(offset, offset + 250).map(id => transaction.store.delete(id)),
            transaction.done
        ]);
        statsCache = undefined;
        statsRevision++;
    }
}

export async function getLogPage(status: LogViewStatus, newest: boolean, limit: number, query: string, cursor?: string, signal?: AbortSignal): Promise<LogPage> {
    const database = await getDatabase();
    signal?.throwIfAborted();
    const transaction = database.transaction("messages");
    const range = status !== "ALL"
        ? IDBKeyRange.bound([status, !newest && cursor ? cursor : ""], [status, newest && cursor ? cursor : "\uffff"], !!cursor && !newest, !!cursor && newest)
        : cursor
        ? newest ? IDBKeyRange.upperBound(cursor, true) : IDBKeyRange.lowerBound(cursor, true)
        : undefined;
    const direction = newest ? "prev" : "next";
    const matchesSearch = createSearchMatcher(query);
    const records: LogRecord[] = [];
    const source = status === "ALL" ? transaction.store : transaction.store.index("by_status_and_id");
    let next = await source.openCursor(range, direction);
    let lastScannedId: string | undefined;

    while (next) {
        signal?.throwIfAborted();
        const record = next.value;
        if (matchesSearch(record)) {
            if (records.length === limit) break;
            records.push(record);
        }
        lastScannedId = record.message_id;
        next = await next.continue();
    }

    const total = status === "ALL"
        ? await transaction.store.count()
        : await transaction.store.index("by_status").count(status);
    await transaction.done;

    return {
        records,
        cursor: lastScannedId,
        hasMore: next != null,
        total
    };
}

export async function getChannelLogsAfter(channelId: string, timestamp: string, signal: AbortSignal) {
    const database = await getDatabase();
    if (signal.aborted) return [];
    const index = database.transaction("messages").store.index("by_timestamp_and_message_id");
    const range = IDBKeyRange.bound([channelId, timestamp], [channelId, "\uffff"]);
    const records = await index.getAll(range, 100);
    return records.filter(record => record.status !== LogStatus.EDITED);
}

async function getOldestIds(limit: number, cutoff?: string, preservedChannelId?: string) {
    if (limit <= 0) return [];

    const database = await getDatabase();
    const index = database.transaction("messages").store.index("by_timestamp");
    const range = cutoff ? IDBKeyRange.upperBound(cutoff) : undefined;
    const ids: string[] = [];
    let cursor = await index.openCursor(range);

    while (cursor && ids.length < limit) {
        if (!cursor.value.protected && cursor.value.channel_id !== preservedChannelId) ids.push(cursor.value.message_id);
        cursor = await cursor.continue();
    }

    return ids;
}

export async function deleteLogs(ids: string[]) {
    const database = await getDatabase();

    for (let offset = 0; offset < ids.length; offset += 500) {
        const transaction = database.transaction("messages", "readwrite");
        await Promise.all([
            ...ids.slice(offset, offset + 500).map(id => transaction.store.delete(id)),
            transaction.done
        ]);
    }
    if (ids.length > 0) {
        statsCache = undefined;
        statsRevision++;
    }
}

export async function clearLogs() {
    const database = await getDatabase();
    await database.clear("messages");
    statsCache = undefined;
    statsRevision++;
}

export async function clearUnprotectedLogs() {
    const database = await getDatabase();
    const ids: string[] = [];
    let cursor = await database.transaction("messages").store.openCursor();

    while (cursor) {
        if (!cursor.value.protected) ids.push(cursor.value.message_id);
        cursor = await cursor.continue();
    }

    await deleteLogs(ids);
}

export async function setLogProtected(messageId: string, value: boolean) {
    const database = await getDatabase();
    const transaction = database.transaction("messages", "readwrite");
    const record = await transaction.store.get(messageId);
    if (!record) return;

    record.protected = value;
    record.updatedAt = new Date().toISOString();
    await transaction.store.put(record);
    await transaction.done;
    statsCache = undefined;
    statsRevision++;
    return record;
}

export async function setLogsProtected(messageIds: string[], value: boolean) {
    const database = await getDatabase();

    for (let offset = 0; offset < messageIds.length; offset += 250) {
        const transaction = database.transaction("messages", "readwrite");
        const ids = messageIds.slice(offset, offset + 250);
        const records = await Promise.all(ids.map(id => transaction.store.get(id)));
        const updatedAt = new Date().toISOString();
        await Promise.all([
            ...records.filter(record => record != null).map(record => transaction.store.put({ ...record, protected: value, updatedAt })),
            transaction.done
        ]);
    }

    statsCache = undefined;
    statsRevision++;
}

export async function getAllLogs() {
    const database = await getDatabase();
    return database.getAll("messages");
}

export async function importLogRecords(records: LogRecord[]) {
    await applyBatch(records, []);
}

export async function getLogStats(includeStorage = false, signal?: AbortSignal): Promise<LogStats> {
    if (statsCache && (!includeStorage || statsCache.estimatedBytes !== undefined)) return statsCache;

    const database = await getDatabase();
    signal?.throwIfAborted();
    const revision = statsRevision;
    const transaction = database.transaction("messages");
    const [total, deleted, edited, ghostPinged] = await Promise.all([
        transaction.store.count(),
        transaction.store.index("by_status").count(LogStatus.DELETED),
        transaction.store.index("by_status").count(LogStatus.EDITED),
        transaction.store.index("by_status").count(LogStatus.GHOST_PINGED)
    ]);
    const stats: LogStats = { total, deleted, edited, ghostPinged };
    if (includeStorage) {
        const encoder = new TextEncoder();
        stats.protected = 0;
        stats.estimatedBytes = 0;
        let cursor = await transaction.store.openCursor();

        while (cursor) {
            signal?.throwIfAborted();
            if (cursor.value.protected) stats.protected++;
            stats.estimatedBytes += encoder.encode(JSON.stringify(cursor.value)).byteLength;
            cursor = await cursor.continue();
        }
    }
    await transaction.done;
    if (revision === statsRevision) statsCache = stats;
    return stats;
}

export async function runMaintenance(messageLimit: number, retentionDays: number, preservedChannelId?: string) {
    const database = await getDatabase();

    if (retentionDays > 0) {
        const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
        let oldIds: string[];
        do {
            oldIds = await getOldestIds(500, cutoff, preservedChannelId);
            await deleteLogs(oldIds);
        } while (oldIds.length === 500);
    }

    if (messageLimit > 0) {
        let excess = await database.count("messages") - messageLimit;
        while (excess > 0) {
            const ids = await getOldestIds(Math.min(excess, 500));
            if (ids.length === 0) break;
            await deleteLogs(ids);
            excess -= ids.length;
        }
    }
}
