/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import type { VoiceState } from "@vencord/discord-types";
import { MediaEngineStore, Menu } from "@webpack/common";

type VoiceStatus = Pick<VoiceState, "selfMute" | "selfDeaf" | "selfVideo">;
type OutgoingVoiceState = VoiceStatus & Pick<VoiceState, "channelId"> & { videoStreamParameters: unknown; };

export const settings = definePluginSettings({
    autoMute: {
        type: OptionType.BOOLEAN,
        description: "Automatically mute when deafened.",
        default: false,
        onChange() {
            if (fakeVoiceState.selfDeaf) MediaEngineStore.emitChange();
        }
    }
});

const fakeVoiceState: VoiceStatus = {
    selfMute: false,
    selfDeaf: false,
    selfVideo: false
};

function isFakeMuted() {
    return fakeVoiceState.selfMute || (fakeVoiceState.selfDeaf && settings.plain.autoMute);
}

export default definePlugin({
    name: "FakeMuteAndDeafen",
    description: "You can fake mute and deafen yourself. You can continue speaking and being heard during this time.",
    tags: ["Voice", "Privacy"],
    authors: [Devs.feelslove],
    settings,
    modifyVoiceState(state: OutgoingVoiceState) {
        if (state.channelId == null) return state;
        return {
            ...state,
            selfMute: state.selfMute || isFakeMuted(),
            selfDeaf: state.selfDeaf || fakeVoiceState.selfDeaf,
            selfVideo: state.selfVideo || fakeVoiceState.selfVideo,
            videoStreamParameters: fakeVoiceState.selfVideo && !state.selfVideo ? null : state.videoStreamParameters
        };
    },
    showMute(muted: boolean, state: VoiceState | null | undefined) {
        return muted || (isFakeMuted() && state?.selfMute === true);
    },
    showDeaf(deafened: boolean, state: VoiceState | null | undefined) {
        return deafened || (fakeVoiceState.selfDeaf && state?.selfDeaf === true);
    },
    contextMenus: {
        "audio-device-context"(children, d) {
            if (d.renderInputDevices) {
                children.push(
                    <Menu.MenuSeparator />,
                    <Menu.MenuCheckboxItem
                        id="fake-mute"
                        label="Fake Mute"
                        checked={fakeVoiceState.selfMute}
                        action={() => {
                            fakeVoiceState.selfMute = !fakeVoiceState.selfMute;
                            MediaEngineStore.emitChange();
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
                        checked={fakeVoiceState.selfDeaf}
                        action={() => {
                            fakeVoiceState.selfDeaf = !fakeVoiceState.selfDeaf;
                            MediaEngineStore.emitChange();
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
                    checked={fakeVoiceState.selfVideo}
                    action={() => {
                        fakeVoiceState.selfVideo = !fakeVoiceState.selfVideo;
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
        }
    ],
});
