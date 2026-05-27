/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { chooseFile } from "@utils/web";
import { findStoreLazy } from "@webpack";
import {
    Button,
    ChannelStore,
    GuildMemberStore,
    GuildRoleStore,
    GuildStore,
    IconUtils,
    PermissionsBits,
    React,
    Toasts,
    UserStore,
    VoiceStateStore,
} from "@webpack/common";

const SelectedChannelStore = findStoreLazy("SelectedChannelStore");
const PermissionStore = findStoreLazy("PermissionStore");
const logger = new Logger("StaffDetector");
const currentChannelStaff = new Set<string>();
const emptyIdSet = new Set<string>();
const idSetCache = new Map<string, Set<string>>();
let currentVoiceChannelId: string | null = null;

const DEFAULT_SOUND_URLS = {
    join: "https://github.com/zFrxncesck1/zFrxncesck1/raw/refs/heads/main/host/sounds/join.wav",
    leave: "https://github.com/zFrxncesck1/zFrxncesck1/raw/refs/heads/main/host/sounds/leave.wav",
};

const CUSTOM_DEFAULT_URLS = {
    join: "https://github.com/zFrxncesck1/zFrxncesck1/raw/refs/heads/main/host/sounds/trollface-smile.mp3",
    leave: "https://github.com/zFrxncesck1/zFrxncesck1/raw/refs/heads/main/host/sounds/death-note-light-yagami-is-sus.mp3",
};

type AudioDataKey = "customJoinSoundData" | "customLeaveSoundData";
type AudioNameKey = "customJoinSoundDataName" | "customLeaveSoundDataName";
type StaffPermissionSetting =
    | "adminPermission"
    | "manageGuildPermission"
    | "manageChannelsPermission"
    | "manageRolesPermission"
    | "manageNicknamesPermission"
    | "manageMessagesPermission"
    | "kickMembersPermission"
    | "banMembersPermission"
    | "moderateMembersPermission"
    | "moveMembersPermission"
    | "muteMembersPermission"
    | "deafenMembersPermission";
type PermissionBitName =
    | "ADMINISTRATOR"
    | "MANAGE_GUILD"
    | "MANAGE_CHANNELS"
    | "MANAGE_ROLES"
    | "MANAGE_NICKNAMES"
    | "MANAGE_MESSAGES"
    | "KICK_MEMBERS"
    | "BAN_MEMBERS"
    | "MODERATE_MEMBERS"
    | "MOVE_MEMBERS"
    | "MUTE_MEMBERS"
    | "DEAFEN_MEMBERS";

const audioNameKeys = {
    customJoinSoundData: "customJoinSoundDataName",
    customLeaveSoundData: "customLeaveSoundDataName",
} satisfies Record<AudioDataKey, AudioNameKey>;

const C = {
    notif: "#ef5350",
    sounds: "#42a5f5",
    server: "#66bb6a",
    user: "#ffa726",
    perms: "#ab47bc",
};

function SettingsSep({ title, color = "#9c67ff" }: { title: string; color?: string; }) {
    return (
        <div style={{ margin: "14px 0 2px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: 1, background: `${color}55` }} />
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px", color, whiteSpace: "nowrap" }}>{title}</span>
            <div style={{ flex: 1, height: 1, background: `${color}55` }} />
        </div>
    );
}

function readFileAsDataUri(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === "string") {
                resolve(reader.result);
                return;
            }

            reject(new Error("Selected file could not be read as audio data."));
        };
        reader.onerror = () => reject(reader.error ?? new Error("Selected file could not be read."));
        reader.readAsDataURL(file);
    });
}

function AudioUploadButton({ label, dataKey }: { label: string; dataKey: AudioDataKey; }) {
    const nameKey = audioNameKeys[dataKey];
    const [filename, setFilename] = React.useState<string>(() => {
        const data = settings.store[dataKey];
        return data ? (settings.store[nameKey] || "Uploaded") : "";
    });

    async function handleClick() {
        const file = await chooseFile("audio/*");
        if (!file) return;

        try {
            settings.store[dataKey] = await readFileAsDataUri(file);
            settings.store[nameKey] = file.name;
            setFilename(file.name);
        } catch (error) {
            Toasts.show({
                message: "Could not load that audio file.",
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE,
            });
            if (settings.store.enableLogs) logger.error("StaffDetector: audio upload failed:", error);
        }
    }

    function handleClear() {
        settings.store[dataKey] = "";
        settings.store[nameKey] = "";
        setFilename("");
    }

    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <Button
                color={Button.Colors.PRIMARY}
                size={Button.Sizes.SMALL}
                onClick={() => void handleClick()}
            >
                {label}
            </Button>
            {filename
                ? <>
                    <span style={{ fontSize: 11, color: "#9e9e9e", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{filename}</span>
                    <Button
                        color={Button.Colors.RED}
                        size={Button.Sizes.SMALL}
                        onClick={handleClear}
                    >
                        Clear
                    </Button>
                </>
                : <span style={{ fontSize: 11, color: "#5a4a6a" }}>No file uploaded</span>
            }
        </div>
    );
}

const settings = definePluginSettings({
    notifHeader: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <SettingsSep title="Notifications" color={C.notif} />,
    },
    showToasts: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "In-app toast alert on staff join/leave.",
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "OS-level desktop notification on staff event.",
    },
    notifyAlreadyInVc: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Alert + play join sound when staff are already present on VC join.",
    },
    enableLogs: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Print StaffDetector events to the DevTools console (Ctrl+Shift+I).",
    },

    soundsHeader: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <SettingsSep title="Sounds" color={C.sounds} />,
    },
    enableSounds: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Play audio alert on staff join/leave.",
    },
    soundVolume: {
        type: OptionType.SLIDER,
        default: 0.36,
        description: "Master volume for all StaffDetector sounds (0% - 100%).",
        markers: [0, 0.25, 0.5, 0.75, 1],
        stickToMarkers: false,
    },
    useCustomSounds: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "OFF - built-in WAV. ON - use uploaded file or URL below (uploaded file takes priority over URL).",
    },

    customJoinSoundData: {
        type: OptionType.STRING,
        default: "",
        description: "",
        hidden: true,
    },
    customJoinSoundDataName: {
        type: OptionType.STRING,
        default: "",
        description: "",
        hidden: true,
    },
    customJoinSound: {
        type: OptionType.STRING,
        default: "",
        description: "JOIN fallback URL (https://...) — used only if no file is uploaded above. Empty = built-in custom MP3.",
    },
    customJoinUpload: {
        type: OptionType.COMPONENT,
        description: "Upload JOIN sound (replaces previous upload).",
        component: () => <AudioUploadButton label="Upload JOIN Sound" dataKey="customJoinSoundData" />,
    },

    customLeaveSoundData: {
        type: OptionType.STRING,
        default: "",
        description: "",
        hidden: true,
    },
    customLeaveSoundDataName: {
        type: OptionType.STRING,
        default: "",
        description: "",
        hidden: true,
    },
    customLeaveSound: {
        type: OptionType.STRING,
        default: "",
        description: "LEAVE fallback URL (https://...) — used only if no file is uploaded above. Empty = built-in custom MP3.",
    },
    customLeaveUpload: {
        type: OptionType.COMPONENT,
        description: "Upload LEAVE sound (replaces previous upload).",
        component: () => <AudioUploadButton label="Upload LEAVE Sound" dataKey="customLeaveSoundData" />,
    },

    serverHeader: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <SettingsSep title="Server Filter" color={C.server} />,
    },
    serverFilterMode: {
        type: OptionType.SELECT,
        options: [
            { label: "All servers", value: "none", default: true },
            { label: "Include only listed servers", value: "include" },
            { label: "Exclude listed servers", value: "exclude" },
        ],
        description: "Which servers trigger StaffDetector alerts.",
    },
    serverIncludeIds: {
        type: OptionType.STRING,
        default: "",
        description: "Allowlist - alert ONLY in these guild IDs. Accepts one or more IDs separated by comma, space, or dash.",
    },
    serverExcludeIds: {
        type: OptionType.STRING,
        default: "",
        description: "Blocklist - never alert in these guild IDs. Accepts one or more IDs separated by comma, space, or dash. Overridden by User Include list.",
    },

    userHeader: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <SettingsSep title="User Filter" color={C.user} />,
    },
    userIncludeIds: {
        type: OptionType.STRING,
        default: "",
        description: "Track ONLY these user IDs (empty = all with matching perms). Overrides server filter and permission check — flagged even without staff permissions. Useful to track undercover staff alts. Accepts one or more IDs separated by comma, space, or dash.",
    },
    userExcludeIds: {
        type: OptionType.STRING,
        default: "",
        description: "Ignore these user IDs regardless of permissions. Accepts one or more IDs separated by comma, space, or dash.",
    },

    permsHeader: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <SettingsSep title="Detected Permissions" color={C.perms} />,
    },
    adminPermission: { type: OptionType.BOOLEAN, default: true, description: "Administrator" },
    manageGuildPermission: { type: OptionType.BOOLEAN, default: true, description: "Manage Server" },
    manageChannelsPermission: { type: OptionType.BOOLEAN, default: true, description: "Manage Channels" },
    manageRolesPermission: { type: OptionType.BOOLEAN, default: true, description: "Manage Roles" },
    manageNicknamesPermission: { type: OptionType.BOOLEAN, default: false, description: "Manage Nicknames" },
    manageMessagesPermission: { type: OptionType.BOOLEAN, default: true, description: "Manage Messages" },
    kickMembersPermission: { type: OptionType.BOOLEAN, default: true, description: "Kick Members" },
    banMembersPermission: { type: OptionType.BOOLEAN, default: true, description: "Ban Members" },
    moderateMembersPermission: { type: OptionType.BOOLEAN, default: true, description: "Timeout / Moderate Members" },
    moveMembersPermission: { type: OptionType.BOOLEAN, default: true, description: "Move Members" },
    muteMembersPermission: { type: OptionType.BOOLEAN, default: true, description: "Mute Members" },
    deafenMembersPermission: { type: OptionType.BOOLEAN, default: true, description: "Deafen Members" },
});

const permChecks = [
    ["adminPermission", "ADMINISTRATOR"],
    ["manageGuildPermission", "MANAGE_GUILD"],
    ["manageChannelsPermission", "MANAGE_CHANNELS"],
    ["manageRolesPermission", "MANAGE_ROLES"],
    ["manageNicknamesPermission", "MANAGE_NICKNAMES"],
    ["manageMessagesPermission", "MANAGE_MESSAGES"],
    ["kickMembersPermission", "KICK_MEMBERS"],
    ["banMembersPermission", "BAN_MEMBERS"],
    ["moderateMembersPermission", "MODERATE_MEMBERS"],
    ["moveMembersPermission", "MOVE_MEMBERS"],
    ["muteMembersPermission", "MUTE_MEMBERS"],
    ["deafenMembersPermission", "DEAFEN_MEMBERS"],
] satisfies Array<[StaffPermissionSetting, PermissionBitName]>;

function parseIdSet(raw: string): Set<string> {
    if (!raw) return emptyIdSet;

    const cached = idSetCache.get(raw);
    if (cached) return cached;

    const ids = new Set<string>();
    for (const match of raw.matchAll(/\d{5,}/g)) {
        ids.add(match[0]);
    }

    idSetCache.set(raw, ids);
    return ids;
}

function isUserExplicitlyIncluded(userId: string): boolean {
    const includedUsers = parseIdSet(settings.store.userIncludeIds);
    return includedUsers.size > 0 && includedUsers.has(userId);
}

function isServerAllowedForUser(guildId: string, userId: string): boolean {
    if (isUserExplicitlyIncluded(userId)) return true;
    const mode = settings.store.serverFilterMode;
    if (mode === "none") return true;
    if (mode === "include") {
        const includedServers = parseIdSet(settings.store.serverIncludeIds);
        return includedServers.size === 0 || includedServers.has(guildId);
    }
    if (mode === "exclude") {
        const excludedServers = parseIdSet(settings.store.serverExcludeIds);
        return excludedServers.size === 0 || !excludedServers.has(guildId);
    }
    return true;
}

function shouldFlag(userId: string, guildId: string): boolean {
    const excludedUsers = parseIdSet(settings.store.userExcludeIds);
    if (excludedUsers.size > 0 && excludedUsers.has(userId)) return false;
    if (isUserExplicitlyIncluded(userId)) return true;
    const includedUsers = parseIdSet(settings.store.userIncludeIds);
    if (includedUsers.size > 0 && !includedUsers.has(userId)) return false;
    return isUserStaff(userId, guildId);
}

function isUserStaff(userId: string, guildId: string): boolean {
    const guild = GuildStore.getGuild(guildId);
    if (!guild) return false;

    if (guild.ownerId === userId) return true;

    try {
        const computed: bigint | undefined = PermissionStore.getGuildPermissionsForUser?.(userId, guildId);
        if (computed !== undefined && computed !== null) {
            for (let i = 0; i < permChecks.length; i++) {
                const [key, permName] = permChecks[i];
                const perm = PermissionsBits[permName];
                if (settings.store[key] && (BigInt(computed) & perm) !== 0n) return true;
            }
            return false;
        }
    } catch (e) {
        if (settings.store.enableLogs) logger.warn("StaffDetector: PermissionStore error, using GuildRoleStore:", e);
    }

    const member = GuildMemberStore.getMember(guildId, userId);
    if (!member?.roles?.length) {
        if (settings.store.enableLogs) logger.info(`StaffDetector: no roles for ${userId} in ${guildId}`);
        return false;
    }

    const sortedRoles = GuildRoleStore.getSortedRoles(guildId);
    if (!sortedRoles || sortedRoles.length === 0) {
        if (settings.store.enableLogs) logger.info(`StaffDetector: GuildRoleStore empty for ${guildId}`);
        return false;
    }

    const userRoleIds = new Set(member.roles);

    for (let i = 0; i < permChecks.length; i++) {
        const [key, permName] = permChecks[i];
        if (!settings.store[key]) continue;

        const perm = PermissionsBits[permName];
        for (let j = 0; j < sortedRoles.length; j++) {
            const role = sortedRoles[j];
            if (!role || !role.id || !userRoleIds.has(role.id)) continue;

            const rolePerms = BigInt(role.permissions);
            if ((rolePerms & PermissionsBits.ADMINISTRATOR) !== 0n) return true;
            if ((rolePerms & perm) !== 0n) return true;
        }
    }

    return false;
}

function getUsername(userId: string): string {
    return UserStore.getUser(userId)?.username ?? userId;
}

function getAvatarUrl(userId: string): string {
    const user = UserStore.getUser(userId);
    if (!user) return IconUtils.getDefaultAvatarURL(userId);
    return IconUtils.getUserAvatarURL(user, false, 128) ?? IconUtils.getDefaultAvatarURL(userId);
}

function logVoiceChannelDetails(channelId: string): void {
    if (!settings.store.enableLogs) return;

    const channel = ChannelStore.getChannel(channelId);
    if (!channel?.guild_id) return;

    const guild = GuildStore.getGuild(channel.guild_id);
    if (!guild) return;

    const voiceStates = VoiceStateStore.getVoiceStatesForChannel(channelId);
    if (!voiceStates) {
        logger.info(`📋 Voice Channel: ${channel.name || channelId}`);
        logger.info(`   Guild: ${guild.name} (${guild.id})`);
        logger.info("   No users in voice channel");
        return;
    }

    const userIds = Object.keys(voiceStates);
    const myUserId = UserStore.getCurrentUser()?.id;

    logger.info("════════════════════════════════════════");
    logger.info(`   Voice Channel: ${channel.name || channelId}`);
    logger.info(`   Guild: ${guild.name} (${guild.id})`);
    logger.info(`   Users in voice: ${userIds.length}`);
    logger.info("════════════════════════════════════════");

    for (let i = 0; i < userIds.length; i++) {
        const userId = userIds[i];
        const user = UserStore.getUser(userId);
        const username = user?.username ?? userId;
        const discriminator = user?.discriminator ?? "0";
        const isMe = userId === myUserId;

        logger.info("");
        logger.info(`👤 User ${i + 1}: ${username}#${discriminator}${isMe ? " (YOU)" : ""}`);
        logger.info(`   ID: ${userId}`);

        const member = GuildMemberStore.getMember(channel.guild_id, userId);
        const nickname = member?.nick;
        if (nickname) {
            logger.info(`   Nickname: ${nickname}`);
        }

        if (guild.ownerId === userId) {
            logger.info("   ⭐ Server Owner");
        }

        if (member?.roles && member.roles.length > 0) {
            logger.info(`   Roles (${member.roles.length}):`);
            for (let j = 0; j < member.roles.length; j++) {
                const roleId = member.roles[j];
                const role = GuildRoleStore.getRole(channel.guild_id, roleId);
                if (role) {
                    const rolePerms = BigInt(role.permissions);
                    const isAdmin = (rolePerms & PermissionsBits.ADMINISTRATOR) !== 0n;
                    logger.info(`     - ${role.name}${isAdmin ? " ⚠️ [ADMIN]" : ""} (${roleId})`);
                } else {
                    logger.info(`     - Unknown Role (${roleId})`);
                }
            }
        } else {
            logger.info("   Roles: None (or @everyone only)");
        }

        logUserPermissions(userId, channel.guild_id);

        logger.info("────────────────────────────────────");
    }

    logger.info("");
    logger.info(" End of voice channel user list");
    logger.info("════════════════════════════════════════");
}

function logUserPermissions(userId: string, guildId: string): void {
    try {
        const memberData = GuildMemberStore.getMember(guildId, userId);
        if (!memberData || !memberData.roles || memberData.roles.length === 0) {
            logger.info("   User has no roles");
            return;
        }

        const sortedRoles = GuildRoleStore.getSortedRoles(guildId);
        if (!sortedRoles || sortedRoles.length === 0) {
            logger.info("   No roles available in GuildRoleStore");
            return;
        }

        const userPerms = new Set<string>();
        const userRoleIds = new Set(memberData.roles);

        for (let j = 0; j < sortedRoles.length; j++) {
            const role = sortedRoles[j];
            if (!role || !role.id || !userRoleIds.has(role.id)) continue;

            const rolePerms = BigInt(role.permissions);
            extractPermissions(rolePerms, userPerms);
        }

        if (userPerms.size > 0) {
            logger.info("   Permissions:");
            logPermissions(userPerms);
        } else {
            logger.info("   No special permissions found");
        }
    } catch (e) {
        logger.info(`   Error retrieving permissions: ${e}`);
    }
}

function extractPermissions(rolePerms: bigint, userPerms: Set<string>): void {
    if ((rolePerms & PermissionsBits.ADMINISTRATOR) !== 0n) userPerms.add("Administrator");
    if ((rolePerms & PermissionsBits.MANAGE_GUILD) !== 0n) userPerms.add("Manage Server");
    if ((rolePerms & PermissionsBits.MANAGE_CHANNELS) !== 0n) userPerms.add("Manage Channels");
    if ((rolePerms & PermissionsBits.MANAGE_ROLES) !== 0n) userPerms.add("Manage Roles");
    if ((rolePerms & PermissionsBits.MANAGE_NICKNAMES) !== 0n) userPerms.add("Manage Nicknames");
    if ((rolePerms & PermissionsBits.CHANGE_NICKNAME) !== 0n) userPerms.add("Change Nickname");
    if ((rolePerms & PermissionsBits.MANAGE_MESSAGES) !== 0n) userPerms.add("Manage Messages");
    if ((rolePerms & PermissionsBits.KICK_MEMBERS) !== 0n) userPerms.add("Kick Members");
    if ((rolePerms & PermissionsBits.BAN_MEMBERS) !== 0n) userPerms.add("Ban Members");
    if ((rolePerms & PermissionsBits.MODERATE_MEMBERS) !== 0n) userPerms.add("Timeout Members");
    if ((rolePerms & PermissionsBits.MUTE_MEMBERS) !== 0n) userPerms.add("Mute Members");
    if ((rolePerms & PermissionsBits.DEAFEN_MEMBERS) !== 0n) userPerms.add("Deafen Members");
    if ((rolePerms & PermissionsBits.MOVE_MEMBERS) !== 0n) userPerms.add("Move Members");
    if ((rolePerms & PermissionsBits.MANAGE_WEBHOOKS) !== 0n) userPerms.add("Manage Webhooks");
    if ((rolePerms & PermissionsBits.MANAGE_GUILD_EXPRESSIONS) !== 0n) userPerms.add("Manage Emojis");
}

function logPermissions(userPerms: Set<string>): void {
    for (const perm of userPerms) {
        const isCritical = perm === "Administrator" || perm === "Manage Server" ||
            perm === "Manage Roles" || perm === "Kick Members" ||
            perm === "Ban Members" || perm === "Timeout Members" ||
            perm === "Manage Nicknames";
        logger.info(`     ✓ ${perm}${isCritical ? " ⚠️" : ""}`);
    }
}

function getChannelContext(channelId: string): string {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return "";
    const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
    if (channel.name && guild?.name) return `#${channel.name} - ${guild.name}`;
    if (channel.name) return `#${channel.name}`;
    return "";
}

function notify(title: string, body: string, icon?: string): void {
    if (settings.store.showToasts)
        Toasts.show({ message: `${title}  ${body}`, id: Toasts.genId(), type: Toasts.Type.MESSAGE });
    if (settings.store.showNotifications)
        showNotification({ title, body, icon, permanent: false, onClick: () => { } });
}

function playSrc(src: string): void {
    const audio = new Audio(src);
    audio.volume = Math.min(1, Math.max(0, settings.store.soundVolume ?? 0.36));
    audio.play().catch(e => {
        if (settings.store.enableLogs) logger.error("StaffDetector: playSrc error:", e);
    });
}

function playStaffSound(isJoin: boolean): void {
    if (!settings.store.enableSounds) return;
    if (settings.store.useCustomSounds) {
        const dataUri = isJoin ? settings.store.customJoinSoundData : settings.store.customLeaveSoundData;
        if (dataUri) { playSrc(dataUri); return; }
        const url = (isJoin ? settings.store.customJoinSound : settings.store.customLeaveSound)?.trim();
        if (url) { playSrc(url); return; }
        playSrc(isJoin ? CUSTOM_DEFAULT_URLS.join : CUSTOM_DEFAULT_URLS.leave);
        return;
    }
    playSrc(isJoin ? DEFAULT_SOUND_URLS.join : DEFAULT_SOUND_URLS.leave);
}

function scanChannelStaff(channelId: string, isInit: boolean): void {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel?.guild_id) return;

    const myUserId = UserStore.getCurrentUser()?.id;
    if (!myUserId) return;

    const voiceStates = VoiceStateStore.getVoiceStatesForChannel(channelId);
    if (!voiceStates) return;

    const userIds = Object.keys(voiceStates);
    if (!userIds.length) return;

    if (isInit) {
        currentChannelStaff.clear();
        const staffFound: string[] = [];
        for (let i = 0; i < userIds.length; i++) {
            const uid = userIds[i];
            if (uid === myUserId) continue;
            if (!isServerAllowedForUser(channel.guild_id, uid)) continue;
            if (shouldFlag(uid, channel.guild_id)) {
                currentChannelStaff.add(uid);
                staffFound.push(uid);
            }
        }
        if (!staffFound.length || !settings.store.notifyAlreadyInVc) return;
        const ctx = getChannelContext(channelId);
        playStaffSound(true);
        if (staffFound.length === 1) {
            const name = getUsername(staffFound[0]);
            if (settings.store.enableLogs) logger.info(`StaffDetector: "${name}" already in VC - ${ctx}`);
            notify("⚠️ StaffDetector:", `"${name}" already here - ${ctx}`, getAvatarUrl(staffFound[0]));
        } else {
            const names = staffFound.map(id => `"${getUsername(id)}"`).join(", ");
            if (settings.store.enableLogs) logger.info(`StaffDetector: ${staffFound.length} staff already in VC - ${ctx}`);
            notify("⚠️ StaffDetector:", `${staffFound.length} staff: ${names} - ${ctx}`, getAvatarUrl(staffFound[0]));
        }
    }
}

export default definePlugin({
    name: "StaffDetector",
    description: "Alerts (toast/notification + sound) when staff join or leave your VC.",
    tags: ["Servers", "Utility"],
    authors: [
        { name: "Irritably", id: 928787166916640838n },
        { name: "zFrxncesck1", id: 456195985404592149n },
    ],
    settings,

    start() {
        const vcId: string | null = SelectedChannelStore.getVoiceChannelId?.() ?? null;
        currentVoiceChannelId = vcId;
        if (vcId) scanChannelStaff(vcId, true);
    },

    flux: {
        VOICE_CHANNEL_SELECT({ channelId }: { channelId: string | null; }) {
            if (channelId === currentVoiceChannelId) return;
            currentVoiceChannelId = channelId;
            currentChannelStaff.clear();
            if (!channelId) return;
            const channel = ChannelStore.getChannel(channelId);
            if (!channel?.guild_id) return;
            if (settings.store.enableLogs) {
                logger.debug(`StaffDetector: joined VC ${channelId}`);
                logVoiceChannelDetails(channelId);
            }
            scanChannelStaff(channelId, true);
        },

        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: Array<{ userId: string; channelId?: string; oldChannelId?: string; guildId?: string; }>; }) {
            const currentChannelId: string | null = SelectedChannelStore.getVoiceChannelId?.() ?? null;
            if (!currentChannelId) return;

            const channel = ChannelStore.getChannel(currentChannelId);
            if (!channel?.guild_id) return;

            const myUserId = UserStore.getCurrentUser()?.id;
            if (!myUserId) return;

            for (let i = 0; i < voiceStates.length; i++) {
                const { userId, channelId, oldChannelId } = voiceStates[i];
                if (userId === myUserId) continue;
                if (!isServerAllowedForUser(channel.guild_id, userId)) continue;

                const entered = channelId === currentChannelId && oldChannelId !== currentChannelId;

                if (entered) {
                    if (!shouldFlag(userId, channel.guild_id)) continue;
                    currentChannelStaff.add(userId);
                    const name = getUsername(userId);
                    const ctx = getChannelContext(currentChannelId);
                    if (settings.store.enableLogs) logger.info(`StaffDetector: "${name}" joined - ${ctx}`);
                    playStaffSound(true);
                    notify("🚨 StaffDetector:", `"${name}" joined - ${ctx}`, getAvatarUrl(userId));
                    continue;
                }

                const left = oldChannelId === currentChannelId && channelId !== currentChannelId;
                if (left && currentChannelStaff.has(userId)) {
                    currentChannelStaff.delete(userId);
                    const name = getUsername(userId);
                    const ctx = getChannelContext(currentChannelId);
                    const remaining = currentChannelStaff.size;
                    const suffix = remaining > 0 ? ` - ${remaining} staff remaining` : " - No staff remaining";
                    if (settings.store.enableLogs) logger.info(`StaffDetector: "${name}" left - ${ctx} (${remaining} remaining)`);
                    playStaffSound(false);
                    notify("✅ StaffDetector:", `"${name}" left - ${ctx}${suffix}`, getAvatarUrl(userId));
                }
            }
        },
    },

    stop() {
        currentChannelStaff.clear();
        currentVoiceChannelId = null;
    },
});
