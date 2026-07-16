import { RestAPI } from "@webpack/common";
import { updateWithTime } from "../utils/notifications";
import { throwIfCancelled } from "../store";
import { handleCloneError } from "../utils/errorHandler";
import { CloneContext } from "./types";

export async function cloneSettings(ctx: CloneContext) {
    const { fullGuildData, newGuildId, channelIdMap, taskQueue, settingsProgressEnd, estimateChannels } = ctx;

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

        if (isCommunity) {
            const SELF_APPLICABLE_FEATURES = new Set(["COMMUNITY", "INVITES_DISABLED"]);
            settingsPayload.features = (fullGuildData.features || ["COMMUNITY"])
                .filter((f: string) => SELF_APPLICABLE_FEATURES.has(f));
            if (settingsPayload.features.length === 0) {
                settingsPayload.features = ["COMMUNITY"];
            }
        }

        if (Object.keys(settingsPayload).length > 0) {
            try {
                await taskQueue.execute(async () => {
                    await RestAPI.patch({
                        url: `/guilds/${newGuildId}`,
                        body: settingsPayload
                    });
                }, undefined, undefined, 5);
            } catch (patchError: any) {
                let errCode = patchError?.body?.code;
                if (!errCode && patchError?.text) {
                    try { errCode = JSON.parse(patchError.text).code; } catch (_) { }
                }
                if (errCode === 40006) {
                    console.warn("[ServerCloner] Guild settings update blocked by Discord (40006).");
                } else {
                    throw patchError;
                }
            }
        }


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
            const positionPromises: Promise<any>[] = [];
            for (let i = 0; i < positionUpdates.length; i += chunkSize) {
                const chunk = positionUpdates.slice(i, i + chunkSize);
                positionPromises.push(
                    taskQueue.execute(async () => {
                        await RestAPI.patch({
                            url: `/guilds/${newGuildId}/channels`,
                            body: chunk
                        });
                    })
                );
            }
            await Promise.all(positionPromises);
        }
    } catch (e) {
        handleCloneError("Settings", e);
    }
}