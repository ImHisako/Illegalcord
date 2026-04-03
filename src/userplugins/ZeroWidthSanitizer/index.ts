/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Toasts, showToast } from "@webpack/common";

const settings = definePluginSettings({
    sanitizeIncoming: {
        type: OptionType.BOOLEAN,
        description: "Sanitize incoming messages before displaying",
        default: true
    },
    showToastOnDetection: {
        type: OptionType.BOOLEAN,
        description: "Show a notification when invisible characters are detected",
        default: true
    },
    showStartupToast: {
        type: OptionType.BOOLEAN,
        description: "Show a notification when the plugin starts",
        default: true
    },
    verboseLogs: {
        type: OptionType.BOOLEAN,
        description: "Show detailed logs in the console",
        default: false
    }
});

const INVISIBLE_CHARS_REGEX = /[\u200B-\u200D\u200E\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF\u00AD]/g;

function log(message: string, ...args: unknown[]) {
    if (!settings.store.verboseLogs) return;
    console.log("[ZeroWidthSanitizer]", message, ...args);
}

function notify(message: string, type = Toasts.Type.MESSAGE) {
    if (!settings.store.showToastOnDetection) return;
    showToast(message, type);
}

function sanitizeText(value: unknown): unknown {
    if (typeof value !== "string") return value;

    const matches = value.match(INVISIBLE_CHARS_REGEX);
    const removedCount = matches?.length ?? 0;
    if (!removedCount) return value;

    INVISIBLE_CHARS_REGEX.lastIndex = 0;
    const result = value.replace(INVISIBLE_CHARS_REGEX, "");

    log(`Removed ${removedCount} invisible character(s).`, {
        before: value,
        after: result
    });

    notify(
        `ZeroWidthSanitizer: detected and removed ${removedCount} invisible character(s)`,
        Toasts.Type.WARNING
    );

    return result;
}

export default definePlugin({
    name: "ZeroWidthSanitizer",
    description: "Removes invisible Unicode characters from displayed messages to reduce tracking and fingerprinting",
    authors: [{ name: "Irritably", id: 928787166916640838n }],
    settings,

    patches: [
        {
            find: "renderMessageContent",
            predicate: () => settings.store.sanitizeIncoming,
            replacement: [
                {
                    match: /(content:\s*)(\i)(,)/g,
                    replace: "$1$self.sanitizeIncoming($2)$3"
                }
            ]
        }
    ],

    sanitizeIncoming(content: unknown) {
        return sanitizeText(content);
    },

    sanitizeOutgoing(content: unknown) {
        return sanitizeText(content);
    },

    start() {
        log("Plugin started");
        if (settings.store.showStartupToast) {
            showToast("ZeroWidthSanitizer is active", Toasts.Type.SUCCESS);
        }
    },

    stop() {
        log("Plugin stopped");
    }
});
