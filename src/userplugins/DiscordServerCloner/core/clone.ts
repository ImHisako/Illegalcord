import { NavigationRouter, RestAPI, GuildStore } from "@webpack/common";
import { notify, createMainProgressNotification, completeMainProgress, updateProgress, updateWithTime } from "../utils/notifications";
import { fetchGuildData, fetchGuildRoles, extractChannels, checkGuildExistence } from "../utils/api";
import { RateLimiter } from "../utils/rateLimiter";
import { translateError } from "../utils/errorHandler";
import { state, throwIfCancelled } from "../store";
import { CloneOptions } from "../types";
import { Guild } from "@vencord/discord-types";
import { replaceEmojis, sleep, arrayBufferToBase64 } from "../utils/helpers";
import { CloneContext } from "./types";
import { extractAndCloneEmojis, cloneRoles } from "./cloneRoles";
import { cloneChannels } from "./cloneChannels";
import { cloneSettings } from "./cloneSettings";
import { cloneOnboarding } from "./cloneOnboarding";
import { settings } from "../settings";

export async function cloneServer(sourceGuild: Guild, options: CloneOptions) {
    if (state.isCloning) {
        notify("Already Cloning", "Please wait for the current clone to finish", "error");
        return;
    }

    state.isCloning = true;
    state.abortController = new AbortController();
    state.emojiIdMap = {};

    let rolesFailed = 0;
    let channelsFailed = 0;

    let skipRoles = false;

    const roleRateLimiter = new RateLimiter(settings.store.channelDelay);
    const channelRateLimiter = new RateLimiter(settings.store.channelDelay);

    try {
        const guild = GuildStore.getGuild(sourceGuild.id);
        if (!guild) throw new Error("Server not found");

        const fullGuildData = await fetchGuildData(sourceGuild.id);
        const estimateChannels = options.cloneChannels ? await RestAPI.get({ url: `/guilds/${sourceGuild.id}/channels` }).then((r: any) => r.body || []) : [];
        const estimateRoles = options.cloneRoles ? await fetchGuildRoles(sourceGuild.id) : [];
        let channelCount = estimateChannels.length;
        let roleCount = estimateRoles.length - 1;
        const delayMs = settings.store.channelDelay;

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

        const avgDelaySeconds = (delayMs * 1.25) / 1000;
        let estimatedSeconds = Math.max(10, Math.ceil((apiCalls * avgDelaySeconds) + sleepSeconds));

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
            () => { skipRoles = true; },
            options.targetGuildId !== null,
            options.cloneRoles && options.cloneChannels
        );

        const hasRoles = options.cloneRoles;
        const hasChannels = options.cloneChannels;
        const hasOnboarding = options.cloneOnboarding;

        let totalWeight = (hasRoles ? 30 : 0) + (hasChannels ? 50 : 0) + 5 + (hasOnboarding ? 5 : 0);
        const scale = totalWeight > 0 ? (90 / totalWeight) : 1;
        let currentProgress = 5;

        const advanceProgress = (weight: number) => {
            const start = currentProgress;
            currentProgress += weight * scale;
            return { start, end: currentProgress };
        };

        const rolesProgress = advanceProgress(hasRoles ? 30 : 0);
        const channelsProgress = advanceProgress(hasChannels ? 50 : 0);
        const settingsProgress = advanceProgress(5);
        const onboardingProgress = advanceProgress(hasOnboarding ? 5 : 0);

        updateWithTime(`Preparing server data...`, 5);

        let iconBase64: string | null = null;
        let bannerBase64: string | null = null;
        let splashBase64: string | null = null;

        await Promise.all([
            (async () => {
                if (guild.icon) {
                    try {
                        const response = await fetch(`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=512`);
                        if (response.ok) iconBase64 = `data:image/png;base64,${arrayBufferToBase64(await response.arrayBuffer())}`;
                    } catch (e) { }
                }
            })(),
            (async () => {
                if ((guild as any).banner) {
                    try {
                        const response = await fetch(`https://cdn.discordapp.com/banners/${guild.id}/${(guild as any).banner}.png?size=512`);
                        if (response.ok) bannerBase64 = `data:image/png;base64,${arrayBufferToBase64(await response.arrayBuffer())}`;
                    } catch (e) { }
                }
            })(),
            (async () => {
                if ((guild as any).splash) {
                    try {
                        const response = await fetch(`https://cdn.discordapp.com/splashes/${guild.id}/${(guild as any).splash}.png?size=512`);
                        if (response.ok) splashBase64 = `data:image/png;base64,${arrayBufferToBase64(await response.arrayBuffer())}`;
                    } catch (e) { }
                }
            })()
        ]);

        throwIfCancelled();
        let newGuildId: string;

        if (options.targetGuildId) {
            newGuildId = options.targetGuildId;
            state.currentCloneGuildId = newGuildId;
            updateWithTime(`Preparing target server...`, 10);

            if (!options.resumeMode) {
                const overwriteLimiter = new RateLimiter(1000);
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
                    for (const channel of existingChannels) {
                        if (!state.isCloning) break;
                        deletedCount++;
                        updateWithTime(`Deleting channel ${deletedCount}/${existingChannels.length}: ${channel.name}`, 10);
                        try {
                            await overwriteLimiter.execute(() => RestAPI.del({ url: `/channels/${channel.id}` }), msg => updateWithTime(`Deleting channel: ${channel.name} (${msg})`, 10), () => !state.isCloning);
                        } catch (e: any) {
                            if (e?.message === "Cancelled") break;
                        }
                    }
                }

                if (options.cloneRoles) {
                    const existingRoles = await fetchGuildRoles(newGuildId);
                    const deletableRoles = existingRoles.filter((r: any) => r.name !== "@everyone");
                    let deletedRoles = 0;
                    for (const role of existingRoles) {
                        if (!state.isCloning) break;
                        if (role.name === "@everyone") continue;
                        deletedRoles++;
                        updateWithTime(`Deleting role ${deletedRoles}/${deletableRoles.length}: ${role.name}`, 10);
                        try {
                            await overwriteLimiter.execute(() => RestAPI.del({ url: `/guilds/${newGuildId}/roles/${role.id}` }), msg => updateWithTime(`Deleting role: ${role.name} (${msg})`, 10), () => !state.isCloning);
                        } catch (e: any) {
                            if (e?.message === "Cancelled") break;
                        }
                    }
                }

                updateWithTime(`Waiting for Discord to process deletions...`, 10);
                await sleep(5000);
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
            await sleep(5000);

            const defaultChannels = extractChannels(newGuildId, false).filter(c => c && c.id && c.id !== "null" && (c.type === 0 || c.type === 2 || c.type === 4));
            for (const channel of defaultChannels) {
                try {
                    await RestAPI.del({ url: `/channels/${channel.id}` });
                    await sleep(500);
                } catch (e) {
                    console.warn("[ServerCloner] Failed to delete default channel:", e);
                }
            }
        }

        updateWithTime(`Extracting used emojis...`, 15);

        const cloneContext: CloneContext = {
            sourceGuild,
            fullGuildData,
            newGuildId,
            options,
            roleIdMap: {},
            channelIdMap: {},
            roleRateLimiter,
            channelRateLimiter,
            estimateChannels,
            estimateRoles,
            rolesProgressStart: rolesProgress.start,
            rolesProgressEnd: rolesProgress.end,
            channelsProgressStart: channelsProgress.start,
            channelsProgressEnd: channelsProgress.end,
            settingsProgressEnd: settingsProgress.end,
            onboardingProgressStart: onboardingProgress.start
        };

        if (options.cloneEmojis || options.cloneOnboarding) {
            await extractAndCloneEmojis(cloneContext);
        }

        throwIfCancelled();
        updateWithTime(`Cloning content...`, rolesProgress.start);

        if (options.cloneRoles) {
            rolesFailed = await cloneRoles(cloneContext);
        }

        throwIfCancelled();

        if (state.mainProgressNotificationId) {
            const skipBtn = document.getElementById(state.mainProgressNotificationId)?.querySelector(".cloner-skip-roles-btn") as HTMLElement;
            if (skipBtn) skipBtn.style.display = "none";
            updateWithTime(`Starting channels...`, channelsProgress.start);
        }

        if (options.cloneChannels) {
            channelsFailed = await cloneChannels(cloneContext);
            await cloneSettings(cloneContext);
        }

        throwIfCancelled();

        if (options.cloneOnboarding) {
            await cloneOnboarding(cloneContext);
        }

        throwIfCancelled();

        if (bannerBase64 || splashBase64 || fullGuildData?.description) {
            try {
                const updatePayload: any = {};
                if (bannerBase64) updatePayload.banner = bannerBase64;
                if (splashBase64) updatePayload.splash = splashBase64;
                if (fullGuildData?.description) updatePayload.description = fullGuildData.description;

                await channelRateLimiter.execute(async () => {
                    await RestAPI.patch({ url: `/guilds/${newGuildId}`, body: updatePayload });
                });
            } catch (e) { }
        }

        updateProgress(100);

        const totalFailed = rolesFailed + channelsFailed;

        try {
            NavigationRouter.transitionToGuild(newGuildId);
        } catch (e) { }

        if (state.mainProgressNotificationId) {
            if (totalFailed > 0) {
                completeMainProgress(state.mainProgressNotificationId, `Cloned with ${totalFailed} errors`, true);
            } else {
                completeMainProgress(state.mainProgressNotificationId, `Successfully cloned "${guild.name}"!`, true);
            }
        }

    } catch (e: any) {
        if (!state.isCloning || e.message === "Cancelled" || e.message?.includes("Cancelled")) return;
        const friendlyMsg = translateError(e);
        if (state.mainProgressNotificationId) {
            completeMainProgress(state.mainProgressNotificationId, friendlyMsg, false);
        } else {
            notify("Clone Failed", friendlyMsg, "error");
        }
    } finally {
        if ((globalThis as any)._clonerTimer) {
            clearInterval((globalThis as any)._clonerTimer);
            delete (globalThis as any)._clonerTimer;
        }
        state.isCloning = false;
        state.abortController = null;
        state.mainProgressNotificationId = null;
    }
}
