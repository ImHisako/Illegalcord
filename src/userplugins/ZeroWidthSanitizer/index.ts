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
        description: "Sanitize outgoing messages (before sending)",
        default: true
    },
    sanitizeIncoming: {
        type: OptionType.BOOLEAN,
        description: "Sanitize incoming messages (before displaying)",
        default: true
    },
    showToastOnDetection: {
        type: OptionType.BOOLEAN,
        description: "Show a notification when invisible characters are detected",
        default: true
    },
    verboseLogs: {
        type: OptionType.BOOLEAN,
        description: "Show detailed logs in console",
        default: false
    }
});

// Zero-width and invisible Unicode characters used for fingerprinting
const INVISIBLE_CHARS_REGEX = /[\u200B-\u200D\u200E\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF\u00AD]/g;

function log(message: string) {
    if (!settings.store.verboseLogs) return;
    console.log(`[ZeroWidthSanitizer] ${message}`);
}

function toast(message: string, type: number = Toasts.Type.MESSAGE) {
    if (!settings.store.showToastOnDetection) return;
    showToast(message, type);
}

function sanitize(text: string): { result: string; found: boolean; } {
    const found = INVISIBLE_CHARS_REGEX.test(text);
    INVISIBLE_CHARS_REGEX.lastIndex = 0; // reset regex state
    const result = text.replace(INVISIBLE_CHARS_REGEX, "");
    return { result, found };
}

export default definePlugin({
    name: "ZeroWidthSanitizer",
    description: "Removes invisible zero-width characters from messages to prevent fingerprinting and tracking",
    authors: [{ name: "Irritably", id: 928787166916640838n }],
    settings,

    patches: [
        // Sanitize outgoing messages before sending
        {
            find: "sendMessage",
            predicate: () => settings.store.sanitizeOutgoing,
            replacement: {
                match: /(sendMessage\(\w+,\s*)(\{[^}]*content:\s*)([^,}]+)/,
                replace: (_, fn, obj, content) =>
                    `${fn}${obj}$self.sanitizeOutgoing(${content})`
            }
        },
        // Sanitize incoming messages before rendering
        {
            find: "renderMessageContent",
            predicate: () => settings.store.sanitizeIncoming,
            replacement: {
                match: /(content:\s*)([^,}]+)(,?\s*(?:embeds|attachments))/,
                replace: (_, pre, content, post) =>
                    `${pre}$self.sanitizeIncoming(${content})${post}`
            }
        }
    ],

    sanitizeOutgoing(content: string): string {
        if (!settings.store.sanitizeOutgoing) return content;
        const { result, found } = sanitize(content);
        if (found) {
            log(`Removed invisible characters from outgoing message`);
            toast("ZeroWidthSanitizer: removed tracking characters from your message", Toasts.Type.MESSAGE);
        }
        return result;
    },

    sanitizeIncoming(content: string): string {
        if (!settings.store.sanitizeIncoming) return content;
        if (typeof content !== "string") return content;
        const { result, found } = sanitize(content);
        if (found) {
            log(`Removed invisible characters from incoming message`);
            toast("ZeroWidthSanitizer: tracking characters detected and removed", Toasts.Type.WARNING);
        }
        return result;
    },

    start() {
        log("Plugin started");
        showToast("ZeroWidthSanitizer active", Toasts.Type.SUCCESS);
    },

    stop() {
        log("Plugin stopped");
    }
});