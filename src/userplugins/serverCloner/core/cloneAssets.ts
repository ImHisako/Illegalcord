import { RestAPI, GuildStore } from "@webpack/common";
import { arrayBufferToBase64 } from "../utils/helpers";
import { updateWithTime, notify } from "../utils/notifications";
import { handleCloneError } from "../utils/errorHandler";
import { state, throwIfCancelled } from "../store";
import { CloneContext } from "./types";



const STICKER_SLOTS: Record<number, number> = { 0: 5, 1: 15, 2: 30, 3: 60 };
const SOUNDBOARD_SLOTS: Record<number, number> = { 0: 8, 1: 24, 2: 36, 3: 48 };

function getTargetTier(guildId: string): number {
    const guild = GuildStore.getGuild(guildId);
    return (guild as any)?.premiumTier || 0;
}



export async function cloneStickers(ctx: CloneContext): Promise<number> {
    const { sourceGuild, newGuildId, options, taskQueue, stickersProgressStart, stickersProgressEnd } = ctx;
    let clonedCount = 0;

    try {
        updateWithTime("Fetching source stickers...", stickersProgressStart);

        const sourceResp = await RestAPI.get({ url: `/guilds/${sourceGuild.id}/stickers` });
        const sourceStickers: any[] = (sourceResp as any).body || [];

        if (sourceStickers.length === 0) {
            updateWithTime("No stickers to clone.", stickersProgressEnd);
            return 0;
        }


        let targetStickers: any[] = [];
        try {
            const targetResp = await RestAPI.get({ url: `/guilds/${newGuildId}/stickers` });
            targetStickers = (targetResp as any).body || [];
        } catch (e) {
            console.warn("[ServerCloner] Failed to fetch target stickers:", e);
        }


        if (!options.resumeMode && targetStickers.length > 0) {
            updateWithTime(`Deleting ${targetStickers.length} existing stickers...`, stickersProgressStart);
            for (const ts of targetStickers) {
                if (!state.isCloning) break;
                try {
                    await taskQueue.execute(async () => {
                        await RestAPI.del({ url: `/guilds/${newGuildId}/stickers/${ts.id}` });
                    });
                } catch (e) {
                    console.warn(`[ServerCloner] Failed to delete target sticker ${ts.name}:`, e);
                }
            }
            targetStickers = [];
        }


        const tier = getTargetTier(newGuildId);
        const maxSlots = STICKER_SLOTS[tier] ?? 5;
        const usedSlots = targetStickers.length;
        const availableSlots = Math.max(0, maxSlots - usedSlots);


        let stickersToClone = sourceStickers;
        if (options.resumeMode) {
            const existingNames = new Set(targetStickers.map((s: any) => s.name));
            stickersToClone = sourceStickers.filter((s: any) => !existingNames.has(s.name));
        }


        const skipped = Math.max(0, stickersToClone.length - availableSlots);
        stickersToClone = stickersToClone.slice(0, availableSlots);

        if (skipped > 0) {
            notify(
                "Sticker Limit",
                `Target server (Tier ${tier}) has ${availableSlots} free sticker slots. ${skipped} sticker(s) will be skipped.`,
                "info",
                8000
            );
        }

        if (stickersToClone.length === 0) {
            updateWithTime("No stickers to clone (slots full or all exist).", stickersProgressEnd);
            return 0;
        }

        throwIfCancelled();

        let step = 0;
        for (const sticker of stickersToClone) {
            if (!state.isCloning) break;
            throwIfCancelled();

            try {


                const formatExt: Record<number, string> = { 1: "png", 2: "png", 3: "json", 4: "gif" };
                const ext = formatExt[sticker.format_type] || "png";
                const stickerUrl = `https://media.discordapp.net/stickers/${sticker.id}.${ext}`;

                const response = await fetch(stickerUrl);
                if (!response.ok) {
                    handleCloneError("Sticker", new Error(`CDN returned ${response.status}`), sticker.name);
                    continue;
                }

                const blob = await response.blob();
                const mimeTypes: Record<number, string> = { 1: "image/png", 2: "image/apng", 3: "application/json", 4: "image/gif" };
                const mime = mimeTypes[sticker.format_type] || "image/png";
                const file = new File([blob], `${sticker.name}.${ext}`, { type: mime });

                const formData = new FormData();
                formData.append("name", sticker.name);
                formData.append("description", sticker.description || "");
                formData.append("tags", sticker.tags || "");
                formData.append("file", file);

                await taskQueue.execute(async () => {

                    const token = (window as any).__SENTRY__?.hub?.getClient?.()?.getOptions?.()?.headers?.Authorization
                        || document.body.getAttribute("data-token")
                        || "";


                    const { findByPropsLazy } = await import("@webpack");
                    const AuthStore = findByPropsLazy("getToken");
                    const authToken = AuthStore?.getToken?.();
                    if (!authToken) throw new Error("Could not get auth token for sticker upload");

                    const resp = await fetch(`/api/v9/guilds/${newGuildId}/stickers`, {
                        method: "POST",
                        headers: { Authorization: authToken },
                        body: formData
                    });

                    if (!resp.ok) {
                        const errBody = await resp.json().catch(() => ({}));
                        throw new Error(errBody.message || `Sticker upload failed: ${resp.status}`);
                    }
                }, (msg) => updateWithTime(msg, stickersProgressStart + ((step / stickersToClone.length) * (stickersProgressEnd - stickersProgressStart))));

                clonedCount++;
                step++;
                updateWithTime(`Cloned sticker ${step}/${stickersToClone.length}: ${sticker.name}`, stickersProgressStart + ((step / stickersToClone.length) * (stickersProgressEnd - stickersProgressStart)));
            } catch (e) {
                handleCloneError("Sticker", e, sticker.name);
                step++;
            }
        }
    } catch (e) {
        handleCloneError("Stickers", e, "fetch");
    }

    return clonedCount;
}



export async function cloneSoundboard(ctx: CloneContext): Promise<number> {
    const { sourceGuild, newGuildId, options, taskQueue, soundboardProgressStart, soundboardProgressEnd } = ctx;
    let clonedCount = 0;

    try {
        updateWithTime("Fetching source soundboard sounds...", soundboardProgressStart);

        const sourceResp = await RestAPI.get({ url: `/guilds/${sourceGuild.id}/soundboard-sounds` });
        const sourceSounds: any[] = (sourceResp as any).body?.items || (sourceResp as any).body || [];

        if (sourceSounds.length === 0) {
            updateWithTime("No soundboard sounds to clone.", soundboardProgressEnd);
            return 0;
        }


        let targetSounds: any[] = [];
        try {
            const targetResp = await RestAPI.get({ url: `/guilds/${newGuildId}/soundboard-sounds` });
            targetSounds = (targetResp as any).body?.items || (targetResp as any).body || [];
        } catch (e) {
            console.warn("[ServerCloner] Failed to fetch target soundboard sounds:", e);
        }


        if (!options.resumeMode && targetSounds.length > 0) {
            updateWithTime(`Deleting ${targetSounds.length} existing soundboard sounds...`, soundboardProgressStart);
            for (const ts of targetSounds) {
                if (!state.isCloning) break;
                try {
                    await taskQueue.execute(async () => {
                        await RestAPI.del({ url: `/guilds/${newGuildId}/soundboard-sounds/${ts.sound_id}` });
                    });
                } catch (e) {
                    console.warn(`[ServerCloner] Failed to delete target soundboard sound ${ts.name}:`, e);
                }
            }
            targetSounds = [];
        }


        const tier = getTargetTier(newGuildId);
        const maxSlots = SOUNDBOARD_SLOTS[tier] ?? 8;
        const usedSlots = targetSounds.length;
        const availableSlots = Math.max(0, maxSlots - usedSlots);


        let soundsToClone = sourceSounds;
        if (options.resumeMode) {
            const existingNames = new Set(targetSounds.map((s: any) => s.name));
            soundsToClone = sourceSounds.filter((s: any) => !existingNames.has(s.name));
        }


        const skipped = Math.max(0, soundsToClone.length - availableSlots);
        soundsToClone = soundsToClone.slice(0, availableSlots);

        if (skipped > 0) {
            notify(
                "Soundboard Limit",
                `Target server (Tier ${tier}) has ${availableSlots} free soundboard slots. ${skipped} sound(s) will be skipped.`,
                "info",
                8000
            );
        }

        if (soundsToClone.length === 0) {
            updateWithTime("No soundboard sounds to clone (slots full or all exist).", soundboardProgressEnd);
            return 0;
        }

        throwIfCancelled();

        let step = 0;
        for (const sound of soundsToClone) {
            if (!state.isCloning) break;
            throwIfCancelled();

            try {
                const soundUrl = `https://cdn.discordapp.com/soundboard-sounds/${sound.sound_id}`;
                const response = await fetch(soundUrl);
                if (!response.ok) {
                    handleCloneError("Soundboard", new Error(`CDN returned ${response.status}`), sound.name);
                    step++;
                    continue;
                }

                const buffer = await response.arrayBuffer();
                const base64 = arrayBufferToBase64(buffer);
                const dataUri = `data:audio/ogg;base64,${base64}`;

                const body: any = {
                    name: sound.name,
                    sound: dataUri,
                    volume: sound.volume ?? 1,
                };


                if (sound.emoji_name && !sound.emoji_id) {
                    body.emoji_name = sound.emoji_name;
                }

                await taskQueue.execute(async () => {
                    await RestAPI.post({
                        url: `/guilds/${newGuildId}/soundboard-sounds`,
                        body
                    });
                }, (msg) => updateWithTime(msg, soundboardProgressStart + ((step / soundsToClone.length) * (soundboardProgressEnd - soundboardProgressStart))));

                clonedCount++;
                step++;
                updateWithTime(`Cloned sound ${step}/${soundsToClone.length}: ${sound.name}`, soundboardProgressStart + ((step / soundsToClone.length) * (soundboardProgressEnd - soundboardProgressStart)));
            } catch (e) {
                handleCloneError("Soundboard", e, sound.name);
                step++;
            }
        }
    } catch (e) {
        handleCloneError("Soundboard", e, "fetch");
    }

    return clonedCount;
}