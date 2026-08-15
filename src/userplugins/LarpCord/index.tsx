/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { HeaderBarButton } from "@api/HeaderBar";
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { fetchUserProfile } from "@utils/discord";
import { parseUrl } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import type { ProfileEffect, RenderModalProps, User } from "@vencord/discord-types";
import { AuthenticationStore, Constants, FluxDispatcher, IconUtils, Menu, Modal, openModal, React, RestAPI, Select, SettingsRouter, SnowflakeUtils, Toasts, UserProfileStore, UserStore } from "@webpack/common";

const ICON_SETTING_KEYS: "showIcon"[] = ["showIcon"];

const settings = definePluginSettings({
    hideFromToolbox: {
        type: OptionType.BOOLEAN,
        description: "Hide this plugin from Equicord Toolbox.",
        default: true
    },
    showIcon: {
        type: OptionType.BOOLEAN,
        description: "Show the LarpCord icon in the header bar.",
        default: true
    }
});

function t(value: string) {
    return value;
}

const DS_KEY = "customProfile_data";
const DS_ENABLED = "customProfile_enabled";

const FLAG = {
    STAFF: 1,
    PARTNER: 2,
    HYPESQUAD: 4,
    BUG_HUNTER_1: 8,
    BRAVERY: 64,
    BRILLIANCE: 128,
    BALANCE: 256,
    EARLY_SUPPORTER: 512,
    BUG_HUNTER_2: 16384,
    DEV_VERIFIED: 131072,
    MOD_ALUMNI: 262144,
    ACTIVE_DEVELOPER: 4194304,
};

const BADGES = [
    { id: "staff", label: t("Discord Staff"), flag: FLAG.STAFF, icon: "https://cdn.discordapp.com/badge-icons/5e74e9b61934fc1f67c65515d1f7e60d.png", link: "https://discord.com/company" },
    { id: "partner", label: t("Partnered Server Owner"), flag: FLAG.PARTNER, icon: "https://cdn.discordapp.com/badge-icons/3f9748e53446a137a052f3454e2de41e.png", link: "https://discord.com/partners" },
    { id: "hypesquad", label: t("HypeSquad Events"), flag: FLAG.HYPESQUAD, icon: "https://cdn.discordapp.com/badge-icons/bf01d1073931f921909045f3a39fd264.png", link: "https://discord.com/hypesquad" },
    { id: "bug_hunter_level_1", label: t("Discord Bug Hunter"), flag: FLAG.BUG_HUNTER_1, icon: "https://cdn.discordapp.com/badge-icons/2717692c7dca7289b35297368a940dd0.png", link: "https://support.discord.com/hc/articles/360046057772" },
    { id: "hypesquad_house_1", label: t("HypeSquad Bravery"), flag: FLAG.BRAVERY, icon: "https://cdn.discordapp.com/badge-icons/8a88d63823d8a71cd5e390baa45efa02.png", link: "https://discord.com/settings/hypesquad-online" },
    { id: "hypesquad_house_2", label: t("HypeSquad Brilliance"), flag: FLAG.BRILLIANCE, icon: "https://cdn.discordapp.com/badge-icons/011940fd013da3f7fb926e4a1cd2e618.png", link: "https://discord.com/settings/hypesquad-online" },
    { id: "hypesquad_house_3", label: t("HypeSquad Balance"), flag: FLAG.BALANCE, icon: "https://cdn.discordapp.com/badge-icons/3aa41de486fa12454c3761e8e223442e.png", link: "https://discord.com/settings/hypesquad-online" },
    { id: "early_supporter", label: t("Early Supporter"), flag: FLAG.EARLY_SUPPORTER, icon: "https://cdn.discordapp.com/badge-icons/7060786766c9c840eb3019e725d2b358.png", link: "https://discord.com/settings/premium" },
    { id: "certified_moderator", label: t("Moderator Programs Alumni"), flag: FLAG.MOD_ALUMNI, icon: "https://cdn.discordapp.com/badge-icons/fee1624003e2fee35cb398e125dc479b.png", link: "https://discord.com/safety" },
    { id: "bug_hunter_level_2", label: t("Discord Bug Hunter Gold"), flag: FLAG.BUG_HUNTER_2, icon: "https://cdn.discordapp.com/badge-icons/848f79194d4be5ff5f81505cbd0ce1e6.png", link: "https://support.discord.com/hc/articles/360046057772" },
    { id: "verified_developer", label: t("Early Verified Bot Developer"), flag: FLAG.DEV_VERIFIED, icon: "https://cdn.discordapp.com/badge-icons/6df5892e0f35b051f8b61eace34f4967.png", link: "https://discord.com/developers" },
    { id: "active_developer", label: t("Active Developer"), flag: FLAG.ACTIVE_DEVELOPER, icon: "https://cdn.discordapp.com/badge-icons/6bdc42827a38498929a4920da12695d9.png", link: "https://support-dev.discord.com/hc/articles/10113997751447" },
];

const NITRO_LEVELS = [
    { label: t("Nitro (0 months)"), icon: "https://cdn.discordapp.com/badge-icons/2ba85e8026a8614b640c2837bcdfe21b.png" },
    { label: t("Bronze (1 month)"), icon: "https://cdn.discordapp.com/badge-icons/4f33c4a9c64ce221936bd256c356f91f.png" },
    { label: t("Silver (2 months)"), icon: "https://cdn.discordapp.com/badge-icons/4514fab914bdbfb4ad2fa23df76121a6.png" },
    { label: t("Gold (3 months)"), icon: "https://cdn.discordapp.com/badge-icons/2895086c18d5531d499862e41d1155a6.png" },
    { label: t("Platinum (6 months)"), icon: "https://cdn.discordapp.com/badge-icons/0334688279c8359120922938dcb1d6f8.png" },
    { label: t("Diamond (12 months)"), icon: "https://cdn.discordapp.com/badge-icons/0d61871f72bb9a33a7ae568c1fb4f20a.png" },
    { label: t("Emerald (24 months)"), icon: "https://cdn.discordapp.com/badge-icons/11e2d339068b55d3a506cff34d3780f3.png" },
    { label: t("Ruby (36 months)"), icon: "https://cdn.discordapp.com/badge-icons/cd5e2cfd9d7f27a8cdcd3e8a8d5dc9f4.png" },
    { label: t("Opal (72 months)"), icon: "https://cdn.discordapp.com/badge-icons/5b154df19c53dce2af92c9b61e6be5e2.png" },
];

const BOOST_LABELS_RAW = [
    "1 Month", "2 Months", "3 Months", "6 Months",
    "9 Months", "12 Months", "15 Months", "18 Months", "24 Months"
];
const BOOST_LABELS = BOOST_LABELS_RAW.map(l => t(l));
const NITRO_MONTHS = [0, 1, 2, 3, 6, 12, 24, 36, 72];
const BOOST_MONTHS = [1, 2, 3, 6, 9, 12, 15, 18, 24];
const BOOST_ICONS = [
    "https://cdn.discordapp.com/badge-icons/51040c70d4f20a921ad6674ff86fc95c.png",
    "https://cdn.discordapp.com/badge-icons/0e4080d1d333bc7ad29ef6528b6f2fb7.png",
    "https://cdn.discordapp.com/badge-icons/72bed924410c304dbe3d00a6e593ff59.png",
    "https://cdn.discordapp.com/badge-icons/df199d2050d3ed4ebf84d64ae83989f8.png",
    "https://cdn.discordapp.com/badge-icons/996b3e870e8a22ce519b3a50e6bdd52f.png",
    "https://cdn.discordapp.com/badge-icons/991c9f39ee33d7537d9f408c3e53141e.png",
    "https://cdn.discordapp.com/badge-icons/cb3ae83c15e970e8f3d410bc62cb8b99.png",
    "https://cdn.discordapp.com/badge-icons/7142225d31238f6387d9f09efaa02759.png",
    "https://cdn.discordapp.com/badge-icons/ec92202290b48d0879b7413d2dde3bab.png",
];

const AVATAR_DECORATIONS = [
    { id: "1144307957425778779", label: "Hearts" },
    { id: "1144308196723408958", label: "Hearts Animated" },
    { id: "1212569433839636530", label: "Lofi Cafe" },
    { id: "1481387347642810480", label: "Winter" },
    { id: "1343751617362661526", label: "Magic Orb" },
    { id: "1373015260465987705", label: "Dragon" },
    { id: "1333866045303423026", label: "Ghost" },
    { id: "1144308439720394944", label: "Sakura Drift" },
    { id: "1432550258126229565", label: "Neon" },
    { id: "1462116613632426014", label: "Cyber City" },
    { id: "1462116613682757888", label: "Retro" },
    { id: "1144307629225672846", label: "Fire" },
    { id: "1341506443718688768", label: "Void" },
    { id: "1447654090640330763", label: "Celestial" },
    { id: "1483857762890022923", label: "Snowy" },
    { id: "1479561706672885811", label: "Ice" },
    { id: "1212569856189407352", label: "Cozy" },
    { id: "1485784028710830242", label: "New Year" },
    { id: "1341506444150702080", label: "Abyss" },
    { id: "1232071712695386162", label: "Spring" },
    { id: "1220514048068812901", label: "Summer" },
    { id: "1427463138634109026", label: "Autumn" },
    { id: "1341506443865489408", label: "Darkness" },
    { id: "1144003752978829455", label: "Flaming Sword" },
    { id: "1144006094134456352", label: "Magical Potion" },
    { id: "1144046002110738634", label: "Fairy Sprites" },
    { id: "1144048390594908212", label: "Wizard's Staff" },
    { id: "1144048977138946230", label: "Glowing Runes" },
    { id: "1144049316009353338", label: "Defensive Shield" },
    { id: "1144049603109470370", label: "Skull Medallion" },
    { id: "1144049924397334651", label: "Treasure and Key" },
    { id: "1207047014769234001", label: "Fire Element" },
    { id: "1207047597294886923", label: "Water" },
    { id: "1207047808838799410", label: "Air" },
    { id: "1207048049571139584", label: "Earth" },
    { id: "1207048289610899526", label: "Lightning" },
    { id: "1207048656289534022", label: "Balance" },
    { id: "1232070870093008937", label: "Stardust" },
    { id: "1232071157746765906", label: "Black Hole" },
    { id: "1232072121950146560", label: "Solar Orbit" },
    { id: "1232072520249643028", label: "UFO" },
    { id: "1232072859485208687", label: "Astronaut Helmet" },
    { id: "1197344326133502032", label: "Glitch" },
    { id: "1197344396983664670", label: "Cybernetic" },
    { id: "1197344575832981605", label: "Digital Sunrise" },
    { id: "1197344636558114986", label: "Implant" },
];

const PROFILE_EFFECTS = [
    { id: "1139323092645183591", label: "Hydro Blast" },
    { id: "1139323093991575696", label: "Sakura Dreams" },
    { id: "1139323099251232828", label: "Mystic Vines" },
    { id: "1139323099687436419", label: "Pixie Dust" },
    { id: "1212582298893946880", label: "Dreamy" },
    { id: "1212582372877541427", label: "Ki Detonate" },
    { id: "1212582452640350238", label: "Sushi Mania" },
    { id: "1139323100568244355", label: "Magic Hearts" },
    { id: "1139323093551165533", label: "Shatter" },
    { id: "1139323101008642101", label: "Shuriken Strike" },
    { id: "1139323101881061466", label: "Power Surge" },
    { id: "1158572178179108968", label: "Ghoulish Graffiti" },
    { id: "1158572275507937342", label: "Dark Omens" },
    { id: "1197344693630009424", label: "Nightrunner" },
    { id: "1197344764174008452", label: "Uplink Error" },
    { id: "1217626509737459852", label: "Petal Serenade" },
    { id: "1217627051217911848", label: "Fellowship of the Spring" },
    { id: "1217627230818009171", label: "Spring Bloom" },
    { id: "1228233390260486164", label: "Study Spot" },
    { id: "1228234634379132958", label: "All Nighter" },
    { id: "1237654783209508904", label: "Jolly Roger" },
    { id: "1237654867330469949", label: "Forgotten Treasure" },
    { id: "1237654942202990602", label: "Haunted Man O' War" },
    { id: "1232073286582538261", label: "Shooting Stars" },
    { id: "1232073608168472638", label: "Twilight" },
    { id: "1207049115339591681", label: "Rock Slide" },
    { id: "1207049364464345158", label: "Vortex" },
    { id: "1207049498065375343", label: "Mastery" },
    { id: "1245088205330710539", label: "Turbo Drive" },
    { id: "1245088254647205991", label: "Twinkle Trails" }
] as const;

const CUSTOM_BADGES = [
    { id: "quest", label: "Completed a quest", icon: "7d9ae358c8c5e118768335dbe68b4fb8" },
    { id: "orbs", label: "Orbs — Apprentice", icon: "83d8a1eb09a8d64e59233eec5d4d5c2d" },
    { id: "oldname", label: "Old username", icon: "6de6d34650760ba5551a79732e98ed60" },
    { id: "gifting_level", label: "Level reached", icon: "ca105ad9cfc8580c765101d17bbb2323" },
    { id: "gifting_icon", label: "Gifting Icon", icon: "64f2413c9b9803661322aaad25826b62" },
    { id: "gifting_patron", label: "Gifting Patron", icon: "ac305d1b9481f312ce4419e7f8296558" },
    { id: "gifting_champion", label: "Gifting Champion", icon: "8b7792c4f65953d3ff564f23429cb79e" },
    { id: "gifting_luminary", label: "Gifting Luminary", icon: "3119f5504b2cd09576a323908c7c3517" },
    { id: "gifting_hero", label: "Gifting Hero", icon: "77d65b1f210014a11eb1582ee06ab684" },
    { id: "gifting_legend", label: "Gifting Legend", icon: "7fe346cfc5da1340087d8759a9e7a395" }
] as const;

interface FakeConnection {
    id: string;
    platform: string;
    name: string;
    url?: string;
}

const CONNECTION_PLATFORMS = [
    { value: "domain", label: "Website", url: (name: string) => `https://${name}` },
    { value: "twitter", label: "X (Twitter)", url: (name: string) => `https://x.com/${name.replace(/^@/, "")}` },
    { value: "github", label: "GitHub", url: (name: string) => `https://github.com/${name}` },
    { value: "youtube", label: "YouTube", url: (name: string) => `https://youtube.com/@${name.replace(/^@/, "")}` },
    { value: "twitch", label: "Twitch", url: (name: string) => `https://twitch.tv/${name}` },
    { value: "spotify", label: "Spotify", url: (name: string) => `https://open.spotify.com/user/${name}` },
    { value: "tiktok", label: "TikTok", url: (name: string) => `https://tiktok.com/@${name.replace(/^@/, "")}` },
    { value: "reddit", label: "Reddit", url: (name: string) => `https://reddit.com/user/${name}` },
    { value: "steam", label: "Steam", url: (name: string) => `https://steamcommunity.com/id/${name}` },
    { value: "bluesky", label: "Bluesky", url: (name: string) => `https://bsky.app/profile/${name}` },
    { value: "paypal", label: "PayPal", url: (name: string) => `https://paypal.me/${name}` }
] as const;

function getConnectionUrl(connection: Pick<FakeConnection, "platform" | "name" | "url">) {
    const platform = CONNECTION_PLATFORMS.find(item => item.value === connection.platform);
    const input = connection.url?.trim() || (connection.platform === "domain" && /^https?:\/\//i.test(connection.name)
        ? connection.name
        : platform?.url(connection.name.trim()));
    const url = input ? parseUrl(input) : null;
    return url?.protocol === "https:" ? url.href : undefined;
}

function formatFakeConnections(connections: FakeConnection[]) {
    return connections.flatMap(connection => {
        const url = getConnectionUrl(connection);
        if (!connection.name.trim() || !url) return [];

        return [{
            type: connection.platform,
            id: connection.id,
            name: connection.name.trim(),
            url,
            verified: true,
            visibility: 1,
            showActivity: false,
            friendSync: false,
            metadataVisibility: 0,
            twoWayLink: false,
            metadata: {}
        }];
    });
}

function getCustomBadgeDescription(id: typeof CUSTOM_BADGES[number]["id"]) {
    if (id === "oldname") return storedData.oldName ? `Old username: ${storedData.oldName}` : "Old username";
    if (id === "gifting_level") return `Level ${storedData.levelReached ?? 1} reached`;
    return CUSTOM_BADGES.find(badge => badge.id === id)?.label ?? id;
}

function getMonthsAgo(months: number) {
    const date = new Date();
    date.setMonth(date.getMonth() - months);
    return date;
}

function getString(value: unknown) {
    return typeof value === "string" ? value : "";
}

function getDecorationData(value: unknown) {
    if (typeof value === "string") return makeDecorationData(value);
    if (!value || typeof value !== "object") return null;

    const data = value as Record<string, unknown>;
    const asset = getString(data.asset);
    if (!asset) return null;

    return {
        asset,
        skuId: getString(data.skuId) || getString(data.sku_id) || asset
    };
}

function makeDecorationData(asset: string, skuId?: string) {
    return { asset, skuId: skuId || asset };
}

function getStoredDecorationData(data: CustomProfileData) {
    const asset = getString(data.decorationAsset);
    return asset ? makeDecorationData(asset, getString(data.decorationSkuId)) : null;
}

function getDecorationUrl(assetId: string | undefined, animated = false): string {
    if (!assetId) return "";
    if (!/^\d+$/.test(assetId)) return `https://cdn.discordapp.com/avatar-decoration-presets/${assetId}.png?size=240&passthrough=${animated}`;

    return `https://cdn.discordapp.com/media/v1/collectibles-shop/${assetId}/${animated ? "animated" : "static"}`;
}

type ProfileEffectData = Omit<ProfileEffect, "skuId"> & {
    skuId?: string;
    sku_id?: string;
};

function cloneProfileEffect(effect: ProfileEffectData | null | undefined): ProfileEffect | null {
    const skuId = effect?.skuId || effect?.sku_id;
    if (!skuId) return null;

    const effectItems = Array.isArray(effect.effects)
        ? effect.effects
            .map((item: any) => ({ ...item, src: getString(item?.src) }))
            .filter((item: any) => item.src)
        : [];
    const reducedMotionSrc = getString(effect.reducedMotionSrc);
    const thumbnailPreviewSrc = getString(effect.thumbnailPreviewSrc);
    const staticFrameSrc = getString(effect.staticFrameSrc);
    if (!effectItems.length && !reducedMotionSrc && !thumbnailPreviewSrc && !staticFrameSrc) return null;

    return {
        skuId,
        title: effect.title,
        description: effect.description,
        accessibilityLabel: effect.accessibilityLabel,
        reducedMotionSrc,
        thumbnailPreviewSrc,
        effects: effectItems,
        animationType: effect.animationType,
        staticFrameSrc,
        type: effect.type || 1
    };
}

function mergeProfile(profile: any, merged: any) {
    try {
        const clone = Object.create(Object.getPrototypeOf(profile));
        const mergedKeys = new Set(Reflect.ownKeys(merged));

        for (const key of Reflect.ownKeys(profile)) {
            if (mergedKeys.has(key)) continue;
            const desc = Object.getOwnPropertyDescriptor(profile, key);
            if (desc) Object.defineProperty(clone, key, desc);
        }

        for (const key of mergedKeys) {
            const desc = Object.getOwnPropertyDescriptor(merged, key);
            if (desc) Object.defineProperty(clone, key, desc);
        }

        return clone;
    } catch {
        const clone = Object.create(profile);
        Object.assign(clone, merged);
        return clone;
    }
}

function addProfileEffect(effects: Map<string, ProfileEffect>, effect: ProfileEffect | null | undefined) {
    const cloned = cloneProfileEffect(effect);
    if (cloned) effects.set(cloned.skuId, cloned);
}

function getProfileEffects(selected: ProfileEffect | null | undefined) {
    const effects = new Map<string, ProfileEffect>();
    addProfileEffect(effects, selected);

    for (const data of Object.values(allAccountsData)) {
        addProfileEffect(effects, data.profileEffect);
    }

    const userId = AuthenticationStore.getId();
    const profile = userId ? UserProfileStore.getUserProfile(userId) : null;

    addProfileEffect(effects, profile?.profileEffect);

    if (Array.isArray(profile?.collectibles)) {
        for (const effect of profile.collectibles) {
            addProfileEffect(effects, effect);
        }
    }

    return [...effects.values()];
}

function getProfileEffectPreview(effect: ProfileEffect) {
    return effect.thumbnailPreviewSrc || effect.staticFrameSrc || effect.reducedMotionSrc || "";
}

function showLarpCordToast(message: string) {
    Toasts.show({ message, type: Toasts.Type.SUCCESS, id: Toasts.genId() });
}

interface CustomProfileData {
    username?: string;
    globalName?: string;
    avatar?: string;
    banner?: string;
    bio?: string;
    accentColor?: number;
    accentColor2?: number;
    pronouns?: string;
    badgeFlags?: number;
    createdAt?: string;
    nitro?: boolean;
    nitroLevel?: number;
    boostMonths?: number;
    email?: string;
    phone?: string;
    customBadgeIds?: string[];
    oldName?: string;
    levelReached?: number;
    decorationAsset?: string;
    decorationSkuId?: string;
    profileEffect?: ProfileEffect | null;
    profileEffectId?: string;
    copiedUserId?: string;
    fakeConnections?: FakeConnection[];
}

interface SavedProfile {
    userId: string;
    name: string;
    savedAt: number;
    data: CustomProfileData;
}

const DS_ALL_DATA = "customProfile_allData";
const DS_ALL_ENABLED = "customProfile_allEnabled";
const DS_SAVED_PROFILES = "larpCord_savedProfiles";

let storedData: CustomProfileData = {};
let isEnabled = false;

let cachedOriginalUser: any = null;
let cachedFakeUser: any = null;
let cachedDataHash: number = 0;
let _trueOriginalUser: any = null;
let _dataVersion: number = 0;
let allAccountsData: Record<string, CustomProfileData> = {};
let allAccountsEnabled: Record<string, boolean> = {};
let savedProfiles: Record<string, SavedProfile> = {};

function syncCurrentUserData() {
    const myId = _cachedMyId || AuthenticationStore?.getId?.();
    if (myId) {
        _cachedMyId = myId;
        storedData = allAccountsData[myId] || {};
        isEnabled = allAccountsEnabled[myId] || false;
    }
}

function persistData() {
    return Promise.all([
        DataStore.set(DS_ALL_DATA, allAccountsData),
        DataStore.set(DS_ALL_ENABLED, allAccountsEnabled)
    ]);
}

function persistSavedProfiles() {
    return DataStore.set(DS_SAVED_PROFILES, savedProfiles);
}

function onAccountSwitch() {
    updateCachedRealData();
    syncCurrentUserData();
    cachedFakeUser = null;
    cachedOriginalUser = null;
    _trueOriginalUser = null;
    _dataVersion++;
    forceAccountPanelRerender();
}

let _avatarPatchApplied = false;
let _avatarModule: any = null;
let _avatarPatchOrig: any = null;
let _avatarDecorationModule: any = null;
let _avatarDecorationOrig: any = null;
function applyAvatarPatchEarly() {
    if (_avatarPatchApplied) return;
    try {
        const IU = (window as any).Vencord?.Webpack?.findByProps?.("getUserAvatarURL", "getDefaultAvatarURL")
            ?? (window as any).Vencord?.Webpack?.findByProps?.("getUserAvatarURL")
            ?? IconUtils;
        if (!IU?.getUserAvatarURL) return;
        _avatarModule = IU;
        _avatarPatchOrig = IU.getUserAvatarURL;
        const orig = _avatarPatchOrig;
        IU.getUserAvatarURL = function (user: any, ...args: any[]) {
            if (!user) return orig(user, ...args);
            const uid = user.id ?? user.userId;
            if (!uid) return orig(user, ...args);
            if (isEnabled && storedData.avatar && isMe(uid)) {
                return storedData.avatar;
            }
            return orig(user, ...args);
        };
        _avatarPatchApplied = true;
    } catch { }
}

async function loadData() {
    try {
        const [allData, allEnabled, saved] = await Promise.all([
            DataStore.get(DS_ALL_DATA) as Promise<Record<string, CustomProfileData> | null>,
            DataStore.get(DS_ALL_ENABLED) as Promise<Record<string, boolean> | null>,
            DataStore.get(DS_SAVED_PROFILES) as Promise<Record<string, SavedProfile> | null>
        ]);
        if (saved && typeof saved === "object") savedProfiles = saved;
        if (allData && typeof allData === "object" && Object.keys(allData).length > 0) {
            allAccountsData = allData;
            allAccountsEnabled = allEnabled || {};
            syncCurrentUserData();
            return;
        }
        const d = await DataStore.get(DS_KEY) as CustomProfileData | null;
        const e = await DataStore.get(DS_ENABLED) as boolean | null;
        if (d !== null) storedData = d;
        if (e !== null) isEnabled = e === true;
        const myId = AuthenticationStore?.getId?.();
        if (myId && storedData && Object.keys(storedData).length > 0) {
            allAccountsData[myId] = storedData;
            allAccountsEnabled[myId] = isEnabled;
            await persistData();
        }
    } catch { }
}

async function readUserProfile(userId: string, menuUser?: User) {
    try {
        const user = (UserStore.getUser(userId) as any) ?? menuUser;
        if (!user) return null;

        const profileStore = UserProfileStore as any;
        const IU = IconUtils as any;
        const getProfile = profileStore._cp_orig_getUserProfile ?? profileStore.getUserProfile;
        const cachedProfile = getProfile.call(profileStore, userId);
        const fetchedProfile = await fetchUserProfile(userId, undefined, false).catch(() => null);
        const profile = getProfile.call(profileStore, userId) ?? fetchedProfile ?? cachedProfile ?? {};
        const sourceUser = (UserStore.getUser(userId) as any) ?? user;

        const newData: CustomProfileData = {
            username: getString(sourceUser.username ?? user.username),
            globalName: getString(sourceUser.globalName ?? sourceUser.global_name ?? sourceUser.displayName ?? user.globalName ?? user.global_name ?? user.displayName),
            pronouns: "",
            bio: "",
            accentColor: undefined,
            accentColor2: undefined,
            banner: "",
            avatar: "",
            badgeFlags: 0,
            customBadgeIds: [],
            nitro: false,
            nitroLevel: -1,
            boostMonths: -1,
            levelReached: 1,
            decorationAsset: undefined,
            decorationSkuId: undefined,
            profileEffect: null,
            profileEffectId: undefined,
            fakeConnections: [],
            createdAt: undefined,
            copiedUserId: userId
        };

        if (sourceUser.bio !== undefined) newData.bio = sourceUser.bio || "";
        if (profile.bio !== undefined) newData.bio = profile.bio || "";
        if (profile.pronouns !== undefined) newData.pronouns = profile.pronouns || "";

        try {
            const userAvatar = getString(sourceUser.avatar);
            const avatarUrl = IU?.getUserAvatarURL?.(sourceUser, false, 512)
                ?? (userAvatar ? `https://cdn.discordapp.com/avatars/${userId}/${userAvatar}.${userAvatar.startsWith("a_") ? "gif" : "png"}?size=512` : null);
            if (avatarUrl) newData.avatar = avatarUrl;
        } catch { }

        const hasNitro = (profile.premiumType ?? 0) > 0;
        newData.nitro = hasNitro;

        if (hasNitro) {
            const premiumSince = profile.premiumSince ?? sourceUser.premiumSince ?? null;
            if (premiumSince) {
                const months = Math.floor((Date.now() - new Date(premiumSince).getTime()) / (1000 * 60 * 60 * 24 * 30));
                if (months >= 72) newData.nitroLevel = 8;
                else if (months >= 36) newData.nitroLevel = 7;
                else if (months >= 24) newData.nitroLevel = 6;
                else if (months >= 12) newData.nitroLevel = 5;
                else if (months >= 6) newData.nitroLevel = 4;
                else if (months >= 3) newData.nitroLevel = 3;
                else if (months >= 2) newData.nitroLevel = 2;
                else if (months >= 1) newData.nitroLevel = 1;
                else newData.nitroLevel = 0;
            } else {
                newData.nitroLevel = 0;
            }
        }

        const boostSince = profile.premiumGuildSince ?? null;
        if (boostSince) {
            const bMonths = Math.floor((Date.now() - new Date(boostSince).getTime()) / (1000 * 60 * 60 * 24 * 30));
            if (bMonths >= 24) newData.boostMonths = 8;
            else if (bMonths >= 18) newData.boostMonths = 7;
            else if (bMonths >= 15) newData.boostMonths = 6;
            else if (bMonths >= 12) newData.boostMonths = 5;
            else if (bMonths >= 9) newData.boostMonths = 4;
            else if (bMonths >= 6) newData.boostMonths = 3;
            else if (bMonths >= 3) newData.boostMonths = 2;
            else if (bMonths >= 2) newData.boostMonths = 1;
            else newData.boostMonths = 0;
        }

        const bannerId = getString(profile.banner ?? sourceUser.banner);
        if (bannerId) newData.banner = IU.getUserBannerURL({ id: userId, banner: bannerId, canAnimate: true, size: 512 });

        if (profile.accentColor !== undefined) newData.accentColor = profile.accentColor;
        else if (sourceUser.accentColor !== undefined) newData.accentColor = sourceUser.accentColor;
        const themeColors = profile.themeColors ?? profile.theme_colors;
        if (Array.isArray(themeColors)) {
            if (typeof themeColors[0] === "number") newData.accentColor = themeColors[0];
            if (typeof themeColors[1] === "number") newData.accentColor2 = themeColors[1];
        }
        newData.oldName = getString(profile.legacyUsername) || undefined;
        if (Array.isArray(profile.badges)) {
            const badgeIds = new Set(profile.badges.map((badge: { id?: unknown; }) => getString(badge.id)));
            newData.customBadgeIds = [
                ...(badgeIds.has("quest_completed") ? ["quest"] : []),
                ...(badgeIds.has("orb_profile_badge") ? ["orbs"] : []),
                ...(badgeIds.has("legacy_username") ? ["oldname"] : [])
            ];
        }

        try {
            const ms = Number(BigInt(userId) >> 22n) + 1420070400000;
            newData.createdAt = new Date(ms).toISOString().slice(0, 10);
        } catch { }

        try {
            const flags = sourceUser.publicFlags ?? 0;
            let badgeFlags = 0;
            for (const { flag } of BADGES) { if (flags & flag) badgeFlags |= flag; }
            newData.badgeFlags = badgeFlags;
            const decoration = getDecorationData(sourceUser.avatarDecorationData)
                ?? getDecorationData(sourceUser.avatarDecoration)
                ?? getDecorationData(sourceUser.avatar_decoration_data)
                ?? getDecorationData(profile.avatarDecorationData)
                ?? getDecorationData(profile.avatarDecoration)
                ?? getDecorationData(profile.avatar_decoration_data)
                ?? getDecorationData(profile.user?.avatarDecorationData)
                ?? getDecorationData(profile.user?.avatarDecoration)
                ?? getDecorationData(profile.user?.avatar_decoration_data);
            if (decoration) {
                newData.decorationAsset = decoration.asset;
                newData.decorationSkuId = decoration.skuId;
            }
        } catch { }

        newData.profileEffect = cloneProfileEffect(profile.profileEffect);
        if (!newData.profileEffect) newData.profileEffectId = getString(profile.profileEffectId || profile.profileEffect?.skuId) || undefined;
        const connectedAccounts = profile.connectedAccounts ?? profile.connected_accounts;
        if (Array.isArray(connectedAccounts)) {
            newData.fakeConnections = connectedAccounts.flatMap((connection: unknown, index: number) => {
                if (!connection || typeof connection !== "object") return [];
                const data = connection as Record<string, unknown>;
                const name = getString(data.name);
                const platform = getString(data.type);
                const url = getString(data.url);
                if (!name || !platform) return [];
                return [{ id: getString(data.id) || `${platform}-${index}`, platform, name, ...(url ? { url } : {}) }];
            });
        }
        return newData;
    } catch (err) {
        console.error("[LarpCord] profile import error:", err);
        return null;
    }
}

async function copyUserProfile(userId: string, menuUser?: User) {
    const newData = await readUserProfile(userId, menuUser);
    if (!newData) return;

    try {
        const myId = AuthenticationStore?.getId?.();
        if (myId) {
            allAccountsData[myId] = newData;
            allAccountsEnabled[myId] = true;
        }
        storedData = newData;
        isEnabled = true;
        cachedFakeUser = null;
        cachedOriginalUser = null;
        _trueOriginalUser = null;
        _dataVersion++;
        await persistData();

        forceAccountPanelRerender();
        showLarpCordToast("Profile imported into LarpCord.");
    } catch (err) {
        console.error("[LarpCord] copyUserProfile error:", err);
    }
}

async function saveUserProfile(userId: string, menuUser: User) {
    const data = await readUserProfile(userId, menuUser);
    if (!data) return;

    savedProfiles[userId] = {
        userId,
        name: data.globalName || data.username || menuUser.globalName || menuUser.username,
        savedAt: Date.now(),
        data
    };
    await persistSavedProfiles();
    showLarpCordToast("Profile saved in LarpCord.");
}

const userContextMenuPatch: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!children || !Array.isArray(children) || !user || !user.id) return;
    try {
        const me = UserStore.getCurrentUser();
        if (!me || user.id === me.id) return;
        const isCopied = isEnabled && storedData.copiedUserId === user.id;

        children.push(
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id="copy-user-profile"
                    label={<span className="cp-context-action">{t("Import Profile into LarpCord")}</span>}
                    action={() => void copyUserProfile(user.id, user)}
                />
                <Menu.MenuItem
                    id="save-user-profile"
                    label={<span className="cp-context-action">{t("Save Profile")}</span>}
                    action={() => void saveUserProfile(user.id, user)}
                />
                {isCopied && (
                    <Menu.MenuItem
                        id="remove-copy-profile"
                        label={t("Remove LarpCord Import")}
                        color="danger"
                        action={() => {
                            try {
                                const myId = AuthenticationStore?.getId?.();
                                if (myId) {
                                    delete allAccountsData[myId];
                                    delete allAccountsEnabled[myId];
                                }
                                storedData = {};
                                isEnabled = false;
                                cachedFakeUser = null;
                                cachedOriginalUser = null;
                                _trueOriginalUser = null;
                                _dataVersion++;
                                void persistData();
                                forceAccountPanelRerender();
                            } catch (e) {
                                console.error("[LarpCord] Error removing copy:", e);
                            }
                        }}
                    />
                )}
            </Menu.MenuGroup>
        );
    } catch (err) {
        console.error("[LarpCord] Context menu patch error:", err);
    }
};

let _cachedMyId: string | null = null;

function updateCachedRealData() {
    try { const myId = AuthenticationStore?.getId?.(); if (myId) _cachedMyId = myId; } catch { }
}

function isMe(userId: string | null | undefined): boolean {
    if (!userId) return false;
    if (_cachedMyId) return _cachedMyId === userId;
    try { const myId = AuthenticationStore?.getId?.(); if (myId) { _cachedMyId = myId; return myId === userId; } } catch { }
    return false;
}

function EditIcon({ size = 18 }: { size?: number; }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>;
}
function FolderIcon() {
    return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z" /></svg>;
}
function CloseIcon() {
    return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>;
}
function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties; }) {
    return <div className="cp-section-label" style={style}>{children}</div>;
}

function Field({ label, value, placeholder, onChange, type = "text" }: {
    label: string; value: string; placeholder?: string; onChange: (v: string) => void; type?: string;
}) {
    return (
        <div className="cp-field">
            <SectionLabel>{label}</SectionLabel>
            <input className="cp-input" type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
        </div>
    );
}

function ImageUpload({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void; }) {
    const fileRef = React.useRef<HTMLInputElement>(null);
    function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => { if (ev.target?.result) onChange(ev.target.result as string); };
        reader.readAsDataURL(file);
    }
    return (
        <div className="cp-field">
            <SectionLabel>{label}</SectionLabel>
            <div className="cp-image-row">
                <input className="cp-input cp-url-input" placeholder={t("Image URL...")} value={value.startsWith("data:") ? "" : value} onChange={e => onChange(e.target.value)} />
                <button className="cp-file-btn" onClick={() => fileRef.current?.click()} title={t("Choose a file")}><FolderIcon /></button>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
                {value && <>
                    <img src={value} alt="" className="cp-preview-avatar" />
                    <button className="cp-clear-btn" onClick={() => onChange("")} title={t("Delete")}><CloseIcon /></button>
                </>}
            </div>
        </div>
    );
}

function Toggle({ label, checked, onChange, sublabel }: { label: string; checked: boolean; onChange: (v: boolean) => void; sublabel?: string; }) {
    return (
        <div className="cp-toggle-row" onClick={() => onChange(!checked)}>
            <div className="cp-toggle-text">
                <span className="cp-toggle-label">{label}</span>
                {sublabel && <span className="cp-toggle-sub">{sublabel}</span>}
            </div>
            <div className={`cp-toggle ${checked ? "cp-toggle--on" : ""}`}><div className="cp-toggle-thumb" /></div>
        </div>
    );
}

function BadgeBtn({ label, icon, active, onClick }: { label: string; icon?: string; active: boolean; onClick: () => void; }) {
    return (
        <button onClick={onClick} className={`cp-badge ${active ? "cp-badge--on" : ""}`}
            style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {icon && <img src={icon} alt="" style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }} />}
            <span>{label}</span>
        </button>
    );
}

function BadgePicker({ selected, onChange, nitroType, onNitroType, boostLevel, onBoostLevel, customIds, onCustomIds, oldName, onOldName, levelReached, onLevelReached }: {
    selected: number; onChange: (v: number) => void;
    nitroType: number; onNitroType: (v: number) => void;
    boostLevel: number; onBoostLevel: (v: number) => void;
    customIds: string[]; onCustomIds: (v: string[]) => void;
    oldName: string; onOldName: (v: string) => void;
    levelReached: number; onLevelReached: (v: number) => void;
}) {
    const hasOldName = customIds.includes("oldname");
    const hasLevel = customIds.includes("gifting_level");
    return (
        <div className="cp-field">
            <SectionLabel>{t("Badges")}</SectionLabel>
            <div className="cp-badges">
                {BADGES.map(b => (
                    <BadgeBtn key={b.flag} label={b.label} icon={b.icon}
                        active={!!(selected & b.flag)} onClick={() => onChange(selected ^ b.flag)} />
                ))}
            </div>
            <SectionLabel style={{ marginTop: 8 }}>{t("Evolving Nitro Badge")}</SectionLabel>
            <div className="cp-badges">
                <BadgeBtn label={t("None")} active={nitroType === -1} onClick={() => onNitroType(-1)} />
                {NITRO_LEVELS.map((n, i) => (
                    <BadgeBtn key={i} label={n.label} icon={n.icon} active={nitroType === i} onClick={() => {
                        onNitroType(i);
                    }} />
                ))}
            </div>
            <SectionLabel style={{ marginTop: 8 }}>{t("Special Badges")}</SectionLabel>
            <div className="cp-badges">
                {CUSTOM_BADGES.map(badge => {
                    const active = customIds.includes(badge.id);
                    return <BadgeBtn
                        key={badge.id}
                        label={t(badge.label)}
                        icon={`https://cdn.discordapp.com/badge-icons/${badge.icon}.png`}
                        active={active}
                        onClick={() => onCustomIds(active ? customIds.filter(id => id !== badge.id) : [...customIds, badge.id])}
                    />;
                })}
            </div>
            {hasOldName && (
                <div className="cp-field" style={{ marginTop: 6 }}>
                    <SectionLabel style={{ marginTop: 0 }}>{t("Old username displayed in tooltip")}</SectionLabel>
                    <input className="cp-input" value={oldName} placeholder="OldUser#0000"
                        onChange={e => onOldName(e.target.value)} />
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                        {t('Ex : Triggerr#5954 — will appear as "Old username: Triggerr#5954" when hovering the badge.')}
                    </div>
                </div>
            )}
            {hasLevel && (
                <Field
                    label={t("Level reached")}
                    value={String(levelReached)}
                    type="number"
                    onChange={value => onLevelReached(Math.max(1, Number(value) || 1))}
                />
            )}
            <SectionLabel style={{ marginTop: 8 }}>{t("Boost Badge (Server Booster)")}</SectionLabel>
            <div className="cp-badges">
                <BadgeBtn label={t("None")} active={boostLevel === -1} onClick={() => onBoostLevel(-1)} />
                {BOOST_LABELS.map((lbl, i) => (
                    <BadgeBtn key={i} label={lbl} icon={BOOST_ICONS[i]} active={boostLevel === i} onClick={() => onBoostLevel(i)} />
                ))}
            </div>
        </div>
    );
}

function ProfilePreview({ data }: { data: CustomProfileData; }) {
    const currentUser = UserStore.getCurrentUser();
    const displayName = data.globalName || currentUser.globalName || currentUser.username;
    const username = data.username || currentUser.username;
    const avatar = data.avatar || IconUtils.getUserAvatarURL(currentUser, true, 128) || IconUtils.getDefaultAvatarURL(currentUser.id);
    const effectPreview = data.profileEffect ? getProfileEffectPreview(data.profileEffect) : "";

    return (
        <div className="cp-profile-preview">
            <div className="cp-profile-preview-banner" style={{ backgroundImage: data.banner ? `url("${data.banner}")` : undefined }}>
                {effectPreview && <img src={effectPreview} alt="" className="cp-profile-effect-preview" />}
            </div>
            <div className="cp-profile-preview-body">
                <div className="cp-profile-preview-avatar-wrap">
                    <img src={avatar} alt="" className="cp-profile-preview-avatar" />
                    {data.decorationAsset && <img src={getDecorationUrl(data.decorationAsset)} alt="" className="cp-profile-preview-decoration" />}
                </div>
                <div className="cp-profile-preview-text">
                    <div className="cp-profile-preview-name-row">
                        <span className="cp-profile-preview-name">{displayName}</span>
                        <span className="cp-profile-pill">Client-side</span>
                        {data.copiedUserId && <span className="cp-profile-pill cp-profile-pill-imported">Imported</span>}
                    </div>
                    <span className="cp-profile-preview-username">@{username}</span>
                    {data.bio && <span className="cp-profile-preview-bio">{data.bio}</span>}
                </div>
            </div>
        </div>
    );
}

function ProfileEffectPicker({ value, presetId, onChange, onPresetChange }: {
    value: ProfileEffect | null | undefined;
    presetId: string;
    onChange: (effect: ProfileEffect | null) => void;
    onPresetChange: (id: string) => void;
}) {
    const effects = getProfileEffects(value);
    const [catalogEffects, setCatalogEffects] = React.useState<ProfileEffect[]>([]);
    const selectedSkuId = presetId || value?.skuId || "";

    React.useEffect(() => {
        let cancelled = false;

        void Promise.allSettled(PROFILE_EFFECTS.map(async preset => {
            const { body }: { body: { items: ProfileEffectData[]; }; } = await RestAPI.get({
                url: Constants.Endpoints.COLLECTIBLES_PRODUCTS(preset.id)
            });

            return cloneProfileEffect(body.items[0]);
        })).then(results => {
            if (cancelled) return;

            const loadedEffects = results.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []);
            setCatalogEffects(loadedEffects);

            const selectedEffect = loadedEffects.find(effect => effect.skuId === presetId);
            if (selectedEffect) {
                onChange(selectedEffect);
                onPresetChange("");
            }
        });

        return () => { cancelled = true; };
    }, []);

    for (const effect of catalogEffects) {
        if (!effects.some(item => item.skuId === effect.skuId)) effects.push(effect);
    }

    return (
        <div className="cp-field">
            <SectionLabel>{t("Profile effect")}</SectionLabel>
            <div className="cp-effect-grid">
                <button
                    onClick={() => { onChange(null); onPresetChange(""); }}
                    className={`cp-effect-tile ${!selectedSkuId ? "cp-effect-tile--on" : ""}`}
                >
                    <span className="cp-effect-empty">{t("None")}</span>
                </button>
                {effects.map(effect => {
                    const preview = getProfileEffectPreview(effect);

                    return (
                        <button
                            key={effect.skuId}
                            onClick={() => { onPresetChange(""); onChange(selectedSkuId === effect.skuId ? null : effect); }}
                            className={`cp-effect-tile ${selectedSkuId === effect.skuId ? "cp-effect-tile--on" : ""}`}
                            title={effect.title || effect.accessibilityLabel || effect.skuId}
                        >
                            {preview ? <img src={preview} alt="" className="cp-effect-img" /> : <span className="cp-effect-empty">{effect.title || effect.skuId}</span>}
                            <span className="cp-effect-label">{effect.title || effect.accessibilityLabel || effect.skuId}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function ConnectionsPicker({ connections, onChange }: { connections: FakeConnection[]; onChange: (connections: FakeConnection[]) => void; }) {
    const [platform, setPlatform] = React.useState<string>(CONNECTION_PLATFORMS[0].value);
    const [name, setName] = React.useState("");
    const [url, setUrl] = React.useState("");
    const trimmedName = name.trim();
    const connectionUrl = getConnectionUrl({ platform, name: trimmedName, url });

    function addConnection() {
        if (!trimmedName || !connectionUrl) return;
        onChange([...connections, { id: `${Date.now()}-${connections.length}`, platform, name: trimmedName, url: connectionUrl }]);
        setName("");
        setUrl("");
    }

    return (
        <div className="cp-field">
            <SectionLabel>{t("Profile connections")}</SectionLabel>
            <div className="cp-connection-form">
                <Select
                    options={CONNECTION_PLATFORMS}
                    isSelected={(value: string) => value === platform}
                    select={setPlatform}
                    serialize={(value: string) => value}
                />
                <Field label={t("Account name")} value={name} placeholder="username" onChange={setName} />
                <Field label={t("Custom HTTPS URL (optional)")} value={url} placeholder="https://example.com/profile" onChange={setUrl} />
                <Button onClick={addConnection} disabled={!trimmedName || !connectionUrl}>{t("Add connection")}</Button>
            </div>
            <div className="cp-connection-list">
                {connections.map(connection => (
                    <div className="cp-connection" key={connection.id}>
                        <div>
                            <strong>{connection.name}</strong>
                            <span>{CONNECTION_PLATFORMS.find(item => item.value === connection.platform)?.label ?? connection.platform}</span>
                        </div>
                        <button className="cp-clear-btn" onClick={() => onChange(connections.filter(item => item.id !== connection.id))} title={t("Remove")}>
                            <CloseIcon />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function forceAccountPanelRerender() {
    try {
        const WP = (Vencord as any).Webpack;
        UserStore.emitChange();
        UserProfileStore.emitChange();

        const MAS = WP?.findByProps?.("getUsers", "getValidUsers", "getHasLoggedInAccounts");
        MAS?.emitChange?.();

    } catch { }
}

function CustomProfileModal(rootProps: RenderModalProps) {
    const myId = AuthenticationStore?.getId?.() || "";
    const [selectedAccountId, setSelectedAccountId] = React.useState(myId);
    const [selectedSavedProfileId, setSelectedSavedProfileId] = React.useState("");
    const [data, setData] = React.useState<CustomProfileData>(() => ({ ...(allAccountsData[myId] || storedData || {}) }));
    const [saving, setSaving] = React.useState(false);
    const nitroLevel = data.nitroLevel ?? -1;
    const boostLevel = data.boostMonths ?? -1;
    const customIds = data.customBadgeIds ?? [];
    const oldName = data.oldName ?? "";
    const levelReached = data.levelReached ?? 1;
    const savedProfileOptions = Object.values(savedProfiles)
        .sort((a, b) => b.savedAt - a.savedAt)
        .map(profile => ({ value: profile.userId, label: profile.name }));

    const accounts = React.useMemo(() => {
        try {
            const MAS = (window as any).Vencord?.Webpack?.findByProps?.("getUsers", "getValidUsers");
            if (MAS?.getUsers) {
                const users = MAS.getUsers();
                if (Array.isArray(users) && users.length > 0) return users;
            }

        } catch { }

        const me = UserStore.getCurrentUser();
        return me ? [me] : [];
    }, []);

    React.useEffect(() => {
        const newData = allAccountsData[selectedAccountId] || {};
        setData({ ...newData });
    }, [selectedAccountId]);

    function set<K extends keyof CustomProfileData>(key: K, val: CustomProfileData[K]) {
        setData(d => ({ ...d, [key]: val }));
    }

    function setDecoration(asset?: string, skuId?: string) {
        setData(d => ({ ...d, decorationAsset: asset, decorationSkuId: skuId }));
    }

    function selectSavedProfile(userId: string) {
        const profile = savedProfiles[userId];
        if (!profile) return;
        setSelectedSavedProfileId(userId);
        setData({ ...profile.data });
    }

    async function deleteSavedProfile() {
        if (!selectedSavedProfileId) return;
        delete savedProfiles[selectedSavedProfileId];
        setSelectedSavedProfileId("");
        await persistSavedProfiles();
        showLarpCordToast("Saved profile removed.");
    }

    async function save() {
        try {
            setSaving(true);
            const savedData = { ...data };

            allAccountsData[selectedAccountId] = savedData;
            allAccountsEnabled[selectedAccountId] = true;

            if (selectedAccountId === myId) {
                storedData = savedData;
                isEnabled = true;
                cachedFakeUser = null;
                cachedOriginalUser = null;
                _dataVersion++;
            }

            await persistData();

            updateCachedRealData();
            forceAccountPanelRerender();
        } catch (err) {
            console.error("[LarpCord] save error:", err);
        } finally {
            setSaving(false);
            rootProps.onClose();
        }
    }

    async function reset() {
        delete allAccountsData[selectedAccountId];
        delete allAccountsEnabled[selectedAccountId];

        if (selectedAccountId === myId) {
            storedData = {};
            isEnabled = false;
            cachedFakeUser = null;
            cachedOriginalUser = null;
            _trueOriginalUser = null;
            _dataVersion++;
        }

        await persistData();

        forceAccountPanelRerender();
        rootProps.onClose();
    }

    const accentHex = data.accentColor != null ? "#" + data.accentColor.toString(16).padStart(6, "0") : "";
    const selectedDecorationIsListed = data.decorationAsset
        ? AVATAR_DECORATIONS.some(dec => dec.id === data.decorationAsset)
        : false;

    return (
        <Modal
            {...rootProps}
            size="lg"
            title={<div className="cp-header"><EditIcon size={16} /><span className="cp-header-title">LarpCord</span></div>}
            actions={[
                { text: t("Cancel"), variant: "secondary", onClick: rootProps.onClose },
                { text: t("Reset"), variant: "critical-primary", onClick: () => void reset() },
                { text: saving ? t("Saving...") : t("Save"), variant: "primary", loading: saving, disabled: saving, onClick: () => void save() }
            ]}
        >
            <div className="cp-content">
                <div className="cp-profile-selectors">
                    <div className="cp-field">
                        <SectionLabel>{t("Account to customize")}</SectionLabel>
                    <Select
                        options={accounts.map((acc: any) => ({
                            value: acc.id,
                            label: acc.globalName || acc.username,
                        }))}
                        isSelected={(v: string) => v === selectedAccountId}
                        select={(v: string) => setSelectedAccountId(v)}
                        serialize={(v: string) => v}
                        renderOptionLabel={(o: any) => (
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <img
                                    src={IconUtils.getUserAvatarURL(accounts.find((a: any) => a.id === o.value), false, 20)}
                                    style={{ borderRadius: "50%", width: 20, height: 20 }}
                                />
                                {o.label}
                            </div>
                        )}
                        renderOptionValue={(selected: any[]) => {
                            const option = selected[0];
                            if (!option) return "Select Account";
                            return (
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <img
                                        src={IconUtils.getUserAvatarURL(accounts.find((a: any) => a.id === option.value), false, 20)}
                                        style={{ borderRadius: "50%", width: 20, height: 20 }}
                                    />
                                    {option.label}
                                </div>
                            );
                        }}
                    />
                    </div>
                    <div className="cp-field">
                        <SectionLabel>{t("Saved profiles")}</SectionLabel>
                        <div className="cp-saved-profile-row">
                            <Select
                                placeholder={savedProfileOptions.length ? t("Choose a saved profile") : t("No saved profiles")}
                                options={savedProfileOptions}
                                isDisabled={!savedProfileOptions.length}
                                isSelected={(value: string) => value === selectedSavedProfileId}
                                select={selectSavedProfile}
                                serialize={(value: string) => value}
                            />
                            <Button
                                variant="dangerSecondary"
                                size="small"
                                disabled={!selectedSavedProfileId}
                                onClick={() => void deleteSavedProfile()}
                            >
                                {t("Delete")}
                            </Button>
                        </div>
                    </div>
                </div>

                <ProfilePreview data={data} />
                <Field label={t("Username")} value={data.username ?? ""} placeholder="my_username_00" onChange={v => set("username", v)} />
                <Field label={t("Display name")} value={data.globalName ?? ""} placeholder="My Name" onChange={v => set("globalName", v)} />
                <ImageUpload label={t("Profile picture")} value={data.avatar ?? ""} onChange={v => set("avatar", v)} />
                <Toggle label={t("Simulate Nitro")} sublabel={t("Enables banner and profile color")} checked={data.nitro ?? false} onChange={v => set("nitro", v)} />
                {data.nitro && <ImageUpload label={t("Banner")} value={data.banner ?? ""} onChange={v => set("banner", v)} />}
                <div className="cp-divider" />
                <Field label={t("Bio")} value={data.bio ?? ""} placeholder={t("My description...")} onChange={v => set("bio", v)} />
                <Field label={t("Pronouns")} value={data.pronouns ?? ""} placeholder={t("he/him")} onChange={v => set("pronouns", v)} />
                <div className="cp-field">
                    <SectionLabel>{t("Profile color (Nitro — gradient possible)")}</SectionLabel>
                    <div className="cp-color-row" style={{ marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 6 }}>{t("Color 1")}</span>
                        <input type="color" value={accentHex || "#5865f2"} onChange={e => { const n = parseInt(e.target.value.replace("#", ""), 16); if (!isNaN(n)) set("accentColor", n); }} className="cp-color-swatch" />
                        <input value={accentHex} placeholder="#5865f2" onChange={e => { const h = e.target.value.replace("#", ""); const n = parseInt(h, 16); if (!isNaN(n) && h.length === 6) set("accentColor", n); else if (!e.target.value || e.target.value === "#") set("accentColor", undefined); }} className="cp-input cp-color-input" />
                        {data.accentColor != null && <button className="cp-clear-btn" onClick={() => set("accentColor", undefined)}><CloseIcon /></button>}
                    </div>
                    <div className="cp-color-row">
                        <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 6 }}>{t("Color 2")}</span>
                        {(() => {
                            const hex2 = data.accentColor2 != null ? "#" + data.accentColor2.toString(16).padStart(6, "0") : ""; return (<>
                                <input type="color" value={hex2 || "#eb459e"} onChange={e => { const n = parseInt(e.target.value.replace("#", ""), 16); if (!isNaN(n)) set("accentColor2", n); }} className="cp-color-swatch" />
                                <input value={hex2} placeholder="#eb459e (optional)" onChange={e => { const h = e.target.value.replace("#", ""); const n = parseInt(h, 16); if (!isNaN(n) && h.length === 6) set("accentColor2", n); else if (!e.target.value || e.target.value === "#") set("accentColor2", undefined); }} className="cp-input cp-color-input" />
                                {data.accentColor2 != null && <button className="cp-clear-btn" onClick={() => set("accentColor2", undefined)}><CloseIcon /></button>}
                            </>);
                        })()}
                    </div>
                </div>
                <Field label={t("Account creation date")} value={data.createdAt ?? ""} placeholder="2010-06-29" type="date" onChange={v => set("createdAt", v)} />
                <Field label={t("Email address (local display)")} value={data.email ?? ""} placeholder="exemple@mail.com" onChange={v => set("email", v)} />
                <Field label={t("Phone (local display)")} value={data.phone ?? ""} placeholder="+33 6 00 00 00 00" onChange={v => set("phone", v)} />
                <div className="cp-divider" />
                <BadgePicker
                    selected={data.badgeFlags ?? 0} onChange={v => set("badgeFlags", v)}
                    nitroType={nitroLevel} onNitroType={v => {
                        set("nitroLevel", v as any);
                        if (v >= 1) set("nitro", true);
                    }}
                    boostLevel={boostLevel} onBoostLevel={v => set("boostMonths", v)}
                    customIds={customIds} onCustomIds={v => set("customBadgeIds", v)}
                    oldName={oldName} onOldName={v => set("oldName", v)}
                    levelReached={levelReached} onLevelReached={v => set("levelReached", v)}
                />
                <div className="cp-divider" />
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <SectionLabel>{t("Avatar decoration")}</SectionLabel>
                </div>
                <div className="cp-badges" style={{ flexWrap: "wrap", gap: 6 }}>
                    <button onClick={() => setDecoration()}
                        className={`cp-badge ${!data.decorationAsset ? "cp-badge--on" : ""}`} style={{ minWidth: 60 }}>
                        {t("None")}
                    </button>
                    {data.decorationAsset && !selectedDecorationIsListed && (
                        <button
                            onClick={() => setDecoration()}
                            className="cp-badge cp-badge--on"
                            title={t("Imported decoration")} style={{ padding: 3, lineHeight: 0, width: 52, height: 52, borderRadius: 6 }}>
                            <img src={getDecorationUrl(data.decorationAsset)} alt={t("Imported decoration")}
                                style={{ width: 46, height: 46, objectFit: "contain", display: "block" }} />
                        </button>
                    )}
                    {AVATAR_DECORATIONS.map(dec => (
                        <button key={dec.id}
                            onClick={() => data.decorationAsset === dec.id ? setDecoration() : setDecoration(dec.id, dec.id)}
                            className={`cp-badge ${data.decorationAsset === dec.id ? "cp-badge--on" : ""}`}
                            title={dec.label} style={{ padding: 3, lineHeight: 0, width: 52, height: 52, borderRadius: 6 }}>
                            <img src={getDecorationUrl(dec.id)} alt={dec.label}
                                style={{ width: 46, height: 46, objectFit: "contain", display: "block" }} />
                        </button>
                    ))}
                </div>
                <div className="cp-hint">
                    <a
                        role="button"
                        style={{ color: "var(--text-link)", cursor: "pointer", fontWeight: 500 }}
                        onClick={() => {
                            rootProps.onClose();
                            try {
                                SettingsRouter.openUserSettings("equicord_main");
                            } catch {
                                try {
                                    SettingsRouter.open("equicord_main");
                                } catch {
                                    try {
                                        FluxDispatcher.dispatch({ type: "USER_SETTINGS_MODAL_OPEN", section: "equicord_main" });
                                    } catch { }
                                }
                            }
                        }}
                    >
                        LarpCord changes stay on this client. Right click another user to import their public profile into your local preview.
                    </a>
                </div>
                <div className="cp-divider" />
                <ProfileEffectPicker
                    value={data.profileEffect}
                    presetId={data.profileEffectId ?? ""}
                    onChange={effect => set("profileEffect", effect)}
                    onPresetChange={id => set("profileEffectId", id || undefined)}
                />
                <div className="cp-divider" />
                <ConnectionsPicker connections={data.fakeConnections ?? []} onChange={connections => set("fakeConnections", connections)} />
            </div>
        </Modal>
    );
}

function CustomProfileIcon() {
    return <EditIcon size={18} />;
}

function openLarpCord() {
    openModal(props => <CustomProfileModal {...props} />);
}

function CustomProfileButton() {
    const { showIcon } = settings.use(ICON_SETTING_KEYS);
    if (!showIcon) return null;

    return <HeaderBarButton icon={CustomProfileIcon} tooltip="LarpCord" onClick={openLarpCord} />;
}

const CustomProfileButtonWithBoundary = ErrorBoundary.wrap(CustomProfileButton, { noop: true });

export default definePlugin({
    name: "LarpCord",
    enabledByDefault: true,
    description: t("Visually customize your local Discord profile preview with names, avatars, banners, badges and effects."),
    authors: [{ name: "irritably", id: 928787166916640838n }],
    dependencies: ["HeaderBarAPI", "ContextMenuAPI"],
    settings,

    headerBarButton: {
        icon: CustomProfileIcon,
        render: () => <CustomProfileButtonWithBoundary />,
        priority: 10
    },

    contextMenus: {
        "user-context": userContextMenuPatch
    },

    flux: {
        CONNECTION_OPEN() {
            onAccountSwitch();
        }
    },

    patches: [
        {
            find: '"SHOULD_LOAD");',
            replacement: {
                match: /\i(?:\?)?.getPreviewBanner\(\i,\i,\i\)(?=.{0,100}"COMPLETE")/,
                replace: "$self.patchBannerUrl(arguments[0])||$&"
            }
        },
        {
            find: ".WIDGETS_RTC_UPSELL_COACHMARK)",
            replacement: {
                match: /currentUser:(\i)(?=.{0,200}voiceDb)/,
                replace: "currentUser:$self.fakeCurrentUser($1)"
            }
        },
        {
            find: "DISPLAY_NAME",
            noWarn: true,
            replacement: {
                match: /(?<=currentUser:\i,user:)(\i)/,
                replace: "$self.fakeCurrentUser($1)"
            }
        },
        {
            find: "obfuscatedEmail",
            noWarn: true,
            replacement: [
                {
                    match: /obfuscatedEmail:(\i)/,
                    replace: "obfuscatedEmail:$self.fakeObfuscatedEmail($1)"
                },
                {
                    match: /obfuscatedPhone:(\i)/,
                    replace: "obfuscatedPhone:$self.fakeObfuscatedPhone($1)"
                }
            ]
        },
        {
            find: "isHoveringOrFocusing",
            replacement: [
                {
                    noWarn: true,
                    match: /user:([A-Za-z_$][\w$]*),displayProfile:([A-Za-z_$][\w$]*),themeType/,
                    replace: "user:$self.fakeCurrentUser($1),displayProfile:$2,themeType"
                }
            ]
        },
        {
            find: "AccountPanel",
            replacement: [
                {
                    match: /user:([a-zA-Z0-9_]+),/,
                    replace: "user:$self.fakeCurrentUser($1),"
                }
            ]
        },
        {
            find: "UserAccountSettings",
            replacement: [
                {
                    match: /user:([a-zA-Z0-9_]+),/,
                    replace: "user:$self.fakeCurrentUser($1),"
                },
                {
                    match: /email:([^,}]+),/,
                    replace: "email:$self.fakeObfuscatedEmail($1),"
                }
            ]
        },
        {
            find: "getObfuscatedEmail",
            replacement: [
                {
                    match: /obfuscatedEmail:([^,}]+)/g,
                    replace: "obfuscatedEmail:$self.fakeObfuscatedEmail($1)"
                },
                {
                    match: /obfuscatedPhone:([^,}]+)/g,
                    replace: "obfuscatedPhone:$self.fakeObfuscatedPhone($1)"
                }
            ]
        }
    ],

    fakeCurrentUser(user: any) {
        if (!user || (!isEnabled && this._forceNative !== true) || !isMe(user.id)) return user;

        if (cachedOriginalUser === user && cachedFakeUser && cachedDataHash === _dataVersion) {
            return cachedFakeUser;
        }

        const realUser = (user as any).__cp_isClone ? _trueOriginalUser || user : user;
        if (!realUser.__cp_isClone) _trueOriginalUser = realUser;

        const realUsername = realUser.__cp_isClone ? (realUser._realUsername || realUser.username) : realUser.username;
        const realGlobalName = realUser.__cp_isClone ? (realUser._realGlobalName ?? realUser.globalName) : realUser.globalName;
        const realDisplayName = realUser.__cp_isClone ? (realUser._realDisplayName ?? realUser.displayName) : realUser.displayName;

        const clone = Object.create(Object.getPrototypeOf(realUser));

        for (const key of Reflect.ownKeys(realUser)) {
            if (key === "username" || key === "globalName" || key === "displayName" || key === "__cp_isClone") continue;
            const desc = Object.getOwnPropertyDescriptor(realUser, key);
            if (desc) Object.defineProperty(clone, key, desc);
        }
        Object.defineProperty(clone, "__cp_isClone", { value: true, enumerable: false, configurable: true });
        clone._realUsername = realUsername;
        clone._realGlobalName = realGlobalName;
        clone._realDisplayName = realDisplayName;

        if (!isEnabled) {
            clone.username = realUsername;
            clone.globalName = realGlobalName;
            clone.displayName = realDisplayName;
            cachedOriginalUser = user;
            cachedFakeUser = clone;
            cachedDataHash = _dataVersion;
            return clone;
        }

        const fakeUser = storedData.username || realUsername;
        const hasCustomGlobalName = !!storedData.globalName;
        const fakeGlobal = hasCustomGlobalName ? storedData.globalName : realGlobalName;
        const origDisplay = realGlobalName || realDisplayName || realUsername;
        const fakeDisplay = hasCustomGlobalName ? (storedData.globalName || origDisplay) : origDisplay;

        Object.defineProperty(clone, "username", {
            get: () => isEnabled ? fakeUser : realUsername,
            set: () => { }, configurable: true, enumerable: true
        });
        Object.defineProperty(clone, "globalName", {
            get: () => isEnabled ? fakeGlobal : realGlobalName,
            set: () => { }, configurable: true, enumerable: true
        });
        Object.defineProperty(clone, "displayName", {
            get: () => isEnabled ? fakeDisplay : (realDisplayName || realGlobalName || realUsername),
            set: () => { }, configurable: true, enumerable: true
        });

        if (storedData.email) clone.email = storedData.email;
        if (storedData.phone) clone.phone = storedData.phone;

        clone.getTag = () => (storedData.username || realUsername) + "#0000";
        clone.getGlobalName = () => isEnabled ? fakeGlobal : realGlobalName;
        clone.toString = () => fakeDisplay;

        if (storedData.createdAt) {
            const fakeCreatedAt = new Date(storedData.createdAt + "T12:00:00Z");
            Object.defineProperty(clone, "createdAt", {
                get: () => fakeCreatedAt,
                configurable: true,
                enumerable: true
            });
        }

        const storedDecoration = getStoredDecorationData(storedData);
        if (storedDecoration) {
            clone.avatarDecoration = storedDecoration;
            clone.avatarDecorationData = storedDecoration;
        } else if (storedData.copiedUserId) {
            clone.avatarDecoration = null;
            clone.avatarDecorationData = null;
            clone.avatar_decoration_data = null;
        }

        const storedProfileEffect = cloneProfileEffect(storedData.profileEffect);
        if (storedData.profileEffectId) {
            clone.profileEffect = { skuId: storedData.profileEffectId, expireAt: null };
            clone.profileEffectId = storedData.profileEffectId;
        } else if (storedProfileEffect) {
            clone.profileEffect = storedProfileEffect;
            clone.profileEffectId = storedProfileEffect.skuId;
        }

        const wantedFlags = (isEnabled && storedData.badgeFlags != null) ? storedData.badgeFlags : realUser.publicFlags;
        clone.publicFlags = wantedFlags;
        clone.flags = wantedFlags;

        if (!realUser.__cp_isClone) {
            clone._realPremiumType = realUser.premiumType;
            clone._realPremiumSince = realUser.premiumSince;
            clone._realPremiumGuildSince = realUser.premiumGuildSince;
        }

        cachedOriginalUser = user;
        cachedFakeUser = clone;
        cachedDataHash = _dataVersion;

        return clone;
    },

    _cachedProfile: null as any,
    _cachedProfileInput: null as any,
    _cachedProfileVersion: 0,

    hookUserProfile(profile: any) {
        if (!profile || !isEnabled) return profile;
        if (this._cachedProfileInput === profile && this._cachedProfile && this._cachedProfileVersion === _dataVersion) {
            return this._cachedProfile;
        }
        try {
            const merged: any = {};

            if (storedData.bio) merged.bio = storedData.bio;
            if (storedData.pronouns) merged.pronouns = storedData.pronouns;
            if (storedData.accentColor != null) merged.accentColor = storedData.accentColor;
            if (storedData.banner) merged.banner = storedData.banner;

            const storedDecoration = getStoredDecorationData(storedData);
            if (storedDecoration) {
                merged.avatarDecoration = storedDecoration;
                merged.avatarDecorationData = storedDecoration;
            } else if (storedData.copiedUserId) {
                merged.avatarDecoration = null;
                merged.avatarDecorationData = null;
                merged.avatar_decoration_data = null;
            }

            if (storedData.profileEffectId) {
                merged.profileEffect = { skuId: storedData.profileEffectId, expireAt: null };
                merged.profileEffectId = storedData.profileEffectId;
            } else if (storedData.profileEffect !== undefined) {
                const profileEffect = cloneProfileEffect(storedData.profileEffect);
                merged.profileEffect = profileEffect;
                merged.profileEffectId = profileEffect?.skuId;
            }

            if (storedData.fakeConnections !== undefined) {
                const connections = formatFakeConnections(storedData.fakeConnections);
                merged.connectedAccounts = connections;
                merged.connected_accounts = merged.connectedAccounts;
            }

            if (isEnabled && (storedData.nitro || storedData.badgeFlags != null)) {
                merged.premiumType = storedData.nitro ? 2 : 0;

                if (storedData.nitro) {
                    if (storedData.accentColor != null) {
                        const c2 = storedData.accentColor2 ?? storedData.accentColor;
                        merged.themeColors = [storedData.accentColor, c2];
                    }
                    const nl = storedData.nitroLevel ?? 0;
                    const since = getMonthsAgo(NITRO_MONTHS[nl] ?? 0);
                    merged.premiumSince = since;

                    const bm = storedData.boostMonths ?? -1;
                    if (bm >= 0) {
                        const boostSince = getMonthsAgo(BOOST_MONTHS[bm] ?? 1);
                        merged.premiumGuildSince = boostSince;
                    } else {
                        merged.premiumGuildSince = null;
                    }
                } else {
                    merged.premiumSince = null;
                    merged.premiumGuildSince = null;
                }

                merged.publicFlags = (storedData.badgeFlags != null) ? storedData.badgeFlags : profile.publicFlags;
            } else if (isEnabled && storedData.nitro === false) {
                merged.premiumType = profile.premiumType ?? 0;
                merged.premiumSince = profile.premiumSince ?? null;
                merged.premiumGuildSince = profile.premiumGuildSince ?? null;
            } else {
                if (profile.premiumType) merged.premiumType = profile.premiumType;
                if (profile.premiumSince) merged.premiumSince = profile.premiumSince;
                if (profile.premiumGuildSince) merged.premiumGuildSince = profile.premiumGuildSince;
            }

            const replacesBadges = storedData.badgeFlags != null || storedData.nitro === true;
            const badges = replacesBadges ? [] : [...(profile.badges ?? [])];
            const badgeIds = new Set(badges.map(badge => badge.id));

            for (const badge of BADGES) {
                if (!((storedData.badgeFlags ?? 0) & badge.flag) || badgeIds.has(badge.id)) continue;
                badges.push({
                    id: badge.id,
                    description: badge.label,
                    icon: badge.icon.split("/").pop()?.replace(".png", ""),
                    link: badge.link
                });
                badgeIds.add(badge.id);
            }

            const nitroLevel = storedData.nitroLevel ?? -1;
            if (storedData.nitro && nitroLevel >= 0 && nitroLevel < NITRO_LEVELS.length) {
                const months = NITRO_MONTHS[nitroLevel];
                const id = months === 0 ? "premium" : `premium_tenure_${months}_month_v2`;
                if (!badgeIds.has(id)) {
                    badges.push({
                        id,
                        description: `Subscriber since ${getMonthsAgo(months).toLocaleDateString()}`,
                        icon: NITRO_LEVELS[nitroLevel].icon.split("/").pop()?.replace(".png", ""),
                        link: "https://discord.com/nitro"
                    });
                    badgeIds.add(id);
                }
            }

            const boostLevel = storedData.boostMonths ?? -1;
            if (boostLevel >= 0 && boostLevel < BOOST_ICONS.length) {
                const id = `guild_booster_lvl${boostLevel + 1}`;
                if (!badgeIds.has(id)) {
                    badges.push({
                        id,
                        description: `Server boosting since ${getMonthsAgo(BOOST_MONTHS[boostLevel]).toLocaleDateString()}`,
                        icon: BOOST_ICONS[boostLevel].split("/").pop()?.replace(".png", ""),
                        link: "https://discord.com/settings/premium"
                    });
                    badgeIds.add(id);
                }
            }

            for (const badge of CUSTOM_BADGES) {
                if (!storedData.customBadgeIds?.includes(badge.id)) continue;
                const id = badge.id === "quest" ? "quest_completed" : badge.id === "orbs" ? "orb_profile_badge" : badge.id === "oldname" ? "legacy_username" : badge.id;
                if (badgeIds.has(id)) continue;
                badges.push({
                    id,
                    description: getCustomBadgeDescription(badge.id),
                    icon: badge.icon,
                    link: badge.id === "quest" ? "https://discord.com/settings/inventory" : "https://discord.com"
                });
                badgeIds.add(id);
            }

            if (replacesBadges || storedData.customBadgeIds?.length || boostLevel >= 0) merged.badges = badges;

            const result = mergeProfile(profile, merged);
            this._cachedProfileInput = profile;
            this._cachedProfile = result;
            this._cachedProfileVersion = _dataVersion;
            return result;
        } catch {
            return profile;
        }
    },

    fakeObfuscatedEmail(real: string | null) {
        if (!isEnabled || !storedData.email || !real) return real;
        const fake = storedData.email;
        const atIdx = fake.indexOf("@");
        if (atIdx <= 1) return fake;
        return fake[0] + "***" + fake.slice(atIdx - 1);
    },

    fakeObfuscatedPhone(real: string | null) {
        if (!isEnabled || !storedData.phone || !real) return real;
        const fake = storedData.phone;
        if (fake.length < 4) return fake;
        return "***-***-" + fake.slice(-4);
    },

    patchBannerUrl({ displayProfile }: any) {
        try {
            const uid = displayProfile?.userId;
            if (!uid) return null;

            if (isEnabled && storedData.nitro && storedData.banner && isMe(uid)) {
                return storedData.banner;
            }

            return null;
        } catch { return null; }
    },

    get toolboxActions() {
        if (settings.store.hideFromToolbox) return {};

        return {
            [t("Open LarpCord")]: openLarpCord,
        };
    },

    _origExtractTimestamp: null as any,
    _forceNative: false,

    async start() {
        await loadData();
        updateCachedRealData();
        applyAvatarPatchEarly();

        try {
            const US = (Vencord as any).Webpack?.findByProps?.("getCurrentUser", "getUser");
            if (US && !US._cp_perfect_hook) {
                const origCurrent = US.getCurrentUser.bind(US);
                const origGet = US.getUser.bind(US);
                US._cp_orig_getCurrentUser = origCurrent;
                US._cp_orig_getUser = origGet;

                let _lastRealUser: any = null;
                let _lastFakeResult: any = null;
                let _lastCacheVersion = -1;

                US.getCurrentUser = () => {
                    const realUser = origCurrent();
                    if (realUser) {
                        if (realUser === _lastRealUser && _lastCacheVersion === _dataVersion && _lastFakeResult) {
                            return _lastFakeResult;
                        }
                        _lastRealUser = realUser;
                        _lastCacheVersion = _dataVersion;
                        _lastFakeResult = this.fakeCurrentUser(realUser);
                        return _lastFakeResult;
                    }
                    return this.fakeCurrentUser(realUser);
                };

                US.getUser = (id: string) => {
                    const user = origGet(id);
                    if (!user) return user;

                    if (isEnabled && isMe(id)) {
                        return this.fakeCurrentUser(user);
                    }

                    return user;
                };
                US._cp_perfect_hook = true;
            }
        } catch { }

        try {
            const GMS = (Vencord as any).Webpack?.findByProps?.("getMember", "getMembers", "getMemberIds");
            if (GMS && !GMS._cp_member_hook) {
                const origGetMember = GMS.getMember.bind(GMS);
                GMS.getMember = (guildId: string, userId: string) => {
                    const member = origGetMember(guildId, userId);
                    if (!member) return member;

                    if (isEnabled && isMe(userId)) {
                        const patched = { ...member };
                        if (storedData.username) patched.nick = storedData.globalName || storedData.username;
                        return patched;
                    }

                    return member;
                };
                GMS._cp_member_hook = true;
                GMS._cp_orig_getMember = origGetMember;
            }
        } catch { }

        try {
            const UPS = (Vencord as any).Webpack?.findByProps?.("getUserProfile", "getGuildMemberProfile");
            if (UPS?._cp_profile_hook && UPS._cp_orig_getUserProfile) {
                UPS.getUserProfile = UPS._cp_orig_getUserProfile;
                if (UPS._cp_orig_getGuildMemberProfile) UPS.getGuildMemberProfile = UPS._cp_orig_getGuildMemberProfile;
                delete UPS._cp_profile_hook;
                delete UPS._cp_orig_getUserProfile;
                delete UPS._cp_orig_getGuildMemberProfile;
            }
            if (UPS && (!UPS._cp_profile_hook || !UPS._cp_orig_getUserProfile)) {
                const origGetProfile = UPS.getUserProfile.bind(UPS);
                UPS._cp_orig_getUserProfile = origGetProfile;
                UPS.getUserProfile = (userId: string) => {
                    try {
                        const profile = origGetProfile(userId);
                        if (!userId) return profile;

                        if (isEnabled && isMe(userId) && profile) {
                            return this.hookUserProfile(profile);
                        }

                        return profile;
                    } catch (e) {
                        console.error("[LarpCord] Error in getUserProfile hook:", e);
                        return origGetProfile(userId);
                    }
                };
                const origGetGuild = UPS.getGuildMemberProfile.bind(UPS);
                UPS._cp_orig_getGuildMemberProfile = origGetGuild;
                UPS.getGuildMemberProfile = (userId: string, guildId: string) => {
                    try {
                        const profile = origGetGuild(userId, guildId);
                        if (!userId) return profile;

                        if (isEnabled && isMe(userId) && profile) {
                            return this.hookUserProfile(profile);
                        }

                        return profile;
                    } catch (e) {
                        console.error("[LarpCord] Error in getGuildMemberProfile hook:", e);
                        return origGetGuild(userId, guildId);
                    }
                };
                UPS._cp_profile_hook = true;
            }
        } catch { }

        try {
            const WP = (Vencord as any).Webpack;
            const MAS = WP?.findByProps?.("getUsers", "getValidUsers", "getHasLoggedInAccounts");
            if (MAS && !MAS._cp_perfect_hook) {
                function patchAccountUser(u: any) {
                    if (!u?.id) return u;
                    const acctData = allAccountsData[u.id];
                    const acctEnabled = allAccountsEnabled[u.id];
                    if (!acctData || !acctEnabled) return u;
                    const patched: any = { ...u };
                    if (acctData.username) patched.username = acctData.username;
                    if (acctData.globalName) patched.globalName = acctData.globalName;
                    return patched;
                }

                if (MAS.getUsers) {
                    const origGetUsers = MAS.getUsers.bind(MAS);
                    MAS._cp_orig_getUsers = origGetUsers;
                    MAS.getUsers = () => {
                        const users = origGetUsers();
                        if (!users || !Array.isArray(users)) return users;
                        return users.map(patchAccountUser);
                    };
                }

                if (MAS.getValidUsers) {
                    const origGetValid = MAS.getValidUsers.bind(MAS);
                    MAS._cp_orig_getValidUsers = origGetValid;
                    MAS.getValidUsers = () => {
                        const users = origGetValid();
                        if (!users || !Array.isArray(users)) return users;
                        return users.map(patchAccountUser);
                    };
                }

                MAS._cp_perfect_hook = true;
                try { MAS.emitChange?.(); } catch { }
            }
        } catch { }

        try {
            if (SnowflakeUtils?.extractTimestamp && !this._origExtractTimestamp) {
                this._origExtractTimestamp = SnowflakeUtils.extractTimestamp;
                const origExtract = this._origExtractTimestamp;
                (SnowflakeUtils as any).extractTimestamp = (snowflake: string) => {
                    if (isEnabled && storedData.createdAt && isMe(snowflake)) {
                        return new Date(storedData.createdAt + "T12:00:00Z").getTime();
                    }
                    return origExtract(snowflake);
                };
            }
        } catch { }

        try {
            const decoMod = (Vencord as any).Webpack?.findByProps?.("getAvatarDecorationURL");
            if (decoMod?.getAvatarDecorationURL && !_avatarDecorationOrig) {
                const origDeco = decoMod.getAvatarDecorationURL.bind(decoMod);
                _avatarDecorationModule = decoMod;
                _avatarDecorationOrig = origDeco;
                decoMod.getAvatarDecorationURL = (opts: any) => {
                    try {
                        const { avatarDecoration, userId, canAnimate } = opts ?? {};

                        if (isEnabled && storedData.decorationAsset) {
                            const storedAsset = getString(storedData.decorationAsset);
                            const myId = UserStore.getCurrentUser()?.id;
                            const isOurs = (avatarDecoration?.skuId === "__fake__")
                                || (avatarDecoration?.asset === storedAsset)
                                || (userId && userId === myId);
                            if (isOurs && storedAsset) {
                                const asset = storedAsset;
                                const dec = AVATAR_DECORATIONS.find(d => d.id === asset);
                                const passthrough = dec ? (dec as any).passthrough : asset.startsWith("a_");
                                return getDecorationUrl(asset, passthrough);
                            }
                        }

                    } catch { }
                    return origDeco(opts);
                };
            }
        } catch { }

    },

    stop() {
        if (this._origExtractTimestamp && SnowflakeUtils) {
            (SnowflakeUtils as any).extractTimestamp = this._origExtractTimestamp;
            this._origExtractTimestamp = null;
        }
        if (_avatarModule && _avatarPatchOrig) {
            _avatarModule.getUserAvatarURL = _avatarPatchOrig;
            _avatarModule = null;
            _avatarPatchOrig = null;
            _avatarPatchApplied = false;
        }
        if (_avatarDecorationModule && _avatarDecorationOrig) {
            _avatarDecorationModule.getAvatarDecorationURL = _avatarDecorationOrig;
            _avatarDecorationModule = null;
            _avatarDecorationOrig = null;
        }
        try {
            const US = (Vencord as any).Webpack?.findByProps?.("getCurrentUser", "getUser");
            if (US?._cp_perfect_hook) {
                if (US._cp_orig_getCurrentUser) US.getCurrentUser = US._cp_orig_getCurrentUser;
                if (US._cp_orig_getUser) US.getUser = US._cp_orig_getUser;
                delete US._cp_perfect_hook;
                delete US._cp_orig_getCurrentUser;
                delete US._cp_orig_getUser;
            }
        } catch { }
        try {
            const MAS = (Vencord as any).Webpack?.findByProps?.("getUsers", "getValidUsers", "getHasLoggedInAccounts");
            if (MAS?._cp_perfect_hook) {
                if (MAS._cp_orig_getUsers) MAS.getUsers = MAS._cp_orig_getUsers;
                if (MAS._cp_orig_getValidUsers) MAS.getValidUsers = MAS._cp_orig_getValidUsers;
                delete MAS._cp_perfect_hook;
                delete MAS._cp_orig_getUsers;
                delete MAS._cp_orig_getValidUsers;
            }
        } catch { }
        try {
            const GMS = (Vencord as any).Webpack?.findByProps?.("getMember", "getMembers", "getMemberIds");
            if (GMS?._cp_member_hook) {
                if (GMS._cp_orig_getMember) GMS.getMember = GMS._cp_orig_getMember;
                delete GMS._cp_member_hook;
                delete GMS._cp_orig_getMember;
            }
        } catch { }
        try {
            const UPS = (Vencord as any).Webpack?.findByProps?.("getUserProfile", "getGuildMemberProfile");
            if (UPS?._cp_profile_hook) {
                if (UPS._cp_orig_getUserProfile) UPS.getUserProfile = UPS._cp_orig_getUserProfile;
                if (UPS._cp_orig_getGuildMemberProfile) UPS.getGuildMemberProfile = UPS._cp_orig_getGuildMemberProfile;
                delete UPS._cp_profile_hook;
                delete UPS._cp_orig_getUserProfile;
                delete UPS._cp_orig_getGuildMemberProfile;
            }
        } catch { }
        try {
            const myUser = UserStore.getCurrentUser() as any;
            if (myUser) {
                try { delete myUser.avatarDecoration; } catch { }
                try { delete myUser.avatarDecorationData; } catch { }
            }
        } catch { }
    },

    settingsAboutComponent() {
        return <Button onClick={openLarpCord}>Open LarpCord</Button>;
    },
});
