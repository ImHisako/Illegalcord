/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PlainSettings } from "@api/Settings";
import { LocaleStore } from "@webpack/common";

import { en, type Messages } from "./locales/en";
import { ru } from "./locales/ru";

export const PLUGIN_NAME = "CustomStream-Preview";
export const OLD_PLUGIN_NAMES = ["CustomStreamTopQ"];
export const AUTO_LANGUAGE = "auto";
const FALLBACK_LOCALE = "en-US";
const LOCALE_CACHE_MS = 1000;

const dictionaries: Record<string, Messages> = {
    "en-US": en,
    ru
};

export const LANGUAGE_LABELS: Record<string, string> = {
    "en-US": "English",
    ru: "Русский"
};

export const LANGUAGE_CODES = Object.keys(dictionaries);

function preferredLanguage(): string {
    try {
        return (PlainSettings as any).plugins?.[PLUGIN_NAME]?.language || AUTO_LANGUAGE;
    } catch {
        return AUTO_LANGUAGE;
    }
}

function discordLocale(): string {
    try {
        const fromStore = (LocaleStore as any)?.locale;
        if (fromStore) return fromStore;
    } catch { }

    try {
        const stored = window.localStorage?.getItem("locale");
        if (stored) return JSON.parse(stored);
    } catch { }

    return FALLBACK_LOCALE;
}

function resolveLocale(): string {
    const preferred = preferredLanguage();
    const wanted = preferred === AUTO_LANGUAGE ? discordLocale() : preferred;
    if (dictionaries[wanted]) return wanted;

    const base = String(wanted).split("-")[0];
    return LANGUAGE_CODES.find(code => code.split("-")[0] === base) ?? FALLBACK_LOCALE;
}

let cachedLocale = "";
let cachedAt = 0;

function activeDictionary(): Messages {
    const now = Date.now();
    if (now - cachedAt > LOCALE_CACHE_MS) {
        cachedLocale = resolveLocale();
        cachedAt = now;
    }
    return dictionaries[cachedLocale] ?? en;
}

export function resetLocaleCache() {
    cachedAt = 0;
}

export const T: Messages = new Proxy({} as Messages, {
    get(_target, key: string | symbol) {
        return (activeDictionary() as any)[key] ?? (en as any)[key];
    }
});
