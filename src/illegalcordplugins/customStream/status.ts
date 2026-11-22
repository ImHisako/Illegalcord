/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { formatDuration } from "./format";
import type { Messages } from "./locales/en";
import { nextUploadAt, type UploaderState } from "./schedule";

export type AirTone = "live" | "idle" | "warning";

export interface AirStatus {
    tone: AirTone;
    headline: string;
    detail: string;
}

export interface AirInputs {
    now: number;
    live: boolean;
    previewDisabled: boolean;
    replaceEnabled: boolean;
    imageCount: number;
    uploader: UploaderState;
    sentLabel: string | null;
    upcomingLabel: string | null;
    pendingLabel?: string | null;
    connecting?: boolean;
}

function describeOffline({ replaceEnabled, imageCount, upcomingLabel }: AirInputs, text: Messages): AirStatus {
    const headline = text.notLive;
    if (!replaceEnabled) return { tone: "idle", headline, detail: text.offlineReplaceOff };
    if (imageCount === 0 || !upcomingLabel) return { tone: "idle", headline, detail: text.offlineNoImages };
    return { tone: "idle", headline, detail: text.offlineFirst(upcomingLabel) };
}

function describeNext({ now, sentLabel, upcomingLabel }: AirInputs, due: number | null, text: Messages): string {
    const upcoming = upcomingLabel && upcomingLabel !== sentLabel ? upcomingLabel : null;
    if (due === null) return text.nextUpdateUnknown(upcoming);
    return text.nextUpdate(due > now ? formatDuration(due - now) : null, upcoming);
}

export function describeAir(rawInputs: AirInputs, text: Messages): AirStatus {
    const { uploader } = rawInputs;
    const inputs = { ...rawInputs, now: Math.max(rawInputs.now, uploader.sentAt, uploader.failedAt) };
    const { now, live, previewDisabled, sentLabel } = inputs;

    if (!live) return describeOffline(inputs, text);

    if (previewDisabled) {
        return { tone: "warning", headline: text.livePreviewOff, detail: text.previewOffDetail };
    }

    const seen = uploader.sentAt > 0 ? (sentLabel ? text.viewersSee(sentLabel) : text.viewersSeeScreen) : null;

    if (uploader.paused && !(inputs.replaceEnabled && inputs.imageCount > 0)) {
        return { tone: "warning", headline: text.streamPaused, detail: text.pausedDetail(seen) };
    }

    if (!uploader.running) {
        return { tone: "live", headline: text.live, detail: inputs.connecting ? text.connecting : describeNext(inputs, null, text) };
    }

    const due = nextUploadAt(uploader);

    if (uploader.failedAt > 0 && uploader.failedAt >= uploader.sentAt) {
        const retryIn = due !== null && due > now ? formatDuration(due - now) : null;
        if (!seen) {
            return { tone: "warning", headline: text.uploadFailed, detail: text.failedNoPreview(retryIn, uploader.rateLimited) };
        }
        return {
            tone: sentLabel ? "live" : "warning",
            headline: seen,
            detail: text.sentDetail(formatDuration(now - uploader.sentAt), text.retryNote(retryIn, uploader.rateLimited))
        };
    }

    if (!seen) {
        return { tone: "live", headline: text.live, detail: text.sending(inputs.pendingLabel ?? null) };
    }

    return {
        tone: sentLabel ? "live" : "warning",
        headline: seen,
        detail: text.sentDetail(formatDuration(now - uploader.sentAt), describeNext(inputs, due, text))
    };
}
