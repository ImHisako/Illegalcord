/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const state = {
    isCloning: false,
    abortController: null as AbortController | null,
    mainProgressNotificationId: null as string | null,
    currentCloneGuildId: null as string | null,
    emojiIdMap: {} as Record<string, string>,
    cloneStartTime: null as number | null,
    cloneErrors: [] as string[],
};

export function throwIfCancelled(): void {
    if (!state.isCloning || state.abortController?.signal.aborted) {
        throw new Error("Cancelled");
    }
}
