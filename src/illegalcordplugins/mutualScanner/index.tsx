/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { ClockIcon, MagnifyingGlassIcon } from "@components/Icons";
import SettingsPlugin from "@plugins/_core/settings";
import { Devs } from "@utils/constants";
import { LazyComponent } from "@utils/lazyReact";
import { removeFromArray } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { UserStore } from "@webpack/common";

import RuntimeActivityButton from "../_kamidereCompat/RuntimeActivityButton";
import { resetMutualScannerRuntime } from "./runtime";

const MUTUAL_SCANNER_SETTINGS_KEY = "kamidere_mutual_scanner";
const HEADER_BAR_SETTINGS: ["showActivityButton"] = ["showActivityButton"];
const MutualScannerTab = LazyComponent(() => require("./MutualScannerTab").default);
let activeUserId: string | undefined;

const settings = definePluginSettings({
    showActivityButton: {
        type: OptionType.BOOLEAN,
        displayName: "Kamidere Activity",
        description: "Show the Kamidere Activity icon next to the Equicord toolbox.",
        default: false,
    },
});

const ActivityButton = ErrorBoundary.wrap(() => {
    const { showActivityButton } = settings.use(HEADER_BAR_SETTINGS);
    return showActivityButton ? <RuntimeActivityButton /> : null;
}, { noop: true });

function onAccountChange() {
    const userId = UserStore.getCurrentUser()?.id;
    if (userId === activeUserId) return;
    activeUserId = userId;
    resetMutualScannerRuntime();
}

function unregisterMutualScannerSettingsTab() {
    while (SettingsPlugin.customEntries.some(entry => entry.key === MUTUAL_SCANNER_SETTINGS_KEY)) {
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === MUTUAL_SCANNER_SETTINGS_KEY);
    }
}

function registerMutualScannerSettingsTab() {
    unregisterMutualScannerSettingsTab();

    SettingsPlugin.customEntries.push({
        key: MUTUAL_SCANNER_SETTINGS_KEY,
        title: "Kamidere Mutual Scanner",
        Component: MutualScannerTab,
        Icon: MagnifyingGlassIcon,
    });
}

export default definePlugin({
    name: "MutualScanner",
    description: "Scans selected servers for members that share at least one mutual friend with your account and saves the results locally.",
    authors: [Devs.clrxxo],
    dependencies: ["Settings", "HeaderBarAPI"],
    enabledByDefault: true,
    tags: ["Friends", "Utility"],
    requiresRestart: false,
    settings,
    headerBarButton: {
        icon: ClockIcon,
        render: () => <ActivityButton />
    },

    start() {
        activeUserId = UserStore.getCurrentUser()?.id;
        UserStore.addChangeListener(onAccountChange);
        registerMutualScannerSettingsTab();
    },

    stop() {
        UserStore.removeChangeListener(onAccountChange);
        resetMutualScannerRuntime();
        unregisterMutualScannerSettingsTab();
    },
});
