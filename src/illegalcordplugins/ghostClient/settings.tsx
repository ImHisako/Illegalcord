/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings, migratePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { comboEquals, comboFromEvent, isEditableTarget } from "@equicordplugins/commandPalette/ui/keyboard";
import { Logger } from "@utils/Logger";
import { OptionType } from "@utils/types";
import { onceReady } from "@webpack";
import { ApplicationStreamingStore, GuildStore, lodash, React, SearchableSelect, SelectedGuildStore, StreamerModeStore, useStateFromStores } from "@webpack/common";

migratePluginSettings("GhostClient", "DiscreetMode");

const logger = new Logger("GhostClient");
const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame");
const BLACKLIST_KEYS: Array<"blacklistedGuilds"> = ["blacklistedGuilds"];

function ServerBlacklist() {
    const { blacklistedGuilds } = settings.use(BLACKLIST_KEYS);
    const options = useStateFromStores([GuildStore], () => Object.values(GuildStore.getGuilds())
        .map(guild => ({ label: guild.name, value: guild.id }))
        .sort((a, b) => a.label.localeCompare(b.label)), undefined, lodash.isEqual);

    return (
        <>
            <Heading>Server blacklist</Heading>
            <Paragraph>Automatically hide the Illegalcord interface while viewing any selected server.</Paragraph>
            <SearchableSelect
                options={options}
                value={blacklistedGuilds}
                multi
                clearable
                closeOnSelect={false}
                maxVisibleItems={6}
                placeholder="Select servers"
                onChange={(values: Array<string | { value: string; }>) => {
                    settings.store.blacklistedGuilds = values.map(value => typeof value === "string" ? value : value.value);
                }}
            />
        </>
    );
}

export function isSharing() {
    return ApplicationStreamingStore != null && StreamerModeStore != null
        && (ApplicationStreamingStore.getCurrentUserActiveStream() != null || StreamerModeStore.enabled);
}

export function isAutomaticallyActive() {
    const { streamerMode, blacklistedGuilds } = settings.plain;
    const guildId = SelectedGuildStore?.getGuildId();
    return streamerMode && isSharing() || guildId != null && blacklistedGuilds.includes(guildId);
}

export function isGhostClientActive() {
    return isPluginEnabled("GhostClient") && (settings.plain.active || isAutomaticallyActive());
}

export function refreshActivities() {
    void onceReady.then(() => {
        if (ShowCurrentGame) return ShowCurrentGame.updateSetting((value: boolean) => value);
    }).catch((error: unknown) => logger.warn("Could not refresh activity visibility.", error));
}

export const settings = definePluginSettings({
    active: {
        type: OptionType.BOOLEAN,
        description: "Enable GhostClient manually using the selected mode. Automatic activation works independently.",
        default: false,
        onChange: refreshActivities
    },
    streamerMode: {
        type: OptionType.BOOLEAN,
        displayName: "Streamer Mode",
        description: "Automatically hide the Illegalcord interface while sharing your screen or using Discord Streamer Mode.",
        default: true,
        onChange: refreshActivities
    },
    blacklistedGuilds: {
        type: OptionType.COMPONENT,
        component: ServerBlacklist,
        default: Array<string>(),
        onChange: refreshActivities
    },
    mode: {
        type: OptionType.SELECT,
        description: "Choose whether manual activation hides the interface without reloading or suspends all plugin features with a reload.",
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
        description: "Hide the entire Illegalcord section in user settings while GhostClient is active. Reopen settings to update the sidebar.",
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
        description: "Hide common plugin controls while GhostClient is active.",
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

export function toggleGhostClient() {
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
    toggleGhostClient();
}
