/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { MonitoringLegalWarning } from "@illegalcordplugins/legalWarnings";
import { EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import type { Message, User } from "@vencord/discord-types";
import { ChannelStore, FluxDispatcher, GuildStore, Menu } from "@webpack/common";

import * as activity from "./activity";
import * as status from "./status";
import * as voice from "./voice";

export const logger = new Logger("Stalker");

const Native = VencordNative.pluginHelpers.Stalker as PluginNative<typeof import("./native")>;

if (!Native) {
    logger.warn("Stalker native module not available");
}

function OpenStalkingFolderButton() {
    return (
        <Button
            disabled={!Native?.openStalkerDataDir}
            onClick={() => void Native?.openStalkerDataDir?.()
                .then(error => {
                    if (error) logger.error("Failed to open Stalking folder:", error);
                })
                .catch(error => logger.error("Failed to open Stalking folder:", error))}
        >
            Open Stalking Folder
        </Button>
    );
}

export interface StalkerLogEntry {
    timestamp: string;
    userId: string;
    username: string;
    action: "activity_start" | "activity_stop" | "activity_update" | "client_status_change" | "custom_status_change" | "message_send" | "status_change" | "voice_join" | "voice_leave" | "voice_update";
    details: string;
    channelName?: string;
    guildName?: string;
    metadata?: Record<string, string | number | boolean | null>;
}

export async function logStalkerEvent(entry: StalkerLogEntry) {
    if (!settings.store.enableLogging) return;
    if (!Native?.appendStalkerLog) return;

    try {
        const result = await Native.appendStalkerLog(JSON.stringify(entry), entry.userId, entry.username);
        if (!result.success) logger.error(result.error);
    } catch (error) {
        logger.error("Failed to write stalker log:", error);
    }
}

export let targets: string[] = [];
export const targetIds = new Set<string>();
let started = false;
let messageSubscribed = false;

const parseTargets = (parse: string): string[] => {
    targets = [...new Set(parse.match(/[0-9]+/g) ?? [])];
    targetIds.clear();
    for (const id of targets) targetIds.add(id);
    syncTracking();
    return targets;
};

export const settings = definePluginSettings({
    stalkContext: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Adds an option on the user context menu that enables stalking for users."
    },

    notifyCallJoin: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Send a notification when a user joins a voice channel.",
        onChange: syncTracking,
    },

    notifyCallLeave: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Send a notification when a user leaves a voice channel.",
        onChange: syncTracking,
    },

    notifyOffline: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Send a notification when a user goes offline.",
        onChange: syncTracking
    },

    notifyOnline: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Send a notification when a user goes online.",
        onChange: syncTracking,
    },

    notifyDnd: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Send a notification when a user goes on Do Not Disturb.",
        onChange: syncTracking,
    },

    notifyIdle: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Send a notification when a user goes idle.",
        onChange: syncTracking,
    },

    notifyGoOnline: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Send a notification when a user logs onto Discord or leaves invisible, regardless of the 4 above options.",
        onChange: syncTracking
    },

    enableLogging: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Enable logging of stalker events to a local file.",
        onChange: syncTracking
    },

    openStalkingFolder: {
        type: OptionType.COMPONENT,
        description: "Open the Stalking data folder.",
        component: OpenStalkingFolderButton,
    },

    logMessages: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Log when a user sends a message in any channel.",
        onChange: syncTracking
    },

    logMessagePreview: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Include message previews in local message logs."
    },

    logActivities: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Log when a user starts, stops, or changes an activity.",
        onChange: syncTracking
    },

    notifyActivities: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Send a notification when a user starts an activity.",
        onChange: syncTracking
    },

    logCustomStatus: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Log custom status changes.",
        onChange: syncTracking
    },

    logClientStatus: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Log whether a user is online from desktop, mobile, or web.",
        onChange: syncTracking
    },

    logVoiceStateChanges: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Log voice state changes like mute, deaf, video, and streaming."
    },

    targets: {
        type: OptionType.STRING,
        placeholder: "1234,5678",
        description: "List of user IDs to stalk, separate with a comma.",
        default: "",
        onChange: parseTargets,
    },
});

function logMessage({ message }: { message: Message; }) {
    if (!targetIds.has(message.author.id)) return;
    if (!settings.store.enableLogging || !settings.store.logMessages) return;

    const channel = ChannelStore.getChannel(message.channel_id);
    const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
    const preview = settings.store.logMessagePreview ? message.content.slice(0, 100) : "";
    logStalkerEvent({
        timestamp: new Date().toISOString(),
        userId: message.author.id,
        username: message.author.username,
        action: "message_send",
        details: preview ? `Sent message: ${preview}${message.content.length > 100 ? "..." : ""}` : "Sent a message.",
        channelName: channel?.name,
        guildName: guild?.name,
        metadata: {
            channelId: message.channel_id,
            guildId: channel?.guild_id ?? null,
            messageId: message.id,
            hasContent: message.content.length > 0
        }
    });
}

function syncTracking() {
    if (!started) return;
    activity.deinit();
    status.deinit();
    voice.deinit();
    if (messageSubscribed) {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", logMessage);
        messageSubscribed = false;
    }
    if (!targets.length) return;

    const {
        enableLogging, logMessages, logActivities, logCustomStatus, logClientStatus,
        notifyActivities, notifyCallJoin, notifyCallLeave, notifyOffline, notifyOnline, notifyDnd, notifyIdle, notifyGoOnline
    } = settings.store;
    const logging = enableLogging && !!Native?.appendStalkerLog;
    if (logging || notifyOffline || notifyOnline || notifyDnd || notifyIdle || notifyGoOnline) status.init();
    if (logging || notifyCallJoin || notifyCallLeave) voice.init();
    if (notifyActivities || logging && (logActivities || logCustomStatus || logClientStatus)) activity.init();
    if (logging && logMessages) {
        FluxDispatcher.subscribe("MESSAGE_CREATE", logMessage);
        messageSubscribed = true;
    }
}

interface UserContextProps {
    user?: User;
}

const patchUserContext: NavContextMenuPatchCallback = (children, { user }: UserContextProps) => {
    if (!settings.store.stalkContext || !user) return;

    const stalked = targetIds.has(user.id);
    const group = findGroupChildrenByChildId("apps", children) ?? children;
    for (let index = group.length - 1; index >= 0; index--) {
        if (group[index]?.props?.id === "vc-st-stalk") group.splice(index, 1);
    }
    let id = group.findLastIndex(child => child?.props?.id && child.props.id === "ignore");
    if (id < 0) id = group.length - 1;

    group.splice(id, 0,
        <Menu.MenuItem
            id="vc-st-stalk"
            label={stalked ? "Unstalk" : "Stalk"}
            action={() => {
                const currentTargets = new Set(targets);

                if (stalked) {
                    currentTargets.delete(user.id);
                } else {
                    currentTargets.add(user.id);
                }

                settings.store.targets = [...currentTargets].join(",");
                parseTargets(settings.store.targets);
            }}
        />
    );
};

export default definePlugin({
    name: "Stalker",
    description: "Notifies you whenever a person does something.",
    tags: ["Friends", "Utility"],
    authors: [
        EquicordDevs.Reycko,
        EquicordDevs.irritably
    ],

    contextMenus: {
        "user-context": patchUserContext,
    },

    start() {
        started = true;
        parseTargets(settings.store.targets);
    },

    stop() {
        started = false;
        activity.deinit();
        status.deinit();
        voice.deinit();
        if (messageSubscribed) FluxDispatcher.unsubscribe("MESSAGE_CREATE", logMessage);
        messageSubscribed = false;
    },

    settings,
    settingsAboutComponent: MonitoringLegalWarning,
});
