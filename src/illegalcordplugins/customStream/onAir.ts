/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { UserStore } from "@webpack/common";

import { getActiveProfile, libraryChanged, Profile, setCurrentIndex, StoredImage } from "./library";
import { toUploadDataUrl } from "./media";
import { IDLE_UPLOADER, isRateLimitError, nextIndex, shouldHold, shuffledIds, UploaderState } from "./schedule";
import { settings, settingsChanged } from "./settings";
import { createEmitter, logger } from "./utils";

const DATA_URI_CACHE_SIZE = 3;
const LAST_SENT_KEY = "CustomStreamTopQ_LastSent";

export const airChanged = createEmitter();

let uploader: UploaderState = IDLE_UPLOADER;
let sentImage: StoredImage | null = null;
let pending: { image: StoredImage | null; } | null = null;
let lastSentId: string | null = null;
let picked = false;
let bag: { profileId: string; ids: string[]; } = { profileId: "", ids: [] };
let lastReturned: string | null = null;
const dataUris = new Map<string, string>();

export function getUploader(): UploaderState {
    return uploader;
}

export function getSentImage(): StoredImage | null {
    return sentImage;
}

export function getPendingImage(): StoredImage | null {
    return pending?.image ?? null;
}

function setUploader(next: UploaderState) {
    uploader = next;
    airChanged.emit();
}

export function streamKeyOf(guildId: string | null | undefined, channelId: string, ownerId: string): string {
    return guildId ? `guild:${guildId}:${channelId}:${ownerId}` : `call:${channelId}:${ownerId}`;
}

export function onUploaderStarted(streamKey: string | null) {
    const sameStream = streamKey != null && streamKey === uploader.streamKey;
    if (!sameStream) {
        sentImage = null;
        pending = null;
    }

    setUploader({
        ...(sameStream ? uploader : IDLE_UPLOADER),
        running: true,
        runningSince: Date.now(),
        streamKey,
        failedAt: 0,
        rateLimited: false,
        paused: uploader.paused
    });
    schedulePrepare();
}

export function onUploaderStopped() {
    pending = null;
    if (uploader.running) setUploader({ ...uploader, running: false });
}

export function onStreamEnded() {
    pending = null;
    sentImage = null;
    setUploader({ ...IDLE_UPLOADER, paused: uploader.paused });
}

export function onVideoStateChanged(paused: boolean) {
    if (uploader.paused !== paused) setUploader({ ...uploader, paused });
}

export function onUploadDone() {
    if (!pending) return;

    sentImage = pending.image;
    pending = null;
    if (sentImage) rememberSent(sentImage.id);
    setUploader({ ...uploader, running: true, sentAt: Date.now(), sentImageId: sentImage?.id ?? null, failedAt: 0, rateLimited: false });
}

function rememberSent(id: string) {
    const profile = getActiveProfile();
    if (profile.images[profile.currentIndex]?.id === id) picked = false;
    schedulePrepare();
    if (id === lastSentId) return;

    lastSentId = id;
    DataStore.set(LAST_SENT_KEY, id).catch(error => logger.error("Could not save the last sent image", error));
}

export function onUploadFailed(error?: unknown) {
    pending = null;
    setUploader({ ...uploader, running: true, failedAt: Date.now(), rateLimited: isRateLimitError(error) });
}

export function isOwnStreamEvent(event: { streamKey?: string; } | undefined): boolean {
    const ownerId = event?.streamKey?.split(":").at(-1);
    return ownerId != null && ownerId === UserStore.getCurrentUser()?.id;
}

export function willSendCustom(): boolean {
    if (!settings.store.replaceEnabled) return false;
    return getActiveProfile().images.some(image => dataUris.has(image.id));
}

function peekShuffled(profile: Profile): string | null {
    const liveIds = new Set(profile.images.map(image => image.id));
    let ids = bag.profileId === profile.id ? bag.ids.filter(id => liveIds.has(id)) : [];

    if (ids.length === 0) {
        const currentId = profile.images[profile.currentIndex]?.id ?? null;
        ids = shuffledIds([...liveIds], currentId);
    }

    bag = { profileId: profile.id, ids };
    return ids[0] ?? null;
}

export function getUpcomingIndex(profile: Profile = getActiveProfile()): number {
    return upcomingAfter(profile, pending?.image?.id ?? lastSentId);
}

function upcomingAfter(profile: Profile, sentId: string | null): number {
    return nextIndex(
        profile.images.length,
        profile.currentIndex,
        {
            slideshow: settings.store.slideshowEnabled,
            random: settings.store.slideshowRandom,
            hold: shouldHold(profile.images[profile.currentIndex]?.id ?? null, sentId, picked)
        },
        () => {
            const id = peekShuffled(profile);
            return id ? profile.images.findIndex(image => image.id === id) : -1;
        }
    );
}

export function chooseImage(index: number) {
    const profile = getActiveProfile();
    if (index < 0 || index >= profile.images.length) return;

    picked = true;
    void setCurrentIndex(profile.id, index);
    airChanged.emit();
    schedulePrepare();
}

function rememberDataUri(id: string, uri: string) {
    dataUris.delete(id);
    dataUris.set(id, uri);
    while (dataUris.size > DATA_URI_CACHE_SIZE) {
        const oldest = dataUris.keys().next().value;
        if (oldest === undefined) break;
        dataUris.delete(oldest);
    }
}

async function prepareUpcoming(): Promise<void> {
    if (!settings.store.replaceEnabled) return;

    const profile = getActiveProfile();
    const image = profile.images[getUpcomingIndex(profile)];
    if (!image || dataUris.has(image.id)) return;

    try {
        rememberDataUri(image.id, await toUploadDataUrl(image.blob));
    } catch (error) {
        logger.error("Could not prepare the next preview image", error);
    }
}

let prepareQueued = false;

function schedulePrepare() {
    if (prepareQueued) return;
    prepareQueued = true;
    queueMicrotask(() => {
        prepareQueued = false;
        void prepareUpcoming();
    });
}

function markPending(image: StoredImage | null) {
    pending = { image };
    setUploader(uploader.running ? { ...uploader } : { ...uploader, running: true, runningSince: Date.now() });
}

export function pickThumbnail(makeOriginal: () => string): string {
    const profile = getActiveProfile();
    const upcoming = settings.store.replaceEnabled ? profile.images[upcomingAfter(profile, lastSentId)] : undefined;

    let chosen = upcoming && dataUris.has(upcoming.id) ? upcoming : undefined;
    if (upcoming && !chosen) {
        chosen = profile.images.find(image => dataUris.has(image.id));
        logger.warn("The next image was not ready yet, sending a prepared one instead");
    }

    if (!chosen) {
        const original = makeOriginal();
        markPending(null);
        lastReturned = original;
        return original;
    }

    const chosenId = chosen.id;
    if (bag.profileId === profile.id) bag = { ...bag, ids: bag.ids.filter(id => id !== chosenId) };

    void setCurrentIndex(profile.id, profile.images.indexOf(chosen));
    markPending(chosen);
    schedulePrepare();

    const uri = dataUris.get(chosenId)!;
    lastReturned = uri;
    return uri;
}

export function ensureCustomThumbnail(value: string): string {
    return value === lastReturned ? value : pickThumbnail(() => value);
}

let unsubscribers: (() => void)[] = [];

async function loadLastSent() {
    try {
        const stored = await DataStore.get<string>(LAST_SENT_KEY);
        if (stored !== undefined) return stored;
    } catch (error) {
        logger.error("Could not read the last sent image", error);
    }

    const profile = getActiveProfile();
    return profile.images[profile.currentIndex]?.id ?? null;
}

export async function startOnAir() {
    lastSentId = await loadLastSent();
    unsubscribers = [
        libraryChanged.subscribe(schedulePrepare),
        settingsChanged.subscribe(() => {
            schedulePrepare();
            airChanged.emit();
        })
    ];
    return prepareUpcoming();
}

export function stopOnAir() {
    unsubscribers.forEach(unsubscribe => unsubscribe());
    unsubscribers = [];
    uploader = IDLE_UPLOADER;
    sentImage = null;
    pending = null;
    lastSentId = null;
    picked = false;
    bag = { profileId: "", ids: [] };
    lastReturned = null;
    dataUris.clear();
}
