/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PluginNative } from "@utils/types";

import type {
    ClaimOutcome,
    WebhookEmbed,
    WebhookField,
    WebhookPayload,
    WebhookResult
} from "./types";

const SUCCESS_COLOR = 0x43b581;
const FAILURE_COLOR = 0xf04747;
const TEST_COLOR = 0x5865f2;
const WEBHOOK_NAME = "NitroSniper";

function parseWebhookUrl(webhookUrl: string) {
    const trimmed = webhookUrl.trim();
    if (!trimmed) return null;

    try {
        return new URL(trimmed);
    } catch {
        throw new Error("Webhook URL is invalid.");
    }
}

function getNative() {
    const native = (globalThis as any).VencordNative?.pluginHelpers?.NitroSniper as PluginNative<typeof import("./native")> | undefined;
    if (!native) {
        throw new Error("Webhook sending requires desktop native support.");
    }

    return native;
}

async function getNightyGiftWebhookConfig() {
    try {
        return await getNative().getNightyGiftWebhookConfig();
    } catch {
        return null;
    }
}

async function resolveWebhookUrl(manualWebhookUrl: string): Promise<string> {
    const nightyConfig = await getNightyGiftWebhookConfig();
    if (nightyConfig?.enabled && nightyConfig.url.trim()) {
        return nightyConfig.url;
    }

    return manualWebhookUrl;
}

function createPayload(embeds: WebhookEmbed[]): WebhookPayload {
    return {
        username: WEBHOOK_NAME,
        embeds,
        allowed_mentions: {
            parse: []
        }
    };
}

function escapeMarkdown(value: string) {
    return value.replace(/([\\`*_{}[\\]()#+.!|>~-])/g, "\\$1");
}

function buildClaimFields(outcome: ClaimOutcome): WebhookField[] {
    const resultText = outcome.result === "claimed"
        ? `Successfully claimed! (${outcome.latencyMs}ms)`
        : `Failed to claim! (${outcome.latencyMs}ms)`;

    return [
        { name: "Code", value: `\`\`\`${outcome.code}\`\`\``, inline: false },
        { name: "Result", value: resultText, inline: true },
        { name: "Type", value: outcome.giftType ? escapeMarkdown(outcome.giftType) : "Unknown", inline: true },
        { name: "Claimed By", value: outcome.claimedByUserId ? `<@${outcome.claimedByUserId}>` : "Unknown", inline: true },
        { name: "Latency", value: `${outcome.latencyMs}ms`, inline: true },
        { name: "API Code", value: `\`${outcome.apiStatus}\``, inline: true }
    ];
}

function getResultPresentation(result: WebhookResult) {
    switch (result) {
        case "claimed":
            return {
                title: "✅ Nitro Claimed Successfully!",
                color: SUCCESS_COLOR
            };
        case "failed":
        default:
            return {
                title: "❌ Nitro Claim Failed!",
                color: FAILURE_COLOR
            };
    }
}

function buildClaimEmbed(outcome: ClaimOutcome): WebhookEmbed {
    const presentation = getResultPresentation(outcome.result);

    return {
        title: presentation.title,
        color: presentation.color,
        fields: buildClaimFields(outcome),
        timestamp: new Date().toISOString(),
        footer: {
            text: WEBHOOK_NAME
        }
    };
}

function buildTestWebhookPayload(): WebhookPayload {
    return createPayload([
        {
            title: "NitroSniper Webhook Test",
            color: TEST_COLOR,
            description: "Your NitroSniper webhook is configured correctly.",
            timestamp: new Date().toISOString(),
            footer: {
                text: WEBHOOK_NAME
            }
        }
    ]);
}

function buildClaimWebhookPayload(outcome: ClaimOutcome): WebhookPayload {
    return createPayload([
        buildClaimEmbed(outcome)
    ]);
}

function parseWebhookError(data: string, status: number) {
    if (!data) {
        return `Webhook request failed with status ${status}.`;
    }

    try {
        const body = JSON.parse(data) as { message?: string; errors?: unknown; };
        const detail = [
            body.message,
            body.errors ? JSON.stringify(body.errors) : null
        ]
            .filter(Boolean)
            .join(" ");

        return detail
            ? `Webhook request failed with status ${status}: ${detail}`
            : `Webhook request failed with status ${status}.`;
    } catch {
        return `Webhook request failed with status ${status}: ${data}`;
    }
}

async function postWebhook(url: URL, payload: WebhookPayload) {
    const { status, data } = await getNative().sendWebhook(url.toString(), JSON.stringify(payload));

    if (status < 200 || status >= 300) {
        throw new Error(parseWebhookError(data, status));
    }
}

export async function sendClaimWebhook(manualWebhookUrl: string, outcome: ClaimOutcome) {
    const url = parseWebhookUrl(await resolveWebhookUrl(manualWebhookUrl));
    if (!url) return;

    await postWebhook(url, buildClaimWebhookPayload(outcome));
}

export async function sendTestWebhook(manualWebhookUrl: string) {
    const url = parseWebhookUrl(await resolveWebhookUrl(manualWebhookUrl));
    if (!url) {
        throw new Error("No webhook URL is configured. Set one in Nighty Nitro Sniper script, or enter one below.");
    }

    await postWebhook(url, buildTestWebhookPayload());
}
