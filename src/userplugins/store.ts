/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";

import type { SurveillanceEvent } from "./types";

const STORE_KEY = "Illegalcord_Surveillance_events";
const logger = new Logger("Surveillance");
const listeners = new Set<() => void>();

let events: SurveillanceEvent[] = [];
let loaded = false;
let loading: Promise<SurveillanceEvent[]> | undefined;

const notify = () => {
    for (const listener of listeners) {
        listener();
    }
};

export const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const getEvents = () => events;

export async function loadEvents() {
    if (loaded) return events;
    if (loading) return loading;

    loading = DataStore.get<SurveillanceEvent[]>(STORE_KEY)
        .then(savedEvents => {
            events = Array.isArray(savedEvents) ? savedEvents : [];
            loaded = true;
            notify();
            return events;
        })
        .catch(error => {
            logger.error("Failed to load surveillance events:", error);
            events = [];
            loaded = true;
            notify();
            return events;
        });

    return loading;
}

export async function recordEvent(event: SurveillanceEvent, limit: number) {
    await loadEvents();

    events = [event, ...events].slice(0, Math.max(50, limit));
    await DataStore.set(STORE_KEY, events);
    notify();
}

export async function clearEvents() {
    events = [];
    loaded = true;
    await DataStore.set(STORE_KEY, events);
    notify();
}

export async function trimEvents(limit: number) {
    await loadEvents();
    events = events.slice(0, Math.max(50, limit));
    await DataStore.set(STORE_KEY, events);
    notify();
}
