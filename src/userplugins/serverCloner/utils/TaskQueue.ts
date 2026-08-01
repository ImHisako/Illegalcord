/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { state } from "../store";
import { isRecord, randomDelay, sleep } from "./helpers";

function getNumber(error: unknown, key: string): number | undefined {
    if (!isRecord(error)) return undefined;
    const value = error[key];
    return typeof value === "number" ? value : undefined;
}

function getMessage(error: unknown): string | undefined {
    return isRecord(error) && typeof error.message === "string" ? error.message : undefined;
}

function getErrorCode(error: unknown): number | undefined {
    if (!isRecord(error)) return undefined;
    if (typeof error.code === "number") return error.code;
    if (isRecord(error.body) && typeof error.body.code === "number") return error.body.code;
    if (typeof error.text !== "string") return undefined;

    try {
        const parsed: unknown = JSON.parse(error.text);
        return isRecord(parsed) && typeof parsed.code === "number" ? parsed.code : undefined;
    } catch {
        return undefined;
    }
}

function getRetryAfter(error: unknown): number {
    if (!isRecord(error)) return 1;
    const value = error.retry_after
        ?? (isRecord(error.body) ? error.body.retry_after : undefined)
        ?? (isRecord(error.headers) ? error.headers["retry-after"] : undefined);
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 1;
}

export class TaskQueue {
    private activeWorkers = 0;
    private consecutive429 = 0;
    private currentConcurrency: number;
    private pausedUntil = 0;
    private successCount = 0;

    private static readonly SUCCESSES_TO_UPSCALE = 8;
    private static readonly MAX_CONSECUTIVE_429 = 12;

    constructor(private readonly maxConcurrency = 4) {
        this.currentConcurrency = maxConcurrency;
    }

    private ensureRunning(exitCondition?: () => boolean): void {
        if (!state.isCloning) throw new Error("Cancelled");
        if (exitCondition?.()) throw new Error("Skipped");
    }

    private async waitForSlot(exitCondition?: () => boolean): Promise<void> {
        while (this.activeWorkers >= this.currentConcurrency || Date.now() < this.pausedUntil) {
            this.ensureRunning(exitCondition);
            await sleep(Date.now() < this.pausedUntil ? Math.min(250, this.pausedUntil - Date.now()) : 25);
        }
    }

    async execute<T>(
        fn: () => Promise<T>,
        statusUpdate?: (message: string) => void,
        exitCondition?: () => boolean,
        retries = 4
    ): Promise<T> {
        await this.waitForSlot(exitCondition);
        this.activeWorkers++;

        try {
            for (let attempt = 0; attempt < retries; attempt++) {
                this.ensureRunning(exitCondition);

                if (Date.now() < this.pausedUntil) {
                    const remaining = this.pausedUntil - Date.now();
                    statusUpdate?.(`Rate limited. Waiting ${Math.ceil(remaining / 1000)} seconds.`);
                    await sleep(remaining);
                    this.ensureRunning(exitCondition);
                }

                try {
                    const result = await fn();
                    this.consecutive429 = 0;
                    this.successCount++;
                    if (this.successCount >= TaskQueue.SUCCESSES_TO_UPSCALE && this.currentConcurrency < this.maxConcurrency) {
                        this.currentConcurrency++;
                        this.successCount = 0;
                    }
                    return result;
                } catch (error: unknown) {
                    this.ensureRunning(exitCondition);
                    const message = getMessage(error);
                    if (message === "Skipped" || message === "Cancelled") throw error;

                    const status = getNumber(error, "status");
                    if (status === 429) {
                        this.consecutive429++;
                        this.successCount = 0;
                        this.currentConcurrency = Math.max(1, Math.floor(this.currentConcurrency / 2));

                        if (this.consecutive429 >= TaskQueue.MAX_CONSECUTIVE_429) {
                            throw Object.assign(new Error("Rate limit exhausted"), { rateLimitExhausted: true as const });
                        }

                        const retryAfterMs = getRetryAfter(error) * 1000 + randomDelay(100, 400);
                        this.pausedUntil = Math.max(this.pausedUntil, Date.now() + retryAfterMs);
                        statusUpdate?.(`Rate limited. Waiting ${Math.ceil(retryAfterMs / 1000)} seconds.`);
                        if (attempt < retries - 1) continue;
                    }

                    if (status === 403) {
                        if (getErrorCode(error) === 50101 || attempt === retries - 1) throw error;
                        await sleep(Math.min(1500 + attempt * 1500, 8000));
                        continue;
                    }

                    if (status === 400 || attempt === retries - 1) throw error;
                    await sleep(500 + attempt * 500 + randomDelay(100, 300));
                }
            }

            throw new Error("Maximum retries exceeded");
        } finally {
            this.activeWorkers--;
        }
    }
}
