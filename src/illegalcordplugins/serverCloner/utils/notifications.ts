/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { popNotice, showNotice } from "@api/Notices";
import { showNotification } from "@api/Notifications";
import { Constants, RestAPI } from "@webpack/common";

import { state } from "../store";

let progressNoticeOpen = false;
let progressTitle = "";
let progressBody = "";
let progressExistingServer = false;
let progressUpdateTimeout: ReturnType<typeof setTimeout> | undefined;

export function formatElapsed(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return mins === 0 ? `${secs}s` : `${mins}m ${secs}s`;
}

export function notify(title: string, body: string, type: "success" | "info" | "error" = "info"): void {
    void showNotification({
        title,
        body,
        color: type === "error" ? "var(--status-danger)" : type === "success" ? "var(--status-positive)" : undefined,
        noPersist: true
    });
}

async function cancelClone(isExistingServer: boolean): Promise<void> {
    state.isCloning = false;
    state.abortController?.abort();
    state.abortController = null;

    const guildId = state.currentCloneGuildId;
    if (!isExistingServer && guildId) {
        try {
            await RestAPI.del({ url: Constants.Endpoints.GUILD(guildId) });
            notify("Clone cancelled", "The incomplete server was deleted.", "info");
        } catch {
            notify("Clone cancelled", "The incomplete server could not be deleted.", "error");
        }
    } else {
        notify("Clone cancelled", "No more items will be copied.", "info");
    }

    state.currentCloneGuildId = null;
    cleanupContainer();
}

function renderProgressNotice(): void {
    if (!progressNoticeOpen) return;
    popNotice();
    showNotice(`${progressTitle}. ${progressBody}`, progressExistingServer ? "Cancel" : "Cancel and delete", () => {
        void cancelClone(progressExistingServer);
    });
}

export function createMainProgressNotification(title: string, initialBody: string, isExistingServer: boolean): string {
    state.cloneStartTime = Date.now();
    progressNoticeOpen = true;
    progressTitle = title;
    progressBody = initialBody;
    progressExistingServer = isExistingServer;
    showNotice(`${title}. ${initialBody}`, isExistingServer ? "Cancel" : "Cancel and delete", () => {
        void cancelClone(isExistingServer);
    });
    return "server-cloner-progress";
}

export function cleanupContainer(): void {
    if (progressUpdateTimeout !== undefined) {
        clearTimeout(progressUpdateTimeout);
        progressUpdateTimeout = undefined;
    }
    if (!progressNoticeOpen) return;
    progressNoticeOpen = false;
    popNotice();
}

export function completeMainProgress(_id: string, body: string, success: boolean): void {
    const elapsed = state.cloneStartTime === null ? "" : ` Completed in ${formatElapsed(Date.now() - state.cloneStartTime)}.`;
    const punctuation = /[.!?]$/.test(body) ? "" : ".";
    state.cloneStartTime = null;
    cleanupContainer();
    notify(success ? "Server clone complete" : "Server clone failed", `${body}${punctuation}${elapsed}`, success ? "success" : "error");
}

export function updateProgress(percent: number, message?: string): void {
    if (!progressNoticeOpen) return;
    const elapsed = state.cloneStartTime === null ? "" : ` • ${formatElapsed(Date.now() - state.cloneStartTime)}`;
    progressBody = `${Math.round(percent)}%${message ? ` • ${message}` : ""}${elapsed}`;
    if (progressUpdateTimeout !== undefined) return;
    progressUpdateTimeout = setTimeout(() => {
        progressUpdateTimeout = undefined;
        renderProgressNotice();
    }, 250);
}

export function updateWithTime(message: string, percent: number): void {
    updateProgress(percent, message);
}
