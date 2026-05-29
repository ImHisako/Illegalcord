/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import type { VoiceState } from "@vencord/discord-types";
import { ChannelRouter, ChannelStore, SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

interface StoredVoiceState {
    channelId?: string;
    selfStream: boolean;
    selfVideo: boolean;
}

type AlertType = "stream" | "video";

const previousStates = new Map<string, StoredVoiceState>();
const lastNotifiedAt = new Map<string, number>();

const settings = definePluginSettings({
    notifyScreenshare: {
        type: OptionType.BOOLEAN,
        description: "Notify when someone starts sharing their screen.",
        default: true
    },
    notifyCamera: {
        type: OptionType.BOOLEAN,
        description: "Notify when someone turns on their camera.",
        default: false
    },
    ignoreSelf: {
        type: OptionType.BOOLEAN,
        description: "Ignore your own screen share and camera changes.",
        default: true
    },
    onlyCurrentChannel: {
        type: OptionType.BOOLEAN,
        description: "Only notify for users in your current voice channel.",
        default: true
    },
    permanent: {
        type: OptionType.BOOLEAN,
        description: "Keep alerts visible until you dismiss them.",
        default: false
    },
    cooldownSeconds: {
        type: OptionType.SLIDER,
        description: "Seconds before the same user can trigger the same alert again.",
        markers: [0, 15, 30, 60, 120],
        default: 30,
        stickToMarkers: false
    }
});

function getStoredState(state: VoiceState): StoredVoiceState {
    return {
        channelId: state.channelId ?? undefined,
        selfStream: state.selfStream ?? false,
        selfVideo: state.selfVideo
    };
}

function isCurrentVoiceChannel(channelId?: string) {
    return !!channelId && SelectedChannelStore.getVoiceChannelId() === channelId;
}

function getChannelName(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    return channel?.name ? ` in ${channel.name}` : "";
}

function shouldNotify(userId: string, channelId: string, type: AlertType) {
    if (settings.store.ignoreSelf && userId === UserStore.getCurrentUser().id) return false;
    if (settings.store.onlyCurrentChannel && !isCurrentVoiceChannel(channelId)) return false;

    const key = `${userId}:${type}`;
    const cooldown = settings.store.cooldownSeconds * 1000;
    const last = lastNotifiedAt.get(key) ?? 0;

    if (cooldown > 0 && Date.now() - last < cooldown) return false;

    lastNotifiedAt.set(key, Date.now());
    return true;
}

function notify(userId: string, channelId: string, type: AlertType) {
    if (!shouldNotify(userId, channelId, type)) return;

    const user = UserStore.getUser(userId);
    const username = user?.username ?? "Someone";
    const isStream = type === "stream";

    showNotification({
        title: isStream ? "Screen share started" : "Camera enabled",
        body: `${username} ${isStream ? "started sharing their screen" : "turned on their camera"}${getChannelName(channelId)}.`,
        icon: user?.getAvatarURL(),
        color: isStream ? "#5865f2" : "#3ba55c",
        permanent: settings.store.permanent,
        onClick: () => ChannelRouter.transitionToChannel(channelId)
    });
}

function handleVoiceState(state: VoiceState) {
    const { userId, channelId } = state;
    const previous = previousStates.get(userId);
    const next = getStoredState(state);

    previousStates.set(userId, next);

    if (!channelId) {
        previousStates.delete(userId);
        return;
    }

    if (!previous) return;

    if (settings.store.notifyScreenshare && !previous.selfStream && next.selfStream) {
        notify(userId, channelId, "stream");
    }

    if (settings.store.notifyCamera && !previous.selfVideo && next.selfVideo) {
        notify(userId, channelId, "video");
    }
}

function seedCurrentGuildStates() {
    previousStates.clear();

    const channelId = SelectedChannelStore.getVoiceChannelId();
    if (!channelId) return;

    const channel = ChannelStore.getChannel(channelId);
    if (!channel?.guild_id) return;

    const voiceStates = VoiceStateStore.getVoiceStates(channel.guild_id);
    for (const state of Object.values(voiceStates)) {
        previousStates.set(state.userId, getStoredState(state));
    }
}

export default definePlugin({
    name: "ScreenShareAlert",
    description: "Sends native notifications when someone starts sharing their screen in voice.",
    tags: ["Voice", "Notifications", "Utility"],
    authors: [{ name: "irritably", id: 928787166916640838n }],
    settings,

    start() {
        seedCurrentGuildStates();
    },

    stop() {
        previousStates.clear();
        lastNotifiedAt.clear();
    },

    flux: {
        VOICE_CHANNEL_SELECT() {
            seedCurrentGuildStates();
        },
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            for (const state of voiceStates) {
                handleVoiceState(state);
            }
        }
    }
});
