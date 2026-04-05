/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { ChannelStore, GuildMemberStore, GuildStore, PermissionStore, PermissionsBits, UserStore, VoiceStateStore } from "@webpack/common";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";

const logger = new Logger("StaffDetector");

interface VoiceStateData {
    channelId: string;
    userId: string;
}

let lastVoiceState: Record<string, VoiceStateData> = {};

const { selectVoiceChannel } = findByPropsLazy("selectVoiceChannel", "selectChannel");

const settings = definePluginSettings({
    notifyStaffJoin: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Send a notification when a staff member joins a voice channel."
    },
    notifyStaffLeave: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Send a notification when a staff member leaves a voice channel."
    },
    adminPermission: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Notify for users with Administrator permission"
    },
    manageGuildPermission: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Notify for users with Manage Server permission"
    },
    manageChannelsPermission: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Notify for users with Manage Channels permission"
    },
    manageRolesPermission: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Notify for users with Manage Roles permission"
    },
    manageMessagesPermission: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Notify for users with Manage Messages permission"
    },
    kickMembersPermission: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Notify for users with Kick Members permission"
    },
    banMembersPermission: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Notify for users with Ban Members permission"
    },
    moderateMembersPermission: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Notify for users with Timeout permission"
    },
    moveMembersPermission: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Notify for users with Move Members permission"
    },
    muteMembersPermission: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Notify for users with Mute Members permission"
    },
    deafenMembersPermission: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Notify for users with Deafen Members permission"
    }
});

function isUserStaff(userId: string, guildId: string): boolean {
    const guild = GuildStore.getGuild(guildId);
    if (!guild) {
        logger.debug("No guild found for guildId:", guildId);
        return false;
    }

    // Se è l'owner del server, è sempre staff
    if (guild.ownerId === userId) {
        logger.debug("User is guild owner");
        return true;
    }

    const checks = [
        { setting: "adminPermission", perm: PermissionsBits.ADMINISTRATOR },
        { setting: "manageGuildPermission", perm: PermissionsBits.MANAGE_GUILD },
        { setting: "manageChannelsPermission", perm: PermissionsBits.MANAGE_CHANNELS },
        { setting: "manageRolesPermission", perm: PermissionsBits.MANAGE_ROLES },
        { setting: "manageMessagesPermission", perm: PermissionsBits.MANAGE_MESSAGES },
        { setting: "kickMembersPermission", perm: PermissionsBits.KICK_MEMBERS },
        { setting: "banMembersPermission", perm: PermissionsBits.BAN_MEMBERS },
        { setting: "moderateMembersPermission", perm: PermissionsBits.MODERATE_MEMBERS },
        { setting: "moveMembersPermission", perm: PermissionsBits.MOVE_MEMBERS },
        { setting: "muteMembersPermission", perm: PermissionsBits.MUTE_MEMBERS },
        { setting: "deafenMembersPermission", perm: PermissionsBits.DEAFEN_MEMBERS }
    ];

    for (const { setting, perm } of checks) {
        if (settings.store[setting as keyof typeof settings.store]) {
            const hasPerm = PermissionStore.can(perm, guild, guildId, undefined, userId);
            if (hasPerm) {
                logger.debug(`User ${userId} has permission`, setting);
                return true;
            }
        }
    }

    logger.debug("User is not staff");
    return false;
}

function getChannelName(channelId: string): string {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return "Unknown channel";

    if (channel.isGuildVoice() || channel.isGuildStageVoice()) {
        const guild = GuildStore.getGuild(channel.guild_id);
        return `${channel.name} from ${guild?.name ?? "Unknown server"}`;
    }

    return channel.name ?? "Unknown channel";
}

function voiceStateChange() {
    const newVoiceState: Record<string, VoiceStateData> = {};
    const allVoiceStates = VoiceStateStore.getVoiceStates();

    logger.debug("Voice state change detected, total states:", Object.keys(allVoiceStates).length);

    for (const state of Object.values(allVoiceStates)) {
        const { userId, channelId } = state as any;
        if (!userId || !channelId) continue;

        newVoiceState[userId] = { channelId, userId };

        const lastState = lastVoiceState[userId];
        const joinedVoice = !lastState && channelId;
        const leftVoice = lastState && !channelId;
        const switchedChannel = lastState && channelId && lastState.channelId !== channelId;

        if (joinedVoice || switchedChannel) {
            logger.debug(`User ${userId} joined/switched to channel ${channelId}`);
            
            const channel = ChannelStore.getChannel(channelId);
            if (!channel || !channel.guild_id) {
                logger.debug("No channel or guild_id found");
                continue;
            }

            logger.debug("Checking if user is staff in guild:", channel.guild_id);
            if (!isUserStaff(userId, channel.guild_id)) {
                logger.debug("User is not staff, skipping");
                continue;
            }
            
            if (!settings.store.notifyStaffJoin) {
                logger.debug("Staff join notifications disabled");
                continue;
            }

            const user = UserStore.getUser(userId);
            const channelName = getChannelName(channelId);

            logger.info("Showing notification for staff join:", user.username);
            showNotification({
                title: "Staff Alert",
                body: `${user.username} joined VC: ${channelName}\nClick to join them.`,
                icon: user.getAvatarURL(),
                color: `#${user.accentColor?.toString(16).padStart(6, "0")}`,
                onClick: () => selectVoiceChannel(channelId)
            });
        }

        if (leftVoice) {
            logger.debug(`User ${userId} left channel ${lastState.channelId}`);
            
            const channel = ChannelStore.getChannel(lastState.channelId);
            if (!channel || !channel.guild_id) {
                logger.debug("No channel or guild_id found for leave");
                continue;
            }

            if (!isUserStaff(userId, channel.guild_id)) {
                logger.debug("User is not staff on leave, skipping");
                continue;
            }
            
            if (!settings.store.notifyStaffLeave) {
                logger.debug("Staff leave notifications disabled");
                continue;
            }

            const user = UserStore.getUser(userId);
            const channelName = getChannelName(lastState.channelId);

            logger.info("Showing notification for staff leave:", user.username);
            showNotification({
                title: "Staff Alert",
                body: `${user.username} left VC: ${channelName}`,
                icon: user.getAvatarURL(),
                color: `#${user.accentColor?.toString(16).padStart(6, "0")}`
            });
        }
    }

    lastVoiceState = newVoiceState;
}

export default definePlugin({
    name: "StaffDetector",
    description: "Notifies you when staff members join or leave voice channels based on their permissions",
	authors: [{ name: "Irritably", id: 928787166916640838n }],
    settings,

    start() {
        const initialState: Record<string, VoiceStateData> = {};
        const allVoiceStates = VoiceStateStore.getVoiceStates();

        for (const state of Object.values(allVoiceStates)) {
            const { userId, channelId } = state as any;
            if (userId && channelId) {
                initialState[userId] = { channelId, userId };
            }
        }

        lastVoiceState = initialState;
        logger.info("StaffDetector started, tracking", Object.keys(initialState).length, "users in voice");
    },

    stop() {
        lastVoiceState = {};
        logger.info("StaffDetector stopped");
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: any[]; }) {
            logger.debug("VOICE_STATE_UPDATES event received with", voiceStates.length, "states");
            
            const newVoiceState: Record<string, VoiceStateData> = {};
            const allVoiceStates = VoiceStateStore.getVoiceStates();

            // Costruisci il nuovo stato completo
            for (const state of Object.values(allVoiceStates)) {
                const { userId, channelId } = state as any;
                if (userId && channelId) {
                    newVoiceState[userId] = { channelId, userId };
                }
            }

            // Controlla i cambiamenti
            for (const state of voiceStates) {
                const { userId, channelId } = state;
                if (!userId) continue;

                const lastState = lastVoiceState[userId];
                const joinedVoice = !lastState && channelId;
                const leftVoice = lastState && !channelId;
                const switchedChannel = lastState && channelId && lastState.channelId !== channelId;

                if (joinedVoice || switchedChannel) {
                    logger.debug(`User ${userId} joined/switched to channel ${channelId}`);
                    
                    const channel = ChannelStore.getChannel(channelId);
                    if (!channel || !channel.guild_id) {
                        logger.debug("No channel or guild_id found");
                        continue;
                    }

                    logger.debug("Checking if user is staff in guild:", channel.guild_id);
                    if (!isUserStaff(userId, channel.guild_id)) {
                        logger.debug("User is not staff, skipping");
                        continue;
                    }
                    
                    if (!settings.store.notifyStaffJoin) {
                        logger.debug("Staff join notifications disabled");
                        continue;
                    }

                    const user = UserStore.getUser(userId);
                    const channelName = getChannelName(channelId);

                    logger.info("Showing notification for staff join:", user.username);
                    showNotification({
                        title: "Staff Alert",
                        body: `${user.username} joined VC: ${channelName}\nClick to join them.`,
                        icon: user.getAvatarURL(),
                        onClick: () => selectVoiceChannel(channelId)
                    });
                }

                if (leftVoice) {
                    logger.debug(`User ${userId} left channel ${lastState.channelId}`);
                    
                    const channel = ChannelStore.getChannel(lastState.channelId);
                    if (!channel || !channel.guild_id) {
                        logger.debug("No channel or guild_id found for leave");
                        continue;
                    }

                    if (!isUserStaff(userId, channel.guild_id)) {
                        logger.debug("User is not staff on leave, skipping");
                        continue;
                    }
                    
                    if (!settings.store.notifyStaffLeave) {
                        logger.debug("Staff leave notifications disabled");
                        continue;
                    }

                    const user = UserStore.getUser(userId);
                    const channelName = getChannelName(lastState.channelId);

                    logger.info("Showing notification for staff leave:", user.username);
                    showNotification({
                        title: "Staff Alert",
                        body: `${user.username} left VC: ${channelName}`,
                        icon: user.getAvatarURL()
                    });
                }
            }

            lastVoiceState = newVoiceState;
        }
    }
});
