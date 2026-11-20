/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";
import { setTimeout as sleep } from "timers/promises";

import type { CaptchaSolverOptions, NativeCaptchaResponse, NativeSolverAccountResponse, NativeWebhookResponse } from "./types";

export { startNightyAltDetection, stopNightyAltDetection, waitForNightyGiftCode } from "./nightyAlts";

const NONECAP_SOLVES_URL = "https://api.nonecap.com/v1/solves";
const BRUXSOLVER_API_URL = "https://bruxsolver.org";
const BRUXSOLVER_ERRORS: Record<string, string> = {
    MISSING_API_KEY: "BruxSolver API key is missing.",
    INVALID_API_KEY: "BruxSolver API key is invalid or revoked.",
    INSUFFICIENT_BALANCE: "No BruxSolver solves remaining.",
    THREAD_LIMIT_REACHED: "BruxSolver concurrent request limit reached.",
    MISSING_PROXY: "BruxSolver requires a proxy for this request."
};
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

async function requestBruxSolver(endpoint: "solve" | "balance" | "threads", apiKey: string, signal: AbortSignal, body?: string) {
    const response = await fetch(`${BRUXSOLVER_API_URL}/${endpoint}`, {
        method: body ? "POST" : "GET",
        headers: {
            "x-api-key": apiKey,
            ...(body ? { "Content-Type": "application/json" } : {})
        },
        body,
        redirect: "error",
        signal
    });
    const data = await readJson(response);
    if (!isRecord(data) || !response.ok || data.success !== true) {
        const errorCode = isRecord(data) && typeof data.error_code === "string" ? data.error_code : "";
        throw new Error(BRUXSOLVER_ERRORS[errorCode] ?? (response.ok
            ? "BruxSolver returned an invalid response."
            : `BruxSolver returned status ${response.status}.`));
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

export async function solveCaptcha(
    _: IpcMainInvokeEvent,
    apiKey: string,
    sitekey: string,
    rqdata: string | undefined,
    pageUrl: string,
    userAgent: string,
    options: CaptchaSolverOptions
): Promise<NativeCaptchaResponse> {
    const key = typeof apiKey === "string" ? apiKey.trim() : "";
    const url = typeof pageUrl === "string" ? validatePageUrl(pageUrl) : null;
    if (!key || key.length > 512 || /[\r\n]/.test(key)) return { success: false, error: "CAPTCHA API key is invalid." };
    if (typeof sitekey !== "string" || !sitekey || sitekey.length > 256) return { success: false, error: "CAPTCHA site key is invalid." };
    if (rqdata !== undefined && (typeof rqdata !== "string" || rqdata.length > 20_000)) return { success: false, error: "CAPTCHA request data is invalid." };
    if (!url) return { success: false, error: "Discord page URL is invalid." };
    if (typeof userAgent !== "string" || userAgent.length > 512 || /[\r\n]/.test(userAgent)) return { success: false, error: "User agent is invalid." };
    if (!isRecord(options) || options.provider !== "nonecap" && options.provider !== "bruxsolver") return { success: false, error: "CAPTCHA provider is invalid." };
    if (options.provider === "bruxsolver") {
        if (options.proxy !== undefined && (typeof options.proxy !== "string" || options.proxy.length > 2048 || /[\r\n]/.test(options.proxy))) {
            return { success: false, error: "BruxSolver proxy URL is invalid." };
        }
        if (options.proxy) {
            try {
                const proxy = new URL(options.proxy);
                if (proxy.protocol !== "http:" && proxy.protocol !== "https:" || !proxy.hostname) {
                    return { success: false, error: "BruxSolver proxy must use HTTP or HTTPS." };
                }
            } catch {
                return { success: false, error: "BruxSolver proxy URL is invalid." };
            }
        }
        if (options.powType !== undefined && options.powType !== "" && options.powType !== "hsw" && options.powType !== "hsl") {
            return { success: false, error: "BruxSolver proof of work type must be HSW or HSL." };
        }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOLVE_TIMEOUT_MS);
    activeSolves.add(controller);

    try {
        if (options.provider === "bruxsolver") {
            const data = await requestBruxSolver("solve", key, controller.signal, JSON.stringify({
                ...(options.proxy ? { proxy: options.proxy } : {}),
                sitekey,
                href: url,
                ...(rqdata ? { rqdata } : {}),
                ...(options.powType ? { pow_type: options.powType } : {})
            }));
            const token = typeof data.token === "string" && data.token ? data.token : data.solution;
            if (data.status !== "challenge_pass" || typeof token !== "string" || !token) {
                return { success: false, error: "BruxSolver could not solve the CAPTCHA." };
            }
            return { success: true, token };
        }
        return await solveWithNoneCap(key, sitekey, rqdata, url, userAgent, controller.signal);
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error && error.name === "AbortError"
                ? "CAPTCHA request was cancelled or timed out."
                : error instanceof Error
                    ? error.message
                    : "CAPTCHA solve failed."
        };
    } finally {
        clearTimeout(timeout);
        activeSolves.delete(controller);
    }
}

export async function getBruxSolverAccount(_: IpcMainInvokeEvent, apiKey: string): Promise<NativeSolverAccountResponse> {
    const key = typeof apiKey === "string" ? apiKey.trim() : "";
    if (!key || key.length > 512 || /[\r\n]/.test(key)) return { success: false, error: "BruxSolver API key is invalid." };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    activeSolves.add(controller);

    try {
        const [balance, threads] = await Promise.all([
            requestBruxSolver("balance", key, controller.signal),
            requestBruxSolver("threads", key, controller.signal)
        ]);
        if (typeof balance.remaining_solves !== "number" || typeof threads.thread_limit !== "number"
            || typeof threads.threads_in_use !== "number" || typeof threads.available_threads !== "number"
            || ![balance.remaining_solves, threads.thread_limit, threads.threads_in_use, threads.available_threads]
                .every(value => Number.isSafeInteger(value) && value >= 0)) {
            return { success: false, error: "BruxSolver returned invalid account details." };
        }
        return {
            success: true,
            remainingSolves: balance.remaining_solves,
            threadLimit: threads.thread_limit,
            threadsInUse: threads.threads_in_use,
            availableThreads: threads.available_threads
        };
    } catch {
        return { success: false, error: "Could not check the BruxSolver account. Check your API key and try again." };
    } finally {
        controller.abort();
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
