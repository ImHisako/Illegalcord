/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DATA_DIR } from "@main/utils/constants";
import { shell } from "electron";
import { constants } from "fs";
import { mkdir, open, readFile, writeFile } from "fs/promises";
import path from "path";

const STALKER_DATA_DIR = path.resolve(DATA_DIR, "Stalking");

type LogWriteResult = { success: true; } | { success: false; error: string; };
const appendLocks = new Map<string, Promise<LogWriteResult>>();

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

export async function appendStalkerLog(_event: Electron.IpcMainInvokeEvent, contents: unknown, userId: unknown, username: unknown): Promise<LogWriteResult> {
    if (typeof contents !== "string" || contents.length > 1024 * 1024
        || typeof userId !== "string" || !/^[0-9]{1,20}$/.test(userId)
        || typeof username !== "string" || !username.length || username.length > 128 || username.includes("\0")) {
        return { success: false, error: "Invalid log entry." };
    }
    try {
        const entry: unknown = JSON.parse(contents);
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)
            || !("userId" in entry) || entry.userId !== userId
            || !("username" in entry) || entry.username !== username
            || !("timestamp" in entry) || typeof entry.timestamp !== "string"
            || !("action" in entry) || typeof entry.action !== "string"
            || !("details" in entry) || typeof entry.details !== "string") {
            return { success: false, error: "Invalid log entry." };
        }
    } catch {
        return { success: false, error: "Invalid log entry." };
    }
    const userDir = path.resolve(STALKER_DATA_DIR, `@${sanitizeUsername(username)}_${userId}`);
    if (!userDir.startsWith(STALKER_DATA_DIR + path.sep)) return { success: false, error: "Invalid log location." };
    const filePath = path.join(userDir, getTodayFileName());
    const previous = appendLocks.get(userId) ?? Promise.resolve();
    const write = previous.then(async (): Promise<LogWriteResult> => {
        try {
            await mkdir(userDir, { recursive: true });
            const file = await open(filePath, constants.O_RDWR | constants.O_CREAT);
            try {
                const { size } = await file.stat();
                let position = 0;
                let prefix = "[";
                if (size) {
                    const head = Buffer.alloc(Math.min(size, 64));
                    const tail = Buffer.alloc(Math.min(size, 64));
                    await Promise.all([
                        file.read(head, 0, head.length, 0),
                        file.read(tail, 0, tail.length, size - tail.length)
                    ]);
                    const first = head.toString("utf8").trimStart();
                    const firstValue = first.slice(1).trimStart()[0];
                    let end = tail.length - 1;
                    while (end >= 0 && (tail[end] === 32 || tail[end] === 9 || tail[end] === 10 || tail[end] === 13)) end--;
                    if (first[0] !== "[" || !firstValue || tail[end] !== 93) {
                        return { success: false, error: "The existing log is invalid and was left unchanged." };
                    }
                    position = size - tail.length + end;
                    prefix = firstValue === "]" ? "" : ",";
                }
                const data = Buffer.from(`${prefix}\n${contents}\n]`, "utf8");
                let written = 0;
                while (written < data.length) {
                    const { bytesWritten } = await file.write(data, written, data.length - written, position + written);
                    written += bytesWritten;
                }
                await file.truncate(position + data.length);
                return { success: true };
            } finally {
                await file.close();
            }
        } catch {
            return { success: false, error: "Could not append the log entry." };
        }
    });
    appendLocks.set(userId, write);
    const result = await write;
    if (appendLocks.get(userId) === write) appendLocks.delete(userId);
    return result;
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

export async function openStalkerDataDir(_event: Electron.IpcMainInvokeEvent): Promise<string> {
    await mkdir(STALKER_DATA_DIR, { recursive: true });
    return shell.openPath(STALKER_DATA_DIR);
}
