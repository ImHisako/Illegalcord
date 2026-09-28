/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { createHash } from "crypto";
import { app, nativeImage } from "electron";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, normalize, sep } from "path";

const logger = new Logger("ClientIcon");

function dataRoots() {
    const home = process.env.XDG_DATA_HOME;
    return [
        home && isAbsolute(home) ? home : join(app.getPath("home"), ".local", "share"),
        ...(process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(isAbsolute)
    ];
}

function entry(text: string) {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((line: string) => line.trim() === "[Desktop Entry]");
    const next = lines.findIndex((line: string, index: number) => index > start && line.startsWith("["));
    const end = next === -1 ? lines.length : next;
    const get = (key: string) => start === -1 ? undefined : lines.slice(start + 1, end).find((line: string) => line.startsWith(key + "="))?.slice(key.length + 1);
    return { lines, start, end, get };
}

function unescapeValue(value: string) {
    const escapes: Record<string, string> = { s: " ", n: "\n", r: "\r", t: "\t", "\\": "\\" };
    return value.replace(/\\([snrt\\])/g, (_match: string, char: string) => escapes[char]);
}

function sameFile(first: string, second: string) {
    return isAbsolute(first) && isAbsolute(second) && existsSync(first) && existsSync(second)
        && realpathSync(first) === realpathSync(second);
}

function isCurrentClient(text: string, source: string) {
    const { get } = entry(text);
    if (get("Type") !== "Application") return false;
    const launched = process.env.GIO_LAUNCHED_DESKTOP_FILE;
    if (launched && sameFile(source, launched)) return true;
    if (process.env.FLATPAK_ID && get("X-Flatpak") === process.env.FLATPAK_ID) return true;
    const command = unescapeValue(get("Exec") ?? "").match(/^(?:"((?:\\.|[^"\\])+)"|([^\s"\\]+))(?=\s|$)/);
    if (!command) return false;
    const executable = (command[1] ?? command[2]).replace(/\\(["`$\\])/g, "$1").replace(/%%/g, "%");
    const paths = isAbsolute(executable) ? [executable] : (process.env.PATH ?? "").split(":").filter(isAbsolute).map((path: string) => join(path, executable));
    const resolved = paths.find((path: string) => existsSync(path));
    return Boolean(resolved && sameFile(resolved, process.env.APPIMAGE || process.execPath));
}

function readDesktop(path: string) {
    if (statSync(path).size > 256 * 1024) throw new Error("The desktop entry is too large.");
    return readFileSync(path, "utf8");
}

function iconLine(text: string) {
    const { lines, start, end } = entry(text);
    return lines.slice(start + 1, end).find((line: string) => line.startsWith("Icon=")) ?? null;
}

function replaceIcon(text: string, replacement: string | null) {
    const { lines, start, end } = entry(text);
    if (start === -1) throw new Error("The desktop entry has no application section.");
    const index = lines.findIndex((line: string, i: number) => i > start && i < end && line.startsWith("Icon="));
    if (index !== -1) lines.splice(index, 1, ...(replacement === null ? [] : [replacement]));
    else if (replacement !== null) lines.splice(start + 1, 0, replacement);
    return lines.join(text.includes("\r\n") ? "\r\n" : "\n");
}

function backupPath(directory: string, target: string) {
    return join(directory, createHash("sha256").update(target).digest("hex") + ".json");
}

function readBackup(path: string) {
    const saved: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof saved !== "object" || saved === null || !("original" in saved) || !("created" in saved)
        || typeof saved.original !== "string" || saved.original.length > 256 * 1024 || typeof saved.created !== "boolean")
        throw new Error("The original launcher backup is invalid.");
    return { original: saved.original, created: saved.created };
}

function desktopEntries() {
    const roots = dataRoots().map((root: string) => join(root, "applications"));
    const destinations = new Set<string>();
    const entries: Array<{ source: string; target: string; root: string; }> = [];
    for (const root of [...roots, app.getPath("desktop")]) {
        if (!existsSync(root)) continue;
        for (const file of readdirSync(root, { withFileTypes: true })) {
            if (!(file.isFile() || file.isSymbolicLink()) || !file.name.endsWith(".desktop")) continue;
            const source = join(root, file.name);
            const destinationRoot = root === app.getPath("desktop") ? root : roots[0];
            const target = join(destinationRoot, file.name);
            if (destinations.has(target)) continue;
            destinations.add(target);
            entries.push({ source, target, root: destinationRoot });
        }
    }
    return entries;
}

export function updateLinuxShortcuts(iconPath: string, backupDir: string, restore: boolean) {
    let changed = 0;
    let failed = 0;
    let entries: ReturnType<typeof desktopEntries>;
    try {
        entries = desktopEntries();
    } catch {
        return { changed, failed: 1 };
    }
    const replacement = "Icon=" + iconPath.replace(/\\/g, "\\\\").replace(/ /g, "\\s").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
    for (const { source, target, root } of entries) {
        try {
            const text = readDesktop(source);
            const ours = unescapeValue(entry(text).get("Icon") ?? "") === iconPath;
            if (!ours && !isCurrentClient(text, source)) continue;
            if (restore && !ours) continue;
            if (!normalize(target).startsWith(normalize(root) + sep) || (existsSync(target) && lstatSync(target).isSymbolicLink())) {
                failed++;
                continue;
            }
            const backup = backupPath(backupDir, target);
            if (restore) {
                const saved = readBackup(backup);
                const restored = replaceIcon(text, iconLine(saved.original));
                if (saved.created && restored === saved.original) unlinkSync(target);
                else writeFileSync(target, restored);
                unlinkSync(backup);
            } else {
                if (!ours) {
                    mkdirSync(backupDir, { recursive: true });
                    writeFileSync(backup, JSON.stringify({ original: text, created: !existsSync(target) }));
                }
                mkdirSync(root, { recursive: true });
                writeFileSync(target, replaceIcon(text, replacement), { mode: statSync(source).mode & 0o777 });
            }
            changed++;
        } catch {
            failed++;
        }
    }
    return { changed, failed };
}

export function linuxOriginalIcon(backupDir: string) {
    const candidates = [join(dirname(process.execPath), "discord.png"), join(process.resourcesPath, "icon.png")];
    let entries: ReturnType<typeof desktopEntries> = [];
    try {
        entries = desktopEntries();
    } catch {
        logger.warn("The application menu could not be scanned for the original icon.");
    }
    for (const { source, target } of entries) {
        try {
            const backup = backupPath(backupDir, target);
            const text = existsSync(backup) ? readBackup(backup).original : readDesktop(source);
            if (!isCurrentClient(text, source)) continue;
            const icon = unescapeValue(entry(text).get("Icon") ?? "");
            if (isAbsolute(icon)) candidates.unshift(icon);
            else if (icon && !icon.includes("/")) {
                for (const root of dataRoots()) {
                    for (const size of [256, 128, 64, 48, 32]) candidates.push(join(root, "icons", "hicolor", `${size}x${size}`, "apps", icon + ".png"));
                    candidates.push(join(root, "pixmaps", icon + ".png"));
                }
            }
        } catch {
            logger.warn("A launcher could not be read while finding the original icon.");
        }
    }
    for (const path of candidates) {
        if (!existsSync(path)) continue;
        const image = nativeImage.createFromPath(path);
        if (!image.isEmpty()) return image;
    }
    return null;
}
