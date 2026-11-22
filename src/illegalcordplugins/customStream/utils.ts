/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import { React } from "@webpack/common";

export const cl = classNameFactory("vc-cs-");
export const logger = new Logger("CustomStream-Preview");

export interface Emitter {
    emit(): void;
    subscribe(listener: () => void): () => void;
    getVersion(): number;
}

export function createEmitter(): Emitter {
    const listeners = new Set<() => void>();
    let version = 0;

    return {
        emit() {
            version++;
            listeners.forEach(listener => listener());
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        getVersion: () => version
    };
}

export function useEmitter(emitter: Emitter): number {
    return React.useSyncExternalStore(emitter.subscribe, emitter.getVersion);
}

const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | undefined;
let tickNow = Date.now();

function subscribeTick(listener: () => void) {
    tickListeners.add(listener);
    if (!tickTimer) {
        tickNow = Date.now();
        tickTimer = setInterval(() => {
            tickNow = Date.now();
            tickListeners.forEach(fn => fn());
        }, 1000);
    }

    return () => {
        tickListeners.delete(listener);
        if (tickListeners.size === 0 && tickTimer) {
            clearInterval(tickTimer);
            tickTimer = undefined;
        }
    };
}

const noSubscribe = () => () => { };
const readNow = () => tickNow;

export function useNow(ticking = true): number {
    return React.useSyncExternalStore(ticking ? subscribeTick : noSubscribe, readNow);
}
