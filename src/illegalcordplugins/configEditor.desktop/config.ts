/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue; }
export interface Config extends JsonObject {
    plugins: { [name: string]: JsonObject; };
    cloud: JsonObject;
}
export interface BackupInfo {
    id: string;
    name: string;
    author: string;
    createdAt: string;
}
export interface Backup extends BackupInfo {
    version: 1;
    settings: Config;
}
export const MAX_CONFIG_SIZE = 5 * 1024 * 1024;

export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isJson(value: unknown, depth = 0): value is JsonValue {
    if (depth > 64) return false;
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every((item: unknown) => isJson(item, depth + 1));
    return isRecord(value) && Object.entries(value).every(([key, item]) =>
        !["__proto__", "prototype", "constructor"].includes(key) && isJson(item, depth + 1));
}

export function isConfig(value: unknown): value is Config {
    return isRecord(value) && isJson(value) && isRecord(value.cloud) && isRecord(value.plugins)
        && Object.values(value.plugins).every(plugin => isRecord(plugin)
            && (plugin.enabled === undefined || typeof plugin.enabled === "boolean"));
}

export function parseConfig(text: string): Config {
    if (new TextEncoder().encode(text).length > MAX_CONFIG_SIZE) throw new Error("The configuration must be smaller than 5 MB.");
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw new Error("Invalid JSON. Check commas, quotes and brackets before applying changes.");
    }
    if (!isConfig(value)) throw new Error("The configuration must contain valid plugins and cloud objects with safe JSON values.");
    return value;
}

export function serializeConfig(config: object): string {
    const cloud: unknown = Reflect.get(config, "cloud");
    return JSON.stringify({ ...config, cloud: isRecord(cloud) ? { ...cloud, settingsSyncVersion: undefined } : cloud }, null, 4);
}

export function syncObject(target: object, next: JsonObject, path = ""): void {
    for (const key of Object.keys(target)) {
        if (!Object.hasOwn(next, key) && !(path === "cloud" && key === "settingsSyncVersion")) Reflect.deleteProperty(target, key);
    }
    for (const [key, value] of Object.entries(next)) {
        const previous: unknown = Reflect.get(target, key);
        if (isRecord(previous) && isRecord(value) && !path.startsWith("plugins.") && !(path === "plugins" && value.enabled === false)) syncObject(previous, value as JsonObject, path ? `${path}.${key}` : key);
        else if (JSON.stringify(previous) !== JSON.stringify(value)) Reflect.set(target, key, value);
    }
}

export function cleanupCandidates(config: Config, installed: Record<string, { started?: boolean; required?: boolean; isDependency?: boolean; }>) {
    return Object.entries(config.plugins).flatMap<{ name: string; kind: "removed" | "disabled"; bytes: number; }>(([name, options]) => {
        if (!Object.hasOwn(installed, name)) return [{ name, kind: "removed" as const, bytes: new TextEncoder().encode(JSON.stringify(options)).length }];
        const plugin = installed[name];
        if (options.enabled !== false || plugin.started || plugin.required || plugin.isDependency || Object.keys(options).every(key => key === "enabled")) return [];
        return [{ name, kind: "disabled" as const, bytes: Math.max(0, new TextEncoder().encode(JSON.stringify(options)).length - 17) }];
    });
}

export function cleanConfig(config: Config, installed: Parameters<typeof cleanupCandidates>[1], selected: string[]): Config {
    const plugins = { ...config.plugins };
    for (const candidate of cleanupCandidates(config, installed)) {
        if (!selected.includes(candidate.name)) continue;
        if (candidate.kind === "removed") delete plugins[candidate.name];
        else plugins[candidate.name] = { enabled: false };
    }
    return { ...config, plugins };
}
