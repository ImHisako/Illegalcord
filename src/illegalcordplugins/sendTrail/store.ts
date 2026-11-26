/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { makeLazy } from "@utils/lazy";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import { React, UserStore } from "@webpack/common";
import type { DispatchWithoutAction } from "react";

import type { SentTrailMediaItem, SentTrailRecord } from "./types";

const STORAGE_PREFIX = "kamidere-send-trail:";
const getLegacyStore = makeLazy(() => DataStore.createStore(IS_REPORTER ? "VencordDataReporter" : "VencordData", "VencordStore"));
const getStore = makeLazy(() => {
    const databaseName = IS_REPORTER ? "SendTrailDataReporter" : "SendTrailData";
    let store = DataStore.createStore(databaseName, "SendTrailStore");
    const retryStore: DataStore.UseStore = async (mode, callback) => {
        let opened = false;
        try {
            return await store(mode, objectStore => {
                opened = true;
                return callback(objectStore);
            });
        } catch (error) {
            if (!(error instanceof DOMException) || error.name !== "UnknownError") throw error;
            if (!opened) store = DataStore.createStore(databaseName, "SendTrailStore");
            await sleep(250);
            return store(mode, callback).catch((cause: unknown) => {
                throw new Error("Could not access the separate Send Trail history database after retrying.", { cause });
            });
        }
    };
    return retryStore;
});
const logger = new Logger("SendTrail");
const migrations = new Map<string, Promise<void>>();
const signals = new Set<DispatchWithoutAction>();
const CACHE_LIMIT = 200;
const recordCache = new Map<string, SentTrailRecord>();
let generation = 0;
let recoveryNotificationOpen = false;

function getCachedRecords(userId: string | null) {
    if (!userId) return [];
    const prefix = `${getStorageKey(userId)}:`;
    return [...recordCache].filter(([key]) => key.startsWith(prefix)).map(([, record]) => record);
}

function remember(key: string, record: SentTrailRecord) {
    recordCache.delete(key);
    recordCache.set(key, record);
    if (recordCache.size > CACHE_LIMIT) {
        const oldest = recordCache.keys().next().value;
        if (oldest !== undefined) recordCache.delete(oldest);
    }
}

export async function hasSentTrailRecord(userId: string | null, channelId: string, messageId: string) {
    if (!userId) return false;
    await migrateRecords(userId);
    return await readRecord(getRecordKey(userId, channelId, messageId)) !== undefined;
}

function emit() {
    signals.forEach(signal => signal());
}

function getStorageKey(userId: string) {
    return `${STORAGE_PREFIX}${userId}`;
}

function getRecordKey(userId: string, channelId: string, messageId: string) {
    return `${getStorageKey(userId)}:${channelId}:${messageId}`;
}

function getRecordRange(userId: string) {
    const prefix = `${getStorageKey(userId)}:`;
    return IDBKeyRange.bound(prefix, `${prefix}\uffff`);
}

function isLostFile(error: unknown): boolean {
    return error instanceof DOMException && error.name === "NotReadableError" && error.message.includes("irrecoverable");
}

function migrateRecords(userId: string) {
    let migration = migrations.get(userId);
    if (!migration) {
        migration = (async () => {
            const key = getStorageKey(userId);
            const existing = await DataStore.get<SentTrailRecord[] | true>(key, getStore()).catch((error: unknown) => {
                if (!isLostFile(error)) throw error;
                return getCachedRecords(userId);
            });
            if (existing === true) return;
            let unreadable = false;
            const records = existing ?? await DataStore.get<SentTrailRecord[]>(key, getLegacyStore()).catch((error: unknown) => {
                if (!(error instanceof DOMException) || (error.name !== "UnknownError" && !isLostFile(error))) throw error;
                unreadable = true;
                logger.warn("Could not read the previous Send Trail history. The original archive was left unchanged.", error);
                return getCachedRecords(userId);
            });
            await updateValue<SentTrailRecord[] | true>(key, (current, store) => {
                if (current === true) return;
                for (const record of current ?? records ?? [])
                    store.put(record, getRecordKey(userId, record.channelId, record.messageId));
                return true;
            }, () => getCachedRecords(userId));
            if (unreadable) {
                void showNotification({
                    title: "Send Trail uses a separate archive",
                    body: "The previous history could not be read and was left unchanged. New messages will be saved in a separate archive.",
                });
            }
        })().catch((error: unknown) => {
            migrations.delete(userId);
            throw error;
        });
        migrations.set(userId, migration);
    }
    return migration;
}

async function updateValue<T>(key: string, updater: (value: T | undefined, store: IDBObjectStore) => T | undefined, fallback: () => T | undefined) {
    let recovered = false;
    let result: T | undefined;
    await getStore()("readwrite", store => new Promise<void>((resolve, reject) => {
        recovered = false;
        result = undefined;
        const request = store.get(key);
        void DataStore.promisifyRequest(store.transaction).then(resolve, (error: unknown) =>
            reject(error ?? new Error("Could not update Send Trail history.")));
        store.transaction.onerror = (event: Event) => {
            if (event.target instanceof IDBRequest) reject(event.target.error);
        };
        request.onsuccess = request.onerror = (event: Event) => {
            const { error } = request;
            if (error) {
                if (!isLostFile(error)) return;
                event.preventDefault();
                event.stopPropagation();
                recovered = true;
            }
            try {
                result = updater(recovered ? fallback() : request.result, store);
                if (result !== undefined) store.put(result, key);
                else if (recovered) store.delete(key);
            } catch (error) {
                store.transaction.abort();
                reject(error);
            }
        };
    }));

    if (recovered && !recoveryNotificationOpen) {
        recoveryNotificationOpen = true;
        void showNotification({
            title: "Send Trail tracking restored",
            body: "Damaged history entries were recovered from memory when available. Other saved entries were left unchanged.",
            onClose: () => { recoveryNotificationOpen = false; }
        }).catch(error => {
            recoveryNotificationOpen = false;
            logger.warn("Could not show the history recovery notification.", error);
        });
    }
    return result;
}

async function readRecord(key: string) {
    return DataStore.get<SentTrailRecord>(key, getStore()).catch((error: unknown) => {
        if (!isLostFile(error)) throw error;
        return updateValue<SentTrailRecord>(key, value => value, () => recordCache.get(key));
    });
}

export async function getSentTrailRecords(userId: string | null) {
    if (!userId) return [];
    const run = generation;
    await migrateRecords(userId);
    const range = getRecordRange(userId);
    const records = await getStore()("readonly", store => DataStore.promisifyRequest(store.getAll(range) as IDBRequest<SentTrailRecord[]>))
        .catch(async (error: unknown) => {
            if (!isLostFile(error)) throw error;
            const keys = await getStore()("readonly", store => DataStore.promisifyRequest(store.getAllKeys(range) as IDBRequest<string[]>));
            const recovered: SentTrailRecord[] = [];
            for (let offset = 0; offset < keys.length; offset += 250) {
                const batch = await Promise.all(keys.slice(offset, offset + 250).map(readRecord));
                for (const record of batch) if (record) recovered.push(record);
            }
            return recovered;
        });
    records.sort((left, right) => right.timestamp - left.timestamp);
    if (run === generation) {
        for (const record of records.slice(0, CACHE_LIMIT))
            remember(getRecordKey(userId, record.channelId, record.messageId), record);
    }
    return records;
}

export async function appendSentTrailRecord(record: SentTrailRecord) {
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId) return;
    const run = generation;
    await migrateRecords(userId);
    const key = getRecordKey(userId, record.channelId, record.messageId);
    const next = await updateValue<SentTrailRecord>(key, existing => ({ ...existing, ...record }), () => recordCache.get(key));
    if (next && run === generation) {
        remember(key, next);
        emit();
    }
}

export async function mergeSentTrailRecordMedia(
    channelId: string,
    messageId: string,
    media: SentTrailMediaItem[],
    metadata?: Partial<Pick<SentTrailRecord, "guildId" | "jumpLink" | "channelNameSnapshot" | "guildNameSnapshot" | "recipientUserIds">>,
) {
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId || media.length === 0) return;
    const run = generation;
    await migrateRecords(userId);
    const key = getRecordKey(userId, channelId, messageId);
    const next = await updateValue<SentTrailRecord>(key, current => {
        if (!current) return;
        let nextMedia = current.media;

        for (const item of media) {
            const duplicate = nextMedia.some(existingMedia =>
                existingMedia.source === item.source &&
                existingMedia.kind === item.kind &&
                existingMedia.url === item.url,
            );

            if (duplicate) continue;
            if (nextMedia === current.media) nextMedia = [...current.media];
            nextMedia.push(item);
        }

        const nextRecord: SentTrailRecord = {
            ...current,
            media: nextMedia,
            hasMedia: nextMedia.length > 0,
            guildId: metadata?.guildId ?? current.guildId,
            jumpLink: metadata?.jumpLink ?? current.jumpLink,
            channelNameSnapshot: metadata?.channelNameSnapshot ?? current.channelNameSnapshot,
            guildNameSnapshot: metadata?.guildNameSnapshot ?? current.guildNameSnapshot,
            recipientUserIds: metadata?.recipientUserIds ?? current.recipientUserIds,
        };

        if (
            nextRecord.hasMedia === current.hasMedia &&
            nextRecord.media === current.media &&
            nextRecord.jumpLink === current.jumpLink &&
            nextRecord.guildId === current.guildId &&
            nextRecord.channelNameSnapshot === current.channelNameSnapshot &&
            nextRecord.guildNameSnapshot === current.guildNameSnapshot &&
            (nextRecord.recipientUserIds?.join(",") ?? "") === (current.recipientUserIds?.join(",") ?? "")
        ) {
            return;
        }

        return nextRecord;
    }, () => recordCache.get(key));

    if (next && run === generation) {
        remember(key, next);
        emit();
    }
}

export async function clearSentTrailRecords(userId: string | null) {
    if (!userId) return;
    await migrateRecords(userId);
    const range = getRecordRange(userId);
    await getStore()("readwrite", store => {
        store.delete(range);
        return DataStore.promisifyRequest(store.transaction);
    });
    for (const key of recordCache.keys()) if (range.includes(key)) recordCache.delete(key);
    emit();
}

export async function clearSentTrailRecordsWhere(
    userId: string | null,
    predicate: (record: SentTrailRecord) => boolean,
) {
    if (!userId) return;
    await migrateRecords(userId);
    const range = getRecordRange(userId);
    const remove = () => getStore()("readwrite", store => new Promise<void>((resolve, reject) => {
        const request = store.openCursor(range);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            if (predicate(cursor.value)) cursor.delete();
            cursor.continue();
        };
        void DataStore.promisifyRequest(store.transaction).then(resolve, reject);
    }));
    await remove().catch(async (error: unknown) => {
        if (!isLostFile(error)) throw error;
        await getSentTrailRecords(userId);
        await remove();
    });
    for (const [key, record] of recordCache) if (range.includes(key) && predicate(record)) recordCache.delete(key);
    emit();
}

export async function removeSentTrailRecord(userId: string | null, channelId: string, messageId: string) {
    if (!userId) return;
    await migrateRecords(userId);
    const key = getRecordKey(userId, channelId, messageId);
    await DataStore.del(key, getStore());
    recordCache.delete(key);
    emit();
}

export function stopStore() {
    generation++;
    recordCache.clear();
    migrations.clear();
}

export function useSentTrailRecords(userId: string | null) {
    const [signal, setSignal] = React.useReducer(value => value + 1, 0);
    const [records, setRecords] = React.useState<SentTrailRecord[]>(() => getCachedRecords(userId));
    const [pending, setPending] = React.useState(() => !!userId);
    const previousUserIdRef = React.useRef<string | null | undefined>(void 0);

    React.useEffect(() => {
        signals.add(setSignal);
        return () => void signals.delete(setSignal);
    }, []);

    React.useEffect(() => {
        let isAlive = true;
        const userChanged = previousUserIdRef.current !== userId;
        previousUserIdRef.current = userId;

        if (userChanged) {
            const cachedRecords = getCachedRecords(userId);
            setRecords(cachedRecords);
            setPending(!!userId);
            if (!userId) setRecords([]);
        }

        void getSentTrailRecords(userId).then(nextRecords => {
            if (!isAlive) return;
            setRecords(nextRecords);
            setPending(false);
        }).catch(error => {
            logger.error("Could not load Send Trail history.", error);
            if (isAlive) setPending(false);
        });

        return () => {
            isAlive = false;
        };
    }, [userId, signal]);

    return [records, pending] as const;
}
