/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addMessagePopoverButton as addButton, removeMessagePopoverButton as removeButton } from "@api/MessagePopover";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, Constants, MessageStore, RestAPI, UserStore } from "@webpack/common";

const MessageActions = findByPropsLazy("deleteMessage", "startEditMessage");

const settings = definePluginSettings({
    deleteOriginalMessage: {
        type: OptionType.BOOLEAN,
        description: "Delete the original server-side message after silent edit. If disabled, the original message will reappear after client reload.",
        default: true
    },
    deleteDelay: {
        type: OptionType.NUMBER,
        description: "Delay (in milliseconds) before deleting the original message if enabled.",
        default: 500
    },
    suppressNotifications: {
        type: OptionType.BOOLEAN,
        description: "Recommended for use in DMs to prevent pinging users.",
        default: false
    },
    interceptAllEdits: {
        type: OptionType.BOOLEAN,
        description: "Silently edit every message you edit through Discord's normal edit flows, including shortcuts like Up Arrow.",
        default: false
    },
    accentColor: {
        type: OptionType.STRING,
        description: "Accent color for the Silent Edit icon (hex code).",
        default: "#ed4245"
    }
});

const SilentEditIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={settings.store.accentColor || "#ed4245"}>
        <path d="M19.2929 9.8299L19.9409 9.18278C21.353 7.77064 21.353 5.47197 19.9409 4.05892C18.5287 2.64678 16.2292 2.64678 14.817 4.05892L14.1699 4.70694L19.2929 9.8299ZM12.8962 5.97688L5.18469 13.6906L10.3085 18.813L18.0201 11.0992L12.8962 5.97688ZM4.11851 20.9704L8.75906 19.8112L4.18692 15.239L3.02678 19.8796C2.95028 20.1856 3.04028 20.5105 3.26349 20.7337C3.48669 20.9569 3.8116 21.046 4.11851 20.9704Z" />
    </svg>
);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function sendMessage(content: string, nonce: string, channelId: string, suppressNotifications: boolean, messageReference?: any) {
    const body: any = {
        content,
        flags: suppressNotifications ? 4096 : 0,
        mobile_network_type: "unknown",
        nonce,
        tts: false,
    };

    if (messageReference) {
        body.message_reference = {
            channel_id: messageReference.channel_id,
            message_id: messageReference.message_id,
            guild_id: messageReference.guild_id
        };
    }

    return RestAPI.post({
        url: Constants.Endpoints.MESSAGES(channelId),
        body
    });
}

function deleteMessage(channelId: string, messageId: string) {
    return RestAPI.del({
        url: Constants.Endpoints.MESSAGE(channelId, messageId)
    });
}

async function silentEditMessage(channelId: string, messageId: string, content: string, messageReference?: any) {
    let sentReplacement = false;

    try {
        await sendMessage(
            content,
            messageId,
            channelId,
            settings.store.suppressNotifications,
            messageReference
        );
        sentReplacement = true;

        await sleep(settings.store.deleteDelay);

        if (settings.store.deleteOriginalMessage) {
            await deleteMessage(channelId, messageId);
        }

        return true;
    } catch (error) {
        console.error("[SilentEdit] Error:", error);
        return sentReplacement;
    }
}

export default definePlugin({
    name: "SilentEdit",
    description: "\"Silently\" edit a message without showing the edit tag and bypass Vencord's message logger.",
    authors: [{ name: "Aurick", id: 1348025017233047634n }],
    dependencies: ["MessagePopoverAPI"],
    settings,

    async onBeforeMessageEdit(channelId, messageId, messageObj) {
        if (!settings.store.interceptAllEdits || messageObj.content.length === 0) return;

        const msg = MessageStore.getMessage(channelId, messageId);
        if (!msg || msg.author.id !== UserStore.getCurrentUser().id) return;

        if (await silentEditMessage(channelId, messageId, messageObj.content, msg.messageReference)) {
            return { cancel: true };
        }
    },

    start() {
        addButton("SilentEdit", msg => {
            if (msg.author.id !== UserStore.getCurrentUser().id) return null;

            const handleClick = async () => {
                MessageActions.startEditMessage(msg.channel_id, msg.id, msg.content);

                const originalEditMessage = MessageActions.editMessage;

                MessageActions.editMessage = async function(channelId: string, messageId: string, content: any) {
                    MessageActions.editMessage = originalEditMessage;

                    if (messageId !== msg.id) {
                        return originalEditMessage.apply(this, arguments);
                    }

                    await silentEditMessage(channelId, messageId, content.content, msg.messageReference);
                };
            };

            return {
                label: "Silent Edit",
                icon: SilentEditIcon,
                message: msg,
                channel: ChannelStore.getChannel(msg.channel_id),
                onClick: handleClick
            };
        }, SilentEditIcon);
    },

    stop() {
        removeButton("SilentEdit");
    }
});
