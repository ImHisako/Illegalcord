/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ApplicationCommandOptionType, findOption } from "@api/Commands";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { HeaderBarButton } from "@api/HeaderBar";
import { isPluginEnabled } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import { Button } from "@components/Button";
import { LogsIcon } from "@components/Icons";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { Alerts, Menu, showToast, Toasts } from "@webpack/common";

import { MessageLoggerLegalWarning } from "../_legalWarnings";
import { getChannelLogsAfter } from "./db";
import { clearAllLogs, handleMessageCreate, handleMessageDelete, handleMessageDeleteBulk, handleMessageUpdate, runMaintenanceNow, startEngine, stopEngine } from "./engine";
import { openLogs } from "./LogsModal";
import { settings } from "./settings";
import { FetchMessagesResponse, LoadMessagesPayload, LoggedMessage, MessageCreatePayload, MessageDeleteBulkPayload, MessageDeletePayload, MessageUpdatePayload } from "./types";
import { cl } from "./utils";

const logger = new Logger("IllegalMessageLogger");
const HEADER_SETTINGS: Array<"showHeaderButton"> = ["showHeaderButton"];

function OpenLogsButton() {
    const { showHeaderButton } = settings.use(HEADER_SETTINGS);
    if (!showHeaderButton) return null;

    return <HeaderBarButton tooltip="Open Illegal Message Logger" icon={LogsIcon} onClick={() => openLogs()} />;
}

const messageContextMenu: NavContextMenuPatchCallback = (children, { message }: { message: Message; }) => {
    const group = findGroupChildrenByChildId("copy-text", children)
        ?? findGroupChildrenByChildId("copy-link", children);
    if (!group) return;

    group.push(
        <Menu.MenuItem
            id="illegal-ml-search-author"
            label="Search Illegal logs from author"
            action={() => openLogs(`from:${message.author.id}`)}
        />,
        <Menu.MenuItem
            id="illegal-ml-search-channel"
            label="Search Illegal logs in channel"
            action={() => openLogs(`channel:${message.channel_id}`)}
        />
    );
};

function SettingsActions() {
    return (
        <div>
            <MessageLoggerLegalWarning />
            <p>MessageLoggerEnhanced must remain disabled while IllegalMessageLogger is enabled.</p>
            <div className={cl("actions")}>
                <Button onClick={() => openLogs()}>Open logs</Button>
                <Button
                    variant="secondary"
                    onClick={() => void runMaintenanceNow()
                        .then(() => showToast("Message log maintenance completed.", Toasts.Type.SUCCESS))
                        .catch(() => showToast("Message log maintenance failed.", Toasts.Type.FAILURE))}
                >
                    Run maintenance
                </Button>
                <Button
                    variant="dangerSecondary"
                    onClick={() => Alerts.show({
                        title: "Clear every message log",
                        body: "This also removes protected logs and cannot be undone.",
                        confirmText: "Clear everything",
                        confirmVariant: "critical-primary",
                        cancelText: "Cancel",
                        onConfirm: async () => {
                            await clearAllLogs(true);
                            showToast("Cleared every message log.", Toasts.Type.SUCCESS);
                        }
                    })}
                >
                    Clear everything
                </Button>
            </div>
        </div>
    );
}

async function processMessageFetch(response: FetchMessagesResponse) {
    if (!response.ok || response.body.length === 0) return;

    try {
        const oldestMessage = response.body[response.body.length - 1];
        const records = await getChannelLogsAfter(oldestMessage.channel_id, oldestMessage.timestamp);
        response.body.extra = records.map(record => record.message);
    } catch (error) {
        logger.error("Failed to restore persistent logs into the channel.", error);
    }
}

function mergeLoadedMessages(messages: LoggedMessage[] & { extra?: LoggedMessage[]; }, payload: LoadMessagesPayload) {
    if (!messages.extra?.length || messages.length === 0) return messages;

    const oldestTimestamp = messages[messages.length - 1].timestamp;
    const newestTimestamp = messages[0].timestamp;
    const includeNewer = !payload.hasMoreAfter && !payload.isBefore;
    const includeOlder = !payload.hasMoreBefore && !payload.isAfter;
    const knownIds = new Set(messages.map(message => message.id));
    const extra = messages.extra.filter(message =>
        !knownIds.has(message.id)
        && (includeNewer || message.timestamp <= newestTimestamp)
        && (includeOlder || message.timestamp >= oldestTimestamp)
    );

    messages.push(...extra);
    messages.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    return messages;
}

export default definePlugin({
    name: "IllegalMessageLogger",
    description: "Persistently logs deleted and edited messages with batched storage, pagination, search and automatic maintenance.",
    authors: [{ name: "Irritably", id: 928787166916640838n }],
    tags: ["Chat", "Utility"],
    dependencies: ["MessageLogger"],
    settings,
    settingsAboutComponent: SettingsActions,

    commands: [{
        name: "illegal-logs",
        description: "Open the persistent message log.",
        options: [{
            name: "query",
            description: "Optional advanced search query.",
            type: ApplicationCommandOptionType.STRING
        }],
        execute(args) {
            openLogs(findOption(args, "query", ""));
        }
    }],

    contextMenus: {
        message: messageContextMenu
    },

    headerBarButton: {
        icon: LogsIcon,
        render: OpenLogsButton
    },

    patches: [
        {
            find: "_tryFetchMessagesCached",
            replacement: [
                {
                    match: /(?<=\.get\(\{url.{0,150}?\.then\()(\i)=>\(/,
                    replace: "async $1=>(await $self.processMessageFetch($1),"
                },
                {
                    match: /(?<=type:"LOAD_MESSAGES_SUCCESS",.{1,100})messages:(\i)/,
                    replace: "get messages(){return $self.mergeLoadedMessages($1,this)}"
                }
            ]
        }
    ],

    get toolboxActions(): Record<string, () => void> {
        if (settings.store.hideFromToolbox) return {};

        return {
            "Illegal Message Logger": openLogs
        };
    },

    processMessageFetch,
    mergeLoadedMessages,

    flux: {
        MESSAGE_CREATE: handleMessageCreate as (payload: MessageCreatePayload) => void,
        MESSAGE_UPDATE: handleMessageUpdate as (payload: MessageUpdatePayload) => void,
        MESSAGE_DELETE: handleMessageDelete as (payload: MessageDeletePayload) => void,
        MESSAGE_DELETE_BULK: handleMessageDeleteBulk as (payload: MessageDeleteBulkPayload) => void
    },

    start() {
        if (isPluginEnabled("MessageLoggerEnhanced")) {
            Settings.plugins.MessageLoggerEnhanced.enabled = false;
            showToast("MessageLoggerEnhanced was disabled. Restart to activate IllegalMessageLogger safely.", Toasts.Type.FAILURE);
            return;
        }

        startEngine();
    },

    stop() {
        stopEngine();
    }
});
