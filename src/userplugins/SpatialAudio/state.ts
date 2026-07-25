/*
* Vencord, a Discord client mod
* Copyright (c) 2025 Vendicated and contributors*
* SPDX-License-Identifier: GPL-3.0-or-later
*/
import * as DataStore from "@api/DataStore";
import { isPluginEnabled } from "@api/PluginManager";
import { classNameFactory } from "@utils/css";
import { UserStore, VoiceStateStore } from "@webpack/common";

export const cl = classNameFactory("vc-spatial-");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StreamData {
    audioContext: AudioContext;
    audioElement: HTMLAudioElement;
    emitter: unknown;
    gainNode?: GainNode;
    id: string;
    levelNode: AudioWorkletNode;
    sinkId: string | "default";
    stream: MediaStream;
    streamSourceNode?: MediaStreamAudioSourceNode;
    videoStreamId: string;
    _mute: boolean;
    _speakingFlags: number;
    _volume: number;
}

interface AudioChain {
    source: MediaStreamAudioSourceNode | null;
    gain: GainNode | null;
    panner: PannerNode;
    channelId: string;
}

export type Position = { x: number; y: number };

// ─── Constants ────────────────────────────────────────────────────────────────

export const CANVAS_SIZE = 300;
const SQRT2 = Math.sqrt(2);

// ─── Module-level state ───────────────────────────────────────────────────────

export const positions = new Map<string, Map<string, Position>>();   // channelId → userId → pos
export const activeChannels = new Set<string>();                      // channelIds with spatial on
export const manualModeChannels = new Set<string>();                  // channelIds in manual positioning mode
const storedStreams = new Map<string, StreamData>();                  // userId → StreamData
const audioChains = new Map<string, AudioChain>();                   // userId → chain

let positionSaveTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Reactive stores ──────────────────────────────────────────────────────────

type Listener = () => void;

function makeStore() {
    const listeners = new Set<Listener>();
    let revision = 0;
    return {
        addChangeListener: (cb: Listener) => listeners.add(cb),
        removeChangeListener: (cb: Listener) => listeners.delete(cb),
        addReactChangeListener: (cb: Listener) => listeners.add(cb),
        removeReactChangeListener: (cb: Listener) => listeners.delete(cb),
        emit: () => { revision++; listeners.forEach(cb => cb()); },
        getRevision: () => revision,
    };
}

export const SpatialActiveStore = makeStore();   // emits when activeChannels changes
export const SpatialPositionStore = makeStore(); // emits when positions changes

// ─── DataStore ────────────────────────────────────────────────────────────────

const DB_POSITIONS = "SpatialAudio_positions";
const DB_ACTIVE = "SpatialAudio_active";

export async function loadState() {
    const saved = await DataStore.get<Record<string, Record<string, Position>>>(DB_POSITIONS);
    if (saved) {
        for (const [channelId, users] of Object.entries(saved))
            positions.set(channelId, new Map(Object.entries(users)));
    }
    const active = await DataStore.get<string[]>(DB_ACTIVE);
    if (active) {
        for (const id of active) activeChannels.add(id);
    }
    SpatialActiveStore.emit();
    SpatialPositionStore.emit();
}

function savePositions() {
    positionSaveTimer = null;
    const out: Record<string, Record<string, Position>> = {};
    for (const [channelId, users] of positions)
        out[channelId] = Object.fromEntries(users);
    DataStore.set(DB_POSITIONS, out);
}

export function schedulePositionSave() {
    if (positionSaveTimer) clearTimeout(positionSaveTimer);
    positionSaveTimer = setTimeout(savePositions, 200);
}

export function saveActiveChannels() {
    DataStore.set(DB_ACTIVE, [...activeChannels]);
}

// ─── Audio chain helpers ──────────────────────────────────────────────────────

function setPannerPosition(panner: PannerNode, pos: Position | undefined) {
    panner.positionX.value = pos ? (pos.x - CANVAS_SIZE / 2) / (CANVAS_SIZE / 2) : 0;
    panner.positionY.value = 0;
    panner.positionZ.value = pos ? (pos.y - CANVAS_SIZE / 2) / (CANVAS_SIZE / 2) : 0;
}

function detachChain(userId: string) {
    const chain = audioChains.get(userId);
    if (!chain) return;
    const data = storedStreams.get(userId);
    if (chain.source === null) {
        // VolumeBooster mode: reconnect VolumeBooster's gainNode directly to destination
        chain.panner.disconnect();
        if (data?.gainNode) {
            data.gainNode.disconnect();
            data.gainNode.connect(data.audioContext.destination);
        }
    } else {
        chain.source.disconnect();
        chain.gain!.disconnect();
        chain.panner.disconnect();
        if (data) data.audioElement.volume = data._mute ? 0 : data._volume / 100;
    }
    audioChains.delete(userId);
}

export function attachChain(userId: string, data: StreamData, channelId: string) {
    if (audioChains.has(userId) || !data.stream.getAudioTracks().length) return;
    const ctx = data.audioContext;
    // @ts-expect-error
    if (data.sinkId != null && data.sinkId !== ctx.sinkId && "setSinkId" in AudioContext.prototype) {
        // @ts-expect-error https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/setSinkId
        ctx.setSinkId(data.sinkId === "default" ? "" : data.sinkId);
    }
    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "linear";
    panner.refDistance = 0;
    panner.maxDistance = SQRT2;
    panner.rolloffFactor = 1;
    setPannerPosition(panner, positions.get(channelId)?.get(userId));
    if (isPluginEnabled("VolumeBooster") && data.gainNode) {
        data.gainNode.disconnect();
        data.gainNode.connect(panner);
        panner.connect(ctx.destination);
        audioChains.set(userId, { source: null, gain: null, panner, channelId });
    } else {
        const source = ctx.createMediaStreamSource(data.stream);
        const gain = ctx.createGain();
        source.connect(gain);
        gain.connect(panner);
        panner.connect(ctx.destination);
        gain.gain.value = data._mute ? 0 : data._volume / 100;
        data.audioElement.volume = 0;
        audioChains.set(userId, { source, gain, panner, channelId });
    }
}

export function enableSpatial(channelId: string) {
    activeChannels.add(channelId);
    saveActiveChannels();
    SpatialActiveStore.emit();
    for (const [userId, data] of storedStreams) {
        if (VoiceStateStore.getVoiceStateForUser(userId)?.channelId === channelId)
            attachChain(userId, data, channelId);
    }
}

export function disableSpatial(channelId: string) {
    activeChannels.delete(channelId);
    saveActiveChannels();
    SpatialActiveStore.emit();
    const toDetach = [...audioChains.entries()]
        .filter(([, chain]) => chain.channelId === channelId)
        .map(([userId]) => userId);
    for (const userId of toDetach) detachChain(userId);
}

export function setPosition(channelId: string, userId: string, x: number, y: number, silent = false) {
    if (!positions.has(channelId)) positions.set(channelId, new Map());
    positions.get(channelId)!.set(userId, { x, y });
    schedulePositionSave();
    const chain = audioChains.get(userId);
    if (chain) setPannerPosition(chain.panner, { x, y });
    if (!silent) SpatialPositionStore.emit();
}

function applyDefaultPositions(channelId: string) {
    const selfId = UserStore.getCurrentUser()?.id;
    const userIds = Object.keys(VoiceStateStore.getVoiceStatesForChannel(channelId))
        .filter(id => id !== selfId)
        .sort();
    const channelPositions = positions.get(channelId) ?? new Map();
    userIds.forEach((userId, i) => {
        const pos = defaultPosition(i, userIds.length);
        channelPositions.set(userId, pos);
        const chain = audioChains.get(userId);
        if (chain) setPannerPosition(chain.panner, pos);
    });
    positions.set(channelId, channelPositions);
    schedulePositionSave();
    SpatialPositionStore.emit();
}

export function resetPositions(channelId: string) {
    applyDefaultPositions(channelId);
    manualModeChannels.delete(channelId);
}

export function rebalancePositions(channelId: string) {
    if (manualModeChannels.has(channelId)) return;
    applyDefaultPositions(channelId);
}

export function setManualMode(channelId: string, value: boolean) {
    if (value) manualModeChannels.add(channelId);
    else manualModeChannels.delete(channelId);
}

export function getPosition(channelId: string, userId: string): Position | undefined {
    return positions.get(channelId)?.get(userId);
}

export function isSpatialActive(channelId: string): boolean {
    return activeChannels.has(channelId);
}

export function defaultPosition(peerIndex: number, peerCount: number): Position {
    const angle = peerCount <= 1 ? -Math.PI / 2 : (Math.PI * peerIndex) / (peerCount - 1) - Math.PI;
    const r = CANVAS_SIZE * 0.3;
    return {
        x: Math.round(CANVAS_SIZE / 2 + r * Math.cos(angle)),
        y: Math.round(CANVAS_SIZE / 2 + r * Math.sin(angle)),
    };
}

// ─── Stream handler (called by webpack patch via $self) ───────────────────────

export function processStream(data: StreamData): number {
    if (data.videoStreamId) return data._volume / 100;
    storedStreams.set(data.id, data);
    const channelId = VoiceStateStore.getVoiceStateForUser(data.id)?.channelId ?? "";
    if (activeChannels.has(channelId)) {
        if (audioChains.has(data.id)) {
            const chain = audioChains.get(data.id)!;
            if (chain.gain) {
                chain.gain.gain.value = data._mute ? 0 : data._volume / 100;
            }
            // VolumeBooster mode: patchVolume (called before us) already updated data.gainNode.gain.value
            // @ts-expect-error
            if (data.sinkId != null && data.sinkId !== data.audioContext.sinkId && "setSinkId" in AudioContext.prototype) {
                // @ts-expect-error
                data.audioContext.setSinkId(data.sinkId === "default" ? "" : data.sinkId);
            }
        } else {
            attachChain(data.id, data, channelId);
        }
        return 0;
    }
    return data._volume / 100;
}

// ─── Flux handler ─────────────────────────────────────────────────────────────

export function handleVoiceStateUpdates({ voiceStates }: { voiceStates: Array<{ userId: string; channelId: string | null | undefined; }>; }) {
    for (const { userId, channelId } of voiceStates) {
        if (channelId != null) continue;
        detachChain(userId);
        storedStreams.delete(userId);
    }
    for (const channelId of activeChannels) {
        rebalancePositions(channelId);
    }
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

export function teardownAudio() {
    // detachChain restores each audioElement.volume before clearing the chain
    for (const userId of [...audioChains.keys()]) detachChain(userId);
    storedStreams.clear();
    activeChannels.clear();
    manualModeChannels.clear();
    positions.clear();
    if (positionSaveTimer) clearTimeout(positionSaveTimer);
    SpatialActiveStore.emit();
    SpatialPositionStore.emit();
}
