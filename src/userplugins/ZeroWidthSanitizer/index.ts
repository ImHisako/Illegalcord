/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { addPreEditListener, addPreSendListener, removePreEditListener, removePreSendListener } from "@api/MessageEvents";
import definePlugin, { OptionType } from "@utils/types";
import { Toasts, showToast } from "@webpack/common";

const settings = definePluginSettings({
    sanitizeOutgoing: {
        type: OptionType.BOOLEAN,
        description: "Sanitize outgoing messages before sending",
        default: true
    },
    sanitizeEdits: {
        type: OptionType.BOOLEAN,
        description: "Sanitize edited messages before applying the edit",
        default: true
    },
    sanitizeIncoming: {
        type: OptionType.BOOLEAN,
        description: "Sanitize incoming messages before displaying them",
        default: true
    },
    showToastOnDetection: {
        type: OptionType.BOOLEAN,
        description: "Show a toast when invisible characters are detected",
        default: true
    },
    showStartupToast: {
        type: OptionType.BOOLEAN,
        description: "Show a toast when the plugin starts",
        default: true
    },
    verboseLogs: {
        type: OptionType.BOOLEAN,
        description: "Show detailed logs in the console",
        default: false
    }
});

type MessageObject = {
    content?: string;
    [key: string]: unknown;
};

const INVISIBLE_CHARS_REGEX = /[\u200B-\u200D\u200E\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF\u00AD]/g;

function log(message: string, ...args: unknown[]) {
    if (!settings.store.verboseLogs) return;
    console.log("[ZeroWidthSanitizer]", message, ...args);
}

function notify(message: string, type = Toasts.Type.MESSAGE) {
    if (!settings.store.showToastOnDetection) return;
    showToast(message, type);
}

function sanitizeText(text: string): { result: string; found: boolean; removedCount: number; } {
    const matches = text.match(INVISIBLE_CHARS_REGEX);
    const removedCount = matches?.length ?? 0;
    const found = removedCount > 0;
    INVISIBLE_CHARS_REGEX.lastIndex = 0;
    const result = found ? text.replace(INVISIBLE_CHARS_REGEX, "") : text;
    return { result, found, removedCount };
}

function sanitizeMaybeString(value: unknown): { value: unknown; found: boolean; removedCount: number; } {
    if (typeof value !== "string") {
        return { value, found: false, removedCount: 0 };
    }

    const { result, found, removedCount } = sanitizeText(value);
    return { value: result, found, removedCount };
}

const preSendListener = (_channelId: string, messageObj: MessageObject) => {
    if (!settings.store.sanitizeOutgoing) return;
    if (typeof messageObj?.content !== "string") return;

    const { result, found, removedCount } = sanitizeText(messageObj.content);
    if (!found) return;

    messageObj.content = result;
    log(`Sanitized outgoing message; removed ${removedCount} invisible character(s).`, messageObj);

    notify(
        `ZeroWidthSanitizer: removed ${removedCount} invisible character(s) from your outgoing message`,
        Toasts.Type.MESSAGE
    );
};

const preEditListener = (_channelId: string, _messageId: string, messageObj: MessageObject) => {
    if (!settings.store.sanitizeEdits) return;
    if (typeof messageObj?.content !== "string") return;

    const { result, found, removedCount } = sanitizeText(messageObj.content);
    if (!found) return;

    messageObj.content = result;
    log(`Sanitized edited message; removed ${removedCount} invisible character(s).`, messageObj);

    notify(
        `ZeroWidthSanitizer: removed ${removedCount} invisible character(s) from your edited message`,
        Toasts.Type.MESSAGE
    );
};

export default definePlugin({
    name: "ZeroWidthSanitizer",
    description: "Removes invisible Unicode characters from messages to reduce tracking and fingerprinting",
    authors: [{ name: "Irritably", id: 928787166916640838n }],
    settings,

    dependencies: ["MessageEventsAPI"],

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
        if (!settings.store.sanitizeIncoming) return content;

        const { value, found, removedCount } = sanitizeMaybeString(content);
        if (!found) return value;

        log(`Sanitized incoming message; removed ${removedCount} invisible character(s).`, content);

        notify(
            `ZeroWidthSanitizer: detected and removed ${removedCount} invisible character(s) from an incoming message`,
            Toasts.Type.WARNING
        );

        return value;
    },

    start() {
        addPreSendListener(preSendListener);
        addPreEditListener(preEditListener);

        log("Plugin started");

        if (settings.store.showStartupToast) {
            showToast("ZeroWidthSanitizer is active", Toasts.Type.SUCCESS);
        }
    },

    stop() {
        removePreSendListener(preSendListener);
        removePreEditListener(preEditListener);
        log("Plugin stopped");
    }
});
