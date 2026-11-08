/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { tryOrElse } from "@utils/misc";
import type { MediaEngineConnection } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { MediaEngineStore, SelectedChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

const AudioPermission: { didHavePermission(type: "audio"): boolean; } = findByPropsLazy("didHavePermission", "requestPermission");
const logger = new Logger("FakeMuteAndDeafen");
const microphoneOverrides = new WeakSet<MediaEngineConnection>();
const playbackOverrides = new WeakSet<MediaEngineConnection>();

function getVoiceConnections() {
    return [...MediaEngineStore.getMediaEngine().connections].filter(connection => connection.context === "default" && !connection.destroyed);
}

export function getLocalAudioStatus() {
    return getVoiceConnections().map(connection => ({
        selfMute: connection.getSelfMute(),
        selfDeaf: connection.getSelfDeaf()
    }));
}

export function restoreLocalAudio(fakeMute: boolean, fakeDeafen: boolean, debugLogs: boolean, force = false) {
    const channelId = SelectedChannelStore.getVoiceChannelId();
    const temporarilyMuted = MediaEngineStore.isSelfMutedTemporarily();
    const serverDeafened = MediaEngineStore.isServerDeaf();
    const restoreMicrophone = !!channelId && (fakeMute || fakeDeafen) && !temporarilyMuted
        && !MediaEngineStore.isServerMute() && !serverDeafened && MediaEngineStore.isEnabled()
        && tryOrElse(() => AudioPermission.didHavePermission("audio"), false);
    const restorePlayback = !!channelId && fakeDeafen && !serverDeafened;
    const selfMute = !restoreMicrophone && (MediaEngineStore.isMute() || temporarilyMuted);
    const selfDeaf = !restorePlayback && MediaEngineStore.isSelfDeaf();
    const connections = getVoiceConnections();
    let succeeded = connections.length > 0;
    let changed = false;

    for (const connection of connections) {
        try {
            if ((restorePlayback || playbackOverrides.has(connection)) && (connection.getSelfDeaf() !== selfDeaf || (force && restorePlayback))) {
                if (restorePlayback) playbackOverrides.add(connection);
                connection.setSelfDeaf(selfDeaf);
                changed = true;
                if (restorePlayback && channelId) {
                    const ownId = UserStore.getCurrentUser().id;
                    for (const userId of Object.keys(VoiceStateStore.getVoiceStatesForChannel(channelId))) {
                        if (userId !== ownId) connection.setLocalMute(userId, MediaEngineStore.isLocalMute(userId));
                    }
                }
            }
            if (!restorePlayback) playbackOverrides.delete(connection);

            if ((restoreMicrophone || microphoneOverrides.has(connection)) && (connection.getSelfMute() !== selfMute || (force && restoreMicrophone))) {
                if (restoreMicrophone) microphoneOverrides.add(connection);
                connection.setSelfMute(selfMute);
                changed = true;
            }
            if (!restoreMicrophone) microphoneOverrides.delete(connection);
        } catch (error) {
            succeeded = false;
            if (debugLogs) logger.warn("Could not update local voice audio.", error);
        }
    }

    if (changed && debugLogs) logger.debug("Updated local voice audio.", { selfMute, selfDeaf });
    return succeeded;
}
