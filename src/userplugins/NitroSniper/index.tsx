/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import definePlugin, { type PluginNative } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, IconUtils, UserStore } from "@webpack/common";

import { resolveGiftType } from "./giftCode";
import { CaptchaWarning, settings } from "./settings";
import type { CaptchaProps, CaptchaResult, ClaimRequest, WebhookResult } from "./types";
import { sendClaimWebhook } from "./webhook";

const GIFT_LINK_REGEX = /(?:discord\.gift\/|discord\.com\/gifts?\/)([a-zA-Z0-9]{16,24})/;

const logger = new Logger("NitroSniper");
const GiftActions = findByPropsLazy("redeemGiftCode");
const Native = VencordNative?.pluginHelpers?.NitroSniper as PluginNative<typeof import("./native")> | undefined;

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

function createClaimRequest(message: Message): ClaimRequest | null {
    const code = message.content ? extractGiftCode(message.content) : null;
    if (!code) return null;

    const authorId = message.author?.id;

    return {
        code,
        authorId,
        authorName: message.author?.globalName ?? message.author?.username,
        authorUsername: message.author?.username,
        authorAvatarUrl: message.author ? IconUtils.getUserAvatarURL(message.author, false, 128) : undefined,
        channelId: message.channel_id,
        guildId: ChannelStore.getChannel(message.channel_id)?.guild_id,
        messageId: message.id
    };
}

function notifyClaim(result: WebhookResult, request: ClaimRequest, giftType: string | null) {
    void sendClaimWebhook(
        settings.store.webhookUrl,
        result,
        request,
        giftType
    ).catch(webhookError => {
        logger.error("Failed to send NitroSniper webhook notification", webhookError);
    });
}

function continueQueue() {
    claiming = false;
    processQueue();
}

function enqueueClaim(request: ClaimRequest) {
    if (seenCodes.has(request.code)) return;
    seenCodes.add(request.code);
    claimQueue.push(request);
    processQueue();
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
            const code = await Native.waitForNightyGiftCode();
            if (!code || listenerId !== altListenerId) return;
            enqueueClaim({ code });
        }
    } catch (error) {
        logger.error("Nighty alt gift detection failed.", toError(error));
    }
}

function handleClaimSuccess(request: ClaimRequest, giftType: Promise<string | null>) {
    logger.info(`Successfully redeemed code: ${request.code}`);
    void giftType.then(type => notifyClaim("claimed", request, type));
    continueQueue();
}

function handleClaimFailure(request: ClaimRequest, error: Error, giftType: Promise<string | null>) {
    logger.error(`Failed to redeem code: ${request.code}`, error);
    void giftType.then(type => notifyClaim("failed", request, type));
    continueQueue();
}

function processQueue() {
    if (claiming) return;

    const request = claimQueue.shift();
    if (!request) return;

    claiming = true;
    const giftType = settings.store.webhookUrl.trim()
        ? resolveGiftType(request.code)
        : Promise.resolve(null);

    void GiftActions.redeemGiftCode({ code: request.code }).then(
        () => handleClaimSuccess(request, giftType),
        (error: unknown) => handleClaimFailure(request, toError(error), giftType)
    );
}

export default definePlugin({
    name: "NitroSniper",
    description: "Automatically redeems Nitro gift links sent in chat.",
    authors: [
        { name: "neoarz", id: 1015372540937502851n },
        { name: "irritably", id: 928787166916640838n }
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
        const { captchaProvider } = settings.store;
        const apiKey = captchaProvider === "nocaptchaai"
            ? settings.store.noCaptchaAiApiKey.trim()
            : captchaProvider === "voidsolver"
                ? settings.store.voidSolverApiKey.trim()
                : settings.store.noneCapApiKey.trim();
        if (!claiming || !apiKey || props.captchaService !== "hcaptcha" || !Native) {
            return showCaptcha(props);
        }

        const result = await Native.solveCaptcha(
            captchaProvider,
            apiKey,
            captchaProvider === "voidsolver" ? settings.store.voidSolverProxy.trim() || undefined : undefined,
            props.sitekey,
            props.options.rqdata,
            `${location.origin}/channels/@me`,
            navigator.userAgent
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
        resetState();
        void listenForNightyAltGifts();
    },

    stop() {
        altListenerId++;
        void Native?.stopNightyAltDetection();
        resetState();
        void Native?.cancelCaptchaSolves();
    },

    flux: {
        MESSAGE_CREATE({ message }: { message: Message; }) {
            if (!message.content || shouldSkipMessage(message) || isMessageOlderThanStart(message)) return;

            const request = createClaimRequest(message);
            if (!request) return;

            enqueueClaim(request);
        }
    }
});
