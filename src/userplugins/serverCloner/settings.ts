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
    }
});
