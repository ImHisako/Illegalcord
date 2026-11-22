/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Hotkey {
    key: string;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
}

export function parseHotkey(raw: string | undefined): Hotkey | null {
    const parts = (raw ?? "").split("+").map(part => part.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return null;

    const hotkey: Hotkey = { key: "", ctrl: false, shift: false, alt: false, meta: false };
    for (const part of parts) {
        if (part === "ctrl" || part === "control") hotkey.ctrl = true;
        else if (part === "shift") hotkey.shift = true;
        else if (part === "alt" || part === "option") hotkey.alt = true;
        else if (part === "meta" || part === "cmd" || part === "win") hotkey.meta = true;
        else hotkey.key = part;
    }

    return hotkey.key ? hotkey : null;
}

export function matchesHotkey(event: Pick<KeyboardEvent, "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "key" | "code">, hotkey: Hotkey): boolean {
    if (event.ctrlKey !== hotkey.ctrl || event.shiftKey !== hotkey.shift) return false;
    if (event.altKey !== hotkey.alt || event.metaKey !== hotkey.meta) return false;

    const key = event.key?.toLowerCase() ?? "";
    const code = event.code?.toLowerCase() ?? "";

    return key === hotkey.key
        || code === hotkey.key
        || code === `key${hotkey.key}`
        || code === `digit${hotkey.key}`
        || code === `numpad${hotkey.key}`;
}

function isTypingTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    if (!element?.tagName) return false;

    const tag = element.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || element.isContentEditable === true;
}

let handler: ((event: KeyboardEvent) => void) | null = null;

export function registerHotkey(getRaw: () => string, onPress: () => void) {
    unregisterHotkey();

    let cachedRaw: string | null = null;
    let cached: Hotkey | null = null;

    handler = event => {
        if (event.repeat) return;

        const raw = getRaw();
        if (raw !== cachedRaw) {
            cachedRaw = raw;
            cached = parseHotkey(raw);
        }
        if (!cached) return;

        const hasModifier = cached.ctrl || cached.shift || cached.alt || cached.meta;
        if (!hasModifier && isTypingTarget(event.target)) return;
        if (!matchesHotkey(event, cached)) return;

        event.preventDefault();
        event.stopPropagation();
        onPress();
    };

    window.addEventListener("keydown", handler, { capture: true });
}

export function unregisterHotkey() {
    if (!handler) return;
    window.removeEventListener("keydown", handler, { capture: true });
    handler = null;
}
