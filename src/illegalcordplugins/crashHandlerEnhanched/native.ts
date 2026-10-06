/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DATA_DIR } from "@main/utils/constants";
import { app, session, shell } from "electron";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const CRASH_LOG_DIR = path.join(DATA_DIR, "CrashLogs");
const MAX_CRASH_LOG_SIZE = 2 * 1024 * 1024;
const CRASH_ID_RE = /^\d{13}-[1-9]\d{0,9}$/;
const CLIENT_NAMES = new Set(["discord", "discordcanary", "discordptb", "discord-canary", "discord-ptb"]);

export type WriteCrashLogResult =
    | { success: true; filePath: string; }
    | { success: false; error: string; };

export async function clearClientCache(_event: Electron.IpcMainInvokeEvent): Promise<{ success: true; client: string; failed: string[]; } | { success: false; error: string; }> {
    if (process.platform !== "win32" && process.platform !== "linux") return { success: false, error: "Cache cleanup is available on Windows and Linux." };

    const userData = path.normalize(app.getPath("userData"));
    const client = path.basename(userData);
    if (!CLIENT_NAMES.has(client.toLowerCase())) return { success: false, error: "Could not identify the current Discord client." };

    const failed: string[] = [];
    try {
        await session.defaultSession.clearCache();
    } catch {
        failed.push("browser cache");
    }
    try {
        await session.defaultSession.clearCodeCaches({});
    } catch {
        failed.push("code cache");
    }
    try {
        await session.defaultSession.clearStorageData({ storages: ["cachestorage", "shadercache"] });
    } catch {
        failed.push("stored cache");
    }

    return { success: true, client, failed };
}

export async function getCrashLogDir(_event: Electron.IpcMainInvokeEvent): Promise<string> {
    await mkdir(CRASH_LOG_DIR, { recursive: true });
    return CRASH_LOG_DIR;
}

export async function openCrashLogDir(_event: Electron.IpcMainInvokeEvent): Promise<string> {
    await mkdir(CRASH_LOG_DIR, { recursive: true });
    return shell.openPath(CRASH_LOG_DIR);
}

export async function openProcessCrashDir(_event: Electron.IpcMainInvokeEvent): Promise<string> {
    try {
        const crashDir = app.getPath("crashDumps");
        await mkdir(crashDir, { recursive: true });
        return await shell.openPath(crashDir) ? "Could not open the process crash dumps folder." : "";
    } catch {
        return "Could not open the process crash dumps folder.";
    }
}

export async function writeCrashLog(_event: Electron.IpcMainInvokeEvent, contents: unknown, crashId: unknown): Promise<WriteCrashLogResult> {
    if (typeof contents !== "string") return { success: false, error: "Crash log contents must be a string." };
    if (Buffer.byteLength(contents, "utf8") > MAX_CRASH_LOG_SIZE) return { success: false, error: "Crash log is too large." };
    if (typeof crashId !== "string" || !CRASH_ID_RE.test(crashId)) return { success: false, error: "Crash identifier is invalid." };

    try {
        JSON.parse(contents);
    } catch {
        return { success: false, error: "Crash log contents are not valid JSON." };
    }

    try {
        await mkdir(CRASH_LOG_DIR, { recursive: true });

        const filePath = path.join(CRASH_LOG_DIR, `crash-${crashId}.json`);
        await writeFile(filePath, contents, "utf8");
        return { success: true, filePath };
    } catch {
        return { success: false, error: "Could not save the crash log." };
    }
}
