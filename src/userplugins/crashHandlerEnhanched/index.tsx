/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./styles.css";

import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { plugins as Plugins, stopPlugin } from "@api/PluginManager";
import { definePluginSettings, Settings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { CopyIcon, OpenExternalIcon, WarningIcon } from "@components/Icons";
import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { relaunch } from "@utils/native";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { maybePromptToUpdate } from "@utils/updater";
import type { RenderModalProps } from "@vencord/discord-types";
import { filters, findBulk, proxyLazyWebpack } from "@webpack";
import { closeAllModals, closeModal, DraftType, ExpressionPickerStore, FluxDispatcher, Modal, NavigationRouter, openModal, SelectedChannelStore } from "@webpack/common";

import type * as NativeModule from "./native";

const PLUGIN_NAME = "CrashHandlerEnhanced";
const TELEGRAM_URL = "https://t.me/Illegalcord";
const REINSTALL_URL = "https://github.com/ImHisako/Illegalcord";
const cl = classNameFactory("vc-crash-handler-enhanced-");
const logger = new Logger("CrashHandlerEnhanced");
const SETTINGS_KEYS: Array<"lastCrashAt" | "crashCount"> = ["lastCrashAt", "crashCount"];
const PROTECTED_PLUGIN_NAMES = new Set([PLUGIN_NAME, "CrashHandler"]);
const NO_PLUGIN_DETECTED = "No plugin detected";
const NO_PLUGIN_DETECTION_REASON = "The crash stack did not match any enabled plugin.";
const NO_PLUGIN_DISABLED = "None";
const NO_PLUGIN_DISABLE_REASON = "No plugin was disabled.";
const Native = VencordNative.pluginHelpers.CrashHandlerEnhanced as PluginNative<typeof NativeModule> | undefined;

interface CrashBoundary {
    setState(state: CrashErrorState | RecoveredCrashState): void;
}

interface CrashErrorState {
    error?: unknown;
    info?: unknown;
}

interface RecoveredCrashState {
    error: null;
    info: null;
}

interface CrashReport {
    id: string;
    timestamp: number;
    message: string;
    stack?: string;
    componentStack?: string;
    channelId?: string;
    crashCount: number;
    recentCrashCount: number;
    recovered: boolean;
    suspectedPlugin: string;
    suspectedPluginReason: string;
    disabledPlugin: string;
    disableReason: string;
    logFilePath?: string;
}

interface DraftManagerLike {
    clearDraft(channelId: string | undefined, draftType: string | number): void;
}

interface ModalStackLike {
    popAll(): void;
}

interface LazyModules {
    DraftManager: DraftManagerLike;
    ModalStack: ModalStackLike;
}

interface DraftTypes {
    ChannelMessage: string | number;
    SlashCommand: string | number;
}

interface CrashSupportModalProps {
    modalProps: RenderModalProps;
    report: CrashReport;
}

interface PluginDetection {
    name: string;
    reason: string;
}

const { DraftManager, ModalStack } = proxyLazyWebpack<LazyModules>(() => {
    const [modalStack, draftManager] = findBulk(
        filters.byProps("pushLazy", "popAll"),
        filters.byProps("clearDraft", "saveDraft"),
    ) as unknown[];

    return {
        DraftManager: draftManager as DraftManagerLike,
        ModalStack: modalStack as ModalStackLike
    };
});

const settings = definePluginSettings({
    recoverClient: {
        type: OptionType.BOOLEAN,
        description: "Try to recover the client after Discord shows the crash screen.",
        default: true
    },
    navigateHomeOnCrash: {
        type: OptionType.BOOLEAN,
        description: "Go back to direct messages after a crash recovery.",
        default: false
    },
    showSupportPopup: {
        type: OptionType.BOOLEAN,
        description: "Show the Illegalcord support popup after a crash.",
        default: true
    },
    promptForUpdates: {
        type: OptionType.BOOLEAN,
        description: "Check for an Illegalcord update after the first crash in this session.",
        default: true
    },
    logCrashesToDisk: {
        type: OptionType.BOOLEAN,
        description: "Save every crash report to the CrashLogs folder.",
        default: true
    },
    autoDisableCrashedPlugins: {
        type: OptionType.BOOLEAN,
        description: "Automatically disable a plugin when the crash report strongly points to it.",
        default: true
    },
    showRecoveryToast: {
        type: OptionType.BOOLEAN,
        description: "Show a small recovery notification after the crash is handled.",
        default: true
    },
    lastCrashReport: {
        type: OptionType.STRING,
        description: "Stores the latest crash report.",
        default: "",
        hidden: true
    },
    lastCrashAt: {
        type: OptionType.STRING,
        description: "Stores the latest crash time.",
        default: "",
        hidden: true
    },
    crashCount: {
        type: OptionType.STRING,
        description: "Stores the total crash count.",
        default: "0",
        hidden: true
    }
});

let hasPromptedForUpdate = false;
let isRecovering = false;
let crashModalOpen = false;
let latestReport: CrashReport | null = null;
let queuedPopupReport: CrashReport | null = null;
let recentCrashTimes: number[] = [];
let crashLogWriteQueue: Promise<void> = Promise.resolve();

function isDraftTypes(value: unknown): value is DraftTypes {
    if (!value || typeof value !== "object") return false;

    const draftTypes = value as Record<string, unknown>;
    const channelMessage = draftTypes.ChannelMessage;
    const slashCommand = draftTypes.SlashCommand;

    return (
        (typeof channelMessage === "string" || typeof channelMessage === "number") &&
        (typeof slashCommand === "string" || typeof slashCommand === "number")
    );
}

function getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message || error.name;
    if (typeof error === "string") return error;
    if (error == null) return "Unknown crash.";

    return String(error);
}

function getErrorStack(error: unknown) {
    if (!(error instanceof Error)) return undefined;

    return error.stack;
}

function getComponentStack(info: unknown) {
    if (!info || typeof info !== "object" || !("componentStack" in info)) return undefined;

    const { componentStack } = info as { componentStack?: unknown; };
    return typeof componentStack === "string" ? componentStack : undefined;
}

function runRecoveryStep(label: string, step: () => void) {
    try {
        step();
        return true;
    } catch (err) {
        logger.debug(`Failed to ${label}.`, err);
        return false;
    }
}

function getChannelId() {
    try {
        return SelectedChannelStore.getChannelId();
    } catch (err) {
        logger.debug("Failed to read the current channel.", err);
        return undefined;
    }
}

function createReport(errorState: CrashErrorState): CrashReport {
    const now = Date.now();
    recentCrashTimes = recentCrashTimes.filter(time => now - time < 10000);
    recentCrashTimes.push(now);

    const totalCrashes = Number(settings.store.crashCount || "0") + 1;

    return {
        id: `${now}-${totalCrashes}`,
        timestamp: now,
        message: getErrorMessage(errorState.error),
        stack: getErrorStack(errorState.error),
        componentStack: getComponentStack(errorState.info),
        channelId: getChannelId(),
        crashCount: totalCrashes,
        recentCrashCount: recentCrashTimes.length,
        recovered: false,
        suspectedPlugin: NO_PLUGIN_DETECTED,
        suspectedPluginReason: NO_PLUGIN_DETECTION_REASON,
        disabledPlugin: NO_PLUGIN_DISABLED,
        disableReason: NO_PLUGIN_DISABLE_REASON
    };
}

function createPlaceholderReport(): CrashReport {
    return {
        id: "placeholder",
        timestamp: Date.now(),
        message: "No crash report available.",
        crashCount: Number(settings.store.crashCount || "0"),
        recentCrashCount: 0,
        recovered: false,
        suspectedPlugin: NO_PLUGIN_DETECTED,
        suspectedPluginReason: NO_PLUGIN_DETECTION_REASON,
        disabledPlugin: NO_PLUGIN_DISABLED,
        disableReason: NO_PLUGIN_DISABLE_REASON
    };
}

function formatReport(report: CrashReport) {
    const parts = [
        "Illegalcord crash report",
        `Time: ${new Date(report.timestamp).toISOString()}`,
        `Crash count: ${report.crashCount}`,
        `Recent crashes: ${report.recentCrashCount}`,
        `Recovered: ${report.recovered ? "Yes" : "No"}`,
        `Channel: ${report.channelId ?? "Unknown"}`,
        `Error: ${report.message}`,
        `Suspected plugin: ${report.suspectedPlugin}`,
        `Suspected plugin reason: ${report.suspectedPluginReason}`,
        `Disabled plugin: ${report.disabledPlugin}`,
        `Disable reason: ${report.disableReason}`,
        `Log file: ${report.logFilePath ?? "Not written yet"}`,
        `Illegalcord version: ${VERSION}`,
        `User agent: ${navigator.userAgent}`,
    ];

    if (report.stack) parts.push(`Stack:\n${report.stack}`);
    if (report.componentStack) parts.push(`Component stack:\n${report.componentStack}`);

    return parts.join("\n");
}

function saveReport(report: CrashReport) {
    latestReport = report;
    settings.store.crashCount = String(report.crashCount);
    settings.store.lastCrashAt = String(report.timestamp);
    settings.store.lastCrashReport = formatReport(report);
}

function copyLatestReport() {
    const report = settings.store.lastCrashReport;
    if (!report) {
        copyWithToast("No crash report available.", "No crash report available.");
        return;
    }

    copyWithToast(report, "Crash report copied.");
}

function openExternal(url: string) {
    VencordNative.native.openExternal(url);
}

function normalizeSearchText(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getCrashSearchText(errorState: CrashErrorState) {
    return [
        getErrorMessage(errorState.error),
        getErrorStack(errorState.error),
        getComponentStack(errorState.info)
    ].filter(Boolean).join("\n").toLowerCase();
}

function detectSuspectedPlugin(errorState: CrashErrorState): PluginDetection | undefined {
    const searchText = getCrashSearchText(errorState);
    const compactSearchText = normalizeSearchText(searchText);

    for (const [pluginName, plugin] of Object.entries(Plugins)) {
        if (PROTECTED_PLUGIN_NAMES.has(pluginName) || plugin.required || plugin.isDependency) continue;
        if (!Settings.plugins[pluginName]?.enabled) continue;

        const normalizedName = normalizeSearchText(pluginName);
        const lowerName = pluginName.toLowerCase();
        const pathTokens = [
            `plugins/${lowerName}`,
            `plugins\\${lowerName}`,
            `userplugins/${lowerName}`,
            `userplugins\\${lowerName}`,
            `equicordplugins/${lowerName}`,
            `equicordplugins\\${lowerName}`
        ];

        if (pathTokens.some(token => searchText.includes(token))) {
            return {
                name: pluginName,
                reason: "The crash stack references this plugin path."
            };
        }

        if (normalizedName.length >= 6 && compactSearchText.includes(normalizedName)) {
            return {
                name: pluginName,
                reason: "The crash stack references this plugin name."
            };
        }
    }

    return undefined;
}

function maybeDisableSuspectedPlugin(report: CrashReport) {
    if (!settings.store.autoDisableCrashedPlugins || report.suspectedPlugin === NO_PLUGIN_DETECTED) return;

    const plugin = Plugins[report.suspectedPlugin];
    const pluginSettings = Settings.plugins[report.suspectedPlugin];

    if (!plugin || !pluginSettings?.enabled) return;
    if (PROTECTED_PLUGIN_NAMES.has(report.suspectedPlugin)) {
        report.disableReason = "This plugin is protected and cannot be disabled automatically.";
        return;
    }

    if (plugin.required || plugin.isDependency) {
        report.disableReason = "The suspected plugin is required or enabled as a dependency.";
        return;
    }

    pluginSettings.enabled = false;
    const stopped = plugin.started ? stopPlugin(plugin) : true;

    report.disabledPlugin = report.suspectedPlugin;
    report.disableReason = stopped
        ? "The suspected plugin was disabled automatically."
        : "The suspected plugin was disabled for next startup, but stopping it immediately failed.";
}

function buildCrashLogContents(report: CrashReport) {
    return JSON.stringify({
        ...report,
        timestampIso: new Date(report.timestamp).toISOString(),
        reportText: formatReport(report)
    }, null, 2);
}

function writeCrashLog(report: CrashReport) {
    if (!settings.store.logCrashesToDisk || !Native?.writeCrashLog) return;

    crashLogWriteQueue = crashLogWriteQueue
        .catch(err => logger.error("Previous crash log write failed.", err))
        .then(async () => {
            try {
                report.logFilePath = await Native.writeCrashLog(buildCrashLogContents(report), report.id);
                saveReport(report);
            } catch (err) {
                logger.error("Failed to write crash log.", err);
            }
        });
}

function openCrashLogsFolder() {
    if (!Native?.openCrashLogDir) {
        showNotification({
            color: "#f23f43",
            title: "Crash logs are not available.",
            body: "The native helper is not available in this client.",
            noPersist: true
        });
        return;
    }

    void Native.openCrashLogDir()
        .then(error => {
            if (error) logger.error("Failed to open crash logs folder.", error);
        })
        .catch(error => logger.error("Failed to open crash logs folder.", error));
}

function handleCrash(boundary: CrashBoundary, errorState: CrashErrorState) {
    const report = createReport(errorState);
    const suspectedPlugin = detectSuspectedPlugin(errorState);

    if (suspectedPlugin) {
        report.suspectedPlugin = suspectedPlugin.name;
        report.suspectedPluginReason = suspectedPlugin.reason;
        maybeDisableSuspectedPlugin(report);
    }

    saveReport(report);
    writeCrashLog(report);

    if (isRecovering) {
        queuedPopupReport = report;
        return;
    }

    isRecovering = true;

    setTimeout(() => {
        try {
            if (settings.store.promptForUpdates && !hasPromptedForUpdate) {
                hasPromptedForUpdate = true;
                maybePromptToUpdate("Illegalcord just caught a crash. If an update is available, it may fix the problem. Do you want to update now?", true);
            }
        } catch (err) {
            logger.debug("Failed to open the update prompt.", err);
        }

        report.recovered = settings.store.recoverClient ? recoverCrashBoundary(boundary) : false;
        saveReport(report);
        writeCrashLog(report);
        isRecovering = false;
        const popupReport = queuedPopupReport ?? report;
        queuedPopupReport = null;

        if (settings.store.showRecoveryToast) {
            try {
                showNotification({
                    color: report.recovered ? "#43b581" : "#f23f43",
                    title: report.recovered ? "Illegalcord recovered from the crash." : "Illegalcord recorded a crash.",
                    body: "Open the popup to copy the report, reinstall Illegalcord, or check Telegram.",
                    noPersist: true
                });
            } catch (err) {
                logger.debug("Failed to show the crash notification.", err);
            }
        }

        openCrashSupportModal(popupReport);
    }, 50);
}

function triggerTestCrash() {
    handleCrash(
        { setState: () => undefined },
        {
            error: new Error("Manual crash recovery test."),
            info: {
                componentStack: "Manual crash recovery test."
            }
        }
    );
}

function CrashSupportModal({ modalProps, report }: CrashSupportModalProps) {
    const isLooping = report.recentCrashCount >= 3;
    const recoveredText = report.recovered
        ? "Illegalcord recovered the screen, but the crash can happen again if the install or a plugin is broken."
        : "Illegalcord could not confirm a clean recovery. Restart or reinstall the client before continuing.";

    return (
        <Modal
            {...modalProps}
            size="md"
            title={(
                <div className={cl("header")}>
                    <div className={cl("icon-wrap")}>
                        <WarningIcon height={28} width={28} />
                    </div>
                    <BaseText tag="span" size="lg" weight="semibold" className={cl("title")}>
                        Illegalcord caught a crash
                    </BaseText>
                </div>
            )}
            subtitle="Try reinstalling Illegalcord and check the Telegram group if the problem keeps happening."
        >
            <div className={cl("modal")}>
                <div className={cl("content")}>
                    <div className={cl("status", { danger: isLooping, recovered: report.recovered })}>
                        <BaseText size="sm" weight="semibold">
                            {isLooping ? "Repeated crashes detected." : report.recovered ? "Client recovered." : "Crash recorded."}
                        </BaseText>
                        <BaseText tag="p" size="sm" color="text-muted" className={cl("text")}>
                            {recoveredText}
                        </BaseText>
                    </div>

                    <div className={cl("actions")}>
                        <section className={cl("action")}>
                            <div className={cl("action-copy")}>
                                <BaseText size="md" weight="semibold">Reinstall Illegalcord</BaseText>
                                <BaseText tag="p" size="sm" color="text-muted" className={cl("text")}>
                                    A clean reinstall fixes broken builds, missing files, and outdated patches.
                                </BaseText>
                            </div>
                            <Button onClick={() => openExternal(REINSTALL_URL)} className={cl("action-button")}>
                                Open repository
                                <OpenExternalIcon height={16} width={16} />
                            </Button>
                        </section>

                        <section className={cl("action")}>
                            <div className={cl("action-copy")}>
                                <BaseText size="md" weight="semibold">Telegram group</BaseText>
                                <BaseText tag="p" size="sm" color="text-muted" className={cl("text")}>
                                    Check announcements, recent fixes, and support messages from the maintainer.
                                </BaseText>
                            </div>
                            <Button variant="secondary" onClick={() => openExternal(TELEGRAM_URL)} className={cl("action-button")}>
                                Open Telegram
                                <OpenExternalIcon height={16} width={16} />
                            </Button>
                        </section>
                    </div>

                    <div className={cl("report")}>
                        <BaseText size="sm" weight="semibold">Last error</BaseText>
                        <BaseText tag="p" size="sm" color="text-muted" className={cl("error")}>
                            {report.message}
                        </BaseText>
                        <BaseText tag="p" size="sm" color="text-muted" className={cl("error")}>
                            Suspected plugin: {report.suspectedPlugin}
                        </BaseText>
                        <BaseText tag="p" size="sm" color="text-muted" className={cl("error")}>
                            Detection: {report.suspectedPluginReason}
                        </BaseText>
                        <BaseText tag="p" size="sm" color="text-muted" className={cl("error")}>
                            Disabled plugin: {report.disabledPlugin}
                        </BaseText>
                    </div>

                    <Flex justifyContent="space-between" flexWrap="wrap" gap="8px" className={cl("footer")}>
                        <div className={cl("footer-actions")}>
                            <Button variant="secondary" onClick={copyLatestReport} className={cl("footer-button")}>
                                Copy report
                                <CopyIcon height={16} width={16} />
                            </Button>
                            <Button variant="secondary" disabled={!Native?.openCrashLogDir} onClick={openCrashLogsFolder}>
                                Open logs folder
                            </Button>
                        </div>
                        <div className={cl("footer-actions")}>
                            <Button variant="secondary" onClick={relaunch}>
                                Restart client
                            </Button>
                            <Button onClick={modalProps.onClose}>
                                Continue
                            </Button>
                        </div>
                    </Flex>
                </div>
            </div>
        </Modal>
    );
}

const SafeCrashSupportModal = ErrorBoundary.wrap(CrashSupportModal, { noop: true });

function openCrashSupportModal(report: CrashReport, force = false) {
    if ((!force && !settings.store.showSupportPopup) || crashModalOpen) return;

    crashModalOpen = true;
    const modalKey = openModal(modalProps => {
        const onClose = () => {
            crashModalOpen = false;
            modalProps.onClose();
        };

        return (
            <ErrorBoundary noop onError={() => {
                crashModalOpen = false;
                closeModal(modalKey);
            }}>
                <SafeCrashSupportModal modalProps={{ ...modalProps, onClose }} report={report} />
            </ErrorBoundary>
        );
    });
}

function clearDrafts() {
    const draftTypes: unknown = DraftType;
    if (!isDraftTypes(draftTypes)) return false;

    const channelId = SelectedChannelStore.getChannelId();

    DraftManager.clearDraft(channelId, draftTypes.ChannelMessage);
    DraftManager.clearDraft(channelId, draftTypes.SlashCommand);
    return true;
}

function recoverCrashBoundary(boundary: CrashBoundary) {
    DataStore.del("KeepCurrentChannel_previousData");

    const steps = [
        runRecoveryStep("clear message drafts", clearDrafts),
        runRecoveryStep("close the expression picker", () => ExpressionPickerStore.closeExpressionPicker()),
        runRecoveryStep("close context menus", () => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })),
        runRecoveryStep("close stacked modals", () => ModalStack.popAll()),
        runRecoveryStep("close open modals", closeAllModals),
        runRecoveryStep("close user profile overlays", () => FluxDispatcher.dispatch({ type: "USER_PROFILE_MODAL_CLOSE" })),
        runRecoveryStep("close open layers", () => FluxDispatcher.dispatch({ type: "LAYER_POP_ALL" })),
    ];

    if (settings.store.navigateHomeOnCrash) {
        steps.push(runRecoveryStep("return to direct messages", () => NavigationRouter.transitionToGuild("@me")));
    }

    const stateRecovered = runRecoveryStep("reset the crash boundary", () => boundary.setState({ error: null, info: null }));
    return stateRecovered || steps.some(Boolean);
}

function CrashHandlerSettings() {
    const { crashCount, lastCrashAt } = settings.use(SETTINGS_KEYS);
    const hasCrashReport = Boolean(settings.store.lastCrashReport);
    const report = latestReport ?? createPlaceholderReport();
    const lastCrashText = lastCrashAt ? new Date(Number(lastCrashAt)).toLocaleString() : "No crashes recorded.";

    return (
        <div className={cl("settings")}>
            <div className={cl("settings-copy")}>
                <BaseText size="sm" weight="semibold">Recorded crashes: {crashCount || "0"}</BaseText>
                <BaseText tag="p" size="sm" color="text-muted" className={cl("text")}>
                    Last crash: {lastCrashText}
                </BaseText>
            </div>
            <Flex flexWrap="wrap" gap="8px" className={cl("settings-actions")}>
                <Button size="small" variant="secondary" disabled={!hasCrashReport} onClick={copyLatestReport}>
                    Copy report
                </Button>
                <Button size="small" variant="secondary" disabled={!Native?.openCrashLogDir} onClick={openCrashLogsFolder}>
                    Open logs folder
                </Button>
                <Button size="small" variant="secondary" onClick={triggerTestCrash}>
                    Trigger test crash
                </Button>
                <Button size="small" onClick={() => openCrashSupportModal(report, true)}>
                    Open popup
                </Button>
            </Flex>
        </div>
    );
}

const SafeCrashHandlerSettings = ErrorBoundary.wrap(CrashHandlerSettings, { noop: true });

export default definePlugin({
    name: "CrashHandlerEnhanced",
    description: "Adds Illegalcord crash recovery, support guidance, and a copyable crash report.",
    tags: ["Utility", "Developers"],
    authors: [{ name: "irritably", id: 928787166916640838n }],
    required: true,
    enabledByDefault: true,
    settings,
    settingsAboutComponent: SafeCrashHandlerSettings,
    toolboxActions: {
        "Open latest crash popup": () => openCrashSupportModal(latestReport ?? createPlaceholderReport(), true),
        "Copy latest crash report": copyLatestReport,
        "Open crash logs folder": openCrashLogsFolder,
        "Trigger test crash": triggerTestCrash
    },

    patches: [
        {
            find: "#{intl::ERRORS_UNEXPECTED_CRASH}",
            replacement: [
                {
                    match: /this\.setState\((.{0,300}?)\)/,
                    replace: "$self.handleCrash(this,$1);$&",
                    noWarn: true
                },
                {
                    match: /Vencord\.Plugins\.plugins\["CrashHandler"\]\.handleCrash\(this,(.{0,300}?)\);/,
                    replace: "$self.handleCrash(this,$1);$&",
                    noWarn: true
                }
            ]
        }
    ],

    handleCrash
});
