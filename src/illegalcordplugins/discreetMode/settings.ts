/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { comboEquals, comboFromEvent, isEditableTarget } from "@equicordplugins/commandPalette/ui/keyboard";
import { Logger } from "@utils/Logger";
import { OptionType } from "@utils/types";
import { onceReady } from "@webpack";

const logger = new Logger("DiscreetMode");
const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame");

export function refreshActivities() {
    void onceReady.then(() => {
        if (ShowCurrentGame) return ShowCurrentGame.updateSetting((value: boolean) => value);
    }).catch((error: unknown) => logger.warn("Could not refresh activity visibility.", error));
}

export const settings = definePluginSettings({
    active: {
        type: OptionType.BOOLEAN,
        description: "Enable discreet mode using the selected mode. Press the shortcut again to restore Illegalcord.",
        default: false,
        onChange: refreshActivities
    },
    mode: {
        type: OptionType.SELECT,
        description: "Choose whether to hide the interface without reloading or suspend all plugin features with a reload.",
        options: [
            { label: "Hide interface without reloading", value: "hide", default: true },
            { label: "Suspend plugins and reload", value: "suspend" }
        ]
    },
    keybind: {
        type: OptionType.STRING,
        description: "Shortcut while Discord is focused. Use a key such as F6 or a combination such as Ctrl+Shift+D.",
        default: "F6",
        isValid(value: string) {
            const keys = value.toLowerCase().split("+").map(key => key.trim());
            const modifiers = keys.filter(key => ["ctrl", "alt", "shift", "meta"].includes(key));
            const main = keys.filter(key => !modifiers.includes(key));
            return new Set(keys).size === keys.length && main.length === 1
                && /^(?:[a-z0-9]|f(?:[1-9]|1\d|2[0-4])|space|enter|escape|tab|backspace|delete|insert|home|end|pageup|pagedown|arrow(?:up|down|left|right))$/.test(main[0])
                || "Enter a key such as F6 or a combination such as Ctrl+Shift+D.";
        }
    },
    hideSettings: {
        type: OptionType.BOOLEAN,
        description: "Hide the entire Illegalcord section in user settings during discreet mode. Reopen settings to update the sidebar.",
        default: true
    },
    hideBrandedActivities: {
        type: OptionType.BOOLEAN,
        description: "Hide outgoing activities that mention a supported client mod in their text, buttons or URLs.",
        default: true,
        onChange: refreshActivities
    },
    hideInterface: {
        type: OptionType.BOOLEAN,
        description: "Hide common plugin controls during discreet mode.",
        default: true
    },
    manualMode: {
        type: OptionType.BOOLEAN,
        description: "Also hide the interface outside screen sharing, for screenshots or external streaming.",
        default: true
    }
}).withPrivateSettings<{
    suspendedPlugins?: { plugins: Record<string, boolean>; settingsSync: boolean; };
}>();

export function toggleDiscreetMode() {
    settings.store.manualMode = true;
    settings.store.active = !settings.store.active;
}

export function handleKeyDown(event: KeyboardEvent) {
    if (event.repeat || event.isComposing || event.defaultPrevented) return;
    const combo = comboFromEvent(event);
    if (!combo || !comboEquals(combo, settings.plain.keybind.split("+").map(key => key.trim()))) return;
    if (isEditableTarget(event.target) && !event.ctrlKey && !event.altKey && !event.metaKey && !/^F\d+$/i.test(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    toggleDiscreetMode();
}
