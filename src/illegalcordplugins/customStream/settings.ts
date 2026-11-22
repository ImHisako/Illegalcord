/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, SettingsStore } from "@api/Settings";
import { OptionType } from "@utils/types";

import { AUTO_LANGUAGE, LANGUAGE_CODES, LANGUAGE_LABELS, PLUGIN_NAME, resetLocaleCache, T } from "./i18n";
import { createEmitter } from "./utils";

export { PLUGIN_NAME };
export const DEFAULT_HOTKEY = "Alt+1";

export const settingsChanged = createEmitter();

export const settings = definePluginSettings({
    language: {
        type: OptionType.SELECT,
        get description() {
            return T.settingLanguage;
        },
        get options() {
            return [
                { label: T.settingLanguageAuto, value: AUTO_LANGUAGE, default: true },
                ...LANGUAGE_CODES.map(code => ({ label: LANGUAGE_LABELS[code] ?? code, value: code }))
            ];
        }
    },
    replaceEnabled: {
        type: OptionType.BOOLEAN,
        get description() {
            return T.settingReplace;
        },
        default: true
    },
    slideshowEnabled: {
        type: OptionType.BOOLEAN,
        get description() {
            return T.settingSlideshow;
        },
        default: false
    },
    slideshowRandom: {
        type: OptionType.BOOLEAN,
        get description() {
            return T.settingRandom;
        },
        default: false
    },
    showPanelButton: {
        type: OptionType.BOOLEAN,
        get description() {
            return T.settingPanelButton;
        },
        default: true
    },
    hotkey: {
        type: OptionType.STRING,
        get description() {
            return T.settingHotkey;
        },
        default: DEFAULT_HOTKEY
    }
});

const SETTINGS_PREFIX = `plugins.${PLUGIN_NAME}`;

function onSettingsChange(_value: unknown, path: string) {
    if (path === `${SETTINGS_PREFIX}.language`) resetLocaleCache();
    settingsChanged.emit();
}

export function watchSettings() {
    SettingsStore.addPrefixChangeListener(SETTINGS_PREFIX, onSettingsChange);
}

export function unwatchSettings() {
    SettingsStore.removePrefixChangeListener(SETTINGS_PREFIX, onSettingsChange);
}
