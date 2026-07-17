import { NavigationRouter, RestAPI, GuildStore } from "@webpack/common";
import { findByPropsLazy } from "@webpack";

import { completeMainProgress, createMainProgressNotification, formatElapsed, notify, updateProgress, updateWithTime } from "../utils/notifications";

import { fetchGuildData, fetchGuildRoles, extractChannels, normalizeChannel, fetchAssetBase64 } from "../utils/api";
import { TaskQueue } from "../utils/TaskQueue";
import { translateError } from "../utils/errorHandler";
import { state, throwIfCancelled } from "../store";
import { CloneOptions } from "../types";
import { Guild } from "@vencord/discord-types";
import { replaceEmojis, sleep } from "../utils/helpers";
import { CloneContext } from "./types";


const AuthStore = findByPropsLazy("getToken");
async function fetchChannelsRaw(guildId: string): Promise<any[]> {
    const token = AuthStore?.getToken?.();
    if (!token) throw new Error("Could not get Discord token");
    const resp = await fetch(`/api/v9/guilds/${guildId}/channels`, {
        headers: { Authorization: token, "Content-Type": "application/json" }
    });
    if (!resp.ok) throw new Error(`Channels fetch failed: ${resp.status}`);
    return resp.json();
}






async function waitForGuildInStore(guildId: string, maxWaitMs = 10000): Promise<boolean> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
        if (GuildStore.getGuild(guildId)) return true;
        await sleep(200);
    }
    return false;
}

import { extractAndCloneEmojis, cloneRoles } from "./cloneRoles";
import { cloneChannels } from "./cloneChannels";
import { cloneSettings } from "./cloneSettings";
import { cloneOnboarding } from "./cloneOnboarding";
import { cloneStickers, cloneSoundboard } from "./cloneAssets";



export async function cloneServer(sourceGuild: Guild, options: CloneOptions) {
    if (state.isCloning) {
        notify("Already Cloning", "Please wait for the current clone to finish", "error");
        return;
    }

    state.isCloning = true;
    state.abortController = new AbortController();
    state.emojiIdMap = {};
    state.cloneErrors = [];
    state.sourceGuildName = sourceGuild.name;
    state.sourceGuildId = sourceGuild.id;
    state.isExistingServer = !!options.targetGuildId;
    state.optionsUsed = { ...options };

    let rolesFailed = 0;
    let channelsFailed = 0;
    let stickersCloned = 0;
    let soundboardCloned = 0;


    const taskQueue = new TaskQueue(5);

    try {
        const guild = GuildStore.getGuild(sourceGuild.id);

        if (!guild) throw new Error("Server not found");

        const fullGuildData = await fetchGuildData(sourceGuild.id);
        let estimateChannels: any[] = [];
        if (options.cloneChannels) {
            const isRealChannel = (ch: any) => ch?.name && ch.name !== "___hidden___";
            try {


                const restChannels = await fetchChannelsRaw(sourceGuild.id);
                estimateChannels = restChannels.filter(isRealChannel);


                const localChannels = extractChannels(sourceGuild.id, true);
                const restChannelIds = new Set(restChannels.map((c: any) => c.id));
                for (const localCh of localChannels) {
                    if (localCh?.id && !restChannelIds.has(localCh.id) && isRealChannel(localCh)) {
                        estimateChannels.push(normalizeChannel(localCh));
                    }
                }
            } catch (e) {
                console.warn("[ServerCloner] Failed to fetch channels via raw fetch, falling back to local store", e);
                estimateChannels = extractChannels(sourceGuild.id, true).filter((ch: any) => ch?.name && ch.name !== "___hidden___").map(normalizeChannel);
            }

        }
        const estimateRoles = options.cloneRoles ? await fetchGuildRoles(sourceGuild.id) : [];
        let channelCount = estimateChannels.length;
        let roleCount = estimateRoles.length - 1;

        if (options.targetGuildId && options.resumeMode) {
            try {
                const [targetRoles, targetChResp] = await Promise.all([
                    fetchGuildRoles(options.targetGuildId),
                    RestAPI.get({ url: `/guilds/${options.targetGuildId}/channels` })
                ]);
                const targetChannels = (targetChResp as any).body || [];

                const matchingRoles = estimateRoles.filter(sr =>
                    targetRoles.some((tr: any) => tr.name === sr.name && tr.color === sr.color)
                ).length;

                const matchingChannels = estimateChannels.filter(sc =>
                    targetChannels.some((tc: any) => tc.name === sc.name && tc.type === sc.type)
                ).length;

                roleCount = Math.max(0, roleCount - matchingRoles);
                channelCount = Math.max(0, channelCount - matchingChannels);
            } catch (e) {
                console.warn("[ServerCloner] Failed to pre-fetch target guild for estimates", e);
            }
        }

        let apiCalls = 4;
        let sleepSeconds = 0;

        if (options.targetGuildId) {
            if (!options.resumeMode) {
                const targetCh = extractChannels(options.targetGuildId, false);
                const targetRoles = await fetchGuildRoles(options.targetGuildId);
                if (options.cloneChannels) apiCalls += targetCh.length + 1;
                if (options.cloneRoles) apiCalls += targetRoles.filter((r: any) => r.name !== "@everyone").length;
                sleepSeconds += 6;
            }
            apiCalls += 1;
        } else {
            apiCalls += 4;
            sleepSeconds += 5;
        }

        if (options.cloneRoles) apiCalls += roleCount + 2;
        if (options.cloneChannels) {
            apiCalls += channelCount + 1 + Math.ceil(channelCount / 50);
            const isCommunity = fullGuildData?.features?.includes("COMMUNITY") || estimateChannels.some((c: any) => [5, 13, 15, 16].includes(c.type));
            if (isCommunity && !options.resumeMode) {
                apiCalls += 4;
                sleepSeconds += 2;
            }
        }
        if (options.cloneOnboarding) apiCalls += 2;
        apiCalls += 1;

        const apiDuration = apiCalls * 0.5;
        let estimatedSeconds = Math.max(10, Math.ceil(apiDuration + sleepSeconds));


        const formatTime = (s: number) => {
            const time = Math.max(0, Math.floor(s));
            const m = Math.floor(time / 60);
            const rs = time % 60;
            return `${m}:${rs.toString().padStart(2, '0')}`;
        };

        const timeStr = formatTime(estimatedSeconds);
        const initialMsg = options.targetGuildId
            ? `Starting... (Est. ${timeStr})`
            : `Starting... (Est. ${timeStr})\\nYou'll be navigated to the new server when cloning is complete.`;

        state.mainProgressNotificationId = createMainProgressNotification(
            `Cloning "${guild.name}"`,
            initialMsg,
            () => {},
            options.targetGuildId !== null,
            options.cloneRoles && options.cloneChannels
        );

        const hasRoles = options.cloneRoles;
        const hasChannels = options.cloneChannels;
        const hasOnboarding = options.cloneOnboarding;
        const hasStickers = options.cloneStickers;
        const hasSoundboard = options.cloneSoundboard;

        let totalWeight = (hasRoles ? 30 : 0) + (hasChannels ? 50 : 0) + 5 + (hasOnboarding ? 5 : 0) + (hasStickers ? 5 : 0) + (hasSoundboard ? 5 : 0);
        const scale = totalWeight > 0 ? (90 / totalWeight) : 1;
        let currentProgress = 5;

        const advanceProgress = (weight: number) => {
            const start = currentProgress;
            currentProgress += weight * scale;
            return { start, end: currentProgress };
        };

        const stickersProgress = advanceProgress(hasStickers ? 5 : 0);
        const soundboardProgress = advanceProgress(hasSoundboard ? 5 : 0);
        const rolesProgress = advanceProgress(hasRoles ? 30 : 0);
        const channelsProgress = advanceProgress(hasChannels ? 50 : 0);
        const settingsProgress = advanceProgress(5);
        const onboardingProgress = advanceProgress(hasOnboarding ? 5 : 0);


        updateWithTime(`Preparing server data...`, 5);

        let iconBase64: string | null = null;
        let bannerBase64: string | null = null;
        let splashBase64: string | null = null;

        [iconBase64, bannerBase64, splashBase64] = await Promise.all([
            guild.icon
                ? fetchAssetBase64(`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=512`)
                : Promise.resolve(null),
            (guild as any).banner
                ? fetchAssetBase64(`https://cdn.discordapp.com/banners/${guild.id}/${(guild as any).banner}.png?size=512`)
                : Promise.resolve(null),
            (guild as any).splash
                ? fetchAssetBase64(`https://cdn.discordapp.com/splashes/${guild.id}/${(guild as any).splash}.png?size=512`)
                : Promise.resolve(null),
        ]);

        throwIfCancelled();
        let newGuildId: string;

        if (options.targetGuildId) {
            newGuildId = options.targetGuildId;
            state.currentCloneGuildId = newGuildId;
            updateWithTime(`Preparing target server...`, 10);

            if (!options.resumeMode) {
                const overwriteQueue = new TaskQueue(3);
                if (options.cloneChannels) {
                    try {
                        await RestAPI.patch({
                            url: `/guilds/${newGuildId}`,
                            body: { features: [], system_channel_id: null, rules_channel_id: null, public_updates_channel_id: null, safety_alerts_channel_id: null }
                        });
                        await sleep(1000);
                    } catch (e) { }

                    const existingChannels = extractChannels(newGuildId, false).filter(c => c && c.id && c.id !== "null");
                    let deletedCount = 0;
                    const deletePromises = existingChannels.map(async (channel) => {
                        if (!state.isCloning) return;
                        try {
                            await overwriteQueue.execute(() => RestAPI.del({ url: `/channels/${channel.id}` }), msg => updateWithTime(`Deleting channel: ${channel.name} (${msg})`, 10), () => !state.isCloning);
                            deletedCount++;
                            updateWithTime(`Deleting channels: ${deletedCount}/${existingChannels.length}`, 10);
                        } catch (e: any) {
                            if (e?.message === "Cancelled") return;
                        }
                    });
                    await Promise.all(deletePromises);
                }

                if (options.cloneRoles) {
                    const existingRoles = await fetchGuildRoles(newGuildId);
                    const deletableRoles = existingRoles.filter((r: any) => r.name !== "@everyone");
                    let deletedRoles = 0;
                    const roleDeletePromises = deletableRoles.map(async (role) => {
                        if (!state.isCloning) return;
                        try {
                            await overwriteQueue.execute(() => RestAPI.del({ url: `/guilds/${newGuildId}/roles/${role.id}` }), msg => updateWithTime(`Deleting role: ${role.name} (${msg})`, 10), () => !state.isCloning);
                            deletedRoles++;
                            updateWithTime(`Deleting roles: ${deletedRoles}/${deletableRoles.length}`, 10);
                        } catch (e: any) {
                            if (e?.message === "Cancelled") return;
                        }
                    });
                    await Promise.all(roleDeletePromises);
                }

                updateWithTime(`Waiting for Discord to process deletions...`, 10);
                await sleep(2000);
            }

            const updatePayload: any = {
                name: guild.name + " (Clone)",
                description: replaceEmojis((guild as any).description),
                verification_level: (guild as any).verificationLevel ?? 0,
                default_message_notifications: (guild as any).defaultMessageNotifications ?? 0,
                explicit_content_filter: (guild as any).explicitContentFilter ?? 0,
                afk_timeout: (guild as any).afkTimeout ?? 300,
                preferred_locale: (guild as any).preferredLocale ?? "en-US",
                system_channel_flags: options.cloneSystemFlags ? ((guild as any).systemChannelFlags ?? 0) : 0,
            };
            if (iconBase64) updatePayload.icon = iconBase64;
            if (bannerBase64) updatePayload.banner = bannerBase64;
            if (splashBase64) updatePayload.splash = splashBase64;

            await RestAPI.patch({ url: `/guilds/${newGuildId}`, body: updatePayload });
        } else {
            const createPayload: any = {
                name: guild.name + " (Clone)",
                verification_level: (guild as any).verificationLevel ?? 0,
                default_message_notifications: (guild as any).defaultMessageNotifications ?? 0,
                explicit_content_filter: (guild as any).explicitContentFilter ?? 0,
                afk_timeout: (guild as any).afkTimeout ?? 300,
                preferred_locale: (guild as any).preferredLocale ?? "en-US",
                system_channel_flags: options.cloneSystemFlags ? ((guild as any).systemChannelFlags ?? 0) : 0,
            };
            if (iconBase64) createPayload.icon = iconBase64;

            const createResponse = await RestAPI.post({ url: "/guilds", body: createPayload });
            if (!createResponse?.body?.id) throw new Error("Failed to create guild");

            newGuildId = createResponse.body.id;
            state.currentCloneGuildId = newGuildId;



            const guildReady = await waitForGuildInStore(newGuildId, 10000);
            if (!guildReady) await sleep(1000);



            try { NavigationRouter.transitionToGuild(newGuildId); } catch (e) {}

            const defaultChannels = extractChannels(newGuildId, false).filter(c => c && c.id && c.id !== "null" && (c.type === 0 || c.type === 2 || c.type === 4));
            await Promise.all(defaultChannels.map(async (channel) => {
                try {
                    await RestAPI.del({ url: `/channels/${channel.id}` });
                } catch (e) {
                    console.warn("[ServerCloner] Failed to delete default channel:", e);
                }
            }));
        }

        updateWithTime(`Extracting used emojis...`, 15);

        const cloneContext: CloneContext = {
            sourceGuild,
            fullGuildData,
            newGuildId,
            options,
            roleIdMap: {},
            channelIdMap: {},
            taskQueue,
            estimateChannels,
            estimateRoles,
            rolesProgressStart: rolesProgress.start,
            rolesProgressEnd: rolesProgress.end,
            channelsProgressStart: channelsProgress.start,
            channelsProgressEnd: channelsProgress.end,
            settingsProgressEnd: settingsProgress.end,
            onboardingProgressStart: onboardingProgress.start,
            stickersProgressStart: stickersProgress.start,
            stickersProgressEnd: stickersProgress.end,
            soundboardProgressStart: soundboardProgress.start,
            soundboardProgressEnd: soundboardProgress.end
        };


        if (options.cloneEmojis || options.cloneOnboarding) {
            await extractAndCloneEmojis(cloneContext);
        }

        throwIfCancelled();


        const phaseTimers: { label: string; ms: number }[] = [];
        let _phaseStart = performance.now();

        if (options.cloneStickers) {
            _phaseStart = performance.now();
            stickersCloned = await cloneStickers(cloneContext);
            phaseTimers.push({ label: "Stickers", ms: performance.now() - _phaseStart });
        }

        throwIfCancelled();

        if (options.cloneSoundboard) {
            _phaseStart = performance.now();
            soundboardCloned = await cloneSoundboard(cloneContext);
            phaseTimers.push({ label: "Soundboard", ms: performance.now() - _phaseStart });
        }

        throwIfCancelled();
        updateWithTime(`Cloning content...`, rolesProgress.start);

        if (options.cloneRoles) {
            _phaseStart = performance.now();
            rolesFailed = await cloneRoles(cloneContext);
            phaseTimers.push({ label: "Roles", ms: performance.now() - _phaseStart });
        }


        throwIfCancelled();

        if (state.mainProgressNotificationId) {
            const skipBtn = document.getElementById(state.mainProgressNotificationId)?.querySelector(".cloner-skip-roles-btn") as HTMLElement;
            if (skipBtn) skipBtn.style.display = "none";
            updateWithTime(`Starting channels...`, channelsProgress.start);
        }

        if (options.cloneChannels) {
            _phaseStart = performance.now();
            channelsFailed = await cloneChannels(cloneContext);
            phaseTimers.push({ label: "Channels", ms: performance.now() - _phaseStart });

            _phaseStart = performance.now();
            await cloneSettings(cloneContext);
            phaseTimers.push({ label: "Settings", ms: performance.now() - _phaseStart });
        }

        throwIfCancelled();

        if (options.cloneOnboarding) {
            _phaseStart = performance.now();
            await cloneOnboarding(cloneContext);
            phaseTimers.push({ label: "Onboarding", ms: performance.now() - _phaseStart });
        }

        throwIfCancelled();

        if (!options.targetGuildId && (bannerBase64 || splashBase64 || fullGuildData?.description)) {
            try {
                const updatePayload: any = {};
                if (bannerBase64) updatePayload.banner = bannerBase64;
                if (splashBase64) updatePayload.splash = splashBase64;
                if (fullGuildData?.description) updatePayload.description = fullGuildData.description;

                await taskQueue.execute(async () => {
                    await RestAPI.patch({ url: `/guilds/${newGuildId}`, body: updatePayload });
                });
            } catch (e) { }
        }

        updateProgress(100);

        const totalFailed = rolesFailed + channelsFailed;



        if (options.targetGuildId) {
            try { NavigationRouter.transitionToGuild(newGuildId); } catch (e) {}
        }



        if (state.mainProgressNotificationId) {
            if (totalFailed > 0) {
                completeMainProgress(state.mainProgressNotificationId, `Cloned with ${totalFailed} errors`, true);
            } else {
                completeMainProgress(state.mainProgressNotificationId, `Successfully cloned "${guild.name}"!`, true);
            }
        }


        if (phaseTimers.length > 0) {
            const breakdown = phaseTimers
                .map(p => `${p.label}: ${formatElapsed(p.ms)}`)
                .join("  •  ");
            notify("Timing Breakdown", breakdown, "info", 10000);

        }

    } catch (e: any) {
        if (!state.isCloning || e.message?.includes("Cancelled")) return;
        const friendlyMsg = translateError(e);
        state.cloneErrors.push(`[Fatal]: ${friendlyMsg || e.message}`);



        if (state.mainProgressNotificationId) {
            completeMainProgress(state.mainProgressNotificationId, friendlyMsg, false);
        } else {
            notify("Clone Failed", friendlyMsg, "error");
        }
    } finally {
        state.isCloning = false;
        state.abortController = null;
        state.mainProgressNotificationId = null;
    }

}
