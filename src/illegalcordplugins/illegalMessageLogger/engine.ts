/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import MessageLogger from "@plugins/messageLogger";
import { Logger } from "@utils/Logger";
import type { Message, MessageJSON } from "@vencord/discord-types";
import { lodash, MessageStore, SelectedChannelStore, UserStore } from "@webpack/common";

import { applyBatch, clearLogs, clearUnprotectedLogs, getDatabase, runMaintenance } from "./db";
import { settings } from "./settings";
import { LoggedMessage, LogRecord, LogStatus, MessageCreatePayload, MessageDeleteBulkPayload, MessageDeletePayload, MessageUpdatePayload } from "./types";

const logger = new Logger("IllegalMessageLogger");
const recentMessages = new Map<string, LoggedMessage>();
const pendingWrites = new Map<string, LogRecord>();
const pendingDeletes = new Set<string>();
const STATUS_PRIORITY: Record<LogStatus, number> = {
    [LogStatus.EDITED]: 0,
    [LogStatus.DELETED]: 1,
    [LogStatus.GHOST_PINGED]: 2
};

let flushTimer: ReturnType<typeof setTimeout> | undefined;
let maintenanceInterval: ReturnType<typeof setInterval> | undefined;
let flushChain = Promise.resolve();
let active = false;
let lastMaintenance = 0;
let maintenanceRunning = false;

interface MessageWithToJS {
    toJS(): MessageJSON;
}

function hasToJS(message: Message | MessageJSON): message is Message & MessageWithToJS {
    return "toJS" in message && typeof message.toJS === "function";
}

function snapshotMessage(message: Message | MessageJSON): LoggedMessage {
    const raw = hasToJS(message) ? message.toJS() : message;
    const copy = { ...raw, author: { ...raw.author } } as LoggedMessage;
    const { timestamp } = copy;

    copy.timestamp = new Date(String(timestamp)).toISOString();
    copy.attachments ??= [];
    copy.embeds ??= [];
    copy.mentions ??= [];
    copy.editHistory ??= [];
    delete copy.author.email;
    delete copy.author.phone;
    delete copy.customRenderedContent;
    delete copy.__messageloggerDiff;
    delete copy.__messageloggerDiffKey;
    delete copy.__messageloggerAggregated;
    delete copy.__messageloggerLastAppliedKey;
    return lodash.cloneDeep(copy);
}

function remember(message: LoggedMessage) {
    const { memoryCacheLimit } = settings.store;
    recentMessages.delete(message.id);
    while (recentMessages.size >= memoryCacheLimit) {
        const oldestId = recentMessages.keys().next().value;
        if (!oldestId) break;
        recentMessages.delete(oldestId);
    }

    recentMessages.set(message.id, message);
}

function hasCurrentUserMention(message: LoggedMessage) {
    const currentUserId = UserStore.getCurrentUser().id;
    return message.mention_everyone || message.mentions.some(mention => mention.id === currentUserId);
}

function scheduleFlush() {
    if (flushTimer !== undefined) return;
    flushTimer = setTimeout(() => {
        flushTimer = undefined;
        void flushQueuedLogs();
    }, settings.store.batchDelayMs);
}

function queueRecord(message: LoggedMessage, status: LogStatus) {
    const pending = pendingWrites.get(message.id);
    const finalStatus = pending && STATUS_PRIORITY[pending.status] > STATUS_PRIORITY[status]
        ? pending.status
        : status;
    const pendingHistory = pending?.message.editHistory ?? [];
    const messageHistory = message.editHistory ?? [];
    if (pendingHistory.length > messageHistory.length) message = { ...message, editHistory: pendingHistory };

    pendingDeletes.delete(message.id);
    pendingWrites.set(message.id, {
        message_id: message.id,
        channel_id: message.channel_id,
        status: finalStatus,
        message,
        protected: pending?.protected
    });
    scheduleFlush();
}

function queueDelete(id: string) {
    pendingWrites.delete(id);
    pendingDeletes.add(id);
    recentMessages.delete(id);
    scheduleFlush();
}

export function flushQueuedLogs() {
    if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
    }
    if (pendingWrites.size === 0 && pendingDeletes.size === 0) return flushChain;

    const records = [...pendingWrites.values()];
    const deletedIds = [...pendingDeletes];
    pendingWrites.clear();
    pendingDeletes.clear();

    const flush = flushChain.then(async () => {
        await applyBatch(records, deletedIds);
        if (records.length > 0 && settings.store.messageLimit > 0) await runMaintenance(settings.store.messageLimit, 0);
    });
    flushChain = flush.catch(error => logger.error("Failed to flush queued logs.", error));
    return flush;
}

async function performMaintenance() {
    if (maintenanceRunning) return;
    maintenanceRunning = true;
    try {
        await flushQueuedLogs();
        const preservedChannelId = settings.store.preserveCurrentChannel
            ? SelectedChannelStore.getChannelId()
            : undefined;
        await runMaintenance(settings.store.messageLimit, settings.store.retentionDays, preservedChannelId);
        lastMaintenance = Date.now();
    } finally {
        maintenanceRunning = false;
    }
}

export function handleMessageCreate(payload: MessageCreatePayload) {
    if (!active) return;
    const { saveEdits, saveDeletes, saveGhostPings } = settings.store;
    if ((!saveEdits || MessageLogger.shouldIgnore(payload.message, true))
        && (!(saveDeletes || saveGhostPings) || MessageLogger.shouldIgnore(payload.message))) return;

    const message = snapshotMessage(payload.message);
    message.guildId = payload.guildId;
    message.ourCache = true;
    remember(message);
}

export function handleMessageUpdate(payload: MessageUpdatePayload) {
    if (!active || !settings.store.saveEdits || payload.message.content == null) return;

    let previous = recentMessages.get(payload.message.id);
    if (previous?.content === payload.message.content) return;
    if (!previous) {
        const storedMessage = MessageStore.getMessage(payload.message.channel_id, payload.message.id);
        if (storedMessage) previous = snapshotMessage(storedMessage);
    }
    if (!previous) return;
    if (previous.content === payload.message.content) {
        if (previous.editHistory?.length && !MessageLogger.shouldIgnore(previous, true)) {
            remember(previous);
            queueRecord(previous, LogStatus.EDITED);
        }
        return;
    }

    const message = { ...previous, ...lodash.cloneDeep(payload.message) };
    message.guildId = payload.guildId ?? previous.guildId;
    message.editHistory = [
        ...(previous.editHistory ?? []),
        {
            content: previous.content,
            timestamp: new Date().toISOString()
        }
    ];
    if (settings.store.maxEditHistory > 0) {
        message.editHistory = message.editHistory.slice(-settings.store.maxEditHistory);
    }

    remember(message);
    if (!MessageLogger.shouldIgnore(message, true)) queueRecord(message, LogStatus.EDITED);
}

function saveDeletedMessage(payload: MessageDeletePayload) {
    const { saveDeletes, saveGhostPings, notifyGhostPings } = settings.store;
    const cachedMessage = recentMessages.get(payload.id);
    recentMessages.delete(payload.id);
    if (!saveDeletes && !saveGhostPings) return;
    const previous = cachedMessage ?? MessageStore.getMessage(payload.channelId, payload.id);
    if (!previous || MessageLogger.shouldIgnore(previous)) return;

    const message = cachedMessage ? { ...cachedMessage } : snapshotMessage(previous);
    const ghostPinged = hasCurrentUserMention(message);
    if (!saveDeletes && !ghostPinged) return;
    message.guildId = payload.guildId ?? message.guildId;
    message.deleted = true;
    message.deletedTimestamp = new Date().toISOString();
    message.attachments = message.attachments.map(attachment => ({ ...attachment, deleted: true }));
    message.ghostPinged = ghostPinged;

    if (ghostPinged && saveGhostPings) {
        queueRecord(message, LogStatus.GHOST_PINGED);
        if (notifyGhostPings) {
            const authorName = message.author.global_name ?? message.author.globalName ?? message.author.username;
            showNotification({
                title: "Illegal Message Logger",
                body: `Captured a ghost ping from ${authorName}.`
            });
        }
    }
    else if (saveDeletes) queueRecord(message, LogStatus.DELETED);
}

export function handleMessageDelete(payload: MessageDeletePayload) {
    if (!active) return;
    if (payload.mlDeleted) return queueDelete(payload.id);
    saveDeletedMessage(payload);
}

export function handleMessageDeleteBulk(payload: MessageDeleteBulkPayload) {
    if (!active) return;

    for (const id of payload.ids) {
        if (payload.mlDeleted) queueDelete(id);
        else saveDeletedMessage({ ...payload, id });
    }
}

export async function deleteLog(id: string) {
    queueDelete(id);
    await flushQueuedLogs();
}

export async function deleteManyLogs(ids: string[]) {
    ids.forEach(queueDelete);
    await flushQueuedLogs();
}

export async function clearAllLogs(includeProtected = false) {
    await flushQueuedLogs();
    if (includeProtected) await clearLogs();
    else await clearUnprotectedLogs();
}

export async function runMaintenanceNow() {
    await performMaintenance();
}

export function startEngine() {
    active = true;
    void getDatabase()
        .then(performMaintenance)
        .catch(error => logger.error("Failed to initialize the log database.", error));
    maintenanceInterval = setInterval(() => {
        if (Date.now() - lastMaintenance >= settings.store.maintenanceIntervalMinutes * 60_000) {
            void performMaintenance().catch(error => logger.error("Failed to run log maintenance.", error));
        }
    }, 60_000);
}

export function stopEngine() {
    active = false;
    if (maintenanceInterval !== undefined) {
        clearInterval(maintenanceInterval);
        maintenanceInterval = undefined;
    }
    recentMessages.clear();
    void flushQueuedLogs();
}
