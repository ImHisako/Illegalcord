/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface ClaimRequest {
    code: string;
    source: "discord" | "nighty";
    detectedAccount?: string;
    detectedAccountId?: string;
    authorId?: string;
    authorName?: string;
    authorUsername?: string;
    authorAvatarUrl?: string;
    channelId?: string;
    channelName?: string;
    guildId?: string;
    guildName?: string;
    messageId?: string;
}

export interface NightyGiftDetection {
    code: string;
    accountName: string;
    guildName: string;
    channelName: string;
    authorName: string;
}

export type WebhookResult = "claimed" | "failed";

export interface WebhookField {
    name: string;
    value: string;
    inline?: boolean;
}

export interface WebhookEmbed {
    title: string;
    color: number;
    description?: string;
    fields?: WebhookField[];
    timestamp: string;
    author?: {
        name: string;
        icon_url?: string;
    };
    footer?: {
        text: string;
    };
}

export interface WebhookPayload {
    username: string;
    embeds: WebhookEmbed[];
    allowed_mentions: {
        parse: string[];
    };
}

export interface NativeWebhookResponse {
    status: number;
    data: string;
}

export interface CaptchaProps {
    captchaService?: string;
    sitekey: string;
    captchaSessionId?: string;
    options: {
        rqdata?: string;
        rqtoken?: string;
    };
}

export interface CaptchaResult {
    captcha_key: string;
    captcha_rqtoken?: string;
    captcha_session_id?: string;
}

export interface NativeCaptchaResponse {
    success: boolean;
    token?: string;
    error?: string;
}

export interface CaptchaSolverOptions {
    provider: "nonecap" | "bruxsolver";
    proxy?: string;
    powType?: "" | "hsw" | "hsl";
}

export interface NativeSolverAccountResponse {
    success: boolean;
    remainingSolves?: number;
    threadLimit?: number;
    threadsInUse?: number;
    availableThreads?: number;
    error?: string;
}

export interface GiftCodeResolution {
    store_listing?: {
        sku?: {
            name?: string;
        };
    };
    subscription_plan?: {
        name?: string;
    };
}
