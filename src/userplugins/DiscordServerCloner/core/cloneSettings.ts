import { RestAPI } from "@webpack/common";
import { updateWithTime } from "../utils/notifications";
import { handleCloneError } from "../utils/errorHandler";
import { sleep } from "../utils/helpers";
import { throwIfCancelled } from "../store";
import { CloneContext } from "./types";

export async function cloneSettings(ctx: CloneContext) {
    const { fullGuildData, newGuildId, channelIdMap, settingsProgressEnd, estimateChannels } = ctx;
    
    try {
        const settingsPayload: any = {};

        if (fullGuildData.rules_channel_id && channelIdMap[fullGuildData.rules_channel_id]) {
            settingsPayload.rules_channel_id = channelIdMap[fullGuildData.rules_channel_id];
        }
        if (fullGuildData.public_updates_channel_id && channelIdMap[fullGuildData.public_updates_channel_id]) {
            settingsPayload.public_updates_channel_id = channelIdMap[fullGuildData.public_updates_channel_id];
        }
        if (fullGuildData.system_channel_id && channelIdMap[fullGuildData.system_channel_id]) {
            settingsPayload.system_channel_id = channelIdMap[fullGuildData.system_channel_id];
        }
        if (fullGuildData.safety_alerts_channel_id && channelIdMap[fullGuildData.safety_alerts_channel_id]) {
            settingsPayload.safety_alerts_channel_id = channelIdMap[fullGuildData.safety_alerts_channel_id];
        }
        if (fullGuildData.afk_channel_id && channelIdMap[fullGuildData.afk_channel_id]) {
            settingsPayload.afk_channel_id = channelIdMap[fullGuildData.afk_channel_id];
        }

        const isCommunity = fullGuildData.features?.includes("COMMUNITY") ||
            estimateChannels.some((c: any) => [5, 13, 15, 16].includes(c.type));

        if (fullGuildData.features?.includes("COMMUNITY") || isCommunity) {
            settingsPayload.features = fullGuildData.features || ["COMMUNITY"];
        }

        if (Object.keys(settingsPayload).length > 0) {
            for (let attempt = 0; attempt < 5; attempt++) {
                try {
                    await RestAPI.patch({
                        url: `/guilds/${newGuildId}`,
                        body: settingsPayload
                    });
                    break;
                } catch (patchError: any) {
                    let errCode = patchError?.body?.code;
                    if (!errCode && patchError?.text) {
                        try { errCode = JSON.parse(patchError.text).code; } catch (_) { }
                    }
                    if (errCode === 40006) {
                        console.warn("[ServerCloner] Guild settings update blocked by Discord (40006). Skipping retry.");
                        break;
                    }

                    if (attempt < 4 && (patchError?.status === 403 || patchError?.status === 429)) {
                        const backoff = 5000 + (attempt * 3000);
                        console.warn(`[ServerCloner] Guild settings PATCH failed (attempt ${attempt + 1}/5), retrying in ${backoff / 1000}s...`);
                        await sleep(backoff);
                    } else {
                        throw patchError;
                    }
                }
            }
        }

        // Sync channel positions
        const positionUpdates: any[] = [];
        const categories = estimateChannels.filter((c: any) => c.type === 4);
        const otherChannels = estimateChannels.filter((c: any) => c.type !== 4);
        
        for (const cat of categories) {
            if (channelIdMap[cat.id]) {
                positionUpdates.push({ id: channelIdMap[cat.id], position: typeof cat.position === 'number' ? cat.position : 0 });
            }
        }
        for (const ch of otherChannels) {
            if (channelIdMap[ch.id]) {
                positionUpdates.push({ id: channelIdMap[ch.id], position: typeof ch.position === 'number' ? ch.position : 0 });
            }
        }

        if (positionUpdates.length > 0) {
            updateWithTime("Syncing channel positions...", settingsProgressEnd - 2);
            const chunkSize = 50;
            for (let i = 0; i < positionUpdates.length; i += chunkSize) {
                await RestAPI.patch({
                    url: `/guilds/${newGuildId}/channels`,
                    body: positionUpdates.slice(i, i + chunkSize)
                });
            }
        }
    } catch (e) {
        handleCloneError("Settings", e);
    }
}
