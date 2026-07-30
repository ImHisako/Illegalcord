/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

const ALLOWED_AUDIO_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function parseAudioUrl(value: unknown): URL | null {
    if (typeof value !== "string") return null;

    try {
        const url = new URL(value);
        return url.protocol === "https:"
            && ALLOWED_AUDIO_HOSTS.has(url.hostname)
            && url.pathname.startsWith("/attachments/")
            ? url
            : null;
    } catch {
        return null;
    }
}

async function fetchDiscordAudio(url: URL, redirects = 0): Promise<Response> {
    const res = await fetch(url, { redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get("location");
    const redirectUrl = location ? parseAudioUrl(new URL(location, url).toString()) : null;
    if (!redirectUrl || redirects >= MAX_REDIRECTS) throw new Error("Invalid audio redirect.");

    return fetchDiscordAudio(redirectUrl, redirects + 1);
}

async function readLimitedAudio(res: Response): Promise<Uint8Array> {
    const contentLength = Number(res.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES)
        throw new Error("Audio file is too large.");

    if (!res.body) {
        const data = new Uint8Array(await res.arrayBuffer());
        if (data.byteLength > MAX_AUDIO_BYTES) throw new Error("Audio file is too large.");
        return data;
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        totalBytes += value.byteLength;
        if (totalBytes > MAX_AUDIO_BYTES) {
            await reader.cancel();
            throw new Error("Audio file is too large.");
        }

        chunks.push(value);
    }

    const data = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
    }

    return data;
}

// we love CORS
export async function fetchAudio(_: IpcMainInvokeEvent, url: string): Promise<Uint8Array> {
    const parsedUrl = parseAudioUrl(url);
    if (!parsedUrl) throw new Error("Unknown URL");

    const res = await fetchDiscordAudio(parsedUrl);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
    if (!res.headers.get("Content-Type")?.startsWith("audio/")) throw new Error(`${url} is not an audio file`);
    return readLimitedAudio(res);
}
