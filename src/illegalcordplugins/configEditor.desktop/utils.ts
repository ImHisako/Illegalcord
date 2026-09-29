/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PlainSettings, Settings } from "@api/Settings";
import { OptionType, type PluginNative } from "@utils/types";
import { UserStore } from "@webpack/common";

import Plugins from "~plugins";

import { type Config, isJson, isRecord, type JsonObject, parseConfig, serializeConfig, syncObject } from "./config";

export const Native = VencordNative.pluginHelpers.ConfigEditor as PluginNative<typeof import("./native")>;

export interface ActionProps {
    busy: boolean;
    run(action: () => Promise<string>): Promise<boolean>;
    canApply(): boolean;
}

export function snapshot(): string {
    return serializeConfig(PlainSettings);
}

export function authorName(): string {
    const user = UserStore.getCurrentUser();
    return (user.globalName || user.username).slice(0, 100);
}

function validateShape(current: JsonObject, next: JsonObject, path = "") {
    for (const [key, value] of Object.entries(current)) {
        if (!path && key === "plugins") continue;
        const label = path ? `${path}.${key}` : key;
        const proposed = next[key];
        if (proposed === undefined) throw new Error(`${label} is missing. Keep the existing client settings structure.`);
        if (Array.isArray(value)) {
            if (!Array.isArray(proposed) || value.length && proposed.some(item => typeof item !== typeof value[0])) throw new Error(`${label} must keep the same array value types.`);
        } else if (isRecord(value)) {
            if (!isRecord(proposed)) throw new Error(`${label} must be an object.`);
            if (["cloud", "notifications", "uiElements"].includes(label)) validateShape(value as JsonObject, proposed as JsonObject, label);
        } else if (value !== null && typeof proposed !== typeof value) throw new Error(`${label} must be a ${typeof value}.`);
    }
}

export function validateConfig(text: string): Config {
    const next = parseConfig(text);
    const current = parseConfig(snapshot());
    delete next.cloud.settingsSyncVersion;
    validateShape(current, next);
    next.plugins.ConfigEditor = { ...next.plugins.ConfigEditor, enabled: true };
    for (const [name, plugin] of Object.entries(Plugins)) {
        const proposed = next.plugins[name];
        if (plugin.required && proposed?.enabled === false) throw new Error(`${name} is required by the client and cannot be disabled.`);
        if (!proposed || !plugin.settings) continue;
        for (const [key, def] of Object.entries(plugin.settings.def)) {
            if (!(key in proposed)) {
                if (!proposed.enabled || !(key in (current.plugins[name] ?? {}))) continue;
                const fallback: unknown = def.type === OptionType.SELECT ? def.options.find(option => option.default)?.value : def.default;
                if (isJson(fallback)) proposed[key] = fallback;
                else throw new Error(`${name}.${key} is missing. Set a value instead of deleting an active plugin setting.`);
            }
            const value = proposed[key];
            if (JSON.stringify(current.plugins[name]?.[key]) === JSON.stringify(value)) continue;
            let valid = true;
            switch (def.type) {
                case OptionType.STRING: valid = typeof value === "string"; break;
                case OptionType.BOOLEAN: valid = typeof value === "boolean"; break;
                case OptionType.NUMBER: valid = typeof value === "number"; break;
                case OptionType.SLIDER:
                    valid = typeof value === "number" && value >= def.markers[0] && value <= def.markers[def.markers.length - 1]
                        && (def.stickToMarkers === false || def.markers.includes(value));
                    break;
                case OptionType.SELECT: valid = def.options.some(option => option.value === value); break;
                case OptionType.BIGINT: valid = false; break;
            }
            if (!valid) throw new Error(`${name}.${key} has an invalid value.`);
            const result = def.isValid?.call({ ...plugin.settings, store: proposed }, value) ?? true;
            if (result !== true) throw new Error(typeof result === "string" ? `${name}.${key}: ${result}` : `${name}.${key} failed validation.`);
        }
    }
    return next;
}

export async function saveBackup(name: string, author: string) {
    await VencordNative.settings.set(PlainSettings);
    const result = await Native.createBackup(name, author);
    if (!result.success) throw new Error(result.error);
    return result.backup;
}

export async function applyConfig(text: string, base: string, backupName: string, canApply: () => boolean = () => true) {
    const next = validateConfig(text);
    if (snapshot() !== base) throw new Error("Settings changed elsewhere. Reload the current configuration before applying your draft.");
    const backup = await saveBackup(backupName, authorName());
    if (!canApply()) throw new Error("The operation was cancelled. No configuration changes were applied.");
    if (snapshot() !== base) throw new Error("Settings changed while the backup was being created. Reload the current configuration.");
    const previous = parseConfig(base);
    const restart = Object.entries(Plugins).flatMap(([name, plugin]) => {
        const before = previous.plugins[name];
        const after = next.plugins[name];
        if (before?.enabled !== after?.enabled) return [name];
        return Object.entries(plugin.settings?.def ?? {}).some(([key, def]) => def.restartNeeded
            && JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) ? [name] : [];
    });
    try {
        syncObject(Settings, next);
        await VencordNative.settings.set(PlainSettings);
        const saved = await Native.flushSettings();
        if (!saved.success) throw new Error(saved.error);
    } catch {
        try {
            syncObject(Settings, previous);
            await VencordNative.settings.set(PlainSettings);
        } catch {
            throw new Error("Some settings could not be rolled back. Restore the recovery backup and restart the client.");
        }
        throw new Error("Could not apply the configuration. Previous values were restored in memory and a recovery backup was saved.");
    }
    return { backup, restart };
}
