/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent, Session, WebContents } from "electron";

interface AppliedState {
    sender: WebContents;
    session: Session;
    userAgent: string;
    userAgentApplied: boolean;
    questIdentityApplied: boolean;
    proxyApplied: boolean;
    destroyedListener: () => void;
}

const appliedStates = new Map<number, AppliedState>();

function isValidProxyValue(value: unknown, allowEmpty: boolean): value is string {
    return typeof value === "string"
        && value.length <= 4096
        && (allowEmpty || Boolean(value.trim()))
        && !/[\r\n\0@]/.test(value);
}

function getChromeUserAgent(spoofWindows: boolean): string {
    const chromeVersion = process.versions.chrome?.split(".")[0] ?? "120";
    const platform = spoofWindows || process.platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : process.platform === "darwin"
            ? "Macintosh; Intel Mac OS X 10_15_7"
            : "X11; Linux x86_64";
    return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion}.0.0.0 Safari/537.36`;
}

function hideElectronTokens(userAgent: string): string {
    return userAgent.replace(/\s(?:Electron|Discord)\/[\w.-]+/gi, "");
}

function isDiscordUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "https:"
            && ["discord.com", "discordapp.com"].some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
    } catch {
        return false;
    }
}

function isQuestUrl(url: string): boolean {
    if (!isDiscordUrl(url)) return false;

    return /^\/api\/v\d+\/quests\//.test(new URL(url).pathname);
}

async function restoreState(state: AppliedState): Promise<boolean> {
    state.sender.removeListener("destroyed", state.destroyedListener);
    const senderAvailable = !state.sender.isDestroyed();

    if (state.userAgentApplied && senderAvailable) state.sender.setUserAgent(state.userAgent);
    if (state.questIdentityApplied) state.session.webRequest.onBeforeSendHeaders(null);
    if (state.proxyApplied) await state.session.setProxy({ mode: "system" });
    return senderAvailable;
}

export async function configure(
    event: IpcMainInvokeEvent,
    hideElectronUserAgent: boolean,
    spoofChrome: boolean,
    spoofWindows: boolean,
    preserveQuestIdentity: boolean,
    proxy: boolean,
    proxyRules: string,
    proxyBypassRules: string
): Promise<boolean> {
    if (
        typeof hideElectronUserAgent !== "boolean"
        || typeof spoofChrome !== "boolean"
        || typeof spoofWindows !== "boolean"
        || typeof preserveQuestIdentity !== "boolean"
        || typeof proxy !== "boolean"
    ) return false;
    if (!isValidProxyValue(proxyRules, !proxy) || !isValidProxyValue(proxyBypassRules, true) || event.sender.isDestroyed()) return false;

    const existing = appliedStates.get(event.sender.id);
    if (existing) await restoreState(existing);

    if (!hideElectronUserAgent && !spoofChrome && !proxy) {
        appliedStates.delete(event.sender.id);
        return false;
    }

    const state: AppliedState = {
        sender: event.sender,
        session: event.sender.session,
        userAgent: event.sender.getUserAgent(),
        userAgentApplied: false,
        questIdentityApplied: false,
        proxyApplied: false,
        destroyedListener: () => {
            if (appliedStates.get(event.sender.id) !== state) return;
            appliedStates.delete(event.sender.id);
            void restoreState(state).catch(() => false);
        },
    };

    try {
        if (spoofChrome || hideElectronUserAgent) {
            event.sender.setUserAgent(spoofChrome ? getChromeUserAgent(spoofWindows) : hideElectronTokens(state.userAgent));
            state.userAgentApplied = true;
        }

        if (preserveQuestIdentity && state.userAgentApplied) {
            state.session.webRequest.onBeforeSendHeaders({
                urls: [
                    "https://discord.com/api/*",
                    "https://*.discord.com/api/*",
                    "https://discordapp.com/api/*",
                    "https://*.discordapp.com/api/*",
                ]
            }, (details, callback) => {
                if (!isQuestUrl(details.url)) {
                    callback({});
                    return;
                }

                const requestHeaders = { ...details.requestHeaders };
                const headerName = Object.keys(requestHeaders).find(name => name.toLowerCase() === "user-agent") ?? "User-Agent";
                requestHeaders[headerName] = state.userAgent;
                callback({ requestHeaders });
            });
            state.questIdentityApplied = true;
        }

        if (proxy) {
            await event.sender.session.setProxy({ proxyRules, proxyBypassRules });
            state.proxyApplied = true;
        }

        appliedStates.set(event.sender.id, state);
        event.sender.once("destroyed", state.destroyedListener);
        return true;
    } catch {
        await restoreState(state).catch(() => false);
        appliedStates.delete(event.sender.id);
        return false;
    }
}

export async function restore(event: IpcMainInvokeEvent): Promise<boolean> {
    const state = appliedStates.get(event.sender.id);
    if (!state) return false;

    appliedStates.delete(event.sender.id);
    try {
        return await restoreState(state);
    } catch {
        return false;
    }
}
