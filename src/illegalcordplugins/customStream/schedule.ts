/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const FIRST_UPLOAD_DELAY = 1_000;
export const UPLOAD_INTERVAL = 300_000;
export const RETRY_INTERVAL = 60_000;

export interface UploaderState {
    readonly running: boolean;
    readonly runningSince: number;
    readonly streamKey: string | null;
    readonly sentAt: number;
    readonly sentImageId: string | null;
    readonly failedAt: number;
    readonly rateLimited: boolean;
    readonly paused: boolean;
}

export const IDLE_UPLOADER: UploaderState = {
    running: false,
    runningSince: 0,
    streamKey: null,
    sentAt: 0,
    sentImageId: null,
    failedAt: 0,
    rateLimited: false,
    paused: false
};

export function nextUploadAt(state: UploaderState): number | null {
    if (!state.running) return null;

    const latest = Math.max(state.runningSince, state.sentAt, state.failedAt);
    if (state.failedAt > 0 && latest === state.failedAt) return state.failedAt + RETRY_INTERVAL;
    if (state.sentAt > 0 && latest === state.sentAt) return state.sentAt + UPLOAD_INTERVAL;
    return state.runningSince + FIRST_UPLOAD_DELAY;
}

export function isRateLimitError(error: unknown): boolean {
    const text = typeof error === "string" ? error : String((error as { message?: unknown; })?.message ?? error ?? "");
    return text.includes("retry_after");
}

export interface PlaybackOptions {
    readonly slideshow: boolean;
    readonly random: boolean;
    readonly hold: boolean;
}

export function shouldHold(currentId: string | null, lastSentId: string | null, picked: boolean): boolean {
    return picked || currentId == null || currentId !== lastSentId;
}

export function nextIndex(count: number, current: number, options: PlaybackOptions, peekRandom: () => number): number {
    if (count <= 0) return -1;

    const safeCurrent = current >= 0 && current < count ? current : 0;
    if (options.hold || !options.slideshow || count === 1) return safeCurrent;
    if (!options.random) return (safeCurrent + 1) % count;

    const picked = peekRandom();
    return picked >= 0 && picked < count ? picked : (safeCurrent + 1) % count;
}

export function shuffledIds(ids: readonly string[], avoidFirst: string | null, random: () => number = Math.random): string[] {
    const result = [...ids];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }

    if (result.length > 1 && result[0] === avoidFirst) {
        [result[0], result[result.length - 1]] = [result[result.length - 1], result[0]];
    }
    return result;
}
