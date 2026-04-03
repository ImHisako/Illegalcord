/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { ChannelStore, GenericStore, GuildStore, UserStore } from "@webpack/common";

import { logStalkerEvent, settings, targets } from ".";

const { selectVoiceChannel } = findByPropsLazy("selectVoiceChannel", "selectChannel");

const VoiceStateStore: GenericStore = findStoreLazy("VoiceStateStore");

type MainVoiceStateData = {
    channelId: string;
    userId: string;
};

let lastVoiceState: Record<string, MainVoiceStateData> = {};

const getChannelName = (channelId: string): string => {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return "Unknown channel";

    if (channel.isGuildVoice() || channel.isGuildStageVoice()) {
        const guild = GuildStore.getGuild(channel.guild_id);
        return `${channel.name} from ${guild?.name ?? "Unknown server"}`;
    }

    return channel.name ?? "Unknown channel";
};

export const init = () => {
    // Inizializza lo stato attuale senza notificare,
    // per evitare notifiche spurie all'avvio per chi era già in chiamata
    const initialState: Record<string, MainVoiceStateData> = {};
    for (const id of targets) {
        const voiceState = VoiceStateStore.getVoiceStateForUser(id);
        if (voiceState) initialState[id] = voiceState;
    }
    lastVoiceState = initialState;

    VoiceStateStore.addChangeListener(voiceStateChange);
};

export const deinit = () => {
    VoiceStateStore.removeChangeListener(voiceStateChange);
    lastVoiceState = {};
};

export const voiceStateChange = () => {
    const newVoiceState: Record<string, MainVoiceStateData> = {};

    for (const id of targets) {
        const voiceState: MainVoiceStateData = VoiceStateStore.getVoiceStateForUser(id);
        const lastVoiceStateForUser = lastVoiceState[id];

        if (voiceState) newVoiceState[id] = voiceState;

        const joinedVoice = voiceState && !lastVoiceStateForUser;
        const leftVoice = !voiceState && lastVoiceStateForUser;
        const switchedChannel = voiceState && lastVoiceStateForUser && voiceState.channelId !== lastVoiceStateForUser.channelId;

        if (joinedVoice || switchedChannel) {
            if (!settings.store.notifyCallJoin) continue;

            const user = UserStore.getUser(id);
            const channelName = getChannelName(voiceState.channelId);

            showNotification({
                title: "Stalker",
                body: `${user.username} joined VC: ${channelName}\nClick to join them.`,
                icon: user.getAvatarURL(),
                color: `#${user.accentColor?.toString(16)}`,
                onClick: () => selectVoiceChannel(voiceState.channelId),
            });

            logStalkerEvent({
                timestamp: new Date().toISOString(),
                userId: user.id,
                username: user.username,
                action: "voice_join",
                details: `Joined voice channel: ${channelName}`
            });
        }

        if (leftVoice) {
            const user = UserStore.getUser(id);
            const channelName = getChannelName(lastVoiceStateForUser.channelId);

            if (settings.store.notifyCallLeave) {
                showNotification({
                    title: "Stalker",
                    body: `${user.username} left VC: ${channelName}`,
                    icon: user.getAvatarURL(),
                    color: `#${user.accentColor?.toString(16)}`,
                });
            }

            logStalkerEvent({
                timestamp: new Date().toISOString(),
                userId: user.id,
                username: user.username,
                action: "voice_leave",
                details: `Left voice channel: ${channelName}`
            });
        }
    }

    lastVoiceState = newVoiceState;
};
