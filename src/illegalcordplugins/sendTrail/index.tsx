/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { MessageObject, SendMessageOptions } from "@api/MessageEvents";
import { ClockIcon } from "@components/Icons";
import SettingsPlugin from "@plugins/_core/settings";
import { Devs } from "@utils/constants";
import { LazyComponent } from "@utils/lazyReact";
import { Logger } from "@utils/Logger";
import { removeFromArray, sleep } from "@utils/misc";
import definePlugin from "@utils/types";
import { ChannelStore, GuildStore, MessageStore, UserStore } from "@webpack/common";

import { removeKamidereRuntimeTask, SEND_TRAIL_PURGE_TASK_ID } from "../_kamidereCompat/runtimeActivity";
import RuntimeActivityButton from "../_kamidereCompat/RuntimeActivityButton";
import { settings } from "./settings";
import { appendSentTrailRecord, clearSentTrailRecordsWhere, hasSentTrailRecord, mergeSentTrailRecordMedia, removeSentTrailRecord } from "./store";
import type { MessageCreatePayload, MessageDeletePayload, MessageUpdatePayload, PendingSendDraft, SendTrailMessage, SentTrailRecord } from "./types";
import { buildJumpLink, collectMessageMediaItems, getChannelRecipientIds, getMessageDisplayContent, getMessageTimestamp, getRecordPreview, hasMediaLinks, isForwardedMessage, makeAttachmentSignature, makeUploadSignature, normalizeContent } from "./utils";

const DRAFT_TTL_MS = 20_000;
const MIN_MATCH_SCORE = 4;
const SEND_TRAIL_SETTINGS_KEY = "kamidere_send_trail";
const SendTrailTab = LazyComponent(() => require("./SendTrailTab").default);
const logger = new Logger("SendTrail");

let draftCounter = 0;
let generation = 0;
const pendingDrafts = new Map<string, PendingSendDraft>();

function cleanupExpiredDrafts(now = Date.now()) {
    for (const [key, draft] of pendingDrafts.entries()) {
        if (now - draft.createdAt > DRAFT_TTL_MS) {
            pendingDrafts.delete(key);
        }
    }
}

function createPendingDraft(channelId: string, messageObj: MessageObject, options: SendMessageOptions) {
    const ownerId = UserStore.getCurrentUser()?.id;
    if (!ownerId) return;
    cleanupExpiredDrafts();

    const content = options.content ?? messageObj.content ?? "";
    const normalizedContent = normalizeContent(content);
    const localId = `${Date.now()}-${++draftCounter}`;

    pendingDrafts.set(localId, {
        localId,
        ownerId,
        channelId,
        createdAt: Date.now(),
        content,
        normalizedContent,
        hasText: normalizedContent.length > 0,
        mediaHint: (options.uploads?.length ?? 0) > 0 || hasMediaLinks(content),
        uploadSignature: makeUploadSignature({ uploads: options.uploads }),
        replyMessageId: options.messageReference?.message_id,
    });
}

function getDraftScore(draft: PendingSendDraft, payload: MessageCreatePayload) {
    const { message } = payload;
    if (draft.channelId !== message.channel_id || draft.ownerId !== message.author?.id) return Number.NEGATIVE_INFINITY;

    const now = Date.now();
    if (now - draft.createdAt > DRAFT_TTL_MS) return Number.NEGATIVE_INFINITY;

    const normalizedContent = normalizeContent(getMessageDisplayContent(message, message.content ?? ""));
    const attachmentSignature = makeAttachmentSignature(message.attachments ?? []);
    const media = collectMessageMediaItems(message);

    let score = 2;

    if (draft.normalizedContent === normalizedContent) {
        score += 6;
    } else if (!draft.normalizedContent && !normalizedContent) {
        score += 3;
    }

    if (draft.replyMessageId && draft.replyMessageId === (message.messageReference ?? message.message_reference)?.message_id) {
        score += 2;
    }

    if (draft.uploadSignature && draft.uploadSignature === attachmentSignature) {
        score += 4;
    } else if (!draft.uploadSignature && !attachmentSignature) {
        score += 1;
    }

    if (draft.mediaHint === (media.length > 0)) {
        score += 1;
    }

    if (draft.mediaHint && media.length > 0) {
        score += 2;
    }

    if (draft.hasText === (normalizedContent.length > 0)) {
        score += 1;
    }

    score -= Math.min(4, Math.abs(now - draft.createdAt) / 2000);
    return score;
}

function resolveBestDraft(payload: MessageCreatePayload) {
    let bestDraft: PendingSendDraft | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const draft of pendingDrafts.values()) {
        const score = getDraftScore(draft, payload);
        if (score > bestScore || (score === bestScore && bestDraft && draft.createdAt > bestDraft.createdAt)) {
            bestDraft = draft;
            bestScore = score;
        }
    }

    if (!bestDraft || bestScore < MIN_MATCH_SCORE) return null;

    pendingDrafts.delete(bestDraft.localId);
    return bestDraft;
}

function buildRecord(message: SendTrailMessage, eventGuildId?: string, draft?: PendingSendDraft | null): SentTrailRecord {
    const channel = ChannelStore.getChannel(message.channel_id);
    const guildId = eventGuildId ?? message.guild_id ?? channel?.guild_id ?? "@me";
    const guild = guildId !== "@me" ? GuildStore.getGuild(guildId) : null;
    const timestamp = getMessageTimestamp(message);
    const content = getMessageDisplayContent(message, draft?.content ?? "");
    const media = collectMessageMediaItems(message);
    const normalizedContent = normalizeContent(content);

    return {
        id: `${message.channel_id}:${message.id}`,
        messageId: message.id,
        channelId: message.channel_id,
        guildId,
        timestamp,
        content,
        preview: getRecordPreview(content),
        hasText: normalizedContent.length > 0,
        hasMedia: media.length > 0,
        jumpLink: buildJumpLink(guildId, message.channel_id, message.id),
        media,
        channelNameSnapshot: channel?.name ?? undefined,
        guildNameSnapshot: guild?.name ?? undefined,
        recipientUserIds: getChannelRecipientIds(channel),
        replyMessageId: (message.messageReference ?? message.message_reference)?.message_id ?? draft?.replyMessageId,
    };
}

async function maybeEnrichRecord(payload: MessageUpdatePayload) {
    const currentUserId = UserStore.getCurrentUser()?.id;
    if (!currentUserId) return;

    const cachedMessage = MessageStore.getMessage(payload.message.channel_id, payload.message.id);
    const message = cachedMessage ?? payload.message;
    if ((message.author?.id ?? payload.message.author?.id) !== currentUserId) return;

    const media = collectMessageMediaItems(payload.message);
    if (cachedMessage) media.push(...collectMessageMediaItems(cachedMessage));
    if (!media.length) return;

    const channel = ChannelStore.getChannel(message.channel_id);
    const guildId = payload.guildId ?? payload.message.guild_id ?? channel?.guild_id ?? "@me";
    const guild = guildId !== "@me" ? GuildStore.getGuild(guildId) : null;

    await mergeSentTrailRecordMedia(
        message.channel_id,
        message.id,
        media,
        {
            guildId,
            jumpLink: buildJumpLink(guildId, message.channel_id, message.id),
            channelNameSnapshot: channel?.name ?? undefined,
            guildNameSnapshot: guild?.name ?? undefined,
            recipientUserIds: getChannelRecipientIds(channel),
        },
    );
}

async function maybeCreateRecordFromUpdate(payload: MessageUpdatePayload) {
    const currentUserId = UserStore.getCurrentUser()?.id;
    if (!currentUserId) return;

    const cachedMessage = MessageStore.getMessage(payload.message.channel_id, payload.message.id);
    const message = cachedMessage && isForwardedMessage(cachedMessage) ? cachedMessage : payload.message;

    if ((message.author?.id ?? cachedMessage?.author.id) !== currentUserId) return;
    if (!isForwardedMessage(message)) return;
    if (hasSentTrailRecord(currentUserId, message.channel_id, message.id)) return;

    const record = buildRecord(message, payload.guildId ?? payload.message.guild_id);

    await appendSentTrailRecord(record);
}

async function enrichFromStore(channelId: string, messageId: string, guildId?: string) {
    const message = MessageStore.getMessage(channelId, messageId);
    if (!message) return false;

    const media = collectMessageMediaItems(message);
    if (!media.length) return false;

    const channel = ChannelStore.getChannel(channelId);
    const effectiveGuildId = guildId ?? channel?.guild_id ?? "@me";
    const guild = effectiveGuildId !== "@me" ? GuildStore.getGuild(effectiveGuildId) : null;

    await mergeSentTrailRecordMedia(
        channelId,
        messageId,
        media,
        {
            guildId: effectiveGuildId,
            jumpLink: buildJumpLink(effectiveGuildId, channelId, messageId),
            channelNameSnapshot: channel?.name ?? undefined,
            guildNameSnapshot: guild?.name ?? undefined,
            recipientUserIds: getChannelRecipientIds(channel),
        },
    );

    return true;
}

function scheduleEnrichment(ownerId: string, channelId: string, messageId: string, guildId: string) {
    const scheduledGeneration = generation;
    void (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
            await sleep(900 + attempt * 1200);
            if (scheduledGeneration !== generation || UserStore.getCurrentUser()?.id !== ownerId) return;
            if (await enrichFromStore(channelId, messageId, guildId)) break;
        }
    })().catch(error => logger.error("Could not update media in Send Trail.", error));
}

function unregisterSendTrailSettingsTab() {
    while (SettingsPlugin.customEntries.some(entry => entry.key === SEND_TRAIL_SETTINGS_KEY)) {
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === SEND_TRAIL_SETTINGS_KEY);
    }
}

function registerSendTrailSettingsTab() {
    unregisterSendTrailSettingsTab();

    SettingsPlugin.customEntries.push({
        key: SEND_TRAIL_SETTINGS_KEY,
        title: "Kamidere Send Trail",
        Component: SendTrailTab,
        Icon: ClockIcon,
    });
}

export default definePlugin({
    name: "SendTrail",
    description: "Tracks your newly sent messages, lets you select them, and purges them in a dedicated Illegalcord settings page.",
    authors: [Devs.clrxxo],
    dependencies: ["Settings", "MessageEventsAPI", "HeaderBarAPI"],
    enabledByDefault: true,
    tags: ["Chat", "Utility"],
    requiresRestart: false,
    settings,
    headerBarButton: {
        icon: ClockIcon,
        render: () => <RuntimeActivityButton />
    },

    start() {
        registerSendTrailSettingsTab();
    },

    stop() {
        generation++;
        pendingDrafts.clear();
        removeKamidereRuntimeTask(SEND_TRAIL_PURGE_TASK_ID);
        unregisterSendTrailSettingsTab();
    },

    onBeforeMessageSend(channelId, messageObj, options) {
        createPendingDraft(channelId, messageObj, options);
    },

    flux: {
        async MESSAGE_CREATE(payload: MessageCreatePayload) {
            cleanupExpiredDrafts();

            if (payload.optimistic || payload.type !== "MESSAGE_CREATE") return;
            if (payload.message.state === "SENDING") return;

            const currentUserId = UserStore.getCurrentUser()?.id;
            if (!currentUserId || payload.message.author?.id !== currentUserId) return;

            const draft = resolveBestDraft(payload);
            if (!draft && !isForwardedMessage(payload.message)) return;

            const currentGeneration = generation;
            const record = buildRecord(payload.message, payload.guildId, draft);
            await appendSentTrailRecord(record);
            if (generation === currentGeneration) scheduleEnrichment(currentUserId, record.channelId, record.messageId, record.guildId);
        },

        async MESSAGE_UPDATE(payload: MessageUpdatePayload) {
            cleanupExpiredDrafts();
            await maybeCreateRecordFromUpdate(payload);
            await maybeEnrichRecord(payload);
        },

        async MESSAGE_DELETE(payload: MessageDeletePayload) {
            await removeSentTrailRecord(UserStore.getCurrentUser()?.id ?? null, payload.channelId, payload.id);
        },
        async MESSAGE_DELETE_BULK({ ids, channelId }: { ids: string[]; channelId: string; }) {
            const deletedIds = new Set(ids);
            await clearSentTrailRecordsWhere(UserStore.getCurrentUser()?.id ?? null, record => record.channelId === channelId && deletedIds.has(record.messageId));
        },
    },
});
