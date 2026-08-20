/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Notice } from "@components/Notice";
import { OptionType } from "@utils/types";
import { Button, showToast, Toasts } from "@webpack/common";

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

export function CaptchaWarning() {
    return (
        <>
            <SniperLegalWarning />
            <Notice.Warning>
                Automatic CAPTCHA solving sends the site key, request data, Discord page URL, and your user agent to the selected third-party service and may spend credits. If solving fails, NitroSniper opens Discord&apos;s CAPTCHA modal. NoCaptchaAI does not currently document hCaptcha token tasks, so its compatible task mode may stop working if the provider rejects it.
            </Notice.Warning>
        </>
    );
}

export const settings = definePluginSettings({
    ignoreOwnGiftLinks: {
        type: OptionType.BOOLEAN,
        description: "Do not redeem Nitro gift links from messages sent by you.",
        default: false,
        restartNeeded: false
    },
    captchaProvider: {
        type: OptionType.SELECT,
        description: "Service used to solve Nitro redemption hCaptchas.",
        options: [
            { label: "NoneCap", value: "nonecap", default: true },
            { label: "NoCaptchaAI", value: "nocaptchaai" },
            { label: "VoidSolver", value: "voidsolver" }
        ]
    },
    noneCapApiKey: {
        type: OptionType.STRING,
        description: "NoneCap API key for automatically solving Nitro redemption CAPTCHAs. Leave empty to use Discord's CAPTCHA modal.",
        default: "",
        placeholder: "nc_live_...",
        hidden: () => settings.store.captchaProvider !== "nonecap",
        componentProps: {
            type: "password",
            autoComplete: "new-password"
        }
    },
    noCaptchaAiApiKey: {
        type: OptionType.STRING,
        description: "NoCaptchaAI API key for automatically solving Nitro redemption hCaptchas. Leave empty to use Discord's CAPTCHA modal.",
        default: "",
        placeholder: "nocap_...",
        hidden: () => settings.store.captchaProvider !== "nocaptchaai",
        componentProps: {
            type: "password",
            autoComplete: "new-password"
        }
    },
    voidSolverApiKey: {
        type: OptionType.STRING,
        description: "VoidSolver API key for automatically solving Nitro redemption hCaptchas. Leave empty to use Discord's CAPTCHA modal.",
        default: "",
        placeholder: "VoidSolver API key",
        hidden: () => settings.store.captchaProvider !== "voidsolver",
        componentProps: {
            type: "password",
            autoComplete: "new-password"
        }
    },
    voidSolverProxy: {
        type: OptionType.STRING,
        description: "Optional proxy sent to VoidSolver in http://user:pass@ip:port format.",
        default: "",
        placeholder: "http://user:pass@ip:port",
        hidden: () => settings.store.captchaProvider !== "voidsolver"
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
