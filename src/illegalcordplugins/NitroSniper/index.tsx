/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { type PluginNative } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { filters, find, findByPropsLazy } from "@webpack";
import { ChannelStore, GuildStore, IconUtils, UserStore } from "@webpack/common";

import { resolveGiftType } from "./giftCode";
import { CaptchaWarning, settings } from "./settings";
import type { CaptchaProps, CaptchaResult, ClaimRequest, WebhookResult } from "./types";
import { sendClaimWebhook } from "./webhook";

const GIFT_LINK_REGEX = /(?:discord\.gift\/|discord\.com\/gifts?\/)([a-zA-Z0-9]{16,24})(?![a-zA-Z0-9])/g;
const UNKNOWN_GIFT_CODE = 10038;
const GIFT_REDEMPTION_EXHAUSTED = 50050;

const logger = new Logger("NitroSniper");
const GiftActions = findByPropsLazy("redeemGiftCode");
const Native = VencordNative?.pluginHelpers?.NitroSniper as PluginNative<typeof import("./native")> | undefined;

interface GiftCodeStore {
    get(code: string): { redeemed: boolean; isClaimed: boolean; revoked: boolean; } | null;
    getError(code: string): { code?: number; } | undefined;
    getIsResolved(code: string): boolean;
}

let giftCodeStore: GiftCodeStore | null;
let startTime = 0;
let claiming = false;
let altListenerId = 0;
const claimQueue: ClaimRequest[] = [];
const seenCodes = new Set<string>();

function resetState() {
    startTime = Date.now();
    claimQueue.length = 0;
    claiming = false;
    seenCodes.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function toError(error: unknown) {
    if (error instanceof Error) return error;

    const body = isRecord(error) && isRecord(error.body) ? error.body : null;
    const message = body && typeof body.message === "string"
        ? body.message
        : isRecord(error) && typeof error.message === "string"
            ? error.message
            : null;
    const status = isRecord(error) && typeof error.status === "number" ? error.status : null;
    const detail = status !== null
        ? `Discord returned status ${status}${message ? `: ${message}` : ""}`
        : message ?? "Discord rejected the gift redemption";

    return new Error(/[.!?]$/.test(detail) ? detail : `${detail}.`);
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

function createClaimRequest(message: Message, code: string): ClaimRequest {
    const authorId = message.author?.id;
    const channel = ChannelStore.getChannel(message.channel_id);
    const guildId = channel?.guild_id;
    const currentUser = UserStore.getCurrentUser();

    return {
        code,
        source: "discord",
        detectedAccount: currentUser.globalName ?? currentUser.username,
        detectedAccountId: currentUser.id,
        authorId,
        authorName: message.author?.globalName ?? message.author?.username,
        authorUsername: message.author?.username,
        authorAvatarUrl: message.author ? IconUtils.getUserAvatarURL(message.author, false, 128) : undefined,
        channelId: message.channel_id,
        channelName: channel?.name,
        guildId,
        guildName: guildId ? GuildStore.getGuild(guildId)?.name : undefined,
        messageId: message.id
    };
}

function notifyClaim(result: WebhookResult, request: ClaimRequest) {
    const { webhookUrl } = settings.store;
    if (request.source === "nighty" || !webhookUrl.trim()) return;

    void resolveGiftType(request.code)
        .then(giftType => sendClaimWebhook(webhookUrl, result, request, giftType))
        .catch(webhookError => {
            logger.error("Failed to send NitroSniper webhook notification", webhookError);
        });
}

function continueQueue() {
    claimQueue.shift();
    claiming = false;
    void processQueue();
}

function enqueueClaim(request: ClaimRequest) {
    if (seenCodes.has(request.code)) return;
    seenCodes.add(request.code);
    claimQueue.push(request);
    if (claimQueue.length === 1) void processQueue();
}

async function listenForNightyAltGifts() {
    if (!Native) return;

    const listenerId = ++altListenerId;
    try {
        const error = await Native.startNightyAltDetection();
        if (error) {
            logger.warn(error);
            return;
        }

        while (listenerId === altListenerId) {
            const detection = await Native.waitForNightyGiftCode();
            if (!detection || listenerId !== altListenerId) return;
            enqueueClaim({
                code: detection.code,
                source: "nighty",
                detectedAccount: detection.accountName,
                authorName: detection.authorName,
                channelName: detection.channelName,
                guildName: detection.guildName
            });
        }
    } catch (error) {
        logger.error("Nighty alt gift detection failed.", toError(error));
    }
}

function handleClaimSuccess(request: ClaimRequest) {
    logger.info(`Successfully redeemed code: ${request.code}`);
    continueQueue();
    notifyClaim("claimed", request);
}

function handleClaimFailure(request: ClaimRequest, error: Error) {
    logger.error(`Failed to redeem code: ${request.code}`, error);
    continueQueue();
    notifyClaim("failed", request);
}

function isUnavailableGift(code: string) {
    if (!giftCodeStore) return false;

    const gift = giftCodeStore.get(code);
    if (gift) return gift.redeemed || gift.isClaimed || gift.revoked;

    const error = giftCodeStore.getError(code);
    return error
        ? error.code === UNKNOWN_GIFT_CODE || error.code === GIFT_REDEMPTION_EXHAUSTED
        : giftCodeStore.getIsResolved(code);
}

async function processQueue() {
    const { preCheckGiftCodes } = settings.store;
    while (preCheckGiftCodes && claimQueue.length && isUnavailableGift(claimQueue[0].code)) {
        logger.debug("Skipped a gift already known to be unavailable.");
        claimQueue.shift();
    }

    const [request] = claimQueue;
    if (!request) return;

    claiming = true;

    try {
        await GiftActions.redeemGiftCode({ code: request.code });
    } catch (error) {
        if (claimQueue[0] === request) handleClaimFailure(request, toError(error));
        return;
    }
    if (claimQueue[0] === request) handleClaimSuccess(request);
}

export default definePlugin({
    name: "NitroSniper",
    description: "Automatically redeems Nitro gift links sent in chat.",
    authors: [
        EquicordDevs.neoarz,
        EquicordDevs.irritably
    ],
    tags: ["Chat", "Utility"],
    searchTerms: ["nitro", "gift", "redeem", "snipe"],
    settings,
    settingsAboutComponent: CaptchaWarning,
    patches: [{
        find: '"X-Captcha-Key"',
        replacement: {
            match: /return (\i)\.showCaptchaAsync\((\i)\((\i)\.body\)\)/,
            replace: "return $self.solveCaptcha($2($3.body),$1.showCaptchaAsync.bind($1))"
        }
    }],

    async solveCaptcha(props: CaptchaProps, showCaptcha: (props: CaptchaProps) => Promise<CaptchaResult>) {
        const { captchaProvider, noneCapApiKey, bruxSolverApiKey, bruxSolverProxy, bruxSolverPowType } = settings.store;
        const apiKey = (captchaProvider === "bruxsolver" ? bruxSolverApiKey : noneCapApiKey).trim();
        if (!claiming || captchaProvider === "manual" || !apiKey || props.captchaService !== "hcaptcha" || !Native) {
            return showCaptcha(props);
        }

        const result = await Native.solveCaptcha(
            apiKey,
            props.sitekey,
            props.options.rqdata,
            `${location.origin}/channels/@me`,
            navigator.userAgent,
            { provider: captchaProvider, proxy: bruxSolverProxy.trim(), powType: bruxSolverPowType }
        );
        if (!result.success || !result.token) {
            logger.error(result.error ?? "CAPTCHA solve failed.");
            return showCaptcha(props);
        }

        return {
            captcha_key: result.token,
            captcha_rqtoken: props.options.rqtoken,
            captcha_session_id: props.captchaSessionId
        };
    },

    start() {
        giftCodeStore = find(filters.byStoreName("GiftCodeStore"), { isIndirect: true });
        resetState();
        void listenForNightyAltGifts();
    },

    stop() {
        altListenerId++;
        giftCodeStore = null;
        void Native?.stopNightyAltDetection();
        resetState();
        void Native?.cancelCaptchaSolves();
    },

    flux: {
        MESSAGE_CREATE({ message }: { message: Message; }) {
            if (!message.content || shouldSkipMessage(message) || isMessageOlderThanStart(message)) return;

            for (const [, code] of message.content.matchAll(GIFT_LINK_REGEX)) {
                if (!seenCodes.has(code)) enqueueClaim(createClaimRequest(message, code));
            }
        }
    }
});
