import { sleep, randomDelay } from "./helpers";
import { state } from "../store";

export class RateLimiter {
    private lastRequest = 0;
    private baseDelay: number;
    private consecutive429 = 0;
    private static readonly MAX_CONSECUTIVE_429 = 10;

    constructor(baseDelay = 800) {
        this.baseDelay = baseDelay;
    }

    async wait(exitCondition?: () => boolean) {
        const now = Date.now();
        const actualDelay = randomDelay(this.baseDelay, Math.floor(this.baseDelay * 1.5));
        const timeSinceLastRequest = now - this.lastRequest;
        if (timeSinceLastRequest < actualDelay) {
            const remaining = actualDelay - timeSinceLastRequest;
            const chunk = 200;
            let elapsed = 0;
            while (elapsed < remaining) {
                if (!state.isCloning) throw new Error("Cancelled");
                if (exitCondition && exitCondition()) throw new Error("Skipped");
                await sleep(Math.min(chunk, remaining - elapsed));
                elapsed += chunk;
            }
        }
        this.lastRequest = Date.now();
    }

    async execute<T>(fn: () => Promise<T>, statusUpdateCb?: (msg: string) => void, exitCondition?: () => boolean, retries = 3): Promise<T> {
        for (let i = 0; i < retries; i++) {
            try {
                if (!state.isCloning) throw new Error("Cancelled");
                if (exitCondition && exitCondition()) throw new Error("Skipped");

                await this.wait(exitCondition);
                if (!state.isCloning) throw new Error("Cancelled");
                if (exitCondition && exitCondition()) throw new Error("Skipped");
                const result = await fn();

                this.consecutive429 = 0;
                if (this.baseDelay > 800) {
                    this.baseDelay = Math.max(800, this.baseDelay / 2);
                }

                return result;
            } catch (e: any) {
                if (!state.isCloning) throw new Error("Cancelled");
                if (exitCondition && exitCondition()) throw new Error("Skipped");

                if (e?.message === "Skipped" || e?.message === "Cancelled") throw e;

                if (e?.status === 429) {
                    this.consecutive429++;
                    if (this.consecutive429 >= RateLimiter.MAX_CONSECUTIVE_429) {
                        const err: any = new Error("RateLimitExhausted");
                        err.rateLimitExhausted = true;
                        throw err;
                    }

                    const retryAfter = ((e.retry_after || e.body?.retry_after || 1) * 1000) + 500;
                    if (statusUpdateCb) statusUpdateCb(`Rate limited, waiting ${Math.ceil(retryAfter / 1000)}s...`);

                    this.baseDelay = Math.min(this.baseDelay * 1.5, 5000);

                    const chunkSize = 500;
                    let elapsed = 0;
                    while (elapsed < retryAfter) {
                        if (!state.isCloning) throw new Error("Cancelled");
                        if (exitCondition && exitCondition()) throw new Error("Skipped");
                        await sleep(chunkSize);
                        elapsed += chunkSize;
                    }

                    if (i < retries - 1) {
                        continue;
                    }
                }

                if (e?.status === 403) {
                    let errorCode = e?.body?.code || 0;
                    if (!errorCode && e?.text) {
                        try { errorCode = JSON.parse(e.text)?.code || 0; } catch (_) { }
                    }

                    if (errorCode === 50101) {
                        throw e;
                    }

                    if (i < retries - 1) {
                        const backoff = Math.min(2000 + (i * 2000), 10000);
                        console.warn(`[ServerCloner] 403 Forbidden (code: ${errorCode}), retrying ${i + 1}/${retries} in ${backoff / 1000}s...`);
                        await sleep(backoff);
                        continue;
                    }
                    throw e;
                }

                if (e?.status === 400) {
                    throw e;
                }

                if (i === retries - 1) throw e;
                if (exitCondition && exitCondition()) throw new Error("Skipped");
                await sleep(randomDelay(this.baseDelay, this.baseDelay * 2));
            }
        }
        throw new Error("Max retries exceeded");
    }
}
