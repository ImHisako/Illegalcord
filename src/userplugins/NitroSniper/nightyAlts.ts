/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron";
import { type FSWatcher, watch } from "fs";
import { open } from "fs/promises";
import { resolve, sep } from "path";

const GIFT_LOG_REGEX = /\[GIFT DETECTED\].{0,500}?\| Code: ([a-zA-Z0-9]{16,24}) \|/;
const MAX_READ_BYTES = 1024 * 1024;

let watcher: FSWatcher | undefined;
let logPath = "";
let logOffset = 0;
let pendingText = "";
let reading = false;
let readAgain = false;
const giftQueue: string[] = [];
const seenCodes = new Set<string>();
const waiters: Array<(code: string | null) => void> = [];

function enqueueGift(code: string) {
    if (seenCodes.has(code)) return;
    seenCodes.add(code);

    const waiter = waiters.shift();
    if (waiter) waiter(code);
    else giftQueue.push(code);
}

async function readNewLogEntries() {
    if (reading) {
        readAgain = true;
        return;
    }

    reading = true;
    try {
        const file = await open(logPath, "r");
        try {
            const { size } = await file.stat();
            if (size < logOffset) {
                logOffset = 0;
                pendingText = "";
            }
            if (size === logOffset) return;

            const length = Math.min(size - logOffset, MAX_READ_BYTES);
            const position = size - length;
            if (position > logOffset) pendingText = "";

            const buffer = Buffer.alloc(length);
            const { bytesRead } = await file.read(buffer, 0, length, position);
            logOffset = size;
            pendingText += buffer.toString("utf8", 0, bytesRead);

            const lines = pendingText.split(/\r?\n/);
            pendingText = lines.pop() ?? "";
            for (const line of lines) {
                const code = line.match(GIFT_LOG_REGEX)?.[1];
                if (code) enqueueGift(code);
            }
        } finally {
            await file.close();
        }
    } catch {
        logOffset = 0;
        pendingText = "";
    } finally {
        reading = false;
        if (readAgain) {
            readAgain = false;
            void readNewLogEntries();
        }
    }
}

function handleLogChange() {
    void readNewLogEntries();
}

function stopWatcher() {
    watcher?.close();
    watcher = undefined;
    logPath = "";
    logOffset = 0;
    pendingText = "";
    reading = false;
    readAgain = false;
    giftQueue.length = 0;
    seenCodes.clear();
    for (const waiter of waiters.splice(0)) waiter(null);
}

export async function startNightyAltDetection(_: IpcMainInvokeEvent): Promise<string | null> {
    stopWatcher();

    const appData = process.env.APPDATA;
    if (!appData) return "Nighty's data folder could not be found.";

    const logsRoot = resolve(appData, "Nighty Selfbot", "data", "scripts", "logs");
    logPath = resolve(logsRoot, "nitro_sniper.log");
    if (!logPath.startsWith(`${logsRoot}${sep}`)) return "Nighty's Nitro Sniper log path is invalid.";

    try {
        const file = await open(logPath, "r");
        try {
            logOffset = (await file.stat()).size;
        } finally {
            await file.close();
        }

        watcher = watch(logPath, handleLogChange);
        watcher.once("error", stopWatcher);
        return null;
    } catch {
        stopWatcher();
        return "Nighty's Nitro Sniper log could not be opened.";
    }
}

export function waitForNightyGiftCode(_: IpcMainInvokeEvent): Promise<string | null> {
    const code = giftQueue.shift();
    if (code) return Promise.resolve(code);
    if (!watcher) return Promise.resolve(null);

    return new Promise(resolve => waiters.push(resolve));
}

export function stopNightyAltDetection(_: IpcMainInvokeEvent) {
    stopWatcher();
}
