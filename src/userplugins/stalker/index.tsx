/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { ChannelStore, FluxDispatcher, GuildStore, Menu, UserStore } from "@webpack/common";
import { UserContextProps } from "plugins/biggerStreamPreview";

import * as status from "./status";
import * as voice from "./voice";

const Native = VencordNative.pluginHelpers.Stalker as PluginNative<typeof import("./index.native")>;

// Verifica che il modulo nativo sia disponibile
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

let cachedLogs: StalkerLogEntry[] | null = null;

async function getLogsFromFile(): Promise<StalkerLogEntry[]> {
    try {
        if (Native && Native.readStalkerLog) {
            const fileContents = await Native.readStalkerLog();
            if (fileContents) {
                const logs = JSON.parse(fileContents);
                return Array.isArray(logs) ? logs : [];
            }
        }
    } catch (error) {
        logger.error("Failed to read stalker logs from file:", error);
    }
    
    return [];
}

export async function logStalkerEvent(entry: StalkerLogEntry) {
    try {
        // Controlla se il logging è abilitato nelle impostazioni
        if (!settings.store.enableLogging) {
            return;
        }
        
        if (Native && Native.writeStalkerLog) {
            // Ottieni i log esistenti dal file o dalla cache
            let logs: StalkerLogEntry[];
            
            if (cachedLogs) {
                logs = cachedLogs;
            } else {
                logs = await getLogsFromFile();
                cachedLogs = logs;
            }
            
            // Aggiungi il nuovo evento
            logs.push(entry);
            
            // Aggiorna la cache
            cachedLogs = logs;
            
            // Scrivi il file JSON aggiornato
            await Native.writeStalkerLog(JSON.stringify(logs, null, 2));
        }
    } catch (error) {
        logger.error("Failed to write stalker log:", error);
    }
}
export let targets: string[] = [];

const parseTargets = (parse: string): string[] => {
    const regex = /\s*(,?)\s*([0-9]+)/g;
    const matches = [...parse.matchAll(regex)].map(value => {
        return value.at(value.length - 1) as string;
    });

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
        description: "Send a notification when a user joins a call.",
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
        description: "Send a notification when a user goes on idle.",
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
    if (!settings.store.stalkContext) return;
    if (!user) return;

    const stalked = settings.store.targets.includes(user.id);
    const group = findGroupChildrenByChildId("apps", children) ?? children;
    let id = group.findLastIndex(child => child?.props?.id && child.props.id === "ignore"); // ignore button
    if (id < 0) id = group.length - 1; // or at the end if not found

    group.splice(id, 0,
        <Menu.MenuItem
            id="vc-st-stalk"
            label={stalked ? "Unstalk" : "Stalk"}
            action={() => {
                if (stalked) {
                    settings.store.targets = settings.store.targets.replace(new RegExp(`(,?)(\\s*)(${user.id})`), "");
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
    "description": "Notifies you whenever a person does something.",
    authors: [{ name: "Reycko", id: 1123725368004726794n }],

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
    },

    flux: {
        MESSAGE_CREATE({ message }: { message: any }) {
            if (!settings.store.logMessages) return;
            
            const isStalking = targets.includes(message.author.id);
            if (isStalking) {
                const channel = ChannelStore.getChannel(message.channel_id);
                const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
                
                logStalkerEvent({
                    timestamp: new Date().toISOString(),
                    userId: message.author.id,
                    username: message.author.username,
                    action: "message_send",
                    details: `Sent message: ${message.content.substring(0, 100)}${message.content.length > 100 ? "..." : ""}`,
                    channelName: channel.name,
                    guildName: guild?.name
                });
            }
        },
        

    },

    settings,
});
