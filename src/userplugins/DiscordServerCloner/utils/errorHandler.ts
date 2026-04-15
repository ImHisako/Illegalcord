import { notify } from "./notifications";
import { state } from "../store";

const DISCORD_ERROR_MAP: Record<number, string> = {
    10003: "Channel not found — it may have been deleted",
    10004: "Server not found — it may have been deleted",
    10011: "Role not found — it may have been deleted",
    20001: "Bots cannot use this endpoint",
    30002: "Max server limit reached — you own too many servers",
    30005: "Max channels reached (500) — server is full",
    30010: "Max roles reached (250) — server is full",
    30016: "Max emoji slots reached",
    30018: "Max sticker slots reached",
    30031: "Max server members reached",
    40001: "Unauthorized — your token may have expired",
    40006: "Server is being updated, try again later",
    50001: "Missing Access — you lack permission for this",
    50013: "Missing Permissions — your role can't do this",
    50028: "Invalid role — role is managed or too high",
    50033: "Invalid recipients",
    50035: "Invalid data sent to Discord",
    50041: "Server needs to be verified first",
    50055: "Server already has this feature",
    50070: "Server needs 2FA enabled",
    50074: "Server locked due to a raid",
    50101: "Server needs boosts for this feature (icons/banner)",
    60003: "Two-factor authentication required",
    170001: "Community server prerequisites not met",
};

const FATAL_CODES = new Set([10004, 10003, 20001, 40001, 50001, 50074, 60003]);
const FATAL_HTTP = new Set([401, 403]);

const HTTP_STATUS_MAP: Record<number, string> = {
    400: "Bad Request — invalid data sent",
    401: "Unauthorized — re-login to Discord",
    403: "Forbidden — you don't have permission",
    404: "Not Found — the resource was deleted",
    429: "Rate Limited — too many requests, slowing down",
    500: "Discord Server Error — try again later",
    502: "Discord is down — try again later",
    503: "Discord is unavailable — try again later",
};

function getErrorCode(error: any): number | null {
    let code = error?.body?.code || error?.code;
    if (!code && error?.text) {
        try { code = JSON.parse(error.text)?.code; } catch (_) { }
    }
    return typeof code === "number" ? code : null;
}

function isFatalError(error: any): boolean {
    const code = getErrorCode(error);
    if (code && FATAL_CODES.has(code)) return true;
    if (error?.status && FATAL_HTTP.has(error.status)) return true;
    return false;
}

export function translateError(error: any): string {
    if (!error) return "Unknown error";

    if (typeof error === "string") return error;
    if (error.message === "Cancelled" || error.message?.includes("Cancelled")) return "";
    if (error.message === "Skipped") return "";

    const code = getErrorCode(error);

    if (code && DISCORD_ERROR_MAP[code]) {
        return DISCORD_ERROR_MAP[code];
    }

    if (error?.status && HTTP_STATUS_MAP[error.status]) {
        return HTTP_STATUS_MAP[error.status];
    }

    let message = error?.body?.message || error?.message || "";

    if (!message && error?.text) {
        try { message = JSON.parse(error.text)?.message || ""; } catch (_) { }
    }

    if (message) {
        if (message.length > 120) return message.substring(0, 117) + "...";
        return message;
    }

    return "Unknown error occurred";
}

export function handleCloneError(context: string, error: any, itemName?: string): void {
    if (!state.isCloning && state.abortController?.signal.aborted) return;

    const translated = translateError(error);
    if (!translated) return;

    if (isFatalError(error)) {
        state.isCloning = false;
        if (state.abortController) {
            state.abortController.abort();
            state.abortController = null;
        }
        notify("Clone stopped", translated, "error", 8000);
        return;
    }

    const title = itemName ? `${context}: ${itemName}` : context;
    notify(title, translated, "error", 6000);
}
