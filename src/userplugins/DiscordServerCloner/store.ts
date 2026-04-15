export const state = {
    isCloning: false,
    abortController: null as AbortController | null,
    pillContainer: null as HTMLElement | null,
    mainProgressNotificationId: null as string | null,
    currentCloneGuildId: null as string | null,
    skipRolesCallback: null as (() => void) | null,
    emojiIdMap: {} as Record<string, string>,
};

export function throwIfCancelled() {
    if (!state.isCloning || state.abortController?.signal.aborted) {
        throw new Error("Cancelled");
    }
}
