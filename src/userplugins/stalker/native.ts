/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { DATA_DIR } from "@main/utils/constants";

const STALKER_DATA_DIR = path.join(DATA_DIR, "Stalking");

const sanitizeUsername = (username: string): string =>
    username.replace(/[/\\?*|<>:"']/g, "_");

const getTodayFileName = (): string =>
    `stalker-log-${new Date().toISOString().slice(0, 10)}.json`;

async function getUserStalkerDirPath(userId: string, username: string): Promise<string> {
    const safeUsername = sanitizeUsername(username);
    return path.join(STALKER_DATA_DIR, `@${safeUsername}_${userId}`);
}

export async function getUserStalkerDir(_event: Electron.IpcMainInvokeEvent, userId: string, username: string): Promise<string> {
    const userDir = await getUserStalkerDirPath(userId, username);
    await mkdir(userDir, { recursive: true });
    return userDir;
}

export async function writeStalkerLog(_event: Electron.IpcMainInvokeEvent, contents: string, userId: string, username: string): Promise<void> {
    const userDir = await getUserStalkerDir(_event, userId, username);
    const filePath = path.join(userDir, getTodayFileName());
    await writeFile(filePath, contents, "utf8");
}

export async function readStalkerLog(_event: Electron.IpcMainInvokeEvent, userId: string, username: string): Promise<string> {
    const userDir = await getUserStalkerDirPath(userId, username);
    const filePath = path.join(userDir, getTodayFileName());

    try {
        return await readFile(filePath, "utf8");
    } catch {
        // File non ancora esistente per oggi, restituisce array vuoto
        return "[]";
    }
}

export async function getStalkerDataDir(_event: Electron.IpcMainInvokeEvent): Promise<string> {
    return STALKER_DATA_DIR;
}
