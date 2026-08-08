/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron";

type GeoAnalyzeResult = { success: true; data: unknown; } | { success: false; error: string; };

const GEO_API_URL = "https://geoseeer.com/api/v1/analyze";
const GEO_REQUEST_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 1_048_576;

async function readResponse(response: Response): Promise<unknown> {
    if (!response.body) return;

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        size += value.length;
        if (size > MAX_RESPONSE_BYTES) {
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
        return { success: false, error: "The GeoSeeer API key is invalid." };
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
            return { success: false, error: `GeoSeeer request failed with HTTP ${response.status}.` };
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
