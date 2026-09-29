/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BackupRestoreIcon } from "@components/Icons";
import SettingsPlugin from "@plugins/_core/settings";
import { EquicordDevs } from "@utils/constants";
import { LazyComponent } from "@utils/lazyReact";
import { removeFromArray } from "@utils/misc";
import definePlugin from "@utils/types";
import { SettingsRouter } from "@webpack/common";

const key = "illegalcord_config_editor";
const SettingsPage = LazyComponent(() => require("./SettingsPage").default);

export default definePlugin({
    name: "ConfigEditor",
    description: "Edit client settings live, create named backups and remove unused plugin configuration.",
    authors: [EquicordDevs.irritably],
    toolboxActions: {
        "Open Config Editor": () => SettingsRouter.openUserSettings(`${key}_panel`)
    },
    start() {
        SettingsPlugin.customEntries.push({ key, title: "Config Editor", Component: SettingsPage, Icon: BackupRestoreIcon });
    },
    stop() {
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === key);
    }
});
