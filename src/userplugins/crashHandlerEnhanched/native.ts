/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DATA_DIR } from "@main/utils/constants";
import { shell } from "electron";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const CRASH_LOG_DIR = path.join(DATA_DIR, "CrashLogs");

function sanitizeFilePart(value: string) {
    return value.replace(/[/\\?*|<>:"']/g, "_");
}

export async function getCrashLogDir(_event: Electron.IpcMainInvokeEvent): Promise<string> {
    await mkdir(CRASH_LOG_DIR, { recursive: true });
    return CRASH_LOG_DIR;
}

export async function openCrashLogDir(_event: Electron.IpcMainInvokeEvent): Promise<string> {
    await mkdir(CRASH_LOG_DIR, { recursive: true });
    return shell.openPath(CRASH_LOG_DIR);
}

export async function writeCrashLog(_event: Electron.IpcMainInvokeEvent, contents: string, crashId: string): Promise<string> {
    await mkdir(CRASH_LOG_DIR, { recursive: true });

    const filePath = path.join(CRASH_LOG_DIR, `crash-${sanitizeFilePart(crashId)}.json`);
    await writeFile(filePath, contents, "utf8");
    return filePath;
}
