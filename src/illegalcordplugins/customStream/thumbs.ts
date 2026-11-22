/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";

import type { StoredImage } from "./library";
import { makeThumbnail } from "./media";
import { logger } from "./utils";

const GENERATE_CONCURRENCY = 2;

export const thumbKey = (id: string) => `CustomStreamTopQ_Thumb_${id}`;

const urls = new Map<string, string>();
const jobs = new Map<string, Promise<string>>();
const dropped = new Set<string>();

let readBatch = new Map<string, ((blob: Blob | undefined) => void)[]>();
let readScheduled = false;

function readStored(id: string): Promise<Blob | undefined> {
    return new Promise(resolve => {
        const waiting = readBatch.get(id);
        if (waiting) waiting.push(resolve);
        else readBatch.set(id, [resolve]);

        if (readScheduled) return;
        readScheduled = true;
        queueMicrotask(flushReads);
    });
}

async function flushReads() {
    readScheduled = false;
    const batch = readBatch;
    readBatch = new Map();

    const ids = [...batch.keys()];
    const settle = (id: string, blob: Blob | undefined) => batch.get(id)!.forEach(resolve => resolve(blob));
    try {
        const blobs = await DataStore.getMany<Blob | undefined>(ids.map(thumbKey));
        ids.forEach((id, i) => settle(id, blobs[i] instanceof Blob ? blobs[i] : undefined));
    } catch (error) {
        logger.error("Could not read stored thumbnails", error);
        ids.forEach(id => settle(id, undefined));
    }
}

const generateQueue: (() => void)[] = [];
let generating = 0;

function queued<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const start = () => {
            generating++;
            task().then(resolve, reject).finally(() => {
                generating--;
                generateQueue.shift()?.();
            });
        };

        if (generating < GENERATE_CONCURRENCY) start();
        else generateQueue.push(start);
    });
}

function remember(id: string, thumb: Blob): string {
    const existing = urls.get(id);
    if (existing) return existing;

    const url = URL.createObjectURL(thumb);
    if (dropped.has(id)) {
        URL.revokeObjectURL(url);
        return url;
    }
    urls.set(id, url);
    return url;
}

async function storedOrFresh(image: StoredImage): Promise<string> {
    const stored = await readStored(image.id);
    if (stored) return remember(image.id, stored);

    const thumb = await queued(() => makeThumbnail(image.blob));
    if (!dropped.has(image.id)) {
        DataStore.set(thumbKey(image.id), thumb).catch(error => logger.error("Could not save a thumbnail", error));
    }
    return remember(image.id, thumb);
}

export function peekThumb(id: string): string | undefined {
    return urls.get(id);
}

export function loadThumb(image: StoredImage): Promise<string> {
    const ready = urls.get(image.id);
    if (ready) return Promise.resolve(ready);

    let job = jobs.get(image.id);
    if (!job) {
        job = storedOrFresh(image).finally(() => jobs.delete(image.id));
        jobs.set(image.id, job);
    }
    return job;
}

let warmRun = 0;

const idle = () => new Promise<void>(resolve => requestIdleCallback(() => resolve(), { timeout: 5000 }));

export async function warmThumbs(images: readonly StoredImage[]): Promise<void> {
    const run = ++warmRun;
    await idle();
    if (run !== warmRun) return;

    const missing: StoredImage[] = [];
    await Promise.all(images.filter(image => !urls.has(image.id) && !jobs.has(image.id)).map(async image => {
        const stored = await readStored(image.id);
        if (stored) remember(image.id, stored);
        else missing.push(image);
    }));

    for (const image of missing) {
        await idle();
        if (run !== warmRun) return;
        await loadThumb(image).catch(error => logger.error("Could not prepare a thumbnail", error));
    }
}

export function dropThumbs(ids: Iterable<string>) {
    for (const id of ids) {
        dropped.add(id);
        const url = urls.get(id);
        if (url) URL.revokeObjectURL(url);
        urls.delete(id);
    }
}

export function forgetAllThumbs() {
    warmRun++;
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
    dropped.clear();
}
