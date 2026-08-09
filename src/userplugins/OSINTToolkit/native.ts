/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron";

type GeoAnalyzeResult = { success: true; data: unknown; } | { success: false; error: string; retryable?: boolean; };
type BreachVipSearchResult =
    | { success: true; results: unknown[]; total: number; }
    | { success: false; error: string; };

const GEO_API_URL = "https://geoseeer.com/api/v1/analyze";
const BREACH_VIP_API_URL = "https://breach.vip/api/search";
const GEO_REQUEST_TIMEOUT_MS = 120_000;
const BREACH_VIP_REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_BREACH_VIP_RESPONSE_BYTES = 20_971_520;
const BREACH_VIP_FIELDS = new Set([
    "uuid", "username", "ip", "domain", "discordid", "steamid", "email", "password", "name", "phone"
]);

async function readResponse(response: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<unknown> {
    if (!response.body) return;

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        size += value.length;
        if (size > maxBytes) {
            await reader.cancel();
            throw new Error("GeoSeeer returned too much data.");
        }

        chunks.push(value);
    }

    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
    }

    return JSON.parse(new TextDecoder().decode(body)) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

export async function searchBreachVip(
    _event: IpcMainInvokeEvent,
    term: unknown,
    fields: unknown,
    minecraft: unknown,
    wildcard: unknown,
    caseSensitive: unknown
): Promise<BreachVipSearchResult> {
    if (typeof term !== "string" || !term.trim() || term.length > 100) {
        return { success: false, error: "The Breach.vip search term is invalid." };
    }

    if (
        !Array.isArray(fields)
        || !fields.length
        || fields.length > 10
        || fields.some(field => typeof field !== "string" || !BREACH_VIP_FIELDS.has(field))
    ) {
        return { success: false, error: "The Breach.vip search fields are invalid." };
    }

    if (typeof minecraft !== "boolean" || typeof wildcard !== "boolean" || typeof caseSensitive !== "boolean") {
        return { success: false, error: "The Breach.vip search options are invalid." };
    }

    if (wildcard && (term.startsWith("*") || term.startsWith("?"))) {
        return { success: false, error: "Wildcard searches cannot begin with * or ?." };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BREACH_VIP_REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(BREACH_VIP_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                term: term.trim(),
                fields,
                categories: minecraft ? ["minecraft"] : null,
                wildcard,
                case_sensitive: caseSensitive
            }),
            redirect: "error",
            signal: controller.signal
        });

        if (response.status === 429) {
            return { success: false, error: "Breach.vip rate limit reached. Try again in one minute." };
        }

        if (response.status === 403 && response.headers.get("cf-mitigated") === "challenge") {
            return {
                success: false,
                error: "Breach.vip blocked the API request with Cloudflare. The command cannot search until the site allows API clients again."
            };
        }

        if (!response.ok) {
            return { success: false, error: `Breach.vip rejected the search with HTTP ${response.status}.` };
        }

        const data = await readResponse(response, MAX_BREACH_VIP_RESPONSE_BYTES);
        if (!isRecord(data) || !Array.isArray(data.results)) {
            return { success: false, error: "Breach.vip returned an invalid response." };
        }

        return { success: true, results: data.results.slice(0, 10), total: data.results.length };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error && error.name === "AbortError"
                ? "The Breach.vip search timed out."
                : "Could not reach Breach.vip."
        };
    } finally {
        clearTimeout(timeout);
    }
}

export async function analyzeGeoImage(
    _event: IpcMainInvokeEvent,
    imageUrl: unknown,
    apiKey: unknown
): Promise<GeoAnalyzeResult> {
    if (typeof imageUrl !== "string" || imageUrl.length > 4_096) {
        return { success: false, error: "The image URL is invalid." };
    }

    try {
        const url = new URL(imageUrl);
        if (url.protocol !== "https:" && url.protocol !== "http:") {
            return { success: false, error: "The image URL is invalid." };
        }
    } catch {
        return { success: false, error: "The image URL is invalid." };
    }

    if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 512 || /[\r\n]/.test(apiKey)) {
        return { success: false, error: "The GeoSeeer API key is invalid.", retryable: true };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEO_REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(GEO_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": apiKey.trim()
            },
            body: JSON.stringify({ url: imageUrl, analysis_mode: "fast" }),
            redirect: "error",
            signal: controller.signal
        });

        if (!response.ok) {
            return {
                success: false,
                error: `GeoSeeer request failed with HTTP ${response.status}.`,
                retryable: [401, 402, 403, 429].includes(response.status)
            };
        }

        return { success: true, data: await readResponse(response) };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error && error.name === "AbortError"
                ? "GeoSeeer request timed out."
                : "Could not reach GeoSeeer."
        };
    } finally {
        clearTimeout(timeout);
    }
}
