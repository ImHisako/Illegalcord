/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { EquicordDevs } from "@utils/constants";
import { classes } from "@utils/misc";
import { openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, React, showToast, Toasts, UserStore, useStateFromStores, VoiceStateStore } from "@webpack/common";

import { SpatialModal } from "./SpatialModal";
import {
    cl,
    handleVoiceStateUpdates,
    isSpatialActive,
    loadState,
    processStream,
    SpatialActiveStore,
    StreamData,
    teardownAudio,
} from "./state";

const settings = definePluginSettings({
    hideFromToolbox: {
        type: OptionType.BOOLEAN,
        description: "Hide this plugin from Equicord Toolbox.",
        default: true
    }
});

function openSpatialAudio() {
    const userId = UserStore.getCurrentUser()?.id;
    const channelId = userId ? VoiceStateStore.getVoiceStateForUser(userId)?.channelId : null;

    if (!channelId) {
        showToast("Join a voice channel first.", Toasts.Type.FAILURE);
        return;
    }

    openModal(({ onClose }) => <SpatialModal channelId={channelId} onClose={onClose} />);
}

export default definePlugin({
    name: "SpatialAudio",
    description: "Positions voice participants on a 2D canvas and spatializes their audio with HRTF.",
    authors: [EquicordDevs.onewhobridges],
    settings,

    patches: [
        {
            find: "streamSourceNode",
            predicate: () => !isPluginEnabled("VolumeBooster"),
            replacement: {
                match: /\.volume=this\._volume\/100;/,
                replace: ".volume=$self.handleStreamVolume(this);"
            }
        },
        {
            find: "streamSourceNode",
            predicate: () => isPluginEnabled("VolumeBooster"),
            replacement: {
                // match can't use $self — only replace strings get that substitution; capture VB's expanded call via $1
                match: /\.volume=0\.00;(.+?\.patchVolume\(this\);)/,
                replace: ".volume=0.00;$1$self.handleStreamVolume(this);"
            }
        },
        {
            find: "accountContainerRef",
            replacement: {
                match: /children:\[(?=.{0,150}?accountContainerRef)/,
                replace: "children:[$self.renderSpatialButton(arguments[0]),"
            }
        }
    ],

    get toolboxActions(): Record<string, () => void> {
        if (settings.store.hideFromToolbox) return {};

        return {
            "Open Spatial Audio": openSpatialAudio
        };
    },

    async start() {
        await loadState();
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", handleVoiceStateUpdates);
    },

    stop() {
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", handleVoiceStateUpdates);
        teardownAudio();
    },

    handleStreamVolume(data: StreamData): number {
        return processStream(data);
    },

    renderSpatialButton: ErrorBoundary.wrap((_props: { nameplate?: unknown; }) => {
        const [open, setOpen] = React.useState(false);

        const channelId = useStateFromStores([VoiceStateStore], () => {
            const userId = UserStore.getCurrentUser()?.id;
            return userId ? VoiceStateStore.getVoiceStateForUser(userId)?.channelId ?? "" : "";
        });

        const isActive = useStateFromStores([SpatialActiveStore], () => isSpatialActive(channelId));

        if (!channelId) return null;

        return (
            <>
                <button
                    className={classes(cl("button"), isActive && cl("active"))}
                    onClick={() => setOpen(o => !o)}
                    title="Spatial audio"
                    aria-label="Spatial audio"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 3C6.48 3 2 7.48 2 13c0 3.12 1.42 5.92 3.66 7.82l1.42-1.42A8.96 8.96 0 0 1 4 13c0-4.41 3.59-8 8-8s8 3.59 8 8a8.96 8.96 0 0 1-3.08 6.4l1.42 1.42C20.58 18.92 22 16.12 22 13c0-5.52-4.48-10-10-10z" />
                        <path d="M12 7c-3.31 0-6 2.69-6 6 0 1.77.77 3.37 2 4.47l1.42-1.42A3.99 3.99 0 0 1 8 13c0-2.21 1.79-4 4-4s4 1.79 4 4c0 1.19-.52 2.26-1.35 3l1.42 1.42A5.98 5.98 0 0 0 18 13c0-3.31-2.69-6-6-6z" />
                        <circle cx="12" cy="13" r="2" />
                    </svg>
                </button>
                {open && <SpatialModal channelId={channelId} onClose={() => setOpen(false)} />}
            </>
        );
    }, { noop: true }),
});
