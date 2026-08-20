/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { Message } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { UserStore } from "@webpack/common";

import { resolveGiftType } from "./giftCode";
import { settings } from "./settings";
import type { ClaimOutcome } from "./types";
import { sendClaimWebhook } from "./webhook";

const GIFT_LINK_REGEX = /(?:discord\.gift\/|discord\.com\/gifts?\/)([a-zA-Z0-9]{16,24})/g;

const logger = new Logger("NitroSniper");
const GiftActions = findByPropsLazy("redeemGiftCode");

let startTime = 0;
let claiming = false;
const claimQueue: string[] = [];
const seenCodes = new Set<string>();

function resetState() {
    startTime = Date.now();
    claimQueue.length = 0;
    claiming = false;
    seenCodes.clear();
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

function extractGiftCodes(content: string): string[] {
    const codes = new Set<string>();
    for (const match of content.matchAll(GIFT_LINK_REGEX)) {
        if (match[1]) codes.add(match[1]);
    }
    return [...codes];
}

function notifyClaim(outcome: ClaimOutcome) {
    void sendClaimWebhook(settings.store.webhookUrl, outcome)
        .catch(webhookError => {
            logger.error("Failed to send NitroSniper webhook notification", webhookError);
        });
}

function extractApiStatus(error: unknown): number | string {
    if (error && typeof error === "object" && typeof (error as { status?: unknown; }).status === "number") {
        return (error as { status: number; }).status;
    }
    return "ERR";
}

function continueQueue() {
    claiming = false;
    processQueue();
}

function handleClaimSuccess(code: string, giftType: Promise<string | null>, startedAt: number) {
    const latencyMs = Date.now() - startedAt;
    void giftType.then(type => notifyClaim({
        result: "claimed",
        code,
        giftType: type,
        latencyMs,
        apiStatus: 200,
        claimedByUserId: UserStore.getCurrentUser()?.id
    }));
    continueQueue();
}

function handleClaimFailure(code: string, giftType: Promise<string | null>, startedAt: number, error: unknown) {
    const latencyMs = Date.now() - startedAt;
    void giftType.then(type => notifyClaim({
        result: "failed",
        code,
        giftType: type,
        latencyMs,
        apiStatus: extractApiStatus(error),
        claimedByUserId: UserStore.getCurrentUser()?.id
    }));
    continueQueue();
}

function enqueueMessage(message: Message) {
    if (!message.content || shouldSkipMessage(message) || isMessageOlderThanStart(message)) return;

    for (const code of extractGiftCodes(message.content)) {
        if (seenCodes.has(code)) continue;
        seenCodes.add(code);
        claimQueue.push(code);
    }

    processQueue();
}

function processQueue() {
    if (claiming) return;

    const code = claimQueue.shift();
    if (!code) return;

    claiming = true;
    const giftType = resolveGiftType(code);
    const startedAt = Date.now();

    GiftActions.redeemGiftCode({
        code,
        onRedeemed: () => handleClaimSuccess(code, giftType, startedAt),
        onError: (error: unknown) => handleClaimFailure(code, giftType, startedAt, error)
    });
}

export default definePlugin({
    name: "NitroSniper Nighty Ver",
    description: "Nighty Selfbot Nitro Sniper (This plugin is mandatory only for Nighty selfbot users.",
    authors: [EquicordDevs.luxed],
    tags: ["Chat", "Utility"],
    searchTerms: ["nitro", "gift", "redeem", "snipe"],
    settings,

    start() {
        resetState();
    },

    flux: {
        MESSAGE_CREATE({ message }: { message: Message; }) {
            enqueueMessage(message);
        },
        MESSAGE_UPDATE({ message }: { message: Message; }) {
            enqueueMessage(message);
        }
    }
});
