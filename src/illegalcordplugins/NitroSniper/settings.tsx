/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, migratePluginSetting, PlainSettings, SettingsStore } from "@api/Settings";
import { Button } from "@components/Button";
import { Notice } from "@components/Notice";
import { OptionType, type PluginNative } from "@utils/types";
import { showToast, useState } from "@webpack/common";

import { SniperLegalWarning } from "../_legalWarnings";
import { sendTestWebhook } from "./webhook";

const BRUXSOLVER_KEYS = ["bruxSolverApiKey"] as const;

function BruxSolverAccountButton() {
    const { bruxSolverApiKey } = settings.use(BRUXSOLVER_KEYS);
    const [checking, setChecking] = useState(false);

    return (
        <Button
            disabled={checking || !bruxSolverApiKey.trim() || IS_WEB}
            onClick={async () => {
                const native = VencordNative.pluginHelpers.NitroSniper as PluginNative<typeof import("./native")>;
                setChecking(true);
                try {
                    const result = await native.getBruxSolverAccount(bruxSolverApiKey.trim());
                    showToast({
                        text: result.success
                            ? `Remaining solves: ${result.remainingSolves}. Threads in use: ${result.threadsInUse}/${result.threadLimit}. Available threads: ${result.availableThreads}.`
                            : result.error ?? "Could not check the BruxSolver account.",
                        variant: result.success ? "success" : "critical"
                    });
                } catch {
                    showToast({ text: "Could not check the BruxSolver account.", variant: "critical" });
                } finally {
                    setChecking(false);
                }
            }}
        >
            Check Balance and Threads
        </Button>
    );
}

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
                The selected service receives the site key, request data, and Discord page URL, and may spend credits. NoneCap also receives your user agent. BruxSolver also receives your proxy if configured. NitroSniper opens Discord&apos;s CAPTCHA modal if the service is unavailable or fails.
            </Notice.Warning>
        </>
    );
}

migratePluginSetting("NitroSniper", "bruxSolverApiKey", "hisakoApiKey");
migratePluginSetting("NitroSniper", "bruxSolverProxy", "hisakoProxy");
migratePluginSetting("NitroSniper", "bruxSolverPowType", "hisakoPowType");

const previousSettings: Record<string, unknown> | undefined = PlainSettings.plugins.NitroSniper;
if (previousSettings?.captchaProvider === "hisako") {
    previousSettings.captchaProvider = "bruxsolver";
    SettingsStore.markAsChanged();
}
const removedSettings = ["useNoneCap", "noCaptchaAiApiKey", "voidSolverApiKey", "voidSolverProxy"];
if (previousSettings && removedSettings.some(key => Object.hasOwn(previousSettings, key))) {
    if (previousSettings.captchaProvider !== "bruxsolver") {
        previousSettings.captchaProvider = previousSettings.useNoneCap === false
            || typeof previousSettings.captchaProvider === "string" && previousSettings.captchaProvider !== "nonecap"
            ? "manual"
            : "nonecap";
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
    captchaProvider: {
        type: OptionType.SELECT,
        description: "Choose how to solve Nitro redemption CAPTCHAs.",
        options: [
            { label: "NoneCap", value: "nonecap", default: true },
            { label: "BruxSolver", value: "bruxsolver" },
            { label: "Discord CAPTCHA modal", value: "manual" }
        ]
    },
    noneCapApiKey: {
        type: OptionType.STRING,
        description: "NoneCap API key for automatically solving Nitro redemption CAPTCHAs. Leave empty to use Discord's CAPTCHA modal.",
        default: "",
        hidden: () => settings.store.captchaProvider !== "nonecap",
        placeholder: "nc_live_...",
        componentProps: {
            type: "password",
            autoComplete: "new-password"
        }
    },
    bruxSolverApiKey: {
        type: OptionType.STRING,
        displayName: "BruxSolver API Key",
        description: "BruxSolver API key for automatically solving Nitro redemption CAPTCHAs.",
        default: "",
        hidden: () => settings.store.captchaProvider !== "bruxsolver",
        componentProps: {
            type: "password",
            autoComplete: "new-password"
        }
    },
    bruxSolverProxy: {
        type: OptionType.STRING,
        displayName: "BruxSolver Proxy",
        description: "Optional proxy URL for BruxSolver CAPTCHA requests. Leave empty to try without a proxy.",
        default: "",
        placeholder: "http://user:pass@host:port",
        hidden: () => settings.store.captchaProvider !== "bruxsolver",
        componentProps: {
            type: "password",
            autoComplete: "new-password"
        }
    },
    bruxSolverPowType: {
        type: OptionType.SELECT,
        displayName: "BruxSolver Proof of Work",
        description: "Choose the proof of work type for BruxSolver CAPTCHA requests.",
        hidden: () => settings.store.captchaProvider !== "bruxsolver",
        options: [
            { label: "Automatic", value: "", default: true },
            { label: "HSW", value: "hsw" },
            { label: "HSL", value: "hsl" }
        ]
    },
    bruxSolverAccount: {
        type: OptionType.COMPONENT,
        displayName: "BruxSolver Account",
        description: "Check remaining solves and concurrent request usage.",
        hidden: () => settings.store.captchaProvider !== "bruxsolver",
        component: BruxSolverAccountButton
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
