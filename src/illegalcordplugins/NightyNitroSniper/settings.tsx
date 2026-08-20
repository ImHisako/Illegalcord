/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";
import { Button, showToast, Toasts } from "@webpack/common";

import { sendTestWebhook } from "./webhook";

function getToastErrorMessage(error: unknown) {
    return error instanceof Error
        ? error.message
        : "Failed to send test webhook.";
}

const DISCORD_WEBHOOK_URL_PATTERN = /^https:\/\/(?:canary\.|ptb\.)?discord\.com\/api\/webhooks\/\d+\/[a-zA-Z0-9_-]+$/;

function isValidWebhookUrl(value: string) {
    if (!value.trim()) return true;
    return DISCORD_WEBHOOK_URL_PATTERN.test(value.trim())
        || "Must be a valid Discord webhook URL (https://discord.com/api/webhooks/...).";
}

function TestWebhookButton() {
    const { webhookUrl } = settings.use(["webhookUrl"]);

    return (
        <Button
            onClick={() => {
                void sendTestWebhook(webhookUrl)
                    .then(() => {
                        showToast("Test webhook sent successfully.", Toasts.Type.SUCCESS);
                    })
                    .catch((error: unknown) => {
                        showToast(getToastErrorMessage(error), Toasts.Type.FAILURE);
                    });
            }}
        >
            Send Test Webhook
        </Button>
    );
}

export const settings = definePluginSettings({
    ignoreOwnGiftLinks: {
        type: OptionType.BOOLEAN,
        description: "Do not redeem Nitro gift links from messages sent by you.",
        default: false,
        restartNeeded: false
    },
    webhookUrl: {
        type: OptionType.STRING,
        description: "Fallback Discord webhook URL, only used if Nighty own webhook (Nitro Sniper script) isn't set or disabled. Leave empty to rely on Nighty.",
        default: "",
        restartNeeded: false,
        isValid: isValidWebhookUrl
    },
    testWebhook: {
        type: OptionType.COMPONENT,
        description: "Send a test message to the configured webhook.",
        component: TestWebhookButton
    }
});
