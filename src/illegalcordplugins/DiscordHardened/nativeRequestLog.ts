/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { OnBeforeRequestListenerDetails, Session } from "electron";

import { createRequestLog, type RequestLogSettings } from "./requestLog";

export function installRequestLog(ses: Session, readSettings: () => RequestLogSettings | undefined) {
    const log = createRequestLog(readSettings);
    const timer = setInterval(log.prune, 30_000);
    timer.unref();
    ses.webRequest.onCompleted(details => log.finish(details.id, {
        state: details.statusCode >= 400 ? "Failed" : "Completed",
        status: details.statusCode,
        fromCache: details.fromCache,
    }));
    ses.webRequest.onBeforeRedirect(details => log.finish(details.id, {
        state: "Redirected",
        status: details.statusCode,
        fromCache: details.fromCache,
    }));
    ses.webRequest.onErrorOccurred(details => log.finish(details.id, {
        state: "Failed",
        detail: details.error,
        fromCache: details.fromCache,
    }));
    return {
        log,
        begin(details: OnBeforeRequestListenerDetails): void {
            if (/^(?:blob|data):/.test(details.url)) return;
            log.record({
                url: details.url,
                method: details.method,
                resourceType: details.resourceType,
                source: "Desktop",
                state: "Pending",
            }, details.id);
        },
        stop(): void {
            clearInterval(timer);
            ses.webRequest.onCompleted(null);
            ses.webRequest.onBeforeRedirect(null);
            ses.webRequest.onErrorOccurred(null);
            log.clear();
        },
    };
}
