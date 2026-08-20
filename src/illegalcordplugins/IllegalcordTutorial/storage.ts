/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";

import { type Language, TUTORIAL_LANGUAGE_KEY, TUTORIAL_SEEN_KEY } from "./data";

export function isLanguage(value: unknown): value is Language {
    return value === "en" || value === "it";
}

export async function getTutorialLanguage() {
    const language = await DataStore.get<Language>(TUTORIAL_LANGUAGE_KEY);
    return isLanguage(language) ? language : "en";
}

export function saveTutorialLanguage(language: Language) {
    void DataStore.set(TUTORIAL_LANGUAGE_KEY, language);
}

export async function hasSeenTutorial() {
    return Boolean(await DataStore.get<boolean>(TUTORIAL_SEEN_KEY));
}

export function markTutorialSeen() {
    void DataStore.set(TUTORIAL_SEEN_KEY, true);
}

export function resetTutorialSeen() {
    void DataStore.del(TUTORIAL_SEEN_KEY);
}
