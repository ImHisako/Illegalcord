/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Event, IpcMainInvokeEvent, Session, WebContents, WebPreferences } from "electron";

import { launchBrowser, listInstalledBrowsers } from "./browsers";
import { createAdvancedRequestLog } from "./nativeAdvancedLog";
import { clearTemporaryPermissions } from "./nativePermissions";
import { isDiscordAppUrl, isTrustedSender, restrictWebPreferences } from "./nativeSecurity";
import { configureSessionProxy, getSessionRequestLog, getSessionStatus, prepareSession, releaseSession } from "./nativeSession";

export { setTemporaryPermissions } from "./nativePermissions";

const advancedCaptures = new Map<WebContents, { capture: ReturnType<typeof createAdvancedRequestLog>; destroyed: () => void; }>();

export async function configureRequestCapture(event: IpcMainInvokeEvent, webSockets: unknown, localResources: unknown) {
    if (!isTrustedSender(event) || typeof webSockets !== "boolean" || typeof localResources !== "boolean") return null;
    const existing = advancedCaptures.get(event.sender);
    if (existing) {
        event.sender.removeListener("destroyed", existing.destroyed);
        existing.capture.stop();
        advancedCaptures.delete(event.sender);
    }
    if (!webSockets && !localResources) return true;
    const { requests } = prepareSession(event.sender.session);
    const capture = createAdvancedRequestLog(event.sender, requests.log, webSockets, localResources);
    const destroyed = () => {
        capture.stop();
        event.sender.removeListener("destroyed", destroyed);
        if (advancedCaptures.get(event.sender)?.capture === capture) advancedCaptures.delete(event.sender);
    };
    advancedCaptures.set(event.sender, { capture, destroyed });
    event.sender.once("destroyed", destroyed);
    await capture.start();
    if (!isTrustedSender(event)) {
        destroyed();
        return null;
    }
    return true;
}

export function getRequestLog(event: IpcMainInvokeEvent) {
    if (!isTrustedSender(event)) return null;
    const log = getSessionRequestLog(event.sender.session);
    return log ? { ...log.snapshot(), advanced: advancedCaptures.get(event.sender)?.capture.status() } : null;
}

export function clearRequestLog(event: IpcMainInvokeEvent): boolean {
    if (!isTrustedSender(event)) return false;
    const log = getSessionRequestLog(event.sender.session);
    if (!log) return false;
    log.clear();
    return true;
}

interface AppliedState {
    sender: WebContents;
    session: Session;
    userAgent: string;
    userAgentApplied: boolean;
    questIdentityApplied: boolean;
    restrictElectronNavigation: boolean;
    blockElectronWebviews: boolean;
    navigationListener: (event: Event, url: string) => void;
    redirectListener: (event: Event, url: string, isInPlace: boolean, isMainFrame: boolean) => void;
    webviewListener: (event: Event, preferences: WebPreferences, params: Record<string, string>) => void;
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
    state.sender.removeListener("will-navigate", state.navigationListener);
    state.sender.removeListener("will-redirect", state.redirectListener);
    state.sender.removeListener("will-attach-webview", state.webviewListener);
    const senderAvailable = !state.sender.isDestroyed();

    if (state.userAgentApplied && senderAvailable) state.sender.setUserAgent(state.userAgent);
    if (state.questIdentityApplied) state.session.webRequest.onBeforeSendHeaders(null);
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
    proxyBypassRules: string,
    restrictElectronNavigation: boolean,
    blockElectronWebviews: boolean,
    minimumPrivilege = true
): Promise<boolean> {
    if (!isTrustedSender(event)) return false;
    if (
        typeof hideElectronUserAgent !== "boolean"
        || typeof spoofChrome !== "boolean"
        || typeof spoofWindows !== "boolean"
        || typeof preserveQuestIdentity !== "boolean"
        || typeof proxy !== "boolean"
        || typeof restrictElectronNavigation !== "boolean"
        || typeof blockElectronWebviews !== "boolean"
        || typeof minimumPrivilege !== "boolean"
    ) return false;
    if (!isValidProxyValue(proxyRules, !proxy) || !isValidProxyValue(proxyBypassRules, true)) return false;

    const existing = appliedStates.get(event.sender.id);
    if (existing) {
        const restored = await restoreState(existing).catch(() => false);
        appliedStates.delete(event.sender.id);
        if (!restored || !isTrustedSender(event)) return false;
    }

    if (!hideElectronUserAgent && !spoofChrome && !proxy && !restrictElectronNavigation && !blockElectronWebviews && !minimumPrivilege) {
        appliedStates.delete(event.sender.id);
        return false;
    }

    const state: AppliedState = {
        sender: event.sender,
        session: event.sender.session,
        userAgent: event.sender.getUserAgent(),
        userAgentApplied: false,
        questIdentityApplied: false,
        restrictElectronNavigation,
        blockElectronWebviews,
        navigationListener: (navigationEvent: Event, url: string) => {
            if (restrictElectronNavigation && !isDiscordAppUrl(url)) navigationEvent.preventDefault();
        },
        redirectListener: (navigationEvent: Event, url: string, _isInPlace: boolean, isMainFrame: boolean) => {
            if (restrictElectronNavigation && isMainFrame && !isDiscordAppUrl(url)) navigationEvent.preventDefault();
        },
        webviewListener: (webviewEvent: Event, preferences: WebPreferences, params: Record<string, string>) => {
            if (blockElectronWebviews || minimumPrivilege && !isDiscordAppUrl(params.src)) {
                webviewEvent.preventDefault();
                return;
            }
            if (minimumPrivilege) {
                restrictWebPreferences(preferences);
                preferences.sandbox = true;
                delete preferences.preload;
                delete params.preload;
                delete params.preloadURL;
            }
        },
        destroyedListener: () => {
            if (appliedStates.get(event.sender.id) !== state) return;
            appliedStates.delete(event.sender.id);
            clearTemporaryPermissions(event.sender.id);
            void restoreState(state).catch(() => false);
        },
    };

    try {
        event.sender.on("will-navigate", state.navigationListener);
        event.sender.on("will-redirect", state.redirectListener);
        event.sender.on("will-attach-webview", state.webviewListener);

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

        prepareSession(event.sender.session);
        if (proxy) {
            await configureSessionProxy(event.sender.session, proxyRules, proxyBypassRules);
            if (!isTrustedSender(event)) {
                await restoreState(state);
                return false;
            }
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
    if (!isTrustedSender(event)) return false;
    await configureRequestCapture(event, false, false);
    const state = appliedStates.get(event.sender.id);
    if (!state) return false;

    appliedStates.delete(event.sender.id);
    clearTemporaryPermissions(event.sender.id);
    try {
        const restored = await restoreState(state);
        if (!Array.from(appliedStates.values()).some(active => active.session === state.session))
            return await releaseSession(state.session) && restored;
        return restored;
    } catch {
        return false;
    }
}

export async function getInstalledBrowsers(event: IpcMainInvokeEvent) {
    if (!isTrustedSender(event)) return [];
    return listInstalledBrowsers();
}

export async function openInBrowser(event: IpcMainInvokeEvent, browserId: unknown, url: unknown): Promise<boolean> {
    if (!isTrustedSender(event)) return false;
    return launchBrowser(browserId, url, () => isTrustedSender(event)).catch(() => false);
}

export function getSecurityStatus(event: IpcMainInvokeEvent) {
    if (!isTrustedSender(event)) return null;
    const getPreferences: unknown = Reflect.get(event.sender, "getLastWebPreferences");
    if (typeof getPreferences !== "function") return null;
    const preferences: unknown = Reflect.apply(getPreferences, event.sender, []);
    if (typeof preferences !== "object" || preferences === null) return null;
    const state = appliedStates.get(event.sender.id);
    return {
        ...getSessionStatus(event.sender.session),
        nodeIntegration: "nodeIntegration" in preferences && typeof preferences.nodeIntegration === "boolean" ? preferences.nodeIntegration : null,
        contextIsolation: "contextIsolation" in preferences && typeof preferences.contextIsolation === "boolean" ? preferences.contextIsolation : null,
        sandbox: "sandbox" in preferences && typeof preferences.sandbox === "boolean" ? preferences.sandbox : null,
        webSecurity: "webSecurity" in preferences && typeof preferences.webSecurity === "boolean" ? preferences.webSecurity : null,
        navigationRestricted: Boolean(state?.restrictElectronNavigation && event.sender.listeners("will-navigate").includes(state.navigationListener) && event.sender.listeners("will-redirect").includes(state.redirectListener)),
        webviewsBlocked: Boolean(state?.blockElectronWebviews && event.sender.listeners("will-attach-webview").includes(state.webviewListener)),
    };
}
