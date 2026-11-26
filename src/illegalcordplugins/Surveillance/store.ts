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
let currentLimit = 1000;
let generation = 0;
let saving: Promise<void> | undefined;
let saveQueued = false;
let saveFailed = false;

const flushNotify = () => {
    notifyQueued = false;
    if (loaded) applyPendingEvents(currentLimit);

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
    pendingEvents.length ? [...pendingEvents].reverse().concat(events) : events;

const persistEvents = (): Promise<void> => {
    saveQueued = true;
    saving ??= Promise.resolve().then(async () => {
        while (saveQueued) {
            saveQueued = false;
            applyPendingEvents(currentLimit);
            await DataStore.set(STORE_KEY, events);
            saveFailed = false;
        }
    }).catch(error => {
        saveFailed = true;
        logger.error("Failed to save surveillance events:", error);
    }).finally(() => { saving = undefined; });
    return saving.then(() => saveQueued ? persistEvents() : undefined);
};

const scheduleSave = () => {
    if (saveTimer !== undefined) return;

    saveTimer = setTimeout(() => {
        saveTimer = undefined;
        void persistEvents();
    }, SAVE_DELAY);
};

const scheduleLoadSave = (limit: number) => {
    if (loadSaveTimer !== undefined) return;

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

    return nextEvents.slice(0, Number.isFinite(limit) ? Math.max(MIN_EVENTS, Math.trunc(limit)) : 1000);
};

const applyPendingEvents = (limit?: number) => {
    if (!pendingEvents.length) return false;

    events = trimToLimit([...pendingEvents].reverse().concat(events), limit);
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
    if (limit !== undefined) currentLimit = limit;
    if (loaded) {
        await applyLimit(limit);
        return events;
    }

    if (loading) {
        await loading;
        await applyLimit(limit);
        return events;
    }

    const run = generation;
    const job = DataStore.get<SurveillanceEvent[]>(STORE_KEY)
        .then(async savedEvents => {
            if (run !== generation) return [];
            const saved = Array.isArray(savedEvents) ? savedEvents : [];
            const hadPendingEvents = pendingEvents.length > 0;
            events = trimToLimit([...pendingEvents].reverse().concat(saved), currentLimit);
            pendingEvents = [];
            loaded = true;
            notify();
            if (hadPendingEvents || events.length !== saved.length) await persistEvents();
            return events;
        })
        .catch(error => {
            logger.error("Failed to load surveillance events:", error);
            if (run !== generation) return [];
            return getEvents();
        }).finally(() => { if (loading === job) loading = undefined; });

    loading = job;
    return loading;
}

export function recordEvent(event: SurveillanceEvent, limit: number) {
    currentLimit = limit;
    const maximum = Number.isFinite(limit) ? Math.max(MIN_EVENTS, Math.trunc(limit)) : 1000;
    pendingEvents.push(event);
    if (pendingEvents.length > maximum) pendingEvents.splice(0, pendingEvents.length - maximum);
    notify();
    if (loaded) scheduleSave();
    else scheduleLoadSave(limit);
}

const matchesScope = (event: SurveillanceEvent, scope: SurveillanceScope) =>
    scope === "server" ? event.scope === "server" : event.scope !== "server";

export async function clearEvents(scope?: SurveillanceScope) {
    await loadEvents(currentLimit);
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
}

export async function stopStore(limit: number) {
    const dirty = saveTimer !== undefined || loadSaveTimer !== undefined || pendingEvents.length > 0 || saveQueued || saveFailed;
    clearTimeout(saveTimer);
    clearTimeout(loadSaveTimer);
    saveTimer = undefined;
    loadSaveTimer = undefined;
    if (dirty) {
        await loadEvents(limit);
        if (!loaded) return;
        await persistNow();
    } else await saving;
    if (saveFailed) return;
    generation++;
    events = [];
    pendingEvents = [];
    loaded = false;
    loading = undefined;
}
