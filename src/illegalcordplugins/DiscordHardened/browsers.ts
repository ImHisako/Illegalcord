/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile, spawn } from "child_process";
import { app } from "electron";
import { access, constants, stat } from "fs/promises";
import { isAbsolute, join } from "path";

const browsers = [
    { id: "librewolf", name: "LibreWolf", windows: ["LibreWolf/librewolf.exe"], mac: "LibreWolf.app/Contents/MacOS/librewolf", linux: ["librewolf"] },
    { id: "waterfox", name: "Waterfox", windows: ["Waterfox/waterfox.exe"], mac: "Waterfox.app/Contents/MacOS/waterfox", linux: ["waterfox"] },
    { id: "floorp", name: "Floorp", windows: ["Floorp/floorp.exe", "Ablaze Floorp/floorp.exe"], mac: "Floorp.app/Contents/MacOS/floorp", linux: ["floorp"] },
    { id: "tor", name: "Tor Browser", windows: ["Tor Browser/Browser/firefox.exe"], mac: "Tor Browser.app/Contents/MacOS/firefox", linux: ["tor-browser/Browser/start-tor-browser"] },
    { id: "zen", name: "Zen Browser", windows: ["Zen Browser/zen.exe", "Zen/zen.exe"], mac: "Zen.app/Contents/MacOS/zen", linux: ["zen", "zen-browser"] },
    { id: "helium", name: "Helium Browser", windows: ["imput/Helium/Application/chrome.exe", "Helium/Application/chrome.exe", "Helium/chrome.exe", "Helium/helium.exe"], mac: "Helium.app/Contents/MacOS/Helium", linux: ["helium", "helium-browser"] },
    { id: "brave", name: "Brave Browser", windows: ["BraveSoftware/Brave-Browser/Application/brave.exe"], mac: "Brave Browser.app/Contents/MacOS/Brave Browser", linux: ["brave-browser", "brave"] },
    { id: "cromite", name: "Cromite Browser", windows: ["Cromite/chrome.exe", "Cromite/chrome-win/chrome.exe"], mac: "", linux: ["cromite", "cromite/chrome"] },
    { id: "firefox", name: "Firefox", windows: ["Mozilla Firefox/firefox.exe"], mac: "Firefox.app/Contents/MacOS/firefox", linux: ["firefox"] },
    { id: "chrome", name: "Google Chrome", windows: ["Google/Chrome/Application/chrome.exe"], mac: "Google Chrome.app/Contents/MacOS/Google Chrome", linux: ["google-chrome", "google-chrome-stable"] },
    { id: "edge", name: "Microsoft Edge", windows: ["Microsoft/Edge/Application/msedge.exe"], mac: "Microsoft Edge.app/Contents/MacOS/Microsoft Edge", linux: ["microsoft-edge", "microsoft-edge-stable"] },
] as const;

export interface InstalledBrowser {
    id: string;
    name: string;
}

async function registeredExecutables(): Promise<string[]> {
    if (process.platform !== "win32") return [];
    const registry = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");
    const results = await Promise.all(["HKCU", "HKLM"].map(hive => new Promise<string>(resolve => {
        execFile(registry, ["query", `${hive}\\Software\\Clients\\StartMenuInternet`, "/s"], { windowsHide: true, timeout: 3000, maxBuffer: 1024 * 1024 }, (error, stdout) => resolve(error ? "" : stdout));
    })));
    return results.flatMap(result => [...result.matchAll(/REG_(?:EXPAND_)?SZ\s+"?([^\r\n"]+\.exe)"?(?:\s|$)/gi)]
        .map(match => match[1].replace(/%([^%]+)%/g, (token: string, name: string) => process.env[name] ?? token)));
}

async function findInstalledBrowsers() {
    const registered = await registeredExecutables();
    const home = app.getPath("home");
    const windowsRoots = [
        process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA,
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs"),
        home, app.getPath("desktop"), join(home, "scoop", "apps"),
    ].filter((root): root is string => Boolean(root));

    const installed = await Promise.all(browsers.map(async browser => {
        const candidates = process.platform === "win32"
            ? [
                ...registered.filter(path => browser.windows.some(suffix => path.replaceAll("\\", "/").toLowerCase().endsWith(`/${suffix.toLowerCase()}`))),
                ...windowsRoots.flatMap(root => browser.windows.map(path => join(root, path))),
            ]
            : process.platform === "darwin"
                ? browser.mac ? [join("/Applications", browser.mac), join(home, "Applications", browser.mac)] : []
                : ["/usr/bin", "/usr/local/bin", "/opt", join(home, ".local", "bin")].flatMap(root => browser.linux.map(path => join(root, path)));

        for (const path of candidates) {
            if (!isAbsolute(path) || path.startsWith("\\\\")) continue;
            try {
                await access(path, constants.X_OK);
                if ((await stat(path)).isFile()) return { id: browser.id, name: browser.name, path };
            } catch {
                continue;
            }
        }
        return null;
    }));
    return installed.filter(browser => browser !== null);
}

export async function listInstalledBrowsers(): Promise<InstalledBrowser[]> {
    return (await findInstalledBrowsers()).map(({ id, name }) => ({ id, name }));
}

export async function launchBrowser(browserId: unknown, rawUrl: unknown, canOpen: () => boolean): Promise<boolean> {
    if (typeof browserId !== "string" || !browsers.some(browser => browser.id === browserId)
        || typeof rawUrl !== "string" || rawUrl.length > 8192) return false;

    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return false;
    }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return false;
    const browser = (await findInstalledBrowsers()).find(browser => browser.id === browserId);
    if (!browser || !canOpen()) return false;

    return new Promise(resolve => {
        const child = spawn(browser.path, [url.href], { detached: true, stdio: "ignore", windowsHide: true, shell: false });
        child.once("error", () => resolve(false));
        child.once("spawn", () => {
            child.unref();
            resolve(true);
        });
    });
}
