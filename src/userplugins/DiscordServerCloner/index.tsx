import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { ModalProps, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { Guild } from "@vencord/discord-types";
import { Menu, React } from "@webpack/common";
import { DataStore } from "@api/index";

import "./styles.css";

import { PLUGIN_VERSION, UPDATE_CHECK_ENABLED, UPDATE_CHECK_URL } from "./constants";
import { settings } from "./settings";
import { showUpdateModal } from "./components/UpdateModal";
import { CloneModal } from "./components/CloneModal";
import { cloneServer } from "./core/clone";
import { state } from "./store";
import { cleanupContainer } from "./utils/notifications";
import { compareVersions } from "./utils/helpers";

async function checkForUpdates(): Promise<void> {
    if (!UPDATE_CHECK_ENABLED) return;

    try {
        const lastDismissed = await DataStore.get("ServerCloner-dismissed-version") as string | undefined;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(UPDATE_CHECK_URL, {
            signal: controller.signal,
            headers: { 'Accept': 'application/vnd.github.v3+json' }
        });

        clearTimeout(timeoutId);

        if (!response.ok) return;

        const data = await response.json();
        let latestVersion = data.tag_name || data.name || "";
        latestVersion = latestVersion.replace(/^v/i, '').trim();

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

    const group = findGroupChildrenByChildId("privacy", children);
    const menuItem = (
        <Menu.MenuItem
            id="clone-server-pro"
            label="Clone Server"
            action={() => {
                openModal((modalProps: ModalProps) => (
                    <CloneModal
                        props={modalProps}
                        guild={props.guild!}
                        onClone={(options) => cloneServer(props.guild!, options)}
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
    authors: [{ name: "Moret", id: "1172069050424250432" }],
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
