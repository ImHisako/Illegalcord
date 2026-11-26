/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";

import { findImage, loadImage, type StoredImage } from "./library";
import { makeThumbnail } from "./media";
import { logger } from "./utils";

const GENERATE_CONCURRENCY = 2;

export const thumbKey = (id: string) => `CustomStreamTopQ_Thumb_${id}`;

const urls = new Map<string, string>();
const jobs = new Map<string, Promise<string>>();
let generation = 0;

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

const generateQueue: { start(): void; cancel(): void; }[] = [];
let generating = 0;

function queued(task: () => Promise<Blob | undefined>, run: number): Promise<Blob | undefined> {
    return new Promise((resolve, reject) => {
        const start = () => {
            if (run !== generation) return resolve(undefined);
            generating++;
            task().then(resolve, reject).finally(() => {
                generating--;
                generateQueue.shift()?.start();
            });
        };

        if (generating < GENERATE_CONCURRENCY) start();
        else generateQueue.push({ start, cancel: () => resolve(undefined) });
    });
}

function remember(id: string, thumb: Blob, run: number): string {
    if (run !== generation || !findImage(id)) return "";
    const existing = urls.get(id);
    if (existing) return existing;

    const url = URL.createObjectURL(thumb);
    urls.set(id, url);
    return url;
}

async function storedOrFresh(image: StoredImage, run: number): Promise<string> {
    const stored = await readStored(image.id);
    if (run !== generation || !findImage(image.id)) return "";
    if (stored) return remember(image.id, stored, run);

    const thumb = await queued(async () => {
        const blob = await loadImage(image);
        return run === generation && findImage(image.id) ? makeThumbnail(blob) : undefined;
    }, run);
    if (!thumb || run !== generation || !findImage(image.id)) return "";
    DataStore.set(thumbKey(image.id), thumb).catch(error => logger.error("Could not save a thumbnail", error));
    return remember(image.id, thumb, run);
}

export function peekThumb(id: string): string | undefined {
    return urls.get(id);
}

export function loadThumb(image: StoredImage): Promise<string> {
    const ready = urls.get(image.id);
    if (ready) return Promise.resolve(ready);

    let job = jobs.get(image.id);
    if (!job) {
        job = storedOrFresh(image, generation).finally(() => {
            if (jobs.get(image.id) === job) jobs.delete(image.id);
        });
        jobs.set(image.id, job);
    }
    return job;
}

export function dropThumbs(ids: Iterable<string>) {
    for (const id of ids) {
        const url = urls.get(id);
        if (url) URL.revokeObjectURL(url);
        urls.delete(id);
    }
}

export function forgetAllThumbs() {
    generation++;
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
    jobs.clear();
    for (const task of generateQueue) task.cancel();
    generateQueue.length = 0;
    for (const waiting of readBatch.values()) for (const resolve of waiting) resolve(undefined);
    readBatch.clear();
}
