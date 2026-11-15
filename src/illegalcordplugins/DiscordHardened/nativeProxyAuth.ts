/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NativeSettings } from "@main/settings";
import { safeStorage } from "electron";

interface SavedProxyCredentials {
    endpoint: string;
    encrypted: string;
}

function isCredential(value: unknown): value is string {
    return typeof value === "string" && value.length <= 1024 && !/[\r\n\0]/.test(value);
}

function canEncryptCredentials() {
    return safeStorage.isEncryptionAvailable() && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");
}

export function getSavedProxyCredentials(): SavedProxyCredentials | null {
    const saved: unknown = NativeSettings.store.plugins.DiscordHardened?.proxyCredentials;
    if (typeof saved !== "object" || saved === null || !("endpoint" in saved) || !("encrypted" in saved)
        || typeof saved.endpoint !== "string" || typeof saved.encrypted !== "string") return null;
    return { endpoint: saved.endpoint, encrypted: saved.encrypted };
}

export function saveProxyCredentials(endpoint: string, username: unknown, password: unknown): true | string {
    if (!isCredential(username) || !username || !isCredential(password)) return "Enter a valid proxy username and password.";
    try {
        if (!canEncryptCredentials()) return "Encrypted credential storage is unavailable on this device.";
        const encrypted = safeStorage.encryptString(JSON.stringify([endpoint, username, password])).toString("base64");
        NativeSettings.store.plugins.DiscordHardened ??= {};
        NativeSettings.store.plugins.DiscordHardened.proxyCredentials = { endpoint, encrypted };
        return true;
    } catch {
        return "Could not save proxy credentials.";
    }
}

export function removeProxyCredentials(): void {
    const settings = NativeSettings.store.plugins.DiscordHardened;
    if (settings) delete settings.proxyCredentials;
}

export function decryptProxyCredentials(saved: SavedProxyCredentials): { username: string; password: string; } {
    const data: unknown = JSON.parse(safeStorage.decryptString(Buffer.from(saved.encrypted, "base64")));
    if (!Array.isArray(data) || data[0] !== saved.endpoint || !isCredential(data[1]) || !isCredential(data[2])) {
        throw new Error("Could not read the saved proxy credentials.");
    }
    return { username: data[1], password: data[2] };
}
