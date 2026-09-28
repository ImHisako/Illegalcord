/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isTrustedSender } from "@illegalcordplugins/DiscordHardened/nativeSecurity";
import { createHash } from "crypto";
import { app, BrowserWindow, type IpcMainInvokeEvent, nativeImage, session } from "electron";
import illegalcordIcon from "file://../../../browser/Illegalcord.png?base64";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";

import { linuxOriginalIcon, updateLinuxShortcuts } from "./linux";
import { updateShortcuts } from "./shortcuts";

export type IconMode = "illegalcord" | "custom" | "original";
export type IconResult = { success: true; preview: string; client: string; changed: number; failed: number; } | { success: false; error: string; };

let pending: Promise<IconResult> = Promise.resolve({ success: false, error: "No icon has been applied." });

function isMode(value: unknown): value is IconMode {
    return value === "illegalcord" || value === "custom" || value === "original";
}

function dataDirectory() {
    const directory = dirname(process.execPath);
    const installation = /^app-\d[\w.-]*$/i.test(basename(directory)) ? dirname(directory) : directory;
    const identity = process.platform === "linux" ? process.env.APPIMAGE || process.execPath : installation.toLowerCase();
    const key = createHash("sha256").update(identity).digest("hex").slice(0, 16);
    return join(app.getPath("userData"), "illegalcord-client-icon", key);
}

function decodePng(data: Buffer) {
    if (data.length < 33 || data.length > 2 * 1024 * 1024 || data.toString("hex", 0, 8) !== "89504e470d0a1a0a"
        || data.readUInt32BE(8) !== 13 || data.toString("ascii", 12, 16) !== "IHDR") return null;
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);
    if (!width || !height || width > 4096 || height > 4096) return null;
    const image = nativeImage.createFromBuffer(data);
    return image.isEmpty() ? null : image.resize({ width: 256, height: 256 });
}

async function loadIcon(mode: IconMode) {
    if (mode === "original") {
        if (process.platform === "linux") {
            const image = linuxOriginalIcon(join(dataDirectory(), "shortcuts"));
            if (image) return image;
        }
        return app.getFileIcon(process.execPath, { size: "large" });
    }
    if (mode === "illegalcord") return decodePng(Buffer.from(illegalcordIcon, "base64"));
    return decodePng(readFileSync(join(dataDirectory(), "custom.png")));
}

function toIco(png: Buffer) {
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(png.length, 14);
    header.writeUInt32LE(header.length, 18);
    return Buffer.concat([header, png]);
}

export async function preview(event: IpcMainInvokeEvent, mode: unknown): Promise<IconResult> {
    if (!isTrustedSender(event)) return { success: false, error: "Open the icon settings from the Discord client." };
    if (process.platform !== "win32" && process.platform !== "linux") return { success: false, error: "ClientIcon supports Windows and Linux." };
    if (!isMode(mode)) return { success: false, error: "Choose a supported icon." };
    try {
        const image = await loadIcon(mode);
        if (!image || image.isEmpty()) return { success: false, error: "Choose a valid PNG image up to 2 MB and 4096 pixels per side." };
        return { success: true, preview: image.toDataURL(), client: basename(process.execPath, ".exe"), changed: 0, failed: 0 };
    } catch {
        return { success: false, error: "The saved icon could not be loaded. Choose an image again or use the Illegalcord icon." };
    }
}

export function configure(event: IpcMainInvokeEvent, mode: unknown, shortcuts: unknown, data?: unknown): Promise<IconResult> {
    if (!isTrustedSender(event)) return Promise.resolve({ success: false, error: "Open the icon settings from the Discord client." });
    if (process.platform !== "win32" && process.platform !== "linux") return Promise.resolve({ success: false, error: "ClientIcon supports Windows and Linux." });
    if (!isMode(mode) || typeof shortcuts !== "boolean" || (data !== undefined && (mode !== "custom" || typeof data !== "string" || data.length > 2_800_000)))
        return Promise.resolve({ success: false, error: "Invalid icon settings." });

    pending = pending.then(async (): Promise<IconResult> => {
        try {
            if (!isTrustedSender(event)) return { success: false, error: "The client page is no longer available." };
            const window = BrowserWindow.fromWebContents(event.sender);
            if (!window || window.isDestroyed()) return { success: false, error: "The client window is no longer available." };

            const directory = dataDirectory();
            let image;
            if (typeof data === "string") {
                if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) return { success: false, error: "Choose a PNG image." };
                image = decodePng(Buffer.from(data.slice("data:image/png;base64,".length), "base64"));
            } else image = await loadIcon(mode);
            if (!image || image.isEmpty()) return { success: false, error: "Choose a valid PNG image up to 2 MB and 4096 pixels per side." };
            if (window.isDestroyed()) return { success: false, error: "The client window is no longer available." };

            const linux = process.platform === "linux";
            const png = image.toPNG();
            const iconPath = join(directory, linux ? "active.png" : `icon-${createHash("sha256").update(png).digest("hex")}.ico`);
            if (mode !== "original") {
                mkdirSync(directory, { recursive: true });
                if (typeof data === "string") writeFileSync(join(directory, "custom.png"), png);
                writeFileSync(iconPath, linux ? png : toIco(png));
            }
            const backupDir = join(directory, "shortcuts");
            const restore = mode === "original" || !shortcuts;
            const result: { changed: number; failed: number; appId?: string; } = linux
                ? updateLinuxShortcuts(iconPath, backupDir, restore)
                : updateShortcuts(iconPath, backupDir, restore);
            if (!linux) {
                const client = basename(process.execPath, ".exe");
                const appId = result.appId
                    || (/^Discord(?:Canary|PTB|Development)?$/.test(client)
                        ? process.argv.includes("--localdev") ? process.execPath : `com.squirrel.${client}.${client}`
                        : undefined);
                window.setAppDetails({
                    ...(window.webContents.session === session.defaultSession && appId ? { appId } : {}),
                    appIconPath: mode === "original" ? process.execPath : iconPath,
                    appIconIndex: 0
                });
            }
            window.setIcon(image);
            const { changed, failed } = result;
            return { success: true, preview: image.toDataURL(), client: basename(process.execPath, ".exe"), changed, failed };
        } catch {
            return { success: false, error: "The icon could not be applied. Check that your client data folder is writable, then try again." };
        }
    });
    return pending;
}
