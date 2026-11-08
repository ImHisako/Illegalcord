/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import type { MediaEngineConnection, MediaEngineContextType, RTCConnectionState, VoiceState } from "@vencord/discord-types";
import { MediaEngineStore, Menu, RTCConnectionStore, SelectedChannelStore, VoiceStateStore } from "@webpack/common";

import { getLocalAudioStatus, restoreLocalAudio } from "./audio";

type VoiceStatus = Pick<VoiceState, "selfMute" | "selfDeaf" | "selfVideo">;
type OutgoingVoiceState = VoiceStatus & Pick<VoiceState, "channelId"> & { videoStreamParameters: unknown; };

export const settings = definePluginSettings({
    fakeMute: {
        type: OptionType.BOOLEAN,
        description: "Keep the microphone active while appearing muted.",
        default: false,
        onChange: updateFakeState
    },
    fakeDeafen: {
        type: OptionType.BOOLEAN,
        description: "Keep the microphone and voice playback active while appearing deafened.",
        default: false,
        onChange: updateFakeState
    },
    autoMute: {
        type: OptionType.BOOLEAN,
        description: "Automatically mute when deafened.",
        default: false,
        onChange() {
            if (running && settings.plain.fakeDeafen) MediaEngineStore.emitChange();
        }
    },
    autoRestoreLocalMedia: {
        type: OptionType.BOOLEAN,
        description: "Restore local voice audio after Discord updates the connection.",
        default: true,
        onChange: rescheduleAudioRestore
    },
    restoreDelayMs: {
        type: OptionType.NUMBER,
        description: "Time in milliseconds to wait before restoring local voice audio.",
        default: 450,
        min: 0,
        max: 10000,
        onChange: rescheduleAudioRestore
    },
    debugLogs: {
        type: OptionType.BOOLEAN,
        description: "Log local voice audio changes in the developer console.",
        default: true
    }
});

let running = false;
let fakeVideo = false;
let restoreTimer: ReturnType<typeof setTimeout> | undefined;

function isFakeMuted() {
    const { fakeMute, fakeDeafen, autoMute } = settings.plain;
    return running && (fakeMute === true || (fakeDeafen === true && autoMute === true));
}

function clearAudioRestore() {
    clearTimeout(restoreTimer);
    restoreTimer = undefined;
}

function restoreFakeAudio(force = false) {
    const { fakeMute, fakeDeafen, debugLogs } = settings.store;
    return restoreLocalAudio(running && fakeMute, running && fakeDeafen, debugLogs, force);
}

function scheduleAudioRestore() {
    if (restoreTimer !== undefined || !running) return;
    const { fakeMute, fakeDeafen, autoRestoreLocalMedia, restoreDelayMs } = settings.store;
    if (!autoRestoreLocalMedia || !(fakeMute || fakeDeafen) || !SelectedChannelStore.getVoiceChannelId()) return;

    let retries = 2;
    const restore = () => {
        if (SelectedChannelStore.getVoiceChannelId() && !restoreFakeAudio(retries < 2) && retries-- > 0) {
            restoreTimer = setTimeout(restore, 750);
        } else {
            restoreTimer = undefined;
        }
    };
    restoreTimer = setTimeout(restore, restoreDelayMs);
}

function rescheduleAudioRestore() {
    clearAudioRestore();
    scheduleAudioRestore();
}

function updateFakeState() {
    if (!running) return;
    clearAudioRestore();
    MediaEngineStore.emitChange();
    restoreFakeAudio();
    scheduleAudioRestore();
}

const consoleHelpers = {
    FakeMuteDeafenLabStatus() {
        const channelId = SelectedChannelStore.getVoiceChannelId();
        const voiceState = channelId ? VoiceStateStore.getVoiceStateForChannel(channelId) : undefined;
        const local = getLocalAudioStatus();
        return {
            present: local.length > 0,
            connectionCount: local.length,
            rtcState: RTCConnectionStore.getState(),
            fakeMute: settings.store.fakeMute,
            fakeDeafen: settings.store.fakeDeafen,
            native: { selfMute: MediaEngineStore.isSelfMute(), selfDeaf: MediaEngineStore.isSelfDeaf() },
            visible: voiceState && { selfMute: voiceState.selfMute, selfDeaf: voiceState.selfDeaf },
            local
        };
    },
    FakeMuteDeafenLabSetMute(enabled: boolean) {
        settings.store.fakeMute = Boolean(enabled);
    },
    FakeMuteDeafenLabSetDeafen(enabled: boolean) {
        settings.store.fakeDeafen = Boolean(enabled);
    },
    FakeMuteDeafenLabRestoreLocal() {
        return restoreFakeAudio(true);
    }
};

const consoleGlobals = globalThis as typeof globalThis & Partial<typeof consoleHelpers>;

export default definePlugin({
    name: "FakeMuteAndDeafen",
    description: "You can fake mute and deafen yourself. You can continue speaking and being heard during this time.",
    tags: ["Voice", "Privacy"],
    authors: [Devs.feelslove],
    dependencies: ["CommandsAPI", "ContextMenuAPI"],
    settings,
    start() {
        running = true;
        Object.assign(consoleGlobals, consoleHelpers);
        if (settings.store.fakeMute || settings.store.fakeDeafen) updateFakeState();
    },
    stop() {
        running = false;
        clearAudioRestore();
        restoreFakeAudio();
        settings.store.fakeMute = false;
        settings.store.fakeDeafen = false;
        fakeVideo = false;
        MediaEngineStore.emitChange();
        delete consoleGlobals.FakeMuteDeafenLabStatus;
        delete consoleGlobals.FakeMuteDeafenLabSetMute;
        delete consoleGlobals.FakeMuteDeafenLabSetDeafen;
        delete consoleGlobals.FakeMuteDeafenLabRestoreLocal;
    },
    commands: [
        {
            name: "fakemute",
            description: "Toggle Fake Mute.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute(_, ctx) {
                const enabled = settings.store.fakeMute = !settings.store.fakeMute;
                sendBotMessage(ctx.channel.id, { content: `Fake Mute is ${enabled ? "on" : "off"}.` });
            }
        },
        {
            name: "fakedeafen",
            description: "Toggle Fake Deafen.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute(_, ctx) {
                const enabled = settings.store.fakeDeafen = !settings.store.fakeDeafen;
                sendBotMessage(ctx.channel.id, { content: `Fake Deafen is ${enabled ? "on" : "off"}.` });
            }
        }
    ],
    flux: {
        VOICE_CHANNEL_SELECT({ channelId }: { channelId?: string | null; }) {
            clearAudioRestore();
            if (channelId) scheduleAudioRestore();
        },
        RTC_CONNECTION_STATE({ context, state }: { context?: MediaEngineContextType; state: RTCConnectionState; }) {
            if (context !== "stream" && (state === "RTC_CONNECTED" || state === "RTC_CONNECTING" || state === "AUTHENTICATING")) {
                scheduleAudioRestore();
            }
        }
    },
    modifyVoiceState(state: OutgoingVoiceState) {
        if (!running || state.channelId == null) return state;
        return {
            ...state,
            selfMute: state.selfMute || isFakeMuted(),
            selfDeaf: state.selfDeaf || settings.plain.fakeDeafen === true,
            selfVideo: state.selfVideo || fakeVideo,
            videoStreamParameters: fakeVideo && !state.selfVideo ? null : state.videoStreamParameters
        };
    },
    showMute(muted: boolean, state: VoiceState | null | undefined) {
        return muted || (isFakeMuted() && state?.selfMute === true);
    },
    showDeaf(deafened: boolean, state: VoiceState | null | undefined) {
        return deafened || (running && settings.plain.fakeDeafen === true && state?.selfDeaf === true);
    },
    onLocalAudioReset(connection: MediaEngineConnection) {
        if (connection.context === "default") scheduleAudioRestore();
    },
    contextMenus: {
        "audio-device-context"(children, d) {
            if (d.renderInputDevices) {
                children.push(
                    <Menu.MenuSeparator />,
                    <Menu.MenuCheckboxItem
                        id="fake-mute"
                        label="Fake Mute"
                        checked={settings.store.fakeMute}
                        action={() => {
                            settings.store.fakeMute = !settings.store.fakeMute;
                        }}
                    />
                );
            }

            if (d.renderOutputDevices) {
                children.push(
                    <Menu.MenuSeparator />,
                    <Menu.MenuCheckboxItem
                        id="auto-mute-fake-deafen"
                        label="AutoMute (FakeDeafen)"
                        checked={settings.store.autoMute}
                        action={() => {
                            settings.store.autoMute = !settings.store.autoMute;
                        }}
                    />,
                    <Menu.MenuCheckboxItem
                        id="fake-deafen"
                        label="Fake Deafen"
                        checked={settings.store.fakeDeafen}
                        action={() => {
                            settings.store.fakeDeafen = !settings.store.fakeDeafen;
                        }}
                    />
                );
            }
        },
        "video-device-context"(children) {
            children.push(
                <Menu.MenuSeparator />,
                <Menu.MenuCheckboxItem
                    id="fake-video"
                    label="Fake Camera"
                    checked={fakeVideo}
                    action={() => {
                        fakeVideo = !fakeVideo;
                        MediaEngineStore.emitChange();
                    }}
                />
            );
        }
    },
    patches: [
        {
            find: '"GatewayConnectionStore"',
            replacement: {
                match: /(?<=getNextState\(\i\)\{let\{[^}]{0,100}\}=\i;return)\{[^}]{0,280}?\bvideoStreamParameters:[^}]{0,120}\}/,
                replace: " $self.modifyVoiceState($&)"
            }
        },
        {
            find: "impersonateStore:",
            replacement: {
                match: /(?<=return\{selfMute:)\i(?=,suppress:(\i)\?\.suppress)/,
                replace: "$self.showMute($&,$1)"
            }
        },
        {
            find: "return{selfDeaf:",
            replacement: {
                match: /(?<=return\{selfDeaf:)\i\.isSelfDeaf\(\)(?=,deaf:(\i)\?\.deaf)/,
                replace: "$self.showDeaf($&,$1)"
            }
        },
        {
            find: ".merge({selfMute:",
            replacement: {
                match: /(?<=(\i)\.merge\(\{selfMute:)(\i),selfDeaf:(\i)(?=\}\))/,
                replace: "$self.showMute($2,$1),selfDeaf:$self.showDeaf($3,$1)"
            }
        },
        {
            find: 'displayName="MediaEngineStore"',
            replacement: {
                match: /(?<=\i\.setSelfMute\(\i\),(\i)\.setSelfDeaf\(\i\.deaf\))(?=,\1\.context===)/,
                replace: ",$self.onLocalAudioReset($1)"
            }
        }
    ],
});
