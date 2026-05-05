/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { LogIcon } from "@components/Icons";
import SettingsPlugin from "@plugins/_core/settings";
import { removeFromArray } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import type { Activity, Message, OnlineStatus, User } from "@vencord/discord-types";
import { ActivityType } from "@vencord/discord-types/enums";
import { ChannelStore, GuildStore, Menu, PresenceStore, SettingsRouter, UserStore } from "@webpack/common";

import { loadEvents, recordEvent, trimEvents } from "./store";
import type { MessageSnapshot, SurveillanceEvent, SurveillanceEventType, VoiceState, VoiceStateFlag } from "./types";

const SETTINGS_ENTRY_KEY = "illegalcord_surveillance";
const NOTIFICATION_COLOR = "#5865f2";
const MESSAGE_PREVIEW_LIMIT = 220;
const TYPING_COOLDOWN = 15_000;

let targets: string[] = [];
const targetListeners = new Set<() => void>();
const messageCache = new Map<string, MessageSnapshot>();
const typingCooldowns = new Map<string, number>();
let lastStatuses = new Map<string, OnlineStatus>();
let lastActivities = new Map<string, Map<string, string>>();

interface UserContextProps {
    user?: User;
}

interface ChannelInfo {
    channelId?: string;
    channelName?: string;
    guildId?: string;
    guildName?: string;
}

const voiceStateLabels: Array<[VoiceStateFlag, string, string]> = [
    ["mute", "Server muted", "Server unmuted"],
    ["deaf", "Server deafened", "Server undeafened"],
    ["selfMute", "Muted", "Unmuted"],
    ["selfDeaf", "Deafened", "Undeafened"],
    ["selfVideo", "Enabled video", "Disabled video"],
    ["selfStream", "Started streaming", "Stopped streaming"],
    ["suppress", "Suppressed by stage", "Unsuppressed by stage"],
];

const updateTargets = (value: string): string[] => {
    targets = [...new Set(value.match(/\d+/g) ?? [])];
    targetListeners.forEach(listener => listener());
    return targets;
};

export const getTargets = () => targets;

export const subscribeTargets = (listener: () => void) => {
    targetListeners.add(listener);
    return () => targetListeners.delete(listener);
};

export function setTargets(nextTargets: string[]) {
    settings.store.targets = [...new Set(nextTargets.filter(Boolean))].join(",");
    updateTargets(settings.store.targets);
}

export function addTarget(userId: string) {
    setTargets([...targets, userId]);
}

export function removeTarget(userId: string) {
    setTargets(targets.filter(target => target !== userId));
}

export const settings = definePluginSettings({
    targets: {
        type: OptionType.STRING,
        placeholder: "1234,5678",
        description: "Discord user IDs to monitor from live visible events.",
        default: "",
        onChange: updateTargets,
    },
    addContextMenu: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Add a Surveillance toggle to user context menus.",
    },
    logMessages: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Log live messages from monitored users.",
    },
    captureMessageContent: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Include message previews in local logs.",
    },
    logMessageChanges: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Log edits and deletes for messages seen during this session.",
    },
    logTyping: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Log typing signals with a short cooldown.",
    },
    logStatus: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Log online, idle, dnd, and offline transitions.",
    },
    logActivities: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Log activity starts, stops, and updates.",
    },
    logVoice: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Log voice joins, leaves, moves, and state changes.",
    },
    notifyEvents: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Send notifications for high signal surveillance events.",
    },
    trackSelf: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Include your own account if its ID is in the target list.",
    },
    maxEvents: {
        type: OptionType.NUMBER,
        default: 1000,
        description: "Maximum number of local events to keep.",
        onChange: value => void trimEvents(value),
    },
});

const makeId = () =>
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const getUsername = (userId: string, fallback?: string) =>
    fallback ?? UserStore.getUser(userId)?.username ?? userId;

const preview = (content: string) =>
    content.length > MESSAGE_PREVIEW_LIMIT
        ? `${content.slice(0, MESSAGE_PREVIEW_LIMIT)}...`
        : content;

const shouldTrack = (userId: string) => {
    if (!targets.includes(userId)) return false;
    if (settings.store.trackSelf) return true;
    return userId !== UserStore.getCurrentUser()?.id;
};

const getChannelInfo = (channelId: string | undefined): ChannelInfo => {
    if (!channelId) return {};

    const channel = ChannelStore.getChannel(channelId);
    const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : undefined;

    return {
        channelId,
        channelName: channel?.name,
        guildId: channel?.guild_id,
        guildName: guild?.name,
    };
};

const notify = (event: SurveillanceEvent) => {
    if (!settings.store.notifyEvents) return;
    if (event.type === "typing" || event.type === "message_edit" || event.type === "message_delete") return;

    const user = UserStore.getUser(event.userId);

    showNotification({
        title: "Surveillance",
        body: `${event.username}: ${event.details}`,
        color: NOTIFICATION_COLOR,
        icon: user?.getAvatarURL(),
    });
};

const addEvent = (entry: Omit<SurveillanceEvent, "id" | "timestamp">) => {
    const event: SurveillanceEvent = {
        id: makeId(),
        timestamp: Date.now(),
        ...entry,
    };

    void recordEvent(event, settings.store.maxEvents);
    notify(event);
};

const addUserEvent = (type: SurveillanceEventType, userId: string, details: string, extra: Partial<SurveillanceEvent> = {}) => {
    addEvent({
        type,
        userId,
        username: getUsername(userId, extra.username),
        details,
        ...extra,
    });
};

const getActivityKey = (activity: Activity) =>
    [activity.type, activity.application_id ?? "", activity.name, activity.platform ?? ""].join(":");

const formatActivityType = (type: ActivityType) => {
    switch (type) {
        case ActivityType.STREAMING:
            return "streaming";
        case ActivityType.LISTENING:
            return "listening to";
        case ActivityType.WATCHING:
            return "watching";
        case ActivityType.COMPETING:
            return "competing in";
        case ActivityType.HANG_STATUS:
            return "hanging out in";
        default:
            return "playing";
    }
};

const formatActivity = (activity: Activity) => {
    if (activity.type === ActivityType.CUSTOM_STATUS) {
        return [activity.emoji?.name, activity.state ?? activity.name].filter(Boolean).join(" ");
    }

    const details = activity.details ? `: ${activity.details}` : "";
    const state = activity.state ? ` (${activity.state})` : "";
    return `${formatActivityType(activity.type)} ${activity.name}${details}${state}`;
};

const getActivityMap = (userId: string) => {
    const activities = PresenceStore.getActivities(userId) ?? [];
    const activityMap = new Map<string, string>();

    for (const activity of activities) {
        activityMap.set(getActivityKey(activity), formatActivity(activity));
    }

    return activityMap;
};

const seedPresence = () => {
    const statuses = PresenceStore.getState()?.statuses ?? {};
    lastStatuses = new Map();
    lastActivities = new Map();

    for (const userId of targets) {
        lastStatuses.set(userId, statuses[userId] ?? "offline");
        lastActivities.set(userId, getActivityMap(userId));
    }
};

const handlePresenceChange = () => {
    const statuses = PresenceStore.getState()?.statuses ?? {};

    for (const userId of targets) {
        if (!shouldTrack(userId)) continue;

        const previousStatus = lastStatuses.get(userId) ?? "offline";
        const currentStatus = statuses[userId] ?? "offline";

        if (settings.store.logStatus && previousStatus !== currentStatus) {
            addUserEvent("status", userId, `Status changed from ${previousStatus} to ${currentStatus}.`);
        }

        const previousActivities = lastActivities.get(userId) ?? new Map<string, string>();
        const currentActivities = getActivityMap(userId);

        if (settings.store.logActivities) {
            for (const [key, activity] of currentActivities) {
                const previousActivity = previousActivities.get(key);

                if (!previousActivity) {
                    addUserEvent("activity_start", userId, `Started ${activity}.`);
                    continue;
                }

                if (previousActivity !== activity) {
                    addUserEvent("activity_update", userId, `Changed activity from ${previousActivity} to ${activity}.`);
                }
            }

            for (const [key, activity] of previousActivities) {
                if (!currentActivities.has(key)) addUserEvent("activity_stop", userId, `Stopped ${activity}.`);
            }
        }

        lastStatuses.set(userId, currentStatus);
        lastActivities.set(userId, currentActivities);
    }
};

const getVoiceChanges = (previousState: VoiceState, currentState: VoiceState) => {
    const changes: string[] = [];

    for (const [key, enabledLabel, disabledLabel] of voiceStateLabels) {
        const wasEnabled = Boolean(previousState[key]);
        const isEnabled = Boolean(currentState[key]);

        if (wasEnabled !== isEnabled) changes.push(isEnabled ? enabledLabel : disabledLabel);
    }

    return changes;
};

const previousVoiceStates = new Map<string, VoiceState>();

const handleVoiceState = (state: VoiceState) => {
    if (!settings.store.logVoice) return;
    if (!shouldTrack(state.userId)) return;

    const previousState = previousVoiceStates.get(state.userId);
    const { channelId, oldChannelId, userId } = state;

    if (oldChannelId !== channelId) {
        if (!oldChannelId && channelId) {
            addUserEvent("voice_join", userId, `Joined voice channel ${getChannelInfo(channelId).channelName ?? "Unknown channel"}.`, getChannelInfo(channelId));
        } else if (oldChannelId && !channelId) {
            addUserEvent("voice_leave", userId, `Left voice channel ${getChannelInfo(oldChannelId).channelName ?? "Unknown channel"}.`, getChannelInfo(oldChannelId));
        } else if (oldChannelId && channelId) {
            const oldChannel = getChannelInfo(oldChannelId).channelName ?? "Unknown channel";
            const newChannel = getChannelInfo(channelId).channelName ?? "Unknown channel";
            addUserEvent("voice_move", userId, `Moved from ${oldChannel} to ${newChannel}.`, getChannelInfo(channelId));
        }
    }

    if (previousState && channelId && oldChannelId === channelId) {
        const changes = getVoiceChanges(previousState, state);
        if (changes.length) {
            addUserEvent("voice_update", userId, `Voice state changed: ${changes.join(", ")}.`, getChannelInfo(channelId));
        }
    }

    if (channelId) previousVoiceStates.set(userId, state);
    else previousVoiceStates.delete(userId);
};

const logMessage = (message: Message) => {
    const { author } = message;
    if (!settings.store.logMessages) return;
    if (!shouldTrack(author.id)) return;

    const info = getChannelInfo(message.channel_id);
    const content = settings.store.captureMessageContent ? preview(message.content) : undefined;

    messageCache.set(message.id, {
        userId: author.id,
        username: author.username,
        channelId: message.channel_id,
        guildId: info.guildId,
        content: message.content,
    });

    addEvent({
        type: "message",
        userId: author.id,
        username: author.username,
        details: content ? `Sent message: ${content}` : "Sent a message.",
        content,
        ...info,
        metadata: {
            messageId: message.id,
            hasContent: message.content.length > 0,
            attachmentCount: message.attachments.length,
        },
    });
};

const logMessageUpdate = (message: Message) => {
    if (!settings.store.logMessageChanges) return;
    if (!shouldTrack(message.author.id)) return;

    const previousMessage = messageCache.get(message.id);
    const info = getChannelInfo(message.channel_id);
    const content = settings.store.captureMessageContent ? preview(message.content) : undefined;
    const previousContent = previousMessage?.content;

    messageCache.set(message.id, {
        userId: message.author.id,
        username: message.author.username,
        channelId: message.channel_id,
        guildId: info.guildId,
        content: message.content,
    });

    addEvent({
        type: "message_edit",
        userId: message.author.id,
        username: message.author.username,
        details: content ? `Edited message: ${content}` : "Edited a message.",
        before: settings.store.captureMessageContent && previousContent ? preview(previousContent) : undefined,
        after: content,
        ...info,
        metadata: {
            messageId: message.id,
            hadCachedOriginal: Boolean(previousContent),
        },
    });
};

const logMessageDelete = (messageId: string, channelId: string) => {
    if (!settings.store.logMessageChanges) return;

    const snapshot = messageCache.get(messageId);
    if (!snapshot || !shouldTrack(snapshot.userId)) return;

    const info = getChannelInfo(channelId);
    const content = settings.store.captureMessageContent ? preview(snapshot.content) : undefined;

    addEvent({
        type: "message_delete",
        userId: snapshot.userId,
        username: snapshot.username,
        details: content ? `Deleted message: ${content}` : "Deleted a message.",
        content,
        ...info,
        metadata: {
            messageId,
        },
    });

    messageCache.delete(messageId);
};

const logTyping = (userId: string, channelId: string) => {
    if (!settings.store.logTyping) return;
    if (!shouldTrack(userId)) return;

    const key = `${userId}:${channelId}`;
    const now = Date.now();
    const lastTypedAt = typingCooldowns.get(key) ?? 0;

    if (now - lastTypedAt < TYPING_COOLDOWN) return;

    typingCooldowns.set(key, now);
    addUserEvent("typing", userId, "Started typing.", getChannelInfo(channelId));
};

const patchUserContext: NavContextMenuPatchCallback = (children, { user }: UserContextProps) => {
    if (!settings.store.addContextMenu || !user) return;

    const tracked = targets.includes(user.id);
    const group = findGroupChildrenByChildId("apps", children) ?? children;
    let index = group.findLastIndex(child => child?.props?.id === "ignore");
    if (index < 0) index = group.length - 1;

    group.splice(index, 0,
        <Menu.MenuItem
            id="vc-surveillance-toggle"
            label={tracked ? "Remove from Surveillance" : "Add to Surveillance"}
            action={() => {
                if (tracked) removeTarget(user.id);
                else addTarget(user.id);
            }}
        />
    );
};

export default definePlugin({
    name: "Surveillance",
    description: "Adds a local live event dashboard for selected users.",
    tags: ["Friends", "Utility"],
    authors: [{ name: "Hisako", id: 928787166916640838n }],
    enabledByDefault: false,
    settings,
    contextMenus: {
        "user-context": patchUserContext,
    },
    toolboxActions: {
        "Open Surveillance": () => SettingsRouter.openUserSettings(`${SETTINGS_ENTRY_KEY}_panel`),
    },

    start() {
        updateTargets(settings.store.targets);
        seedPresence();
        void loadEvents();
        PresenceStore.addChangeListener(handlePresenceChange);

        if (!SettingsPlugin.customEntries.some(entry => entry.key === SETTINGS_ENTRY_KEY)) {
            SettingsPlugin.customEntries.push({
                key: SETTINGS_ENTRY_KEY,
                title: "Surveillance",
                Component: require("./components/SurveillanceTab").default,
                Icon: LogIcon,
            });
        }
    },

    stop() {
        PresenceStore.removeChangeListener(handlePresenceChange);
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === SETTINGS_ENTRY_KEY);
        previousVoiceStates.clear();
        messageCache.clear();
        typingCooldowns.clear();
        lastStatuses.clear();
        lastActivities.clear();
    },

    flux: {
        MESSAGE_CREATE({ message }: { message: Message; }) {
            logMessage(message);
        },

        MESSAGE_UPDATE({ message }: { message: Message; }) {
            logMessageUpdate(message);
        },

        MESSAGE_DELETE({ id, channelId }: { id: string; channelId: string; }) {
            logMessageDelete(id, channelId);
        },

        TYPING_START({ userId, channelId }: { userId: string; channelId: string; }) {
            logTyping(userId, channelId);
        },

        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            for (const voiceState of voiceStates) {
                handleVoiceState(voiceState);
            }
        },
    },
});
