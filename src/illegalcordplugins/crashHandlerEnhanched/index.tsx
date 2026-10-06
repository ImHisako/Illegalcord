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
import { isPluginEnabled, pluginRequiresRestart, plugins as Plugins, startPlugin, stopPlugin } from "@api/PluginManager";
import { definePluginSettings, PlainSettings, Settings, SettingsStore } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { CopyIcon, OpenExternalIcon, WarningIcon } from "@components/Icons";
import { EquicordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { SYM_LAZY_GET } from "@utils/lazy";
import { Logger } from "@utils/Logger";
import { relaunch } from "@utils/native";
import { escapeRegExp } from "@utils/text";
import definePlugin, { OptionType, type Plugin, type PluginNative } from "@utils/types";
import { checkForUpdates, isNewer, maybePromptToUpdate, update as updateIllegalcord } from "@utils/updater";
import type { RenderModalProps } from "@vencord/discord-types";
import { filters, findBulk, proxyLazyWebpack } from "@webpack";
import { Alerts, closeAllModals, closeModal, DraftType, ExpressionPickerStore, FluxDispatcher, Modal, NavigationRouter, openModal, React, SelectedChannelStore } from "@webpack/common";
import { getPatchedModulePlugins } from "@webpack/patcher";
import type { ReactNode } from "react";

import { PluginMeta } from "~plugins";

import type * as NativeModule from "./native";

const PLUGIN_NAME = "CrashHandlerEnhanced";
const TELEGRAM_URL = "https://t.me/Illegalcord";
const REINSTALL_URL = "https://github.com/ImHisako/IllegalcordInstaller";
const cl = classNameFactory("vc-crash-handler-enhanced-");
const logger = new Logger("CrashHandlerEnhanced");
const SETTINGS_KEYS: Array<"lastCrashAt" | "crashCount" | "crashHistory" | "autoDisabledPlugins" | "safeModePlugins" | "diagnosticTest" | "diagnosticEvents"> = ["lastCrashAt", "crashCount", "crashHistory", "autoDisabledPlugins", "safeModePlugins", "diagnosticTest", "diagnosticEvents"];
const DIAGNOSTIC_TEST_KEYS: Array<"diagnosticTest"> = ["diagnosticTest"];
const SCREEN_SETTINGS_KEYS: Array<"lastCrashReport" | "showSupportPopup" | "detectBlankScreen"> = ["lastCrashReport", "showSupportPopup", "detectBlankScreen"];
const PROTECTED_PLUGIN_NAMES = new Set([PLUGIN_NAME, "CrashHandler"]);
const BREADCRUMB_LIMIT = 40;
const BREADCRUMB_MAX_AGE = 15000;
const BREADCRUMB_DETECTION_AGE = 5000;
const NO_PLUGIN_DETECTED = "No plugin detected";
const NO_PLUGIN_DETECTION_REASON = "No recorded plugin callback threw this error, and no enabled plugin matched the stack or met the recent activity threshold.";
const NO_PLUGIN_DISABLED = "None";
const NO_PLUGIN_DISABLE_REASON = "No plugin was disabled.";
const CRASH_HISTORY_LIMIT = 10;
const DIAGNOSTIC_EVENT_LIMIT = 20;
const CRASH_LOOP_WINDOW = 5 * 60_000;
const MESSAGE_SEND_FORBIDDEN_RE = /^POST \/channels\/(?:\d+|xxx)\/messages \[403\]$/;
const GUILD_VANITY_FORBIDDEN_RE = /^GET \/guilds\/(?:\d+|xxx)\/vanity-url \[403\]$/;
const USER_PROFILE_UNAVAILABLE_RE = /^GET \/users\/(?:\d+|xxx)\/profile \[(?:404|409)\]$/;
const SOCKET_ALIVE_TIMEOUT_RE = /^(?:Max tries exceeded, last error: Error: )?socket alive timeout$/;
const Native = VencordNative.pluginHelpers.CrashHandlerEnhanced as PluginNative<typeof NativeModule> | undefined;

type DetectionConfidence = "none" | "low" | "medium" | "high";
type DetectionSource = "none" | "callback-error" | "stack-path" | "stack-name" | "breadcrumb";
type CrashKind = "render" | "blank-screen" | "window-error" | "unhandled-rejection";
const CRASH_KIND_LABELS = {
    render: "Screen rendering crash",
    "blank-screen": "Blank screen",
    "window-error": "Window error",
    "unhandled-rejection": "Unhandled promise rejection"
} satisfies Record<CrashKind, string>;

interface CrashSummary {
    id: string;
    timestamp: number;
    kind: CrashKind;
    message: string;
    suspectedPlugin: string;
    fingerprint?: string;
    channelId?: string;
    recentPluginNames?: string[];
}

interface PossiblePlugin {
    name: string;
    callbacks: number;
    lastActivityMs: number;
    lastSurface: string;
}

interface RecurringPlugin {
    name: string;
    crashes: number;
}

interface PatchedModule {
    sourceId: string;
    plugins: string[];
}

interface DiagnosticEvent {
    timestamp: number;
    kind: "start" | "plugin-change" | "test-start" | "test-result";
    plugin?: string;
    detail?: string;
}

interface DiagnosticTest {
    plugin: string;
    channelId?: string;
    fingerprint: string;
    startedAt: number;
    status: "awaiting-restart" | "active" | "crashed" | "no-crash" | "inconclusive" | "restoring";
    changedPlugins: string[];
    baselineEnabledPlugins?: string[];
}

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
    kind: CrashKind;
    message: string;
    stack?: string;
    componentStack?: string;
    channelId?: string;
    crashCount: number;
    recentCrashCount: number;
    recovered: boolean;
    suspectedPlugin: string;
    suspectedPluginCategory: "Equicord" | "Illegalcord" | "Vencord" | "User plugin" | "Unknown";
    suspectedPluginReason: string;
    suspectedPluginConfidence: DetectionConfidence;
    suspectedPluginSource: DetectionSource;
    possiblePlugins: PossiblePlugin[];
    recentPluginNames: string[];
    fingerprint: string;
    similarCrashes: number;
    recurringPlugins: RecurringPlugin[];
    patchedModules: PatchedModule[];
    diagnosticEvents: DiagnosticEvent[];
    diagnosticTest?: DiagnosticTest;
    disabledPlugin: string;
    disableReason: string;
    breadcrumbs: string[];
    enabledPlugins: string[];
    logFilePath?: string;
}

interface PendingCrash {
    boundary: CrashBoundary;
    report: CrashReport;
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
    confidence: DetectionConfidence;
    source: DetectionSource;
}

interface PluginBreadcrumb {
    timestamp: number;
    pluginName: string;
    surface: string;
    detail?: string;
}

type PluginCallback = (this: unknown, ...args: unknown[]) => unknown;

interface InstrumentedMethod {
    owner: Record<PropertyKey, unknown>;
    key: string;
    original: PluginCallback;
    wrapped: PluginCallback;
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
    detectBlankScreen: {
        type: OptionType.BOOLEAN,
        description: "Show the support popup when Discord renders an empty root for at least 1.5 seconds.",
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
    captureGlobalErrors: {
        type: OptionType.BOOLEAN,
        description: "Capturing window errors and unhandled promise rejections is currently unavailable.",
        default: false,
        disabled: () => true
    },
    showRecoveryToast: {
        type: OptionType.BOOLEAN,
        description: "Show a small recovery notification after the crash is handled.",
        default: true
    },
    notifyOncePerPlugin: {
        type: OptionType.BOOLEAN,
        description: "Only show one crash notification per suspected plugin each session.",
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
    },
    recentCrashTimes: {
        type: OptionType.STRING,
        description: "Stores recent crash times across restarts.",
        default: "[]",
        hidden: true
    },
    crashHistory: {
        type: OptionType.STRING,
        description: "Stores the last ten crashes.",
        default: "[]",
        hidden: true
    },
    diagnosticEvents: {
        type: OptionType.STRING,
        description: "Stores recent plugin changes and client starts.",
        default: "[]",
        hidden: true
    },
    diagnosticTest: {
        type: OptionType.STRING,
        description: "Stores the current plugin diagnostic test.",
        default: "",
        hidden: true
    },
    autoDisabledPlugins: {
        type: OptionType.STRING,
        description: "Stores plugins disabled automatically after a crash.",
        default: "[]",
        hidden: true
    },
    safeModePlugins: {
        type: OptionType.STRING,
        description: "Stores enabled plugins to restore after safe mode.",
        default: "",
        hidden: true
    }
});

let hasPromptedForUpdate = false;
let isRecovering = false;
let crashModalOpen = false;
let latestReport: CrashReport | null = null;
let queuedCrash: PendingCrash | null = null;
let pluginErrorOrigins = new WeakMap<object, PluginDetection>();
let pluginBreadcrumbs: PluginBreadcrumb[] = [];
const notifiedPluginNames = new Set<string>();
let crashLogWriteQueue: Promise<void> = Promise.resolve();
let globalListenersInstalled = false;
let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
let supportScreenMounted = false;
let openSupportViews = 0;
const breadcrumbWrappedFunctions = new WeakSet<object>();
const instrumentedMethods: InstrumentedMethod[] = [];

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

function getErrorText(value: unknown) {
    if (value instanceof Error) return value.message || value.name;
    if (typeof value === "string" && value && value !== "[object Object]") return value;
}

function getObjectErrorMessage(error: unknown) {
    const record = asRecord(error);
    if (!record) return undefined;

    return getErrorText(record.message) ?? getErrorText(record.error) ?? getErrorText(record.reason);
}

function stringifyErrorObject(error: unknown) {
    const seen = new WeakSet<object>();

    try {
        const serialized = JSON.stringify(error, (_key, value: unknown) => {
            if (typeof value === "bigint") return value.toString();
            if (typeof value !== "object" || value === null) return value;
            if (seen.has(value)) return "[Circular]";

            seen.add(value);
            return value;
        });

        if (serialized && serialized !== "{}") return serialized;
    } catch {
        return String(error);
    }
}

function getErrorMessage(error: unknown) {
    const text = getErrorText(error);
    if (text) return text;
    if (error == null) return "Unknown crash.";

    const message = getObjectErrorMessage(error);
    if (message) return message;

    const serialized = stringifyErrorObject(error);
    if (serialized) return serialized;

    return String(error);
}

function getErrorStack(error: unknown) {
    if (error instanceof Error) return error.stack;

    const record = asRecord(error);
    if (typeof record?.stack === "string") return record.stack;

    return undefined;
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

function getEnabledPluginSnapshot() {
    return Object.keys(Plugins)
        .filter(isPluginEnabled)
        .sort((a, b) => a.localeCompare(b));
}

function formatBreadcrumb({ timestamp, pluginName, surface, detail }: PluginBreadcrumb) {
    const time = new Date(timestamp).toISOString();
    return detail
        ? `${time} ${pluginName}.${surface}: ${detail}`
        : `${time} ${pluginName}.${surface}`;
}

function trimBreadcrumbs(now = Date.now()) {
    let removed = Math.max(0, pluginBreadcrumbs.length - BREADCRUMB_LIMIT);
    while (removed < pluginBreadcrumbs.length && now - pluginBreadcrumbs[removed].timestamp > BREADCRUMB_MAX_AGE) removed++;
    if (removed > 0) pluginBreadcrumbs.splice(0, removed);
}

function addPluginBreadcrumb(pluginName: string, surface: string, detail?: string) {
    if (PROTECTED_PLUGIN_NAMES.has(pluginName)) return;

    pluginBreadcrumbs.push({ timestamp: Date.now(), pluginName, surface, detail });
    trimBreadcrumbs();
}

function getRecentBreadcrumbs() {
    trimBreadcrumbs();
    return pluginBreadcrumbs.map(formatBreadcrumb);
}

function getPossiblePlugins(now: number) {
    const candidates = new Map<string, PossiblePlugin>();

    for (const entry of pluginBreadcrumbs) {
        if (now - entry.timestamp > BREADCRUMB_DETECTION_AGE || !isPluginEnabled(entry.pluginName)) continue;

        const candidate = candidates.get(entry.pluginName);
        if (candidate) {
            candidate.callbacks++;
            candidate.lastActivityMs = now - entry.timestamp;
            candidate.lastSurface = entry.surface;
        } else {
            candidates.set(entry.pluginName, {
                name: entry.pluginName,
                callbacks: 1,
                lastActivityMs: now - entry.timestamp,
                lastSurface: entry.surface
            });
        }
    }

    return [...candidates.values()].sort((a, b) => a.lastActivityMs - b.lastActivityMs).slice(0, 5);
}

function getPatchedModules(stack?: string, componentStack?: string): PatchedModule[] {
    const sourceIds = new Set([...`${stack ?? ""}\n${componentStack ?? ""}`.matchAll(/WebpackModule(\d+-Source[0-9a-f]+-Factory\d+)/g)].map(match => match[1]));
    return [...sourceIds].map(sourceId => ({ sourceId, plugins: getPatchedModulePlugins(sourceId) }))
        .filter(({ plugins }) => plugins.length > 0);
}

function getCrashFingerprint(kind: CrashKind, message: string, stack?: string) {
    return `${kind}\n${message}\n${stack?.split("\n").slice(1, 4).join("\n").replace(/(WebpackModule\d+-Source[0-9a-f]+)-Factory\d+/g, "$1") ?? ""}`;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return Boolean(value && typeof value === "object" && "then" in value && typeof value.then === "function");
}

function asRecord(value: unknown) {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return null;
    return value as Record<PropertyKey, unknown>;
}

function readStringList(value: string) {
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
        return [];
    }
}

function readRecentCrashTimes() {
    try {
        const parsed: unknown = JSON.parse(settings.store.recentCrashTimes);
        return Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
    } catch {
        return [];
    }
}

function isCrashKind(value: unknown): value is CrashKind {
    return value === "render" || value === "blank-screen" || value === "window-error" || value === "unhandled-rejection";
}

function readCrashHistory(): CrashSummary[] {
    try {
        const parsed: unknown = JSON.parse(settings.store.crashHistory);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item): item is CrashSummary => {
            const entry = asRecord(item);
            return typeof entry?.id === "string" && typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp) && isCrashKind(entry.kind)
                && typeof entry.message === "string" && typeof entry.suspectedPlugin === "string"
                && (entry.fingerprint == null || typeof entry.fingerprint === "string")
                && (entry.channelId == null || typeof entry.channelId === "string")
                && (entry.recentPluginNames == null || Array.isArray(entry.recentPluginNames) && entry.recentPluginNames.every(name => typeof name === "string"));
        });
    } catch {
        return [];
    }
}

function readDiagnosticEvents(): DiagnosticEvent[] {
    try {
        const parsed: unknown = JSON.parse(settings.store.diagnosticEvents);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item): item is DiagnosticEvent => {
            const entry = asRecord(item);
            return typeof entry?.timestamp === "number" && Number.isFinite(entry.timestamp)
                && (entry.kind === "start" || entry.kind === "plugin-change" || entry.kind === "test-start" || entry.kind === "test-result")
                && (entry.plugin == null || typeof entry.plugin === "string")
                && (entry.detail == null || typeof entry.detail === "string");
        });
    } catch {
        return [];
    }
}

function recordDiagnosticEvent(kind: DiagnosticEvent["kind"], plugin?: string, detail?: string) {
    settings.store.diagnosticEvents = JSON.stringify([...readDiagnosticEvents(), { timestamp: Date.now(), kind, plugin, detail }].slice(-DIAGNOSTIC_EVENT_LIMIT));
}

function readDiagnosticTest(): DiagnosticTest | undefined {
    if (!settings.store.diagnosticTest) return;
    try {
        const entry = asRecord(JSON.parse(settings.store.diagnosticTest));
        if (typeof entry?.plugin !== "string" || typeof entry.fingerprint !== "string" || typeof entry.startedAt !== "number"
            || (entry.channelId != null && typeof entry.channelId !== "string")
            || (entry.changedPlugins != null && (!Array.isArray(entry.changedPlugins) || !entry.changedPlugins.every(name => typeof name === "string")))
            || (entry.baselineEnabledPlugins != null && (!Array.isArray(entry.baselineEnabledPlugins) || !entry.baselineEnabledPlugins.every(name => typeof name === "string")))
            || (entry.status !== "awaiting-restart" && entry.status !== "active" && entry.status !== "crashed" && entry.status !== "no-crash" && entry.status !== "inconclusive" && entry.status !== "restoring")) return;
        return {
            plugin: entry.plugin,
            channelId: typeof entry.channelId === "string" ? entry.channelId : undefined,
            fingerprint: entry.fingerprint,
            startedAt: entry.startedAt,
            status: entry.status,
            changedPlugins: Array.isArray(entry.changedPlugins) ? entry.changedPlugins : [],
            baselineEnabledPlugins: Array.isArray(entry.baselineEnabledPlugins) ? entry.baselineEnabledPlugins : undefined
        };
    } catch {
        return;
    }
}

function onPluginSettingChanged(_value: unknown, path: string) {
    const match = /^plugins\.([^.]+)\.enabled$/.exec(path);
    if (!match) return;
    const plugin = Plugins[match[1]];
    if (!plugin) return;
    const { enabled } = Settings.plugins[plugin.name];
    recordDiagnosticEvent("plugin-change", plugin.name, `${enabled ? "Enabled" : "Disabled"}${pluginRequiresRestart(plugin) ? "; restart required" : ""}.`);
    const test = readDiagnosticTest();
    if (enabled && test?.plugin === plugin.name) {
        settings.store.diagnosticTest = pluginRequiresRestart(plugin) ? JSON.stringify({ ...test, status: "restoring" }) : "";
    } else if (test && plugin.name !== test.plugin && (test.status === "awaiting-restart" || test.status === "active" || test.status === "no-crash" || test.status === "inconclusive")) {
        settings.store.diagnosticTest = JSON.stringify({ ...test, status: "inconclusive", changedPlugins: [...new Set([...test.changedPlugins, plugin.name])] });
        recordDiagnosticEvent("test-result", test.plugin, `Inconclusive because ${plugin.name} was also ${enabled ? "enabled" : "disabled"} during the test.`);
    }
}

function isLazyProxy(value: unknown) {
    const record = asRecord(value);
    return typeof record?.[SYM_LAZY_GET] === "function";
}

function wrapPluginCallback<T extends PluginCallback>(pluginName: string, surface: string, original: T): T {
    const wrapped = function (this: unknown, ...args: unknown[]) {
        addPluginBreadcrumb(pluginName, surface);

        try {
            const result = Reflect.apply(original, this, args) as unknown;

            if (isPromiseLike(result)) {
                return Promise.resolve(result).catch((error: unknown) => {
                    rememberPluginError(pluginName, surface, error);
                    throw error;
                });
            }

            return result;
        } catch (error) {
            rememberPluginError(pluginName, surface, error);
            throw error;
        }
    } as T;

    breadcrumbWrappedFunctions.add(wrapped);
    return wrapped;
}

function rememberPluginError(pluginName: string, surface: string, error: unknown) {
    if (!globalListenersInstalled) return;
    addPluginBreadcrumb(pluginName, `${surface} failed`);
    const record = asRecord(error);
    if (!record || pluginErrorOrigins.has(record)) return;

    pluginErrorOrigins.set(record, {
        name: pluginName,
        confidence: "high",
        source: "callback-error",
        reason: `This exact error escaped the plugin callback: ${surface}.`
    });
}

function wrapObjectMethod(owner: Record<PropertyKey, unknown>, key: string, pluginName: string, surface: string) {
    const original = owner[key];
    if (typeof original !== "function" || breadcrumbWrappedFunctions.has(original) || isLazyProxy(original)) return;

    const callback = original as PluginCallback;
    const wrapped = wrapPluginCallback(pluginName, surface, callback);
    owner[key] = wrapped;
    instrumentedMethods.push({ owner, key, original: callback, wrapped });
}

function instrumentPlugin(plugin: Plugin) {
    if (PROTECTED_PLUGIN_NAMES.has(plugin.name)) return;

    const pluginRecord = asRecord(plugin);
    if (!pluginRecord) return;

    wrapObjectMethod(pluginRecord, "start", plugin.name, "start");
    wrapObjectMethod(pluginRecord, "stop", plugin.name, "stop");
    wrapObjectMethod(pluginRecord, "onBeforeMessageSend", plugin.name, "message send");
    wrapObjectMethod(pluginRecord, "onBeforeMessageEdit", plugin.name, "message edit");
    wrapObjectMethod(pluginRecord, "onMessageClick", plugin.name, "message click");

    const selfReference = `Vencord.Plugins.plugins[${JSON.stringify(plugin.name)}]`;
    for (const patch of plugin.patches ?? []) {
        for (const replacement of [patch.replacement].flat()) {
            if (typeof replacement.replace !== "string") continue;
            for (const match of replacement.replace.replaceAll(selfReference, "$self").matchAll(/\$self\.(\w+)\(/g)) {
                wrapObjectMethod(pluginRecord, match[1], plugin.name, `patch callback ${match[1]}`);
            }
        }
    }

    for (const command of plugin.commands ?? []) {
        const commandRecord = asRecord(command);
        if (commandRecord) wrapObjectMethod(commandRecord, "execute", plugin.name, "command");
    }

    const contextMenuRecord = asRecord(plugin.contextMenus);
    if (contextMenuRecord) {
        for (const menu of Object.keys(contextMenuRecord)) {
            wrapObjectMethod(contextMenuRecord, menu, plugin.name, `context menu ${menu}`);
        }
    }

    if (typeof plugin.toolboxActions === "function") {
        wrapObjectMethod(pluginRecord, "toolboxActions", plugin.name, "toolbox actions");
    } else {
        const toolboxRecord = asRecord(plugin.toolboxActions);
        if (toolboxRecord) {
            for (const label of Object.keys(toolboxRecord)) {
                wrapObjectMethod(toolboxRecord, label, plugin.name, `toolbox ${label}`);
            }
        }
    }
}

function instrumentPlugins() {
    for (const plugin of Object.values(Plugins)) {
        instrumentPlugin(plugin);
    }
}

function restoreInstrumentedMethods() {
    for (let i = instrumentedMethods.length - 1; i >= 0; i--) {
        const { owner, key, original, wrapped } = instrumentedMethods[i];
        if (owner[key] === wrapped) owner[key] = original;
    }

    instrumentedMethods.length = 0;
}

function createReport(errorState: CrashErrorState, kind: CrashKind = "render"): CrashReport {
    const now = Date.now();
    const recentCrashTimes = readRecentCrashTimes().filter(time => time <= now && now - time < CRASH_LOOP_WINDOW).slice(-10);
    if (kind === "render" || kind === "blank-screen") {
        recentCrashTimes.push(now);
        settings.store.recentCrashTimes = JSON.stringify(recentCrashTimes);
    }

    const totalCrashes = Number(settings.store.crashCount || "0") + 1;
    const detection = detectSuspectedPlugin(errorState);
    const folder = detection ? PluginMeta[detection.name].folderName : "";
    const message = getErrorMessage(errorState.error);
    const stack = getErrorStack(errorState.error);
    const componentStack = getComponentStack(errorState.info);
    const channelId = getChannelId();
    const fingerprint = getCrashFingerprint(kind, message, stack);
    const similar = readCrashHistory().filter(entry => entry.fingerprint === fingerprint && entry.channelId === channelId);
    const recentPluginNames = [...new Set(pluginBreadcrumbs.filter(entry => now - entry.timestamp <= BREADCRUMB_DETECTION_AGE && isPluginEnabled(entry.pluginName)).map(entry => entry.pluginName).reverse())];
    const recurringPlugins = recentPluginNames.map(name => ({
        name,
        crashes: 1 + similar.filter(entry => entry.recentPluginNames?.includes(name)).length
    })).filter(({ crashes }) => crashes > 1).sort((a, b) => b.crashes - a.crashes).slice(0, 5);
    const test = readDiagnosticTest();
    if ((test?.status === "active" || test?.status === "no-crash") && test.fingerprint === fingerprint && test.channelId === channelId) {
        settings.store.diagnosticTest = JSON.stringify({ ...test, status: "crashed" });
        recordDiagnosticEvent("test-result", test.plugin, "The same crash happened with this plugin disabled.");
    }

    return {
        id: `${now}-${totalCrashes}`,
        timestamp: now,
        kind,
        message,
        stack,
        componentStack,
        channelId,
        crashCount: totalCrashes,
        recentCrashCount: recentCrashTimes.length,
        recovered: false,
        suspectedPlugin: detection?.name ?? NO_PLUGIN_DETECTED,
        suspectedPluginCategory: folder.startsWith("src/equicordplugins/") ? "Equicord"
            : folder.startsWith("src/illegalcordplugins/") ? "Illegalcord"
                : folder.startsWith("src/plugins/") ? "Vencord"
                    : folder.startsWith("src/userplugins/") ? "User plugin" : "Unknown",
        suspectedPluginReason: detection?.reason ?? NO_PLUGIN_DETECTION_REASON,
        suspectedPluginConfidence: detection?.confidence ?? "none",
        suspectedPluginSource: detection?.source ?? "none",
        possiblePlugins: detection ? [] : getPossiblePlugins(now),
        recentPluginNames,
        fingerprint,
        similarCrashes: similar.length + 1,
        recurringPlugins,
        patchedModules: getPatchedModules(stack, componentStack),
        diagnosticEvents: readDiagnosticEvents().slice(-10),
        diagnosticTest: readDiagnosticTest(),
        disabledPlugin: NO_PLUGIN_DISABLED,
        disableReason: NO_PLUGIN_DISABLE_REASON,
        breadcrumbs: getRecentBreadcrumbs(),
        enabledPlugins: getEnabledPluginSnapshot()
    };
}

function createPlaceholderReport(): CrashReport {
    return {
        id: "placeholder",
        timestamp: Date.now(),
        kind: "render",
        message: "No crash report available.",
        crashCount: Number(settings.store.crashCount || "0"),
        recentCrashCount: 0,
        recovered: false,
        suspectedPlugin: NO_PLUGIN_DETECTED,
        suspectedPluginCategory: "Unknown",
        suspectedPluginReason: NO_PLUGIN_DETECTION_REASON,
        suspectedPluginConfidence: "none",
        suspectedPluginSource: "none",
        possiblePlugins: [],
        recentPluginNames: [],
        fingerprint: "",
        similarCrashes: 0,
        recurringPlugins: [],
        patchedModules: [],
        diagnosticEvents: readDiagnosticEvents().slice(-10),
        diagnosticTest: readDiagnosticTest(),
        disabledPlugin: NO_PLUGIN_DISABLED,
        disableReason: NO_PLUGIN_DISABLE_REASON,
        breadcrumbs: getRecentBreadcrumbs(),
        enabledPlugins: getEnabledPluginSnapshot()
    };
}

function formatReport(report: CrashReport) {
    const parts = [
        "Illegalcord crash report",
        `Time: ${new Date(report.timestamp).toISOString()}`,
        `Error type: ${CRASH_KIND_LABELS[report.kind]}`,
        `Crash count: ${report.crashCount}`,
        `Recent crashes: ${report.recentCrashCount}`,
        `Recovered: ${report.recovered ? "Yes" : "No"}`,
        `Channel: ${report.channelId ?? "Unknown"}`,
        `Error: ${report.message}`,
        `Suspected plugin: ${report.suspectedPlugin}`,
        `Plugin category: ${report.suspectedPluginCategory}`,
        `Detection confidence: ${report.suspectedPluginConfidence}`,
        `Detection source: ${report.suspectedPluginSource}`,
        `Suspected plugin reason: ${report.suspectedPluginReason}`,
        `Similar crashes in this channel: ${report.similarCrashes}`,
        `Disabled plugin: ${report.disabledPlugin}`,
        `Disable reason: ${report.disableReason}`,
        `Log file: ${report.logFilePath ?? "Not written yet"}`,
        `Illegalcord version: ${VERSION}`,
        `User agent: ${navigator.userAgent}`,
        `Enabled plugins: ${report.enabledPlugins.join(", ") || "None"}`,
    ];

    if (report.possiblePlugins.length) parts.push(`Plugins to check (recent activity only, not proof):\n${report.possiblePlugins.map(({ name, callbacks, lastActivityMs, lastSurface }) => `${name}: ${callbacks} callbacks, last ${lastActivityMs} ms before crash (${lastSurface})`).join("\n")}`);
    if (report.recurringPlugins.length) parts.push(`Plugins with callbacks before similar crashes (not proof):\n${report.recurringPlugins.map(({ name, crashes }) => `${name}: ${crashes}/${report.similarCrashes} crashes`).join("\n")}`);
    if (report.patchedModules.length) parts.push(`Patched module sources in the stack (module-level clues, not proof):\n${report.patchedModules.map(({ sourceId, plugins }) => `WebpackModule${sourceId}: ${plugins.join(", ")}`).join("\n")}`);
    if (report.diagnosticEvents.length) parts.push(`Recent plugin changes and client starts:\n${report.diagnosticEvents.map(({ timestamp, kind, plugin, detail }) => `${new Date(timestamp).toISOString()} ${kind}${plugin ? ` ${plugin}` : ""}${detail ? `: ${detail}` : ""}`).join("\n")}`);
    if (report.diagnosticTest) parts.push(`Plugin test: ${report.diagnosticTest.plugin} ${report.diagnosticTest.status}${report.diagnosticTest.changedPlugins.length ? `; other plugins changed: ${report.diagnosticTest.changedPlugins.join(", ")}` : ""}`);
    if (report.breadcrumbs.length) parts.push(`Recent plugin activity:\n${report.breadcrumbs.join("\n")}`);
    if (report.stack) parts.push(`Stack:\n${report.stack}`);
    if (report.componentStack) parts.push(`Component stack:\n${report.componentStack}`);

    return parts.join("\n");
}

function saveReport(report: CrashReport) {
    latestReport = report;
    settings.store.crashCount = String(report.crashCount);
    settings.store.lastCrashAt = String(report.timestamp);
    settings.store.lastCrashReport = formatReport(report);
    const history = readCrashHistory().filter(entry => entry.id !== report.id);
    history.unshift({
        id: report.id,
        timestamp: report.timestamp,
        kind: report.kind,
        message: report.message,
        suspectedPlugin: report.suspectedPlugin,
        fingerprint: report.fingerprint,
        channelId: report.channelId,
        recentPluginNames: report.recentPluginNames
    });
    settings.store.crashHistory = JSON.stringify(history.slice(0, CRASH_HISTORY_LIMIT));
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

async function clearClientCache() {
    const clearCache = Native?.clearClientCache;
    if (!clearCache) return "Cache cleanup is unavailable.";

    try {
        const result = await clearCache();
        if (!result.success) return result.error;
        if (result.failed.length) return `Could not clear ${result.failed.join(", ")}. Quit Discord completely, including the system tray, then reopen it and try again.`;
        return `${result.client} cache cleared. Restart the client to finish.`;
    } catch (err) {
        logger.error("Failed to clear the Discord cache.", err);
        return "Could not clear Discord cache.";
    }
}

function disableOptionalPlugins(closeCrashModal: () => void, report: CrashReport) {
    const candidates = Object.values(Plugins).filter(plugin =>
        !plugin.required && !plugin.enabledByDefault && !plugin.isDependency && Settings.plugins[plugin.name]?.enabled
    );

    if (!candidates.length) {
        showNotification({ title: "No optional plugins are enabled.", body: "There is nothing to disable.", noPersist: true });
        return;
    }

    closeCrashModal();
    setTimeout(() => Alerts.show({
        title: "Disable optional plugins?",
        body: `This will disable ${candidates.length} enabled plugins. Plugins enabled by default, required plugins, and their dependencies will stay on.`,
        confirmText: "Disable plugins",
        cancelText: "Cancel",
        onCancel: () => openCrashSupportModal(report),
        onConfirm: () => {
            let restartNeeded = false;
            const failed: string[] = [];

            for (const plugin of candidates) {
                if (pluginRequiresRestart(plugin)) {
                    Settings.plugins[plugin.name].enabled = false;
                    restartNeeded = true;
                } else if (!plugin.started || stopPlugin(plugin)) {
                    Settings.plugins[plugin.name].enabled = false;
                } else {
                    failed.push(plugin.name);
                }
            }

            if (failed.length) logger.error(`Failed to stop plugins: ${failed.join(", ")}`);

            if (restartNeeded) {
                Alerts.show({
                    title: "Restart required.",
                    body: failed.length
                        ? `Some plugins need a restart to turn off. These plugins could not be stopped: ${failed.join(", ")}.`
                        : "Some plugins need a restart to turn off completely.",
                    confirmText: "Restart now",
                    cancelText: "Later",
                    onConfirm: relaunch
                });
            } else {
                showNotification({
                    title: failed.length ? "Some plugins could not be disabled." : "Optional plugins disabled.",
                    body: failed.length ? `Could not stop ${failed.join(", ")}.` : `${candidates.length} plugins were disabled.`,
                    noPersist: true
                });
            }
        }
    }), 0);
}

function beginPluginTest(name: string, crash: { fingerprint: string; channelId?: string; }, closeCrashModal?: () => void, reopenReport?: CrashReport) {
    const plugin = Plugins[name];
    if (!plugin || plugin.required || plugin.isDependency || PROTECTED_PLUGIN_NAMES.has(name) || !Settings.plugins[name]?.enabled || readDiagnosticTest()
        || Object.values(Plugins).some(other => isPluginEnabled(other.name) && other.dependencies?.includes(name))) return;

    closeCrashModal?.();
    setTimeout(() => Alerts.show({
        title: `Test without ${name}?`,
        body: `This will disable ${name}. Open the same channel and repeat the action that caused the crash. The result will appear in CrashHandlerEnhanced settings.`,
        confirmText: "Start test",
        cancelText: "Cancel",
        onCancel: reopenReport ? () => openCrashSupportModal(reopenReport) : undefined,
        onConfirm: () => {
            const restartNeeded = pluginRequiresRestart(plugin);
            if (!restartNeeded && plugin.started && !stopPlugin(plugin)) {
                showNotification({ title: `${name} could not be stopped.`, body: "Try again after restarting the client.", noPersist: true });
                return;
            }

            Settings.plugins[name].enabled = false;
            settings.store.diagnosticTest = JSON.stringify({
                plugin: name,
                channelId: crash.channelId,
                fingerprint: crash.fingerprint,
                startedAt: Date.now(),
                status: restartNeeded ? "awaiting-restart" : "active",
                changedPlugins: [],
                baselineEnabledPlugins: getEnabledPluginSnapshot()
            } satisfies DiagnosticTest);
            recordDiagnosticEvent("test-start", name, restartNeeded ? "Disabled; waiting for a restart." : "Disabled; test started.");

            if (restartNeeded) {
                Alerts.show({
                    title: "Restart required.",
                    body: `Restart to test the client without ${name}.`,
                    confirmText: "Restart now",
                    cancelText: "Later",
                    onConfirm: relaunch
                });
            } else {
                showNotification({ title: `Testing without ${name}.`, body: "Repeat the action that caused the crash, then record the result in CrashHandlerEnhanced settings.", noPersist: true });
            }
        }
    }), 0);
}

function markPluginTestWithoutCrash() {
    const test = readDiagnosticTest();
    if (test?.status !== "active") return;
    settings.store.diagnosticTest = JSON.stringify({ ...test, status: "no-crash" });
    recordDiagnosticEvent("test-result", test.plugin, "User reported that the same crash did not occur.");
}

function restoreTestedPlugin() {
    const test = readDiagnosticTest();
    if (!test) return;
    if (test.status === "restoring") {
        relaunch();
        return;
    }
    const plugin = Plugins[test.plugin];
    if (!plugin) {
        settings.store.diagnosticTest = "";
        return;
    }

    const restartNeeded = pluginRequiresRestart(plugin);
    if (!restartNeeded && !startPlugin(plugin)) {
        showNotification({ title: `${plugin.name} could not be started.`, body: "Restart the client and try again.", noPersist: true });
        return;
    }
    Settings.plugins[plugin.name].enabled = true;

    if (restartNeeded) Alerts.show({
        title: "Restart required.",
        body: `Restart to restore ${plugin.name}.`,
        confirmText: "Restart now",
        cancelText: "Later",
        onConfirm: relaunch
    });
}

function restoreAutoDisabledPlugin(name: string, closeCrashModal?: () => void) {
    const disabled = readStringList(settings.store.autoDisabledPlugins);
    if (!Plugins[name] || !disabled.includes(name)) return;

    Settings.plugins[name].enabled = true;
    settings.store.autoDisabledPlugins = JSON.stringify(disabled.filter(plugin => plugin !== name));
    closeCrashModal?.();
    setTimeout(() => Alerts.show({
        title: `${name} restored.`,
        body: "Restart the client to load the plugin again.",
        confirmText: "Restart now",
        cancelText: "Later",
        onConfirm: relaunch
    }), 0);
}

function requestSafeMode(closeCrashModal?: () => void, report?: CrashReport) {
    if (settings.store.safeModePlugins) return;

    closeCrashModal?.();
    setTimeout(() => Alerts.show({
        title: "Restart in safe mode?",
        body: "Only required plugins will remain enabled. Your current plugin selection will be saved so you can restore it later.",
        confirmText: "Restart in safe mode",
        cancelText: "Cancel",
        onCancel: report ? () => openCrashSupportModal(report) : undefined,
        onConfirm: async () => {
            const enabled = Object.values(Plugins)
                .filter(plugin => !plugin.required && Settings.plugins[plugin.name]?.enabled)
                .map(plugin => plugin.name);
            settings.store.safeModePlugins = JSON.stringify(enabled);
            for (const plugin of Object.values(Plugins)) {
                if (!plugin.required) Settings.plugins[plugin.name].enabled = false;
            }
            try {
                await VencordNative.settings.set(PlainSettings);
                relaunch();
            } catch (error) {
                const previouslyEnabled = new Set(enabled);
                for (const plugin of Object.values(Plugins)) {
                    if (!plugin.required) Settings.plugins[plugin.name].enabled = previouslyEnabled.has(plugin.name);
                }
                settings.store.safeModePlugins = "";
                logger.error("Failed to save safe mode settings.", error);
                showNotification({ title: "Safe mode was not saved.", body: "Try again before restarting the client.", noPersist: true });
            }
        }
    }), 0);
}

async function restoreSafeMode() {
    const savedPlugins = settings.store.safeModePlugins;
    if (!savedPlugins) return;

    const previouslyEnabled = new Set(readStringList(savedPlugins));
    const currentlyEnabled = new Set(Object.values(Plugins)
        .filter(plugin => !plugin.required && Settings.plugins[plugin.name]?.enabled)
        .map(plugin => plugin.name));
    for (const plugin of Object.values(Plugins)) {
        if (!plugin.required) Settings.plugins[plugin.name].enabled = previouslyEnabled.has(plugin.name);
    }
    settings.store.safeModePlugins = "";
    try {
        await VencordNative.settings.set(PlainSettings);
        relaunch();
    } catch (error) {
        for (const plugin of Object.values(Plugins)) {
            if (!plugin.required) Settings.plugins[plugin.name].enabled = currentlyEnabled.has(plugin.name);
        }
        settings.store.safeModePlugins = savedPlugins;
        logger.error("Failed to restore safe mode settings.", error);
        showNotification({ title: "Previous plugins were not saved.", body: "Try restoring them again before restarting the client.", noPersist: true });
    }
}

async function checkAndUpdateIllegalcord() {
    if (IS_WEB || IS_UPDATER_DISABLED) {
        showNotification({
            color: "#f23f43",
            title: "Illegalcord updater is not available.",
            body: "Use the installer or repository to update this build.",
            noPersist: true
        });
        return;
    }

    try {
        const outdated = await checkForUpdates();

        if (!outdated) {
            showNotification({
                title: "Illegalcord is already up to date.",
                body: "No updates were found.",
                noPersist: true
            });
            return;
        }

        if (isNewer) {
            showNotification({
                color: "#f23f43",
                title: "Illegalcord cannot update automatically.",
                body: "Your local copy has newer commits than the remote.",
                noPersist: true
            });
            return;
        }

        if (!await updateIllegalcord()) return;

        Alerts.show({
            title: "Illegalcord updated.",
            body: "Restart the client to apply the update.",
            confirmText: "Restart now",
            cancelText: "Later",
            onConfirm: relaunch
        });
    } catch (err) {
        logger.error("Failed to update Illegalcord from the crash popup.", err);
        showNotification({
            color: "#f23f43",
            title: "Illegalcord update failed.",
            body: "Try the Updater settings tab or reinstall from the repository.",
            noPersist: true
        });
    }
}

function detectSuspectedPlugin(errorState: CrashErrorState): PluginDetection | undefined {
    const errors: unknown[] = [];
    let { error } = errorState;
    while (error != null && errors.length < 8 && !errors.includes(error)) {
        errors.push(error);
        error = asRecord(error)?.cause;
    }
    errors.reverse();

    for (const error of errors) {
        const record = asRecord(error);
        const origin = record && pluginErrorOrigins.get(record);
        if (origin) return origin;
    }

    const frames = [...errors.map(getErrorStack), getComponentStack(errorState.info)]
        .flatMap(stack => stack?.split("\n") ?? [])
        .filter(line => /^\s*at\s|^[^\s@]+@/.test(line))
        .map(line => line.replaceAll("\\", "/").toLowerCase());
    const enabledPlugins = Object.keys(Plugins)
        .filter(name => !PROTECTED_PLUGIN_NAMES.has(name) && isPluginEnabled(name));

    for (const frame of frames) {
        for (const name of enabledPlugins) {
            const folder = PluginMeta[name].folderName.replace(/^src\//, "").toLowerCase();
            const path = new RegExp(`(?:^|/)${escapeRegExp(folder)}/`);
            const encodedPath = new RegExp(`(?:^|/)${escapeRegExp(encodeURI(folder).toLowerCase())}/`);
            if (!path.test(frame) && !encodedPath.test(frame)) continue;

            return {
                name,
                confidence: "high",
                source: "stack-path",
                reason: "The nearest plugin frame in the error stack matches this plugin's source folder."
            };
        }
    }

    for (const frame of frames) {
        const functionName = frame.split(/\(|@/)[0];
        const matches = enabledPlugins.filter(name => new RegExp(`(?:^|[^\\w$])${escapeRegExp(name)}(?=[.\\s]|$)`, "i").test(functionName));
        if (matches.length !== 1) continue;
        return {
            name: matches[0],
            confidence: "medium",
            source: "stack-name",
            reason: "A stack frame names this plugin, but its source folder could not be verified."
        };
    }

    const now = Date.now();
    const recent = pluginBreadcrumbs.filter(entry => now - entry.timestamp <= BREADCRUMB_DETECTION_AGE && isPluginEnabled(entry.pluginName));
    const names = new Set(recent.map(entry => entry.pluginName));
    if (names.size > 1) {
        const counts = [...names].map(name => ({ name, count: recent.filter(entry => entry.pluginName === name).length }))
            .sort((a, b) => b.count - a.count);
        if (counts[0].count < 5 || counts[0].count < counts[1].count * 4 || counts[0].count < recent.length * 0.75) return undefined;
        return {
            name: counts[0].name,
            confidence: "low",
            source: "breadcrumb",
            reason: `This plugin ran ${counts[0].count} of the last ${recent.length} recorded callbacks. Repeated activity suggests involvement but does not prove the cause.`
        };
    }
    if (names.size !== 1) return undefined;
    const breadcrumb = recent[recent.length - 1];
    return {
        name: breadcrumb.pluginName,
        confidence: "low",
        source: "breadcrumb",
        reason: `Only this plugin was observed recently: ${breadcrumb.surface}. Recent activity alone does not establish the cause.`
    };
}

function maybeDisableSuspectedPlugin(report: CrashReport) {
    if (!settings.store.autoDisableCrashedPlugins || report.suspectedPlugin === NO_PLUGIN_DETECTED) return;
    if (report.suspectedPluginConfidence !== "high") {
        report.disableReason = "The detection confidence was not high enough to disable a plugin automatically.";
        return;
    }

    const plugin = Plugins[report.suspectedPlugin];
    const pluginSettings = Settings.plugins[report.suspectedPlugin];

    if (!plugin || !pluginSettings?.enabled) return;
    if (PROTECTED_PLUGIN_NAMES.has(report.suspectedPlugin)) {
        report.disableReason = "This plugin is protected and cannot be disabled automatically.";
        return;
    }

    if (plugin.required || plugin.enabledByDefault || plugin.isDependency) {
        report.disableReason = "The suspected plugin is required, enabled by default, or needed as a dependency.";
        return;
    }

    pluginSettings.enabled = false;
    const stopped = plugin.started ? stopPlugin(plugin) : true;

    report.disabledPlugin = report.suspectedPlugin;
    const autoDisabledPlugins = readStringList(settings.store.autoDisabledPlugins);
    if (!autoDisabledPlugins.includes(plugin.name)) {
        settings.store.autoDisabledPlugins = JSON.stringify([...autoDisabledPlugins, plugin.name]);
    }
    report.disableReason = !stopped
        ? "The suspected plugin was disabled for next startup, but stopping it immediately failed."
        : pluginRequiresRestart(plugin)
            ? "The suspected plugin was disabled. Restart the client to remove its patches."
            : "The suspected plugin was disabled automatically.";
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
                const result = await Native.writeCrashLog(buildCrashLogContents(report), report.id);
                if (!result.success) {
                    logger.error(result.error);
                    return;
                }

                report.logFilePath = result.filePath;
                if (latestReport?.id === report.id) saveReport(report);
            } catch (err) {
                logger.error("Failed to write crash log.", err);
            }
        });
}

function shouldNotifyCrash(report: CrashReport) {
    if (!settings.store.notifyOncePerPlugin || report.suspectedPlugin === NO_PLUGIN_DETECTED) return true;

    return !notifiedPluginNames.has(report.suspectedPlugin);
}

function rememberCrashNotification(report: CrashReport) {
    if (!settings.store.notifyOncePerPlugin || report.suspectedPlugin === NO_PLUGIN_DETECTED) return;

    notifiedPluginNames.add(report.suspectedPlugin);
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

function openProcessCrashFolder() {
    if (!Native?.openProcessCrashDir) return;
    void Native.openProcessCrashDir()
        .then(error => {
            if (error) logger.error("Failed to open process crash dumps folder.", error);
        })
        .catch(error => logger.error("Failed to open process crash dumps folder.", error));
}

function handleCrash(boundary: CrashBoundary, errorState: CrashErrorState) {
    const report = createReport(errorState);
    maybeDisableSuspectedPlugin(report);

    saveReport(report);
    writeCrashLog(report);
    boundary.setState(errorState);

    if (isRecovering) {
        queuedCrash = { boundary, report };
        return;
    }

    isRecovering = true;

    recoveryTimer = setTimeout(() => {
        recoveryTimer = undefined;
        try {
            if (settings.store.promptForUpdates && !hasPromptedForUpdate) {
                hasPromptedForUpdate = true;
                maybePromptToUpdate("Illegalcord just caught a crash. If an update is available, it may fix the problem. Do you want to update now?", true);
            }
        } catch (err) {
            logger.debug("Failed to open the update prompt.", err);
        }

        const latestCrash = queuedCrash ?? { boundary, report };
        queuedCrash = null;
        latestCrash.report.recovered = settings.store.recoverClient && latestCrash.report.recentCrashCount < 3
            ? recoverCrashBoundary(latestCrash.boundary) : false;
        saveReport(latestCrash.report);
        writeCrashLog(latestCrash.report);
        isRecovering = false;
        const shouldNotify = shouldNotifyCrash(latestCrash.report);

        if (shouldNotify && settings.store.showRecoveryToast && !settings.store.showSupportPopup) {
            try {
                showNotification({
                    color: latestCrash.report.recovered ? "#43b581" : "#f23f43",
                    title: latestCrash.report.recovered ? "Illegalcord recovered from the crash." : "Illegalcord recorded a crash.",
                    body: "Use the crash popup to inspect or copy the report.",
                    noPersist: true
                });
            } catch (err) {
                logger.debug("Failed to show the crash notification.", err);
            }
        }

        if (shouldNotify && settings.store.showRecoveryToast && !settings.store.showSupportPopup) {
            rememberCrashNotification(latestCrash.report);
        }

        if (settings.store.showSupportPopup && !supportScreenMounted) {
            openCrashSupportModal(latestCrash.report);
        }
    }, 50);
}

function normalizeGlobalError(error: unknown, fallback: string) {
    if (error instanceof Error) return error;
    if (typeof error === "string") return new Error(error);
    if (error == null) return new Error(fallback);

    return error;
}

function isIgnorableGlobalError(error: unknown) {
    const message = getErrorMessage(error);

    return message.startsWith("The play() request was interrupted ") ||
        message.startsWith("ResizeObserver loop ");
}

function isIgnorableDiscordRejection(error: unknown) {
    const message = getErrorMessage(error);

    if (message === "Aborted") return true;
    if (message.startsWith("Request has been terminated\n")) return true;
    if (message === "This gift has been redeemed already.") return true;

    return MESSAGE_SEND_FORBIDDEN_RE.test(message) ||
        GUILD_VANITY_FORBIDDEN_RE.test(message) ||
        USER_PROFILE_UNAVAILABLE_RE.test(message) ||
        SOCKET_ALIVE_TIMEOUT_RE.test(message);
}

function isIgnorableUnhandledRejection(error: unknown) {
    if (isIgnorableGlobalError(error)) return true;
    if (error == null) return true;
    if (isIgnorableDiscordRejection(error)) return true;
    if (error instanceof Error || typeof error === "string") return false;

    const record = asRecord(error);
    if (typeof record?.stack === "string") return false;

    return !getObjectErrorMessage(error);
}

function handleGlobalError(event: ErrorEvent) {
    const error = normalizeGlobalError(event.error, event.message || "Window error.");
    if (isIgnorableGlobalError(error)) return;

    if (!settings.store.captureGlobalErrors) return;
    if (latestReport && Date.now() - latestReport.timestamp < 1000 && latestReport.message === getErrorMessage(error)) return;
    const report = createReport({ error }, "window-error");
    saveReport(report);
    writeCrashLog(report);
}

function reportScreenFailure(error: unknown) {
    if (isRecovering || (latestReport && Date.now() - latestReport.timestamp < 5000)) return;

    const report = createReport({ error }, "blank-screen");
    maybeDisableSuspectedPlugin(report);
    saveReport(report);
    writeCrashLog(report);
    if (settings.store.showSupportPopup && !supportScreenMounted) openCrashSupportModal(report);
}

function handleUnhandledRejection(event: PromiseRejectionEvent) {
    if (isIgnorableUnhandledRejection(event.reason)) return;

    const error = normalizeGlobalError(event.reason, "Unhandled promise rejection.");

    if (!settings.store.captureGlobalErrors) return;
    if (latestReport && Date.now() - latestReport.timestamp < 1000 && latestReport.message === getErrorMessage(error)) return;
    const report = createReport({ error }, "unhandled-rejection");
    saveReport(report);
    writeCrashLog(report);
}

function installGlobalListeners() {
    if (globalListenersInstalled) return;

    window.addEventListener("error", handleGlobalError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    globalListenersInstalled = true;
}

function removeGlobalListeners() {
    if (!globalListenersInstalled) return;

    window.removeEventListener("error", handleGlobalError);
    window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    globalListenersInstalled = false;
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
    settings.use(DIAGNOSTIC_TEST_KEYS);
    const isLooping = report.recentCrashCount >= 3;
    const [isCheckingUpdate, setIsCheckingUpdate] = React.useState(false);
    const [isClearingCache, setIsClearingCache] = React.useState(false);
    const [cacheStatus, setCacheStatus] = React.useState("");
    const safeModeActive = Boolean(settings.store.safeModePlugins);
    const canRestorePlugin = readStringList(settings.store.autoDisabledPlugins).includes(report.disabledPlugin);
    const diagnosticTest = readDiagnosticTest();
    React.useEffect(() => {
        openSupportViews++;
        document.documentElement.classList.add(cl("scroll-locked"));
        document.body.classList.add(cl("scroll-locked"));
        return () => {
            if (--openSupportViews === 0) {
                document.documentElement.classList.remove(cl("scroll-locked"));
                document.body.classList.remove(cl("scroll-locked"));
            }
        };
    }, []);
    const recoveredText = report.recovered
        ? "Illegalcord recovered the screen, but the crash can happen again if the install or a plugin is broken."
        : "Illegalcord could not confirm a clean recovery. Restart or reinstall the client before continuing.";
    const runUpdate = async () => {
        setIsCheckingUpdate(true);
        await checkAndUpdateIllegalcord();
        setIsCheckingUpdate(false);
    };
    const runCacheCleanup = async () => {
        setIsClearingCache(true);
        setCacheStatus(await clearClientCache());
        setIsClearingCache(false);
    };

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
                                <BaseText size="md" weight="semibold">Update Illegalcord</BaseText>
                                <BaseText tag="p" size="sm" color="text-muted" className={cl("text")}>
                                    Check for updates and install them without opening the settings updater.
                                </BaseText>
                            </div>
                            <Button variant="secondary" disabled={isCheckingUpdate} onClick={() => void runUpdate()} className={cl("action-button")}>
                                {isCheckingUpdate ? "Checking..." : "Check updates"}
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

                        <section className={cl("action")}>
                            <div className={cl("action-copy")}>
                                <BaseText size="md" weight="semibold">Clear Discord cache</BaseText>
                                <BaseText tag="p" size="sm" color="text-muted" className={cl("text")}>
                                    {cacheStatus || "Clear Discord's browser, code and stored caches, then restart it."}
                                </BaseText>
                            </div>
                            <Button variant="secondary" disabled={!Native?.clearClientCache || isClearingCache} onClick={() => void runCacheCleanup()} className={cl("action-button")}>
                                {isClearingCache ? "Clearing..." : "Clear cache"}
                            </Button>
                        </section>

                        <section className={cl("action")}>
                            <div className={cl("action-copy")}>
                                <BaseText size="md" weight="semibold">Disable optional plugins</BaseText>
                                <BaseText tag="p" size="sm" color="text-muted" className={cl("text")}>
                                    Turn off enabled plugins while keeping the plugins active by default.
                                </BaseText>
                            </div>
                            <Button variant="dangerSecondary" onClick={() => disableOptionalPlugins(modalProps.onClose, report)} className={cl("action-button")}>
                                Disable plugins
                            </Button>
                        </section>

                        {!diagnosticTest && report.possiblePlugins.length > 0 && (
                            <section className={cl("action")}>
                                <div className={cl("action-copy")}>
                                    <BaseText size="md" weight="semibold">Test a possible plugin</BaseText>
                                    <BaseText tag="p" size="sm" color="text-muted" className={cl("text")}>
                                        Disable one plugin, then repeat the action that caused the crash in the same channel. Recent activity does not prove that a plugin caused it.
                                    </BaseText>
                                    <Flex flexWrap="wrap" gap="8px">
                                        {report.possiblePlugins.filter(({ name }) => Plugins[name] && !Plugins[name].required && !Plugins[name].isDependency && Settings.plugins[name]?.enabled
                                            && !Object.values(Plugins).some(other => isPluginEnabled(other.name) && other.dependencies?.includes(name))).map(({ name }) => (
                                            <Button key={name} size="small" variant="secondary" onClick={() => beginPluginTest(name, report, modalProps.onClose, report)}>
                                                Test {name}
                                            </Button>
                                        ))}
                                    </Flex>
                                </div>
                            </section>
                        )}

                        {diagnosticTest && (
                            <section className={cl("action")}>
                                <div className={cl("action-copy")}>
                                    <BaseText size="md" weight="semibold">Test without {diagnosticTest.plugin}</BaseText>
                                    <BaseText tag="p" size="sm" color="text-muted" className={cl("text")}>
                                        {diagnosticTest.status === "awaiting-restart" ? "Restart the client before testing."
                                            : diagnosticTest.status === "restoring" ? "Restart to finish restoring this plugin."
                                                : diagnosticTest.status === "inconclusive" ? `The test is inconclusive because these plugins also changed: ${diagnosticTest.changedPlugins.join(", ")}.`
                                                : diagnosticTest.status === "crashed" ? "The same crash happened with this plugin disabled."
                                                : diagnosticTest.status === "no-crash" ? "You recorded that the same crash did not occur."
                                                    : `Repeat the action in channel ${diagnosticTest.channelId ?? "the same channel"}, then record the result.`}
                                    </BaseText>
                                    <Flex flexWrap="wrap" gap="8px">
                                        {diagnosticTest.status === "active" && <Button size="small" variant="secondary" onClick={markPluginTestWithoutCrash}>No matching crash</Button>}
                                        <Button size="small" variant="secondary" onClick={restoreTestedPlugin}>{diagnosticTest.status === "restoring" ? "Restart now" : "Restore plugin"}</Button>
                                    </Flex>
                                </div>
                            </section>
                        )}

                        <section className={cl("action")}>
                            <div className={cl("action-copy")}>
                                <BaseText size="md" weight="semibold">{safeModeActive ? "Safe mode is active" : "Start safe mode"}</BaseText>
                                <BaseText tag="p" size="sm" color="text-muted" className={cl("text")}>
                                    {safeModeActive ? "Restore the plugins that were enabled before safe mode." : "Restart with only required plugins. Your current selection will be saved."}
                                </BaseText>
                            </div>
                            <Button variant="secondary" onClick={safeModeActive ? restoreSafeMode : () => requestSafeMode(modalProps.onClose, report)} className={cl("action-button")}>
                                {safeModeActive ? "Restore plugins" : "Start safe mode"}
                            </Button>
                        </section>

                        {canRestorePlugin && (
                            <section className={cl("action")}>
                                <div className={cl("action-copy")}>
                                    <BaseText size="md" weight="semibold">{report.disabledPlugin} was disabled</BaseText>
                                    <BaseText tag="p" size="sm" color="text-muted" className={cl("text")}>
                                        Restore this plugin if it was not the cause of the crash.
                                    </BaseText>
                                </div>
                                <Button variant="secondary" disabled={safeModeActive} onClick={() => restoreAutoDisabledPlugin(report.disabledPlugin, modalProps.onClose)} className={cl("action-button")}>
                                    Restore plugin
                                </Button>
                            </section>
                        )}
                    </div>

                    <div className={cl("report")}>
                        <BaseText size="sm" weight="semibold">Last error</BaseText>
                        <BaseText tag="p" size="sm" color="text-muted" className={cl("error")}>
                            Error type: {CRASH_KIND_LABELS[report.kind]}
                        </BaseText>
                        <BaseText tag="p" size="sm" color="text-muted" className={cl("error")}>
                            {report.message}
                        </BaseText>
                        <BaseText tag="p" size="sm" color="text-muted" className={cl("error")}>
                            Suspected plugin: {report.suspectedPlugin}
                        </BaseText>
                        <BaseText tag="p" size="sm" color="text-muted" className={cl("error")}>
                            Plugin category: {report.suspectedPluginCategory}
                        </BaseText>
                        <BaseText tag="p" size="sm" color="text-muted" className={cl("error")}>
                            Confidence: {report.suspectedPluginConfidence} via {report.suspectedPluginSource}
                        </BaseText>
                        <BaseText tag="p" size="sm" color="text-muted" className={cl("error")}>
                            Detection: {report.suspectedPluginReason}
                        </BaseText>
                        <BaseText tag="p" size="sm" color="text-muted" className={cl("error")}>
                            Similar crashes in this channel: {report.similarCrashes}
                        </BaseText>
                        {report.recurringPlugins.length > 0 && (
                            <BaseText tag="p" size="sm" color="text-muted" className={cl("error")}>
                                Callbacks before similar crashes (not proof): {report.recurringPlugins.map(({ name, crashes }) => `${name} (${crashes}/${report.similarCrashes})`).join(", ")}
                            </BaseText>
                        )}
                        {report.patchedModules.length > 0 && (
                            <BaseText tag="p" size="sm" color="text-muted" className={cl("error")}>
                                Plugins that patched module sources in the stack (not proof): {report.patchedModules.map(({ sourceId, plugins }) => `WebpackModule${sourceId}: ${plugins.join(", ")}`).join("; ")}
                            </BaseText>
                        )}
                        {report.diagnosticTest && (
                            <BaseText tag="p" size="sm" color="text-muted" className={cl("error")}>
                                Plugin test at crash: {report.diagnosticTest.plugin} ({report.diagnosticTest.status}){report.diagnosticTest.changedPlugins.length > 0 ? `; other plugins changed: ${report.diagnosticTest.changedPlugins.join(", ")}` : ""}
                            </BaseText>
                        )}
                        {report.possiblePlugins.length > 0 && (
                            <BaseText tag="p" size="sm" color="text-muted" className={cl("error")}>
                                Plugins to check from recent activity (not proof): {report.possiblePlugins.map(({ name, callbacks, lastActivityMs }) => `${name} (${callbacks} callbacks, ${lastActivityMs} ms before crash)`).join(", ")}
                            </BaseText>
                        )}
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
                            <Button variant="secondary" disabled={!Native?.openProcessCrashDir} onClick={openProcessCrashFolder}>
                                Open process dumps
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

function CrashSupportFallback() {
    return (
        <div className={cl("fallback")} role="alertdialog" aria-modal="true" aria-label="Illegalcord crash recovery">
            <BaseText size="lg" weight="semibold">Illegalcord caught a crash</BaseText>
            <BaseText tag="p">Discord could not display the support popup. Copy the report or restart the client.</BaseText>
            <Flex gap="8px">
                <Button onClick={copyLatestReport}>Copy report</Button>
                <Button onClick={relaunch}>Restart client</Button>
            </Flex>
        </div>
    );
}

const SafeCrashSupportModal = ErrorBoundary.wrap(CrashSupportModal, { fallback: CrashSupportFallback });

function CrashSupportScreen({ empty }: { empty: boolean; }) {
    const { showSupportPopup, detectBlankScreen } = settings.use(SCREEN_SETTINGS_KEYS);
    const [dismissedReport, setDismissedReport] = React.useState<string>();

    React.useEffect(() => {
        supportScreenMounted = true;
        return () => { supportScreenMounted = false; };
    }, []);

    React.useEffect(() => {
        if (!empty || !detectBlankScreen) return;
        const timer = setTimeout(() => reportScreenFailure(new Error("Discord rendered an empty screen.")), 1500);
        return () => clearTimeout(timer);
    }, [empty, detectBlankScreen]);

    const report = latestReport;
    if (!showSupportPopup || !report || report.id === dismissedReport) return null;

    return (
        <div className={cl("overlay")}>
            <SafeCrashSupportModal
                report={report}
                modalProps={{ transitionState: 1, onClose: () => setDismissedReport(report.id) }}
            />
        </div>
    );
}

const SafeCrashSupportScreen = ErrorBoundary.wrap(CrashSupportScreen, { noop: true });

function openCrashSupportModal(report: CrashReport) {
    if (crashModalOpen) return;

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

    runRecoveryStep("clear message drafts", clearDrafts);
    runRecoveryStep("close the expression picker", () => ExpressionPickerStore.closeExpressionPicker());
    runRecoveryStep("close context menus", () => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" }));
    runRecoveryStep("close stacked modals", () => ModalStack.popAll());
    runRecoveryStep("close open modals", closeAllModals);
    runRecoveryStep("close user profile overlays", () => FluxDispatcher.dispatch({ type: "USER_PROFILE_MODAL_CLOSE" }));
    runRecoveryStep("close open layers", () => FluxDispatcher.dispatch({ type: "LAYER_POP_ALL" }));

    if (settings.store.navigateHomeOnCrash) {
        runRecoveryStep("return to direct messages", () => NavigationRouter.transitionToGuild("@me"));
    }

    const stateRecovered = runRecoveryStep("reset the crash boundary", () => boundary.setState({ error: null, info: null }));
    return stateRecovered;
}

function CrashHandlerSettings() {
    const { crashCount, lastCrashAt, autoDisabledPlugins, safeModePlugins } = settings.use(SETTINGS_KEYS);
    const hasCrashReport = Boolean(settings.store.lastCrashReport);
    const report = latestReport ?? createPlaceholderReport();
    const diagnosticTest = readDiagnosticTest();
    const lastCrashText = lastCrashAt ? new Date(Number(lastCrashAt)).toLocaleString() : "No crashes recorded.";
    const disabledPlugins = readStringList(autoDisabledPlugins).filter(name => Plugins[name]);
    const history = readCrashHistory();
    const diagnosticEvents = readDiagnosticEvents().slice(-6).reverse();
    const lastCrash = history[0];
    const testCrash = lastCrash?.fingerprint ? { fingerprint: lastCrash.fingerprint, channelId: lastCrash.channelId } : undefined;
    const testablePlugins = lastCrash?.recentPluginNames?.filter(name => Plugins[name] && !Plugins[name].required && !Plugins[name].isDependency && Settings.plugins[name]?.enabled
        && !Object.values(Plugins).some(other => isPluginEnabled(other.name) && other.dependencies?.includes(name))).slice(0, 5) ?? [];

    return (
        <div className={cl("settings")}>
            <div className={cl("settings-header")}>
                <div className={cl("settings-copy")}>
                    <BaseText size="sm" weight="semibold">Recorded errors: {crashCount || "0"}</BaseText>
                    <BaseText tag="p" size="sm" color="text-muted" className={cl("text")}>
                        Last error: {lastCrashText}
                    </BaseText>
                </div>
                <Flex flexWrap="wrap" gap="8px" className={cl("settings-actions")}>
                    <Button size="small" variant="secondary" disabled={!hasCrashReport} onClick={copyLatestReport}>
                        Copy report
                    </Button>
                    <Button size="small" variant="secondary" disabled={!Native?.openCrashLogDir} onClick={openCrashLogsFolder}>
                        Open logs folder
                    </Button>
                    <Button size="small" variant="secondary" disabled={!Native?.openProcessCrashDir} onClick={openProcessCrashFolder}>
                        Open process dumps
                    </Button>
                    <Button size="small" variant="secondary" disabled={!Native?.clearClientCache} onClick={() => void clearClientCache().then(body => showNotification({ title: "Discord cache cleanup", body, noPersist: true }))}>
                        Clear client cache
                    </Button>
                    <Button size="small" variant="secondary" onClick={triggerTestCrash}>
                        Trigger test crash
                    </Button>
                    <Button size="small" onClick={() => openCrashSupportModal(report)}>
                        Open popup
                    </Button>
                </Flex>
            </div>
            <div className={cl("settings-row")}>
                <BaseText size="sm" weight="semibold">{safeModePlugins ? "Safe mode is active." : "Safe mode is off."}</BaseText>
                <Button size="small" variant="secondary" onClick={safeModePlugins ? restoreSafeMode : () => requestSafeMode()}>
                    {safeModePlugins ? "Restore previous plugins" : "Restart in safe mode"}
                </Button>
            </div>
            {diagnosticTest && (
                <div className={cl("settings-row")}>
                    <BaseText size="sm">
                        Test without {diagnosticTest.plugin}: {diagnosticTest.status === "awaiting-restart" ? "Restart before testing."
                            : diagnosticTest.status === "restoring" ? "Restart to finish restoring this plugin."
                                : diagnosticTest.status === "inconclusive" ? `Inconclusive because these plugins also changed: ${diagnosticTest.changedPlugins.join(", ")}.`
                                : diagnosticTest.status === "crashed" ? "The same crash happened with this plugin disabled."
                                : diagnosticTest.status === "no-crash" ? "No matching crash was reported."
                                    : `Repeat the action in channel ${diagnosticTest.channelId ?? "the same channel"}.`}
                    </BaseText>
                    <Flex flexWrap="wrap" gap="8px">
                        {diagnosticTest.status === "active" && <Button size="small" variant="secondary" onClick={markPluginTestWithoutCrash}>No matching crash</Button>}
                        <Button size="small" variant="secondary" onClick={restoreTestedPlugin}>{diagnosticTest.status === "restoring" ? "Restart now" : "Restore plugin"}</Button>
                    </Flex>
                </div>
            )}
            {!diagnosticTest && testCrash && testablePlugins.length > 0 && (
                <div className={cl("settings-row")}>
                    <BaseText size="sm">Test one plugin that had callbacks before the latest crash:</BaseText>
                    <Flex flexWrap="wrap" gap="8px">
                        {testablePlugins.map(name => (
                            <Button key={name} size="small" variant="secondary" onClick={() => beginPluginTest(name, testCrash)}>
                                Test {name}
                            </Button>
                        ))}
                    </Flex>
                </div>
            )}
            {disabledPlugins.map(name => (
                <div key={name} className={cl("settings-row")}>
                    <BaseText size="sm">Automatically disabled: {name}</BaseText>
                    <Button size="small" variant="secondary" disabled={Boolean(safeModePlugins)} onClick={() => restoreAutoDisabledPlugin(name)}>
                        Restore plugin
                    </Button>
                </div>
            ))}
            <div className={cl("history")}>
                <BaseText size="sm" weight="semibold">Recent plugin changes and client starts</BaseText>
                {diagnosticEvents.map(({ timestamp, kind, plugin, detail }) => (
                    <BaseText tag="p" size="sm" color="text-muted" className={cl("text")} key={`${timestamp}:${kind}:${plugin ?? ""}`}>
                        {new Date(timestamp).toLocaleString()} · {plugin ? `${plugin}: ` : ""}{detail ?? kind}
                    </BaseText>
                ))}
            </div>
            <div className={cl("history")}>
                <BaseText size="sm" weight="semibold">Recent errors</BaseText>
                {history.length ? history.map(entry => (
                    <div key={entry.id} className={cl("history-entry")}>
                        <BaseText size="sm" weight="semibold">{new Date(entry.timestamp).toLocaleString()} · {CRASH_KIND_LABELS[entry.kind]}</BaseText>
                        <BaseText tag="p" size="sm" color="text-muted" className={cl("text")}>
                            {entry.message} · Suspected plugin: {entry.suspectedPlugin}
                        </BaseText>
                    </div>
                )) : <BaseText size="sm" color="text-muted">No errors recorded yet.</BaseText>}
            </div>
        </div>
    );
}

const SafeCrashHandlerSettings = ErrorBoundary.wrap(CrashHandlerSettings, { noop: true });

export default definePlugin({
    name: "CrashHandlerEnhanced",
    description: "Adds Illegalcord crash recovery, support guidance, and a copyable crash report.",
    tags: ["Utility", "Developers"],
    authors: [EquicordDevs.irritably],
    required: true,
    enabledByDefault: true,
    settings,
    settingsAboutComponent: SafeCrashHandlerSettings,
    toolboxActions: {
        "Open latest crash popup": () => openCrashSupportModal(latestReport ?? createPlaceholderReport()),
        "Copy latest crash report": copyLatestReport,
        "Open crash logs folder": openCrashLogsFolder,
        "Open process crash dumps": openProcessCrashFolder,
        "Trigger test crash": triggerTestCrash
    },

    start() {
        if (settings.store.captureGlobalErrors) settings.store.captureGlobalErrors = false;
        recordDiagnosticEvent("start", undefined, "Client session started.");
        const test = readDiagnosticTest();
        const enabledPlugins = new Set(getEnabledPluginSnapshot());
        const baseline = new Set(test?.baselineEnabledPlugins ?? []);
        const changedPlugins = test?.baselineEnabledPlugins
            ? [...new Set([...baseline, ...enabledPlugins])].filter(name => name !== test.plugin && baseline.has(name) !== enabledPlugins.has(name) && !test.changedPlugins.includes(name))
            : [];
        if (test?.status === "restoring" && Settings.plugins[test.plugin]?.enabled) {
            settings.store.diagnosticTest = "";
            recordDiagnosticEvent("test-result", test.plugin, "Plugin restored after the restart.");
        } else if (test && changedPlugins.length && (test.status === "awaiting-restart" || test.status === "active" || test.status === "no-crash" || test.status === "inconclusive")) {
            settings.store.diagnosticTest = JSON.stringify({ ...test, status: "inconclusive", changedPlugins: [...test.changedPlugins, ...changedPlugins] });
            recordDiagnosticEvent("test-result", test.plugin, `Inconclusive because these plugins also changed: ${changedPlugins.join(", ")}.`);
        } else if (test && Plugins[test.plugin] && Settings.plugins[test.plugin]?.enabled === false && test.status === "awaiting-restart") {
            settings.store.diagnosticTest = JSON.stringify({ ...test, status: "active" });
            recordDiagnosticEvent("test-start", test.plugin, "Test started after the restart.");
        } else if (test && Settings.plugins[test.plugin]?.enabled) {
            settings.store.diagnosticTest = "";
        }
        SettingsStore.addGlobalChangeListener(onPluginSettingChanged);
        instrumentPlugins();
        installGlobalListeners();
    },

    stop() {
        SettingsStore.removeGlobalChangeListener(onPluginSettingChanged);
        if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
        recoveryTimer = undefined;
        queuedCrash = null;
        isRecovering = false;
        removeGlobalListeners();
        restoreInstrumentedMethods();
        pluginErrorOrigins = new WeakMap();
        pluginBreadcrumbs = [];
    },

    patches: [
        {
            find: "#{intl::ERRORS_UNEXPECTED_CRASH}",
            replacement: {
                match: /(?:this\.setState\(|Vencord\.Plugins\.plugins\["CrashHandler"\]\.handleCrash\(this,)(.{0,300}?)\)/,
                replace: "$self.handleCrash(this,$1)"
            }
        },
        {
            find: "#{intl::ERRORS_UNEXPECTED_CRASH}",
            replacement: {
                match: /render\(\)\{(?=.{0,150}?this\.state)/,
                replace: "render(){return $self.renderRoot(this.vcCrashHandlerRender())}vcCrashHandlerRender(){"
            }
        }
    ],

    handleCrash,
    renderRoot(children: ReactNode) {
        return <>{children}<SafeCrashSupportScreen empty={children == null || typeof children === "boolean" || children === "" || (Array.isArray(children) && children.length === 0)} /></>;
    }
});
