/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings, migrateOldSettingToNewPlugin, migratePluginSetting, migratePluginSettings, PlainSettings, SettingsStore } from "@api/Settings";
import { ShieldIcon } from "@components/Icons";
import SettingsPlugin from "@plugins/_core/settings";
import { EquicordDevs } from "@utils/constants";
import { LazyComponent } from "@utils/lazyReact";
import { Logger } from "@utils/Logger";
import { removeFromArray } from "@utils/misc";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { SettingsRouter } from "@webpack/common";

import { refreshCameraPrivacy, refreshMicrophonePrivacy, startMicrophonePrivacy, stopMicrophonePrivacy } from "./microphonePrivacy";
import { startHardening, stopHardening } from "./runtime";

const logger = new Logger("DiscordHardened");
const Native = VencordNative?.pluginHelpers?.DiscordHardened as PluginNative<typeof import("./native")> | undefined;
const SETTINGS_ENTRY_KEY = "illegalcord_discord_hardened";
const DiscordHardenedSettings = LazyComponent(() => require("./SettingsPage").default);

const DEFAULT_FIREWALL_URLS = [
    "https://*/api/v*/science",
    "https://*/api/v*/applications/detectable",
    "https://*/api/v*/auth/location-metadata",
    "https://*/api/v*/premium-marketing",
    "https://*/api/v*/scheduled-maintenances/upcoming.json",
    "https://*/error-reporting-proxy/*",
    "https://www.youtube.com/youtubei/v*/next?*",
    "https://www.youtube.com/s/desktop/*",
    "https://www.youtube.com/youtubei/v*/log_event?*",
].join("\n");

const DEFAULT_BLOCKED_PATTERNS = ["sentry", "google", "tracking", "stats", "\\.spotify", "pagead", "analytics", "doubleclick"].join("\n");
const DEFAULT_ALLOWED_PATTERNS = ["videoplayback", "discord-attachments", "googleapis", "search", "api.spotify", "discord.com/assets/sentry."].join("\n");

function validateRegexList(value: string): true | string {
    try {
        for (const pattern of value.split("\n").map(item => item.trim()).filter(Boolean)) new RegExp(pattern, "i");
        return true;
    } catch {
        return "Every firewall pattern must be a valid regular expression.";
    }
}

function validateProxyRules(value: string): true | string {
    if (!value.trim() || value.length > 4096 || /[\r\n\0@]/.test(value)) return "Enter credential-free Electron proxy rules.";
    return true;
}

function refreshCameraSettings(): void {
    refreshCameraPrivacy();
    refreshNativePrivacy();
}

function refreshMicrophoneSettings(): void {
    refreshMicrophonePrivacy();
    refreshNativePrivacy();
}

migratePluginSettings("DiscordHardened", "WebCordHardened");
migrateOldSettingToNewPlugin("WebRTCLeakPrevent", "icePolicy", "DiscordHardened", "webRtcIcePolicy");
migratePluginSetting("DiscordHardened", "questifyCompatibility", "questCompatibility");

const currentSettings = PlainSettings.plugins.DiscordHardened as Record<string, unknown> | undefined;
if (currentSettings && currentSettings.migrationVersion !== 1) {
    currentSettings.hideElectronUserAgent = false;
    currentSettings.spoofChrome = false;

    if (typeof currentSettings.firewallBlocklist === "string") {
        currentSettings.firewallBlocklist = currentSettings.firewallBlocklist
            .split("\n")
            .filter(rule => rule.trim() !== "https://cdn.discordapp.com/bad-domains/*")
            .join("\n");
    }

    currentSettings.migrationVersion = 1;
    SettingsStore.markAsChanged();
}

export const settings = definePluginSettings({
    migrationVersion: {
        type: OptionType.NUMBER,
        description: "The current settings migration version.",
        default: 1,
        hidden: true,
    },
    blockTelemetry: {
        type: OptionType.BOOLEAN,
        description: "Provide request-level telemetry blocking when NoTrack is unavailable.",
        default: true,
        hidden: () => isPluginEnabled("NoTrack"),
    },
    blockSentry: {
        type: OptionType.BOOLEAN,
        description: "Provide request-level Sentry blocking when NoTrack is unavailable.",
        default: true,
        hidden: () => isPluginEnabled("NoTrack"),
    },
    blockTracing: {
        type: OptionType.BOOLEAN,
        description: "Block Discord tracing requests not owned by NoTrack.",
        default: true,
    },
    blockTypingIndicator: {
        type: OptionType.BOOLEAN,
        description: "Block only your outgoing typing requests. Incoming TypingIndicator displays continue to work.",
        default: false,
    },
    blockFingerprinting: {
        type: OptionType.BOOLEAN,
        description: "Block the fingerprinting endpoints used by WebCord's privacy filter.",
        default: true,
    },
    hideElectronUserAgent: {
        type: OptionType.BOOLEAN,
        description: "Hide Electron and Discord version tokens from browser identification.",
        default: false,
        restartNeeded: true,
    },
    spoofChrome: {
        type: OptionType.BOOLEAN,
        description: "Use GoofCord's reduced Chrome identity for browser APIs and desktop request headers.",
        default: false,
        restartNeeded: true,
    },
    spoofWindows: {
        type: OptionType.BOOLEAN,
        description: "Report Windows instead of the current operating system. This can help with some VPN restrictions.",
        default: false,
        restartNeeded: true,
        hidden() { return !this.store.spoofChrome; },
    },
    questCompatibility: {
        type: OptionType.BOOLEAN,
        description: "Use Discord's original desktop request identity when claiming Quest rewards.",
        default: true,
        restartNeeded: true,
    },
    goofCordFirewall: {
        type: OptionType.BOOLEAN,
        description: "Enable GoofCord's additional tracker and telemetry firewall rules.",
        default: true,
    },
    customFirewallRules: {
        type: OptionType.BOOLEAN,
        description: "Show and customize the GoofCord firewall rule lists.",
        default: false,
    },
    firewallBlocklist: {
        type: OptionType.STRING,
        description: "URL wildcard patterns blocked by the GoofCord firewall, one per line.",
        default: DEFAULT_FIREWALL_URLS,
        multiline: true,
        hidden() { return !this.store.customFirewallRules; },
    },
    firewallBlockedPatterns: {
        type: OptionType.STRING,
        description: "Regular expressions blocked by the GoofCord firewall, one per line.",
        default: DEFAULT_BLOCKED_PATTERNS,
        multiline: true,
        isValid: validateRegexList,
        hidden() { return !this.store.customFirewallRules; },
    },
    firewallAllowedPatterns: {
        type: OptionType.STRING,
        description: "Regular expressions allowed through the GoofCord firewall, one per line.",
        default: DEFAULT_ALLOWED_PATTERNS,
        multiline: true,
        isValid: validateRegexList,
        hidden() { return !this.store.customFirewallRules; },
    },
    disableWebGl: {
        type: OptionType.BOOLEAN,
        description: "Disable WebGL contexts to reduce graphics fingerprinting. This can break hardware-accelerated content.",
        default: false,
    },
    allowCamera: {
        type: OptionType.BOOLEAN,
        description: "Allow web content to request camera access.",
        default: true,
        onChange: refreshCameraSettings,
    },
    allowMicrophone: {
        type: OptionType.BOOLEAN,
        description: "Allow web content to request microphone access.",
        default: true,
        onChange: refreshMicrophoneSettings,
    },
    privatePushToTalk: {
        type: OptionType.BOOLEAN,
        description: "Keep microphone tracks physically disabled unless push-to-talk is actively pressed.",
        default: true,
        onChange: refreshMicrophonePrivacy,
    },
    lockMicrophoneWhenMuted: {
        type: OptionType.BOOLEAN,
        description: "Keep microphone tracks disabled while your Discord microphone is muted.",
        default: true,
        onChange: refreshMicrophonePrivacy,
    },
    blockMicrophoneOutsideCalls: {
        type: OptionType.BOOLEAN,
        description: "Block microphone tracks outside calls. This also prevents voice message recording and microphone tests.",
        default: false,
        onChange: refreshMicrophonePrivacy,
    },
    releaseMicrophoneOnDisconnect: {
        type: OptionType.BOOLEAN,
        description: "Stop call microphone tracks when leaving voice so Chromium releases the capture device.",
        default: true,
        onChange: refreshMicrophonePrivacy,
    },
    lockPttOnWindowBlur: {
        type: OptionType.BOOLEAN,
        description: "Immediately lock push-to-talk when the Discord window loses focus.",
        default: true,
        onChange: refreshMicrophonePrivacy,
    },
    maximumPttSeconds: {
        type: OptionType.NUMBER,
        description: "Automatically lock the microphone after this many continuous push-to-talk seconds.",
        default: 60,
        isValid: (value: number) => value >= 5 && value <= 600 || "Enter a timeout between 5 and 600 seconds.",
        onChange: refreshMicrophonePrivacy,
    },
    allowDisplayCapture: {
        type: OptionType.BOOLEAN,
        description: "Allow web content to request screen sharing.",
        default: true,
    },
    blockUnauthorizedLegacyCapture: {
        type: OptionType.BOOLEAN,
        description: "Reject legacy mandatory capture constraints. Enable only if screen sharing still works on your Discord build.",
        default: false,
    },
    allowDeviceEnumeration: {
        type: OptionType.BOOLEAN,
        description: "Allow web content to list available media devices.",
        default: false,
    },
    allowSpeakerSelection: {
        type: OptionType.BOOLEAN,
        description: "Allow web content to request access to an audio output device.",
        default: false,
    },
    blockNotifications: {
        type: OptionType.BOOLEAN,
        description: "Block notification permission requests.",
        default: true,
    },
    allowFullscreen: {
        type: OptionType.BOOLEAN,
        description: "Allow web content to enter fullscreen mode.",
        default: true,
    },
    allowBackgroundSync: {
        type: OptionType.BOOLEAN,
        description: "Allow service workers to register background synchronization tasks.",
        default: false,
    },
    allowClipboardWrite: {
        type: OptionType.BOOLEAN,
        description: "Allow web content to write to the clipboard.",
        default: true,
    },
    allowClipboardRead: {
        type: OptionType.BOOLEAN,
        description: "Allow web content to read the clipboard without using the normal paste action.",
        default: false,
    },
    blockGeolocation: {
        type: OptionType.BOOLEAN,
        description: "Block browser geolocation requests.",
        default: true,
    },
    reduceHardwareFingerprint: {
        type: OptionType.BOOLEAN,
        description: "Report generic CPU and memory values to reduce hardware fingerprinting.",
        default: true,
    },
    blockGamepadAccess: {
        type: OptionType.BOOLEAN,
        description: "Prevent web content from enumerating connected gamepads.",
        default: true,
    },
    blockBatteryAccess: {
        type: OptionType.BOOLEAN,
        description: "Block access to battery status information.",
        default: true,
    },
    stripThirdPartyReferrers: {
        type: OptionType.BOOLEAN,
        description: "Remove the Discord page address from third-party fetch requests.",
        default: true,
    },
    blockUnsafeExternalProtocols: {
        type: OptionType.BOOLEAN,
        description: "Block window requests that use unsafe external protocols.",
        default: true,
    },
    logBlockedRequests: {
        type: OptionType.BOOLEAN,
        description: "Log requests blocked by this plugin without logging message or account data.",
        default: false,
    },
    proxy: {
        type: OptionType.BOOLEAN,
        description: "Route Discord traffic through an Electron proxy. Restart Discord after changing this setting.",
        default: false,
        restartNeeded: true,
        target: "DESKTOP",
    },
    proxyRules: {
        type: OptionType.STRING,
        description: "Electron proxy rules. Credentials are rejected and this value is excluded from shared configurations.",
        default: "127.0.0.1:8080",
        restartNeeded: true,
        target: "DESKTOP",
        isValid: validateProxyRules,
        hidden() { return !this.store.proxy; },
    },
    proxyBypassRules: {
        type: OptionType.STRING,
        description: "Electron proxy bypass rules. This value is excluded from shared configurations.",
        default: "<local>",
        restartNeeded: true,
        target: "DESKTOP",
        isValid: (value: string) => value.length <= 4096 && !/[\r\n\0@]/.test(value) || "Enter valid proxy bypass rules.",
        hidden() { return !this.store.proxy; },
    },
});

let nativeConfigured = false;
let lifecycleId = 0;
let nativeOperation = Promise.resolve();

function runNativeOperation(operation: () => Promise<void>): Promise<void> {
    nativeOperation = nativeOperation.then(operation, operation);
    return nativeOperation;
}

async function configureNative(currentLifecycleId: number): Promise<void> {
    if (!Native) return;

    await runNativeOperation(async () => {
        if (currentLifecycleId !== lifecycleId) return;

        try {
            const configured = await Native.configure(
                settings.store.hideElectronUserAgent,
                settings.store.spoofChrome,
                settings.store.spoofWindows,
                settings.store.questCompatibility,
                settings.store.proxy,
                settings.store.proxyRules,
                settings.store.proxyBypassRules,
                settings.store.allowCamera,
                settings.store.allowMicrophone
            );
            if (currentLifecycleId !== lifecycleId) {
                if (configured) await Native.restore();
                return;
            }

            nativeConfigured = configured;
        } catch (error) {
            logger.warn("Could not apply desktop privacy settings.", error);
        }
    });
}

function refreshNativePrivacy(): void {
    if (isPluginEnabled("DiscordHardened")) void configureNative(lifecycleId);
}

export default definePlugin({
    name: "DiscordHardened",
    description: "Ports WebCord's compatible privacy and security controls to Illegalcord.",
    tags: ["Privacy", "Utility", "Voice"],
    authors: [EquicordDevs.irritably],
    dependencies: ["WebRTCLeakPrevent"],
    enabledByDefault: true,
    settings,
    toolboxActions: {
        "Open DiscordHardened": () => SettingsRouter.openUserSettings(`${SETTINGS_ENTRY_KEY}_panel`),
    },

    async start() {
        const currentLifecycleId = ++lifecycleId;

        if (!SettingsPlugin.customEntries.some(entry => entry.key === SETTINGS_ENTRY_KEY)) {
            SettingsPlugin.customEntries.push({
                key: SETTINGS_ENTRY_KEY,
                title: "DiscordHardened",
                Component: DiscordHardenedSettings,
                Icon: ShieldIcon,
            });
        }

        startMicrophonePrivacy(settings.store);
        startHardening(settings.store);

        await configureNative(currentLifecycleId);
    },

    async stop() {
        lifecycleId++;
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === SETTINGS_ENTRY_KEY);
        stopHardening();
        stopMicrophonePrivacy();

        if (!Native) return;

        await runNativeOperation(async () => {
            if (!nativeConfigured) return;

            nativeConfigured = false;
            try {
                await Native.restore();
            } catch (error) {
                logger.warn("Could not restore desktop privacy settings.", error);
            }
        });
    },

    flux: {
        AUDIO_SET_MODE() {
            queueMicrotask(refreshMicrophonePrivacy);
        },
        AUDIO_SET_SELF_MUTE() {
            queueMicrotask(refreshMicrophonePrivacy);
        },
        AUDIO_TOGGLE_SELF_MUTE() {
            queueMicrotask(refreshMicrophonePrivacy);
        },
        VOICE_CHANNEL_SELECT() {
            queueMicrotask(refreshMicrophonePrivacy);
        },
        VOICE_STATE_UPDATES() {
            queueMicrotask(refreshMicrophonePrivacy);
        },
    },
});
