/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addPatch, isPluginEnabled, stopPlugin } from "@api/PluginManager";
import { Settings, SettingsStore } from "@api/Settings";
import { Logger } from "@utils/Logger";
import type { Plugin } from "@utils/types";
import { patches } from "@webpack/patcher";

import Plugins from "~plugins";

import { settings } from "./settings";

const logger = new Logger("GhostClient");

export function installFullSuspension(candidates: Plugin[]) {
    const metadata = candidates.map(plugin => ({ plugin, required: plugin.required, isDependency: plugin.isDependency }));
    let ready = false;
    let disposed = false;
    let busy = false;
    let queued = false;
    let reloadRequested = false;
    const active = () => !disposed && settings.store.active && settings.store.mode === "suspend" && isPluginEnabled("GhostClient");

    function prepare() {
        if (!settings.store.suspendedPlugins) {
            settings.store.suspendedPlugins = {
                plugins: Object.fromEntries(candidates.map(plugin => [plugin.name, Boolean(Settings.plugins[plugin.name].enabled)])),
                settingsSync: Settings.cloud.settingsSync
            };
        }
        Settings.cloud.settingsSync = false;
        const snapshot = settings.store.suspendedPlugins;
        for (const plugin of candidates) {
            if (!Object.hasOwn(snapshot.plugins, plugin.name)) snapshot.plugins[plugin.name] = Boolean(Settings.plugins[plugin.name].enabled);
            plugin.required = false;
            plugin.isDependency = false;
            Settings.plugins[plugin.name].enabled = false;
        }
    }

    function restore() {
        const snapshot = settings.store.suspendedPlugins;
        if (!snapshot) return;
        for (const [name, enabled] of Object.entries(snapshot.plugins)) {
            if (name in Plugins) Settings.plugins[name].enabled = enabled;
        }
        Settings.cloud.settingsSync = snapshot.settingsSync;
        for (const { plugin, required, isDependency } of metadata) {
            plugin.required = required;
            plugin.isDependency = isDependency;
        }
    }

    function stopFeatures() {
        for (const plugin of candidates) {
            if (plugin.started) stopPlugin(plugin);
        }
    }

    async function commit(reload: boolean) {
        reloadRequested ||= reload;
        if (busy) {
            queued = true;
            return;
        }
        busy = true;
        const activating = active();
        const snapshot = settings.store.suspendedPlugins;
        try {
            if (activating) prepare();
            else restore();
            await VencordNative.settings.set(SettingsStore.plain);
            if (activating && active() && ready) stopFeatures();
            if (!activating) {
                settings.store.suspendedPlugins = undefined;
                await VencordNative.settings.set(SettingsStore.plain);
            }
            if (activating !== active()) queued = true;
            if (!queued && reloadRequested) {
                reloadRequested = false;
                location.reload();
            }
        } catch (error: unknown) {
            if (!activating) settings.store.suspendedPlugins = snapshot;
            reloadRequested = false;
            logger.error("Could not save the plugin suspension state. Your plugin backup has been retained.", error);
        } finally {
            busy = false;
            if (queued) {
                queued = false;
                void commit(false);
            }
        }
    }

    function changed() {
        if (active() || settings.store.suspendedPlugins || busy) void commit(true);
    }

    if (active()) {
        prepare();
        const names = new Set(candidates.map(plugin => plugin.name));
        for (let index = patches.length - 1; index >= 0; index--) {
            if (names.has(patches[index].plugin)) patches.splice(index, 1);
        }
        void commit(false);
    } else if (settings.store.suspendedPlugins) {
        restore();
        const patched = new Set(patches.map(patch => patch.plugin));
        for (const plugin of Object.values(Plugins)) {
            if (!isPluginEnabled(plugin.name) || patched.has(plugin.name)) continue;
            for (const patch of plugin.patches ?? []) addPatch(patch, plugin.name);
        }
        void commit(false);
    }
    SettingsStore.addChangeListener("plugins.GhostClient.active", changed);
    SettingsStore.addChangeListener("plugins.GhostClient.mode", changed);

    return {
        onReady() {
            ready = true;
            if (active()) stopFeatures();
        },
        stop() {
            disposed = true;
            SettingsStore.removeChangeListener("plugins.GhostClient.active", changed);
            SettingsStore.removeChangeListener("plugins.GhostClient.mode", changed);
            if (settings.store.suspendedPlugins) void commit(true);
        }
    };
}
