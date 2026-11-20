/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { makeLazy } from "@utils/lazy";
import { React, UserStore } from "@webpack/common";
import type { DispatchWithoutAction } from "react";

import type { SentTrailMediaItem, SentTrailRecord } from "./types";

const STORAGE_PREFIX = "kamidere-send-trail:";
const getStore = makeLazy(() => DataStore.createStore(IS_REPORTER ? "VencordDataReporter" : "VencordData", "VencordStore"));
const signals = new Set<DispatchWithoutAction>();
const recordCache = new Map<string, SentTrailRecord[]>();

function getCachedRecords(userId: string | null) {
    if (!userId) return [];
    return recordCache.get(userId) ?? [];
}

function setCachedRecords(userId: string | null, records: SentTrailRecord[]) {
    if (!userId) return;
    recordCache.set(userId, records);
}

export function hasSentTrailRecord(userId: string | null, channelId: string, messageId: string) {
    if (!userId) return false;
    return getCachedRecords(userId).some(record =>
        record.channelId === channelId &&
        record.messageId === messageId,
    );
}

function emit() {
    signals.forEach(signal => signal());
}

function getStorageKey(userId: string) {
    return `${STORAGE_PREFIX}${userId}`;
}

async function updateRecords(userId: string, updater: (records: SentTrailRecord[] | undefined) => SentTrailRecord[] | undefined) {
    const key = getStorageKey(userId);
    let recovered = false;
    await getStore()("readwrite", store => new Promise<void>((resolve, reject) => {
        const request = store.get(key);
        void DataStore.promisifyRequest(store.transaction).then(resolve, (error: unknown) =>
            reject(error ?? new Error("Could not update Send Trail history.")));
        store.transaction.onerror = (event: Event) => {
            if (event.target instanceof IDBRequest) reject(event.target.error);
        };
        request.onsuccess = request.onerror = (event: Event) => {
            const { error } = request;
            if (error) {
                if (error.name !== "NotReadableError" || !error.message.includes("irrecoverable")) return;
                event.preventDefault();
                event.stopPropagation();
                recovered = true;
            }
            try {
                const existing: SentTrailRecord[] | undefined = recovered ? [...getCachedRecords(userId)] : request.result;
                const records = updater(existing);
                if (records !== undefined || recovered) store.put(records ?? existing, key);
            } catch (error) {
                reject(error);
            }
        };
    }));

    if (recovered) {
        void showNotification({
            title: "Send Trail tracking restored",
            body: "The saved history was damaged. Tracking has resumed using the entries still available in memory. Earlier entries may be missing.",
        });
    }
}

export async function getSentTrailRecords(userId: string | null) {
    if (!userId) return [];
    const records = await DataStore.get<SentTrailRecord[]>(getStorageKey(userId), getStore()).catch(async (error: unknown) => {
        if (!(error instanceof DOMException) || error.name !== "NotReadableError" || !error.message.includes("irrecoverable")) throw error;
        let records: SentTrailRecord[] = [];
        await updateRecords(userId, existing => { records = existing ?? []; });
        return records;
    });
    const nextRecords = records ?? [];
    setCachedRecords(userId, nextRecords);
    return nextRecords;
}

export async function appendSentTrailRecord(record: SentTrailRecord) {
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId) return;
    let nextRecords = getCachedRecords(userId);

    await updateRecords(userId, (existing: SentTrailRecord[] | undefined) => {
        const records = existing ?? [];
        const index = records.findIndex(existingRecord =>
            existingRecord.channelId === record.channelId &&
            existingRecord.messageId === record.messageId,
        );

        if (index === -1) {
            records.unshift(record);
        } else {
            records[index] = {
                ...records[index],
                ...record,
            };
        }

        records.sort((left, right) => right.timestamp - left.timestamp);
        nextRecords = records;
        return records;
    });

    setCachedRecords(userId, nextRecords);
    emit();
}

export async function mergeSentTrailRecordMedia(
    channelId: string,
    messageId: string,
    media: SentTrailMediaItem[],
    metadata?: Partial<Pick<SentTrailRecord, "guildId" | "jumpLink" | "channelNameSnapshot" | "guildNameSnapshot" | "recipientUserIds">>,
) {
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId || media.length === 0) return;

    let nextRecords: SentTrailRecord[] | undefined;

    await updateRecords(userId, records => {
        if (!records?.length) return;
        const index = records.findIndex(record => record.channelId === channelId && record.messageId === messageId);
        if (index === -1) return;

        const current = records[index];
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

        records[index] = nextRecord;
        nextRecords = records;
        return records;
    });

    if (nextRecords) {
        setCachedRecords(userId, nextRecords);
        emit();
    }
}

export async function clearSentTrailRecords(userId: string | null) {
    if (!userId) return;
    await DataStore.set(getStorageKey(userId), [], getStore());
    setCachedRecords(userId, []);
    emit();
}

export async function clearSentTrailRecordsWhere(
    userId: string | null,
    predicate: (record: SentTrailRecord) => boolean,
) {
    if (!userId) return;
    let nextRecords: SentTrailRecord[] | undefined;

    await updateRecords(userId, existing => {
        const records = existing ?? [];
        const filtered = records.filter(record => !predicate(record));
        if (filtered.length === records.length) {
            if (getCachedRecords(userId).some(predicate)) nextRecords = records;
            return;
        }
        nextRecords = filtered;
        return filtered;
    });

    if (nextRecords) {
        setCachedRecords(userId, nextRecords);
        emit();
    }
}

export function removeSentTrailRecord(userId: string | null, channelId: string, messageId: string) {
    return clearSentTrailRecordsWhere(userId, record => record.channelId === channelId && record.messageId === messageId);
}

export function useSentTrailRecords(userId: string | null) {
    const [signal, setSignal] = React.useReducer(value => value + 1, 0);
    const [records, setRecords] = React.useState<SentTrailRecord[]>(() => getCachedRecords(userId));
    const [pending, setPending] = React.useState(() => !!userId && !recordCache.has(userId));
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
            setPending(!!userId && !recordCache.has(userId));
            if (!userId) setRecords([]);
        }

        void getSentTrailRecords(userId).then(nextRecords => {
            if (!isAlive) return;
            setRecords(nextRecords);
            setPending(false);
        });

        return () => {
            isAlive = false;
        };
    }, [userId, signal]);

    return [records, pending] as const;
}
