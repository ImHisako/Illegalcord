/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, GuildMemberStore, GuildStore, PermissionsBits, PermissionStore, UserStore, VoiceStateStore } from "@webpack/common";

interface VoiceStateData {
    channelId: string;
    guildId: string;
}

let lastVoiceStates: Record<string, VoiceStateData> = {};

const STAFF_PERMISSIONS = [
    PermissionsBits.ADMINISTRATOR,
    PermissionsBits.MANAGE_GUILD,
    PermissionsBits.MANAGE_ROLES,
    PermissionsBits.MANAGE_CHANNELS,
    PermissionsBits.KICK_MEMBERS,
    PermissionsBits.BAN_MEMBERS,
    PermissionsBits.MANAGE_MESSAGES,
    PermissionsBits.MUTE_MEMBERS,
    PermissionsBits.DEAFEN_MEMBERS,
    PermissionsBits.MOVE_MEMBERS,
    PermissionsBits.MODERATE_MEMBERS,
];

function hasStaffPermissions(userId: string, guildId: string): boolean {
    const member = GuildMemberStore.getMember(guildId, userId);
    if (!member) return false;

    const guild = GuildStore.getGuild(guildId);
    if (!guild) return false;

    for (const roleId of member.roles) {
        const role = guild.roles[roleId];
        if (!role) continue;

        const permissions = BigInt(role.permissions);
        
        for (const staffPerm of STAFF_PERMISSIONS) {
            if ((permissions & BigInt(staffPerm)) !== 0n) {
                return true;
            }
        }
    }

    return false;
}

function getHighestStaffRole(userId: string, guildId: string): string | null {
    const member = GuildMemberStore.getMember(guildId, userId);
    if (!member) return null;

    const guild = GuildStore.getGuild(guildId);
    if (!guild) return null;

    let highestRole: string | null = null;
    let highestPosition = -1;

    for (const roleId of member.roles) {
        const role = guild.roles[roleId];
        if (!role) continue;

        const permissions = BigInt(role.permissions);
        const hasStaffPerm = STAFF_PERMISSIONS.some(perm => 
            (permissions & BigInt(perm)) !== 0n
        );

        if (hasStaffPerm && role.position > highestPosition) {
            highestPosition = role.position;
            highestRole = role.name;
        }
    }

    return highestRole;
}

export default definePlugin({
    name: "StaffVoiceAlert",
    description: "Notifies you when someone with staff permissions joins your voice channel",
    authors: [
        { name: "Illegalcord", id: 0n }
    ],

    settings: definePluginSettings({
        notifyOnJoin: {
            type: OptionType.BOOLEAN,
            description: "Send notification when staff joins your voice channel",
            default: true,
        },
        notifyOnLeave: {
            type: OptionType.BOOLEAN,
            description: "Send notification when staff leaves your voice channel",
            default: false,
        },
        includeModeratorRoles: {
            type: OptionType.BOOLEAN,
            description: "Include users with only message moderation permissions",
            default: true,
        },
        soundEnabled: {
            type: OptionType.BOOLEAN,
            description: "Play sound with notification",
            default: true,
        },
        showRoleName: {
            type: OptionType.BOOLEAN,
            description: "Show the staff role name in notification",
            default: true,
        },
    }),

    start() {
        const myUserId = UserStore.getCurrentUser().id;
        const myVoiceState = VoiceStateStore.getVoiceStateForUser(myUserId);
        
        if (myVoiceState) {
            lastVoiceStates[myUserId] = {
                channelId: myVoiceState.channelId,
                guildId: myVoiceState.guildId,
            };
        }

        VoiceStateStore.addChangeListener(this.handleVoiceStateChange);
    },

    stop() {
        VoiceStateStore.removeChangeListener(this.handleVoiceStateChange);
        lastVoiceStates = {};
    },

    handleVoiceStateChange: () => {
        const myUserId = UserStore.getCurrentUser().id;
        const myCurrentVoiceState = VoiceStateStore.getVoiceStateForUser(myUserId);

        if (!myCurrentVoiceState) {
            lastVoiceStates = {};
            return;
        }

        const currentChannelId = myCurrentVoiceState.channelId;
        const currentGuildId = myCurrentVoiceState.guildId;

        const previousUsersInChannel = Object.entries(lastVoiceStates)
            .filter(([_, state]) => state.channelId === currentChannelId)
            .map(([userId]) => userId);

        const currentUsersInChannel = VoiceStateStore.getVoiceStatesForChannel(currentChannelId)
            ? Object.keys(VoiceStateStore.getVoiceStatesForChannel(currentChannelId))
            : [];

        const joinedUsers = currentUsersInChannel.filter(userId => 
            !previousUsersInChannel.includes(userId) && userId !== myUserId
        );

        const leftUsers = previousUsersInChannel.filter(userId => 
            !currentUsersInChannel.includes(userId) && userId !== myUserId
        );

        for (const userId of joinedUsers) {
            if (!settings.store.notifyOnJoin) continue;

            if (hasStaffPermissions(userId, currentGuildId)) {
                const user = UserStore.getUser(userId);
                const channel = ChannelStore.getChannel(currentChannelId);
                const guild = GuildStore.getGuild(currentGuildId);
                const roleName = settings.store.showRoleName 
                    ? getHighestStaffRole(userId, currentGuildId)
                    : null;

                const title = "Staff Member Joined VC";
                const body = `${user.username}${roleName ? ` (${roleName})` : ""} joined ${channel?.name ?? "voice channel"}${guild ? ` in ${guild.name}` : ""}`;

                showNotification({
                    title,
                    body,
                    icon: user.getAvatarURL(),
                    color: "#f5a623",
                    sound: settings.store.soundEnabled,
                });
            }
        }

        for (const userId of leftUsers) {
            if (!settings.store.notifyOnLeave) continue;

            if (hasStaffPermissions(userId, currentGuildId)) {
                const user = UserStore.getUser(userId);
                const channel = ChannelStore.getChannel(currentChannelId);
                const guild = GuildStore.getGuild(currentGuildId);
                const roleName = settings.store.showRoleName 
                    ? getHighestStaffRole(userId, currentGuildId)
                    : null;

                const title = "Staff Member Left VC";
                const body = `${user.username}${roleName ? ` (${roleName})` : ""} left ${channel?.name ?? "voice channel"}${guild ? ` in ${guild.name}` : ""}`;

                showNotification({
                    title,
                    body,
                    icon: user.getAvatarURL(),
                    color: "#95a5a6",
                    sound: settings.store.soundEnabled,
                });
            }
        }

        const newVoiceStates: Record<string, VoiceStateData> = {};
        for (const userId of currentUsersInChannel) {
            const voiceState = VoiceStateStore.getVoiceStateForUser(userId);
            if (voiceState) {
                newVoiceStates[userId] = {
                    channelId: voiceState.channelId,
                    guildId: voiceState.guildId,
                };
            }
        }

        lastVoiceStates = newVoiceStates;
    },
});