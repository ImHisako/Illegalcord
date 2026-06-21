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

function TestWebhookButton() {
    const { webhookUrl } = settings.use(["webhookUrl"]);
    const disabled = webhookUrl.trim().length === 0;

    return (
        <Button
            disabled={disabled}
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
    skipRepeatedCodes: {
        type: OptionType.BOOLEAN,
        description: "Do not redeem Nitro gift codes already seen since the plugin started.",
        default: true,
        restartNeeded: false
    },
    webhookUrl: {
        type: OptionType.STRING,
        description: "Discord webhook URL to notify after each redeem attempt. Leave empty to disable.",
        default: "",
        restartNeeded: false
    },
    testWebhook: {
        type: OptionType.COMPONENT,
        description: "Send a test message to the configured webhook.",
        component: TestWebhookButton
    }
});
