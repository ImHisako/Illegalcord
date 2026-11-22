/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const HEALTH_PARTS = ["thumbnail", "upload", "frame", "pauseGate", "settle", "failure", "streamDelete", "panel"] as const;
export type HealthPart = typeof HEALTH_PARTS[number];

const present = new Set<HealthPart>();
const listeners = new Set<() => void>();
let version = 0;

export function markPatched(part: HealthPart) {
    if (present.has(part)) return;
    present.add(part);
    version++;
    listeners.forEach(listener => listener());
}

export function subscribeHealth(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function getHealthVersion(): number {
    return version;
}

export interface HealthSummary {
    total: number;
    working: HealthPart[];
    broken: HealthPart[];
    swapBroken: boolean;
}

export function summarizeHealth(parts: ReadonlySet<HealthPart> = present): HealthSummary {
    return {
        total: HEALTH_PARTS.length,
        working: HEALTH_PARTS.filter(part => parts.has(part)),
        broken: HEALTH_PARTS.filter(part => !parts.has(part)),
        swapBroken: !parts.has("thumbnail") && !parts.has("upload")
    };
}
