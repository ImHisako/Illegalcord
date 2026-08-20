/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";

import { GITHUB_RELEASE_URL, PLUGIN_VERSION } from "../constants";

export function showUpdateModal(version: string, releaseNotes: string): void {
    const body = releaseNotes
        .replace(/#{1,6}\s/g, "")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .trim()
        .slice(0, 180);

    void showNotification({
        title: `ServerCloner ${version} is available`,
        body: `${body || "No release notes available."} Current version: ${PLUGIN_VERSION}.`,
        noPersist: true,
        onClick: () => VencordNative.native.openExternal(GITHUB_RELEASE_URL)
    });
}
