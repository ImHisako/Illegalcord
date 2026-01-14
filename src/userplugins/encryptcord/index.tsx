/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import {
    ApplicationCommandInputType,
    ApplicationCommandOptionType,
    sendBotMessage,
} from "@api/Commands";
import * as DataStore from "@api/DataStore";
import {
    addMessagePreSendListener,
    MessageSendListener,
    removeMessagePreSendListener,
} from "@api/MessageEvents";
import { Devs } from "@utils/constants";
import { sleep } from "@utils/misc";
import definePlugin from "@utils/types";
import { Message } from "@vencord/discord-types";
import {
    ChannelActionCreators,
    FluxDispatcher,
    MessageActions,
    RestAPI,
    SnowflakeUtils,
    useEffect,
    UserStore,
    UserUtils,
    useState,
} from "@webpack/common";

import { getCurrentChannel } from "@utils/discord";
import { findLazy } from "@webpack";

const CloudUpload = findLazy(m => m.prototype?.trackUploadFinished);

import {
    decryptData,
    encryptData,
    formatPemKey,
    generateKeys,
} from "./rsa-utils";

interface IMessageCreate {
    type: "MESSAGE_CREATE";
    optimistic: boolean;
    isPushNotification: boolean;
    channelId: string;
    message: Message;
}

const ChatBarIcon: ChatBarButtonFactory = ({ isMainChat }) => {
    const [enabled, setEnabled] = useState(false);
    const [buttonDisabled, setButtonDisabled] = useState(false);

    useEffect(() => {
        const listener: MessageSendListener = async (_, message) => {
            if (enabled) {
                const groupChannel = await DataStore.get("encryptcordChannelId");
                if ((getCurrentChannel()?.id ?? "") !== groupChannel) {
                    sendBotMessage(getCurrentChannel()?.id ?? "", {
                        content: `You must be in <#${groupChannel}> to send an encrypted message!`,
                    });
                    message.content = "";
                    return;
                }
                
                const trimmedMessage = message.content.trim();
                await MessageActions.receiveMessage(
                    groupChannel,
                    await createMessage(
                        trimmedMessage,
                        UserStore.getCurrentUser().id,
                        groupChannel,
                        0
                    )
                );
                
                const encryptcordGroupMembers = await DataStore.get("encryptcordGroupMembers");
                const dmPromises = Object.keys(encryptcordGroupMembers).map(
                    async memberId => {
                        const groupMember = await UserUtils.getUser(memberId).catch(() => null);
                        if (!groupMember) return;
                        
                        const encryptedMessage = await encryptData(
                            encryptcordGroupMembers[memberId].key,
                            trimmedMessage
                        );
                        const encryptedMessageString = JSON.stringify(encryptedMessage);
                        
                        // Send persistent encrypted message via DM
                        await sendPersistentMessage(
                            groupMember.id,
                            encryptedMessageString,
                            "[ENCRYPTED]",
                            true
                        );
                    }
                );

                await Promise.all(dmPromises);
                message.content = "";
            }
        };

        addMessagePreSendListener(listener);
        return () => void removeMessagePreSendListener(listener);
    }, [enabled]);

    if (!isMainChat) return null;

    return (
        <ChatBarButton
            tooltip={enabled ? "Send Unencrypted Messages" : "Send Encrypted Messages"}
            onClick={async () => {
                const currentChannelId = getCurrentChannel()?.id ?? "";
                
                // Check if there's already a group in this channel
                const existingGroupChannel = await DataStore.get("encryptcordChannelId");
                const hasExistingGroup = await DataStore.get("encryptcordGroup");
                
                console.log("Encryptcord: Button clicked", { 
                    hasExistingGroup, 
                    existingGroupChannel, 
                    currentChannelId 
                });

                if (hasExistingGroup && existingGroupChannel === currentChannelId) {
                    // Already in group, just toggle encryption mode
                    setEnabled(!enabled);
                    return;
                }

                if (hasExistingGroup && existingGroupChannel !== currentChannelId) {
                    // Leave current group first
                    sendBotMessage(currentChannelId, {
                        content: "*Leaving current group...*",
                    });
                    await leave(existingGroupChannel);
                }

                // Join or create group
                setButtonDisabled(true);
                
                // Send join message to channel
                await sendPersistentMessage(
                    currentChannelId,
                    await DataStore.get("encryptcordPublicKey"),
                    "JOIN",
                    false
                );
                
                sendBotMessage(currentChannelId, {
                    content: "*Looking for existing group...*\nIf none found, a new one will be created shortly.",
                });

                // Wait and check if group was found
                await sleep(3000);
                
                const groupExists = await DataStore.get("encryptcordGroup");
                const groupChannel = await DataStore.get("encryptcordChannelId");
                
                console.log("Encryptcord: After wait", { groupExists, groupChannel, currentChannelId });

                if (groupExists && groupChannel === currentChannelId) {
                    // Successfully joined existing group
                    sendBotMessage(currentChannelId, {
                        content: "✅ Joined existing group!",
                    });
                } else {
                    // Create new group
                    await startGroup(currentChannelId);
                    sendBotMessage(currentChannelId, {
                        content: "🆕 Created new group!",
                    });
                }

                setEnabled(true);
                setButtonDisabled(false);
            }}
            buttonProps={{
                style: {
                    transition: "transform 0.3s ease-in-out",
                    transform: `rotate(${enabled ? 0 : 15}deg)`,
                },
                disabled: buttonDisabled,
            }}
        >
            <svg width="24" height="24" viewBox="0 0 129 171">
                {!enabled && (
                    <>
                        <mask id="encordBarIcon"></mask>
                        <path
                            fill="currentColor"
                            d="M128.93 149.231V74.907a21.142 21.142 0 00-6.195-15.1 21.165 21.165 0 00-15.101-6.195h-1.085V40.918A40.604 40.604 0 0042.214 8.065 40.602 40.602 0 0026.28 32.318h15.972a25.164 25.164 0 0128.043-15.94 25.166 25.166 0 0120.691 24.745v12.694H22.184A21.276 21.276 0 00.89 75.111v74.325a21.27 21.27 0 0013.143 19.679 21.273 21.273 0 008.152 1.615h85.388a21.455 21.455 0 0015.083-6.357 21.453 21.453 0 006.213-15.142h.062zm-63.888-15.765a21.296 21.296 0 01-15.058-36.352 21.296 21.296 0 0136.354 15.057 21.151 21.151 0 01-21.296 21.295z"
                        />
                    </>
                )}
                <path
                    mask="url(#encordBarIcon)"
                    fill="currentColor"
                    d="M129.497 149.264V75.001a21.27 21.27 0 00-21.295-21.294h-3.072V41.012a41.079 41.079 0 00-1.024-8.6A40.62 40.62 0 0070.729 1.087 5.673 5.673 0 0168.886.88h-.204c-.615 0-1.23-.205-1.844-.205h-4.095A5.672 5.672 0 0060.9.881h-.204a5.672 5.672 0 00-1.843.205A40.627 40.627 0 0025.27 32.413h.205a41.092 41.092 0 00-1.024 8.6v12.694h-3.133A21.153 21.153 0 00.023 75v74.325a21.415 21.415 0 0021.296 21.294h87.231a21.336 21.336 0 0020.886-21.294l.061-.062zm-64.91-15.97a21.317 21.317 0 01-22.069-24.804 21.316 21.316 0 0142.34 3.509 21.355 21.355 0 01-20.272 21.295zm25.185-79.649H39.604V40.951a24.283 24.283 0 016.963-17.2 25.351 25.351 0 0116.79-7.78h2.663a25.31 25.31 0 0123.752 25.184v12.49z"
                />
            </svg>
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "Encryptcord",
    description: "Simple end-to-end encryption in Discord!",
    authors: [Devs.Inbestigator],
    dependencies: ["CommandsAPI"],
    patches: [],
    flux: {
        async MESSAGE_CREATE({ optimistic, type, message, channelId }: IMessageCreate) {
            if (optimistic || type !== "MESSAGE_CREATE") return;
            if (message.state === "SENDING") return;
            if (message.author.id === UserStore.getCurrentUser().id) return;
            if (!message.content) return;

            console.log("Encryptcord: Received message", { 
                content: message.content.substring(0, 50),
                author: message.author.id,
                channelId
            });

            // Handle JOIN messages
            if (message.content.startsWith("JOIN")) {
                const publicKey = message.content.replace("JOIN", "").trim();
                if (!publicKey.includes("BEGIN PUBLIC KEY")) return;

                console.log("Encryptcord: Processing JOIN request from", message.author.id);

                const hasGroup = await DataStore.get("encryptcordGroup");
                const currentChannel = getCurrentChannel()?.id ?? "";

                if (!hasGroup || channelId !== currentChannel) {
                    console.log("Encryptcord: No group or wrong channel, ignoring");
                    return;
                }

                const sender = await UserUtils.getUser(message.author.id).catch(() => null);
                if (!sender) return;

                const encryptcordGroupMembers = await DataStore.get("encryptcordGroupMembers");
                
                // Add new member to group
                encryptcordGroupMembers[message.author.id] = {
                    key: publicKey,
                    parent: UserStore.getCurrentUser().id,
                    child: null,
                };

                // Update current user's child
                encryptcordGroupMembers[UserStore.getCurrentUser().id].child = message.author.id;

                await DataStore.set("encryptcordGroupMembers", encryptcordGroupMembers);

                // Notify group
                await MessageActions.receiveMessage(
                    channelId,
                    await createMessage(
                        `${sender.username} joined the encrypted group!`,
                        message.author.id,
                        channelId,
                        7
                    )
                );

                console.log("Encryptcord: User joined successfully");
                return;
            }

            // Handle encrypted messages
            if (message.content.startsWith("[ENCRYPTED]")) {
                const encryptedData = message.content.replace("[ENCRYPTED]", "").trim();
                try {
                    const parsedData = JSON.parse(encryptedData);
                    const decryptedMessage = await decryptData(
                        await DataStore.get("encryptcordPrivateKey"),
                        parsedData
                    );
                    
                    const sender = await UserUtils.getUser(message.author.id).catch(() => null);
                    if (!sender) return;

                    const groupChannel = await DataStore.get("encryptcordChannelId");
                    await MessageActions.receiveMessage(
                        groupChannel,
                        await createMessage(decryptedMessage, message.author.id, groupChannel, 0)
                    );
                } catch (error) {
                    console.error("Encryptcord: Failed to decrypt message", error);
                }
                return;
            }
        },
    },
    commands: [
        {
            name: "encryptcord",
            description: "End-to-end encryption in Discord!",
            options: [
                {
                    name: "leave",
                    description: "Leave current group",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                },
            ],
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (opts, ctx) => {
                if (opts[0].name === "leave") {
                    leave(ctx.channel.id);
                }
            },
        },
    ],
    renderChatBarButton: ChatBarIcon,
    async start() {
        const pair = await generateKeys();
        await DataStore.set("encryptcordPublicKey", pair.publicKey);
        await DataStore.set("encryptcordPrivateKey", pair.privateKey);
        
        if ((await DataStore.get("encryptcordGroup")) === true) {
            await leave((await DataStore.get("encryptcordChannelId")) ?? "");
        }
        
        await DataStore.set("encryptcordGroup", false);
        await DataStore.set("encryptcordChannelId", "");
        await DataStore.set("encryptcordGroupMembers", {});
        
        console.log("Encryptcord: Plugin started");
    },
    async stop() {
        if ((await DataStore.get("encryptcordGroup")) === true) {
            await leave((await DataStore.get("encryptcordChannelId")) ?? "");
        }
    },
});

// Simplified message sending function
async function sendPersistentMessage(
    recipientId: string,
    content: string,
    prefix: string,
    isDM: boolean = true
) {
    let targetChannelId = recipientId;
    
    if (isDM) {
        // Create/get DM channel
        targetChannelId = await ChannelActionCreators.getOrEnsurePrivateChannel(recipientId);
    }
    
    await RestAPI.post({
        url: `/channels/${targetChannelId}/messages`,
        body: {
            content: `${prefix} ${content}`,
            nonce: SnowflakeUtils.fromTimestamp(Date.now()),
        },
    });
    
    console.log(`Encryptcord: Sent ${prefix} message to ${isDM ? 'DM' : 'channel'} ${targetChannelId}`);
}

// Handle leaving group
async function leave(channelId: string) {
    const encryptcordGroupMembers = await DataStore.get("encryptcordGroupMembers");
    
    // Notify all members
    const dmPromises = Object.keys(encryptcordGroupMembers).map(async memberId => {
        const groupMember = await UserUtils.getUser(memberId).catch(() => null);
        if (!groupMember) return;
        await sendPersistentMessage(groupMember.id, "LEAVE", "[SYSTEM]", true);
    });

    await Promise.all(dmPromises);
    
    await DataStore.set("encryptcordGroup", false);
    await DataStore.set("encryptcordChannelId", "");
    await DataStore.set("encryptcordGroupMembers", {});
    
    await MessageActions.receiveMessage(
        channelId,
        await createMessage("Left the encrypted group", UserStore.getCurrentUser().id, channelId, 2)
    );
    
    console.log("Encryptcord: Left group");
}

// Create message for group
async function createMessage(
    message: string,
    senderId: string,
    channelId: string,
    type: number
) {
    const messageStart = sendBotMessage("", {
        channel_id: channelId,
        embeds: [],
    });
    const sender = await UserUtils.getUser(senderId).catch(() => null);
    if (!sender) return;
    
    return {
        ...messageStart,
        content: message,
        author: sender,
        type,
        flags: 0,
    };
}

// Start E2EE Group
async function startGroup(channelId: string) {
    await DataStore.set("encryptcordChannelId", channelId);
    await DataStore.set("encryptcordGroupMembers", {
        [UserStore.getCurrentUser().id]: {
            key: await DataStore.get("encryptcordPublicKey"),
            parent: null,
            child: null,
        },
    });
    await DataStore.set("encryptcordGroup", true);
    
    await MessageActions.receiveMessage(
        channelId,
        await createMessage("Created encrypted group!", UserStore.getCurrentUser().id, channelId, 7)
    );
    
    console.log("Encryptcord: Group created in", channelId);
}