/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { state } from "../store";
import { randomDelay,sleep } from "./helpers";

export class TaskQueue {
    private maxConcurrency: number;
    private currentConcurrency: number;
    private activeWorkers = 0;
    private pausedUntil = 0;
    private consecutive429 = 0;
    private successCount = 0;
    private static readonly MAX_CONSECUTIVE_429 = 15;
    private static readonly SUCCESSES_TO_UPSCALE = 5;

    constructor(concurrency = 5) {
        this.maxConcurrency = concurrency;
        this.currentConcurrency = concurrency;
    }

    async execute<T>(
        fn: () => Promise<T>,
        statusUpdateCb?: (msg: string) => void,
        exitCondition?: () => boolean,
        retries = 3
    ): Promise<T> {
        // Wait for an available worker slot or rate limit pause
        // Use currentConcurrency instead of maxConcurrency for adaptive scaling
        while (this.activeWorkers >= this.currentConcurrency || Date.now() < this.pausedUntil) {
            if (!state.isCloning) throw new Error("Cancelled");
            if (exitCondition && exitCondition()) throw new Error("Skipped");

            if (Date.now() < this.pausedUntil) {
                const sleepMs = Math.max(100, this.pausedUntil - Date.now());
                await sleep(Math.min(sleepMs, 500));
            } else {
                await sleep(50);
            }
        }

        this.activeWorkers++;

        try {
            for (let i = 0; i < retries; i++) {
                try {
                    if (!state.isCloning) throw new Error("Cancelled");
                    if (exitCondition && exitCondition()) throw new Error("Skipped");

                    // Double-check pause state immediately before execution
                    if (Date.now() < this.pausedUntil) {
                        const sleepMs = Math.max(100, this.pausedUntil - Date.now());
                        await sleep(sleepMs);
                        if (!state.isCloning) throw new Error("Cancelled");
                    }

                    const result = await fn();
                    this.consecutive429 = 0; // reset on success

                    // Success-based Upscaling
                    this.successCount++;
                    if (this.successCount >= TaskQueue.SUCCESSES_TO_UPSCALE) {
                        if (this.currentConcurrency < this.maxConcurrency) {
                            this.currentConcurrency++;
                            this.successCount = 0;
                            console.log(`[TaskQueue] Upscaling concurrency to ${this.currentConcurrency}`);
                        }
                    }

                    // Add a slightly larger base jitter to prevent "bursting"
                    await sleep(randomDelay(200, 500));

                    return result;
                } catch (e: any) {
                    if (!state.isCloning) throw new Error("Cancelled");
                    if (exitCondition && exitCondition()) throw new Error("Skipped");
                    if (e?.message === "Skipped" || e?.message === "Cancelled") throw e;

                    if (e?.status === 429) {
                        this.consecutive429++;
                        this.successCount = 0;

                        // Downscale immediately on 429
                        const oldConcurrency = this.currentConcurrency;
                        this.currentConcurrency = Math.max(1, Math.floor(this.currentConcurrency / 2));
                        if (oldConcurrency !== this.currentConcurrency) {
                            console.warn(`[TaskQueue] Rate limited! Downscaling concurrency from ${oldConcurrency} to ${this.currentConcurrency}`);
                        }

                        if (this.consecutive429 >= TaskQueue.MAX_CONSECUTIVE_429) {
                            const err: any = new Error("RateLimitExhausted");
                            err.rateLimitExhausted = true;
                            throw err;
                        }

                        // Determine pause duration
                        const retryAfter = ((e.retry_after || e.body?.retry_after || 1) * 1000) + randomDelay(500, 1500);
                        const newPauseUntil = Date.now() + retryAfter;

                        // Only the first failing worker should update the global pause
                        if (newPauseUntil > this.pausedUntil) {
                            this.pausedUntil = newPauseUntil;
                            const msg = `Rate limited, slowing down... waiting ${Math.ceil(retryAfter / 1000)}s`;
                            if (statusUpdateCb) statusUpdateCb(msg);
                            console.warn(`[TaskQueue] Global pause initiated for ${retryAfter}ms`);
                        }

                        // Wait it out and retry
                        await sleep(retryAfter);

                        if (i < retries - 1) continue;
                    }

                    if (e?.status === 403) {
                        let errorCode = e?.body?.code || 0;
                        if (!errorCode && e?.text) {
                            try { errorCode = JSON.parse(e.text)?.code || 0; } catch (_) { }
                        }
                        if (errorCode === 50101) throw e; // Missing Access / Not Allowed (unrecoverable)

                        if (i < retries - 1) {
                            const backoff = Math.min(2000 + (i * 2000), 10000);
                            console.warn(`[ServerCloner] 403 Forbidden (code: ${errorCode}), retrying ${i + 1}/${retries}...`);
                            await sleep(backoff);
                            continue;
                        }
                        throw e;
                    }

                    if (e?.status === 400) throw e;

                    if (i === retries - 1) throw e;
                    await sleep(1000 + randomDelay(500, 1000));
                }
            }
            throw new Error("Max retries exceeded");
        } finally {
            this.activeWorkers--;
        }
    }
}
