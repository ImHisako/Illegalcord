/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface RequestLogSettings {
    enabled?: boolean;
    recordNetworkRequests?: boolean;
    requestLogLimit?: number;
    requestLogRetention?: number;
    recordWebSocketMessages?: boolean;
    recordLocalResources?: boolean;
    recordVoiceDiagnostics?: boolean;
}

export interface RequestEntry {
    id: number;
    time: number;
    url: string;
    method: string;
    resourceType: string;
    source: "Desktop" | "Browser" | "Firewall" | "WebSocket" | "Local" | "Voice";
    state: "Pending" | "Completed" | "Redirected" | "Blocked" | "Failed";
    status?: number;
    duration?: number;
    detail?: string;
    fromCache?: boolean;
    bytes?: number;
    opcode?: number;
}

export type RequestInput = Omit<RequestEntry, "id" | "time"> & { time?: number; };
export type RequestResult = Pick<RequestEntry, "state" | "status" | "detail" | "fromCache">;
export interface RequestSnapshot {
    revision: number;
    entries: RequestEntry[];
}

export function sanitizeRequestUrl(raw: string, allowLocal = false): string | null {
    if (allowLocal && raw.startsWith("data:")) {
        const mime = /^data:([\w.+-]+\/[\w.+-]+)/.exec(raw.slice(0, 128))?.[1] ?? "text/plain";
        return `data:${mime};[redacted]`;
    }
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (allowLocal && url.protocol === "blob:") return `blob:${url.origin}/[redacted]`;
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return null;
    const pathname = ["discord.gg", "discord.gift"].includes(url.hostname) ? url.pathname.replace(/^\/[^/]+/, "/[redacted]") : url.pathname;
    const path = pathname
        .replace(/(\/(?:webhooks|interactions)\/[^/]+)\/[^/]+/gi, "$1/[redacted]")
        .replace(/(\/(?:invites|invite|gifts|gift)\/)[^/]+/gi, "$1[redacted]");
    return `${url.protocol}//${url.host}${path}`.slice(0, 2048);
}

export function createRequestLog(readSettings: () => RequestLogSettings | undefined) {
    const entries = new Map<number, RequestEntry>();
    const pending = new Map<number | string, number>();
    let nextId = 0;
    let revision = 0;

    function prune(): void {
        const settings = readSettings();
        const limit = typeof settings?.requestLogLimit === "number" && Number.isFinite(settings.requestLogLimit)
            ? Math.max(100, Math.min(10_000, settings.requestLogLimit)) : 2000;
        const minutes = typeof settings?.requestLogRetention === "number" && Number.isFinite(settings.requestLogRetention)
            ? Math.max(0, Math.min(1440, settings.requestLogRetention)) : 15;
        const cutoff = minutes ? Date.now() - minutes * 60_000 : 0;
        for (const [id, entry] of entries) {
            if (entries.size <= limit && entry.time > cutoff && settings?.enabled !== false) continue;
            entries.delete(id);
            revision++;
        }
        for (const [key, id] of pending) if (!entries.has(id)) pending.delete(key);
    }

    return {
        prune,
        record(input: RequestInput, key?: number | string): void {
            const settings = readSettings();
            if (settings?.enabled === false || settings?.recordNetworkRequests === false) return;
            if (input.source === "WebSocket" && !settings?.recordWebSocketMessages
                || input.source === "Local" && !settings?.recordLocalResources
                || input.source === "Voice" && !settings?.recordVoiceDiagnostics) return;
            const url = input.source === "Voice" ? "Voice engine"
                : input.source === "WebSocket" && !input.url ? "Existing WebSocket connection"
                    : sanitizeRequestUrl(input.url, settings?.recordLocalResources === true);
            if (!url) return;
            const id = ++nextId;
            entries.set(id, { ...input, id, time: input.time ?? Date.now(), url, method: input.method.toUpperCase() });
            if (key !== undefined) pending.set(key, id);
            revision++;
            prune();
        },
        finish(key: number | string, result: RequestResult): void {
            const id = pending.get(key);
            const entry = id === undefined ? undefined : entries.get(id);
            pending.delete(key);
            if (!entry) return;
            Object.assign(entry, result, { duration: Math.max(0, Date.now() - entry.time) });
            revision++;
            prune();
        },
        snapshot(): RequestSnapshot {
            prune();
            return { revision, entries: Array.from(entries.values(), entry => ({ ...entry })) };
        },
        clear(): void {
            entries.clear();
            pending.clear();
            revision++;
        },
    };
}
