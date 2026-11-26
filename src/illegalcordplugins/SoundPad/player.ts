/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface SoundPadSound {
    id: string;
    name: string;
    size: number;
    url: string;
}

interface Playback {
    soundId: string;
    outputs: HTMLAudioElement[];
}

const sounds: SoundPadSound[] = [];
const playbacks = new Set<Playback>();
const listeners = new Set<() => void>();
let microphoneStream: MediaStream | null = null;
let microphoneOutput: HTMLAudioElement | null = null;
let microphoneRequest: symbol | null = null;

function emitChange() {
    listeners.forEach(listener => listener());
}

function destroyPlayback(playback: Playback) {
    playback.outputs.forEach(audio => {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.currentTime = 0;
    });
    playbacks.delete(playback);
    emitChange();
}

export function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getSounds() {
    return sounds;
}

export function isPlaying(soundId: string) {
    return Array.from(playbacks).some(playback => playback.soundId === soundId);
}

export function isMicrophoneActive() {
    return microphoneRequest != null;
}

export async function startMicrophone(inputDeviceId: string, sinkId: string, volume: number) {
    stopMicrophone();
    const request = microphoneRequest = Symbol();
    emitChange();

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: inputDeviceId === "default" ? void 0 : { exact: inputDeviceId },
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false
            }
        });
        if (microphoneRequest !== request) {
            stream.getTracks().forEach(track => track.stop());
            return false;
        }

        microphoneStream = stream;
        const output = microphoneOutput = new Audio();
        output.srcObject = stream;
        output.volume = volume / 100;
        await output.setSinkId(sinkId === "default" ? "" : sinkId);
        if (microphoneRequest !== request) return false;

        await output.play();
        if (microphoneRequest !== request) {
            output.pause();
            output.srcObject = null;
            return false;
        }
        return true;
    } catch (error) {
        if (microphoneRequest !== request) return false;
        stopMicrophone();
        throw error;
    }
}

export function setMicrophoneVolume(volume: number) {
    if (microphoneOutput) microphoneOutput.volume = volume / 100;
}

export function stopMicrophone() {
    microphoneRequest = null;
    microphoneStream?.getTracks().forEach(track => track.stop());
    microphoneOutput?.pause();
    if (microphoneOutput) microphoneOutput.srcObject = null;
    microphoneStream = null;
    microphoneOutput = null;
    emitChange();
}

export function addSound(file: File) {
    const sound = {
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        url: URL.createObjectURL(file)
    };

    sounds.push(sound);
    emitChange();
    return sound;
}

export async function playSound(sound: SoundPadSound, sinkId: string, volume: number, monitorLocally: boolean) {
    const routedAudio = new Audio(sound.url);
    routedAudio.volume = volume / 100;

    const outputs = [routedAudio];
    if (monitorLocally && sinkId !== "default") {
        const monitor = new Audio(sound.url);
        monitor.volume = routedAudio.volume;
        outputs.push(monitor);
    }

    const playback = { soundId: sound.id, outputs };
    routedAudio.onended = () => destroyPlayback(playback);
    routedAudio.onerror = () => destroyPlayback(playback);
    playbacks.add(playback);
    emitChange();

    try {
        await routedAudio.setSinkId(sinkId === "default" ? "" : sinkId);
        if (!playbacks.has(playback)) return;
        await Promise.all(outputs.map(audio => audio.play()));
        if (!playbacks.has(playback)) destroyPlayback(playback);
    } catch (error) {
        destroyPlayback(playback);
        throw error;
    }
}

export function stopSound(soundId: string) {
    Array.from(playbacks)
        .filter(playback => playback.soundId === soundId)
        .forEach(destroyPlayback);
}

export function removeSound(sound: SoundPadSound) {
    stopSound(sound.id);
    const index = sounds.indexOf(sound);
    if (index !== -1) sounds.splice(index, 1);
    URL.revokeObjectURL(sound.url);
    emitChange();
}

export function stopAll() {
    Array.from(playbacks).forEach(destroyPlayback);
}

export function dispose() {
    stopMicrophone();
    stopAll();
    sounds.splice(0).forEach(sound => URL.revokeObjectURL(sound.url));
    listeners.clear();
}
