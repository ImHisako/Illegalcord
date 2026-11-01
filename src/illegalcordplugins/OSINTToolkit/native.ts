/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron";

type GeoAnalyzeResult = { success: true; data: unknown; } | { success: false; error: string; retryable?: boolean; };
type CordCatResult = { success: true; data: unknown; } | { success: false; error: string; };
type DomainResult = { success: true; data: unknown; } | { success: false; error: string; };

const GEO_API_URL = "https://geoseeer.com/api/v1/analyze";
const CORDCAT_API_URL = "https://api.cord.cat";
const GEO_REQUEST_TIMEOUT_MS = 120_000;
const CORDCAT_REQUEST_TIMEOUT_MS = 12_000;
const RDAP_REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_CORDCAT_RESPONSE_BYTES = 4_194_304;
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
            throw new Error("The service returned too much data.");
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

export async function lookupDomain(_event: IpcMainInvokeEvent, domain: unknown): Promise<DomainResult> {
    if (typeof domain !== "string" || domain.length > 253 || domain !== domain.trim() || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) {
        return { success: false, error: "The domain is invalid." };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RDAP_REQUEST_TIMEOUT_MS);

    try {
        const init = { headers: { Accept: "application/rdap+json, application/json" }, redirect: "error", signal: controller.signal } satisfies RequestInit;
        const bootstrapResponse = await fetch("https://data.iana.org/rdap/dns.json", init);
        if (!bootstrapResponse.ok) return { success: false, error: "Could not retrieve the RDAP server list." };

        const bootstrap = await readResponse(bootstrapResponse);
        if (!isRecord(bootstrap) || !Array.isArray(bootstrap.services)) {
            return { success: false, error: "The RDAP server list is invalid." };
        }

        const tld = domain.slice(domain.lastIndexOf(".") + 1);
        const service: unknown = bootstrap.services.find((entry: unknown) => Array.isArray(entry) && Array.isArray(entry[0]) && entry[0].includes(tld));
        if (!Array.isArray(service) || !Array.isArray(service[1])) {
            return { success: false, error: "This domain extension does not have a public RDAP server." };
        }

        const endpoint: unknown = service[1].find((value: unknown) => typeof value === "string" && value.startsWith("https://"));
        if (typeof endpoint !== "string") return { success: false, error: "This domain extension does not have a secure RDAP server." };

        const response = await fetch(new URL(`domain/${domain}`, endpoint), init);
        if (response.status === 404) return { success: false, error: "No public RDAP record was found for this domain." };
        if (response.status === 429) return { success: false, error: "The RDAP rate limit was reached. Try again later." };
        if (!response.ok) return { success: false, error: `The RDAP request failed with HTTP ${response.status}.` };

        return { success: true, data: await readResponse(response) };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error && error.name === "AbortError"
                ? "The RDAP request timed out."
                : "Could not reach the RDAP service."
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function getCordCatError(response: Response): Promise<string | undefined> {
    try {
        const data = await readResponse(response);
        if (!isRecord(data)) return;

        const message = typeof data.message === "string" ? data.message : data.error;
        return typeof message === "string" && message.trim() ? message.trim() : undefined;
    } catch {
        return undefined;
    }
}

export async function queryCordCat(
    _event: IpcMainInvokeEvent,
    tool: unknown,
    value: unknown,
    refresh: unknown,
    apiKey: unknown
): Promise<CordCatResult> {
    if (typeof tool !== "string" || typeof value !== "string" || typeof refresh !== "boolean" || typeof apiKey !== "string") {
        return { success: false, error: "The CordCat request is invalid." };
    }

    const key = apiKey.trim();
    if (tool !== "status" && (!key || key.length > 512 || /[\r\n]/.test(key))) {
        return { success: false, error: "The CordCat API key is invalid." };
    }

    let path: string;
    switch (tool) {
        case "query":
            if (!/^\d{17,20}$/.test(value)) return { success: false, error: "The Discord user ID is invalid." };
            path = `/api/v2/query/${value}${refresh ? "?refresh=1" : ""}`;
            break;
        case "user":
            if (!/^\d{17,20}$/.test(value)) return { success: false, error: "The Discord user ID is invalid." };
            path = `/api/tools/user/${value}`;
            break;
        case "invite":
            if (!/^[a-z0-9_-]{2,100}$/i.test(value)) return { success: false, error: "The Discord invite code is invalid." };
            path = `/api/tools/invite/${encodeURIComponent(value)}`;
            break;
        case "guild":
            if (!/^\d{17,20}$/.test(value)) return { success: false, error: "The Discord server ID is invalid." };
            path = `/api/tools/guild-widget/${value}`;
            break;
        case "status":
            path = "/api/status";
            break;
        default:
            return { success: false, error: "The CordCat tool is invalid." };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CORDCAT_REQUEST_TIMEOUT_MS);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (key) headers["X-API-Key"] = key;

    try {
        let response = await fetch(`${CORDCAT_API_URL}${path}`, {
            headers,
            redirect: "error",
            signal: controller.signal
        });

        if (tool === "user" && response.status === 400) {
            response = await fetch(`${CORDCAT_API_URL}/api/v2/query/${value}`, {
                headers,
                redirect: "error",
                signal: controller.signal
            });

            if (response.ok) {
                const data = await readResponse(response, MAX_CORDCAT_RESPONSE_BYTES);
                if (isRecord(data) && isRecord(data.userInfo)) return { success: true, data: data.userInfo };
                return { success: false, error: "CordCat returned an invalid user profile." };
            }
        }

        if (response.status === 401) return { success: false, error: "CordCat rejected the API key." };
        if (response.status === 403 && tool === "guild") {
            return { success: false, error: "This Discord server does not have its public widget enabled." };
        }
        if (response.status === 404) return { success: false, error: "CordCat could not find that resource." };
        if (response.status === 429) return { success: false, error: "The CordCat rate limit was reached. Try again later." };
        if (!response.ok) {
            const detail = await getCordCatError(response);
            return {
                success: false,
                error: detail ?? (response.status === 400
                    ? "CordCat rejected the Discord ID. Copy the numeric user ID again and retry."
                    : `CordCat rejected the request with HTTP ${response.status}.`)
            };
        }

        return { success: true, data: await readResponse(response, MAX_CORDCAT_RESPONSE_BYTES) };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error && error.name === "AbortError"
                ? "The CordCat request timed out."
                : "Could not reach CordCat."
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
