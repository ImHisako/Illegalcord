/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { EquicordDevs } from "@utils/constants";
import definePlugin, { OptionType, PluginNative, ReporterTestable } from "@utils/types";
import { Alerts, Button, React, Select, showToast, TextInput, Toasts } from "@webpack/common";

import type { ActionInfo, InstallInfo, NativeResult, StereoMethod2Quality } from "./native";

const Native = VencordNative.pluginHelpers.StereoInstaller as PluginNative<typeof import("./native")>;
const SOURCE_URL = "https://github.com/ProdHallow/Discord-Stereo-Windows-MacOS-Linux";
const METHOD_2_SERVICE_URL = "https://discord-voice.xyz/";
const METHOD_2_TUTORIAL_URL = "https://www.youtube.com/watch?v=zSIIganbZxg";

type InstallerMethod = "method1" | "method2";

const METHOD_OPTIONS = [
    { label: "Stereo Installer", value: "method1" },
    { label: "Stereo Installer 2", value: "method2" }
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
                Stereo will be downloaded or installed from third party files. Not every update is always checked or reviewed by me as 100% safe, so be careful and use this plugin only if you accept your own responsibility for what it changes on your client.
            </Paragraph>
            <Paragraph>
                Stereo Installer 2 comes from the service discord-voice.xyz. Use only one of the two installers. Do not use both, because mixing them can corrupt Discord voice files and may force you to reinstall the Discord client.
            </Paragraph>
            <Paragraph>
                If you get corruption errors, use the index.js file from StereoMethods/Discord-Voice and check the tutorial if you need help fixing it.
            </Paragraph>
            <div className="vc-stereo-installer-warning-actions">
                <Button
                    color={Button.Colors.PRIMARY}
                    onClick={() => VencordNative.native.openExternal(SOURCE_URL)}
                >
                    Source code
                </Button>
                <Button
                    color={Button.Colors.PRIMARY}
                    onClick={() => VencordNative.native.openExternal(METHOD_2_SERVICE_URL)}
                >
                    discord-voice.xyz
                </Button>
                <Button
                    color={Button.Colors.PRIMARY}
                    onClick={() => VencordNative.native.openExternal(METHOD_2_TUTORIAL_URL)}
                >
                    Corruption fix tutorial
                </Button>
            </div>
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
            title: isMethod2 ? "Use Stereo Installer 2?" : "Use StereoInstaller?",
            body: (
                <div>
                    {isMethod2 ? (
                        <>
                            <Paragraph>
                                This will use the local {method2Quality} file from StereoMethods/Discord-Voice, rename it to discord_voice.node, and copy it into <code>{"modules\\discord_voice-1\\discord_voice"}</code>.
                            </Paragraph>
                            <Paragraph>
                                Stereo Installer 2 comes from discord-voice.xyz. Use only one installer method. Using both can corrupt Discord voice files and may force a Discord client reinstall.
                            </Paragraph>
                        </>
                    ) : (
                        <>
                            <Paragraph>
                                This will download the patched stereo module from a third party GitHub repository and replace your local discord_voice module after making a backup.
                            </Paragraph>
                            <Paragraph>
                                I do not guarantee that every upstream update has been personally checked as 100% safe. Continue only if you trust the source and accept responsibility for using it.
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
            title: "Replace discord_voice index.js?",
            body: (
                <div>
                    <Paragraph>
                        This will copy index.js from StereoMethods/Discord-Voice into <code>{"modules\\discord_voice-1\\discord_voice"}</code>.
                    </Paragraph>
                    <Paragraph>
                        Discord will close while the file is replaced. Use this only if you are fixing Stereo Installer 2 corruption or know you need that index.js.
                    </Paragraph>
                </div>
            ),
            confirmText: "Replace index.js",
            cancelText: "Cancel",
            confirmColor: Button.Colors.RED,
            onConfirm: () => void runAction("method2Index")
        });
    }

    function openSource(): void {
        VencordNative.native.openExternal(SOURCE_URL);
    }

    function openMethod2Service(): void {
        VencordNative.native.openExternal(METHOD_2_SERVICE_URL);
    }

    function openMethod2Tutorial(): void {
        VencordNative.native.openExternal(METHOD_2_TUTORIAL_URL);
    }

    React.useEffect(() => {
        void autoDetect();
    }, []);

    return (
        <div className="vc-stereo-installer-root">
            <div className="vc-stereo-installer-controls">
                <div className="vc-stereo-installer-select-grid">
                    <div className="vc-stereo-installer-select-row">
                        <div>
                            <span>Installer method</span>
                            <Paragraph>Use only one method at a time.</Paragraph>
                        </div>
                        <Select
                            options={METHOD_OPTIONS}
                            select={(value: InstallerMethod) => setInstallerMethod(value)}
                            isSelected={(value: InstallerMethod) => value === installerMethod}
                            serialize={(value: InstallerMethod) => value}
                        />
                    </div>

                    {installerMethod === "method2" && (
                        <div className="vc-stereo-installer-select-row">
                            <div>
                                <span>Stereo Installer 2 quality</span>
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
                </div>

                {installerMethod === "method2" && (
                    <div className="vc-stereo-installer-method2-note">
                        <Paragraph>
                            Stereo Installer 2 comes from discord-voice.xyz. Do not install both methods on the same client. If Discord voice files get corrupted, use index.js from StereoMethods/Discord-Voice and check the tutorial.
                        </Paragraph>
                        <div className="vc-stereo-installer-warning-actions">
                            <Button
                                color={Button.Colors.PRIMARY}
                                size={Button.Sizes.SMALL}
                                onClick={openMethod2Service}
                            >
                                discord-voice.xyz
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
                    <Button
                        color={Button.Colors.PRIMARY}
                        size={Button.Sizes.SMALL}
                        disabled={busy}
                        onClick={openSource}
                    >
                        Source code
                    </Button>
                </div>
            </div>

            {info && (
                <div className="vc-stereo-installer-info">
                    <InfoLine label="Client" value={info.clientLabel} />
                    <InfoLine label="Platform" value={`${info.platformLabel} ${info.readableOs}`} />
                    <InfoLine label="Voice module" value={info.voiceDir} />
                    {"logPath" in info && <InfoLine label="Log file" value={info.logPath} />}
                    <InfoLine label="Last patch" value={info.lastPatchLabel} />
                </div>
            )}

            <Paragraph className="vc-stereo-installer-status">{busy ? "Working..." : status}</Paragraph>

            {!!logs.length && (
                <pre className="vc-stereo-installer-log">
                    {logs.slice(-80).join("\n")}
                </pre>
            )}
        </div>
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
    description: "Installs and reverts the Discord stereo voice module from the Stereo Hub source.",
    tags: ["Utility"],
    authors: [EquicordDevs.irritably],
    reporterTestable: ReporterTestable.None,
    settings,
    settingsAboutComponent: ErrorBoundary.wrap(StereoWarning, { noop: true })
});
