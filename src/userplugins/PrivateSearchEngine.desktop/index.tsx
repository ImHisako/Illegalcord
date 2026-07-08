/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";
import type { SVGProps } from "react";

const Native = VencordNative?.pluginHelpers?.PrivateSearchBrowser as PluginNative<typeof import("./native")> | undefined;
const SEARCH_ENGINE_SETTING_KEYS: Array<"searchEngine"> = ["searchEngine"];

const settings = definePluginSettings({
    searchEngine: {
        type: OptionType.SELECT,
        description: "Search engine used by the private browser window.",
        options: [
            { label: "Qwant", value: "qwant", default: true },
            { label: "Searloc", value: "searloc" },
            { label: "Araa", value: "araa" },
            { label: "Degoog", value: "degoog" },
            { label: "Heexy", value: "heexy" }
        ] as const
    },
    hardenFingerprinting: {
        type: OptionType.BOOLEAN,
        description: "Reduce fingerprinting without spoofing browser values that break search engines.",
        default: true
    },
    spoofBrowserInfo: {
        type: OptionType.BOOLEAN,
        description: "Spoof browser values, APIs, canvas, fonts, audio, and speech voices for leak tests.",
        default: false
    },
    fingerprintMode: {
        type: OptionType.SELECT,
        description: "Choose how spoofed fingerprint values are rotated. (Broken)",
        options: [
            { label: "Semi random", value: "semiRandom", default: true },
            { label: "Always random", value: "random" },
            { label: "Unique", value: "unique" }
        ] as const
    },
    blockTrackers: {
        type: OptionType.BOOLEAN,
        description: "Block common analytics, ads, tracking, and fingerprinting hosts.",
        default: true
    },
    antiPopups: {
        type: OptionType.BOOLEAN,
        description: "Block spam pop-ups and suspicious new-window redirects.",
        default: true
    },
    loadUblockOrigin: {
        type: OptionType.BOOLEAN,
        description: "Load the latest uBlock Origin Chromium build from GitHub releases.",
        default: true
    },
    unpackedExtensionPath: {
        type: OptionType.STRING,
        description: "Absolute unpacked extension folder to load in the private browser window.",
        default: ""
    },
    mullvadDnsProfile: {
        type: OptionType.SELECT,
        description: "Mullvad DNS-over-HTTPS profile used by the private browser window.",
        options: [
            { label: "Base: ads, trackers, malware", value: "base", default: true },
            { label: "DNS: no content blocking", value: "dns" },
            { label: "Adblock: ads, trackers", value: "adblock" },
            { label: "Extended: ads, trackers, malware, social media", value: "extended" },
            { label: "Family: ads, trackers, malware, adult, gambling", value: "family" },
            { label: "All: ads, trackers, malware, adult, gambling, social media", value: "all" }
        ] as const
    }
});

function StartpageIcon({ width = 20, height = 20, className }: SVGProps<SVGSVGElement> & { size?: string; }) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M10.75 18.5a7.75 7.75 0 1 1 0-15.5 7.75 7.75 0 0 1 0 15.5Z" stroke="currentColor" strokeWidth="2" />
            <path d="m16.5 16.5 4.25 4.25" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
            <path d="M7.75 9.25a3.25 3.25 0 0 1 6 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
    );
}

async function openSearchBrowser() {
    if (!Native) {
        showToast("Private Search native helper is unavailable.", Toasts.Type.FAILURE);
        return;
    }

    const result = await Native.openSearchEngine(settings.store.searchEngine, settings.store.hardenFingerprinting, settings.store.spoofBrowserInfo, settings.store.fingerprintMode, settings.store.blockTrackers, settings.store.antiPopups, settings.store.mullvadDnsProfile, settings.store.loadUblockOrigin, settings.store.unpackedExtensionPath);
    if (!result.success) showToast(result.error ?? "Could not open Private Search.", Toasts.Type.FAILURE);
}

async function openBrowserLeaksTest() {
    if (!Native) {
        showToast("Private Search native helper is unavailable.", Toasts.Type.FAILURE);
        return;
    }

    const result = await Native.openBrowserLeaks(settings.store.searchEngine, settings.store.hardenFingerprinting, settings.store.spoofBrowserInfo, settings.store.fingerprintMode, settings.store.blockTrackers, settings.store.antiPopups, settings.store.mullvadDnsProfile, settings.store.loadUblockOrigin, settings.store.unpackedExtensionPath);
    if (!result.success) showToast(result.error ?? "Could not open BrowserLeaks.", Toasts.Type.FAILURE);
}

function StartpageBrowserButton() {
    const { searchEngine } = settings.use(SEARCH_ENGINE_SETTING_KEYS);

    return (
        <HeaderBarButton
            icon={StartpageIcon}
            tooltip={`Private Search: ${searchEngine}`}
            onClick={openSearchBrowser}
        />
    );
}

const SafeStartpageBrowserButton = ErrorBoundary.wrap(StartpageBrowserButton, { noop: true });

export default definePlugin({
    name: "PrivateSearchBrowser",
    description: "Opens a hardened private search window.",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    dependencies: ["HeaderBarAPI"],
    enabledByDefault: true,
    settings,
    headerBarButton: {
        icon: StartpageIcon,
        render: () => <SafeStartpageBrowserButton />,
        priority: 8
    },
    toolboxActions: {
        "Open Private Search": openSearchBrowser,
        "Open BrowserLeaks Test": openBrowserLeaksTest
    }
});
