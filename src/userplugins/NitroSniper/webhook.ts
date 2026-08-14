/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PluginNative } from "@utils/types";

import type {
    ClaimRequest,
    VoidSolverTaskResult,
    WebhookEmbed,
    WebhookField,
    WebhookPayload,
    WebhookResult } from "./types";

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
    const native = VencordNative?.pluginHelpers?.NitroSniper as PluginNative<typeof import("./native")> | undefined;
    if (!native) {
        throw new Error("Webhook sending requires desktop native support.");
    }

    return native;
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

function buildUserProfileUrl(userId?: string) {
    return userId ? `https://discord.com/users/${userId}` : null;
}

function buildMessageUrl(request: ClaimRequest) {
    if (!request.channelId || !request.messageId) return null;

    return `https://discord.com/channels/${request.guildId ?? "@me"}/${request.channelId}/${request.messageId}`;
}

function escapeMarkdown(value: string) {
    return value.replace(/([\\`*_{}[\\]()#+.!|>~-])/g, "\\$1");
}

function buildGiftTypeField(giftType: string | null): WebhookField | null {
    if (!giftType) return null;

    return {
        name: "Gift Type:",
        value: escapeMarkdown(giftType),
        inline: false
    };
}

function buildAuthorField(request: ClaimRequest): WebhookField | null {
    const label = request.authorName ?? request.authorUsername ?? request.authorId;
    if (!label) return null;

    const profileUrl = buildUserProfileUrl(request.authorId);
    return {
        name: "Sender:",
        value: profileUrl ? `[${escapeMarkdown(label)}](${profileUrl})` : escapeMarkdown(label),
        inline: false
    };
}

function buildDetectionField(request: ClaimRequest): WebhookField {
    const profileUrl = buildUserProfileUrl(request.detectedAccountId);
    const account = request.detectedAccount ?? "Unknown account";
    const source = request.source === "nighty" ? "Nighty alt detector" : "Current Discord client";

    return {
        name: "Detected account:",
        value: `${profileUrl ? `[${escapeMarkdown(account)}](${profileUrl})` : escapeMarkdown(account)}\n${source}`,
        inline: true
    };
}

function buildServerField(request: ClaimRequest): WebhookField {
    return {
        name: "Server:",
        value: escapeMarkdown(request.guildName ?? request.guildId ?? (request.source === "discord" ? "Direct message" : "Unknown server")),
        inline: true
    };
}

function buildChannelField(request: ClaimRequest): WebhookField {
    const channel = request.channelName
        ? request.channelName.startsWith("#") ? request.channelName : `#${request.channelName}`
        : request.channelId ?? "Unknown channel";

    return {
        name: "Channel:",
        value: escapeMarkdown(channel),
        inline: true
    };
}

function buildMessageField(request: ClaimRequest): WebhookField {
    const messageUrl = buildMessageUrl(request);

    return {
        name: "Jump to message:",
        value: messageUrl ? `[Open original message](${messageUrl})` : "Unavailable for Nighty alt detections.",
        inline: false
    };
}

function buildClaimLinkField(request: ClaimRequest): WebhookField {
    return {
        name: "Claim link:",
        value: `[Open Nitro gift](https://discord.gift/${request.code})`,
        inline: false
    };
}

function formatVoidSolverTimestamp(value: string | undefined) {
    if (!value) return "Unknown";
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? `<t:${Math.floor(timestamp / 1000)}:F>` : escapeMarkdown(value);
}

function buildVoidSolverFields(task: VoidSolverTaskResult | undefined): WebhookField[] {
    if (!task) return [];

    return [
        {
            name: "VoidSolver task:",
            value: `${escapeMarkdown(task.taskId)}${task.externalTaskId ? `\nExternal: ${escapeMarkdown(task.externalTaskId)}` : ""}`,
            inline: false
        },
        {
            name: "Task status:",
            value: `${escapeMarkdown(task.status)}\nToken received: ${task.status === "success" ? "Yes" : "No"}`,
            inline: true
        },
        {
            name: "Solve time:",
            value: task.solveTime === undefined ? "Unknown" : `${task.solveTime.toFixed(2)} seconds`,
            inline: true
        },
        {
            name: "Solved site:",
            value: escapeMarkdown(task.site ?? "Unknown"),
            inline: true
        },
        {
            name: "Task timeline:",
            value: `Created: ${formatVoidSolverTimestamp(task.createdAt)}\nUpdated: ${formatVoidSolverTimestamp(task.updatedAt)}`,
            inline: false
        }
    ];
}

function buildClaimFields(request: ClaimRequest, giftType: string | null, task?: VoidSolverTaskResult) {
    return [
        buildGiftTypeField(giftType),
        buildDetectionField(request),
        buildServerField(request),
        buildChannelField(request),
        buildAuthorField(request),
        buildMessageField(request),
        buildClaimLinkField(request),
        ...buildVoidSolverFields(task)
    ].filter((field): field is WebhookField => field != null);
}

function getResultPresentation(result: WebhookResult) {
    switch (result) {
        case "claimed":
            return {
                title: "Yay! Claimed a Nitro!",
                color: SUCCESS_COLOR
            };
        case "failed":
        default:
            return {
                title: "Failed to claim nitro",
                color: FAILURE_COLOR
            };
    }
}

function buildEmbedAuthor(request: ClaimRequest) {
    const name = request.authorName ?? request.authorUsername;
    if (!name) return undefined;

    return {
        name,
        icon_url: request.authorAvatarUrl
    };
}

function buildClaimEmbed(result: WebhookResult, request: ClaimRequest, giftType: string | null, task?: VoidSolverTaskResult): WebhookEmbed {
    const presentation = getResultPresentation(result);

    return {
        title: presentation.title,
        color: presentation.color,
        fields: buildClaimFields(request, giftType, task),
        timestamp: new Date().toISOString(),
        author: buildEmbedAuthor(request),
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

function buildClaimWebhookPayload(result: WebhookResult, request: ClaimRequest, giftType: string | null, task?: VoidSolverTaskResult): WebhookPayload {
    return createPayload([
        buildClaimEmbed(result, request, giftType, task)
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

export async function sendClaimWebhook(
    webhookUrl: string,
    result: WebhookResult,
    request: ClaimRequest,
    giftType: string | null,
    task?: VoidSolverTaskResult
) {
    const url = parseWebhookUrl(webhookUrl);
    if (!url) return;

    await postWebhook(url, buildClaimWebhookPayload(result, request, giftType, task));
}

export async function sendTestWebhook(webhookUrl: string) {
    const url = parseWebhookUrl(webhookUrl);
    if (!url) {
        throw new Error("Webhook URL is empty.");
    }

    await postWebhook(url, buildTestWebhookPayload());
}
