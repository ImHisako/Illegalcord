/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { DeleteIcon, HeadphonesIcon, NoEntrySignIcon, WarningIcon } from "@components/Icons";
import { Paragraph } from "@components/Paragraph";
import SettingsPlugin from "@plugins/_core/settings";
import { classes, removeFromArray } from "@utils/misc";
import definePlugin, { OptionType, PluginNative, ReporterTestable } from "@utils/types";
import { Alerts, Button, React, Select, SettingsRouter, showToast, TextInput, Toasts } from "@webpack/common";

import type { ActionInfo, InstallInfo, NativeResult } from "./native";

const Native = VencordNative.pluginHelpers.StereoInstaller as PluginNative<typeof import("./native")>;
const SETTINGS_ENTRY_KEY = "illegalcord_stereo_installer";
const LOG_RETENTION_RESTARTS = 5;
const DISCORD_AUDIO_COLLECTIVE_SOURCE_URL = "https://github.com/ProdHallow/Discord-Stereo-Windows-MacOS-Linux";
const VOICE_PLAYGROUND_SOURCE_URL = "https://codeberg.org/UnpackedX/Discord-Experimental-Subsystem";
const VOICE_PLAYGROUND_TUTORIAL_URL = "https://www.youtube.com/watch?v=zSIIganbZxg";

type InstallerMethod = "method1" | "method2";
type LogLevel = "error" | "info" | "success" | "warning";

interface LogEntry {
    id: number;
    line: string;
}

interface PrivateSettings {
    logRestartCount?: number;
}

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

let lastRepatchNotificationKey = "";
let nextLogId = 0;
let launchCounted = false;

function appendLogs(existingLogs: LogEntry[], newLogs: string[] | undefined): LogEntry[] {
    return [...existingLogs, ...(newLogs ?? []).map(line => ({ id: nextLogId++, line }))];
}

function notifyRepatchIfNeeded(info: InstallInfo): void {
    if (!info.repatchWarning) return;

    const key = `${info.discordRoot}:${info.clientLabel}:${info.repatchWarning}`;
    if (lastRepatchNotificationKey === key) return;

    lastRepatchNotificationKey = key;
    showNotification({
        title: "StereoInstaller",
        body: info.repatchWarning,
        permanent: true,
        onClick: () => SettingsRouter.openUserSettings(`${SETTINGS_ENTRY_KEY}_panel`)
    });
}

async function maintainInstallerLogs(): Promise<void> {
    if (launchCounted) return;
    launchCounted = true;

    const savedCount = settings.store.logRestartCount;
    const restartCount = (typeof savedCount === "number" && Number.isInteger(savedCount) && savedCount >= 0 ? savedCount : 0) + 1;

    if (restartCount < LOG_RETENTION_RESTARTS) {
        settings.store.logRestartCount = restartCount;
        return;
    }

    const result = await Native.clearLogs().catch(() => null);
    settings.store.logRestartCount = result?.success ? 0 : LOG_RETENTION_RESTARTS - 1;
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

function InstallationStatus({ info }: { info: InstallInfo | ActionInfo; }) {
    const method = info.installedMethod ? METHOD_LABELS[info.installedMethod === "discordAudioCollective" ? "method1" : "method2"] : "StereoInstaller";

    if (info.installStatus === "installed") {
        return (
            <div className={classes("vc-stereo-installer-install-status", "vc-stereo-installer-install-status-installed")}>
                <HeadphonesIcon width={28} height={28} />
                <div>
                    <Heading tag="h3">Stereo is installed</Heading>
                    <Paragraph>{method} is active for {info.clientLabel}.</Paragraph>
                </div>
            </div>
        );
    }

    if (info.installStatus === "needsReinstall") {
        return (
            <div className={classes("vc-stereo-installer-install-status", "vc-stereo-installer-install-status-needs-reinstall")}>
                <WarningIcon width={28} height={28} />
                <div>
                    <Heading tag="h3">Stereo must be installed again</Heading>
                    <Paragraph>Discord was updated after {method} was installed. Patch Discord voice again.</Paragraph>
                </div>
            </div>
        );
    }

    return (
        <div className={classes("vc-stereo-installer-install-status", "vc-stereo-installer-install-status-not-installed")}>
            <NoEntrySignIcon width={28} height={28} />
            <div>
                <Heading tag="h3">Stereo is not installed</Heading>
                <Paragraph>Choose a method and patch Discord voice to enable stereo audio.</Paragraph>
            </div>
        </div>
    );
}

function LogLine({ entry }: { entry: LogEntry; }) {
    const match = /^\[([^\]]+)]\s*(.*)$/.exec(entry.line);
    const timestamp = match?.[1] || "";
    const rawMessage = match?.[2] || entry.line;
    const level: LogLevel = /^(?:FAIL|ERROR):/i.test(rawMessage)
        ? "error"
        : /^WARN:/i.test(rawMessage)
            ? "warning"
            : /^OK:/i.test(rawMessage)
                ? "success"
                : "info";
    const message = rawMessage.replace(/^(?:FAIL|ERROR|WARN|OK):\s*/i, "");

    return (
        <div className={classes("vc-stereo-installer-log-line", `vc-stereo-installer-log-line-${level}`)}>
            <span className="vc-stereo-installer-log-time">{timestamp || "--"}</span>
            <span className="vc-stereo-installer-log-level">{level}</span>
            <span className="vc-stereo-installer-log-message">{message}</span>
        </div>
    );
}

function StereoInstallerPanel() {
    const [root, setRoot] = React.useState("");
    const [info, setInfo] = React.useState<InstallInfo | ActionInfo | null>(null);
    const [status, setStatus] = React.useState("Ready.");
    const [logs, setLogs] = React.useState<LogEntry[]>([]);
    const [busy, setBusy] = React.useState(false);
    const [installerMethod, setInstallerMethod] = React.useState<InstallerMethod>("method1");
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
        setStatus(detected.repatchWarning || "Discord install detected.");
        notifyRepatchIfNeeded(detected);
    }

    async function loadLogs(): Promise<void> {
        const result = await Native.readLogs();
        if (result.success) setLogs(appendLogs([], result.data));
    }

    async function clearLogs(): Promise<void> {
        const cleared = await runNative(() => Native.clearLogs());
        if (!cleared) return;

        settings.store.logRestartCount = 0;
        setLogs([]);
        setStatus("Logs cleared.");
        showToast("StereoInstaller logs cleared.", Toasts.Type.SUCCESS);
    }

    async function browse(): Promise<void> {
        const selected = await runNative(() => Native.chooseDiscordRoot());
        if (!selected) return;

        setInfo(selected);
        setRoot(selected.discordRoot);
        setStatus(selected.repatchWarning || "Discord install selected.");
        notifyRepatchIfNeeded(selected);
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
            if (installerMethod === "method2") return Native.patchMethod2(root);

            return Native.patch(root);
        });
        if (!result) return;

        settings.store.logRestartCount = 0;
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
                                This will install the local 512 discord_voice.node and the bundled index.js into the detected discord_voice module.
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
                        This will copy index.js from StereoMethods/Discord-Voice into the detected discord_voice module.
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
        void loadLogs().then(autoDetect);
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
                            Voice Playground Method automatically installs both discord_voice.node and index.js from StereoMethods/Discord-Voice. Do not install both methods on the same client. The separate index.js button remains available for repairs.
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

            {info && <InstallationStatus info={info} />}

            {info && (
                <div className="vc-stereo-installer-info">
                    <InfoLine label="Client" value={info.clientLabel} />
                    <InfoLine label="Platform" value={`${info.platformLabel} ${info.readableOs}`} />
                    <InfoLine label="Voice module" value={info.voiceDir} />
                    {"logPath" in info && <InfoLine label="Log file" value={info.logPath} />}
                    <InfoLine label="Last patch" value={`${METHOD_LABELS[installerMethod]} · ${selectedLastPatch}`} />
                </div>
            )}

            <Paragraph className="vc-stereo-installer-status">{busy ? "Working..." : status}</Paragraph>

            <div className="vc-stereo-installer-log-panel">
                <div className="vc-stereo-installer-log-header">
                    <div>
                        <Heading tag="h3">Installer logs</Heading>
                        <Paragraph>{logs.length ? `${logs.length} log entries.` : "No log entries yet."}</Paragraph>
                    </div>
                    <Button
                        color={Button.Colors.RED}
                        size={Button.Sizes.SMALL}
                        disabled={busy || !logs.length}
                        onClick={() => void clearLogs()}
                    >
                        <DeleteIcon width={16} height={16} />
                        Clear logs
                    </Button>
                </div>
                <div className="vc-stereo-installer-log" role="log" aria-live="polite">
                    {logs.length
                        ? logs.slice(-200).map(entry => <LogLine key={entry.id} entry={entry} />)
                        : <div className="vc-stereo-installer-log-empty">StereoInstaller activity will appear here.</div>}
                </div>
            </div>
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
}).withPrivateSettings<PrivateSettings>();

export default definePlugin({
    name: "StereoInstaller",
    description: "Installs and reverts the Discord stereo voice module from selected method sources.",
    tags: ["Utility"],
    authors: [{ name: "irritably", id: 928787166916640838n }],
    reporterTestable: ReporterTestable.None,
    settings,
    settingsAboutComponent: ErrorBoundary.wrap(StereoWarning, { noop: true }),
    toolboxActions: {
        "Open StereoInstaller": () => SettingsRouter.openUserSettings(`${SETTINGS_ENTRY_KEY}_panel`),
    },

    start() {
        if (!SettingsPlugin.customEntries.some(entry => entry.key === SETTINGS_ENTRY_KEY)) {
            SettingsPlugin.customEntries.push({
                key: SETTINGS_ENTRY_KEY,
                title: "StereoInstaller",
                Component: ErrorBoundary.wrap(StereoInstallerPage, { noop: true }),
                Icon: HeadphonesIcon,
            });
        }

        void maintainInstallerLogs().then(() => Native.autoDetect()).then(result => {
            if (result.success) notifyRepatchIfNeeded(result.data);
        }, () => void 0);
    },

    stop() {
        removeFromArray(SettingsPlugin.customEntries, entry => entry.key === SETTINGS_ENTRY_KEY);
    }
});
