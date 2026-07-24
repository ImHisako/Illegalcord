/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaButtonFactory, UserAreaRenderProps } from "@api/UserArea";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { FormSwitch } from "@components/FormSwitch";
import { Logger } from "@utils/Logger";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { chooseFile } from "@utils/web";
import type { AudioDevice, RenderModalProps } from "@vencord/discord-types";
import { MediaEngineStore, Modal, openModal, React, SearchableSelect, Toasts } from "@webpack/common";

import {
    addSound,
    dispose,
    getSounds,
    isMicrophoneActive,
    isPlaying,
    playSound,
    removeSound,
    setMicrophoneVolume,
    SoundPadSound,
    startMicrophone,
    stopAll,
    stopMicrophone,
    stopSound,
    subscribe
} from "./player";

const logger = new Logger("SoundPad");

const settings = definePluginSettings({
    volume: {
        type: OptionType.SLIDER,
        description: "Volume sent through the selected audio device.",
        markers: makeRange(0, 100, 10),
        default: 80,
        stickToMarkers: false
    },
    monitorLocally: {
        type: OptionType.BOOLEAN,
        description: "Also play sounds through the default output so you can hear them.",
        default: true
    },
    microphoneVolume: {
        type: OptionType.SLIDER,
        description: "Volume of the physical microphone mixed into the virtual device.",
        markers: makeRange(0, 100, 10),
        default: 100,
        stickToMarkers: false,
        onChange: setMicrophoneVolume
    },
    inputDeviceId: {
        type: OptionType.STRING,
        description: "Physical microphone mixed with SoundPad.",
        default: "default",
        hidden: true
    },
    outputDeviceId: {
        type: OptionType.STRING,
        description: "Audio output used for microphone routing.",
        default: "default",
        hidden: true
    }
});

interface SoundPadModalProps {
    modalProps: RenderModalProps;
}

interface DeviceOption {
    label: string;
    value: string;
}

function getDeviceOptions(devices: AudioDevice[], defaultLabel: string) {
    const options = devices
        .filter(device => !device.disabled)
        .map(device => ({
            label: device.name,
            value: device.index === -1 ? "default" : device.id
        }));

    if (!options.some(device => device.value === "default")) {
        options.unshift({ label: defaultLabel, value: "default" });
    }

    return options;
}

function showToast(message: string, type: typeof Toasts.Type[keyof typeof Toasts.Type]) {
    Toasts.show({ message, type, id: Toasts.genId() });
}

function formatSize(size: number) {
    return size < 1024 * 1024
        ? `${Math.ceil(size / 1024)} KB`
        : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function addAudioFile() {
    const file = await chooseFile("audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac,.opus,.webm");
    if (!file) return;

    if (!file.type.startsWith("audio/") && !/\.(?:mp3|wav|ogg|flac|m4a|aac|opus|webm)$/i.test(file.name)) {
        showToast("The selected file does not appear to be audio.", Toasts.Type.FAILURE);
        return;
    }

    addSound(file);
}

async function startSound(sound: SoundPadSound) {
    try {
        await playSound(
            sound,
            settings.store.outputDeviceId,
            settings.store.volume,
            settings.store.monitorLocally
        );
    } catch (error) {
        logger.error("Could not route the selected audio file.", error);
        showToast("Could not play audio through the selected device.", Toasts.Type.FAILURE);
    }
}

async function toggleMicrophone(enabled: boolean) {
    if (!enabled) {
        stopMicrophone();
        return;
    }

    if (settings.store.outputDeviceId === "default") {
        showToast("Select a virtual audio cable as the output first.", Toasts.Type.FAILURE);
        return;
    }

    try {
        await startMicrophone(
            settings.store.inputDeviceId,
            settings.store.outputDeviceId,
            settings.store.microphoneVolume
        );
        showToast("Physical microphone added to the mix.", Toasts.Type.SUCCESS);
    } catch (error) {
        logger.error("Could not route the physical microphone.", error);
        showToast("Could not connect the physical microphone.", Toasts.Type.FAILURE);
    }
}

function SoundPadModal({ modalProps }: SoundPadModalProps) {
    const { inputDeviceId, monitorLocally, outputDeviceId } = settings.use(["inputDeviceId", "monitorLocally", "outputDeviceId"]);
    const [, forceUpdate] = React.useReducer(value => value + 1, 0);
    const [inputs, setInputs] = React.useState<DeviceOption[]>([]);
    const [outputs, setOutputs] = React.useState<DeviceOption[]>([]);

    React.useEffect(() => subscribe(forceUpdate), []);

    React.useEffect(() => {
        let active = true;
        const mediaEngine = MediaEngineStore.getMediaEngine();

        async function refreshDevices() {
            try {
                const [inputDevices, outputDevices] = await Promise.all([
                    mediaEngine.getAudioInputDevices(),
                    mediaEngine.getAudioOutputDevices()
                ]);
                if (!active) return;

                setInputs(getDeviceOptions(inputDevices, "Default microphone"));
                setOutputs(getDeviceOptions(outputDevices, "Default output"));
            } catch (error) {
                logger.error("Could not read audio devices from Discord.", error);
            }
        }

        function handleDeviceChange(inputDevices: AudioDevice[], outputDevices: AudioDevice[]) {
            if (!active) return;
            setInputs(getDeviceOptions(inputDevices, "Default microphone"));
            setOutputs(getDeviceOptions(outputDevices, "Default output"));
        }

        void refreshDevices();
        mediaEngine.on("DeviceChange", handleDeviceChange);
        return () => {
            active = false;
            mediaEngine.off("DeviceChange", handleDeviceChange);
        };
    }, []);

    const sounds = getSounds();

    return (
        <Modal
            {...modalProps}
            size="md"
            title="SoundPad"
            subtitle="Play local audio files through a virtual microphone."
            actions={[{ text: "Close", variant: "primary", onClick: modalProps.onClose }]}
        >
            <div className="vc-soundpad-modal">
                <BaseText
                    size="sm"
                    className={`vc-soundpad-notice${outputDeviceId === "default" ? " vc-soundpad-notice-warning" : ""}`}
                >
                    SoundPad requires a virtual audio cable. Select CABLE Input below, then set CABLE Output as Discord's input device. For cleaner sound, disabling Noise Suppression, Krisp, Echo Cancellation, and Automatic Gain Control is recommended.
                </BaseText>

                <div className="vc-soundpad-device">
                    <BaseText size="sm" weight="semibold">Virtual microphone output</BaseText>
                    <SearchableSelect
                        options={outputs}
                        value={outputDeviceId}
                        placeholder="Select an audio output device"
                        onChange={value => {
                            stopMicrophone();
                            settings.store.outputDeviceId = value;
                        }}
                        maxVisibleItems={6}
                        closeOnSelect
                    />
                </div>

                <div className="vc-soundpad-device">
                    <BaseText size="sm" weight="semibold">Physical microphone</BaseText>
                    <SearchableSelect
                        options={inputs}
                        value={inputDeviceId}
                        placeholder="Select your physical microphone"
                        onChange={value => {
                            stopMicrophone();
                            settings.store.inputDeviceId = value;
                        }}
                        maxVisibleItems={6}
                        closeOnSelect
                    />
                </div>

                <FormSwitch
                    title="Mix physical microphone"
                    description="Sends your voice and SoundPad audio through the same virtual cable."
                    value={isMicrophoneActive()}
                    onChange={value => void toggleMicrophone(value)}
                    hideBorder
                />

                <FormSwitch
                    title="Monitor locally"
                    description="Plays a second copy through the default output device."
                    value={monitorLocally}
                    onChange={value => settings.store.monitorLocally = value}
                    hideBorder
                />

                <div className="vc-soundpad-toolbar">
                    <Button size="small" onClick={() => void addAudioFile()}>Add audio</Button>
                    <Button size="small" variant="dangerSecondary" onClick={stopAll}>Stop all</Button>
                </div>

                <div className="vc-soundpad-list">
                    {sounds.length === 0
                        ? <div className="vc-soundpad-empty">Add an MP3, WAV, OGG, or another supported audio file.</div>
                        : sounds.map(sound => {
                            const active = isPlaying(sound.id);
                            return (
                                <div className="vc-soundpad-row" key={sound.id}>
                                    <div className="vc-soundpad-row-info">
                                        <BaseText className="vc-soundpad-row-name" size="sm" weight="semibold">{sound.name}</BaseText>
                                        <BaseText size="xs" color="text-muted">{formatSize(sound.size)}</BaseText>
                                    </div>
                                    <div className="vc-soundpad-row-actions">
                                        <Button
                                            size="small"
                                            variant={active ? "dangerSecondary" : "primary"}
                                            onClick={() => active ? stopSound(sound.id) : void startSound(sound)}
                                        >
                                            {active ? "Stop" : "Play"}
                                        </Button>
                                        <Button size="small" variant="secondary" onClick={() => removeSound(sound)}>Remove</Button>
                                    </div>
                                </div>
                            );
                        })}
                </div>
            </div>
        </Modal>
    );
}

const SafeSoundPadModal = ErrorBoundary.wrap(SoundPadModal, { noop: true });

function openSoundPad() {
    openModal(modalProps => <SafeSoundPadModal modalProps={modalProps} />);
}

function SoundPadIcon({ className }: { className?: string; }) {
    return (
        <svg className={className} width="20" height="20" viewBox="0 0 24 24" aria-hidden>
            <path fill="currentColor" d="M4 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H4Zm3.5 4.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm9 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm-9 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm9 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
        </svg>
    );
}

function SoundPadButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    return (
        <UserAreaButton
            tooltipText={hideTooltips ? void 0 : "Open SoundPad"}
            icon={<SoundPadIcon className={iconForeground} />}
            role="button"
            aria-label="Open SoundPad"
            plated={nameplate != null}
            onClick={openSoundPad}
        />
    );
}

const SoundPadUserAreaButton: UserAreaButtonFactory = props => <SoundPadButton {...props} />;

function SoundPadSettings() {
    return (
        <div className="vc-soundpad-settings">
            <BaseText size="sm" color="text-muted">
                Requires CABLE Output as Discord's input device. Disabling Noise Suppression and Krisp is recommended. Added files remain available until Discord restarts.
            </BaseText>
            <Button size="small" onClick={openSoundPad}>Open SoundPad</Button>
        </div>
    );
}

const SafeSoundPadSettings = ErrorBoundary.wrap(SoundPadSettings, { noop: true });

export default definePlugin({
    name: "SoundPad",
    description: "Routes local audio files through a virtual microphone device. (Beta) Require https://vb-audio.com/Cable/",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    tags: ["Voice", "Utility"],
    dependencies: ["UserAreaAPI"],
    settings,
    settingsAboutComponent: SafeSoundPadSettings,
    userAreaButton: {
        icon: SoundPadIcon,
        render: SoundPadUserAreaButton
    },
    toolboxActions: {
        "Open SoundPad": openSoundPad
    },
    stop: dispose
});
