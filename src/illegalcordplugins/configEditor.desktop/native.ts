/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isTrustedSender } from "@illegalcordplugins/DiscordHardened/nativeSecurity";
import { RendererSettings } from "@main/settings";
import { DATA_DIR, SETTINGS_FILE } from "@main/utils/constants";
import { randomUUID } from "crypto";
import type { IpcMainInvokeEvent } from "electron";
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { join, normalize, sep } from "path";

import { type Backup, type BackupInfo, isConfig, isRecord, MAX_CONFIG_SIZE, parseConfig } from "./config";

const backupRoot = normalize(join(DATA_DIR, "ConfigBackups"));
const denied = { success: false, error: "This window cannot access configuration backups." } as const;

function ensureDirectory() {
    mkdirSync(backupRoot, { recursive: true });
    const stat = lstatSync(backupRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid backup directory.");
}

function backupPath(id: unknown): string {
    if (typeof id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) throw new Error("Invalid backup identifier.");
    const path = normalize(join(backupRoot, `${id}.json`));
    if (!path.startsWith(backupRoot + sep)) throw new Error("Invalid backup location.");
    return path;
}

function readBackup(id: unknown): Backup {
    if (typeof id !== "string") throw new Error("Invalid backup identifier.");
    const path = backupPath(id);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CONFIG_SIZE + 4096) throw new Error("Invalid backup file.");
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(value) || value.version !== 1 || value.id !== id || typeof value.name !== "string" || value.name.length > 80
        || typeof value.author !== "string" || value.author.length > 100 || typeof value.createdAt !== "string"
        || !Number.isFinite(Date.parse(value.createdAt)) || !isConfig(value.settings)) throw new Error("Invalid backup contents.");
    return { version: 1, id, name: value.name, author: value.author, createdAt: value.createdAt, settings: value.settings };
}

export function listBackups(event: IpcMainInvokeEvent) {
    if (!isTrustedSender(event)) return denied;
    try {
        ensureDirectory();
        const backups: BackupInfo[] = [];
        let unreadable = 0;
        for (const entry of readdirSync(backupRoot, { withFileTypes: true })) {
            if (!entry.name.endsWith(".json")) continue;
            try {
                const { id, name, author, createdAt } = readBackup(entry.name.slice(0, -5));
                backups.push({ id, name, author, createdAt });
            } catch {
                unreadable++;
            }
        }
        backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return { success: true, backups, unreadable, directory: backupRoot } as const;
    } catch {
        return { success: false, error: "Could not open ConfigBackups. Check the data directory permissions." } as const;
    }
}

export function createBackup(event: IpcMainInvokeEvent, name: unknown, author: unknown) {
    if (!isTrustedSender(event)) return denied;
    if (typeof name !== "string" || !name.trim() || name.length > 80 || /[\u0000-\u001f]/.test(name)
        || typeof author !== "string" || !author.trim() || author.length > 100 || /[\u0000-\u001f]/.test(author)) {
        return { success: false, error: "Enter a name of up to 80 characters and an author of up to 100 characters." } as const;
    }
    try {
        ensureDirectory();
        const backup: Backup = {
            version: 1,
            id: randomUUID(),
            name: name.trim(),
            author: author.trim(),
            createdAt: new Date().toISOString(),
            settings: parseConfig(JSON.stringify(RendererSettings.plain))
        };
        const text = JSON.stringify(backup, null, 4);
        if (Buffer.byteLength(text) > MAX_CONFIG_SIZE + 4096) throw new Error("The backup is too large.");
        writeFileSync(backupPath(backup.id), text, { flag: "wx", mode: 0o600 });
        const { settings, version, ...info } = backup;
        return { success: true, backup: info } as const;
    } catch {
        return { success: false, error: "Could not create the configuration backup." } as const;
    }
}

export function loadBackup(event: IpcMainInvokeEvent, id: unknown) {
    if (!isTrustedSender(event)) return denied;
    try {
        ensureDirectory();
        const backup = readBackup(id);
        return { success: true, backup } as const;
    } catch {
        return { success: false, error: "This backup is missing, unreadable or invalid." } as const;
    }
}

export function flushSettings(event: IpcMainInvokeEvent) {
    if (!isTrustedSender(event)) return denied;
    const temporaryFile = `${SETTINGS_FILE}.${randomUUID()}.tmp`;
    let created = false;
    try {
        const text = JSON.stringify(RendererSettings.plain, null, 4);
        parseConfig(text);
        writeFileSync(temporaryFile, text, { flag: "wx", mode: 0o600 });
        created = true;
        renameSync(temporaryFile, SETTINGS_FILE);
        created = false;
        return { success: true } as const;
    } catch {
        if (created) {
            try {
                unlinkSync(temporaryFile);
            } catch {
                return { success: false, error: "Could not save settings.json or remove its temporary file." } as const;
            }
        }
        return { success: false, error: "Could not save settings.json. Your recovery backup is still available." } as const;
    }
}
