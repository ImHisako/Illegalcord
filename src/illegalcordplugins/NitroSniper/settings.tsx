/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, PlainSettings, SettingsStore } from "@api/Settings";
import { Button } from "@components/Button";
import { Notice } from "@components/Notice";
import { OptionType } from "@utils/types";
import { showToast } from "@webpack/common";

import { SniperLegalWarning } from "../_legalWarnings";
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
                        showToast({ text: "Test webhook sent successfully.", variant: "success" });
                    })
                    .catch((error: unknown) => {
                        showToast({ text: getToastErrorMessage(error), variant: "critical" });
                    });
            }}
        >
            Send Test Webhook
        </Button>
    );
}

export function CaptchaWarning() {
    return (
        <>
            <SniperLegalWarning />
            <Notice.Warning>
                When enabled, NoneCap receives the site key, request data, Discord page URL, and your user agent, and may spend credits. NitroSniper opens Discord&apos;s CAPTCHA modal if NoneCap is disabled or fails.
            </Notice.Warning>
        </>
    );
}

const previousSettings: Record<string, unknown> | undefined = PlainSettings.plugins.NitroSniper;
const removedSettings = ["captchaProvider", "noCaptchaAiApiKey", "voidSolverApiKey", "voidSolverProxy"];
if (previousSettings && removedSettings.some(key => Object.hasOwn(previousSettings, key))) {
    if (typeof previousSettings.captchaProvider === "string" && previousSettings.captchaProvider !== "nonecap") {
        previousSettings.useNoneCap ??= false;
    }
    for (const key of removedSettings) delete previousSettings[key];
    SettingsStore.markAsChanged();
}

export const settings = definePluginSettings({
    preCheckGiftCodes: {
        type: OptionType.BOOLEAN,
        description: "Skip gifts Discord already knows are unavailable without waiting for a network check.",
        default: true,
        restartNeeded: false
    },
    ignoreOwnGiftLinks: {
        type: OptionType.BOOLEAN,
        description: "Do not redeem Nitro gift links from messages sent by you.",
        default: false,
        restartNeeded: false
    },
    useNoneCap: {
        type: OptionType.BOOLEAN,
        description: "Use NoneCap when an API key is configured.",
        default: true
    },
    noneCapApiKey: {
        type: OptionType.STRING,
        description: "NoneCap API key for automatically solving Nitro redemption CAPTCHAs. Leave empty to use Discord's CAPTCHA modal.",
        default: "",
        placeholder: "nc_live_...",
        componentProps: {
            type: "password",
            autoComplete: "new-password"
        }
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
