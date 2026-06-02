/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const PASSWORD_KEYS: Array<"usePassword" | "password"> = ["usePassword", "password"];

export const settings = definePluginSettings({
    usePassword: {
        type: OptionType.BOOLEAN,
        description: "Encrypt new bookmarks and require password access for encrypted bookmarks.",
        default: true
    },
    password: {
        type: OptionType.STRING,
        description: "Password used for AES-256 encrypted bookmarks.",
        default: "",
        placeholder: "Bookmark password",
        componentProps: {
            type: "password",
            autoComplete: "new-password"
        }
    }
}, {
    password: {
        hidden() {
            return !this.store.usePassword;
        },
        isValid(value: string) {
            if (!this.store.usePassword) return true;
            if (!value) return "Password cannot be empty.";
            if (/[\r\n]/.test(value)) return "Password cannot contain line breaks.";
            return true;
        }
    }
});
