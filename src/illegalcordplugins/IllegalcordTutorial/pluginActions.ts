/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled, pluginRequiresRestart, plugins, startDependenciesRecursive, startPlugin } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import { SettingsRouter, showToast } from "@webpack/common";

import { type Language, RECOMMENDED_PLUGIN_NAMES, type RecommendedPluginName, UI_COPY } from "./data";

type RecommendationState = Record<RecommendedPluginName, boolean>;

function emptyRecommendations() {
    return Object.fromEntries(RECOMMENDED_PLUGIN_NAMES.map(name => [name, false])) as RecommendationState;
}

export function getInitialRecommendations() {
    return Object.fromEntries(
        RECOMMENDED_PLUGIN_NAMES.map(name => [name, Boolean(plugins[name]) && !isPluginEnabled(name)])
    ) as RecommendationState;
}

export function getAvailableRecommendations() {
    return Object.fromEntries(
        RECOMMENDED_PLUGIN_NAMES.map(name => [name, Boolean(plugins[name]) && !isPluginEnabled(name)])
    ) as RecommendationState;
}

export function getClearedRecommendations() {
    return emptyRecommendations();
}

export function openSettingsPanel(panel: string | undefined) {
    if (!panel) return;

    SettingsRouter.openUserSettings(panel);
}

export function openRecommendedPluginSettings(pluginName: RecommendedPluginName, language: Language) {
    const plugin = plugins[pluginName];
    if (!plugin) {
        showToast(UI_COPY[language].missing, "message");
        return;
    }

    openPluginModal(plugin);
}

function enableRecommendedPlugin(pluginName: RecommendedPluginName) {
    const plugin = plugins[pluginName];
    if (!plugin) return "missing";
    if (isPluginEnabled(pluginName)) return "enabled";

    const pluginSettings = Settings.plugins[pluginName];
    if (!pluginSettings) return "missing";

    const { restartNeeded, failures } = startDependenciesRecursive(plugin);
    if (failures.length) return "failed";

    if (restartNeeded || pluginRequiresRestart(plugin)) {
        pluginSettings.enabled = true;
        return "restart";
    }

    if (!startPlugin(plugin)) {
        pluginSettings.enabled = false;
        return "failed";
    }

    pluginSettings.enabled = true;
    return "enabled";
}

export function enableSelectedRecommendations(selected: RecommendationState, language: Language) {
    const results = RECOMMENDED_PLUGIN_NAMES
        .filter(name => selected[name])
        .map(enableRecommendedPlugin);
    const copy = UI_COPY[language];

    if (!results.length) {
        showToast(copy.noSelection, "message");
        return;
    }

    const enabled = results.filter(result => result === "enabled").length;
    const restart = results.filter(result => result === "restart").length;
    const missing = results.filter(result => result === "missing").length;
    const failed = results.filter(result => result === "failed").length;

    if (failed) {
        showToast(copy.failed, "failure");
        return;
    }

    if (restart) {
        showToast(copy.restart(enabled + restart), "message");
        return;
    }

    if (missing) {
        showToast(copy.missing, "message");
        return;
    }

    showToast(copy.enabled(enabled), "success");
}
