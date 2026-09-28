/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash } from "crypto";
import { app, shell, type ShortcutDetails } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname, join, normalize } from "path";

function samePath(first: string, second: string) {
    return normalize(first).toLowerCase() === normalize(second).toLowerCase();
}

function isCurrentClient(shortcut: ShortcutDetails) {
    const executable = process.execPath;
    if (samePath(shortcut.target, executable)) return true;

    const versionDir = dirname(executable);
    if (!/^app-\d[\w.-]*$/i.test(basename(versionDir))) return false;

    const root = dirname(versionDir);
    const targetDir = dirname(shortcut.target);
    if (samePath(dirname(targetDir), root) && /^app-\d[\w.-]*$/i.test(basename(targetDir)))
        return basename(shortcut.target).toLowerCase() === basename(executable).toLowerCase();

    const launch = shortcut.args?.match(/(?:^|\s)--processStart(?:\s+|=)(?:"([^"\r\n]+)"|([^\s"]+))(?=\s|$)/i);
    if (!launch) return false;
    return samePath(shortcut.target, join(root, "Update.exe"))
        && (launch[1] ?? launch[2]).toLowerCase() === basename(executable).toLowerCase();
}

export function updateShortcuts(iconPath: string, backupDir: string, restore: boolean) {
    const roots = [
        app.getPath("desktop"),
        join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs"),
        join(app.getPath("appData"), "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar")
    ];
    let changed = 0;
    let failed = 0;

    function scan(directory: string, depth: number) {
        if (!existsSync(directory)) return;
        let entries;
        try {
            entries = readdirSync(directory, { withFileTypes: true });
        } catch {
            failed++;
            return;
        }
        for (const entry of entries) {
            const path = join(directory, entry.name);
            if (entry.isDirectory() && depth < 3) scan(path, depth + 1);
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".lnk")) continue;

            let shortcut: ShortcutDetails;
            try {
                shortcut = shell.readShortcutLink(path);
            } catch {
                failed++;
                continue;
            }
            if (!isCurrentClient(shortcut)) continue;

            try {
                const ours = samePath(shortcut.icon ?? "", iconPath);
                const backupPath = join(backupDir, createHash("sha256").update(normalize(path).toLowerCase()).digest("hex") + ".json");
                if (restore) {
                    if (!ours) continue;
                    const saved: unknown = JSON.parse(readFileSync(backupPath, "utf8"));
                    if (typeof saved !== "object" || saved === null || !("icon" in saved) || !("iconIndex" in saved)
                        || typeof saved.icon !== "string" || saved.icon.length > 32768 || typeof saved.iconIndex !== "number" || !Number.isInteger(saved.iconIndex)) {
                        failed++;
                        continue;
                    }
                    let { icon } = saved;
                    if (icon && !existsSync(icon) && isCurrentClient({ target: icon })) icon = process.execPath;
                    if (shell.writeShortcutLink(path, "update", { target: shortcut.target, icon, iconIndex: saved.iconIndex })) {
                        unlinkSync(backupPath);
                        changed++;
                    } else failed++;
                } else {
                    if (!ours) {
                        mkdirSync(backupDir, { recursive: true });
                        writeFileSync(backupPath, JSON.stringify({ icon: shortcut.icon ?? "", iconIndex: shortcut.iconIndex ?? 0 }));
                    }
                    if (shell.writeShortcutLink(path, "update", { target: shortcut.target, icon: iconPath, iconIndex: 0 })) changed++;
                    else failed++;
                }
            } catch {
                failed++;
            }
        }
    }

    for (const root of roots) scan(root, 0);
    return { changed, failed };
}
