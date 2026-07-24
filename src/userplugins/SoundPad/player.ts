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
    return microphoneStream != null;
}

export async function startMicrophone(inputDeviceId: string, sinkId: string, volume: number) {
    stopMicrophone();

    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            deviceId: inputDeviceId === "default" ? void 0 : { exact: inputDeviceId },
            autoGainControl: false,
            echoCancellation: false,
            noiseSuppression: false
        }
    });
    const output = new Audio();
    output.srcObject = stream;
    output.volume = volume / 100;

    try {
        await output.setSinkId(sinkId);
        await output.play();
    } catch (error) {
        stream.getTracks().forEach(track => track.stop());
        throw error;
    }

    microphoneStream = stream;
    microphoneOutput = output;
    emitChange();
}

export function setMicrophoneVolume(volume: number) {
    if (microphoneOutput) microphoneOutput.volume = volume / 100;
}

export function stopMicrophone() {
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
    await routedAudio.setSinkId(sinkId);

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
        await Promise.all(outputs.map(audio => audio.play()));
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
