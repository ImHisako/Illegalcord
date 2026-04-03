/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { ChannelStore, NavigationRouter, PresenceStore, UserStore } from "@webpack/common";

import { logStalkerEvent, settings, targets } from ".";

type Statuses = Record<string, string>;

let lastStatuses: Statuses | undefined;

const shouldNotifyForTransition = (lastStatus: string, newStatus: string): boolean => {
    if (lastStatus === "offline" && settings.store.notifyGoOnline) return true;
    if (newStatus === "dnd" && settings.store.notifyDnd) return true;
    if (newStatus === "idle" && settings.store.notifyIdle) return true;
    if (newStatus === "online" && settings.store.notifyOnline) return true;
    if (newStatus === "offline" && settings.store.notifyOffline) return true;
    return false;
};

const formatStatus = (status: string): string =>
    status === "dnd" ? "in dnd" : status;

export const init = () => {
    PresenceStore.addChangeListener(statusChange);
};

export const deinit = () => {
    PresenceStore.removeChangeListener(statusChange);
    lastStatuses = undefined;
};

export const statusChange = () => {
    const rawNewStatuses: Statuses = PresenceStore.getState()?.statuses;
    if (typeof rawNewStatuses !== "object") return;

    const newStatuses: Statuses = { ...rawNewStatuses };

    // Assicura che gli utenti stalked offline siano esplicitamente "offline"
    for (const id of targets) {
        if (!newStatuses[id]) newStatuses[id] = "offline";
    }

    // Prima inizializzazione: memorizza lo stato attuale senza notificare
    if (!lastStatuses) {
        lastStatuses = { ...newStatuses };
        return;
    }

    for (const id of targets) {
        const newStatus = newStatuses[id] ?? "offline";
        const lastStatus = lastStatuses[id] ?? "offline";

        if (lastStatus === newStatus) continue;

        if (shouldNotifyForTransition(lastStatus, newStatus)) {
            const user = UserStore.getUser(id);
            if (!user) continue;

            showNotification({
                title: "Stalker",
                body: `${user.username} is now ${formatStatus(newStatus)}`,
                color: `#${user.accentColor?.toString(16)}`,
                icon: user.getAvatarURL(),
                onClick: () => {
                    NavigationRouter.transitionTo(`/channels/@me/${ChannelStore.getDMFromUserId(user.id)}`);
                },
            });

            logStalkerEvent({
                timestamp: new Date().toISOString(),
                userId: user.id,
                username: user.username,
                action: "status_change",
                details: `Status changed from ${lastStatus} to ${newStatus}`
            });
        }
    }

    lastStatuses = { ...newStatuses };
};
