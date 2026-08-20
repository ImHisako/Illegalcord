/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { state } from "../store";
import { isRecord } from "./helpers";
import { cleanupContainer, notify } from "./notifications";

const DISCORD_ERROR_MAP: Record<number, string> = {
    10003: "The channel no longer exists.",
    10004: "The server no longer exists.",
    10011: "The role no longer exists.",
    20001: "Bots cannot use this endpoint.",
    30002: "You own too many servers.",
    30005: "The server has reached its channel limit.",
    30010: "The server has reached its role limit.",
    30016: "The server has reached its emoji limit.",
    30018: "The server has reached its sticker limit.",
    40001: "Your Discord session has expired.",
    40006: "Discord is already updating this server.",
    50001: "You do not have access to this resource.",
    50013: "You do not have permission to perform this action.",
    50035: "Discord rejected the submitted data.",
    50101: "The server needs a higher boost level for this feature.",
    60003: "Two-factor authentication is required."
};

const HTTP_STATUS_MAP: Record<number, string> = {
    400: "Discord rejected the submitted data.",
    401: "Your Discord session has expired.",
    403: "You do not have permission to perform this action.",
    404: "The requested resource no longer exists.",
    429: "Discord is rate limiting these requests.",
    500: "Discord encountered an internal error.",
    502: "Discord is temporarily unavailable.",
    503: "Discord is temporarily unavailable."
};

const FATAL_CODES = new Set([10004, 20001, 40001, 50001, 60003]);
const FATAL_HTTP = new Set([401, 403]);

function parseJsonRecord(text: string): Record<string, unknown> | undefined {
    try {
        const value: unknown = JSON.parse(text);
        return isRecord(value) ? value : undefined;
    } catch {
        return undefined;
    }
}

function getErrorCode(error: unknown): number | undefined {
    if (!isRecord(error)) return undefined;
    if (typeof error.code === "number") return error.code;
    if (isRecord(error.body) && typeof error.body.code === "number") return error.body.code;
    if (typeof error.text !== "string") return undefined;
    const parsed = parseJsonRecord(error.text);
    return typeof parsed?.code === "number" ? parsed.code : undefined;
}

function getStatus(error: unknown): number | undefined {
    return isRecord(error) && typeof error.status === "number" ? error.status : undefined;
}

function getMessage(error: unknown): string | undefined {
    if (typeof error === "string") return error;
    if (!isRecord(error)) return undefined;
    if (isRecord(error.body) && typeof error.body.message === "string") return error.body.message;
    if (typeof error.message === "string") return error.message;
    if (typeof error.text === "string") {
        const parsed = parseJsonRecord(error.text);
        if (typeof parsed?.message === "string") return parsed.message;
    }
    return undefined;
}

function isFatalError(error: unknown): boolean {
    const code = getErrorCode(error);
    const status = getStatus(error);
    return (code !== undefined && FATAL_CODES.has(code)) || (status !== undefined && FATAL_HTTP.has(status));
}

export function translateError(error: unknown): string {
    const message = getMessage(error);
    if (message?.includes("Cancelled") || message === "Skipped") return "";

    const code = getErrorCode(error);
    if (code !== undefined && DISCORD_ERROR_MAP[code]) return DISCORD_ERROR_MAP[code];

    const status = getStatus(error);
    if (status !== undefined && HTTP_STATUS_MAP[status]) return HTTP_STATUS_MAP[status];

    if (!message) return "An unknown error occurred.";
    return message.length > 120 ? `${message.slice(0, 117)}...` : message;
}

export function handleCloneError(context: string, error: unknown, itemName?: string): void {
    if (!state.isCloning || state.abortController?.signal.aborted) return;

    const translated = translateError(error);
    if (!translated) return;

    state.cloneErrors.push(itemName ? `[${context}] ${itemName}: ${translated}` : `[${context}]: ${translated}`);

    if (isFatalError(error)) {
        state.isCloning = false;
        state.abortController?.abort();
        state.abortController = null;
        cleanupContainer();
        notify("Clone stopped", translated, "error");
        return;
    }

    notify(itemName ? `${context}: ${itemName}` : context, translated, "error");
}
