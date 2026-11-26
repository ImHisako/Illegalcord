/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import type { OnlineStatus } from "@vencord/discord-types";
import { ChannelStore, NavigationRouter, PresenceStore, UserStore } from "@webpack/common";

import { logStalkerEvent, settings, targets } from ".";

const lastStatuses = new Map<string, OnlineStatus>();

const NOTIFICATION_COLOR = "#5865f2";

const shouldNotifyForTransition = (lastStatus: OnlineStatus, newStatus: OnlineStatus): boolean => {
    if (lastStatus === "offline" && settings.store.notifyGoOnline) return true;
    if (newStatus === "dnd" && settings.store.notifyDnd) return true;
    if (newStatus === "idle" && settings.store.notifyIdle) return true;
    if (newStatus === "online" && settings.store.notifyOnline) return true;
    if (newStatus === "offline" && settings.store.notifyOffline) return true;
    return false;
};

const formatStatus = (status: OnlineStatus): string =>
    status === "dnd" ? "in dnd" : status;

export const init = () => {
    for (const id of targets) lastStatuses.set(id, PresenceStore.getStatus(id));
    PresenceStore.addChangeListener(statusChange);
};

export const deinit = () => {
    PresenceStore.removeChangeListener(statusChange);
    lastStatuses.clear();
};

export const statusChange = () => {
    for (const id of targets) {
        const newStatus = PresenceStore.getStatus(id);
        const lastStatus = lastStatuses.get(id) ?? newStatus;

        if (lastStatus === newStatus) continue;
        lastStatuses.set(id, newStatus);

        const user = UserStore.getUser(id);
        if (!user) continue;

        if (shouldNotifyForTransition(lastStatus, newStatus)) {
            showNotification({
                title: "Stalker",
                body: `${user.username} is now ${formatStatus(newStatus)}`,
                color: NOTIFICATION_COLOR,
                icon: user.getAvatarURL(),
                onClick: () => {
                    const channelId = ChannelStore.getDMFromUserId(user.id);
                    if (channelId) NavigationRouter.transitionTo(`/channels/@me/${channelId}`);
                },
            });
        }

        if (settings.store.enableLogging) logStalkerEvent({
            timestamp: new Date().toISOString(),
            userId: user.id,
            username: user.username,
            action: "status_change",
            details: `Status changed from ${lastStatus} to ${newStatus}.`
        });
    }
};
