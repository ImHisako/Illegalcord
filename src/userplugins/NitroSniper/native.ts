/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";
import { setTimeout as sleep } from "timers/promises";

import type { NativeCaptchaResponse, NativeWebhookResponse } from "./types";

export { startNightyAltDetection, stopNightyAltDetection, waitForNightyGiftCode } from "./nightyAlts";

const NONECAP_SOLVES_URL = "https://api.nonecap.com/v1/solves";
const NOCAPTCHAAI_URL = "https://api.nocaptchaai.com";
const MAX_RESPONSE_BYTES = 64 * 1024;
const SOLVE_TIMEOUT_MS = 115_000;
const activeSolves = new Set<AbortController>();

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function validatePageUrl(pageUrl: string) {
    if (pageUrl.length > 2048) return null;

    try {
        const url = new URL(pageUrl);
        if (url.protocol !== "https:" || url.hostname !== "discord.com" && !url.hostname.endsWith(".discord.com")) return null;
        return url.toString();
    } catch {
        return null;
    }
}

function getErrorMessage(body: unknown, fallback: string) {
    if (!isRecord(body)) return fallback;
    if (typeof body.error === "string") return body.error;
    if (isRecord(body.error) && typeof body.error.message === "string") return body.error.message;
    if (typeof body.errorDescription === "string") return body.errorDescription;
    if (typeof body.msg === "string") return body.msg;
    return fallback;
}

async function readJson(response: Response): Promise<unknown> {
    if (!response.body) return null;

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error("Response is too large.");
        }

        chunks.push(value);
    }

    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }

    const text = new TextDecoder().decode(bytes);
    return text ? JSON.parse(text) : null;
}

async function requestNoneCap(url: string, apiKey: string, signal: AbortSignal, body?: string) {
    const response = await fetch(url, {
        method: body ? "POST" : "GET",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(body ? { "Content-Type": "application/json" } : {})
        },
        body,
        redirect: "error",
        signal
    });
    const data = await readJson(response);

    if (!response.ok) {
        throw new Error(getErrorMessage(data, `NoneCap returned status ${response.status}.`));
    }

    return data;
}

function parseSolve(data: unknown) {
    if (!isRecord(data)) throw new Error("NoneCap returned an invalid response.");

    return {
        id: typeof data.id === "string" ? data.id : null,
        status: typeof data.status === "string" ? data.status : null,
        token: typeof data.token === "string" ? data.token : null,
        error: getErrorMessage(data, "NoneCap could not solve the CAPTCHA.")
    };
}

async function requestNoCaptchaAI(path: string, apiKey: string, signal: AbortSignal, body: Record<string, unknown>) {
    const response = await fetch(`${NOCAPTCHAAI_URL}${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ clientKey: apiKey, ...body }),
        redirect: "error",
        signal
    });
    const data = await readJson(response);

    if (!response.ok) {
        throw new Error(getErrorMessage(data, `NoCaptchaAI returned status ${response.status}.`));
    }

    return data;
}

function parseNoCaptchaAI(data: unknown) {
    if (!isRecord(data)) throw new Error("NoCaptchaAI returned an invalid response.");

    const solution = isRecord(data.solution) ? data.solution : null;
    return {
        taskId: typeof data.taskId === "string" ? data.taskId : null,
        status: typeof data.status === "string" ? data.status : null,
        token: solution && typeof solution.token === "string" ? solution.token : null,
        errorId: typeof data.errorId === "number" ? data.errorId : 0,
        error: getErrorMessage(data, "NoCaptchaAI could not solve the CAPTCHA.")
    };
}

async function solveWithNoneCap(apiKey: string, sitekey: string, rqdata: string | undefined, url: string, userAgent: string, signal: AbortSignal): Promise<NativeCaptchaResponse> {
    let solve = parseSolve(await requestNoneCap(
        `${NONECAP_SOLVES_URL}?wait=90`,
        apiKey,
        signal,
        JSON.stringify({
            type: rqdata ? "hcaptcha_enterprise" : "hcaptcha",
            sitekey,
            url,
            ...(rqdata ? { rqdata } : {}),
            user_agent: userAgent
        })
    ));

    while (solve.status === "pending" || solve.status === "solving") {
        if (!solve.id || !/^solve_[a-zA-Z0-9_-]+$/.test(solve.id)) {
            return { success: false, error: "NoneCap returned an invalid solve ID." };
        }

        await sleep(2000, undefined, { signal });
        solve = parseSolve(await requestNoneCap(
            `${NONECAP_SOLVES_URL}/${encodeURIComponent(solve.id)}`,
            apiKey,
            signal
        ));
    }

    if (solve.status !== "solved" || !solve.token) {
        return { success: false, error: solve.error };
    }

    return { success: true, token: solve.token };
}

async function solveWithNoCaptchaAI(apiKey: string, sitekey: string, rqdata: string | undefined, url: string, userAgent: string, signal: AbortSignal): Promise<NativeCaptchaResponse> {
    let task = parseNoCaptchaAI(await requestNoCaptchaAI("/createTask", apiKey, signal, {
        task: {
            type: "HCaptchaTaskProxyLess",
            websiteURL: url,
            websiteKey: sitekey,
            userAgent,
            ...(rqdata ? { enterprisePayload: { rqdata } } : {})
        }
    }));

    if (task.errorId) return { success: false, error: task.error };
    if (!task.taskId || task.taskId.length > 256 || /[\r\n]/.test(task.taskId)) {
        return { success: false, error: "NoCaptchaAI returned an invalid task ID." };
    }
    const { taskId } = task;

    while (task.status === "idle" || task.status === "processing") {
        await sleep(3000, undefined, { signal });
        task = parseNoCaptchaAI(await requestNoCaptchaAI("/getTaskResult", apiKey, signal, {
            taskId
        }));

        if (task.errorId) return { success: false, error: task.error };
    }

    if (task.status !== "ready" || !task.token) {
        return { success: false, error: task.error };
    }

    return { success: true, token: task.token };
}

export async function solveCaptcha(
    _: IpcMainInvokeEvent,
    provider: string,
    apiKey: string,
    sitekey: string,
    rqdata: string | undefined,
    pageUrl: string,
    userAgent: string
): Promise<NativeCaptchaResponse> {
    if (provider !== "nonecap" && provider !== "nocaptchaai") return { success: false, error: "CAPTCHA service is invalid." };
    const key = typeof apiKey === "string" ? apiKey.trim() : "";
    const url = typeof pageUrl === "string" ? validatePageUrl(pageUrl) : null;
    if (!key || key.length > 512 || /[\r\n]/.test(key)) return { success: false, error: "CAPTCHA API key is invalid." };
    if (typeof sitekey !== "string" || !sitekey || sitekey.length > 256) return { success: false, error: "CAPTCHA site key is invalid." };
    if (rqdata !== undefined && (typeof rqdata !== "string" || rqdata.length > 20_000)) return { success: false, error: "CAPTCHA request data is invalid." };
    if (!url) return { success: false, error: "Discord page URL is invalid." };
    if (typeof userAgent !== "string" || userAgent.length > 512 || /[\r\n]/.test(userAgent)) return { success: false, error: "User agent is invalid." };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOLVE_TIMEOUT_MS);
    activeSolves.add(controller);

    try {
        return provider === "nocaptchaai"
            ? await solveWithNoCaptchaAI(key, sitekey, rqdata, url, userAgent, controller.signal)
            : await solveWithNoneCap(key, sitekey, rqdata, url, userAgent, controller.signal);
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error && error.name === "AbortError"
                ? `${provider === "nocaptchaai" ? "NoCaptchaAI" : "NoneCap"} solve timed out.`
                : error instanceof Error
                    ? error.message
                    : "CAPTCHA solve failed."
        };
    } finally {
        clearTimeout(timeout);
        activeSolves.delete(controller);
    }
}

export function cancelCaptchaSolves() {
    for (const controller of activeSolves) controller.abort();
    activeSolves.clear();
}

export async function sendWebhook(_: IpcMainInvokeEvent, webhookUrl: string, payload: string): Promise<NativeWebhookResponse> {
    try {
        const url = new URL(webhookUrl);
        url.searchParams.set("wait", "true");

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: payload
        });

        return {
            status: response.status,
            data: await response.text()
        };
    } catch (error) {
        return {
            status: -1,
            data: error instanceof Error ? error.message : String(error)
        };
    }
}
