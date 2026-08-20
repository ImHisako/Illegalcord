/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Constants, RestAPI } from "@webpack/common";

import { throwIfCancelled } from "../store";
import { handleCloneError } from "../utils/errorHandler";
import { isRecord } from "../utils/helpers";
import { updateWithTime } from "../utils/notifications";
import { CloneContext } from "./types";

function getErrorCode(error: unknown): number | undefined {
    if (!isRecord(error)) return undefined;
    if (typeof error.code === "number") return error.code;
    return isRecord(error.body) && typeof error.body.code === "number" ? error.body.code : undefined;
}

export async function cloneSettings(context: CloneContext): Promise<void> {
    const { fullGuildData, newGuildId, channelIdMap, taskQueue, settingsProgressEnd, estimateChannels } = context;

    try {
        throwIfCancelled();
        const body: Record<string, unknown> = {};
        const channelSettings = {
            afk_channel_id: fullGuildData.afk_channel_id,
            public_updates_channel_id: fullGuildData.public_updates_channel_id,
            rules_channel_id: fullGuildData.rules_channel_id,
            safety_alerts_channel_id: fullGuildData.safety_alerts_channel_id,
            system_channel_id: fullGuildData.system_channel_id
        };

        for (const [key, sourceChannelId] of Object.entries(channelSettings)) {
            if (sourceChannelId && channelIdMap[sourceChannelId]) body[key] = channelIdMap[sourceChannelId];
        }

        const isCommunity = fullGuildData.features.includes("COMMUNITY") || estimateChannels.some(channel => [5, 13, 15, 16].includes(channel.type));
        if (isCommunity) {
            const applicableFeatures = new Set(["COMMUNITY", "INVITES_DISABLED"]);
            const features = fullGuildData.features.filter(feature => applicableFeatures.has(feature));
            body.features = features.length > 0 ? features : ["COMMUNITY"];
        }

        if (Object.keys(body).length > 0) {
            try {
                await taskQueue.execute(() => RestAPI.patch({ url: Constants.Endpoints.GUILD(newGuildId), body }), undefined, undefined, 5);
            } catch (error: unknown) {
                if (getErrorCode(error) !== 40006) throw error;
            }
        }

        const positionUpdates = estimateChannels
            .filter(channel => channelIdMap[channel.id])
            .map(channel => ({ id: channelIdMap[channel.id], position: channel.position }));

        if (positionUpdates.length > 0) {
            updateWithTime("Syncing channel positions.", settingsProgressEnd - 2);
            const requests: Promise<unknown>[] = [];
            for (let index = 0; index < positionUpdates.length; index += 50) {
                const chunk = positionUpdates.slice(index, index + 50);
                requests.push(taskQueue.execute(() => RestAPI.patch({ url: `/guilds/${newGuildId}/channels`, body: chunk })));
            }
            await Promise.all(requests);
        }
    } catch (error: unknown) {
        handleCloneError("Settings", error);
    }
}
