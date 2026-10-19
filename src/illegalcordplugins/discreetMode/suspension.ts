/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled, stopPlugin } from "@api/PluginManager";
import { Settings, SettingsStore } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { patches } from "@webpack/patcher";

import Plugins, { PluginMeta } from "~plugins";

import { settings } from "./settings";

const logger = new Logger("DiscreetMode");

export function installPluginSuspension() {
    const retained = new Set(["DiscreetMode", "LarpCord"]);
    for (const [name, meta] of Object.entries(PluginMeta)) {
        if (/\/(?:_api|_core)\//.test(meta.folderName)) retained.add(name);
    }
    const pending = [...retained];
    for (let index = 0; index < pending.length; index++) {
        for (const dependency of Plugins[pending[index]].dependencies ?? []) {
            if (retained.has(dependency)) continue;
            retained.add(dependency);
            pending.push(dependency);
        }
    }
    const suspended = Object.values(Plugins).filter(plugin => !retained.has(plugin.name));
    const metadata = suspended.map(plugin => ({ plugin, required: plugin.required, isDependency: plugin.isDependency }));
    let busy = false;
    let ready = false;
    let queued = false;

    function prepare() {
        if (!settings.store.suspendedPlugins) {
            settings.store.suspendedPlugins = {
                plugins: Object.fromEntries(suspended.map(plugin => [plugin.name, Boolean(Settings.plugins[plugin.name].enabled)])),
                settingsSync: Settings.cloud.settingsSync
            };
        }
        Settings.cloud.settingsSync = false;
        const snapshot = settings.store.suspendedPlugins;
        for (const plugin of suspended) {
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
        for (const plugin of suspended) {
            if (plugin.started) stopPlugin(plugin);
        }
    }

    async function commit(reload: boolean) {
        if (busy) return;
        busy = true;
        const activating = settings.store.active && isPluginEnabled("DiscreetMode");
        const snapshot = settings.store.suspendedPlugins;
        try {
            if (activating) {
                prepare();
            } else {
                restore();
            }
            await VencordNative.settings.set(SettingsStore.plain);
            if (activating && settings.store.active && ready) stopFeatures();
            if (!activating) {
                settings.store.suspendedPlugins = undefined;
                await VencordNative.settings.set(SettingsStore.plain);
            }
            if (activating !== (settings.store.active && isPluginEnabled("DiscreetMode"))) queued = true;
            else if (reload) location.reload();
        } catch (error: unknown) {
            if (!activating) settings.store.suspendedPlugins = snapshot;
            logger.error("Could not save the plugin suspension state. Your plugin backup has been retained.", error);
        } finally {
            busy = false;
            if (queued) {
                queued = false;
                void commit(true);
            }
        }
    }

    function changed() {
        if (busy) queued = true;
        else void commit(true);
    }

    if (settings.store.active) {
        prepare();
        for (let index = patches.length - 1; index >= 0; index--) {
            if (!retained.has(patches[index].plugin)) patches.splice(index, 1);
        }
        void commit(false);
    } else if (settings.store.suspendedPlugins) {
        void commit(true);
    }
    SettingsStore.addChangeListener("plugins.DiscreetMode.active", changed);

    return {
        onReady() {
            ready = true;
            if (settings.store.active) stopFeatures();
        },
        stop() {
            SettingsStore.removeChangeListener("plugins.DiscreetMode.active", changed);
            if (settings.store.suspendedPlugins) void commit(true);
        }
    };
}
