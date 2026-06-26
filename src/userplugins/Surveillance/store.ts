/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";

import type { SurveillanceEvent, SurveillanceScope } from "./types";

const STORE_KEY = "Illegalcord_Surveillance_events";
const MIN_EVENTS = 50;
const LOAD_SAVE_DELAY = 3_000;
const SAVE_DELAY = 750;
const logger = new Logger("Surveillance");
const listeners = new Set<() => void>();

let events: SurveillanceEvent[] = [];
let pendingEvents: SurveillanceEvent[] = [];
let loaded = false;
let loading: Promise<SurveillanceEvent[]> | undefined;
let notifyQueued = false;
let loadSaveTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

const flushNotify = () => {
    notifyQueued = false;

    for (const listener of listeners) {
        listener();
    }
};

const notify = () => {
    if (notifyQueued) return;

    notifyQueued = true;
    void Promise.resolve().then(flushNotify);
};

export const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const getEvents = () =>
    pendingEvents.length ? [...pendingEvents, ...events] : events;

const persistEvents = () =>
    DataStore.set(STORE_KEY, events).catch(error => logger.error("Failed to save surveillance events:", error));

const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);

    saveTimer = setTimeout(() => {
        saveTimer = undefined;
        void persistEvents();
    }, SAVE_DELAY);
};

const scheduleLoadSave = (limit: number) => {
    if (loadSaveTimer) clearTimeout(loadSaveTimer);

    loadSaveTimer = setTimeout(() => {
        loadSaveTimer = undefined;
        void loadEvents(limit);
    }, LOAD_SAVE_DELAY);
};

const persistNow = async () => {
    if (loadSaveTimer) {
        clearTimeout(loadSaveTimer);
        loadSaveTimer = undefined;
    }

    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = undefined;
    }

    await persistEvents();
};

const trimToLimit = (nextEvents: SurveillanceEvent[], limit?: number) => {
    if (limit == null) return nextEvents;

    return nextEvents.slice(0, Math.max(MIN_EVENTS, limit));
};

const applyPendingEvents = (limit?: number) => {
    if (!pendingEvents.length) return false;

    events = trimToLimit([...pendingEvents, ...events], limit);
    pendingEvents = [];
    return true;
};

const applyLimit = async (limit?: number) => {
    const hadPendingEvents = applyPendingEvents(limit);
    const trimmedEvents = trimToLimit(events, limit);
    if (trimmedEvents.length === events.length && !hadPendingEvents) return;

    events = trimmedEvents;
    await persistNow();
    notify();
};

export async function loadEvents(limit?: number) {
    if (loaded) {
        await applyLimit(limit);
        return events;
    }

    if (loading) {
        await loading;
        await applyLimit(limit);
        return events;
    }

    loading = DataStore.get<SurveillanceEvent[]>(STORE_KEY)
        .then(async savedEvents => {
            const saved = Array.isArray(savedEvents) ? savedEvents : [];
            const hadPendingEvents = pendingEvents.length > 0;
            events = trimToLimit([...pendingEvents, ...saved], limit);
            pendingEvents = [];
            loaded = true;
            notify();
            if (hadPendingEvents || events.length !== saved.length) await persistEvents();
            return events;
        })
        .catch(error => {
            logger.error("Failed to load surveillance events:", error);
            events = trimToLimit(pendingEvents, limit);
            pendingEvents = [];
            loaded = true;
            notify();
            return events;
        });

    return loading;
}

export async function recordEvent(event: SurveillanceEvent, limit: number) {
    if (!loaded) {
        pendingEvents = [event, ...pendingEvents].slice(0, Math.max(MIN_EVENTS, limit));
        notify();
        scheduleLoadSave(limit);
        return;
    }

    events = [event, ...events].slice(0, Math.max(MIN_EVENTS, limit));
    notify();
    scheduleSave();
}

const matchesScope = (event: SurveillanceEvent, scope: SurveillanceScope) =>
    scope === "server" ? event.scope === "server" : event.scope !== "server";

export async function clearEvents(scope?: SurveillanceScope) {
    if (scope) {
        events = events.filter(event => !matchesScope(event, scope));
        pendingEvents = pendingEvents.filter(event => !matchesScope(event, scope));
    } else {
        events = [];
        pendingEvents = [];
    }

    loaded = true;
    await persistNow();
    notify();
}

export async function trimEvents(limit: number) {
    await loadEvents(limit);
    events = events.slice(0, Math.max(MIN_EVENTS, limit));
    await persistNow();
    notify();
}

export function clearTimers() {
    if (loadSaveTimer) {
        clearTimeout(loadSaveTimer);
        loadSaveTimer = undefined;
    }
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = undefined;
    }
}
