/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Constants, GuildStore, RestAPI } from "@webpack/common";

import { state, throwIfCancelled } from "../store";
import { handleCloneError } from "../utils/errorHandler";
import { arrayBufferToBase64 } from "../utils/helpers";
import { notify, updateWithTime } from "../utils/notifications";
import { CloneContext, CloneSound, CloneSticker } from "./types";

const STICKER_SLOTS = { 0: 5, 1: 15, 2: 30, 3: 60 } as const;
const SOUNDBOARD_SLOTS = { 0: 8, 1: 24, 2: 36, 3: 48 } as const;
const MAX_ASSET_BYTES = 2 * 1024 * 1024;

function getTargetTier(guildId: string): 0 | 1 | 2 | 3 {
    const tier = GuildStore.getGuild(guildId)?.premiumTier ?? 0;
    return tier === 1 || tier === 2 || tier === 3 ? tier : 0;
}

async function fetchCapped(url: string): Promise<Blob> {
    const response = await fetch(url, { signal: state.abortController?.signal });
    if (!response.ok) throw new Error(`Discord CDN returned ${response.status}`);
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_ASSET_BYTES) throw new Error("The asset is too large to clone");
    const blob = await response.blob();
    if (blob.size > MAX_ASSET_BYTES) throw new Error("The asset is too large to clone");
    return blob;
}

export async function cloneStickers(context: CloneContext): Promise<number> {
    const { sourceGuild, newGuildId, options, taskQueue, assetQueue, stickersProgressStart, stickersProgressEnd } = context;

    try {
        const sourceResponse: { body?: CloneSticker[]; } = await RestAPI.get({ url: `/guilds/${sourceGuild.id}/stickers` });
        const targetResponse: { body?: CloneSticker[]; } = await RestAPI.get({ url: `/guilds/${newGuildId}/stickers` });
        if (!Array.isArray(sourceResponse.body)) throw new Error("Discord returned invalid source sticker data");
        if (!Array.isArray(targetResponse.body)) throw new Error("Discord returned invalid target sticker data");
        const sourceStickers = sourceResponse.body;
        let targetStickers = targetResponse.body;

        if (!options.resumeMode) {
            for (const sticker of targetStickers) {
                throwIfCancelled();
                await taskQueue.execute(() => RestAPI.del({ url: `/guilds/${newGuildId}/stickers/${sticker.id}` }));
            }
            targetStickers = [];
        }

        const existingNames = new Set(targetStickers.map(sticker => sticker.name));
        let stickersToClone = options.resumeMode
            ? sourceStickers.filter(sticker => !existingNames.has(sticker.name))
            : sourceStickers;
        const availableSlots = Math.max(0, STICKER_SLOTS[getTargetTier(newGuildId)] - targetStickers.length);
        const skipped = Math.max(0, stickersToClone.length - availableSlots);
        stickersToClone = stickersToClone.slice(0, availableSlots);

        if (skipped > 0) notify("Sticker limit", `${skipped} stickers cannot fit in the target server.`);

        let completed = 0;
        await Promise.all(stickersToClone.map(async sticker => {
            if (!state.isCloning) return;
            throwIfCancelled();

            try {
                const extensions: Record<number, string> = { 1: "png", 2: "png", 3: "json", 4: "gif" };
                const mimeTypes: Record<number, string> = { 1: "image/png", 2: "image/apng", 3: "application/json", 4: "image/gif" };
                const extension = extensions[sticker.format_type] ?? "png";
                const url = `${window.GLOBAL_ENV.MEDIA_PROXY_ENDPOINT}/stickers/${sticker.id}.${extension}`;
                const blob = await fetchCapped(url);
                const data = new FormData();
                data.append("name", sticker.name);
                data.append("description", sticker.description ?? "");
                data.append("tags", sticker.tags ?? "");
                data.append("file", new File([blob], `${sticker.name}.${extension}`, { type: mimeTypes[sticker.format_type] ?? "image/png" }));

                await assetQueue.execute(() => RestAPI.post({
                    url: Constants.Endpoints.GUILD_STICKER_PACKS(newGuildId),
                    body: data
                }));
                completed++;
                const progress = stickersProgressStart + completed / Math.max(stickersToClone.length, 1) * (stickersProgressEnd - stickersProgressStart);
                updateWithTime(`Cloned sticker ${completed}/${stickersToClone.length}: ${sticker.name}`, progress);
            } catch (error: unknown) {
                handleCloneError("Sticker", error, sticker.name);
            }
        }));

        return completed;
    } catch (error: unknown) {
        handleCloneError("Stickers", error);
        return 0;
    }
}

export async function cloneSoundboard(context: CloneContext): Promise<number> {
    const { sourceGuild, newGuildId, options, assetQueue, deleteQueue, soundboardProgressStart, soundboardProgressEnd } = context;

    try {
        const sourceResponse: { body?: CloneSound[] | { items?: CloneSound[]; }; } = await RestAPI.get({ url: `/guilds/${sourceGuild.id}/soundboard-sounds` });
        const targetResponse: { body?: CloneSound[] | { items?: CloneSound[]; }; } = await RestAPI.get({ url: `/guilds/${newGuildId}/soundboard-sounds` });
        const sourceSounds = Array.isArray(sourceResponse.body) ? sourceResponse.body : sourceResponse.body?.items;
        let targetSounds = Array.isArray(targetResponse.body) ? targetResponse.body : targetResponse.body?.items;
        if (!Array.isArray(sourceSounds)) throw new Error("Discord returned invalid source soundboard data");
        if (!Array.isArray(targetSounds)) throw new Error("Discord returned invalid target soundboard data");

        if (!options.resumeMode) {
            await Promise.all(targetSounds.map(sound => deleteQueue.execute(() =>
                RestAPI.del({ url: `/guilds/${newGuildId}/soundboard-sounds/${sound.sound_id}` })
            )));
            targetSounds = [];
        }

        const existingNames = new Set(targetSounds.map(sound => sound.name));
        let soundsToClone = options.resumeMode
            ? sourceSounds.filter(sound => !existingNames.has(sound.name))
            : sourceSounds;
        const availableSlots = Math.max(0, SOUNDBOARD_SLOTS[getTargetTier(newGuildId)] - targetSounds.length);
        const skipped = Math.max(0, soundsToClone.length - availableSlots);
        soundsToClone = soundsToClone.slice(0, availableSlots);

        if (skipped > 0) notify("Soundboard limit", `${skipped} sounds cannot fit in the target server.`);

        let completed = 0;
        await Promise.all(soundsToClone.map(async sound => {
            if (!state.isCloning) return;
            throwIfCancelled();

            try {
                const blob = await fetchCapped(`https://${window.GLOBAL_ENV.CDN_HOST}/soundboard-sounds/${sound.sound_id}`);
                const buffer = await blob.arrayBuffer();
                const body: Record<string, unknown> = {
                    name: sound.name,
                    sound: `data:audio/ogg;base64,${arrayBufferToBase64(buffer)}`,
                    volume: sound.volume ?? 1
                };
                if (sound.emoji_name && !sound.emoji_id) body.emoji_name = sound.emoji_name;

                await assetQueue.execute(() => RestAPI.post({
                    url: `/guilds/${newGuildId}/soundboard-sounds`,
                    body
                }));
                completed++;
                const progress = soundboardProgressStart + completed / Math.max(soundsToClone.length, 1) * (soundboardProgressEnd - soundboardProgressStart);
                updateWithTime(`Cloned sound ${completed}/${soundsToClone.length}: ${sound.name}`, progress);
            } catch (error: unknown) {
                handleCloneError("Soundboard", error, sound.name);
            }
        }));

        return completed;
    } catch (error: unknown) {
        handleCloneError("Soundboard", error);
        return 0;
    }
}
