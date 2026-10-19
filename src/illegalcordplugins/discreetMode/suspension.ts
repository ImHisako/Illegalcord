/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled, startPlugin, stopPlugin } from "@api/PluginManager";
import { SettingsStore } from "@api/Settings";
import { disableStyle, enableStyle, isStyleEnabled } from "@api/Styles";
import { Logger } from "@utils/Logger";
import type { Plugin } from "@utils/types";

import Plugins, { PluginMeta } from "~plugins";

import { installFullSuspension } from "./fullSuspension";
import { settings } from "./settings";

const logger = new Logger("DiscreetMode");

export function installPluginSuspension() {
    const retained = new Set(["DiscreetMode", "LarpCord", "ClientDiagnostics"]);
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
    const candidates = Object.values(Plugins).filter(plugin => !retained.has(plugin.name));
    const full = installFullSuspension(candidates);
    const paused = new Set<Plugin>();
    const retainedStyles = new Map<Plugin, string>();
    const starting = new Set<Plugin>();
    const skipped = new Set<Plugin>();
    const restorers: Array<() => void> = [];
    let installed = true;
    let ready = false;
    let scheduled = false;
    const active = () => installed && settings.store.active && settings.store.mode !== "suspend" && isPluginEnabled("DiscreetMode");

    function resume() {
        for (const plugin of paused) {
            if (skipped.has(plugin) && plugin.started) stopPlugin(plugin);
            paused.delete(plugin);
            const style = retainedStyles.get(plugin);
            if (style) {
                disableStyle(style);
                retainedStyles.delete(plugin);
            }
            if (isPluginEnabled(plugin.name) && !plugin.started) startPlugin(plugin);
        }
    }

    function changed() {
        if (!ready) return;
        if (!active()) return resume();
        for (const plugin of candidates) {
            if (!plugin.started || starting.has(plugin)) continue;
            const style = plugin.patches?.length ? plugin.managedStyle : undefined;
            const retainStyle = style && isStyleEnabled(style);
            if (stopPlugin(plugin)) {
                paused.add(plugin);
                if (retainStyle) {
                    enableStyle(style);
                    retainedStyles.set(plugin, style);
                }
            }
        }
    }

    function schedule() {
        if (!installed || !ready || scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            if (installed) changed();
        });
    }

    for (const plugin of candidates) {
        const { start, stop } = plugin;
        if (!start) continue;
        const wrappedStart: typeof start = async function (this: Plugin) {
            if (active()) {
                skipped.add(plugin);
                paused.add(plugin);
                schedule();
                return;
            }
            skipped.delete(plugin);
            starting.add(plugin);
            try {
                await start.call(this);
            } catch (error: unknown) {
                logger.error(`Could not start ${plugin.name}.`, error);
            } finally {
                starting.delete(plugin);
                schedule();
            }
        };
        const wrappedStop: typeof stop = stop ? function (this: Plugin) {
            if (!skipped.delete(plugin)) return stop.call(this);
        } : undefined;
        plugin.start = wrappedStart;
        plugin.stop = wrappedStop;
        restorers.push(() => {
            if (plugin.start === wrappedStart) plugin.start = start;
            if (plugin.stop === wrappedStop) plugin.stop = stop;
        });
    }

    SettingsStore.addChangeListener("plugins.DiscreetMode.active", changed);
    SettingsStore.addChangeListener("plugins.DiscreetMode.mode", changed);

    return {
        onReady() {
            full.onReady();
            ready = true;
            schedule();
        },
        stop() {
            SettingsStore.removeChangeListener("plugins.DiscreetMode.active", changed);
            SettingsStore.removeChangeListener("plugins.DiscreetMode.mode", changed);
            installed = false;
            resume();
            for (const restore of restorers) restore();
            full.stop();
        }
    };
}
