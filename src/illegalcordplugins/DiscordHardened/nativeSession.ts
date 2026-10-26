/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RendererSettings } from "@main/settings";
import { Logger } from "@utils/Logger";
import { escapeRegExp } from "@utils/text";
import { app, type OnBeforeRequestListenerDetails, type Session, session, type WebContents, type WebRequestFilter } from "electron";

import { installPermissionControls } from "./nativePermissions";
import { installRequestLog } from "./nativeRequestLog";
import { DEFAULT_ALLOWED_PATTERNS, DEFAULT_BLOCKED_PATTERNS, DEFAULT_FIREWALL_URLS, getBlockedRequestKind, getRequestRuleDecision } from "./network";

type RequestListener = NonNullable<Parameters<Session["webRequest"]["onBeforeRequest"]>[0]>;
type ProxyStatus = "Disabled" | "Pending" | "Active" | "Failed";

interface SessionState {
    requests: ReturnType<typeof installRequestLog>;
    permissionsInstalled: boolean;
    proxyStatus: ProxyStatus;
    proxyKey: string;
    ready: Promise<boolean>;
    restore: () => void;
}

const logger = new Logger("DiscordHardened");
const sessions = new Map<Session, SessionState>();

export function getSessionStatus(ses: Session) {
    const settings = RendererSettings.store.plugins?.DiscordHardened;
    const installed = sessions.has(ses);
    return {
        permissionsEnforced: Boolean(sessions.get(ses)?.permissionsInstalled && settings?.enabled !== false && settings?.electronPermissionControls !== false),
        sessionFirewall: installed && settings?.enabled !== false && settings?.sessionFirewall === true,
        proxyStatus: sessions.get(ses)?.proxyStatus ?? "Disabled",
    };
}

function filterRequest(details: OnBeforeRequestListenerDetails): boolean {
    const settings = RendererSettings.store.plugins?.DiscordHardened;
    if (settings?.enabled === false) return false;
    let url: URL;
    try {
        url = new URL(details.url);
    } catch {
        return false;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "ws:" && url.protocol !== "wss:") return false;
    const decision = getRequestRuleDecision(url, { blockedRequestUrls: settings?.blockedRequestUrls, allowedRequestUrls: settings?.allowedRequestUrls });
    if (decision !== null) return decision === "Block";
    if (settings?.sessionFirewall !== true) return false;
    const kind = getBlockedRequestKind(url, {
        questCompatibility: settings?.questCompatibility !== false,
        blockTelemetry: settings?.blockTelemetry !== false,
        blockSentry: settings?.blockSentry !== false,
        blockTracing: settings?.blockTracing !== false,
        blockTypingIndicator: settings?.blockTypingIndicator === true,
        blockFingerprinting: settings?.blockFingerprinting !== false,
        goofCordFirewall: settings?.goofCordFirewall !== false,
        firewallBlocklist: settings?.firewallBlocklist ?? DEFAULT_FIREWALL_URLS,
        firewallBlockedPatterns: settings?.firewallBlockedPatterns ?? DEFAULT_BLOCKED_PATTERNS,
        firewallAllowedPatterns: settings?.firewallAllowedPatterns ?? DEFAULT_ALLOWED_PATTERNS,
    }, RendererSettings.store.plugins?.NoTrack?.enabled !== false);
    if (kind && settings?.logBlockedRequests) logger.info(`Blocked ${kind} request in the desktop session.`);
    return kind !== null;
}

export function prepareSession(ses: Session): SessionState {
    const existing = sessions.get(ses);
    if (existing) return existing;
    const restorePermissions = installPermissionControls(ses);
    const requests = installRequestLog(ses, () => RendererSettings.store.plugins?.DiscordHardened);
    const { onBeforeRequest } = ses.webRequest;
    let hostListener: RequestListener | null = null;
    let hostFilter: WebRequestFilter | undefined;
    let hostPatterns: RegExp[] | undefined;
    const state: SessionState = {
        requests,
        permissionsInstalled: Boolean(restorePermissions),
        proxyStatus: "Disabled",
        proxyKey: "",
        ready: Promise.resolve(true),
        restore: () => {
            requests.stop();
            restorePermissions?.();
            if (ses.webRequest.onBeforeRequest === protectedBeforeRequest) {
                ses.webRequest.onBeforeRequest = onBeforeRequest;
                if (hostFilter) ses.webRequest.onBeforeRequest(hostFilter, hostListener);
                else ses.webRequest.onBeforeRequest(hostListener);
            }
        },
    };
    const listener: RequestListener = (details, callback) => {
        requests.begin(details);
        waitForProxy();
        function waitForProxy(): void {
            const pending = state.ready;
            void pending.then(ready => {
                if (pending !== state.ready) {
                    waitForProxy();
                    return;
                }
                if (!ready || filterRequest(details)) {
                    requests.log.finish(details.id, { state: "Blocked", detail: ready ? "Request firewall" : "Desktop proxy unavailable" });
                    callback({ cancel: true });
                    return;
                }
                if (hostListener && (!hostPatterns || hostPatterns.some(pattern => pattern.test(details.url)))) hostListener(details, result => {
                    if (result.cancel) requests.log.finish(details.id, { state: "Blocked", detail: "Request filter" });
                    callback(result);
                });
                else callback({ cancel: false });
            });
        }
    };
    function protectedBeforeRequest(filter: WebRequestFilter | RequestListener | null, handler?: RequestListener | null): void {
        hostFilter = typeof filter === "object" && filter !== null ? filter : undefined;
        hostListener = typeof filter === "function" || filter === null ? filter : handler ?? null;
        hostPatterns = hostFilter?.urls.map(pattern => {
            if (pattern === "<all_urls>") return /^(?:https?|wss?|file|ftp):/;
            const match = /^(\*|[\w+.-]+):\/\/([^/]*)(\/.*)$/.exec(pattern);
            if (!match) return new RegExp(`^${escapeRegExp(pattern)}$`);
            const scheme = match[1] === "*" ? "(?:https?|wss?)" : escapeRegExp(match[1]);
            const authority = /^(\[[^\]]+\]|[^:]*)(?::(\*|\d+))?$/.exec(match[2]);
            const hostname = authority?.[1] ?? match[2];
            const host = hostname === "*" ? "[^/]+" : hostname.startsWith("*.")
                ? `(?:[^/]+\\.)?${escapeRegExp(hostname.slice(2))}` : escapeRegExp(hostname);
            const port = authority?.[2] && authority[2] !== "*" ? `:${authority[2]}` : "(?::\\d+)?";
            return new RegExp(`^${scheme}://${host}${port}${escapeRegExp(match[3]).replaceAll("\\*", ".*")}$`);
        });
        onBeforeRequest.call(ses.webRequest, listener);
    }
    ses.webRequest.onBeforeRequest = protectedBeforeRequest;
    onBeforeRequest.call(ses.webRequest, listener);
    sessions.set(ses, state);

    const settings = RendererSettings.store.plugins?.DiscordHardened;
    if (settings?.enabled !== false && settings?.proxy && settings.proxyBeforeLoad !== false) {
        void configureSessionProxy(ses, settings.proxyRules ?? "127.0.0.1:8080", settings.proxyBypassRules ?? "<local>");
    }
    return state;
}

export function getSessionRequestLog(ses: Session) {
    return sessions.get(ses)?.requests.log;
}

export async function configureSessionProxy(ses: Session, proxyRules: unknown, proxyBypassRules: unknown): Promise<boolean> {
    const state = prepareSession(ses);
    const key = typeof proxyRules === "string" && typeof proxyBypassRules === "string" ? `${proxyRules}\0${proxyBypassRules}` : "";
    if (key && state.proxyKey === key) return state.ready;
    state.proxyKey = key;
    if (typeof proxyRules !== "string" || typeof proxyBypassRules !== "string"
        || !proxyRules.trim() || proxyRules.length > 4096 || proxyBypassRules.length > 4096 || /[\r\n\0@]/.test(proxyRules + proxyBypassRules)) {
        state.proxyStatus = "Failed";
        state.ready = Promise.resolve(false);
        return false;
    }
    state.proxyStatus = "Pending";
    state.ready = state.ready.then(async () => {
        try {
            await ses.setProxy({ proxyRules, proxyBypassRules });
            await ses.closeAllConnections();
            if (state.proxyKey === key) state.proxyStatus = "Active";
            return true;
        } catch {
            if (state.proxyKey === key) state.proxyStatus = "Failed";
            logger.error("The desktop proxy could not be configured. Session requests remain blocked. Restart Discord after checking the proxy settings.");
            return false;
        }
    });
    return state.ready;
}

export async function releaseSession(ses: Session): Promise<boolean> {
    const state = sessions.get(ses);
    if (!state) return true;
    await state.ready;
    if (state.proxyStatus !== "Disabled") {
        try {
            await ses.setProxy({ mode: "system" });
            await ses.closeAllConnections();
        } catch {
            state.proxyStatus = "Failed";
            state.ready = Promise.resolve(false);
            logger.error("The desktop proxy could not be restored. Session requests remain blocked.");
            return false;
        }
    }
    state.restore();
    sessions.delete(ses);
    return true;
}

function protectWindow(_event: Electron.Event, contents: WebContents): void {
    if (contents.session === session.defaultSession) prepareSession(contents.session);
}

function stop(): void {
    app.removeListener("web-contents-created", protectWindow);
    for (const state of sessions.values()) state.restore();
    sessions.clear();
}

app.on("web-contents-created", protectWindow);
app.once("will-quit", stop);
void app.whenReady().then(() => prepareSession(session.defaultSession));
