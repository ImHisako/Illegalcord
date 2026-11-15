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

function isVersionDirectory(directory: string) {
    return /^app-\d[\w.-]*$/i.test(basename(directory));
}

function isCurrentClient(shortcut: ShortcutDetails, root: string | undefined) {
    const executable = process.execPath;
    if (samePath(shortcut.target, executable)) return true;
    if (!root) return false;

    const client = basename(executable);
    if (samePath(shortcut.target, join(root, client))) return true;
    const targetDir = dirname(shortcut.target);
    if (samePath(dirname(targetDir), root) && isVersionDirectory(targetDir))
        return basename(shortcut.target).toLowerCase() === client.toLowerCase();

    const launch = shortcut.args?.match(/(?:^|\s)--processStart(?:\s+|=)(?:"([^"\r\n]+)"|([^\s"]+))(?=\s|$)/i);
    if (!launch) return false;
    return samePath(shortcut.target, join(root, "Update.exe"))
        && (launch[1] ?? launch[2]).toLowerCase() === client.toLowerCase();
}

export function updateShortcuts(iconPath: string, backupDir: string, restore: boolean, updateLaunchers: boolean) {
    const versionDir = dirname(process.execPath);
    const root = isVersionDirectory(versionDir) ? dirname(versionDir) : undefined;
    const client = basename(process.execPath);
    const launcher = root && join(root, client);
    const updater = root && join(root, "Update.exe");
    const localDev = process.argv.includes("--localdev");
    const launchTarget = !localDev && (launcher && existsSync(launcher) ? launcher : updater && existsSync(updater) ? updater : undefined);
    const relaunchCommand = launchTarget ? `"${launchTarget}" --processStart "${client}"` : `"${process.execPath}"${localDev ? " --localdev" : ""}`;
    const roots = [
        { directory: join(app.getPath("appData"), "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar"), restore },
        { directory: join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs"), restore: restore || !updateLaunchers },
        { directory: app.getPath("desktop"), restore: restore || !updateLaunchers }
    ];
    let changed = 0;
    let failed = 0;
    let appId: string | undefined;

    function scan(directory: string, depth: number, restore: boolean) {
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
            if (entry.isDirectory() && depth < 3) scan(path, depth + 1, restore);
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".lnk")) continue;

            let shortcut: ShortcutDetails;
            try {
                shortcut = shell.readShortcutLink(path);
            } catch {
                failed++;
                continue;
            }
            if (!isCurrentClient(shortcut, root)) continue;
            appId ||= shortcut.appUserModelId;

            try {
                const icon = shortcut.icon ?? "";
                const ours = samePath(dirname(icon), dirname(iconPath)) && /^(?:active|icon-[a-f0-9]{64})\.ico$/i.test(basename(icon));
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
                    if (icon && !existsSync(icon) && isCurrentClient({ target: icon }, root)) icon = process.execPath;
                    if (shell.writeShortcutLink(path, "update", { target: shortcut.target, icon, iconIndex: saved.iconIndex })) {
                        unlinkSync(backupPath);
                        changed++;
                    } else failed++;
                } else {
                    if (samePath(icon, iconPath) && shortcut.iconIndex === 0) continue;
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

    for (const location of roots) scan(location.directory, 0, location.restore);
    return { changed, failed, appId, relaunchCommand };
}
