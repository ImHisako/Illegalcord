/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { isObject } from "@utils/misc";
import { FluxDispatcher, MediaEngineStore, SelectedChannelStore, VoiceActions } from "@webpack/common";

interface MicrophonePrivacySettings {
    allowCamera: boolean;
    allowMicrophone: boolean;
    privatePushToTalk: boolean;
    lockMicrophoneWhenMuted: boolean;
    blockMicrophoneOutsideCalls: boolean;
    releaseMicrophoneOnDisconnect: boolean;
    lockPttOnWindowBlur: boolean;
    maximumPttSeconds: number;
}

const logger = new Logger("DiscordHardened");
const trackedMicrophones = new Map<MediaStreamTrack, { desired: boolean; callOwned: boolean; }>();
const endedListeners = new Map<MediaStreamTrack, () => void>();
type UnknownFunction = (...args: unknown[]) => unknown;
const patchedPttConnections = new Map<object, { original: UnknownFunction; protected: UnknownFunction; }>();

let settings: MicrophonePrivacySettings | null = null;
let mediaEngine: ReturnType<typeof MediaEngineStore.getMediaEngine> | null = null;
let enabledDescriptor: PropertyDescriptor | undefined;
let protectedEnabledSetter: ((this: MediaStreamTrack, value: boolean) => void) | null = null;
let originalClone: MediaStreamTrack["clone"] | null = null;
let protectedClone: MediaStreamTrack["clone"] | null = null;
let originalSetLoopback: UnknownFunction | null = null;
let protectedSetLoopback: UnknownFunction | null = null;
let originalSetVideoEnabled: UnknownFunction | null = null;
let protectedSetVideoEnabled: UnknownFunction | null = null;
let originalDispatch: typeof FluxDispatcher.dispatch | null = null;
let protectedDispatch: typeof FluxDispatcher.dispatch | null = null;
let pttActive = false;
let pttTimeout: number | undefined;

function getVoiceState(): { inCall: boolean; pushToTalk: boolean; selfMuted: boolean; } | null {
    if (typeof MediaEngineStore === "undefined" || typeof SelectedChannelStore === "undefined") return null;

    return {
        inCall: SelectedChannelStore.getVoiceChannelId() != null,
        pushToTalk: MediaEngineStore.getMode() === "PUSH_TO_TALK",
        selfMuted: MediaEngineStore.isSelfMute(),
    };
}

function shouldLockMicrophone(): boolean {
    if (!settings) return false;
    if (!settings.allowMicrophone) return true;

    const voiceState = getVoiceState();
    if (!voiceState) return settings.blockMicrophoneOutsideCalls || settings.privatePushToTalk || settings.lockMicrophoneWhenMuted;
    if (!voiceState.inCall) return settings.blockMicrophoneOutsideCalls;
    if (settings.lockMicrophoneWhenMuted && voiceState.selfMuted) return true;
    return settings.privatePushToTalk && voiceState.pushToTalk && !pttActive;
}

function setActualTrackState(track: MediaStreamTrack, enabled: boolean): void {
    if (enabledDescriptor?.set) enabledDescriptor.set.call(track, enabled);
    else track.enabled = enabled;
}

function applyMicrophoneGate(): void {
    const locked = shouldLockMicrophone();
    for (const [track, state] of trackedMicrophones) {
        if (track.readyState === "ended") continue;
        setActualTrackState(track, state.desired && !locked);
    }
}

function removeTrack(track: MediaStreamTrack): void {
    const listener = endedListeners.get(track);
    if (listener) track.removeEventListener("ended", listener);
    endedListeners.delete(track);
    trackedMicrophones.delete(track);
}

function registerMicrophoneTrack(track: MediaStreamTrack, callOwned: boolean, desired = track.enabled): void {
    if (track.kind !== "audio" || trackedMicrophones.has(track)) return;

    trackedMicrophones.set(track, { desired, callOwned });
    const handleEnded = () => removeTrack(track);
    endedListeners.set(track, handleEnded);
    track.addEventListener("ended", handleEnded, { once: true });
}

function handleWindowBlur(): void {
    if (!settings?.lockPttOnWindowBlur) return;
    setPrivatePttActive(false);
}

function isCallable(value: unknown): value is UnknownFunction {
    return typeof value === "function";
}

function hookPttConnection(connection: unknown): void {
    if (!isObject(connection) || !("context" in connection) || connection.context !== "default" || !("conn" in connection) || !isObject(connection.conn)) return;

    const { conn } = connection;
    if (!("setPTTActive" in conn)) return;

    const existing = patchedPttConnections.get(conn);
    if (existing && conn.setPTTActive === existing.protected) return;
    if (existing) patchedPttConnections.delete(conn);

    const original = conn.setPTTActive;
    if (!isCallable(original)) return;

    const protectedSetPttActive = function (this: unknown, ...args: unknown[]) {
        setPrivatePttActive(args[0] === true);
        return Reflect.apply(original, this, args);
    };

    try {
        Object.defineProperty(conn, "setPTTActive", {
            configurable: true,
            writable: true,
            value: protectedSetPttActive,
        });
        patchedPttConnections.set(conn, { original, protected: protectedSetPttActive });
    } catch (error) {
        logger.warn("Could not protect the push-to-talk connection.", error);
    }
}

function ensurePttConnectionHooks(): void {
    if (typeof MediaEngineStore === "undefined") return;

    try {
        mediaEngine ??= MediaEngineStore.getMediaEngine();
        for (const connection of mediaEngine.connections) hookPttConnection(connection);
    } catch (error) {
        mediaEngine = null;
        logger.warn("Could not monitor push-to-talk connections.", error);
    }
}

export function registerMicrophoneStream(stream: MediaStream): void {
    if (!settings) return;

    ensurePttConnectionHooks();
    const callOwned = getVoiceState()?.inCall === true;

    for (const track of stream.getAudioTracks()) registerMicrophoneTrack(track, callOwned);

    applyMicrophoneGate();
}

export function setPrivatePttActive(active: boolean): void {
    if (!settings) return;

    pttActive = active;

    if (pttTimeout !== undefined) {
        clearTimeout(pttTimeout);
        pttTimeout = undefined;
    }

    if (active) {
        pttTimeout = window.setTimeout(() => {
            pttTimeout = undefined;
            pttActive = false;
            applyMicrophoneGate();
            logger.warn("Push-to-talk was locked by the privacy timeout.");
        }, settings.maximumPttSeconds * 1000);
    }

    applyMicrophoneGate();
}

export function refreshMicrophonePrivacy(): void {
    if (!settings) return;

    ensurePttConnectionHooks();

    if (!settings.allowMicrophone || settings.blockMicrophoneOutsideCalls && getVoiceState()?.inCall !== true) {
        FluxDispatcher.dispatch({ type: "MEDIA_ENGINE_SET_AUDIO_ENABLED", enabled: false });
    }

    if (settings.releaseMicrophoneOnDisconnect && getVoiceState()?.inCall === false) {
        for (const [track, state] of trackedMicrophones) {
            if (state.callOwned && track.readyState !== "ended") track.stop();
        }
    }

    applyMicrophoneGate();
}

export function refreshCameraPrivacy(): void {
    if (settings?.allowCamera === false && isObject(VoiceActions) && "setVideoEnabled" in VoiceActions && isCallable(VoiceActions.setVideoEnabled)) {
        Reflect.apply(VoiceActions.setVideoEnabled, VoiceActions, [false]);
    }
}

export function startMicrophonePrivacy(newSettings: MicrophonePrivacySettings): void {
    settings = newSettings;
    pttActive = false;

    if (typeof MediaStreamTrack !== "undefined") {
        enabledDescriptor = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, "enabled");
        if (enabledDescriptor?.get && enabledDescriptor.set) {
            protectedEnabledSetter = function (this: MediaStreamTrack, value: boolean) {
                if (this.kind !== "audio" || !trackedMicrophones.has(this)) {
                    enabledDescriptor?.set?.call(this, value);
                    return;
                }

                const state = trackedMicrophones.get(this);
                if (state) state.desired = value;
                enabledDescriptor?.set?.call(this, value && !shouldLockMicrophone());
            };

            try {
                Object.defineProperty(MediaStreamTrack.prototype, "enabled", {
                    ...enabledDescriptor,
                    set: protectedEnabledSetter,
                });
            } catch (error) {
                protectedEnabledSetter = null;
                logger.warn("Could not protect microphone track state.", error);
            }
        }

        const nativeClone = MediaStreamTrack.prototype.clone;
        originalClone = nativeClone;
        protectedClone = function (this: MediaStreamTrack) {
            const clone = nativeClone.call(this);
            const sourceState = trackedMicrophones.get(this);
            if (sourceState) {
                registerMicrophoneTrack(clone, sourceState.callOwned, sourceState.desired);
                applyMicrophoneGate();
            }
            return clone;
        };
        try {
            Object.defineProperty(MediaStreamTrack.prototype, "clone", {
                configurable: true,
                writable: true,
                value: protectedClone,
            });
        } catch (error) {
            originalClone = null;
            protectedClone = null;
            logger.warn("Could not protect cloned microphone tracks.", error);
        }
    }

    window.addEventListener("blur", handleWindowBlur);
    ensurePttConnectionHooks();

    if (isObject(FluxDispatcher) && "dispatch" in FluxDispatcher && isCallable(FluxDispatcher.dispatch)) {
        const nativeDispatch = FluxDispatcher.dispatch;
        originalDispatch = nativeDispatch;
        protectedDispatch = action => {
            let protectedAction = action;
            if (action.enabled === true) {
                if (action.type === "MEDIA_ENGINE_SET_VIDEO_ENABLED" && settings?.allowCamera === false) {
                    protectedAction = { ...action, enabled: false };
                } else if (
                    action.type === "MEDIA_ENGINE_SET_AUDIO_ENABLED" && (
                        settings?.allowMicrophone === false
                        || settings?.blockMicrophoneOutsideCalls && getVoiceState()?.inCall !== true
                    )
                    || action.type === "AUDIO_SET_LOOPBACK" && (
                        settings?.allowMicrophone === false
                        || settings?.blockMicrophoneOutsideCalls && getVoiceState()?.inCall !== true
                    )
                ) {
                    protectedAction = { ...action, enabled: false };
                }
            }

            return nativeDispatch.call(FluxDispatcher, protectedAction);
        };

        try {
            Object.defineProperty(FluxDispatcher, "dispatch", {
                configurable: true,
                writable: true,
                value: protectedDispatch,
            });
        } catch (error) {
            originalDispatch = null;
            protectedDispatch = null;
            logger.warn("Could not protect media actions.", error);
        }
    }

    if (isObject(VoiceActions) && "setLoopback" in VoiceActions && isCallable(VoiceActions.setLoopback)) {
        const nativeSetLoopback = VoiceActions.setLoopback;
        originalSetLoopback = nativeSetLoopback;
        protectedSetLoopback = function (this: unknown, ...args: unknown[]) {
            if (args[1] === true && settings?.blockMicrophoneOutsideCalls && getVoiceState()?.inCall !== true) {
                return Reflect.apply(nativeSetLoopback, this, [args[0], false]);
            }

            return Reflect.apply(nativeSetLoopback, this, args);
        };

        try {
            Object.defineProperty(VoiceActions, "setLoopback", {
                configurable: true,
                writable: true,
                value: protectedSetLoopback,
            });
        } catch (error) {
            originalSetLoopback = null;
            protectedSetLoopback = null;
            logger.warn("Could not protect microphone loopback.", error);
        }
    }

    if (isObject(VoiceActions) && "setVideoEnabled" in VoiceActions && isCallable(VoiceActions.setVideoEnabled)) {
        const nativeSetVideoEnabled = VoiceActions.setVideoEnabled;
        originalSetVideoEnabled = nativeSetVideoEnabled;
        protectedSetVideoEnabled = function (this: unknown, ...args: unknown[]) {
            if (args[0] === true && settings?.allowCamera === false) {
                return Reflect.apply(nativeSetVideoEnabled, this, [false, ...args.slice(1)]);
            }

            return Reflect.apply(nativeSetVideoEnabled, this, args);
        };

        try {
            Object.defineProperty(VoiceActions, "setVideoEnabled", {
                configurable: true,
                writable: true,
                value: protectedSetVideoEnabled,
            });
        } catch (error) {
            originalSetVideoEnabled = null;
            protectedSetVideoEnabled = null;
            logger.warn("Could not protect camera activation.", error);
        }
    }

    refreshCameraPrivacy();
    refreshMicrophonePrivacy();
}

export function stopMicrophonePrivacy(): void {
    window.removeEventListener("blur", handleWindowBlur);

    if (pttTimeout !== undefined) {
        clearTimeout(pttTimeout);
        pttTimeout = undefined;
    }

    if (enabledDescriptor && protectedEnabledSetter && Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, "enabled")?.set === protectedEnabledSetter) {
        try {
            Object.defineProperty(MediaStreamTrack.prototype, "enabled", enabledDescriptor);
        } catch (error) {
            logger.warn("Could not restore microphone track state.", error);
        }
    }

    if (originalClone && protectedClone && MediaStreamTrack.prototype.clone === protectedClone) {
        try {
            Object.defineProperty(MediaStreamTrack.prototype, "clone", {
                configurable: true,
                writable: true,
                value: originalClone,
            });
        } catch (error) {
            logger.warn("Could not restore cloned microphone tracks.", error);
        }
    }

    if (originalSetLoopback && protectedSetLoopback && VoiceActions.setLoopback === protectedSetLoopback) {
        try {
            Object.defineProperty(VoiceActions, "setLoopback", {
                configurable: true,
                writable: true,
                value: originalSetLoopback,
            });
        } catch (error) {
            logger.warn("Could not restore microphone loopback.", error);
        }
    }

    if (originalSetVideoEnabled && protectedSetVideoEnabled && VoiceActions.setVideoEnabled === protectedSetVideoEnabled) {
        try {
            Object.defineProperty(VoiceActions, "setVideoEnabled", {
                configurable: true,
                writable: true,
                value: originalSetVideoEnabled,
            });
        } catch (error) {
            logger.warn("Could not restore camera activation.", error);
        }
    }

    if (originalDispatch && protectedDispatch && FluxDispatcher.dispatch === protectedDispatch) {
        try {
            Object.defineProperty(FluxDispatcher, "dispatch", {
                configurable: true,
                writable: true,
                value: originalDispatch,
            });
        } catch (error) {
            logger.warn("Could not restore media actions.", error);
        }
    }

    mediaEngine = null;
    originalSetLoopback = null;
    protectedSetLoopback = null;
    originalSetVideoEnabled = null;
    protectedSetVideoEnabled = null;
    originalDispatch = null;
    protectedDispatch = null;

    for (const [connection, functions] of patchedPttConnections) {
        if (Object.getOwnPropertyDescriptor(connection, "setPTTActive")?.value === functions.protected) {
            try {
                Object.defineProperty(connection, "setPTTActive", {
                    configurable: true,
                    writable: true,
                    value: functions.original,
                });
            } catch (error) {
                logger.warn("Could not restore a push-to-talk connection.", error);
            }
        }
    }
    patchedPttConnections.clear();

    for (const [track, state] of trackedMicrophones) {
        if (track.readyState !== "ended") setActualTrackState(track, state.desired);
        removeTrack(track);
    }

    settings = null;
    enabledDescriptor = undefined;
    protectedEnabledSetter = null;
    originalClone = null;
    protectedClone = null;
    pttActive = false;
}
