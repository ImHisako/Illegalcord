/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { ChannelStore, GuildStore, Menu, UserStore } from "@webpack/common";
import { UserContextProps } from "plugins/biggerStreamPreview";

import * as status from "./status";
import * as voice from "./voice";

const Native = VencordNative.pluginHelpers.Stalker as PluginNative<typeof import("./index.native")>;

if (!Native) {
    console.warn("Stalker native module not available");
}

export interface StalkerLogEntry {
    timestamp: string;
    userId: string;
    username: string;
    action: "status_change" | "voice_join" | "voice_leave" | "message_send";
    details: string;
    channelName?: string;
    guildName?: string;
}

export const logger = new Logger("Stalker");

// Cache separata per ogni utente: userId -> { logs, date }
// La "date" serve a invalidare la cache quando cambia il giorno
interface UserLogCache {
    logs: StalkerLogEntry[];
    date: string; // formato YYYY-MM-DD
}

const cachedLogsPerUser = new Map<string, UserLogCache>();

// Coda di scrittura per evitare race conditions: userId -> Promise
const writeLocks = new Map<string, Promise<void>>();

function getTodayDate(): string {
    return new Date().toISOString().slice(0, 10);
}

async function getLogsFromFile(userId: string, username: string): Promise<StalkerLogEntry[]> {
    if (!Native?.readStalkerLog) return [];

    try {
        const fileContents = await Native.readStalkerLog(userId, username);
        const parsed = JSON.parse(fileContents);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        // Se il JSON è corrotto, logga l'errore e parti da zero invece di perdere silenziosamente i dati
        logger.error(`Failed to parse stalker log for user ${userId}, starting fresh:`, error);
        return [];
    }
}

function getCacheForUser(userId: string): UserLogCache | undefined {
    const cache = cachedLogsPerUser.get(userId);
    // Invalida la cache se il giorno è cambiato
    if (cache && cache.date !== getTodayDate()) {
        cachedLogsPerUser.delete(userId);
        return undefined;
    }
    return cache;
}

export async function logStalkerEvent(entry: StalkerLogEntry) {
    if (!settings.store.enableLogging) return;
    if (!Native?.writeStalkerLog) return;

    // Serializza le scritture per questo utente per evitare race conditions
    const previousLock = writeLocks.get(entry.userId) ?? Promise.resolve();

    const newLock = previousLock.then(async () => {
        try {
            let cache = getCacheForUser(entry.userId);

            if (!cache) {
                const logs = await getLogsFromFile(entry.userId, entry.username);
                cache = { logs, date: getTodayDate() };
                cachedLogsPerUser.set(entry.userId, cache);
            }

            cache.logs.push(entry);

            await Native.writeStalkerLog(JSON.stringify(cache.logs, null, 2), entry.userId, entry.username);
        } catch (error) {
            logger.error("Failed to write stalker log:", error);
        }
    });

    writeLocks.set(entry.userId, newLock);
    await newLock;
}

export let targets: string[] = [];

const parseTargets = (parse: string): string[] => {
    const regex = /\s*(,?)\s*([0-9]+)/g;
    const matches = [...parse.matchAll(regex)].map(match => match.at(match.length - 1) as string);
    targets = matches;
    return matches;
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
    },

    notifyCallLeave: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Send a notification when a user leaves a voice channel.",
    },

    notifyOffline: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Send a notification when a user goes offline."
    },

    notifyOnline: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Send a notification when a user goes online.",
    },

    notifyDnd: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Send a notification when a user goes on Do Not Disturb.",
    },

    notifyIdle: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Send a notification when a user goes idle.",
    },

    notifyGoOnline: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Send a notification when a user logs onto Discord or leaves invisible, regardless of the 4 above options."
    },

    enableLogging: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Enable logging of stalker events to a local file."
    },

    logMessages: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Log when a user sends a message in any channel."
    },

    targets: {
        type: OptionType.STRING,
        placeholder: "1234,5678",
        description: "List of user IDs to stalk, separate with a comma.",
        default: "",
        onChange: parseTargets,
    },
});

const patchUserContext: NavContextMenuPatchCallback = (children, { user }: UserContextProps) => {
    if (!settings.store.stalkContext || !user) return;

    const stalked = settings.store.targets.includes(user.id);
    const group = findGroupChildrenByChildId("apps", children) ?? children;
    let id = group.findLastIndex(child => child?.props?.id && child.props.id === "ignore");
    if (id < 0) id = group.length - 1;

    group.splice(id, 0,
        <Menu.MenuItem
            id="vc-st-stalk"
            label={stalked ? "Unstalk" : "Stalk"}
            action={() => {
                if (stalked) {
                    settings.store.targets = settings.store.targets.replace(new RegExp(`(,?)(\\s*)(${user.id})`), "");
                    cachedLogsPerUser.delete(user.id);
                    writeLocks.delete(user.id);
                } else {
                    settings.store.targets += `,${user.id}`;
                    if (settings.store.targets.startsWith(",")) settings.store.targets = settings.store.targets.slice(1);
                }

                parseTargets(settings.store.targets);
            }}
        />
    );
};

export default definePlugin({
    name: "Stalker",
    description: "Notifies you whenever a person does something.",
    authors: [
        { name: "Reycko", id: 1123725368004726794n },
        { name: "irritably", id: 928787166916640838n }
    ],

    contextMenus: {
        "user-context": patchUserContext,
    },

    start() {
        parseTargets(settings.store.targets);
        status.init();
        voice.init();
    },

    stop() {
        status.deinit();
        voice.deinit();
        cachedLogsPerUser.clear();
        writeLocks.clear();
    },

    flux: {
        MESSAGE_CREATE({ message }: { message: any; }) {
            if (!settings.store.logMessages) return;
            if (!targets.includes(message.author.id)) return;

            const channel = ChannelStore.getChannel(message.channel_id);
            const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
            const preview = message.content.length > 100
                ? `${message.content.substring(0, 100)}...`
                : message.content;

            logStalkerEvent({
                timestamp: new Date().toISOString(),
                userId: message.author.id,
                username: message.author.username,
                action: "message_send",
                details: `Sent message: ${preview}`,
                channelName: channel.name,
                guildName: guild?.name
            });
        },
    },

    settings,
});
