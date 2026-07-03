/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { VersionDisplay } from "./components/VersionDisplay";

export const settings = definePluginSettings({
    versionInfo: {
        type: OptionType.COMPONENT,
        description: "",
        component: VersionDisplay
    },
    concurrencyLimit: {
        type: OptionType.SLIDER,
        description: "Cloning Speed (Concurrent API requests) - Higher is faster but may trigger more temporary rate limits. Recommended: 3-6.",
        default: 5,
        markers: [1, 2, 4, 6, 8, 10, 12],
        stickToMarkers: true
    }
});
