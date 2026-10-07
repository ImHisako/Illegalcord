/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Paragraph } from "@components/Paragraph";
import { EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { type PluginNative } from "@utils/types";
import type { Activity } from "@vencord/discord-types";
import { ActivityFlags, ActivityType } from "@vencord/discord-types/enums";
import { ApplicationAssetUtils, FluxDispatcher, MaskedLink, showToast } from "@webpack/common";

import type { SoundCloudTrack } from "../IllegalcordDynamicIsland/native";

const Native = VencordNative.pluginHelpers.IllegalcordDynamicIsland as PluginNative<typeof import("../IllegalcordDynamicIsland/native")> | undefined;
const logger = new Logger("SoundcloudRPC");
const APPLICATION_ID = "1108588077900898414";
const SOCKET_ID = "SoundcloudRPC";

let active = false;
let generation = 0;
let timeoutId: number | undefined;
let lastTrack: string | null = null;

function setActivity(activity: Activity | null) {
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity, socketId: SOCKET_ID });
}

async function update(starting: boolean, current: number) {
    if (!Native) return;
    try {
        const state = starting ? await Native.configure(true, "rpc") : await Native.getState();
        if (!active || current !== generation) return;
        if (state.error) {
            showToast(state.error, "failure");
            return;
        }

        const track: SoundCloudTrack | null = state.track?.playing ? state.track : null;
        const key = track ? JSON.stringify(track) : null;
        if (key !== lastTrack) {
            lastTrack = key;
            if (!track) setActivity(null);
            else {
                const activity: Activity = {
                    application_id: APPLICATION_ID,
                    name: "SoundCloud",
                    type: ActivityType.LISTENING,
                    details: track.title,
                    state: track.artist || "SoundCloud",
                    flags: ActivityFlags.INSTANCE
                };
                if (track.cover) {
                    try {
                        const [cover] = await ApplicationAssetUtils.fetchAssetIds(APPLICATION_ID, [track.cover]);
                        if (cover) activity.assets = { large_image: cover, large_text: track.title };
                    } catch {
                        logger.warn("Could not load SoundCloud artwork.");
                    }
                }
                if (active && current === generation && key === lastTrack) setActivity(activity);
            }
        }
    } catch {
        if (!active || current !== generation) return;
        logger.error("Could not read SoundCloud playback from WebNowPlaying.");
        showToast("Could not connect to WebNowPlaying. Restart Discord and try again.", "failure");
        return;
    }
    if (active && current === generation) timeoutId = window.setTimeout(() => void update(false, current), 1000);
}

function SoundCloudSetup() {
    return (
        <>
            <Paragraph>Install the WebNowPlaying browser extension to show SoundCloud tracks on your Discord profile.</Paragraph>
            <Paragraph>
                Download it for <MaskedLink href="https://addons.mozilla.org/en-US/firefox/addon/webnowplaying">Firefox / Waterfox</MaskedLink>
                {" or "}<MaskedLink href="https://chrome.google.com/webstore/detail/webnowplaying/jfakgfcdgpghbbefmdfjkbdlibjgnbli">Chrome / Brave / Edge</MaskedLink>.
            </Paragraph>
            <Paragraph>In WebNowPlaying settings, open Adapters and add an enabled custom adapter on port <strong>8975</strong>. Reload any SoundCloud tab that was open before installing the extension.</Paragraph>
        </>
    );
}

export default definePlugin({
    name: "SoundcloudRPC",
    description: "Shows SoundCloud playback from WebNowPlaying as Discord Rich Presence.",
    authors: [EquicordDevs.irritably],
    tags: ["Activity", "Media"],
    settingsAboutComponent: SoundCloudSetup,

    start() {
        if (!Native) {
            showToast("Restart Discord completely to load SoundCloud support.", "failure");
            return;
        }
        active = true;
        void update(true, ++generation);
    },
    stop() {
        active = false;
        generation++;
        clearTimeout(timeoutId);
        timeoutId = undefined;
        lastTrack = null;
        setActivity(null);
        if (Native) void Native.configure(false, "rpc").catch(() => logger.warn("Could not stop WebNowPlaying."));
    }
});
