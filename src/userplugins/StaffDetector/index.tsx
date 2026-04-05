/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { ChannelStore, GuildStore, PermissionStore, PermissionsBits, UserStore, VoiceStateStore } from "@webpack/common";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";

const logger = new Logger("StaffDetector");

const settings = definePluginSettings({
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
    if (!guild) return false;

    // Se è l'owner del server, è sempre staff
    if (guild.ownerId === userId) {
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
        if (settings.store[setting as keyof typeof settings.store] &&
            PermissionStore.can(perm, guild, guildId, undefined, userId)) {
            return true;
        }
    }

    return false;
}

function checkVoiceChannelForStaff(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel || !channel.guild_id) return;

    const voiceStates = VoiceStateStore.getVoiceStatesForChannel(channelId);
    const myUserId = UserStore.getCurrentUser().id;
    const staffMembers: string[] = [];

    for (const userId of Object.keys(voiceStates)) {
        // Skip te stesso
        if (userId === myUserId) continue;

        if (isUserStaff(userId, channel.guild_id)) {
            staffMembers.push(userId);
        }
    }

    if (staffMembers.length > 0) {
        const staffNames = staffMembers.map(id => UserStore.getUser(id).username).join(", ");
        logger.info("Found staff in channel:", staffNames);
        showNotification({
            title: "Staff Alert",
            body: `Staff in VC: ${staffNames}`,
            onClick: () => {}
        });
    }
}

export default definePlugin({
    name: "StaffDetector",
    description: "Notifies you when staff members are in the same voice channel as you",
    authors: [{ name: "Irritably", id: 928787166916640838n }],
    settings,

    flux: {
        VOICE_CHANNEL_SELECT({ channelId }: { channelId: string | null; }) {
            if (!channelId) {
                logger.debug("Left voice channel");
                return;
            }

            const channel = ChannelStore.getChannel(channelId);
            if (!channel || !channel.isGuildVocal?.()) {
                logger.debug("Not a guild voice channel");
                return;
            }

            logger.debug("Joined voice channel:", channelId);

            // Aspetta un attimo che gli stati vocali si aggiornino
            setTimeout(() => {
                checkVoiceChannelForStaff(channelId);
            }, 500);
        }
    }
});
