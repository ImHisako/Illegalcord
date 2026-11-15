/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { win32 as path } from "node:path";
import { test } from "node:test";
import { compileFunction } from "node:vm";

import { transform } from "esbuild";

async function load(name, dependencies, process) {
    const source = await readFile(new URL(`../../src/illegalcordplugins/ClientIcon.desktop/${name}.ts`, import.meta.url), "utf8");
    const { code } = await transform(source, { loader: "ts", format: "cjs" });
    const module = { exports: {} };
    compileFunction(code, ["require", "module", "exports", "process"])(id => {
        assert.ok(Object.hasOwn(dependencies, id), id);
        return dependencies[id];
    }, module, module.exports, process);
    return module.exports;
}

async function fixture() {
    const install = "C:\\Program Files\\Discord";
    const process = { platform: "win32", execPath: path.join(install, "app-1.0.9268", "Discord.exe"), argv: [] };
    const launcher = path.join(install, "Discord.exe");
    const updater = path.join(install, "Update.exe");
    const appData = "C:\\Users\\Test\\AppData\\Roaming";
    const desktop = "C:\\Users\\Test\\Desktop";
    const taskbar = path.join(appData, "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar");
    const pin = path.join(taskbar, "Discord.lnk");
    const other = path.join(taskbar, "Discord PTB.lnk");
    const desktopLink = path.join(desktop, "Discord.lnk");
    const oldIcon = path.join(install, "app.ico");
    const links = new Map([
        [pin, { target: launcher, args: "--processStart Discord.exe", icon: oldIcon, iconIndex: 0, appUserModelId: "Discord.Pin" }],
        [other, { target: "C:\\Apps\\DiscordPTB\\DiscordPTB.exe", appUserModelId: "Discord.PTB" }],
        [desktopLink, { target: updater, args: "--processStart=\"Discord.exe\"", icon: oldIcon, iconIndex: 0, appUserModelId: "Discord.Desktop" }],
    ]);
    const files = new Map([[launcher, ""], [updater, ""], [oldIcon, ""]]);
    const fs = {
        existsSync: file => files.has(file) || file === taskbar || file === desktop,
        mkdirSync() {},
        readdirSync: directory => [...links.keys()].filter(file => path.dirname(file) === directory).map(file => ({
            name: path.basename(file), isDirectory: () => false, isFile: () => true,
        })),
        readFileSync: file => files.get(file),
        writeFileSync: (file, value) => files.set(file, value),
        unlinkSync: file => files.delete(file),
    };
    const session = { defaultSession: {} };
    const calls = [];
    const window = {
        isDestroyed: () => false,
        webContents: { session: session.defaultSession },
        setIcon: image => calls.push({ image }),
        setAppDetails: details => calls.push(details),
    };
    const png = Buffer.alloc(33);
    Buffer.from("89504e470d0a1a0a", "hex").copy(png);
    png.writeUInt32BE(13, 8);
    png.write("IHDR", 12);
    png.writeUInt32BE(256, 16);
    png.writeUInt32BE(256, 20);
    const image = { isEmpty: () => false, resize: () => image, toPNG: () => png, toDataURL: () => "preview" };
    const electron = {
        app: { getPath: name => name === "desktop" ? desktop : appData, getName: () => "Discord", getFileIcon: async () => image },
        BrowserWindow: { fromWebContents: () => window },
        nativeImage: { createFromBuffer: () => image },
        session,
        shell: {
            readShortcutLink: file => links.get(file),
            writeShortcutLink: (file, operation, options) => {
                assert.equal(operation, "update");
                links.set(file, { ...links.get(file), ...options });
                return true;
            },
        },
    };
    const shared = { crypto: { createHash }, electron, fs, path };
    const shortcuts = await load("shortcuts", shared, process);
    const native = await load("native", {
        ...shared,
        "./shortcuts": shortcuts,
        "./linux": {},
        "@illegalcordplugins/DiscordHardened/nativeSecurity": { isTrustedSender: () => true },
        "file://../../../browser/Illegalcord.png?base64": png.toString("base64"),
    }, process);
    return { configure: (mode, launchers) => native.configure({}, mode, launchers), calls, links, pin, other, desktopLink, oldIcon, files, launcher, updater };
}

test("Uses the pinned Discord launcher and publishes its icon before refreshing the app ID", async () => {
    const f = await fixture();
    const originalPin = { ...f.links.get(f.pin) };
    const result = await f.configure("illegalcord", false);
    assert.equal(result.success, true);
    assert.equal(result.changed, 1);
    const { icon } = f.links.get(f.pin);
    assert.match(icon, /icon-[a-f0-9]{64}\.ico$/);
    assert.deepEqual(f.links.get(f.pin), { ...originalPin, icon });
    assert.equal(f.links.get(f.desktopLink).icon, f.oldIcon);
    assert.equal(f.links.get(f.other).icon, undefined);
    assert.equal(f.calls.length, 3);
    assert.deepEqual(f.calls.slice(1), [
        { appIconPath: icon, relaunchCommand: `"${f.launcher}" --processStart "Discord.exe"`, relaunchDisplayName: "Discord" },
        { appId: "Discord.Pin" },
    ]);
    assert.equal((await f.configure("illegalcord", false)).changed, 0);
    assert.equal((await f.configure("original", false)).changed, 1);
    assert.deepEqual(f.links.get(f.pin), originalPin);
});

test("Uses the legacy updater when the installer does not have a separate launcher", async () => {
    const f = await fixture();
    f.files.delete(f.launcher);
    f.links.set(f.pin, { ...f.links.get(f.pin), target: f.updater, args: "--processStart Discord.exe" });
    assert.equal((await f.configure("illegalcord", true)).changed, 2);
    assert.equal(f.calls[1].relaunchCommand, `"${f.updater}" --processStart "Discord.exe"`);
    assert.equal((await f.configure("illegalcord", false)).changed, 1);
    assert.equal(f.links.get(f.desktopLink).icon, f.oldIcon);
    assert.notEqual(f.links.get(f.pin).icon, f.oldIcon);
});
