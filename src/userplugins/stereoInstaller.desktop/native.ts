/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import { spawn } from "child_process";
import { app, dialog, type IpcMainInvokeEvent } from "electron";
import method128 from "file://StereoMethods/Discord-Voice/(128) discord_voice.node?base64&trim=false";
import method384 from "file://StereoMethods/Discord-Voice/(384) discord_voice.node?base64&trim=false";
import method512 from "file://StereoMethods/Discord-Voice/(512) discord_voice.node?base64&trim=false";
import method2Index from "file://StereoMethods/Discord-Voice/index.js?base64&trim=false";
import { appendFileSync, constants, type Dirent, existsSync, mkdirSync } from "fs";
import { access, chmod, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import { arch, homedir, platform as osPlatform, release } from "os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";

const APP_NAME = "StereoInstaller";
const DATA_DIR_NAME = "DiscordStereoHubSimple";
const MAX_DOWNLOAD_BYTES = 160 * 1024 * 1024;
const SOURCE_DISCORD_VOICE_DIR = "C:/Users/Hisako/Documents/Illegalcord/src/userplugins/stereoInstaller.desktop/StereoMethods/Discord-Voice";
const PATCHED_WINDOWS_GITHUB_CONTENTS_API = "https://api.github.com/repos/ProdHallow/Discord-Stereo-Windows-MacOS-Linux/contents/Updates%2FNodes%2FPatched%20Nodes%20%28for%20Installer%29%2FWindows";
const PATCHED_LINUX_GITHUB_CONTENTS_API = "https://api.github.com/repos/ProdHallow/Discord-Stereo-Windows-MacOS-Linux/contents/Updates%2FNodes%2FPatched%20Nodes%20%28for%20Installer%29%2FLinux";

export interface InstallInfo {
    platformKey: string;
    platformLabel: string;
    readableOs: string;
    discordRoot: string;
    voiceDir: string;
    appDir?: string;
    clientLabel: string;
    buildLabel: string;
    lastPatchLabel: string;
    lastPatchLabels: LastPatchLabels;
    repatchWarning: string;
}

export interface ActionInfo extends InstallInfo {
    logPath: string;
}

export type StereoMethod2Quality = "128" | "384" | "512";
type PatchMethod = "discordAudioCollective" | "voicePlayground";
type SingleFileName = "discord_voice.node" | "index.js";

export interface LastPatchLabels {
    discordAudioCollective: string;
    voicePlayground: string;
}

const PATCH_METHOD_LABELS: Record<PatchMethod, string> = {
    discordAudioCollective: "Discord Audio Collective Method",
    voicePlayground: "Voice Playground Method"
};
const PATCH_METHODS: PatchMethod[] = ["discordAudioCollective", "voicePlayground"];

export type NativeResult<T> = {
    success: true;
    data: T;
    logs: string[];
} | {
    success: false;
    error: string;
    logs: string[];
};

interface Target {
    discordRoot: string;
    voiceDir: string;
    appDir?: string;
    exeName?: string;
}

interface GithubContentFile {
    type: "file";
    name: string;
    download_url: string;
}

interface RelaunchConfig {
    platformKey: string;
    discordRoot: string;
    appDir?: string;
    exeName?: string;
}

interface WorkerConfig {
    actionName: "Patch" | "Revert";
    parentPid: number;
    sourceDir: string;
    targetDir: string;
    copyMode: "directory" | "singleFile";
    fileName?: SingleFileName;
    metaPath?: string;
    patchClientLabel: string;
    patchBuildLabel: string;
    logPath: string;
    logPaths: string[];
    taskName?: string;
    relaunch: RelaunchConfig;
}

interface ProcessResult {
    code: number;
    output: string;
}

const allowedDiscordRoots = new Set<string>();

class ActionLog {
    public readonly lines: string[] = [];

    public info(message: string): void {
        this.write(message);
    }

    public ok(message: string): void {
        this.write(`OK: ${message}`);
    }

    public warn(message: string): void {
        this.write(`WARN: ${message}`);
    }

    public fail(message: string): void {
        this.write(`FAIL: ${message}`);
    }

    private write(message: string): void {
        const line = `[${new Date().toLocaleString()}] ${message}`;
        this.lines.push(line);
        appendLogLine(line);
    }
}

export async function autoDetect(_: IpcMainInvokeEvent): Promise<NativeResult<InstallInfo>> {
    const log = new ActionLog();

    try {
        const target = await resolveTarget();
        if (!target) throw new Error("Could not find discord_voice.node. Open Discord once, join a voice channel once, then try again.");

        rememberAllowedRoot(target.discordRoot);
        log.ok(`Auto-detected voice module: ${target.voiceDir}`);

        return ok(await installInfoFromTarget(target), log.lines);
    } catch (error) {
        log.fail(errorMessage(error));
        return fail(errorMessage(error), log.lines);
    }
}

export async function chooseDiscordRoot(_: IpcMainInvokeEvent): Promise<NativeResult<InstallInfo | null>> {
    const log = new ActionLog();

    try {
        const result = await dialog.showOpenDialog({
            title: "Select your Discord install folder",
            properties: ["openDirectory"]
        });

        if (result.canceled || !result.filePaths[0]) return ok(null, log.lines);

        const selectedRoot = normalizeInputPath(result.filePaths[0]);
        rememberAllowedRoot(selectedRoot);
        log.info(`Selected Discord root: ${selectedRoot}`);

        const target = await resolveTarget(selectedRoot);
        if (!target) throw new Error("Could not find discord_voice.node in that Discord install folder.");

        rememberAllowedRoot(target.discordRoot);
        log.ok(`Found voice module: ${target.voiceDir}`);

        return ok(await installInfoFromTarget(target), log.lines);
    } catch (error) {
        log.fail(errorMessage(error));
        return fail(errorMessage(error), log.lines);
    }
}

export async function patch(_: IpcMainInvokeEvent, rootPath: string): Promise<NativeResult<ActionInfo>> {
    const log = new ActionLog();

    try {
        const target = await targetFromRendererRoot(rootPath);
        log.info("=== Patch ===");
        log.info(`Discord root: ${target.discordRoot}`);
        log.info(`Voice dir: ${target.voiceDir}`);

        await ensurePermanentUnpatchedBackup(target, log);
        const patchedVoiceDir = await downloadPatchedPayload(log);
        await scheduleWorker("Patch", patchedVoiceDir, target, "discordAudioCollective", log);
        log.ok("Patch scheduled. Discord will close, install Discord Audio Collective Method, then reopen.");

        return ok({ ...await installInfoFromTarget(target), logPath: logPath() }, log.lines);
    } catch (error) {
        log.fail(errorMessage(error));
        return fail(errorMessage(error), log.lines);
    }
}

export async function patchMethod2(_: IpcMainInvokeEvent, rootPath: string, quality: StereoMethod2Quality): Promise<NativeResult<ActionInfo>> {
    const log = new ActionLog();

    try {
        const target = await targetFromRendererRoot(rootPath);
        const methodTarget = await method2Target(target);
        assertVoicePlaygroundSupported();

        log.info("=== Patch Voice Playground Method ===");
        log.info(`Discord root: ${methodTarget.discordRoot}`);
        log.info(`Voice dir: ${methodTarget.voiceDir}`);
        log.info(`Stereo quality: ${quality}`);

        if (!await looksLikeDiscordVoiceDir(methodTarget.voiceDir)) {
            throw new Error(`Voice Playground Method target folder was not found or is incomplete: ${methodTarget.voiceDir}`);
        }

        await ensurePermanentUnpatchedBackup(methodTarget, log);
        const patchedVoiceDir = await prepareMethod2Payload(quality, log);
        await scheduleWorker("Patch", patchedVoiceDir, methodTarget, "voicePlayground", log, "singleFile");
        log.ok("Patch scheduled. Discord will close, install Voice Playground Method, then reopen.");

        return ok({ ...await installInfoFromTarget(methodTarget), logPath: logPath() }, log.lines);
    } catch (error) {
        log.fail(errorMessage(error));
        return fail(errorMessage(error), log.lines);
    }
}

export async function patchMethod2Index(_: IpcMainInvokeEvent, rootPath: string): Promise<NativeResult<ActionInfo>> {
    const log = new ActionLog();

    try {
        const target = await targetFromRendererRoot(rootPath);
        const methodTarget = await method2Target(target);
        assertVoicePlaygroundSupported();

        log.info("=== Patch Voice Playground index.js ===");
        log.info(`Discord root: ${methodTarget.discordRoot}`);
        log.info(`Voice dir: ${methodTarget.voiceDir}`);

        if (!await looksLikeDiscordVoiceDir(methodTarget.voiceDir)) {
            throw new Error(`Voice Playground Method target folder was not found or is incomplete: ${methodTarget.voiceDir}`);
        }

        await ensurePermanentUnpatchedBackup(methodTarget, log);
        const patchedIndexDir = await prepareMethod2IndexPayload(log);
        await scheduleWorker("Patch", patchedIndexDir, methodTarget, "voicePlayground", log, "singleFile", "index.js");
        log.ok("Patch scheduled. Discord will close, install index.js, then reopen.");

        return ok({ ...await installInfoFromTarget(methodTarget), logPath: logPath() }, log.lines);
    } catch (error) {
        log.fail(errorMessage(error));
        return fail(errorMessage(error), log.lines);
    }
}

export async function revert(_: IpcMainInvokeEvent, rootPath: string): Promise<NativeResult<ActionInfo>> {
    const log = new ActionLog();

    try {
        const target = await targetFromRendererRoot(rootPath);
        const backupDir = permanentBackupDir(target);

        log.info("=== Revert ===");
        log.info(`Discord root: ${target.discordRoot}`);
        log.info(`Voice dir: ${target.voiceDir}`);

        if (!await looksLikeDiscordVoiceDir(backupDir)) {
            throw new Error(`No permanent UNPATCHED backup found at: ${backupDir}. Run Patch once first to create the baseline.`);
        }

        await scheduleWorker("Revert", backupDir, target, undefined, log);
        log.ok("Revert scheduled. Discord will close, restore the backup, then reopen.");

        return ok({ ...await installInfoFromTarget(target), logPath: logPath() }, log.lines);
    } catch (error) {
        log.fail(errorMessage(error));
        return fail(errorMessage(error), log.lines);
    }
}

function ok<T>(data: T, logs: string[]): NativeResult<T> {
    return { success: true, data, logs };
}

function fail<T>(error: string, logs: string[]): NativeResult<T> {
    return { success: false, error, logs };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown error.";
}

function platformKey(): string {
    const key = process.platform;
    if (key === "win32") return "windows";
    if (key === "darwin") return "macos";
    if (key === "linux") return "linux";
    return key || "unknown";
}

function platformLabel(key: string): string {
    if (key === "windows") return "Windows";
    if (key === "macos") return "macOS";
    if (key === "linux") return "Linux";
    return key ? key[0].toUpperCase() + key.slice(1) : "Unknown";
}

function assertVoicePlaygroundSupported(): void {
    if (platformKey() !== "windows") {
        throw new Error("Voice Playground Method is only available on Windows. Use Discord Audio Collective Method on Linux.");
    }
}

function readableOs(): string {
    return `${osPlatform()} ${release()} (${arch()})`;
}

function hubDataDir(): string {
    const key = platformKey();
    if (key === "windows") {
        return join(process.env.LOCALAPPDATA || process.env.APPDATA || homedir(), DATA_DIR_NAME);
    }

    if (key === "macos") {
        return join(homedir(), "Library", "Application Support", DATA_DIR_NAME);
    }

    const xdgDataHome = (process.env.XDG_DATA_HOME || "").trim();
    return join(xdgDataHome || join(homedir(), ".local", "share"), DATA_DIR_NAME);
}

function logPath(): string {
    return join(discordVoiceLoggingDir(), "StereoInstaller.log");
}

function fallbackLogPath(): string {
    return join(hubDataDir(), "discord_stereo_hub.log");
}

function logPaths(): string[] {
    return Array.from(new Set([logPath(), fallbackLogPath()].map((pathValue: string) => resolve(pathValue))));
}

function appendLogLine(line: string): void {
    for (const pathValue of logPaths()) {
        try {
            mkdirSync(dirname(pathValue), { recursive: true });
            appendFileSync(pathValue, `${line}\n`, "utf8");
        } catch { }
    }
}

function discordVoiceLoggingDir(): string {
    return join(sourceDiscordVoiceDir() ?? join(hubDataDir(), "StereoMethods", "Discord-Voice"), "Logging");
}

function sourceDiscordVoiceDir(): string | undefined {
    if (existsSync(SOURCE_DISCORD_VOICE_DIR)) return SOURCE_DISCORD_VOICE_DIR;

    const relativeDiscordVoiceDir = join("src", "userplugins", "stereoInstaller.desktop", "StereoMethods", "Discord-Voice");
    const roots = [
        process.cwd(),
        app.getAppPath(),
        dirname(process.execPath),
        process.env.INIT_CWD,
        process.env.PWD,
    ].filter((pathValue: string | undefined): pathValue is string => !!pathValue);

    for (const root of roots) {
        let current = resolve(root);
        for (let i = 0; i < 8; i++) {
            const candidate = join(current, relativeDiscordVoiceDir);
            if (existsSync(candidate)) return candidate;

            const parent = dirname(current);
            if (parent === current) break;
            current = parent;
        }
    }

    return undefined;
}

function normalizeInputPath(pathValue: string): string {
    if (typeof pathValue !== "string" || !pathValue.trim() || pathValue.length > 4096) {
        throw new Error("Discord install folder is invalid.");
    }

    return resolve(pathValue);
}

function canonicalPath(pathValue: string): string {
    const resolved = resolve(pathValue);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(a: string, b: string): boolean {
    return canonicalPath(a) === canonicalPath(b);
}

function isPathInside(parentPath: string, childPath: string): boolean {
    const rel = relative(canonicalPath(parentPath), canonicalPath(childPath));
    return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function assertPathInside(parentPath: string, childPath: string): void {
    if (!isPathInside(parentPath, childPath)) {
        throw new Error("Resolved path is outside the allowed folder.");
    }
}

function rememberAllowedRoot(root: string): void {
    allowedDiscordRoots.add(canonicalPath(root));
}

function defaultDiscordRoots(): string[] {
    const key = platformKey();
    const home = homedir();

    if (key === "windows") {
        const localAppData = process.env.LOCALAPPDATA || "";
        return [
            "Discord",
            "DiscordCanary",
            "DiscordPTB",
            "DiscordDevelopment",
            "Lightcord",
            "Vencord",
            "Equicord",
            "BetterVencord"
        ].map((name: string) => join(localAppData, name)).filter((pathValue: string) => !!pathValue);
    }

    if (key === "macos") {
        return [
            join(home, "Library", "Application Support", "discord"),
            join(home, "Library", "Application Support", "discordcanary"),
            join(home, "Library", "Application Support", "discordptb")
        ];
    }

    return [
        join(home, ".config", "discord"),
        join(home, ".config", "discordcanary"),
        join(home, ".config", "discordptb"),
        join(home, ".config", "discorddevelopment"),
        join(home, ".var", "app", "com.discordapp.Discord", "config", "discord"),
        join(home, "snap", "discord", "current", ".config", "discord")
    ];
}

function validateRendererDiscordRoot(rootPath: string): string {
    const root = normalizeInputPath(rootPath);
    const canonical = canonicalPath(root);
    const defaultRoots = defaultDiscordRoots().map((pathValue: string) => canonicalPath(pathValue));

    if (allowedDiscordRoots.has(canonical) || defaultRoots.includes(canonical)) return root;

    throw new Error("Use Auto-detect or Browse before running this action.");
}

async function targetFromRendererRoot(rootPath: string): Promise<Target> {
    const root = validateRendererDiscordRoot(rootPath);
    const target = await resolveTarget(root);
    if (!target) throw new Error("Could not find discord_voice.node. Open Discord once, join a voice channel once, then try again.");

    rememberAllowedRoot(target.discordRoot);
    assertPathInside(target.discordRoot, target.voiceDir);

    return target;
}

async function pathExists(pathValue: string): Promise<boolean> {
    try {
        await access(pathValue, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

async function isDirectory(pathValue: string): Promise<boolean> {
    try {
        return (await stat(pathValue)).isDirectory();
    } catch {
        return false;
    }
}

async function isFile(pathValue: string): Promise<boolean> {
    try {
        return (await stat(pathValue)).isFile();
    } catch {
        return false;
    }
}

async function looksLikeDiscordVoiceDir(pathValue: string): Promise<boolean> {
    return await isDirectory(pathValue) && await isFile(join(pathValue, "discord_voice.node"));
}

function parseAppVersionFromDirName(name: string): number[] {
    const match = /^(?:app-)?([\d.]+)$/i.exec(name);
    if (!match) return [0, 0, 0, 0];

    const parts = match[1].split(".").map((part: string) => Number.parseInt(part, 10));
    if (parts.some((part: number) => Number.isNaN(part))) return [0, 0, 0, 0];
    while (parts.length < 4) parts.push(0);
    return parts.slice(0, 4);
}

function isDiscordAppDirName(name: string): boolean {
    return /^(?:app-)?\d+(?:\.\d+)*$/i.test(name);
}

function compareVersionsDescending(a: string, b: string): number {
    const left = parseAppVersionFromDirName(a);
    const right = parseAppVersionFromDirName(b);

    for (let i = 0; i < 4; i++) {
        if (left[i] !== right[i]) return right[i] - left[i];
    }

    return b.localeCompare(a);
}

async function findDiscordAppDir(discordRoot: string): Promise<string | undefined> {
    let entries: Dirent[];
    try {
        entries = await readdir(discordRoot, { withFileTypes: true });
    } catch {
        return undefined;
    }

    const apps = entries
        .filter((entry: Dirent) => entry.isDirectory() && isDiscordAppDirName(entry.name))
        .map((entry: Dirent) => join(discordRoot, entry.name));

    apps.sort((a: string, b: string) => compareVersionsDescending(basename(a), basename(b)));
    return apps[0];
}

async function findVoiceDirFromAppDir(appDir: string): Promise<string | undefined> {
    const modulesDir = join(appDir, "modules");
    if (!await isDirectory(modulesDir)) return undefined;

    let entries: Dirent[];
    try {
        entries = await readdir(modulesDir, { withFileTypes: true });
    } catch {
        return undefined;
    }

    const candidates = entries
        .filter((entry: Dirent) => entry.isDirectory() && entry.name.toLowerCase().startsWith("discord_voice"))
        .map((entry: Dirent) => join(modulesDir, entry.name))
        .sort((a: string, b: string) => a.localeCompare(b));

    for (const candidate of candidates) {
        const nested = join(candidate, "discord_voice");
        if (await looksLikeDiscordVoiceDir(nested)) return nested;
        if (await looksLikeDiscordVoiceDir(candidate)) return candidate;
    }

    return undefined;
}

async function findDiscordVoiceDirUnder(root: string): Promise<string | undefined> {
    const appDir = await findDiscordAppDir(root);
    if (appDir) {
        const direct = await findVoiceDirFromAppDir(appDir);
        if (direct) return direct;
    }

    const stack = [root];
    let checked = 0;

    while (stack.length && checked < 5000) {
        const current = stack.pop();
        if (!current) break;
        checked++;

        let entries: Dirent[];
        try {
            entries = await readdir(current, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const child = join(current, entry.name);
            if (entry.isFile() && entry.name === "discord_voice.node") return dirname(child);
            if (entry.isDirectory()) stack.push(child);
        }
    }

    return undefined;
}

async function findVoiceDirWithDiagnostics(discordRoot: string): Promise<{ voiceDir?: string; appDir?: string; diagnostics: string; }> {
    if (!await isDirectory(discordRoot)) return { diagnostics: "Discord root folder not found." };

    const appDir = await findDiscordAppDir(discordRoot);
    if (!appDir) return { diagnostics: "No app folders found. Discord may not be fully installed." };

    const modulesDir = join(appDir, "modules");
    if (!await isDirectory(modulesDir)) return { appDir, diagnostics: `No modules folder found in ${basename(appDir)}.` };

    const voiceDir = await findVoiceDirFromAppDir(appDir);
    if (!voiceDir) return { appDir, diagnostics: "discord_voice module found, but discord_voice.node was not found inside it." };

    return { voiceDir, appDir, diagnostics: "" };
}

async function resolveTarget(preferredRoot?: string): Promise<Target | undefined> {
    const roots: string[] = [];
    if (preferredRoot) roots.push(normalizeInputPath(preferredRoot));

    for (const root of defaultDiscordRoots()) {
        if (!roots.some((knownRoot: string) => samePath(knownRoot, root))) roots.push(root);
    }

    for (const root of roots) {
        const found = await findVoiceDirWithDiagnostics(root);
        if (found.voiceDir) {
            return {
                discordRoot: root,
                voiceDir: found.voiceDir,
                appDir: found.appDir,
                exeName: clientExeForRoot(root)
            };
        }

        const fallbackVoiceDir = await findDiscordVoiceDirUnder(root);
        if (fallbackVoiceDir) {
            return {
                discordRoot: root,
                voiceDir: fallbackVoiceDir,
                appDir: found.appDir || await findDiscordAppDir(root),
                exeName: clientExeForRoot(root)
            };
        }
    }

    return undefined;
}

function clientExeForRoot(root: string): string | undefined {
    const key = platformKey();
    if (key === "windows") return windowsClientExeForRoot(root);
    if (key === "linux") return linuxClientExeForRoot(root);
    return undefined;
}

function windowsClientExeForRoot(root: string): string {
    const leaf = basename(root).toLowerCase();
    if (leaf === "lightcord") return "Lightcord.exe";
    if (leaf.includes("discordcanary")) return "DiscordCanary.exe";
    if (leaf.includes("discordptb")) return "DiscordPTB.exe";
    if (leaf.includes("discorddevelopment")) return "DiscordDevelopment.exe";
    return "Discord.exe";
}

function linuxClientExeForRoot(root: string): string {
    const normalized = root.toLowerCase();
    if (normalized.includes("discordcanary")) return "discord-canary";
    if (normalized.includes("discordptb")) return "discord-ptb";
    if (normalized.includes("discorddevelopment")) return "discord-development";
    return "discord";
}

function releaseChannelFromRoot(root: string): string | undefined {
    const leaf = basename(root).toLowerCase();
    if (leaf === "discorddevelopment") return "Development";
    if (leaf === "discordcanary") return "Canary";
    if (leaf === "discordptb") return "PTB";
    if (leaf === "discord") return "Stable";
    return undefined;
}

function clientPrefixForRoot(root: string): string {
    const leaf = basename(root).toLowerCase();
    if (["discord", "vencord", "equicord", "bettervencord"].includes(leaf)) return "Stable";

    const channel = releaseChannelFromRoot(root);
    if (channel) return channel;
    if (leaf === "lightcord" || leaf === "lightchord") return "Lightcord";

    return basename(root).replaceAll("_", " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function buildLabelFromAppDir(appDir?: string): string {
    if (!appDir) return "";
    const match = /^(?:app-)?([\d.]+)$/i.exec(basename(appDir));
    if (!match) return "";

    const parts = match[1].split(".").filter((part: string) => /^\d+$/.test(part));
    return parts.at(-1) || match[1];
}

function clientLabelForRoot(root: string, buildLabel: string): string {
    const clientPrefix = clientPrefixForRoot(root);
    return clientPrefix && buildLabel ? `${clientPrefix} ${buildLabel}` : clientPrefix || buildLabel || "--";
}

async function installInfoFromTarget(target: Target): Promise<InstallInfo> {
    const buildLabel = buildLabelFromAppDir(target.appDir || await findDiscordAppDir(target.discordRoot));
    const clientLabel = clientLabelForRoot(target.discordRoot, buildLabel);
    const lastPatchLabels: LastPatchLabels = {
        discordAudioCollective: await lastPatchCaption(target.discordRoot, "discordAudioCollective"),
        voicePlayground: await lastPatchCaption(target.discordRoot, "voicePlayground")
    };

    return {
        platformKey: platformKey(),
        platformLabel: platformLabel(platformKey()),
        readableOs: readableOs(),
        discordRoot: target.discordRoot,
        voiceDir: target.voiceDir,
        appDir: target.appDir,
        clientLabel,
        buildLabel,
        lastPatchLabel: lastPatchLabels.discordAudioCollective,
        lastPatchLabels,
        repatchWarning: await repatchWarning(target.discordRoot, buildLabel)
    };
}

function sanitizedRootKey(root: string): string {
    return root.replace(/[\\/:]/g, "_");
}

function permanentBackupDir(target: Target): string {
    return join(hubDataDir(), "backups", sanitizedRootKey(target.discordRoot), "UNPATCHED");
}

function metaPathForRoot(discordRoot: string, method: PatchMethod): string {
    const fileName = method === "discordAudioCollective"
        ? "quick_hub_meta_discord_audio_collective.json"
        : "quick_hub_meta_voice_playground.json";

    return join(hubDataDir(), "backups", sanitizedRootKey(discordRoot), fileName);
}

async function readPatchMeta(discordRoot: string, method: PatchMethod): Promise<Record<string, unknown> | undefined> {
    const metaPath = metaPathForRoot(discordRoot, method);
    if (!await isFile(metaPath)) return undefined;

    try {
        const parsed: unknown = JSON.parse((await readFile(metaPath, "utf8")).trimStart());
        return isRecord(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

function metaString(meta: Record<string, unknown>, key: string): string {
    const value = meta[key];
    return typeof value === "string" ? value : "";
}

async function repatchWarning(discordRoot: string, currentBuildLabel: string): Promise<string> {
    if (!currentBuildLabel) return "";

    let latestPatchBuildLabel = "";
    let latestPatchTime = -1;

    for (const method of PATCH_METHODS) {
        const meta = await readPatchMeta(discordRoot, method);
        if (!meta || !metaString(meta, "last_patch_utc")) continue;

        const date = new Date(metaString(meta, "last_patch_utc"));
        const patchTime = Number.isNaN(date.getTime()) ? 0 : date.getTime();
        if (patchTime < latestPatchTime) continue;

        latestPatchTime = patchTime;
        latestPatchBuildLabel = metaString(meta, "build_label");
    }

    if (latestPatchTime < 0) return "";
    if (!latestPatchBuildLabel) return "StereoInstaller needs to verify this Discord version. Patch Discord voice again with StereoInstaller.";
    if (latestPatchBuildLabel !== currentBuildLabel) return "Discord updated since StereoInstaller last patched audio. Patch Discord voice again with StereoInstaller.";

    return "";
}

async function lastPatchCaption(discordRoot: string, method: PatchMethod): Promise<string> {
    const metaPath = metaPathForRoot(discordRoot, method);
    if (!await isFile(metaPath)) return "Never";

    try {
        const parsed: unknown = JSON.parse((await readFile(metaPath, "utf8")).trimStart());
        if (!isRecord(parsed)) return `${PATCH_METHOD_LABELS[method]} saved data could not be read.`;

        const iso = typeof parsed.last_patch_utc === "string" ? parsed.last_patch_utc : "";
        if (!iso) return "Never";

        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return iso;

        return date.toLocaleString();
    } catch {
        return `${PATCH_METHOD_LABELS[method]} saved data could not be read.`;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

async function ensurePermanentUnpatchedBackup(target: Target, log: ActionLog): Promise<string> {
    const backupDir = permanentBackupDir(target);
    if (await looksLikeDiscordVoiceDir(backupDir)) {
        log.info(`Permanent UNPATCHED backup already exists: ${backupDir}`);
        return backupDir;
    }

    assertPathInside(target.discordRoot, target.voiceDir);
    assertPathInside(hubDataDir(), backupDir);

    log.info("Creating permanent UNPATCHED backup for the first time.");
    await mkdir(dirname(backupDir), { recursive: true });
    await rm(backupDir, { recursive: true, force: true });
    await cp(target.voiceDir, backupDir, { recursive: true });
    log.ok(`Saved permanent UNPATCHED backup: ${backupDir}`);

    return backupDir;
}

async function clearDirContents(pathValue: string, allowedParent: string): Promise<void> {
    assertPathInside(allowedParent, pathValue);

    if (!await pathExists(pathValue)) {
        await mkdir(pathValue, { recursive: true });
        return;
    }

    if (!await isDirectory(pathValue)) throw new Error(`Expected a folder, got: ${pathValue}`);

    const entries = await readdir(pathValue, { withFileTypes: true });
    for (const entry of entries) {
        const child = join(pathValue, entry.name);
        assertPathInside(pathValue, child);
        await rm(child, { recursive: true, force: true });
    }
}

async function downloadBytes(url: string, timeoutMs: number, accept?: string): Promise<Buffer> {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:") throw new Error("Download URL must use HTTPS.");
    if (!["api.github.com", "raw.githubusercontent.com"].includes(parsedUrl.hostname)) {
        throw new Error(`Download host is not allowed: ${parsedUrl.hostname}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = {
        "User-Agent": VENCORD_USER_AGENT || APP_NAME,
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
    };

    if (accept) headers.Accept = accept;

    const token = (process.env.DISCORD_STEREO_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "").trim();
    if (token) headers.Authorization = token.startsWith("github_pat_") ? `Bearer ${token}` : `token ${token}`;

    try {
        const response = await fetch(parsedUrl, {
            headers,
            signal: controller.signal
        });

        if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);

        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
            throw new Error("Download is too large.");
        }

        const data = Buffer.from(await response.arrayBuffer());
        if (data.byteLength > MAX_DOWNLOAD_BYTES) throw new Error("Download is too large.");

        return data;
    } finally {
        clearTimeout(timeout);
    }
}

function validateDownloadPayload(name: string, data: Buffer): void {
    if (!data.byteLength) throw new Error(`${name}: empty download.`);

    const head = data.subarray(0, 256).toString("utf8").trimStart().toLowerCase();
    if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.includes("<title>")) {
        throw new Error(`${name}: download looks like an HTML error page.`);
    }

    const low = name.toLowerCase();
    if ([".node", ".dll", ".exe", ".tflite", ".so", ".dylib"].some((ext: string) => low.endsWith(ext)) && data.byteLength < 1024) {
        throw new Error(`${name}: binary download is too small.`);
    }
}

function patchedGithubApiForPlatform(): string {
    const key = platformKey();
    if (key === "windows") return PATCHED_WINDOWS_GITHUB_CONTENTS_API;
    if (key === "linux") return PATCHED_LINUX_GITHUB_CONTENTS_API;
    throw new Error("Discord Audio Collective Method supports Windows and Linux patched payloads.");
}

async function method2Target(target: Target): Promise<Target> {
    const appDir = target.appDir || await findDiscordAppDir(target.discordRoot);
    if (!appDir) throw new Error("Could not find the Discord app folder for Voice Playground Method.");

    const voiceDir = join(appDir, "modules", "discord_voice-1", "discord_voice");
    assertPathInside(target.discordRoot, voiceDir);

    return {
        ...target,
        appDir,
        voiceDir
    };
}

function method2Payload(quality: StereoMethod2Quality): string {
    if (quality === "128") return method128;
    if (quality === "384") return method384;
    if (quality === "512") return method512;

    throw new Error("Invalid Voice Playground Method quality selected.");
}

async function prepareMethod2Payload(quality: StereoMethod2Quality, log: ActionLog): Promise<string> {
    const staging = join(hubDataDir(), "staging", "method2_payload");
    const targetFile = join(staging, "discord_voice.node");
    assertPathInside(hubDataDir(), staging);
    assertPathInside(staging, targetFile);

    await mkdir(staging, { recursive: true });
    await clearDirContents(staging, hubDataDir());
    await writeFile(targetFile, Buffer.from(method2Payload(quality), "base64"));
    validateDownloadPayload("discord_voice.node", await readFile(targetFile));

    log.ok(`Prepared Voice Playground Method payload: ${quality}.`);

    return staging;
}

async function prepareMethod2IndexPayload(log: ActionLog): Promise<string> {
    const staging = join(hubDataDir(), "staging", "method2_index_payload");
    const targetFile = join(staging, "index.js");
    assertPathInside(hubDataDir(), staging);
    assertPathInside(staging, targetFile);

    await mkdir(staging, { recursive: true });
    await clearDirContents(staging, hubDataDir());
    await writeFile(targetFile, Buffer.from(method2Index, "base64"));
    validateDownloadPayload("index.js", await readFile(targetFile));

    log.ok("Prepared Voice Playground Method index.js payload.");

    return staging;
}

function isGithubContentFile(value: unknown): value is GithubContentFile {
    return isRecord(value)
        && value.type === "file"
        && typeof value.name === "string"
        && typeof value.download_url === "string"
        && value.download_url.length > 0;
}

function assertSafeRemoteFileName(name: string): void {
    if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
        throw new Error(`Unsafe remote file name: ${name || "unknown"}`);
    }
}

async function downloadGithubFolderToDir(apiUrl: string, dest: string, log: ActionLog): Promise<void> {
    const raw = await downloadBytes(apiUrl, 60_000, "application/vnd.github.v3+json");
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    if (!Array.isArray(parsed)) throw new Error("GitHub contents API returned unexpected JSON.");

    await mkdir(dest, { recursive: true });
    await clearDirContents(dest, hubDataDir());

    let downloaded = 0;
    let failed = 0;

    for (const entry of parsed) {
        if (!isGithubContentFile(entry)) continue;

        try {
            assertSafeRemoteFileName(entry.name);
            const targetPath = join(dest, entry.name);
            assertPathInside(dest, targetPath);

            log.info(`Downloading: ${entry.name}`);
            const data = await downloadBytes(entry.download_url, 120_000);
            validateDownloadPayload(entry.name, data);
            await writeFile(targetPath, data);
            if (platformKey() === "linux" && ["discord_voice.node", "gpu_encoder_helper", "libmediapipe.so"].includes(entry.name)) {
                await chmod(targetPath, 0o755);
            }
            downloaded++;
        } catch (error) {
            failed++;
            log.warn(`Failed: ${isRecord(entry) && typeof entry.name === "string" ? entry.name : "unknown"} (${errorMessage(error)})`);
        }
    }

    if (!downloaded) throw new Error("No files were downloaded from the GitHub folder.");
    if (failed) log.warn(`Downloaded ${downloaded} file(s), ${failed} failed.`);
    else log.ok(`Downloaded ${downloaded} file(s).`);
}

async function findVoiceDirInPayloadDir(payloadRoot: string): Promise<string | undefined> {
    if (await looksLikeDiscordVoiceDir(payloadRoot)) return payloadRoot;

    const nested = join(payloadRoot, "discord_voice");
    if (await looksLikeDiscordVoiceDir(nested)) return nested;

    const found = await findDiscordVoiceDirUnder(payloadRoot);
    return found && isPathInside(payloadRoot, found) ? found : undefined;
}

async function downloadPatchedPayload(log: ActionLog): Promise<string> {
    const staging = join(hubDataDir(), "staging", "patched_payload");
    assertPathInside(hubDataDir(), staging);

    const label = platformLabel(platformKey());
    log.info(`Fetching the latest Discord Audio Collective Method module for ${label} from GitHub.`);
    await downloadGithubFolderToDir(patchedGithubApiForPlatform(), staging, log);

    const payloadVoice = await findVoiceDirInPayloadDir(staging);
    if (!payloadVoice || !await looksLikeDiscordVoiceDir(payloadVoice)) {
        throw new Error("Downloaded payload does not contain a valid discord_voice module.");
    }

    return payloadVoice;
}

async function scheduleWorker(actionName: "Patch" | "Revert", sourceDir: string, target: Target, metaMethod: PatchMethod | undefined, log: ActionLog, copyMode: WorkerConfig["copyMode"] = "directory", fileName: SingleFileName = "discord_voice.node"): Promise<void> {
    assertPathInside(hubDataDir(), sourceDir);
    assertPathInside(target.discordRoot, target.voiceDir);

    const patchBuildLabel = buildLabelFromAppDir(target.appDir || await findDiscordAppDir(target.discordRoot));
    const workerDir = join(hubDataDir(), "worker");
    const usePowershellWorker = platformKey() === "windows";
    const workerExecutable = usePowershellWorker ? powershellPath() : process.execPath;
    const workerScript = join(workerDir, usePowershellWorker ? "stereo-installer-worker.ps1" : "stereo-installer-worker.cjs");
    const launcherScript = join(workerDir, "stereo-installer-launcher.cmd");
    const configPath = join(workerDir, `stereo-installer-${Date.now()}.json`);
    const taskName = usePowershellWorker ? `StereoInstaller-${process.pid}-${Date.now()}` : undefined;
    const config: WorkerConfig = {
        actionName,
        parentPid: process.pid,
        sourceDir,
        targetDir: target.voiceDir,
        copyMode,
        fileName: copyMode === "singleFile" ? fileName : undefined,
        metaPath: metaMethod ? metaPathForRoot(target.discordRoot, metaMethod) : undefined,
        patchClientLabel: clientLabelForRoot(target.discordRoot, patchBuildLabel),
        patchBuildLabel,
        logPath: logPath(),
        logPaths: logPaths(),
        taskName,
        relaunch: {
            platformKey: platformKey(),
            discordRoot: target.discordRoot,
            appDir: target.appDir,
            exeName: target.exeName
        }
    };

    await mkdir(workerDir, { recursive: true });
    await writeFile(workerScript, usePowershellWorker ? POWERSHELL_WORKER_SOURCE : WORKER_SOURCE, "utf8");
    await writeFile(configPath, JSON.stringify(config), "utf8");
    if (usePowershellWorker) {
        await writeFile(launcherScript, windowsLauncherSource(workerExecutable, workerScript, configPath, logPath()), "utf8");
    }

    log.info(`Logging actions to: ${logPath()}`);
    log.info(`Worker executable: ${workerExecutable}`);
    log.info(`Worker config: ${configPath}`);

    if (usePowershellWorker) {
        await startWindowsWorker(launcherScript, taskName || "StereoInstaller", log);
    } else {
        const child = spawn(workerExecutable, [workerScript, configPath], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1"
        }
    });

        child.once("error", (error: Error) => log.fail(`Worker failed to start: ${errorMessage(error)}`));
        child.unref();
    }

    log.info(`Worker started from ${workerScript}.`);
    log.info(`Worker log: ${logPath()}`);
    log.info("Discord exit scheduled so the worker can replace the voice files.");

    setTimeout(() => app.exit(0), 700).unref();
}

async function startWindowsWorker(launcherScript: string, taskName: string, log: ActionLog): Promise<void> {
    const scheduledTime = windowsTaskTime();
    const taskCommand = `${commandProcessorPath()} /d /s /c ""${launcherScript}""`;
    const createTask = await runProcess(schtasksPath(), ["/Create", "/TN", taskName, "/SC", "ONCE", "/ST", scheduledTime, "/TR", taskCommand, "/F", "/RL", "LIMITED"]);

    if (createTask.code === 0) {
        const runTask = await runProcess(schtasksPath(), ["/Run", "/TN", taskName]);
        if (runTask.code === 0) {
            log.info(`Windows Task Scheduler started worker task: ${taskName}`);
            return;
        }

        log.warn(`Task Scheduler run failed: ${runTask.output || `exit ${runTask.code}`}`);
    } else {
        log.warn(`Task Scheduler create failed: ${createTask.output || `exit ${createTask.code}`}`);
    }

    const child = spawn(commandProcessorPath(), ["/d", "/s", "/c", "start", "\"\"", "/min", launcherScript], {
        detached: true,
        stdio: "ignore",
        windowsHide: true
    });

    child.once("error", (error: Error) => log.fail(`Windows launcher failed to start: ${errorMessage(error)}`));
    child.unref();
    log.warn("Falling back to cmd start for the worker launcher.");
}

function runProcess(file: string, args: string[]): Promise<ProcessResult> {
    return new Promise(resolveProcess => {
        let output = "";
        let settled = false;
        const child = spawn(file, args, { windowsHide: true });

        function finish(code: number, text?: string): void {
            if (settled) return;
            settled = true;
            resolveProcess({ code, output: (text || output).trim() });
        }

        child.stdout?.on("data", (chunk: Buffer) => {
            output += chunk.toString("utf8");
        });
        child.stderr?.on("data", (chunk: Buffer) => {
            output += chunk.toString("utf8");
        });
        child.once("error", (error: Error) => finish(-1, errorMessage(error)));
        child.once("close", (code: number | null) => finish(code ?? -1));
    });
}

function windowsTaskTime(): string {
    const date = new Date(Date.now() + 60_000);
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
}

function commandProcessorPath(): string {
    const candidate = join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
    return existsSync(candidate) ? candidate : "cmd.exe";
}

function schtasksPath(): string {
    const candidate = join(process.env.SystemRoot || "C:\\Windows", "System32", "schtasks.exe");
    return existsSync(candidate) ? candidate : "schtasks.exe";
}

function powershellPath(): string {
    const candidate = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    return existsSync(candidate) ? candidate : "powershell.exe";
}

function windowsLauncherSource(powershellExecutable: string, workerScript: string, configPath: string, logPathValue: string): string {
    return `@echo off
setlocal
set "POWERSHELL=${powershellExecutable}"
set "SCRIPT=${workerScript}"
set "CONFIG=${configPath}"
set "LOG=${logPathValue}"
set "BOOTLOG=${logPathValue}.launcher.log"
for %%I in ("%LOG%") do if not exist "%%~dpI" mkdir "%%~dpI" >nul 2>nul
echo [%date% %time%] Launcher started.>> "%LOG%"
"%POWERSHELL%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%SCRIPT%" "%CONFIG%" >> "%BOOTLOG%" 2>>&1
set "EXIT_CODE=%ERRORLEVEL%"
echo [%date% %time%] PowerShell exited with %EXIT_CODE%.>> "%LOG%"
exit /b %EXIT_CODE%
`;
}

const POWERSHELL_WORKER_SOURCE = `
$ErrorActionPreference = "Stop"

function Write-InstallerLog {
    param([string] $Line)

    $paths = @()
    if ($config.logPaths) {
        foreach ($path in $config.logPaths) {
            if ($path) { $paths += [string] $path }
        }
    }
    if ($paths.Count -eq 0 -and $config.logPath) {
        $paths += [string] $config.logPath
    }

    $fullLine = "[{0}] {1}" -f (Get-Date), $Line
    foreach ($path in $paths) {
        try {
            $parent = [System.IO.Path]::GetDirectoryName($path)
            if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
            Add-Content -LiteralPath $path -Value $fullLine -Encoding UTF8
        } catch {}
    }
}

function Wait-ParentProcess {
    for ($i = 0; $i -lt 80; $i++) {
        try {
            $parent = Get-Process -Id ([int] $config.parentPid) -ErrorAction Stop
            if ($null -eq $parent) { return }
            Start-Sleep -Milliseconds 250
        } catch {
            return
        }
    }

    try {
        Stop-Process -Id ([int] $config.parentPid) -Force -ErrorAction SilentlyContinue
    } catch {}
    Start-Sleep -Milliseconds 1200
}

function Stop-DiscordUnderRoot {
    $root = [System.IO.Path]::GetFullPath([string] $config.relaunch.discordRoot).TrimEnd([char[]] @([char] 92, [char] 47))
    $rootPrefix = $root + [System.IO.Path]::DirectorySeparatorChar
    $names = @("Discord.exe", "DiscordCanary.exe", "DiscordPTB.exe", "DiscordDevelopment.exe", "Lightcord.exe", "Vencord.exe", "Equicord.exe", "BetterVencord.exe", "Update.exe")

    try {
        $processes = Get-CimInstance Win32_Process | Where-Object {
            $exePath = $_.ExecutablePath
            if (-not $exePath) { return $false }
            if ($names -notcontains $_.Name) { return $false }

            try {
                $fullExe = [System.IO.Path]::GetFullPath($exePath)
                return $fullExe.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)
            } catch {
                return $false
            }
        }

        foreach ($process in $processes) {
            try {
                Write-InstallerLog ("Stopping process " + $process.Name + " pid=" + $process.ProcessId)
                Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
            } catch {}
        }
    } catch {
        Write-InstallerLog ("WARN: Could not enumerate Discord processes: " + $_.Exception.Message)
    }

    Start-Sleep -Milliseconds 900
}

function Clear-DirContents {
    param([string] $PathValue)

    if (-not $PathValue) { throw "Missing target directory." }
    New-Item -ItemType Directory -Force -Path $PathValue | Out-Null
    Get-ChildItem -LiteralPath $PathValue -Force | ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Recurse -Force
    }
}

function Copy-DirContents {
    param([string] $SourceDir, [string] $TargetDir)

    if (-not $SourceDir -or -not $TargetDir) { throw "Missing source or target directory." }
    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
    Get-ChildItem -LiteralPath $SourceDir -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $TargetDir -Recurse -Force
    }
}

function Copy-SingleFile {
    param([string] $SourceDir, [string] $TargetDir, [string] $FileName)

    if (-not $SourceDir -or -not $TargetDir) { throw "Missing source or target directory." }
    if (-not $FileName) { $FileName = "discord_voice.node" }
    if ($FileName -ne "discord_voice.node" -and $FileName -ne "index.js") {
        throw ("Unsupported file name: " + $FileName)
    }

    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

    $src = Join-Path $SourceDir $FileName
    $dst = Join-Path $TargetDir $FileName
    if (-not (Test-Path -LiteralPath $src -PathType Leaf)) {
        throw ("Source " + $FileName + " was not found: " + $src)
    }

    $beforeSize = 0
    if (Test-Path -LiteralPath $dst -PathType Leaf) {
        $beforeSize = (Get-Item -LiteralPath $dst).Length
    }

    Copy-Item -LiteralPath $src -Destination $dst -Force
    $afterSize = (Get-Item -LiteralPath $dst).Length
    Write-InstallerLog ("Copied " + $src + " -> " + $dst + " (before " + $beforeSize + " bytes, after " + $afterSize + " bytes).")
}

function Start-DiscordAgain {
    $root = [string] $config.relaunch.discordRoot
    $exe = [string] $config.relaunch.exeName
    if (-not $exe) { $exe = "Discord.exe" }

    $updateExe = Join-Path $root "Update.exe"
    if (Test-Path -LiteralPath $updateExe -PathType Leaf) {
        Start-Process -FilePath $updateExe -ArgumentList @("--processStart", $exe) -WorkingDirectory $root -WindowStyle Hidden
        Write-InstallerLog ("Relaunched Discord via Update.exe (" + $exe + ").")
        return
    }

    $appDir = [string] $config.relaunch.appDir
    if ($appDir) {
        $exePath = Join-Path $appDir $exe
        if (Test-Path -LiteralPath $exePath -PathType Leaf) {
            Start-Process -FilePath $exePath -WorkingDirectory $appDir -WindowStyle Hidden
            Write-InstallerLog ("Relaunched Discord directly (" + $exe + ").")
            return
        }
    }

    Write-InstallerLog "WARN: Could not relaunch Discord automatically. Please start it manually."
}

$configPath = $args[0]
try {
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    Write-InstallerLog ("PowerShell worker started. pid=" + $PID)
    Write-InstallerLog ("Config path: " + $configPath)
    Write-InstallerLog ("Source dir: " + $config.sourceDir)
    Write-InstallerLog ("Target dir: " + $config.targetDir)
    Write-InstallerLog ("Copy mode: " + $config.copyMode)
    if ($config.fileName) { Write-InstallerLog ("File name: " + $config.fileName) }
    Write-InstallerLog ($config.actionName + ": waiting for Discord to close.")
    Wait-ParentProcess
    Write-InstallerLog ($config.actionName + ": wait finished.")
    Stop-DiscordUnderRoot
    Write-InstallerLog ($config.actionName + ": installing files.")

    if ($config.copyMode -eq "singleFile") {
        Copy-SingleFile -SourceDir ([string] $config.sourceDir) -TargetDir ([string] $config.targetDir) -FileName ([string] $config.fileName)
    } else {
        Clear-DirContents -PathValue ([string] $config.targetDir)
        Write-InstallerLog "Cleared target directory."
        Copy-DirContents -SourceDir ([string] $config.sourceDir) -TargetDir ([string] $config.targetDir)
        Write-InstallerLog "Copied directory contents."
    }

    if ($config.metaPath) {
        $metaParent = [System.IO.Path]::GetDirectoryName([string] $config.metaPath)
        if ($metaParent) { New-Item -ItemType Directory -Force -Path $metaParent | Out-Null }
        $meta = [ordered]@{ last_patch_utc = (Get-Date).ToUniversalTime().ToString("o") }
        if ($config.patchClientLabel) { $meta.client_label = [string] $config.patchClientLabel }
        if ($config.patchBuildLabel) { $meta.build_label = [string] $config.patchBuildLabel }
        $meta | ConvertTo-Json | Set-Content -LiteralPath ([string] $config.metaPath) -Encoding UTF8
        Write-InstallerLog ("Wrote metadata: " + $config.metaPath)
    }

    Write-InstallerLog ("OK: " + $config.actionName + " complete.")
    Start-DiscordAgain
} catch {
    Write-InstallerLog ("FAIL: " + $_.Exception.Message)
    Write-InstallerLog ([string] $_.ScriptStackTrace)
} finally {
    if ($config.taskName) {
        try {
            schtasks.exe /Delete /TN ([string] $config.taskName) /F | Out-Null
            Write-InstallerLog ("Deleted scheduled task: " + $config.taskName)
        } catch {
            Write-InstallerLog ("WARN: Could not delete scheduled task: " + $_.Exception.Message)
        }
    }

    try {
        Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
    } catch {}
}
`;

const WORKER_SOURCE = `
"use strict";
const fs = require("fs/promises");
const { existsSync } = require("fs");
const { spawn } = require("child_process");
const { dirname, join } = require("path");
const { setTimeout: sleep } = require("timers/promises");

async function appendLog(config, line) {
    const paths = Array.isArray(config.logPaths) && config.logPaths.length ? config.logPaths : [config.logPath];
    const fullLine = "[" + new Date().toLocaleString() + "] " + line + "\\n";
    for (const pathValue of paths) {
        try {
            await fs.mkdir(dirname(pathValue), { recursive: true });
            await fs.appendFile(pathValue, fullLine, "utf8");
        } catch {}
    }
}

async function waitForParent(config) {
    for (let i = 0; i < 80; i++) {
        try {
            process.kill(config.parentPid, 0);
            await sleep(250);
        } catch {
            return;
        }
    }

    try {
        process.kill(config.parentPid);
    } catch {}

    await sleep(1200);
}

async function clearDirContents(pathValue) {
    if (!pathValue) throw new Error("Missing target directory.");
    await fs.mkdir(pathValue, { recursive: true });
    const entries = await fs.readdir(pathValue, { withFileTypes: true });
    for (const entry of entries) {
        await fs.rm(join(pathValue, entry.name), { recursive: true, force: true });
    }
}

async function copyDirContents(srcDir, dstDir) {
    if (!srcDir || !dstDir) throw new Error("Missing source or target directory.");
    await fs.mkdir(dstDir, { recursive: true });
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        const src = join(srcDir, entry.name);
        const dst = join(dstDir, entry.name);
        if (entry.isDirectory()) await fs.cp(src, dst, { recursive: true });
        else await fs.copyFile(src, dst);
    }
}

function singleFileName(config) {
    const fileName = config.fileName || "discord_voice.node";
    if (fileName !== "discord_voice.node" && fileName !== "index.js") throw new Error("Unsupported file name: " + fileName);

    return fileName;
}

async function copySingleFile(srcDir, dstDir, fileName) {
    if (!srcDir || !dstDir) throw new Error("Missing source or target directory.");
    await fs.mkdir(dstDir, { recursive: true });
    const src = join(srcDir, fileName);
    const dst = join(dstDir, fileName);
    const before = existsSync(dst) ? await fs.stat(dst) : null;
    await fs.copyFile(src, dst);
    const after = await fs.stat(dst);
    return {
        src,
        dst,
        beforeSize: before ? before.size : 0,
        afterSize: after.size
    };
}

function spawnDetached(file, args, cwd) {
    const child = spawn(file, args, {
        cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: true
    });
    child.once("error", error => {
        void error;
    });
    child.unref();
}

function linuxRelaunchCommands(relaunchConfig) {
    const root = String(relaunchConfig.discordRoot || "").toLowerCase();
    const commands = [];

    if (root.includes(".var/app/com.discordapp.discord")) commands.push(["flatpak", "run", "com.discordapp.Discord"]);
    if (root.includes("/snap/discord/")) commands.push(["snap", "run", "discord"]);
    if (relaunchConfig.exeName) commands.push([relaunchConfig.exeName]);
    if (root.includes("discordcanary")) commands.push(["discord-canary"], ["DiscordCanary"]);
    if (root.includes("discordptb")) commands.push(["discord-ptb"], ["DiscordPTB"]);
    if (root.includes("discorddevelopment")) commands.push(["discord-development"], ["DiscordDevelopment"]);

    commands.push(["discord"], ["Discord"], ["flatpak", "run", "com.discordapp.Discord"], ["snap", "run", "discord"]);
    return commands;
}

function relaunch(config) {
    const relaunchConfig = config.relaunch;
    if (relaunchConfig.platformKey === "windows") {
        const exe = relaunchConfig.exeName || "Discord.exe";
        const updater = join(relaunchConfig.discordRoot, "Update.exe");
        if (existsSync(updater)) {
            spawnDetached(updater, ["--processStart", exe], relaunchConfig.discordRoot);
            return "Relaunched Discord via Update.exe.";
        }

        if (relaunchConfig.appDir) {
            const exePath = join(relaunchConfig.appDir, exe);
            if (existsSync(exePath)) {
                spawnDetached(exePath, [], relaunchConfig.appDir);
                return "Relaunched Discord directly.";
            }
        }

        return "Could not relaunch Discord automatically. Please start it manually.";
    }

    if (relaunchConfig.platformKey === "macos") {
        spawnDetached("open", ["-a", "Discord"]);
        return "Relaunched Discord with open.";
    }

    if (relaunchConfig.platformKey === "linux") {
        for (const cmd of linuxRelaunchCommands(relaunchConfig)) {
            try {
                spawnDetached(cmd[0], cmd.slice(1));
                return "Relaunched Discord.";
            } catch {}
        }
    }

    return "Could not relaunch Discord automatically. Please start it manually.";
}

async function main() {
    const configPath = process.argv[2];
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));

    try {
        await appendLog(config, "Worker started. pid=" + process.pid + " execPath=" + process.execPath);
        await appendLog(config, "Config path: " + configPath);
        await appendLog(config, "Source dir: " + config.sourceDir);
        await appendLog(config, "Target dir: " + config.targetDir);
        await appendLog(config, "Copy mode: " + config.copyMode);
        if (config.fileName) await appendLog(config, "File name: " + config.fileName);
        await appendLog(config, config.actionName + ": waiting for Discord to close.");
        await waitForParent(config);
        await appendLog(config, config.actionName + ": wait finished.");
        await appendLog(config, config.actionName + ": installing files.");
        if (config.copyMode === "singleFile") {
            const result = await copySingleFile(config.sourceDir, config.targetDir, singleFileName(config));
            await appendLog(config, "Copied " + result.src + " -> " + result.dst + " (before " + result.beforeSize + " bytes, after " + result.afterSize + " bytes).");
        } else {
            await clearDirContents(config.targetDir);
            await appendLog(config, "Cleared target directory.");
            await copyDirContents(config.sourceDir, config.targetDir);
            await appendLog(config, "Copied directory contents.");
        }

        if (config.metaPath) {
            await fs.mkdir(dirname(config.metaPath), { recursive: true });
            const meta = { last_patch_utc: new Date().toISOString() };
            if (config.patchClientLabel) meta.client_label = config.patchClientLabel;
            if (config.patchBuildLabel) meta.build_label = config.patchBuildLabel;
            await fs.writeFile(config.metaPath, JSON.stringify(meta, null, 2), "utf8");
            await appendLog(config, "Wrote metadata: " + config.metaPath);
        }

        await appendLog(config, "OK: " + config.actionName + " complete.");
        await appendLog(config, relaunch(config));
    } catch (error) {
        await appendLog(config, "FAIL: " + (error && error.message ? error.message : String(error)));
        if (error && error.stack) await appendLog(config, String(error.stack));
    } finally {
        try {
            await fs.rm(configPath, { force: true });
        } catch {}
    }
}

main();
`;
