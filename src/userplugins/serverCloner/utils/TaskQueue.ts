import { sleep, randomDelay } from "./helpers";
import { state } from "../store";

export class TaskQueue {
    private maxConcurrency: number;
    private currentConcurrency: number;
    private activeWorkers = 0;
    private pausedUntil = 0;
    private consecutive429 = 0;
    private successCount = 0;




    private requestTimestamps: number[] = [];
    private static readonly WINDOW_MS = 5000;
    private static readonly MAX_REQUESTS_PER_WINDOW = 5;

    private static readonly MAX_CONSECUTIVE_429 = 15;
    private static readonly SUCCESSES_TO_UPSCALE = 2;

    constructor(concurrency = 5) {
        this.maxConcurrency = concurrency;
        this.currentConcurrency = concurrency;
    }







    private async waitForRateLimitWindow(exitCondition?: () => boolean): Promise<void> {
        while (true) {
            if (!state.isCloning) throw new Error("Cancelled");
            if (exitCondition && exitCondition()) throw new Error("Skipped");

            const now = Date.now();

            this.requestTimestamps = this.requestTimestamps.filter(
                t => now - t < TaskQueue.WINDOW_MS
            );

            if (this.requestTimestamps.length < TaskQueue.MAX_REQUESTS_PER_WINDOW) {

                this.requestTimestamps.push(Date.now());
                return;
            }


            const waitMs = (this.requestTimestamps[0] + TaskQueue.WINDOW_MS) - Date.now() + 50;
            await sleep(Math.max(waitMs, 50));
        }
    }

    async execute<T>(
        fn: () => Promise<T>,
        statusUpdateCb?: (msg: string) => void,
        exitCondition?: () => boolean,
        retries = 3
    ): Promise<T> {

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


                    if (Date.now() < this.pausedUntil) {
                        const sleepMs = Math.max(100, this.pausedUntil - Date.now());
                        await sleep(sleepMs);
                        if (!state.isCloning) throw new Error("Cancelled");
                    }





                    await this.waitForRateLimitWindow(exitCondition);


                    const result = await fn();
                    this.consecutive429 = 0;


                    this.successCount++;
                    if (this.successCount >= TaskQueue.SUCCESSES_TO_UPSCALE) {
                        if (this.currentConcurrency < this.maxConcurrency) {
                            this.currentConcurrency++;
                            this.successCount = 0;
                        }
                    }

                    return result;

                } catch (e: any) {
                    if (!state.isCloning) throw new Error("Cancelled");
                    if (exitCondition && exitCondition()) throw new Error("Skipped");
                    if (e?.message === "Skipped" || e?.message === "Cancelled") throw e;

                    if (e?.status === 429) {
                        this.consecutive429++;
                        this.successCount = 0;


                        const oldConcurrency = this.currentConcurrency;
                        this.currentConcurrency = Math.max(1, Math.floor(this.currentConcurrency / 2));
                        if (oldConcurrency !== this.currentConcurrency) {
                            console.warn(`[TaskQueue] 429 received — downscaling concurrency ${oldConcurrency} → ${this.currentConcurrency}`);
                        }

                        if (this.consecutive429 >= TaskQueue.MAX_CONSECUTIVE_429) {
                            const err: any = new Error("RateLimitExhausted");
                            err.rateLimitExhausted = true;
                            throw err;
                        }


                        const retryAfter = ((e.retry_after || e.body?.retry_after || 1) * 1000) + randomDelay(500, 1500);
                        const newPauseUntil = Date.now() + retryAfter;

                        if (newPauseUntil > this.pausedUntil) {
                            this.pausedUntil = newPauseUntil;
                            const msg = `Rate limited — waiting ${Math.ceil(retryAfter / 1000)}s`;
                            if (statusUpdateCb) statusUpdateCb(msg);
                            console.warn(`[TaskQueue] Global pause for ${retryAfter}ms`);
                        }

                        await sleep(retryAfter);

                        if (i < retries - 1) continue;
                    }

                    if (e?.status === 403) {
                        let errorCode = e?.body?.code || 0;
                        if (!errorCode && e?.text) {
                            try { errorCode = JSON.parse(e.text)?.code || 0; } catch (_) { }
                        }
                        if (errorCode === 50101) throw e;

                        if (i < retries - 1) {
                            const backoff = Math.min(2000 + (i * 2000), 10000);
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