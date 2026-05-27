/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { HeadphonesIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import SettingsPlugin from "@plugins/_core/settings";
import { EquicordDevs } from "@utils/constants";
import { removeFromArray } from "@utils/misc";
import definePlugin, { OptionType, PluginNative, ReporterTestable } from "@utils/types";
import { Alerts, Button, React, Select, SettingsRouter, showToast, TextInput, Toasts } from "@webpack/common";

import type { ActionInfo, InstallInfo, NativeResult, StereoMethod2Quality } from "./native";

const Native = VencordNative.pluginHelpers.StereoInstaller as PluginNative<typeof import("./native")>;
const SETTINGS_ENTRY_KEY = "illegalcord_stereo_installer";
const DISCORD_AUDIO_COLLECTIVE_SOURCE_URL = "https://github.com/ProdHallow/Discord-Stereo-Windows-MacOS-Linux";
const VOICE_PLAYGROUND_SOURCE_URL = "https://codeberg.org/UnpackedX/Discord-Experimental-Subsystem";
const VOICE_PLAYGROUND_TUTORIAL_URL = "https://www.youtube.com/watch?v=zSIIganbZxg";

type InstallerMethod = "method1" | "method2";

const METHOD_LABELS = {
    method1: "Discord Audio Collective Method",
    method2: "Voice Playground Method"
} satisfies Record<InstallerMethod, string>;

const METHOD_LAST_PATCH_KEYS = {
    method1: "discordAudioCollective",
    method2: "voicePlayground"
} satisfies Record<InstallerMethod, keyof InstallInfo["lastPatchLabels"]>;

const METHOD_OPTIONS = [
    { label: METHOD_LABELS.method1, value: "method1" },
    { label: METHOD_LABELS.method2, value: "method2" }
] satisfies Array<{ label: string; value: InstallerMethod; }>;

const METHOD_2_QUALITY_OPTIONS = [
    { label: "128", value: "128" },
    { label: "384", value: "384" },
    { label: "512", value: "512" }
] satisfies Array<{ label: string; value: StereoMethod2Quality; }>;

function appendLogs(existingLogs: string[], newLogs: string[] | undefined): string[] {
    return [...existingLogs, ...(newLogs ?? [])];
}

function StereoWarning() {
    return (
        <div className="vc-stereo-installer-warning">
            <Heading tag="h3">StereoInstaller warning</Heading>
            <Paragraph>
                This plugin replaces local Discord voice files to enable higher audio quality. It keeps a backup so you can restore the original files when needed.
            </Paragraph>
            <Paragraph>
                Keep one method installed at a time. Revert to the saved backup before switching methods or after a Discord update if voice stops working.
            </Paragraph>
        </div>
    );
}

function InfoLine({ label, value }: { label: string; value: string; }) {
    return (
        <div className="vc-stereo-installer-info-line">
            <span>{label}</span>
            <code>{value || "--"}</code>
        </div>
    );
}

function StereoInstallerPanel() {
    const [root, setRoot] = React.useState("");
    const [info, setInfo] = React.useState<InstallInfo | ActionInfo | null>(null);
    const [status, setStatus] = React.useState("Ready.");
    const [logs, setLogs] = React.useState<string[]>([]);
    const [busy, setBusy] = React.useState(false);
    const [installerMethod, setInstallerMethod] = React.useState<InstallerMethod>("method1");
    const [method2Quality, setMethod2Quality] = React.useState<StereoMethod2Quality>("128");
    const voicePlaygroundUnavailable = !!info && info.platformKey !== "windows";
    const selectedLastPatch = info?.lastPatchLabels[METHOD_LAST_PATCH_KEYS[installerMethod]] ?? "--";

    async function runNative<T>(action: () => Promise<NativeResult<T>>): Promise<T | null> {
        setBusy(true);

        try {
            const result = await action();
            setLogs(currentLogs => appendLogs(currentLogs, result.logs));

            if (!result.success) {
                setStatus(result.error);
                showToast(result.error, Toasts.Type.FAILURE);
                return null;
            }

            return result.data;
        } finally {
            setBusy(false);
        }
    }

    async function autoDetect(): Promise<void> {
        const detected = await runNative(() => Native.autoDetect());
        if (!detected) return;

        setInfo(detected);
        setRoot(detected.discordRoot);
        setStatus("Discord install detected.");
    }

    async function browse(): Promise<void> {
        const selected = await runNative(() => Native.chooseDiscordRoot());
        if (!selected) return;

        setInfo(selected);
        setRoot(selected.discordRoot);
        setStatus("Discord install selected.");
    }

    async function runAction(kind: "patch" | "revert" | "method2Index"): Promise<void> {
        if (!root.trim()) {
            setStatus("Choose a Discord install folder first.");
            showToast("Choose a Discord install folder first.", Toasts.Type.FAILURE);
            return;
        }

        const result = await runNative<ActionInfo>(() => {
            if (kind === "revert") return Native.revert(root);
            if (kind === "method2Index") return Native.patchMethod2Index(root);
            if (installerMethod === "method2") return Native.patchMethod2(root, method2Quality);

            return Native.patch(root);
        });
        if (!result) return;

        setInfo(result);
        setStatus("Discord will close now. Check the StereoInstaller log if it does not reopen.");
        showToast("Discord will close now to finish StereoInstaller.", Toasts.Type.SUCCESS);
    }

    function confirmPatch(): void {
        const isMethod2 = installerMethod === "method2";

        Alerts.show({
            title: isMethod2 ? "Use Voice Playground Method?" : "Use Discord Audio Collective Method?",
            body: (
                <div>
                    {isMethod2 ? (
                        <>
                            <Paragraph>
                                This will use the local {method2Quality} file from StereoMethods/Discord-Voice, rename it to discord_voice.node, and copy it into <code>{"modules\\discord_voice-1\\discord_voice"}</code>.
                            </Paragraph>
                            <Paragraph>
                                Voice Playground Method replaces the local voice module to enable higher audio quality. Use only one method on the same Discord install.
                            </Paragraph>
                        </>
                    ) : (
                        <>
                            <Paragraph>
                                This will download the Discord Audio Collective Method files for your platform, save a backup, and replace the local Discord voice module to enable higher audio quality.
                            </Paragraph>
                            <Paragraph>
                                Use Revert to restore the saved backup before switching methods or after a Discord update if voice stops working.
                            </Paragraph>
                        </>
                    )}
                </div>
            ),
            confirmText: "Patch Discord voice",
            cancelText: "Cancel",
            confirmColor: Button.Colors.RED,
            onConfirm: () => void runAction("patch")
        });
    }

    function confirmMethod2IndexPatch(): void {
        Alerts.show({
            title: "Replace Voice Playground index.js?",
            body: (
                <div>
                    <Paragraph>
                        This will copy index.js from StereoMethods/Discord-Voice into <code>{"modules\\discord_voice-1\\discord_voice"}</code>.
                    </Paragraph>
                    <Paragraph>
                        Discord will close while the file is replaced. Use this only if you are fixing Voice Playground Method files or know you need that index.js.
                    </Paragraph>
                </div>
            ),
            confirmText: "Replace index.js",
            cancelText: "Cancel",
            confirmColor: Button.Colors.RED,
            onConfirm: () => void runAction("method2Index")
        });
    }

    function selectInstallerMethod(value: InstallerMethod): void {
        if (value === "method2" && voicePlaygroundUnavailable) {
            setStatus("Voice Playground Method is only available on Windows. Linux support is handled by Discord Audio Collective Method.");
            showToast("Voice Playground Method is only available on Windows.", Toasts.Type.FAILURE);
            return;
        }

        setInstallerMethod(value);
    }

    function openDiscordAudioCollectiveSource(): void {
        VencordNative.native.openExternal(DISCORD_AUDIO_COLLECTIVE_SOURCE_URL);
    }

    function openVoicePlaygroundSource(): void {
        VencordNative.native.openExternal(VOICE_PLAYGROUND_SOURCE_URL);
    }

    function openMethod2Tutorial(): void {
        VencordNative.native.openExternal(VOICE_PLAYGROUND_TUTORIAL_URL);
    }

    React.useEffect(() => {
        void autoDetect();
    }, []);

    React.useEffect(() => {
        if (!voicePlaygroundUnavailable || installerMethod !== "method2") return;

        setInstallerMethod("method1");
        setStatus("Voice Playground Method is only available on Windows. Linux support is handled by Discord Audio Collective Method.");
    }, [installerMethod, voicePlaygroundUnavailable]);

    return (
        <div className="vc-stereo-installer-root">
            <div className="vc-stereo-installer-controls">
                <div className="vc-stereo-installer-select-grid">
                    <div className="vc-stereo-installer-select-row">
                        <div>
                            <span>Installer method</span>
                            <Paragraph>{voicePlaygroundUnavailable ? "Voice Playground Method is Windows-only." : "Use only one method at a time."}</Paragraph>
                        </div>
                        <Select
                            options={METHOD_OPTIONS}
                            select={selectInstallerMethod}
                            isSelected={(value: InstallerMethod) => value === installerMethod}
                            serialize={(value: InstallerMethod) => value}
                        />
                    </div>

                    {installerMethod === "method2" && (
                        <div className="vc-stereo-installer-select-row">
                            <div>
                                <span>Voice Playground quality</span>
                                <Paragraph>The selected file will be installed as discord_voice.node.</Paragraph>
                            </div>
                            <Select
                                options={METHOD_2_QUALITY_OPTIONS}
                                select={(value: StereoMethod2Quality) => setMethod2Quality(value)}
                                isSelected={(value: StereoMethod2Quality) => value === method2Quality}
                                serialize={(value: StereoMethod2Quality) => value}
                            />
                        </div>
                    )}

                    <div className="vc-stereo-installer-select-row">
                        <div>
                            <span>Source code</span>
                            <Paragraph>Each method has its own upstream source.</Paragraph>
                        </div>
                        <div className="vc-stereo-installer-warning-actions">
                            <Button
                                color={Button.Colors.PRIMARY}
                                size={Button.Sizes.SMALL}
                                onClick={openDiscordAudioCollectiveSource}
                            >
                                Discord Audio Collective
                            </Button>
                            <Button
                                color={Button.Colors.PRIMARY}
                                size={Button.Sizes.SMALL}
                                onClick={openVoicePlaygroundSource}
                            >
                                Voice Playground
                            </Button>
                        </div>
                    </div>
                </div>

                {installerMethod === "method2" && (
                    <div className="vc-stereo-installer-method2-note">
                        <Paragraph>
                            Voice Playground Method uses bundled Windows payloads from StereoMethods/Discord-Voice for higher audio quality. Do not install both methods on the same client. If Discord voice files stop working, use the bundled index.js repair and check the tutorial.
                        </Paragraph>
                        <div className="vc-stereo-installer-warning-actions">
                            <Button
                                color={Button.Colors.PRIMARY}
                                size={Button.Sizes.SMALL}
                                onClick={openVoicePlaygroundSource}
                            >
                                Voice Playground source
                            </Button>
                            <Button
                                color={Button.Colors.PRIMARY}
                                size={Button.Sizes.SMALL}
                                onClick={openMethod2Tutorial}
                            >
                                Corruption fix tutorial
                            </Button>
                            <Button
                                color={Button.Colors.RED}
                                size={Button.Sizes.SMALL}
                                disabled={busy}
                                onClick={confirmMethod2IndexPatch}
                            >
                                Replace index.js
                            </Button>
                        </div>
                    </div>
                )}

                <TextInput
                    value={root}
                    placeholder="Discord install folder"
                    onChange={(value: string) => setRoot(value)}
                    disabled={busy}
                />
                <div className="vc-stereo-installer-buttons">
                    <Button
                        color={Button.Colors.PRIMARY}
                        size={Button.Sizes.SMALL}
                        disabled={busy}
                        onClick={() => void autoDetect()}
                    >
                        Auto-detect
                    </Button>
                    <Button
                        color={Button.Colors.PRIMARY}
                        size={Button.Sizes.SMALL}
                        disabled={busy}
                        onClick={() => void browse()}
                    >
                        Browse
                    </Button>
                    <Button
                        color={Button.Colors.GREEN}
                        size={Button.Sizes.SMALL}
                        disabled={busy}
                        onClick={confirmPatch}
                    >
                        Patch Discord voice
                    </Button>
                    <Button
                        color={Button.Colors.RED}
                        size={Button.Sizes.SMALL}
                        disabled={busy}
                        onClick={() => void runAction("revert")}
                    >
                        Revert to backup
                    </Button>
                </div>
            </div>

            {info && (
                <div className="vc-stereo-installer-info">
                    <InfoLine label="Client" value={info.clientLabel} />
                    <InfoLine label="Platform" value={`${info.platformLabel} ${info.readableOs}`} />
                    <InfoLine label="Voice module" value={info.voiceDir} />
                    {"logPath" in info && <InfoLine label="Log file" value={info.logPath} />}
                    <InfoLine label={`${METHOD_LABELS[installerMethod]} last patch`} value={selectedLastPatch} />
                </div>
            )}

            <Paragraph className="vc-stereo-installer-status">{busy ? "Working..." : status}</Paragraph>

            {!!logs.length && (
                <div className="vc-stereo-installer-log-panel">
                    <pre className="vc-stereo-installer-log">{logs.slice(-80).join("\n")}</pre>
                </div>
            )}
        </div>
    );
}

function StereoInstallerPage() {
    return (
        <>
            <StereoWarning />
            <StereoInstallerPanel />
        </>
    );
}

const settings = definePluginSettings({
    installer: {
        type: OptionType.COMPONENT,
        component: ErrorBoundary.wrap(StereoInstallerPanel, { noop: true }),
    }
});

export default definePlugin({
    name: "StereoInstaller",
    description: "Installs and reverts the Discord stereo voice module from selected method sources.",
    tags: ["Utility"],
    authors: [EquicordDevs.irritably],
    reporterTestable: ReporterTestable.None,
    settings,
    settingsAboutComponent: ErrorBoundary.wrap(StereoWarning, { noop: true }),
    toolboxActions: {
        "Open StereoInstaller": () => SettingsRouter.openUserSettings(`${SETTINGS_ENTRY_KEY}_panel`),
    },

    start() {
        if (SettingsPlugin.customEntries.some(entry => entry.key === SETTINGS_ENTRY_KEY)) return;

        SettingsPlugin.customEntries.push({
            key: SETTINGS_ENTRY_KEY,
            title: "StereoInstaller",
            Component: ErrorBoundary.wrap(StereoInstallerPage, { noop: true }),
            Icon: HeadphonesIcon,
        });
    },

    stop() {
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === SETTINGS_ENTRY_KEY);
    }
});
