/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Guild } from "@vencord/discord-types";
import { Constants, GuildStore, IconUtils, NavigationRouter, RestAPI } from "@webpack/common";

import { state, throwIfCancelled } from "../store";
import { CloneOptions } from "../types";
import { fetchAssetBase64, fetchGuildChannels, fetchGuildData, fetchGuildRoles } from "../utils/api";
import { translateError } from "../utils/errorHandler";
import { replaceEmojis, sleep } from "../utils/helpers";
import { completeMainProgress, createMainProgressNotification, formatElapsed, notify, updateProgress, updateWithTime } from "../utils/notifications";
import { TaskQueue } from "../utils/TaskQueue";
import { cloneSoundboard, cloneStickers } from "./cloneAssets";
import { cloneChannels } from "./cloneChannels";
import { cloneOnboarding } from "./cloneOnboarding";
import { cloneRoles, extractAndCloneEmojis } from "./cloneRoles";
import { cloneSettings } from "./cloneSettings";
import { CloneChannel, CloneContext, CloneRole } from "./types";

async function waitForGuildInStore(guildId: string, maxWaitMs = 10000): Promise<void> {
    const deadline = Date.now() + maxWaitMs;
    while (!GuildStore.getGuild(guildId)) {
        throwIfCancelled();
        if (Date.now() >= deadline) throw new Error("The new server did not become available in time");
        await sleep(200);
    }
}

function validateSourceSnapshot(options: CloneOptions, channels: CloneChannel[], roles: CloneRole[]): void {
    if (options.cloneChannels && channels.length === 0) throw new Error("No source channels were returned. Nothing was changed.");
    if (options.cloneRoles && !roles.some(role => role.name === "@everyone")) throw new Error("The source role list is incomplete. Nothing was changed.");
}

async function deleteTargetContent(
    guildId: string,
    options: CloneOptions,
    channels: CloneChannel[],
    roles: CloneRole[],
    queue: TaskQueue
): Promise<void> {
    if (options.cloneChannels) {
        await RestAPI.patch({
            url: Constants.Endpoints.GUILD(guildId),
            body: {
                features: [],
                public_updates_channel_id: null,
                rules_channel_id: null,
                safety_alerts_channel_id: null,
                system_channel_id: null
            }
        });

        await Promise.all(channels.map(channel => queue.execute(
            () => RestAPI.del({ url: Constants.Endpoints.CHANNEL(channel.id) }),
            message => updateWithTime(`Deleting ${channel.name}. ${message}`, 10)
        )));
    }

    if (options.cloneRoles) {
        const deletableRoles = roles.filter(role => role.name !== "@everyone" && !role.managed);
        await Promise.all(deletableRoles.map(role => queue.execute(
            () => RestAPI.del({ url: `/guilds/${guildId}/roles/${role.id}` }),
            message => updateWithTime(`Deleting ${role.name}. ${message}`, 10)
        )));
    }
}

function getGuildPayload(guild: Guild, options: CloneOptions, description?: string | null): Record<string, unknown> {
    return {
        afk_timeout: guild.afkTimeout,
        default_message_notifications: guild.defaultMessageNotifications,
        description,
        explicit_content_filter: guild.explicitContentFilter,
        name: `${guild.name} (Clone)`,
        preferred_locale: guild.preferredLocale,
        system_channel_flags: options.cloneSystemFlags ? guild.systemChannelFlags : 0,
        verification_level: guild.verificationLevel
    };
}

export async function cloneServer(sourceGuild: Guild, options: CloneOptions): Promise<void> {
    if (state.isCloning) {
        notify("Clone already running", "Wait for the current clone to finish.", "error");
        return;
    }

    state.isCloning = true;
    state.abortController = new AbortController();
    state.cloneErrors = [];
    state.emojiIdMap = {};

    const taskQueue = new TaskQueue(2);
    const roleQueue = new TaskQueue(2);
    const channelQueue = new TaskQueue(2);
    const deleteQueue = new TaskQueue(3);
    const assetQueue = new TaskQueue(2);

    try {
        const guild = GuildStore.getGuild(sourceGuild.id);
        if (!guild) throw new Error("The source server no longer exists");

        const [fullGuildData, estimateChannels, estimateRoles] = await Promise.all([
            fetchGuildData(guild.id),
            options.cloneChannels ? fetchGuildChannels(guild.id) : Promise.resolve([]),
            options.cloneRoles ? fetchGuildRoles(guild.id) : Promise.resolve([])
        ]);
        validateSourceSnapshot(options, estimateChannels, estimateRoles);

        let targetChannels: CloneChannel[] = [];
        let targetRoles: CloneRole[] = [];
        if (options.targetGuildId && !options.resumeMode) {
            if (!GuildStore.getGuild(options.targetGuildId)) throw new Error("The target server no longer exists");
            [targetChannels, targetRoles] = await Promise.all([
                options.cloneChannels ? fetchGuildChannels(options.targetGuildId) : Promise.resolve([]),
                options.cloneRoles ? fetchGuildRoles(options.targetGuildId) : Promise.resolve([])
            ]);
        }

        state.mainProgressNotificationId = createMainProgressNotification(
            `Cloning ${guild.name}`,
            "The source snapshot is valid and cloning has started.",
            options.targetGuildId !== null
        );

        const iconUrl = guild.icon ? IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 512 }) : null;
        const bannerUrl = guild.banner ? IconUtils.getGuildBannerURL(guild, false) : null;
        const splashUrl: string | null = guild.splash ? IconUtils.getGuildSplashURL(guild, false) : null;
        const [iconBase64, bannerBase64, splashBase64] = await Promise.all([
            iconUrl ? fetchAssetBase64(iconUrl) : null,
            bannerUrl ? fetchAssetBase64(bannerUrl) : null,
            splashUrl ? fetchAssetBase64(splashUrl) : null
        ]);

        throwIfCancelled();

        let newGuildId: string;
        if (options.targetGuildId) {
            newGuildId = options.targetGuildId;
            state.currentCloneGuildId = newGuildId;

            if (!options.resumeMode) {
                await deleteTargetContent(newGuildId, options, targetChannels, targetRoles, deleteQueue);
                throwIfCancelled();
            }

            const updatePayload = getGuildPayload(guild, options, replaceEmojis(fullGuildData.description));
            if (!guild.icon) updatePayload.icon = null;
            else if (iconBase64) updatePayload.icon = iconBase64;
            if (!guild.banner) updatePayload.banner = null;
            else if (bannerBase64) updatePayload.banner = bannerBase64;
            if (!guild.splash) updatePayload.splash = null;
            else if (splashBase64) updatePayload.splash = splashBase64;
            await RestAPI.patch({ url: Constants.Endpoints.GUILD(newGuildId), body: updatePayload });
        } else {
            const createPayload = getGuildPayload(guild, options);
            if (iconBase64) createPayload.icon = iconBase64;

            const response: { body?: { id?: unknown; }; } = await RestAPI.post({ url: "/guilds", body: createPayload });
            if (typeof response.body?.id !== "string") throw new Error("Discord did not return the new server ID");

            newGuildId = response.body.id;
            state.currentCloneGuildId = newGuildId;
            await waitForGuildInStore(newGuildId);
            NavigationRouter.transitionToGuild(newGuildId);

            const defaultChannels = await fetchGuildChannels(newGuildId);
            await Promise.all(defaultChannels.map(channel => RestAPI.del({ url: Constants.Endpoints.CHANNEL(channel.id) })));
        }

        const hasRoles = options.cloneRoles;
        const hasChannels = options.cloneChannels;
        const hasOnboarding = options.cloneOnboarding;
        const hasStickers = options.cloneStickers;
        const hasSoundboard = options.cloneSoundboard;
        const totalWeight = (hasRoles ? 30 : 0) + (hasChannels ? 50 : 0) + 5 + (hasOnboarding ? 5 : 0) + (hasStickers ? 5 : 0) + (hasSoundboard ? 5 : 0);
        const scale = totalWeight > 0 ? 90 / totalWeight : 1;
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

        const context: CloneContext = {
            sourceGuild,
            fullGuildData,
            newGuildId,
            options,
            roleIdMap: {},
            channelIdMap: {},
            taskQueue,
            roleQueue,
            channelQueue,
            deleteQueue,
            assetQueue,
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

        if (hasRoles || hasChannels || hasOnboarding) await extractAndCloneEmojis(context);
        throwIfCancelled();

        const phaseTimers: { label: string; ms: number; }[] = [];
        let phaseStart = performance.now();

        if (hasStickers) {
            await cloneStickers(context);
            phaseTimers.push({ label: "Stickers", ms: performance.now() - phaseStart });
            phaseStart = performance.now();
        }
        throwIfCancelled();

        if (hasSoundboard) {
            await cloneSoundboard(context);
            phaseTimers.push({ label: "Soundboard", ms: performance.now() - phaseStart });
            phaseStart = performance.now();
        }
        throwIfCancelled();

        if (hasRoles) {
            await cloneRoles(context);
            phaseTimers.push({ label: "Roles", ms: performance.now() - phaseStart });
            phaseStart = performance.now();
        }
        throwIfCancelled();

        if (hasChannels) {
            await cloneChannels(context);
            phaseTimers.push({ label: "Channels", ms: performance.now() - phaseStart });
            phaseStart = performance.now();
            await cloneSettings(context);
            phaseTimers.push({ label: "Settings", ms: performance.now() - phaseStart });
            phaseStart = performance.now();
        }
        throwIfCancelled();

        if (hasOnboarding) {
            await cloneOnboarding(context);
            phaseTimers.push({ label: "Onboarding", ms: performance.now() - phaseStart });
        }
        throwIfCancelled();

        if (!options.targetGuildId && (bannerBase64 || splashBase64 || fullGuildData.description)) {
            const updatePayload: Record<string, unknown> = {};
            if (bannerBase64) updatePayload.banner = bannerBase64;
            if (splashBase64) updatePayload.splash = splashBase64;
            if (fullGuildData.description) updatePayload.description = replaceEmojis(fullGuildData.description);
            await taskQueue.execute(() => RestAPI.patch({ url: Constants.Endpoints.GUILD(newGuildId), body: updatePayload }));
        }

        updateProgress(100);
        if (options.targetGuildId) NavigationRouter.transitionToGuild(newGuildId);

        const totalFailed = state.cloneErrors.length;
        if (state.mainProgressNotificationId) {
            completeMainProgress(
                state.mainProgressNotificationId,
                totalFailed > 0 ? `Cloned with ${totalFailed} errors` : `Successfully cloned ${guild.name}`,
                totalFailed === 0
            );
        }

        if (phaseTimers.length > 0) {
            notify("Clone timing", phaseTimers.map(phase => `${phase.label}: ${formatElapsed(phase.ms)}`).join(" • "));
        }
    } catch (error: unknown) {
        const friendlyMessage = translateError(error);
        if (!state.isCloning || !friendlyMessage) return;

        state.cloneErrors.push(`[Fatal]: ${friendlyMessage}`);
        if (state.mainProgressNotificationId) completeMainProgress(state.mainProgressNotificationId, friendlyMessage, false);
        else notify("Clone failed", friendlyMessage, "error");
    } finally {
        state.isCloning = false;
        state.abortController = null;
        state.mainProgressNotificationId = null;
    }
}
