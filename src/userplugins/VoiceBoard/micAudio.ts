/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Aleeeh07 (@febbraio)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { findByCodeLazy } from "@webpack";
import { FluxDispatcher, showToast, Toasts, UserStore } from "@webpack/common";

import { MIC_SEND_DB_MAX, MIC_SEND_DB_MIN, settings } from "./settings";

const logger = new Logger("VoiceBoard");

const getSoundboardLocalVolume: (soundVolume: number, panelVolume?: number) => number = findByCodeLazy(
    "getSetting()?.volume??100",
    ".getOutputVolume()/100"
);

let livePanelVolume: number | undefined;

export function setLivePanelVolume(volume: number | undefined) {
    livePanelVolume = volume;
}

export interface AudioInput {
    context: AudioContext;
    mute: boolean;
    setPTTActive(active: boolean): void;
    setSpeaking(active: boolean): void;
}

interface MixedInput {
    input: AudioInput;
    sourceStream: MediaStream;
    source: MediaStreamAudioSourceNode;
    microphoneGain: GainNode;
    destination: MediaStreamAudioDestinationNode;
}

export interface SoundboardSound {
    soundId: string;
    volume?: number;
}

interface PlaybackSource {
    input: AudioInput;
    source: AudioBufferSourceNode;
    gain: GainNode;
}

interface Playback {
    controller: AbortController;
    sources: PlaybackSource[];
    soundId: string;
}

const mixedInputs = new Map<MediaStream, MixedInput>();
const playbacks = new Set<Playback>();

const micPlayingCounts = new Map<string, number>();

function currentUserId() {
    return UserStore.getCurrentUser()?.id;
}

function syncMicActiveClass() {
    document.documentElement.classList.toggle("vc-voiceboard-mic-active", micPlayingCounts.size > 0);
}

function markMicPlayStart(soundId: string) {
    micPlayingCounts.set(soundId, (micPlayingCounts.get(soundId) ?? 0) + 1);
    syncMicActiveClass();

    const userId = currentUserId();
    if (userId == null)
        return;

    FluxDispatcher.dispatch({
        type: "GUILD_SOUNDBOARD_SOUND_PLAY_START",
        soundId,
        userId,
    });
}

function markMicPlayEnd(soundId: string) {
    const count = micPlayingCounts.get(soundId) ?? 0;
    if (count <= 0)
        return;

    if (count === 1)
        micPlayingCounts.delete(soundId);
    else
        micPlayingCounts.set(soundId, count - 1);

    syncMicActiveClass();

    const userId = currentUserId();
    if (userId == null)
        return;

    FluxDispatcher.dispatch({
        type: "GUILD_SOUNDBOARD_SOUND_PLAY_END",
        soundId,
        userId,
    });
}

function stopPlayback(active: Playback) {
    if (!playbacks.delete(active))
        return;

    active.controller.abort();
    markMicPlayEnd(active.soundId);

    for (const { input, source, gain } of active.sources) {
        source.onended = null;
        try {
            source.stop();
        } catch { }
        source.disconnect();
        gain.disconnect();

        const stillPlaying = [...playbacks].some(p => p.sources.some(s => s.input === input));
        if (input.mute)
            input.setSpeaking(stillPlaying);
        else
            input.setPTTActive(stillPlaying);

        for (const mixed of mixedInputs.values()) {
            if (mixed.input !== input)
                continue;

            mixed.microphoneGain.gain.value = input.mute ? 0 : 1;
            for (const track of mixed.destination.stream.getAudioTracks())
                track.enabled = !input.mute || stillPlaying;
        }
    }
}

function dbToGain(db: number) {
    const clamped = Math.max(MIC_SEND_DB_MIN, Math.min(MIC_SEND_DB_MAX, db));
    return Math.pow(10, clamped / 20);
}

const RAINBOW_PERIOD_MS = 10_000;
let rainbowHue = 0;
let rainbowLastTick = 0;
let rainbowTimer: ReturnType<typeof setInterval> | undefined;

function applyRainbowHue() {
    const root = document.documentElement.style;
    root.setProperty("--vc-vb-color", `hsl(${rainbowHue} 90% 58%)`);
    root.setProperty("--vc-vb-color-soft", `hsl(${rainbowHue} 70% 46%)`);
}

function syncRainbowColor() {
    const now = Date.now();

    // Background tabs throttle timers; don't catch up wall-clock or the hue snaps on focus.
    if (document.hidden) {
        rainbowLastTick = now;
        return;
    }

    const dt = Math.min(Math.max(0, now - rainbowLastTick), 200);
    rainbowLastTick = now;
    rainbowHue = (rainbowHue + dt / RAINBOW_PERIOD_MS * 360) % 360;
    applyRainbowHue();
}

function onRainbowVisibility() {
    rainbowLastTick = Date.now();
}

export function startRainbowSync() {
    stopRainbowSync();
    rainbowLastTick = Date.now();
    applyRainbowHue();
    document.addEventListener("visibilitychange", onRainbowVisibility);
    rainbowTimer = setInterval(syncRainbowColor, 100);
}

export function stopRainbowSync() {
    if (rainbowTimer != null) {
        clearInterval(rainbowTimer);
        rainbowTimer = undefined;
    }

    document.removeEventListener("visibilitychange", onRainbowVisibility);

    const root = document.documentElement.style;
    root.removeProperty("--vc-vb-color");
    root.removeProperty("--vc-vb-color-soft");
    root.removeProperty("--vc-vb-t0");
}

export function getLocalMonitorVolume(soundVolume: number) {
    try {
        const gain = livePanelVolume != null
            ? getSoundboardLocalVolume(soundVolume, livePanelVolume)
            : getSoundboardLocalVolume(soundVolume);
        return Math.max(0, Math.min(1, gain));
    } catch (error) {
        logger.debug("Falling back to raw sound volume for local playback", error);
        return Math.max(0, Math.min(1, soundVolume));
    }
}

export function mixInput(input: AudioInput, stream: MediaStream): MediaStream {
    const source = input.context.createMediaStreamSource(stream);
    const microphoneGain = input.context.createGain();
    const destination = input.context.createMediaStreamDestination();
    source.connect(microphoneGain).connect(destination);

    const mixedStream = destination.stream;
    mixedInputs.set(mixedStream, { input, sourceStream: stream, source, microphoneGain, destination });
    return mixedStream;
}

export function releaseInput(stream: MediaStream) {
    const mixed = mixedInputs.get(stream);
    if (mixed == null)
        return;

    mixedInputs.delete(stream);
    mixed.source.disconnect();
    mixed.microphoneGain.disconnect();
    for (const track of mixed.sourceStream.getTracks())
        track.stop();
}

export function shouldEnableInput(input: AudioInput) {
    for (const mixed of mixedInputs.values()) {
        if (mixed.input === input)
            mixed.microphoneGain.gain.value = input.mute ? 0 : 1;
    }

    return !input.mute || isInputPlaying(input);
}

export function isInputPlaying(input: AudioInput) {
    for (const playback of playbacks) {
        if (playback.sources.some(source => source.input === input))
            return true;
    }

    return false;
}

export async function playThroughMic(sound: SoundboardSound) {
    const inputs = [...mixedInputs.values()];
    if (inputs.length === 0) {
        showToast("Join voice first (mic mix not ready). Use Vesktop/web if this keeps failing.", Toasts.Type.FAILURE);
        return;
    }

    for (const playback of [...playbacks]) {
        if (playback.soundId === sound.soundId)
            stopPlayback(playback);
    }

    const controller = new AbortController();
    const active: Playback = { controller, sources: [], soundId: sound.soundId };
    playbacks.add(active);
    markMicPlayStart(sound.soundId);

    try {
        const [{ input: firstInput }] = inputs;
        const { context } = firstInput;
        await context.resume();

        const response = await fetch(
            `https://${window.GLOBAL_ENV.CDN_HOST}/soundboard-sounds/${encodeURIComponent(sound.soundId)}`,
            { signal: controller.signal },
        );
        if (!response.ok)
            throw new Error(`CDN fetch failed (${response.status})`);

        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (!playbacks.has(active))
            return;

        const baseVolume = Math.max(0, Math.min(1, sound.volume ?? 1));
        const micVolume = baseVolume * dbToGain(settings.store.micSendDb);
        const localVolume = settings.store.playLocally
            ? getLocalMonitorVolume(sound.volume ?? 1)
            : 0;

        let first = true;
        for (const { input, microphoneGain, destination } of inputs) {
            const source = input.context.createBufferSource();
            const micGain = input.context.createGain();
            micGain.gain.value = micVolume;
            source.buffer = buffer;
            source.connect(micGain).connect(destination);

            if (first && localVolume > 0) {
                const localGain = input.context.createGain();
                localGain.gain.value = localVolume;
                source.connect(localGain).connect(input.context.destination);
            }

            first = false;
            source.onended = () => stopPlayback(active);
            active.sources.push({ input, source, gain: micGain });

            microphoneGain.gain.value = input.mute ? 0 : 1;
            for (const track of destination.stream.getAudioTracks())
                track.enabled = true;

            if (input.mute)
                input.setSpeaking(true);
            else
                input.setPTTActive(true);

            source.start();
        }

        console.log("[VoiceBoard] playing through microphone:", sound.soundId, `send=${settings.store.micSendDb}dB`);
    } catch (error) {
        const { aborted } = controller.signal;
        stopPlayback(active);
        if (!aborted) {
            logger.error("Mic playback failed", error);
            showToast("Couldn't play this sound through your microphone.", Toasts.Type.FAILURE);
        }
    }
}

export function stopAllMicAudio() {
    for (const playback of playbacks)
        stopPlayback(playback);

    micPlayingCounts.clear();
    syncMicActiveClass();
    stopRainbowSync();

    for (const [stream] of mixedInputs) {
        releaseInput(stream);
        for (const track of stream.getTracks())
            track.stop();
    }
}
