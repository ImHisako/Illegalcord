/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isObject } from "@utils/misc";
import { MediaEngineStore } from "@webpack/common";

import type { createRequestLog } from "./requestLog";

type Listener = (...args: unknown[]) => void;
interface VoiceEmitter {
    on(event: string, listener: Listener): unknown;
    removeListener(event: string, listener: Listener): unknown;
}

const COUNTERS = ["bytesSent", "bytesReceived", "packetsSent", "packetsReceived", "packetsLost", "fractionLost", "ping", "availableOutgoingBitrate", "receiverBitrateEstimate", "outboundBitrateEstimate", "inboundBitrateEstimate"];

function isEmitter(value: unknown): value is VoiceEmitter {
    return isObject(value) && "on" in value && typeof value.on === "function" && "removeListener" in value && typeof value.removeListener === "function";
}

function getEmitter(value: unknown): VoiceEmitter | null {
    if (isObject(value) && "emitter" in value && isEmitter(value.emitter)) return value.emitter;
    return isEmitter(value) ? value : null;
}

export function summarizeVoiceStats(args: unknown[]): string {
    const counters: string[] = [];
    function collect(value: unknown, prefix: string, depth: number): void {
        if (!isObject(value) || depth > 3 || counters.length >= 64) return;
        for (const key of COUNTERS) {
            const counter: unknown = Reflect.get(value, key);
            if (typeof counter === "number" && Number.isFinite(counter) && counter >= 0) counters.push(`${prefix}${key}: ${counter}`);
        }
        for (const key of ["transport", "rtp", "stats"]) collect(Reflect.get(value, key), `${prefix}${key}.`, depth + 1);
        for (const key of ["inbound", "outbound"]) {
            const streams: unknown = Reflect.get(value, key);
            if (isObject(streams) || Array.isArray(streams))
                Object.values(streams).slice(0, 16).forEach((stream: unknown, index: number) => collect(stream, `${prefix}${key}.${index}.`, depth + 1));
        }
    }
    for (const arg of args.slice(0, 4)) collect(arg, "", 0);
    return counters.slice(0, 64).join(", ") || "Voice statistics received without supported counters.";
}

export function installVoiceRequestLog(log: ReturnType<typeof createRequestLog>) {
    const engine = MediaEngineStore.getMediaEngine();
    const emitter = getEmitter(engine);
    if (!emitter) return null;
    const connections = new Map<VoiceEmitter, () => void>();

    function stats(...args: unknown[]): void {
        log.record({ url: "", method: "STATS", resourceType: "voiceStats", source: "Voice", state: "Completed", detail: summarizeVoiceStats(args) });
    }

    function connection(value: unknown): void {
        const source = getEmitter(value);
        if (!source || connections.has(source)) return;
        function connected(): void {
            log.record({ url: "", method: "EVENT", resourceType: "voiceConnection", source: "Voice", state: "Completed", detail: "Voice transport connected." });
        }
        function failed(): void {
            log.record({ url: "", method: "EVENT", resourceType: "voiceConnection", source: "Voice", state: "Failed", detail: "Voice transport reported an error." });
        }
        const destroyed = () => {
            log.record({ url: "", method: "EVENT", resourceType: "voiceConnection", source: "Voice", state: "Completed", detail: "Voice transport closed." });
            cleanup();
            connections.delete(source);
        };
        const cleanup = () => {
            source.removeListener("connected", connected);
            source.removeListener("error", failed);
            source.removeListener("destroy", destroyed);
        };
        source.on("connected", connected);
        source.on("error", failed);
        source.on("destroy", destroyed);
        connections.set(source, cleanup);
    }

    emitter.on("connection-stats", stats);
    emitter.on("connection", connection);
    for (const current of engine.connections) connection(current);
    return () => {
        emitter.removeListener("connection-stats", stats);
        emitter.removeListener("connection", connection);
        for (const cleanup of connections.values()) cleanup();
        connections.clear();
    };
}
