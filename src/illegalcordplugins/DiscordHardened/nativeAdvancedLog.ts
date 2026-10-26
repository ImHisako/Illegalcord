/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isObject } from "@utils/misc";
import type { Event, WebContents } from "electron";

import { isDiscordAppUrl } from "./nativeSecurity";
import { type createRequestLog, sanitizeRequestUrl } from "./requestLog";

export function createAdvancedRequestLog(contents: WebContents, log: ReturnType<typeof createRequestLog>, webSockets: boolean, localResources: boolean) {
    const debuggerApi = contents.debugger;
    const sockets = new Map<string, string>();
    const localRequests = new Map<string, { status?: number; }>();
    let attached = false;
    let owned = false;
    let stopped = false;
    let error = "";

    async function enable(sessionId?: string): Promise<void> {
        await debuggerApi.sendCommand("Network.enable", { maxPostDataSize: 0 }, sessionId);
        if (stopped || !owned) return;
        await debuggerApi.sendCommand("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
    }

    function message(_event: Event, method: string, params: unknown, sessionId = ""): void {
        if (!attached || !isObject(params)) return;
        if (method === "Target.attachedToTarget" && "sessionId" in params && typeof params.sessionId === "string") {
            void enable(params.sessionId).catch(() => { error = "Some frames or workers could not be observed."; });
            return;
        }
        if (!("requestId" in params) || typeof params.requestId !== "string") return;
        const key = `${contents.id}:${sessionId}:${params.requestId}`;
        if (webSockets && method === "Network.webSocketCreated" && "url" in params && typeof params.url === "string") {
            const url = sanitizeRequestUrl(params.url);
            if (url) sockets.set(key, url);
            if (sockets.size > 1000) sockets.delete(sockets.keys().next().value ?? "");
        } else if (method === "Network.webSocketClosed") {
            sockets.delete(key);
        } else if (webSockets && (method === "Network.webSocketFrameSent" || method === "Network.webSocketFrameReceived")) {
            if (!("response" in params) || !isObject(params.response)) return;
            const frame = params.response;
            if (!("opcode" in frame) || typeof frame.opcode !== "number" || !("payloadData" in frame) || typeof frame.payloadData !== "string") return;
            log.record({
                url: sockets.get(key) ?? "",
                source: "WebSocket",
                resourceType: "webSocketMessage",
                method: method === "Network.webSocketFrameSent" ? "SEND" : "RECEIVE",
                state: "Completed",
                bytes: frame.opcode === 1 ? Buffer.byteLength(frame.payloadData, "utf8") : Buffer.byteLength(frame.payloadData, "base64"),
                opcode: frame.opcode,
            });
        } else if (localResources && method === "Network.requestWillBeSent") {
            if (!("request" in params) || !isObject(params.request)) return;
            const { request } = params;
            if (!("url" in request) || typeof request.url !== "string" || !/^(?:blob|data):/.test(request.url)) return;
            localRequests.set(key, {});
            if (localRequests.size > 1000) {
                const oldest = localRequests.keys().next().value;
                if (oldest !== undefined) {
                    localRequests.delete(oldest);
                    log.finish(oldest, { state: "Failed", detail: "Local resource tracking limit reached." });
                }
            }
            log.record({
                url: request.url,
                method: "method" in request && typeof request.method === "string" ? request.method : "GET",
                resourceType: "type" in params && typeof params.type === "string" ? params.type.toLowerCase() : "localResource",
                source: "Local",
                state: "Pending",
            }, key);
        } else {
            const local = localRequests.get(key);
            if (!local) return;
            if (method === "Network.responseReceived" && "response" in params && isObject(params.response)
                && "status" in params.response && typeof params.response.status === "number") local.status = params.response.status;
            if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
                log.finish(key, {
                    state: method === "Network.loadingFailed" || (local.status ?? 0) >= 400 ? "Failed" : "Completed",
                    status: local.status,
                    detail: method === "Network.loadingFailed" ? "Local resource loading failed." : undefined,
                });
                localRequests.delete(key);
            }
        }
    }

    function detach(): void {
        attached = false;
        owned = false;
        sockets.clear();
        for (const key of localRequests.keys()) log.finish(key, { state: "Failed", detail: "Local resource observation stopped." });
        localRequests.clear();
        if (!stopped) error = "Advanced capture disconnected. Close DevTools and reconnect capture.";
    }

    function navigated(_event: Event, url: string): void {
        if (isDiscordAppUrl(url)) return;
        stop();
        error = "Advanced capture stopped after navigation outside Discord.";
    }

    function stop(): void {
        stopped = true;
        debuggerApi.removeListener("message", message);
        debuggerApi.removeListener("detach", detach);
        contents.removeListener("destroyed", stop);
        contents.removeListener("did-navigate", navigated);
        if (owned && !contents.isDestroyed() && debuggerApi.isAttached()) debuggerApi.detach();
        detach();
    }

    return {
        stop,
        status() {
            return {
                webSockets: webSockets ? attached ? "Active" : "Unavailable" : "Disabled",
                localResources: localResources ? attached ? "Active" : "Unavailable" : "Disabled",
                error,
            };
        },
        async start(): Promise<void> {
            if (debuggerApi.isAttached() || contents.isDevToolsOpened()) {
                error = "Advanced capture requires an available debugger. Close DevTools and reconnect capture.";
                return;
            }
            try {
                debuggerApi.attach("1.3");
                owned = true;
                attached = true;
                debuggerApi.on("message", message);
                debuggerApi.on("detach", detach);
                contents.once("destroyed", stop);
                contents.on("did-navigate", navigated);
                await enable();
            } catch {
                stop();
                error = "Advanced network capture could not be started.";
            }
        },
    };
}
