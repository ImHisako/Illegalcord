/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent, WebPreferences } from "electron";

export function isDiscordAppUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" && !parsed.username && !parsed.password && [
            "https://discord.com", "https://ptb.discord.com", "https://canary.discord.com",
            "https://discordapp.com", "https://ptb.discordapp.com", "https://canary.discordapp.com",
        ].includes(parsed.origin);
    } catch {
        return false;
    }
}

export function isTrustedSender(event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">): boolean {
    return !event.sender.isDestroyed()
        && event.senderFrame !== null
        && event.senderFrame === event.sender.mainFrame
        && isDiscordAppUrl(event.senderFrame.url);
}

export function restrictWebPreferences(preferences: WebPreferences): void {
    preferences.nodeIntegration = false;
    preferences.nodeIntegrationInWorker = false;
    preferences.nodeIntegrationInSubFrames = false;
    preferences.contextIsolation = true;
    preferences.webSecurity = true;
    preferences.allowRunningInsecureContent = false;
    preferences.webviewTag = false;
}
