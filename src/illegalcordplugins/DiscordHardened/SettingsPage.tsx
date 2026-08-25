/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isSettingHidden } from "@api/PluginManager";
import { useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab, wrapTab } from "@components/settings";
import { OptionComponentMap } from "@components/settings/tabs/plugins/components";
import { Margins } from "@utils/margins";
import { React } from "@webpack/common";

import { settings } from "./index";

type SettingKey = keyof typeof settings.def;

interface SettingsGroup {
    title: string;
    description: string;
    keys: readonly SettingKey[];
}

const PLUGIN_SETTINGS_PATHS: Array<"plugins.DiscordHardened.*"> = ["plugins.DiscordHardened.*"];
const SETTINGS_GROUPS = [
    {
        title: "Network protection",
        description: "Controls Discord telemetry, tracking endpoints, typing requests, and the additional GoofCord firewall.",
        keys: [
            "blockTelemetry",
            "blockSentry",
            "blockTracing",
            "blockTypingIndicator",
            "blockFingerprinting",
            "goofCordFirewall",
            "customFirewallRules",
            "firewallBlocklist",
            "firewallBlockedPatterns",
            "firewallAllowedPatterns",
            "logBlockedRequests",
        ],
    },
    {
        title: "Browser identity",
        description: "Reduces the identifying information exposed by Chromium and Electron.",
        keys: [
            "hideElectronUserAgent",
            "spoofChrome",
            "spoofWindows",
            "reduceHardwareFingerprint",
            "stripThirdPartyReferrers",
            "disableWebGl",
        ],
    },
    {
        title: "Microphone and media",
        description: "Protects microphone tracks, push-to-talk, media-device discovery, camera access, and screen capture.",
        keys: [
            "allowCamera",
            "allowMicrophone",
            "privatePushToTalk",
            "lockMicrophoneWhenMuted",
            "blockMicrophoneOutsideCalls",
            "releaseMicrophoneOnDisconnect",
            "lockPttOnWindowBlur",
            "maximumPttSeconds",
            "allowDisplayCapture",
            "blockUnauthorizedLegacyCapture",
            "allowDeviceEnumeration",
            "allowSpeakerSelection",
        ],
    },
    {
        title: "Browser permissions",
        description: "Restricts browser capabilities that Discord normally does not need for chat and voice.",
        keys: [
            "blockNotifications",
            "allowFullscreen",
            "allowBackgroundSync",
            "allowClipboardWrite",
            "allowClipboardRead",
            "blockGeolocation",
            "blockGamepadAccess",
            "blockBatteryAccess",
            "blockUnsafeExternalProtocols",
        ],
    },
    {
        title: "Desktop proxy",
        description: "Optionally routes the desktop client through a credential-free Electron proxy.",
        keys: ["proxy", "proxyRules", "proxyBypassRules"],
    },
] satisfies readonly SettingsGroup[];

interface SettingRowProps {
    settingKey: SettingKey;
    pluginSettings: ReturnType<typeof useSettings>["plugins"][string];
}

function SettingRow({ settingKey, pluginSettings }: SettingRowProps) {
    const setting = settings.def[settingKey];
    if (isSettingHidden(settings, setting)) return null;

    const Component = OptionComponentMap[setting.type];

    return (
        <ErrorBoundary noop>
            <Component
                id={settingKey}
                setting={setting}
                onChange={(value: unknown) => pluginSettings[settingKey] = value}
                pluginSettings={pluginSettings}
                definedSettings={settings}
                closePluginSettings={() => undefined}
            />
        </ErrorBoundary>
    );
}

function DiscordHardenedSettings() {
    const pluginSettings = useSettings(PLUGIN_SETTINGS_PATHS).plugins.DiscordHardened;

    return (
        <SettingsTab>
            <Heading tag="h2">DiscordHardened</Heading>
            <Paragraph className={Margins.bottom20}>
                Privacy and security controls adapted from WebCord and GoofCord for Illegalcord. Settings marked for restart take effect after Discord restarts.
            </Paragraph>

            {SETTINGS_GROUPS.map(group => (
                <section key={group.title} className={Margins.bottom20}>
                    <Heading tag="h3">{group.title}</Heading>
                    <Paragraph className={Margins.bottom8}>{group.description}</Paragraph>
                    <div className="vc-plugins-settings">
                        {group.keys.map(settingKey => (
                            <SettingRow key={settingKey} settingKey={settingKey} pluginSettings={pluginSettings} />
                        ))}
                    </div>
                </section>
            ))}
        </SettingsTab>
    );
}

export default wrapTab(DiscordHardenedSettings, "DiscordHardened");
