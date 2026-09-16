/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { compileFunction } from "node:vm";

import { transform } from "esbuild";

async function loadSource(name, dependencies = {}, globals = {}) {
    const source = await readFile(new URL(`../../src/illegalcordplugins/DiscordHardened/${name}`, import.meta.url), "utf8");
    const { code } = await transform(source, { loader: "ts", format: "cjs" });
    const module = { exports: {} };
    const require = name => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
    };
    compileFunction(code, ["require", "module", "exports", ...Object.keys(globals)])(require, module, module.exports, ...Object.values(globals));
    return module.exports;
}

const security = await loadSource("nativeSecurity.ts");
const policy = await loadSource("policy.ts");

async function fixture(url = "https://discord.com/channels/@me") {
    const native = await loadSource("native.ts", {
        "./nativeSecurity": security,
        "./browsers": { launchBrowser: async () => false, listInstalledBrowsers: async () => [] },
    });
    const sender = Object.assign(new EventEmitter(), {
        id: 1,
        mainFrame: { url },
        destroyed: false,
        agent: "Chrome/120 Electron/30 Discord/1",
        isDestroyed() { return this.destroyed; },
        getUserAgent() { return this.agent; },
        setUserAgent(value) { this.agent = value; },
        session: {
            async setProxy() {},
            webRequest: { onBeforeSendHeaders() {} },
        },
    });
    const event = { sender, senderFrame: sender.mainFrame };
    const configure = (navigation = true, webviews = true, minimumPrivilege = false) => native.configure(event, false, false, false, true, false, "", "", navigation, webviews, minimumPrivilege);
    const blocked = (name, ...args) => {
        const emittedEvent = { prevented: false, preventDefault() { this.prevented = true; } };
        sender.emit(name, emittedEvent, ...args);
        return emittedEvent.prevented;
    };
    return { native, sender, event, configure, blocked };
}

test("Accepts the supported Discord app origins", async () => {
    for (const host of ["discord.com", "ptb.discord.com", "canary.discord.com", "discordapp.com", "ptb.discordapp.com", "canary.discordapp.com"]) {
        const { configure } = await fixture(`https://${host}/channels/@me`);
        assert.equal(await configure(), true, host);
    }
});

test("Rejects untrusted IPC callers before changing native state", async () => {
    for (const url of [
        "https://discord.com.attacker.test/", "https://attacker.test/?discord.com",
        "https://support.discord.com/", "https://discord.com:444/",
        "https://discord.com@attacker.test/", "https://user:password@discord.com/",
        "http://discord.com/", "file:///discord.com", "about:blank", "not a URL",
    ]) {
        const { sender, configure } = await fixture(url);
        assert.equal(await configure(), false, url);
        assert.equal(sender.eventNames().length, 0, url);
    }
    for (const kind of ["subframe", "missing", "destroyed"]) {
        const { sender, event, configure } = await fixture();
        if (kind === "subframe") event.senderFrame = { url: sender.mainFrame.url };
        if (kind === "missing") event.senderFrame = null;
        if (kind === "destroyed") sender.destroyed = true;
        assert.equal(await configure(), false, kind);
    }
});

test("Rejects malformed security settings", async () => {
    const { native, event, sender } = await fixture();
    for (const [navigation, webviews] of [["true", true], [true, null], [undefined, undefined]]) {
        assert.equal(await native.configure(event, false, false, false, true, false, "", "", navigation, webviews), false);
    }
    assert.equal(sender.eventNames().length, 0);
});

test("Blocks external main frame navigation and redirects while allowing Discord and embedded content", async () => {
    const { configure, blocked } = await fixture();
    assert.equal(await configure(), true);
    for (const url of ["https://attacker.test", "https://discord.com.attacker.test", "https://support.discord.com", "https://discord.com:444", "https://user@discord.com", "javascript:alert(1)", "data:text/html,test", "file:///C:/test", "steam://run/1", "about:blank"]) {
        assert.equal(blocked("will-navigate", url), true, url);
        assert.equal(blocked("will-redirect", url, false, true), true, url);
    }
    assert.equal(blocked("will-navigate", "https://discord.com/login"), false);
    assert.equal(blocked("will-redirect", "https://canary.discord.com/channels/@me", false, true), false);
    assert.equal(blocked("will-redirect", "https://www.youtube.com/embed/video", false, false), false);
    assert.equal(blocked("will-attach-webview", { preload: "file:///test", nodeIntegration: true }, { src: "https://discord.com" }), true);
});

test("Security switches work independently without identity spoofing or a proxy", async () => {
    for (const [navigation, webviews] of [[true, false], [false, true], [false, false]]) {
        const { sender, configure, blocked } = await fixture();
        const agent = sender.agent;
        assert.equal(await configure(navigation, webviews), navigation || webviews);
        assert.equal(blocked("will-navigate", "https://attacker.test"), navigation);
        assert.equal(blocked("will-attach-webview"), webviews);
        assert.equal(sender.agent, agent);
    }
});

test("Untrusted frames cannot disable active protections", async () => {
    const { native, event, configure, blocked } = await fixture();
    await configure();
    assert.equal(await native.restore({ ...event, senderFrame: { url: event.senderFrame.url } }), false);
    event.senderFrame.url = "https://attacker.test";
    assert.equal(await native.restore(event), false);
    assert.equal(blocked("will-navigate", "https://attacker.test"), true);
});

test("Reconfiguration does not duplicate listeners and restore preserves host listeners", async () => {
    const { native, event, sender, configure, blocked } = await fixture();
    const hostListener = () => {};
    sender.on("will-navigate", hostListener);
    await configure();
    await configure();
    assert.equal(sender.listenerCount("will-navigate"), 2);
    assert.equal(sender.listenerCount("will-redirect"), 1);
    assert.equal(sender.listenerCount("will-attach-webview"), 1);
    assert.equal(await native.restore(event), true);
    assert.deepEqual(sender.listeners("will-navigate"), [hostListener]);
    assert.equal(sender.listenerCount("will-redirect"), 0);
    assert.equal(sender.listenerCount("will-attach-webview"), 0);
    assert.equal(sender.listenerCount("destroyed"), 0);
    assert.equal(blocked("will-navigate", "https://attacker.test"), false);
    assert.equal(await native.restore(event), false);
});

test("Destroying the window releases native listeners", async () => {
    const { sender, configure } = await fixture();
    await configure();
    sender.destroyed = true;
    sender.emit("destroyed");
    assert.equal(sender.eventNames().length, 0);
});

test("A native setup failure rolls back listeners and identity without exposing its error", async () => {
    const { native, event, sender } = await fixture();
    const agent = sender.agent;
    sender.session.setProxy = async () => { throw new Error("Private native path"); };
    assert.equal(await native.configure(event, true, false, false, false, true, "127.0.0.1:8080", "", true, true), false);
    assert.equal(sender.agent, agent);
    assert.equal(sender.eventNames().length, 0);
});

test("Rechecks IPC trust after asynchronous proxy changes", async () => {
    for (const destroyed of [true, false]) {
        const { native, event, sender } = await fixture();
        const proxyCalls = [];
        sender.session.setProxy = async options => {
            proxyCalls.push(options);
            if (destroyed) sender.destroyed = true;
            else sender.mainFrame.url = "https://attacker.test";
        };
        assert.equal(await native.configure(event, false, false, false, false, true, "127.0.0.1:8080", "", true, true), false);
        assert.equal(sender.eventNames().length, 0);
        assert.deepEqual(proxyCalls.at(-1), { mode: "system" });
    }
});

test("Reconfiguration handles failed proxy restoration without exposing native errors", async () => {
    const { native, event, sender, configure } = await fixture();
    assert.equal(await native.configure(event, false, false, false, false, true, "127.0.0.1:8080", "", true, true), true);
    sender.session.setProxy = async () => { throw new Error("Private native path"); };
    assert.equal(await configure(), false);
    assert.equal(sender.eventNames().length, 0);
});

test("Minimum privilege hardens allowed webviews and rejects external ones", async () => {
    const { configure, blocked } = await fixture();
    await configure(false, false, true);
    const preferences = { nodeIntegration: true, contextIsolation: false, webSecurity: false, sandbox: false, preload: "C:/unsafe.js" };
    const params = { src: "https://discord.com/login", preload: "file:///unsafe.js", preloadURL: "file:///unsafe.js" };
    assert.equal(blocked("will-attach-webview", preferences, params), false);
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.nodeIntegrationInSubFrames, false);
    assert.equal(preferences.nodeIntegrationInWorker, false);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.webSecurity, true);
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.webviewTag, false);
    assert.equal("preload" in preferences, false);
    assert.equal("preload" in params, false);
    assert.equal("preloadURL" in params, false);
    assert.equal(blocked("will-attach-webview", {}, { src: "https://attacker.test" }), true);
});

test("Embed allowlists reject spoofed domains and check original media origins", () => {
    const domains = policy.parseDomainList("discord.com\nYouTube.com");
    for (const url of ["https://youtube.com/watch?v=x", "https://www.youtube.com/embed/x"]) {
        assert.equal(policy.isAllowedEmbed({ url }, domains), true);
    }
    for (const url of ["http://youtube.com", "https://youtube.com.attacker.test", "https://youtube.com@attacker.test", "https://youtube.com:8443", "javascript:alert(1)"]) {
        assert.equal(policy.isAllowedEmbed({ url }, domains), false, url);
    }
    assert.equal(policy.isAllowedEmbed({ url: "https://youtube.com", thumbnail: { url: "https://tracker.test/pixel", proxyURL: "https://discord.com/proxy" } }, domains), false);
    assert.equal(policy.isAllowedEmbed({ rawDescription: "Text only" }, domains), true);
    for (const value of ["https://example.com", "*.example.com", "example.com; script-src *", "example.com:443", "a".repeat(4097)]) {
        assert.notEqual(policy.validateDomainList(value), true);
    }
});

test("Content restrictions preserve existing CSP and ignore invalid configuration", () => {
    const headers = { "content-security-policy": ["default-src 'self'"] };
    policy.addContentPolicy(headers, { enabled: true, allowedEmbedDomains: "youtube.com", blockThirdPartyScripts: true });
    assert.equal(headers["content-security-policy"][0], "default-src 'self'");
    assert.match(headers["content-security-policy"][1], /frame-src .*https:\/\/youtube\.com https:\/\/\*\.youtube\.com/);
    assert.match(headers["content-security-policy"][1], /script-src-elem 'self' 'unsafe-inline' blob:/);
    assert.match(headers["content-security-policy"][1], /object-src 'none'/);
    const disabled = {};
    policy.addContentPolicy(disabled, { enabled: false });
    assert.deepEqual(disabled, {});
    const invalid = {};
    policy.addContentPolicy(invalid, { enabled: true, allowedEmbedDomains: "example.com; script-src *" });
    assert.ok(!invalid["Content-Security-Policy"][0].includes("script-src *"));
});

test("Quest compatibility allows hCaptcha through frame and script restrictions only when enabled", () => {
    for (const questCompatibility of [undefined, true, false]) {
        for (const blockUnknownEmbeds of [true, false]) {
            const headers = { "Content-Security-Policy": ["default-src https:"] };
            policy.addContentPolicy(headers, {
                enabled: true,
                questCompatibility,
                blockUnknownEmbeds,
                blockThirdPartyScripts: true,
                allowedEmbedDomains: "youtube.com",
            });
            assert.equal(headers["Content-Security-Policy"][0], "default-src https:");
            const directives = Object.fromEntries(headers["Content-Security-Policy"][1].split("; ").map(directive => {
                const [name, ...sources] = directive.split(" ");
                return [name, sources];
            }));
            assert.equal("frame-src" in directives, blockUnknownEmbeds);
            for (const directive of ["frame-src", "script-src-elem"]) {
                if (!(directive in directives)) continue;
                for (const source of ["https://hcaptcha.com", "https://*.hcaptcha.com"]) {
                    assert.equal(directives[directive].includes(source), questCompatibility !== false);
                }
                assert.ok(!directives[directive].includes("https:"));
                assert.ok(!directives[directive].includes("*"));
            }
            assert.deepEqual(directives["object-src"], ["'none'"]);
        }
    }
});

test("Browser discovery only lists installed executables and launches a validated URL as one argument", async () => {
    const { win32: path } = await import("node:path");
    const existing = new Set(["C:/Program Files/Waterfox/waterfox.exe", "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe"].map(value => path.normalize(value)));
    const spawned = [];
    const browsers = await loadSource("browsers.ts", {
        electron: { app: { getPath: name => name === "home" ? "C:/Users/Test" : "C:/Users/Test/Desktop" } },
        path,
        "fs/promises": {
            constants: { X_OK: 1 },
            access: async file => { if (!existing.has(file)) throw new Error("Missing"); },
            stat: async () => ({ isFile: () => true }),
        },
        child_process: {
            execFile: (_file, _args, _options, callback) => callback(null, ""),
            spawn: (file, args, options) => {
                spawned.push({ file, args, options });
                const child = Object.assign(new EventEmitter(), { unref() {} });
                queueMicrotask(() => child.emit("spawn"));
                return child;
            },
        },
    }, { process: { platform: "win32", env: { ProgramFiles: "C:/Program Files" } } });
    assert.deepEqual(await browsers.listInstalledBrowsers(), [{ id: "waterfox", name: "Waterfox" }, { id: "brave", name: "Brave Browser" }]);
    for (const url of ["file:///C:/test", "javascript:alert(1)", "--inspect=9222", "https://user:password@example.com"]) {
        assert.equal(await browsers.launchBrowser("waterfox", url, () => true), false);
    }
    assert.equal(await browsers.launchBrowser("C:/evil.exe", "https://example.com", () => true), false);
    assert.equal(await browsers.launchBrowser("waterfox", "https://example.com", () => false), false);
    assert.equal(spawned.length, 0);
    assert.equal(await browsers.launchBrowser("waterfox", "https://example.com/?x=a&y=b", () => true), true);
    assert.deepEqual(spawned[0].args, ["https://example.com/?x=a&y=b"]);
    assert.equal(spawned[0].options.shell, false);
    assert.equal(spawned[0].options.windowsHide, true);
    existing.clear();
    assert.equal(await browsers.launchBrowser("waterfox", "https://example.com", () => true), false);
    assert.equal(spawned.length, 1);
});

test("Fingerprint and GIF controls preserve rendering and restore original APIs", async () => {
    const hints = { brands: [{ brand: "Chromium", version: "130" }], mobile: false, platform: "Linux", getHighEntropyValues: async () => ({ architecture: "arm", platformVersion: "6.10" }) };
    class Navigator {
        get hardwareConcurrency() { return 16; }
        get deviceMemory() { return 16; }
        get userAgent() { return "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0"; }
        get appVersion() { return this.userAgent; }
        get platform() { return "Linux x86_64"; }
        get userAgentData() { return hints; }
    }
    class WebGLRenderingContext {
        getExtension(name) { return { name }; }
        getSupportedExtensions() { return ["WEBGL_debug_renderer_info", "EXT_texture_filter_anisotropic"]; }
    }
    class GPUAdapterInfo {
        get vendor() { return "Real vendor"; }
        get architecture() { return "Real architecture"; }
        get device() { return "Real device"; }
        get description() { return "Real GPU"; }
    }
    const navigator = new Navigator();
    navigator.usb = { getDevices: async () => ["Real USB device"] };
    const gifs = { getSetting: () => true, useSetting: () => true };
    const originalGifSetting = gifs.getSetting;
    const originalHints = hints.getHighEntropyValues;
    const originalDevices = navigator.usb.getDevices;
    const opened = [];
    const window = { fetch: async () => {}, open: url => { opened.push(url); }, GPUAdapterInfo };
    const originalOpen = window.open;
    const runtime = await loadSource("runtime.ts", {
        "@api/PluginManager": { isPluginEnabled: () => false },
        "@api/UserSettings": { getUserSetting: () => gifs },
        "@utils/Logger": { Logger: class { warn() {} info() {} } },
        "@utils/text": { escapeRegExp: value => value },
        "./microphonePrivacy": { registerMicrophoneStream() {} },
    }, {
        Navigator, navigator, window, WebGLRenderingContext, WebGL2RenderingContext: undefined,
        HTMLCanvasElement: class { getContext() { return "Working context"; } },
        XMLHttpRequest: class { open() {} send() {} },
        Notification: undefined, Element: undefined, location: { href: "https://discord.com/channels/@me", origin: "https://discord.com" },
    });
    const settings = { reduceHardwareFingerprint: true, reduceGpuFingerprint: true, reduceClientHints: true, blockHardwareAccess: true, blockGifAutoplay: true };
    const routed = [];
    runtime.startHardening(settings, url => { routed.push(url); return true; });
    assert.equal(navigator.hardwareConcurrency, 4);
    assert.equal(navigator.deviceMemory, 8);
    assert.equal(navigator.platform, "Linux x86_64");
    assert.equal(navigator.userAgentData.platform, "Linux");
    assert.deepEqual(await hints.getHighEntropyValues(["architecture", "platformVersion"]), { brands: hints.brands, mobile: false, platform: "Linux" });
    const gl = new WebGLRenderingContext();
    assert.equal(gl.getExtension("WEBGL_debug_renderer_info"), null);
    assert.deepEqual(gl.getExtension("EXT_texture_filter_anisotropic"), { name: "EXT_texture_filter_anisotropic" });
    assert.deepEqual(gl.getSupportedExtensions(), ["EXT_texture_filter_anisotropic"]);
    assert.equal(new GPUAdapterInfo().vendor, "");
    await assert.rejects(navigator.usb.getDevices(), { name: "NotAllowedError" });
    assert.equal(gifs.getSetting(), false);
    assert.equal(gifs.useSetting(), false);
    window.open("https://example.com");
    window.open("https://discord.com/popout");
    assert.deepEqual(routed, ["https://example.com/"]);
    assert.deepEqual(opened, ["https://discord.com/popout"]);
    runtime.stopHardening();
    assert.equal(navigator.hardwareConcurrency, 16);
    assert.equal(navigator.usb.getDevices, originalDevices);
    assert.equal(hints.getHighEntropyValues, originalHints);
    assert.equal(gifs.getSetting, originalGifSetting);
    assert.equal(new GPUAdapterInfo().vendor, "Real vendor");
    assert.deepEqual(gl.getExtension("WEBGL_debug_renderer_info"), { name: "WEBGL_debug_renderer_info" });
    assert.equal(window.open, originalOpen);
});

test("The plugin IPC bridge rejects untrusted frames without invoking native plugins", async () => {
    const handlers = new Map();
    const listeners = new Map();
    const settings = { plugins: { DiscordHardened: { enabled: true, minimumPrivilege: true } } };
    let calls = 0;
    await loadSource("../../main/ipcPlugins.ts", {
        "@illegalcordplugins/DiscordHardened/nativeSecurity": security,
        "@shared/IpcEvents": { IpcEvents: { GET_PLUGIN_IPC_METHOD_MAP: "map" } },
        electron: { ipcMain: { handle: (key, handler) => handlers.set(key, handler), on: (key, listener) => listeners.set(key, listener) } },
        "~pluginNatives": { Example: { ping: (_event, value) => { calls++; return value; } } },
        "./settings": { RendererSettings: { store: settings } },
    });
    const { event } = await fixture();
    const ping = handlers.get("VencordPluginNative_Example_ping");
    assert.equal(await ping(event, "accepted"), "accepted");
    const subframe = { ...event, senderFrame: { url: event.senderFrame.url } };
    await assert.rejects(ping(subframe, "rejected"), error => error === "This page cannot access plugin functions.");
    listeners.get("map")(subframe);
    assert.deepEqual(subframe.returnValue, {});
    listeners.get("map")(event);
    assert.equal(event.returnValue.Example.ping, "VencordPluginNative_Example_ping");
    assert.equal(calls, 1);
    event.senderFrame.url = "https://discord.com.attacker.test";
    await assert.rejects(ping(event, "rejected"), error => error === "This page cannot access plugin functions.");
    assert.equal(calls, 1);
    settings.plugins.DiscordHardened.minimumPrivilege = false;
    assert.equal(await ping(event, "previous behavior"), "previous behavior");
});
