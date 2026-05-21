/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import definePlugin from "@utils/types";
import type { Guild } from "@vencord/discord-types";
import { Menu, openModal, React } from "@webpack/common";

import { CloneModal } from "./components/CloneModal";
import { showUpdateModal } from "./components/UpdateModal";
import { PLUGIN_VERSION, UPDATE_CHECK_ENABLED, UPDATE_CHECK_URL } from "./constants";
import { cloneServer } from "./core/clone";
import { settings } from "./settings";
import { state } from "./store";
import { compareVersions } from "./utils/helpers";
import { cleanupContainer } from "./utils/notifications";

async function checkForUpdates(): Promise<void> {
    if (!UPDATE_CHECK_ENABLED) return;

    try {
        const lastDismissed = await DataStore.get("ServerCloner-dismissed-version") as string | undefined;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(UPDATE_CHECK_URL, {
            signal: controller.signal,
            headers: { "Accept": "application/vnd.github.v3+json" }
        });

        clearTimeout(timeoutId);

        if (!response.ok) return;

        const data = await response.json();
        let latestVersion = data.tag_name || data.name || "";
        latestVersion = latestVersion.replace(/^v/i, "").trim();

        if (!latestVersion) return;

        const comparison = compareVersions(latestVersion, PLUGIN_VERSION);

        if (comparison > 0 && lastDismissed !== latestVersion) {
            const releaseNotes = data.body || "No release notes available.";
            showUpdateModal(latestVersion, releaseNotes);
        }
    } catch (e) {
        console.warn("[ServerCloner] Update check failed:", e);
    }
}

const guildContextMenuPatch: NavContextMenuPatchCallback = (children: any[], props: { guild?: Guild; }) => {
    if (!props?.guild) return;
    const { guild } = props;

    const group = findGroupChildrenByChildId("privacy", children);
    const menuItem = (
        <Menu.MenuItem
            id="clone-server-pro"
            label="Clone Server"
            action={() => {
                openModal(modalProps => (
                    <CloneModal
                        props={modalProps}
                        guild={guild}
                        onClone={options => cloneServer(guild, options)}
                    />
                ));
            }}
        />
    );

    if (group) {
        group.push(menuItem);
    } else {
        children.push(<Menu.MenuGroup>{menuItem}</Menu.MenuGroup>);
    }
};

export default definePlugin({
    name: "ServerCloner",
    description: "Clone servers with channels, roles, permissions and community features",
    authors: [{ name: "Moret", id: 1449096170646536233n }],
    tags: ["Utility", "Customisation"],
    settings,

    start() {
        setTimeout(() => checkForUpdates(), 5000);
    },

    stop() {
        cleanupContainer();
        if (state.abortController) {
            state.abortController.abort();
            state.abortController = null;
        }
        state.isCloning = false;
        state.mainProgressNotificationId = null;
        state.currentCloneGuildId = null;
        state.skipRolesCallback = null;
    },

    patches: [
        {
            find: '"GuildChannelStore"',
            replacement: [
                {
                    match: /isChannelGated\(.+?\)(?=&&)/,
                    replace: (m: string) => `${m}&&false`
                }
            ]
        }
    ],

    contextMenus: {
        "guild-context": guildContextMenuPatch,
        "guild-header-popout": guildContextMenuPatch
    }
});
