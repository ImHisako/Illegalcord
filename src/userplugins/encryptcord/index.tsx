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
const CloudUpload = findLazy(m => m.prototype?.trackUploadFinished);

import { getCurrentChannel } from "@utils/discord";
import { findLazy } from "@webpack";

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
                const groupChannel = await DataStore.get(
                    "encryptcordChannelId"
                );
                if ((getCurrentChannel()?.id ?? "") !== groupChannel) {
                    sendBotMessage(getCurrentChannel()?.id ?? "", {
                        content: `You must be in <#${groupChannel}> to send an encrypted message!\n> If you wish to send an unencrypted message, please click the button in the chatbar.`,
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
                const encryptcordGroupMembers = await DataStore.get(
                    "encryptcordGroupMembers"
                );
                const dmPromises = Object.keys(encryptcordGroupMembers).map(
                    async memberId => {
                        const groupMember = await UserUtils.getUser(
                            memberId
                        ).catch(() => null);
                        if (!groupMember) return;
                        const encryptedMessage = await encryptData(
                            encryptcordGroupMembers[memberId].key,
                            trimmedMessage
                        );
                        const encryptedMessageString =
                            JSON.stringify(encryptedMessage);
                        await sendTempMessage(
                            groupMember.id,
                            encryptedMessageString,
                            "message"
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
            tooltip={
                enabled
                    ? "Send Unencrypted Messages"
                    : "Send Encrypted Messages"
            }
            onClick={async () => {
                const hasGroup = await DataStore.get("encryptcordGroup");
                const currentChannelId = getCurrentChannel()?.id ?? "";
                const groupChannelId = await DataStore.get("encryptcordChannelId");
                
                console.log("Encryptcord: Button click - hasGroup:", hasGroup, "currentChannel:", currentChannelId, "groupChannel:", groupChannelId);
                
                if (
                    hasGroup === false ||
                    groupChannelId !== currentChannelId
                ) {
                    setButtonDisabled(true);
                    await sendTempMessage(
                        getCurrentChannel()?.id ?? "",
                        "",
                        `join\`\`\`\n${await DataStore.get(
                            "encryptcordPublicKey"
                        )}\`\`\``,
                        false
                    );
                    sendBotMessage(getCurrentChannel()?.id ?? "", {
                        content: `*Checking for any groups in this channel...*\n> If none is found, a new one will be created <t:${Math.floor(Date.now() / 1000) + 5
                            }:R>\n> [Tip] You can do \`/encryptcord leave\` to leave a group`,
                    });
                    await sleep(5000);
                    
                    const hasGroupAfterWait = await DataStore.get("encryptcordGroup");
                    const groupChannelAfterWait = await DataStore.get("encryptcordChannelId");
                    const currentChannelAfterWait = getCurrentChannel()?.id ?? "";
                    
                    console.log("Encryptcord: After wait - hasGroup:", hasGroupAfterWait, "groupChannel:", groupChannelAfterWait, "currentChannel:", currentChannelAfterWait);
                    
                    if (
                        hasGroupAfterWait === true &&
                        groupChannelAfterWait !== currentChannelAfterWait
                    ) {
                        sendBotMessage(currentChannelAfterWait, {
                            content: "*Leaving current group...*",
                        });
                        await leave(groupChannelAfterWait);
                    } else if (
                        hasGroupAfterWait === true
                    ) {
                        console.log("Encryptcord: Already in group, enabling encryption mode");
                        setButtonDisabled(false);
                        setEnabled(true);
                        return;
                    }
                    await startGroup(getCurrentChannel()?.id ?? "");
                }
                setEnabled(!enabled);
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
    description: "End-to-end encryption in Discord!",
    authors: [Devs.Inbestigator],
    dependencies: ["CommandsAPI"],
    patches: [
        {
            find: "INTERACTION_APPLICATION_COMMAND_INVALID_VERSION",
            replacement: {
                match: /await \i\.\i\.post\(\{url:\i\.ANM\.INTERACTIONS,body:(\i),/g,
                replace: "await $self.interactionHandler($1);$&",
            },
        },
    ],
    async interactionHandler(interaction) {
        const sender = await UserUtils.getUser(
            interaction.application_id
        ).catch(() => null);
        if (
            !sender ||
            (sender.bot === true && sender.id !== "1") ||
            interaction.data.component_type !== 2
        )
            return;
        switch (interaction.data.custom_id) {
            case "vc-ec-removeFromSelf":
                await handleLeaving(
                    sender.id,
                    (await DataStore.get("encryptcordGroupMembers")) ?? {},
                    interaction.channel_id
                );
                await sendTempMessage(sender.id, "", "leaving");
                FluxDispatcher.dispatch({
                    type: "MESSAGE_DELETE",
                    channelId: interaction.channel_id,
                    id: interaction.message_id,
                    mlDeleted: true,
                });
                break;
            default:
                return;
        }
    },
    flux: {
        async MESSAGE_CREATE({
            optimistic,
            type,
            message,
            channelId,
        }: IMessageCreate) {
            if (optimistic || type !== "MESSAGE_CREATE") return;
            if (message.state === "SENDING") return;
            if (message.author.id === UserStore.getCurrentUser().id) return;
            if (!message.content) return;
            
            // Only process messages with ENCRYPTCORD prefix
            if (!message.content.startsWith('[ENCRYPTCORD]')) return;
            
            // Remove the prefix for processing
            const actualContent = message.content.replace('[ENCRYPTCORD] ', '').replace('[ENCRYPTCORD]', '');
            const encryptcordGroupMembers = await DataStore.get(
                "encryptcordGroupMembers"
            );
            
            const messageContent = actualContent.toLowerCase().trim();
            const firstLine = messageContent.split('\n')[0]?.trim();
            
            console.log("Encryptcord: Received message:", { firstLine, channelId, authorId: message.author.id, isMember: Object.keys(encryptcordGroupMembers).includes(message.author.id) });
            
            // Handle join messages from non-members (new users wanting to join)
            if (firstLine === "join" && !Object.keys(encryptcordGroupMembers).includes(message.author.id)) {
                console.log("Encryptcord: Processing NEW user join request");
                
                if (
                    encryptcordGroupMembers[
                        UserStore.getCurrentUser().id
                    ]?.child
                ) {
                    console.log("Encryptcord: Already has child, ignoring join");
                    return;
                }
                
                const hasGroup = await DataStore.get("encryptcordGroup");
                console.log("Encryptcord: Has group:", hasGroup);
                
                if (!hasGroup) {
                    console.log("Encryptcord: No group found, ignoring join");
                    return;
                }
                
                const groupChannel = await DataStore.get("encryptcordChannelId");
                console.log("Encryptcord: Group channel:", groupChannel, "Message channel:", message.channel_id);
                
                if (groupChannel !== message.channel_id) {
                    console.log("Encryptcord: Channel mismatch, ignoring join");
                    return;
                }
                
                const sender = await UserUtils.getUser(
                    message.author.id
                ).catch(() => null);
                if (!sender) return;
                
                // Extract public key from code block
                const keyMatch = actualContent.match(/```([\s\S]*?)```/);
                if (!keyMatch) return;
                
                const userKey = keyMatch[1].trim();
                await handleJoin(
                    sender.id,
                    userKey,
                    encryptcordGroupMembers
                );
                return;
            }
            
            // Handle messages from existing group members
            if (
                Object.keys(encryptcordGroupMembers).some(
                    key => key === message.author.id
                )
            ) {
                    try {
                        const response = await fetch(
                            message.attachments[0].url
                        );
                        const groupdata = await response.json();
                        await handleGroupData(groupdata);
                    } catch (error) {
                        console.error("Error handling group data:", error);
                    }
                }
                return;
            }
            const dmChannelId =
                await ChannelActionCreators.getOrEnsurePrivateChannel(
                    message.author.id
                );
            if (channelId !== dmChannelId) return;
            const sender = await UserUtils.getUser(message.author.id).catch(
                () => null
            );
            if (!sender) return;
            const groupChannel = await DataStore.get("encryptcordChannelId");
            switch (actualContent.toLowerCase()) {
                case "leaving":
                    handleLeaving(
                        sender.id,
                        encryptcordGroupMembers,
                        groupChannel
                    );
                    break;
                case "message":
                    try {
                        const msgResponse = await fetch(message.attachments[0].url);
                        const messagedata = await msgResponse.json();
                        await handleMessage(messagedata, sender.id, groupChannel);
                    } catch (error) {
                        console.error("Error handling encrypted message:", error);
                        // Send error notification
                        sendBotMessage(groupChannel, {
                            content: `❌ Failed to decrypt message from <@${sender.id}>. They might have left the group or there was an encryption error.`
                        });
                    }
                    break;
                case "groupdata":
                    const response = await fetch(message.attachments[0].url);
                    const groupdata = await response.json();
                    await handleGroupData(groupdata);
                    break;
                default:
                    break;
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
                {
                    name: "data",
                    description: "View your keys and current group members",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                },
            ],
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (opts, ctx) => {
                switch (opts[0].name) {
                    case "start":
                        startGroup(ctx.channel.id);
                        break;
                    case "leave":
                        leave(ctx.channel.id);
                        break;
                    case "data":
                        data(ctx.channel.id);
                        break;
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
    },
    async stop() {
        if ((await DataStore.get("encryptcordGroup")) === true) {
            await leave((await DataStore.get("encryptcordChannelId")) ?? "");
        }
    },
});

// Send Temporary Message
async function sendTempMessage(
    recipientId: string,
    attachment: string,
    content: string,
    dm: boolean = true
) {
    if (recipientId === UserStore.getCurrentUser().id) return;
    const channelId = dm
        ? await ChannelActionCreators.getOrEnsurePrivateChannel(recipientId)
        : recipientId;
    
    // Send persistent message instead of temporary
    if (attachment && attachment !== "") {
        const upload = await new CloudUpload(
            {
                file: new File([new Blob([attachment])], "file.text", {
                    type: "text/plain; charset=utf-8",
                }),
                isClip: false,
                isThumbnail: false,
                platform: 1,
            },
            channelId,
            false,
            0
        );
        upload.on("complete", async () => {
            await RestAPI.post({
                url: `/channels/${channelId}/messages`,
                body: {
                    content: `[ENCRYPTCORD] ${content}`,
                    attachments: [
                        {
                            id: "0",
                            filename: upload.filename,
                            uploaded_filename: upload.uploadedFilename,
                        },
                    ],
                    nonce: SnowflakeUtils.fromTimestamp(Date.now()),
                },
            });
            
            console.log(`Encryptcord: Sent persistent message with attachment to ${recipientId}`);
        });
        await upload.upload();
        return;
    }

    await RestAPI.post({
        url: `/channels/${channelId}/messages`,
        body: {
            content: `[ENCRYPTCORD] ${content}`,
            nonce: SnowflakeUtils.fromTimestamp(Date.now()),
        },
    });
    
    console.log(`Encryptcord: Sent persistent message to ${recipientId}`);
}

// Handle leaving group
async function handleLeaving(
    senderId: string,
    encryptcordGroupMembers: object,
    groupChannel: string
) {
    const updatedMembers = Object.keys(encryptcordGroupMembers).reduce(
        (result, memberId) => {
            if (memberId !== senderId) {
                result[memberId] = encryptcordGroupMembers[memberId];
                if (result[memberId].child === senderId) {
                    result[memberId].child =
                        encryptcordGroupMembers[senderId].child;
                }
                if (result[memberId].parent === senderId) {
                    result[memberId].parent =
                        encryptcordGroupMembers[senderId].parent;
                }
            }
            return result;
        },
        {}
    );

    await DataStore.set("encryptcordGroupMembers", updatedMembers);

    await MessageActions.receiveMessage(
        groupChannel,
        await createMessage("", senderId, groupChannel, 2)
    );
}

// Handle receiving message
async function handleMessage(message, senderId: string, groupChannel: string) {
    const decryptedMessage = await decryptData(
        await DataStore.get("encryptcordPrivateKey"),
        message
    );
    await MessageActions.receiveMessage(
        groupChannel,
        await createMessage(decryptedMessage, senderId, groupChannel, 0)
    );
}

// Handle receiving group data
async function handleGroupData(groupData) {
    await DataStore.set("encryptcordChannelId", groupData.channel);
    await DataStore.set("encryptcordGroupMembers", groupData.members);
    await DataStore.set("encryptcordGroup", true);
    await MessageActions.receiveMessage(
        groupData.channel,
        await createMessage(
            "",
            UserStore.getCurrentUser().id,
            groupData.channel,
            7
        )
    );
}

// Handle joining group
async function handleJoin(
    senderId: string,
    senderKey: string,
    encryptcordGroupMembers: object
) {
    encryptcordGroupMembers[senderId] = {
        key: senderKey,
        parent: UserStore.getCurrentUser().id,
        child: null,
    };
    encryptcordGroupMembers[UserStore.getCurrentUser().id].child = senderId;
    await DataStore.set("encryptcordGroupMembers", encryptcordGroupMembers);
    const groupChannel = await DataStore.get("encryptcordChannelId");
    const newMember = await UserUtils.getUser(senderId).catch(() => null);
    if (!newMember) return;

    const membersData = {};
    Object.entries(encryptcordGroupMembers).forEach(([memberId, value]) => {
        membersData[memberId] = value;
    });

    const membersDataString = JSON.stringify({
        members: membersData,
        channel: groupChannel,
    });

    const dmPromises = Object.keys(encryptcordGroupMembers).map(
        async memberId => {
            const groupMember = await UserUtils.getUser(memberId).catch(
                () => null
            );
            if (!groupMember) return;
            await sendTempMessage(
                groupMember.id,
                membersDataString,
                "groupdata"
            );
        }
    );

    await Promise.all(dmPromises);
    await MessageActions.receiveMessage(groupChannel, {
        ...(await createMessage("", senderId, groupChannel, 7)),
        components: [
            {
                type: 1,
                components: [
                    {
                        type: 2,
                        style: 4,
                        label: "I don't want to talk to you!",
                        custom_id: "vc-ec-removeFromSelf",
                    },
                    {
                        type: 2,
                        style: 2,
                        label: "(Other users can still send/receive messages to/from them)",
                        disabled: true,
                        custom_id: "encryptcord",
                    },
                ],
            },
        ],
    });
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
    sendBotMessage(channelId, {
        content:
            "Group created!\n> Other users can click the lock icon to join.",
    });
    await MessageActions.receiveMessage(
        channelId,
        await createMessage("", UserStore.getCurrentUser().id, channelId, 7)
    );
}

// Leave the Group
async function leave(channelId: string) {
    if (!(await DataStore.get("encryptcordGroup"))) {
        sendBotMessage(channelId, { content: "You're not in a group!" });
        return;
    }
    const user = UserStore.getCurrentUser();
    const encryptcordGroupMembers = await DataStore.get(
        "encryptcordGroupMembers"
    );

    const dmPromises = Object.keys(encryptcordGroupMembers).map(
        async memberId => {
            const groupMember = await UserUtils.getUser(memberId).catch(
                () => null
            );
            if (!groupMember) return;
            await sendTempMessage(groupMember.id, "", "leaving");
        }
    );

    await Promise.all(dmPromises);
    await DataStore.set("encryptcordGroup", false);
    await DataStore.set("encryptcordChannelId", "");
    await DataStore.set("encryptcordGroupMembers", {});
    await MessageActions.receiveMessage(
        channelId,
        await createMessage("", user.id, channelId, 2)
    );
}

// View user data
async function data(channelId: string) {
    const encryptcordGroupMembers = await DataStore.get(
        "encryptcordGroupMembers"
    );
    const encryptcordPublicKey = await DataStore.get("encryptcordPublicKey");
    const encryptcordPrivateKey = await DataStore.get("encryptcordPrivateKey");
    const exportedPrivateKey = await crypto.subtle.exportKey(
        "pkcs8",
        encryptcordPrivateKey
    );
    const groupMembers = Object.keys(encryptcordGroupMembers);
    sendBotMessage(channelId, {
        content: `## Public key:\n\`\`\`${encryptcordPublicKey}\`\`\`\n## Private key:\n||\`\`\`${formatPemKey(
            exportedPrivateKey,
            "private"
        )}\`\`\`||*(DO **NOT** SHARE THIS)*\n## Group members:\n\`\`\`json\n${JSON.stringify(
            groupMembers
        )}\`\`\``,
    });
}
