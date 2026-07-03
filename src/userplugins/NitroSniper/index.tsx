/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { Message } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, UserStore } from "@webpack/common";

import { settings } from "./settings";
import type { ClaimRequest, WebhookResult } from "./types";
import { sendClaimWebhook } from "./webhook";

const GIFT_LINK_REGEX = /(?:discord\.gift\/|discord\.com\/gifts?\/)([a-zA-Z0-9]{16,24})/;

const logger = new Logger("NitroSniper");
const GiftActions = findByPropsLazy("redeemGiftCode");

let startTime = 0;
let claiming = false;
const claimQueue: ClaimRequest[] = [];
const seenCodes = new Set<string>();

function resetState() {
    startTime = Date.now();
    claimQueue.length = 0;
    seenCodes.clear();
    claiming = false;
}

function toError(error: unknown) {
    return error instanceof Error ? error : new Error(String(error));
}

function isOwnMessage(message: Message) {
    return message.author?.id === UserStore.getCurrentUser()?.id;
}

function shouldSkipMessage(message: Message) {
    return settings.store.ignoreOwnGiftLinks && isOwnMessage(message);
}

function isMessageOlderThanStart(message: Message) {
    return new Date(message.timestamp).getTime() < startTime;
}

function extractGiftCode(content: string) {
    return content.match(GIFT_LINK_REGEX)?.[1] ?? null;
}

function shouldSkipCode(code: string) {
    if (!settings.store.skipRepeatedCodes) return false;
    if (seenCodes.has(code)) return true;
    seenCodes.add(code);
    return false;
}

function createClaimRequest(message: Message): ClaimRequest | null {
    const code = message.content ? extractGiftCode(message.content) : null;
    if (!code) return null;

    const authorId = message.author?.id;
    const authorAvatar = message.author?.avatar;

    return {
        code,
        authorId,
        authorName: message.author?.globalName ?? message.author?.username,
        authorUsername: message.author?.username,
        authorAvatarUrl: authorId && authorAvatar
            ? `https://cdn.discordapp.com/avatars/${authorId}/${authorAvatar}.png?size=128`
            : undefined,
        channelId: message.channel_id,
        guildId: ChannelStore.getChannel(message.channel_id)?.guild_id,
        messageId: message.id
    };
}

function notifyClaim(result: WebhookResult, request: ClaimRequest) {
    void sendClaimWebhook(
        settings.store.webhookUrl,
        result,
        request
    ).catch(webhookError => {
        logger.error("Failed to send NitroSniper webhook notification", webhookError);
    });
}

function notifyClaimAttempt(request: ClaimRequest) {
    const sender = request.authorName ?? request.authorUsername;
    showNotification({
        title: "Nitro redemption attempt",
        body: sender
            ? `Trying to redeem a Nitro gift code sent by ${sender}.`
            : "Trying to redeem a Nitro gift code."
    });
}

function continueQueue() {
    claiming = false;
    processQueue();
}

function handleClaimSuccess(request: ClaimRequest) {
    logger.log(`Successfully redeemed code: ${request.code}`);
    notifyClaim("claimed", request);
    continueQueue();
}

function handleClaimFailure(request: ClaimRequest, error: Error) {
    logger.error(`Failed to redeem code: ${request.code}`, error);
    notifyClaim("failed", request);
    continueQueue();
}

function processQueue() {
    if (claiming) return;

    const request = claimQueue.shift();
    if (!request) return;

    if (!GiftActions?.redeemGiftCode) {
        logger.error("GiftActions module not found. Cannot redeem gift codes.");
        claiming = false;
        return;
    }

    claiming = true;
    notifyClaimAttempt(request);
    GiftActions.redeemGiftCode({
        code: request.code,
        onRedeemed: () => handleClaimSuccess(request),
        onError: (error: unknown) => handleClaimFailure(request, toError(error))
    });
}

export default definePlugin({
    name: "NitroSniper",
    description: "Automatically redeems Nitro gift links sent in chat",
    authors: [{
        name: "neoarz",
        id: 218675193592283137n
    }],
    tags: ["Chat", "Utility"],
    searchTerms: ["nitro", "gift", "redeem", "snipe"],
    settings,

    start() {
        resetState();
    },

    stop() {
        resetState();
    },

    flux: {
        MESSAGE_CREATE({ message }: { message: Message; }) {
            if (!message.content || shouldSkipMessage(message) || isMessageOlderThanStart(message)) return;

            const request = createClaimRequest(message);
            if (!request || shouldSkipCode(request.code)) return;

            claimQueue.push(request);
            processQueue();
        }
    }
});
