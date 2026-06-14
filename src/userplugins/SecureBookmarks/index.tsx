/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { Logger } from "@utils/Logger";
import definePlugin, { ReporterTestable } from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { Menu, showToast, Toasts } from "@webpack/common";
import type { ReactElement } from "react";

import { renderSecureBookmarksToolboxMenu } from "./components";
import { settings } from "./settings";
import { DURATIONS, prepareBookmarks, saveMessageBookmark } from "./store";

const logger = new Logger("SecureBookmarks");

interface MessageContextMenuProps {
    message?: Message;
}

function addBookmarkMenu(children: Array<ReactElement | null>, props: MessageContextMenuProps): void {
    const { message } = props;
    if (!message) return;

    children.push(
        <Menu.MenuItem
            id="secure-bookmarks-save"
            key="secure-bookmarks-save"
            label="Save to SecureBookmarks"
        >
            {DURATIONS.map(duration => (
                <Menu.MenuItem
                    id={`secure-bookmarks-save-${duration.value}`}
                    key={duration.value}
                    label={duration.label}
                    action={() => {
                        void saveMessageBookmark(message, duration).catch(error => {
                            logger.error("Failed to save bookmark.", error);
                            showToast("Could not save this bookmark.", Toasts.Type.FAILURE);
                        });
                    }}
                />
            ))}
        </Menu.MenuItem>
    );
}

export default definePlugin({
    name: "SecureBookmarks",
    description: "Saves encrypted message bookmarks from the message context menu.",
    tags: ["Chat", "Privacy", "Utility"],
    authors: [{ name: "irritably", id: 928787166916640838n }],
    dependencies: ["EquicordToolbox"],
    reporterTestable: ReporterTestable.None,
    settings,

    contextMenus: {
        message: addBookmarkMenu
    },

    toolboxActions() {
        return renderSecureBookmarksToolboxMenu();
    },

    start() {
        void prepareBookmarks().catch(error => logger.error("Failed to prepare bookmarks.", error));
    }
});
