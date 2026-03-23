/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, Settings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

const Native = VencordNative.pluginHelpers.WayAFKNext as PluginNative<typeof import("./native")>;

let debug = false;

async function setDebug(_debug: boolean) {
    debug = _debug;
    await Native.setDebug(_debug);
    console.log("[WayAFKNext] Debug:", debug);
}

function utilSetDiscordIdle(idle: boolean) {
    if (debug) console.log("[WayAFKNext] [Util] Set Discord Idle", idle);
    FluxDispatcher.dispatch({
        type: "IDLE",
        idle
    });
}

function utilSetDiscordAFK(afk: boolean) {
    if (debug) console.log("[WayAFKNext] [Util] Set Discord AFK", afk);
    FluxDispatcher.dispatch({
        type: "AFK",
        afk
    });
}

const settings = definePluginSettings({
    enableDetection: {
        description: "Enable/disable AFK detection. It might be broken without this plugin, but if you turn it off here, it's actually *off*.",
        type: OptionType.BOOLEAN,
        default: true,
        onChange: updateMonitor
    },
    alwaysSendPushNotifications: {
        description: "Always send push notifications regardless of activity. Overrides corresponding timeout. If this is off and AFK detection is off, you won't ever receive push notifications.",
        type: OptionType.BOOLEAN,
        default: false,
        onChange: updatePush,
    },
    statusIdleTimeout: {
        description: "How long until your status visibly changes to Idle. This is used instead of Discord's built-in timeout selector.",
        type: OptionType.SLIDER,
        default: 5,
        markers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30],
        onChange: updateWatch
    },
    pushNotificationsTimeout: {
        description: "How long until you start receiving mobile push notifications. If this is set to 0, it'll be the same as the status timeout.",
        type: OptionType.SLIDER,
        default: 0,
        markers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30],
        onChange: updateWatch,
    },
    debug: {
        description: "Enable/disable debug output in console. You probably don't need this.",
        type: OptionType.BOOLEAN,
        default: false,
        onChange: () => setDebug(!debug)
    }
});

async function updateMonitor() {
    const enabled = Settings.plugins.WayAFKNext.enableDetection;

    if (debug) console.log("[WayAFKNext] Toggling AFK detection:", enabled);

    if (enabled) {
        await startMonitor();
    } else {
        await stopMonitor(false);
    }
}

async function startMonitor() {
    if (!await Native.monitorIsRunning()) {
        if (debug) console.log("[WayAFKNext] Starting monitor");

        try {
            await Native.downloadAndVerify();
        } catch (err) {
            console.error("[WayAFKNext]", err);
            return;
        }

        await Native.startMonitor();

        console.log("[WayAFKNext] Monitor started");
    }
}

async function stopMonitor(shutdown: boolean) {
    if (await Native.monitorIsRunning()) {
        if (debug) console.log("[WayAFKNext] Stopping monitor");
        await Native.stopWatch();
        await Native.killMonitor();
        console.log("[WayAFKNext] Monitor stopped");
    }

    if (!shutdown) {
        const alwaysSend = Settings.plugins.WayAFKNext.alwaysSendPushNotifications;
        utilSetDiscordIdle(false);
        utilSetDiscordAFK(alwaysSend);
    }
}

async function updateWatch() {
    const enabled = Settings.plugins.WayAFKNext.enableDetection;

    if (enabled) {
        const statusTimeout = Number(Settings.plugins.WayAFKNext.statusIdleTimeout);
        let notifsTimeout = Number(Settings.plugins.WayAFKNext.pushNotificationsTimeout);

        if (notifsTimeout === 0)
            notifsTimeout = statusTimeout;

        await Native.startWatch(statusTimeout, notifsTimeout);
    }
}

async function updatePush() {
    const alwaysSend = Settings.plugins.WayAFKNext.alwaysSendPushNotifications;

    if (debug) console.log("[WayAFKNext] Toggling always send push notifications:", alwaysSend);

    utilSetDiscordAFK(alwaysSend);
}

export default definePlugin({
    name: "WayAFKNext",
    description: "Fixes auto AFK functionality on Linux Wayland desktops",
    authors: [{ name: "MuffinTastic", id: 0n }],

    settings,

    // remove base Discord AFK dispatches
    patches: [
        {
            find: 'type:"IDLE",idle:',
            replacement: [
                {
                    match: /\i\.\i\.dispatch\({type:"IDLE",idle:!1}\)/,
                    replace: "{}"
                },
                {
                    match: /\i\.\i\.dispatch\({type:"IDLE",idle:!0,idleSince:\i}\)/,
                    replace: "{}"
                }
            ]
        },
        {
            find: 'type:"AFK",afk:',
            replacement: [
                {
                    match: /\i\.\i\.dispatch\({type:"AFK",afk:!1}\)/,
                    replace: "{}"
                },
                {
                    match: /\i\.\i\.dispatch\({type:"AFK",afk:!0}\)/,
                    replace: "{}"
                },
            ]
        }
    ],

    async start() {
        await setDebug(Settings.plugins.WayAFKNext.debug);

        const enabled = Settings.plugins.WayAFKNext.enableDetection;

        if (!enabled) {
            console.log("[WayAFKNext] AFK detection disabled");
            await stopMonitor(false);
            return;
        }

        startMonitor();
    },

    async stop() {
        stopMonitor(true);
    },

    async handleEvent(evt: any) {
        if ("Info" in evt) {
            if (debug) console.log("[WayAFKNext] [Monitor]", evt.Info);
        }
        if ("Error" in evt) {
            if (debug) console.error("[WayAFKNext] [Monitor]", evt.Error);
        }
        if ("Connected" in evt) {
            await this.onMonitorConnected();
        }
        if ("Exited" in evt) {
            await this.onMonitorExited(evt.Exit);
        }
        if ("WatchEvent" in evt) {
            await this.onWatchEvent(evt.WatchEvent);
        }
        if ("WatchStarted" in evt) {
            await this.onWatchStarted(evt.WatchStarted.status_mins, evt.WatchStarted.notifs_mins);
        }
        if ("WatchStopped" in evt) {
            await this.onWatchStopped();
        }
    },

    async onMonitorConnected() {
        updateWatch();
    },

    async onMonitorExited(code: number) {
        if (debug) console.log("[WayAFKNext] Monitor exited with code", code);
    },

    async onWatchEvent(evt: any) {
        const alwaysSend = Settings.plugins.WayAFKNext.alwaysSendPushNotifications;

        if ("StatusIdle" in evt) {
            if (debug) console.log("[WayAFKNext] Status idle state:", evt.StatusIdle);
            utilSetDiscordIdle(!!evt.StatusIdle);
        }

        if ("NotifsIdle" in evt && !alwaysSend) {
            if (debug) console.log("[WayAFKNext] Notifications idle state:", evt.NotifsIdle);
            utilSetDiscordAFK(!!evt.NotifsIdle);
        }
    },

    async onWatchStarted(statusTimeout: number, notifsTimeout: number) {
        console.log("[WayAFKNext] Watch started:", statusTimeout, "for status,", notifsTimeout, "for notifications.");
    },

    async onWatchStopped() {
        console.log("[WayAFKNext] Watch stopped");
    },
});
