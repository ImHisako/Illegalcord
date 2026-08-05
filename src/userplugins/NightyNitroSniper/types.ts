/*
Made by luxed
I am not responsible for any damage caused by this plugin; use at your own risk
*/

export type WebhookResult = "claimed" | "failed";

export interface ClaimOutcome {
    result: WebhookResult;
    code: string;
    giftType: string | null;
    latencyMs: number;
    apiStatus: number | string;
    claimedByUserId?: string;
}

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

export interface NightyGiftWebhookConfig {
    enabled: boolean;
    url: string;
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
