/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { DATA_DIR } from "@main/utils/constants";

export async function getDefaultStalkerDataDir(): Promise<string> {
    return path.join(DATA_DIR, "Stalking");
}

import { readFile } from "fs/promises";

export async function getUserStalkerDir(_event: Electron.IpcMainInvokeEvent, userId: string, username: string): Promise<string> {
    const logsDir = await getDefaultStalkerDataDir();
    // Sanitize the username to remove invalid characters for file names
    const safeUsername = username.replace(/[/\\?*|<>:"']/g, "_");
    const userDir = path.join(logsDir, `@${safeUsername}_${userId}`);
    await mkdir(userDir, { recursive: true });
    return userDir;
}

export async function writeStalkerLog(_event: Electron.IpcMainInvokeEvent, contents: string, userId: string, username: string) {
    const userDir = await getUserStalkerDir(_event, userId, username);

    const fileName = `stalker-log-${new Date().toISOString().slice(0, 10)}.json`;
    const filePath = path.join(userDir, fileName);

    await writeFile(filePath, contents, "utf8");
}

export async function readStalkerLog(_event: Electron.IpcMainInvokeEvent, userId: string, username: string): Promise<string> {
    const userDir = await getUserStalkerDir(_event, userId, username);

    const fileName = `stalker-log-${new Date().toISOString().slice(0, 10)}.json`;
    const filePath = path.join(userDir, fileName);

    try {
        return await readFile(filePath, "utf8");
    } catch (error) {
        // Se il file non esiste, restituisci un array JSON vuoto
        return "[]";
    }
}

export async function getStalkerDataDir(_event: Electron.IpcMainInvokeEvent): Promise<string> {
    return await getDefaultStalkerDataDir();
}
