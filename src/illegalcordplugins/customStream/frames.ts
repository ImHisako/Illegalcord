/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface VideoFrame {
    data: Uint8ClampedArray;
    width: number;
    height: number;
}

export interface FrameSource {
    getNextVideoOutputFrame(streamId: string): Promise<VideoFrame | null | undefined>;
}

export const FRAME_TIMEOUT = 15_000;
const MAX_FRAME_ATTEMPTS = 60;

export const PLACEHOLDER_FRAME: VideoFrame = { data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 };

function hasPixels(frame: VideoFrame | null | undefined): frame is VideoFrame {
    if (!frame?.data?.length) return false;

    const { data } = frame;
    if (data.byteOffset % 4 === 0 && data.byteLength % 4 === 0) {
        return new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4).some(pixel => pixel !== 0);
    }
    return data.some(value => value !== 0);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for a stream frame")), ms);
        promise.then(
            value => { clearTimeout(timer); resolve(value); },
            error => { clearTimeout(timer); reject(error); }
        );
    });
}

export async function captureFrame(source: FrameSource, streamId: string, now: () => number = Date.now): Promise<VideoFrame> {
    const deadline = now() + FRAME_TIMEOUT;

    for (let attempt = 0; attempt < MAX_FRAME_ATTEMPTS; attempt++) {
        const left = deadline - now();
        if (left <= 0) break;

        const frame = await withTimeout(source.getNextVideoOutputFrame(streamId), left);
        if (hasPixels(frame)) return frame;
    }

    throw new Error("The stream gave no usable frame, the window may be minimized");
}
