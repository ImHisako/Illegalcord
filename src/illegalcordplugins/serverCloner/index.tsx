/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Guild, RenderModalProps } from "@vencord/discord-types";
import { Menu, openModal, React } from "@webpack/common";

import { CloneModal } from "./components/CloneModal";
import { cloneServer } from "./core/clone";
import { settings } from "./settings";
import { state } from "./store";
import { cleanupContainer } from "./utils/notifications";

const guildContextMenuPatch: NavContextMenuPatchCallback = (children, props: { guild?: Guild; }) => {
    const { guild } = props;
    if (!guild) return;

    const group = findGroupChildrenByChildId("privacy", children);
    const menuItem = (
        <Menu.MenuItem
            id="clone-server-pro"
            label="Clone Server"
            action={() => {
                openModal((modalProps: RenderModalProps) => (
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
    description: "Clone servers with channels, roles, permissions and community features.",
    authors: [EquicordDevs.Block],
    tags: ["Utility", "Customisation"],
    settings,

    stop() {
        cleanupContainer();

        state.abortController?.abort();
        state.abortController = null;
        state.isCloning = false;
        state.mainProgressNotificationId = null;
        state.currentCloneGuildId = null;
    },

    contextMenus: {
        "guild-context": guildContextMenuPatch,
        "guild-header-popout": guildContextMenuPatch
    }
});
