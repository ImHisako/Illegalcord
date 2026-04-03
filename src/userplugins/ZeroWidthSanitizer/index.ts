/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Toasts, showToast } from "@webpack/common";

const settings = definePluginSettings({
    sanitizeOutgoing: {
        type: OptionType.BOOLEAN,
        description: "Sanitize outgoing messages before sending",
        default: true
    },
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

function sanitizeText(text: unknown): unknown {
    if (typeof text !== "string") return text;

    const matches = text.match(INVISIBLE_CHARS_REGEX);
    const removedCount = matches?.length ?? 0;
    if (!removedCount) return text;

    INVISIBLE_CHARS_REGEX.lastIndex = 0;
    const result = text.replace(INVISIBLE_CHARS_REGEX, "");

    log(`Removed ${removedCount} invisible character(s).`, { before: text, after: result });
    notify(
        `ZeroWidthSanitizer: removed ${removedCount} invisible character(s)`,
        Toasts.Type.WARNING
    );

    return result;
}

export default definePlugin({
    name: "ZeroWidthSanitizer",
    description: "Removes invisible Unicode characters from messages to reduce tracking and fingerprinting",
    authors: [{ name: "Irritably", id: 928787166916640838n }],
    settings,

    patches: [
        {
            find: "sendMessage(",
            predicate: () => settings.store.sanitizeOutgoing,
            replacement: [
                {
                    match: /(\bcontent:\s*)([^,}]+)(?=[,}])/g,
                    replace: "$1$self.sanitizeOutgoing($2)"
                }
            ]
        },
        {
            find: "editMessage(",
            predicate: () => settings.store.sanitizeOutgoing,
            replacement: [
                {
                    match: /(\bcontent:\s*)([^,}]+)(?=[,}])/g,
                    replace: "$1$self.sanitizeOutgoing($2)"
                }
            ]
        },
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

    sanitizeOutgoing(content: unknown) {
        return sanitizeText(content);
    },

    sanitizeIncoming(content: unknown) {
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
