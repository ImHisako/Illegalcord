/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, sendBotMessage } from "@api/Commands";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { addMessagePopoverButton as addButton, removeMessagePopoverButton as removeButton } from "@api/MessagePopover";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { ChannelStore, Constants, Menu, RestAPI, UserStore } from "@webpack/common";

interface SilentDeleteMessage extends Message {
    deleted?: boolean;
}

const logger = new Logger("SilentDelete");
const DEFAULT_REPLACEMENT_TEXT = "** **";
const DEFAULT_DELETE_DELAY = 200;
const DELETE_ORIGINAL_DELAY = 100;
const DEFAULT_PURGE_INTERVAL = 500;
const MAX_PURGE_COUNT = 100;
const FETCH_BATCH_SIZE = 100;
const SUPPRESS_NOTIFICATIONS_FLAG = 1 << 12;

const settings = definePluginSettings({
    replacementText: {
        type: OptionType.STRING,
        description: "Text to replace the message with before deletion.",
        default: DEFAULT_REPLACEMENT_TEXT
    },
    deleteDelay: {
        type: OptionType.NUMBER,
        description: "Delay in milliseconds before deleting the replacement message (recommended: 100-500).",
        default: DEFAULT_DELETE_DELAY
    },
    suppressNotifications: {
        type: OptionType.BOOLEAN,
        description: "Suppress notifications when replacing the message (prevents pinging mentioned users).",
        default: true
    },
    deleteOriginal: {
        type: OptionType.BOOLEAN,
        description: "Delete the original message from server. If disabled, the original message will reappear on client restart.",
        default: true
    },
    purgeInterval: {
        type: OptionType.NUMBER,
        description: "Delay in milliseconds between each message deletion during /silentpurge (recommended: 500-1000 to avoid rate limits).",
        default: DEFAULT_PURGE_INTERVAL
    },
    accentColor: {
        type: OptionType.STRING,
        description: "Accent color for the Silent Delete icon (hex code).",
        default: "#ed4245"
    }
});

const getAccentColor = () => settings.store.accentColor || "#ed4245";

const SilentDeleteIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={getAccentColor()}>
        <path d="M15 3.999V2H9V3.999H3V5.999H21V3.999H15Z" />
        <path d="M5 6.99902V18.999C5 20.101 5.897 20.999 7 20.999H17C18.103 20.999 19 20.101 19 18.999V6.99902H5ZM11 17H9V11H11V17ZM15 17H13V11H15V17Z" />
    </svg>
);

async function silentDeleteMessage(channelId: string, messageId: string, deleteOriginal = true): Promise<boolean> {
    try {
        const {
            replacementText = DEFAULT_REPLACEMENT_TEXT,
            deleteDelay = DEFAULT_DELETE_DELAY,
            suppressNotifications = true,
            deleteOriginal: shouldDelete = true
        } = settings.store;

        const response = await RestAPI.post({
            url: Constants.Endpoints.MESSAGES(channelId),
            body: {
                content: replacementText,
                flags: suppressNotifications ? SUPPRESS_NOTIFICATIONS_FLAG : 0,
                mobile_network_type: "unknown",
                nonce: messageId,
                tts: false
            }
        });

        await sleep(deleteDelay);
        await RestAPI.del({ url: Constants.Endpoints.MESSAGE(channelId, response.body.id) });

        if (deleteOriginal && shouldDelete) {
            await sleep(DELETE_ORIGINAL_DELAY);
            await RestAPI.del({ url: Constants.Endpoints.MESSAGE(channelId, messageId) });
        }

        return true;
    } catch (error) {
        logger.error("Failed to silently delete message.", error);
        return false;
    }
}

const messageContextMenuPatch: NavContextMenuPatchCallback = (children, { message }: { message?: SilentDeleteMessage; }) => {
    if (!message || message.author.id !== UserStore.getCurrentUser().id) return;

    if (!message.deleted) {
        const group = findGroupChildrenByChildId("delete", children);
        const deleteIndex = group?.findIndex(item => item?.props?.id === "delete");
        if (!group || deleteIndex == null || deleteIndex < 0) return;

        group.splice(deleteIndex + 1, 0,
            <Menu.MenuItem
                id="silent-delete"
                key="silent-delete"
                label="Silent Delete"
                color="danger"
                action={() => silentDeleteMessage(message.channel_id, message.id)}
                icon={SilentDeleteIcon}
            />
        );
        return;
    }

    const group = findGroupChildrenByChildId("remove-message-history", children) ?? children;
    group.push(
        <Menu.MenuItem
            id="silent-delete-history"
            key="silent-delete-history"
            label="Silent Delete History"
            color="danger"
            action={() => silentDeleteMessage(message.channel_id, message.id, false)}
            icon={SilentDeleteIcon}
        />
    );
};

export default definePlugin({
    name: "SilentDelete",
    description: "\"Silently\" deletes a message. Bypass message loggers by replacing the message with a placeholder.",
    tags: ["Chat", "Privacy"],
    authors: [
        { name: "Aurick", id: 1348025017233047634n },
        { name: "appleflyer", id: 1209096766075703368n },
        { name: "irritably", id: 928787166916640838n }
    ],
    dependencies: ["MessagePopoverAPI", "CommandsAPI"],
    settings,

    contextMenus: {
        "message": messageContextMenuPatch
    },

    commands: [
        {
            name: "silentpurge",
            description: "Silently delete your recent messages in this channel.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [{
                name: "count",
                description: "Number of your messages to silently delete.",
                type: ApplicationCommandOptionType.INTEGER,
                required: true,
                minValue: 1,
                maxValue: MAX_PURGE_COUNT
            }],
            execute: (opts, ctx) => {
                const count = opts.find(o => o.name === "count")?.value as number;
                if (!count || count < 1) return;

                const channelId = ctx.channel.id;
                const currentUserId = UserStore.getCurrentUser().id;

                (async () => {
                    try {
                        const userMessages: SilentDeleteMessage[] = [];
                        let lastMessageId: string | undefined;

                        while (userMessages.length < count) {
                            const response = await RestAPI.get({
                                url: Constants.Endpoints.MESSAGES(channelId),
                                query: { limit: FETCH_BATCH_SIZE, ...(lastMessageId && { before: lastMessageId }) }
                            });

                            const messages = Array.isArray(response.body) ? response.body as SilentDeleteMessage[] : [];
                            if (!messages.length) break;

                            for (const msg of messages) {
                                if (msg.author.id === currentUserId) {
                                    userMessages.push(msg);
                                    if (userMessages.length >= count) break;
                                }
                            }

                            lastMessageId = messages[messages.length - 1].id;
                            if (messages.length < FETCH_BATCH_SIZE) break;
                            await sleep(DELETE_ORIGINAL_DELAY);
                        }

                        if (!userMessages.length) return;

                        const purgeInterval = settings.store.purgeInterval ?? DEFAULT_PURGE_INTERVAL;
                        let successCount = 0;

                        for (let i = 0; i < userMessages.length; i++) {
                            if (await silentDeleteMessage(channelId, userMessages[i].id)) successCount++;
                            if (i < userMessages.length - 1) await sleep(purgeInterval);
                        }

                        sendBotMessage(channelId, { content: `Successfully silently deleted ${successCount} message(s).` });
                    } catch (error) {
                        logger.error("Failed during silent purge.", error);
                    }
                })();
            }
        }
    ],

    start() {
        addButton("SilentDelete", msg => {
            if (msg.author.id !== UserStore.getCurrentUser().id || msg.deleted) return null;

            return {
                label: "Silent Delete",
                icon: SilentDeleteIcon,
                message: msg,
                channel: ChannelStore.getChannel(msg.channel_id),
                onClick: () => silentDeleteMessage(msg.channel_id, msg.id),
                dangerous: true
            };
        });
    },

    stop() {
        removeButton("SilentDelete");
    }
});
