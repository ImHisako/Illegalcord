/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Aleeeh07 (@febbraio)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { findByCodeLazy, findStoreLazy } from "@webpack";
import { FluxDispatcher, GuildStore, RestAPI } from "@webpack/common";

import { settings } from "./settings";

const logger = new Logger("VoiceBoard");

const SoundboardStore = findStoreLazy("SoundboardStore") as {
    getSounds(): Map<string, unknown[]>;
    isFetching?: () => boolean;
};

const fetchSoundboardSounds: (opts?: { disableAnalytics?: boolean; }) => Promise<unknown> = findByCodeLazy(
    "OVERLAY_SOUNDBOARD_SOUNDS_FETCH_REQUEST",
    "REQUEST_SOUNDBOARD_SOUNDS",
    "GUILD_SOUNDBOARD_FETCH"
);

const restFetched = new Set<string>();
let loading: Promise<void> | null = null;
let didGatewayFetch = false;

function normalizeSound(raw: Record<string, any>, guildId: string) {
    return {
        name: raw.name,
        soundId: raw.sound_id ?? raw.soundId,
        emojiName: raw.emoji_name ?? raw.emojiName,
        emojiId: raw.emoji_id ?? raw.emojiId,
        userId: raw.user_id ?? raw.userId,
        volume: raw.volume,
        available: true,
        guildId,
    };
}

function parseSoundList(body: unknown): Record<string, any>[] {
    if (Array.isArray(body))
        return body;

    if (body != null && typeof body === "object") {
        const o = body as Record<string, unknown>;
        if (Array.isArray(o.items))
            return o.items as Record<string, any>[];
        if (Array.isArray(o.sounds))
            return o.sounds as Record<string, any>[];
    }

    return [];
}

function hasSounds(guildId: string) {
    const list = SoundboardStore.getSounds().get(guildId);
    return list != null && list.length > 0;
}

function missingGuildIds() {
    return GuildStore.getGuildIds().filter(id => !restFetched.has(id) && !hasSounds(id));
}

export function resetGuildSoundFetch() {
    restFetched.clear();
    didGatewayFetch = false;
}

function sleep(ms: number) {
    return new Promise<void>(r => setTimeout(r, ms));
}

async function waitForDiscordFetch() {
    for (let i = 0; i < 40; i++) {
        if (SoundboardStore.isFetching?.())
            await sleep(100);
        else
            break;
    }

    await sleep(100);
}

export function ensureAllGuildSounds() {
    if (!settings.store.alwaysUsePlugin || !settings.store.showAllServers)
        return;

    if (loading != null)
        return loading;

    if (missingGuildIds().length === 0)
        return;

    loading = (async () => {
        try {
            await waitForDiscordFetch();

            if (!didGatewayFetch) {
                didGatewayFetch = true;
                try {
                    await fetchSoundboardSounds({ disableAnalytics: true });
                    await waitForDiscordFetch();
                } catch (error) {
                    logger.debug("Discord soundboard fetch failed", error);
                }
            }

            const missing = missingGuildIds();
            if (missing.length === 0)
                return;

            logger.info(`REST-fetching soundboards for ${missing.length} guild(s)`);

            const updates: { guildId: string; sounds: ReturnType<typeof normalizeSound>[]; }[] = [];

            await Promise.all(missing.map(async guildId => {
                if (hasSounds(guildId)) {
                    restFetched.add(guildId);
                    return;
                }

                try {
                    const res = await RestAPI.get({
                        url: `/guilds/${guildId}/soundboard-sounds`,
                    });
                    const list = parseSoundList(res.body);

                    restFetched.add(guildId);

                    if (list.length === 0) {
                        logger.debug("No sounds returned for guild", guildId);
                        return;
                    }

                    if (hasSounds(guildId))
                        return;

                    updates.push({
                        guildId,
                        sounds: list.map(s => normalizeSound(s, guildId)),
                    });
                } catch (error) {
                    restFetched.add(guildId);
                    logger.warn("Could not fetch soundboard for guild", guildId, error);
                }
            }));

            if (updates.length === 0)
                return;

            FluxDispatcher.dispatch({
                type: "SOUNDBOARD_SOUNDS_RECEIVED",
                updates,
            });

            logger.info(`Loaded soundboards for ${updates.length} guild(s)`);
        } finally {
            loading = null;
        }
    })();

    return loading;
}
