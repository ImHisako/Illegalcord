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

async function runtimeFixture(navigator = {}, session = null, globals = {}) {
    session ??= await loadSource("session.ts");
    const opened = [];
    const fetched = [];
    const registered = [];
    const window = {
        fetch: async (input, init) => { fetched.push({ input, init }); return new Response(null, { status: 200 }); },
        open: (...args) => { opened.push(args); return null; },
    };
    const runtime = await loadSource("runtime.ts", {
        "@api/PluginManager": { isPluginEnabled: () => false },
        "@api/UserSettings": { getUserSetting: () => null },
        "@utils/Logger": { Logger: class { warn() {} info() {} } },
        "@utils/text": { escapeRegExp: value => value },
        "./microphonePrivacy": { registerMicrophoneStream: stream => registered.push(stream) },
        "./session": session,
    }, {
        Navigator: undefined, navigator, window, HTMLCanvasElement: undefined,
        XMLHttpRequest: class { open() {} send() {} },
        Notification: undefined, Element: undefined,
        location: { href: "https://discord.com/channels/@me", origin: "https://discord.com" },
        ...globals,
    });
    return { runtime, window, opened, fetched, registered, session };
}

async function sessionFixture() {
    let now = 1000;
    let nextTimer = 0;
    const timers = new Map();
    const session = await loadSource("session.ts", {}, {
        Date: { now: () => now },
        setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, due: now + delay }); return id; },
        clearTimeout: id => timers.delete(id),
    });
    const advance = (ms, runTimers = true) => {
        now += ms;
        if (!runTimers) return;
        for (const [id, timer] of timers) {
            if (timer.due <= now) { timers.delete(id); timer.callback(); }
        }
    };
    return { session, timers, advance };
}

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
        "blob:https://discord.com/id", "blob:https://canary.discord.com/id",
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
    for (const url of ["https://attacker.test", "https://discord.com.attacker.test", "https://support.discord.com", "https://discord.com:444", "https://user@discord.com", "javascript:alert(1)", "data:text/html,test", "file:///C:/test", "steam://run/1", "about:blank", "blob:https://discord.com/id"]) {
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
    assert.equal(blocked("will-attach-webview", {}, { src: "blob:https://discord.com/id" }), true);
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
    policy.addContentPolicy(headers, { enabled: true, blockUnknownEmbeds: true, allowedEmbedDomains: "youtube.com", blockThirdPartyScripts: true });
    assert.equal(headers["content-security-policy"][0], "default-src 'self'");
    assert.match(headers["content-security-policy"][1], /frame-src .*https:\/\/youtube\.com https:\/\/\*\.youtube\.com/);
    assert.match(headers["content-security-policy"][1], /script-src-elem 'self' 'unsafe-inline' blob:/);
    assert.match(headers["content-security-policy"][1], /object-src 'none'/);
    const disabled = {};
    policy.addContentPolicy(disabled, { enabled: false });
    assert.deepEqual(disabled, {});
    const invalid = {};
    policy.addContentPolicy(invalid, { enabled: true, blockUnknownEmbeds: true, allowedEmbedDomains: "example.com; script-src *" });
    assert.ok(!invalid["Content-Security-Policy"][0].includes("script-src *"));
});

test("Desktop referrer protection replaces conflicting header casing without changing CSP", () => {
    const headers = {
        "referrer-policy": ["unsafe-url"],
        "Referrer-Policy": ["origin"],
        "Content-Security-Policy": ["default-src 'self'"],
    };
    const original = structuredClone(headers);
    policy.addContentPolicy(headers, { enabled: false });
    assert.deepEqual(headers, original);
    policy.addContentPolicy(headers, { enabled: true, minimumPrivilege: false, stripThirdPartyReferrers: false });
    assert.deepEqual(headers, original);
    policy.addContentPolicy(headers, { enabled: true, minimumPrivilege: false });
    assert.deepEqual(headers, { "Referrer-Policy": ["no-referrer"], "Content-Security-Policy": original["Content-Security-Policy"] });
});

test("External windows reject origin based protocol bypasses and enforce opener isolation", async t => {
    const { runtime, window, opened } = await runtimeFixture();
    const originalOpen = window.open;
    const settings = { blockUnsafeExternalProtocols: true, isolateExternalWindows: true, stripThirdPartyReferrers: true };
    runtime.startHardening(settings, () => false);
    t.after(() => runtime.stopHardening());
    for (const url of ["blob:https://discord.com/id", "javascript:alert(1)", "data:text/html,test", "file:///test", "https://user:password@example.com"]) {
        assert.equal(window.open(url), null);
    }
    assert.equal(opened.length, 0);
    window.open("https://example.com", "external", "width=500, NOOPENER =false,noreferrer=0");
    assert.deepEqual(opened.pop(), ["https://example.com", "external", "width=500,noopener,noreferrer"]);
    window.open("/popout", "discord", "width=500");
    assert.deepEqual(opened.pop(), ["/popout", "discord", "width=500"]);
    window.open("about:blank");
    assert.deepEqual(opened.pop(), ["about:blank", undefined, undefined]);
    settings.stripThirdPartyReferrers = false;
    window.open("https://example.com", "external", "noopener=0");
    assert.deepEqual(opened.pop(), ["https://example.com", "external", ",noopener"]);
    window.open("https://example.com", "external", "noreferrer");
    assert.deepEqual(opened.pop(), ["https://example.com", "external", "noreferrer,noopener"]);
    settings.isolateExternalWindows = false;
    window.open("https://example.com", "external", "noopener=0");
    assert.deepEqual(opened.pop(), ["https://example.com", "external", "noopener=0"]);
    runtime.stopHardening();
    assert.equal(window.open, originalOpen);
});

test("Fetch strips explicit referrers on external requests and requests that could redirect", async t => {
    const { runtime, window, fetched } = await runtimeFixture();
    const originalFetch = window.fetch;
    const settings = { stripThirdPartyReferrers: true };
    runtime.startHardening(settings, () => false);
    t.after(() => runtime.stopHardening());
    const request = new Request("https://example.com", { referrer: "https://discord.com/channels/private", referrerPolicy: "unsafe-url" });
    const init = { method: "POST", body: "payload", referrer: "https://discord.com/channels/private", referrerPolicy: "unsafe-url" };
    for (const input of [request, "/redirect", "https://example.com"]) {
        await window.fetch(input, init);
        assert.deepEqual(fetched.pop(), { input, init: { ...init, referrer: "", referrerPolicy: "no-referrer" } });
    }
    assert.equal(init.referrerPolicy, "unsafe-url");
    settings.stripThirdPartyReferrers = false;
    await window.fetch(request, init);
    assert.equal(fetched.pop().init, init);
    runtime.stopHardening();
    assert.equal(window.fetch, originalFetch);
});

test("Revoking capture permissions while a prompt is pending stops every returned track", async t => {
    let resolveCapture;
    let calls = 0;
    const mediaDevices = {
        getUserMedia: () => { calls++; return new Promise(resolve => { resolveCapture = resolve; }); },
        getDisplayMedia: () => { calls++; return new Promise(resolve => { resolveCapture = resolve; }); },
    };
    const originalMedia = mediaDevices.getUserMedia;
    const originalDisplay = mediaDevices.getDisplayMedia;
    const { runtime, registered } = await runtimeFixture({ mediaDevices });
    const settings = { allowCamera: true, allowMicrophone: true, allowDisplayCapture: true };
    runtime.startHardening(settings, () => false);
    t.after(() => runtime.stopHardening());
    for (const key of ["allowCamera", "allowMicrophone", "allowDisplayCapture"]) {
        const tracks = ["audio", "video"].map(kind => ({ kind, stopped: false, stop() { this.stopped = true; } }));
        const stream = { getTracks: () => tracks, getAudioTracks: () => [tracks[0]], getVideoTracks: () => [tracks[1]] };
        const pending = key === "allowDisplayCapture" ? mediaDevices.getDisplayMedia({ video: true }) : mediaDevices.getUserMedia({ audio: true, video: true });
        settings[key] = false;
        resolveCapture(stream);
        await assert.rejects(pending, { name: "NotAllowedError" });
        assert.ok(tracks.every(track => track.stopped));
        const before = calls;
        await assert.rejects(key === "allowDisplayCapture" ? mediaDevices.getDisplayMedia() : mediaDevices.getUserMedia({ audio: true, video: true }), { name: "NotAllowedError" });
        assert.equal(calls, before);
        settings[key] = true;
    }
    assert.deepEqual(registered, []);
    const stream = { getAudioTracks: () => [{}], getVideoTracks: () => [] };
    const constraints = { audio: true };
    const pending = mediaDevices.getUserMedia(constraints);
    constraints.audio = false;
    resolveCapture(stream);
    assert.equal(await pending, stream);
    assert.deepEqual(registered, [stream]);
    runtime.stopHardening();
    assert.equal(mediaDevices.getUserMedia, originalMedia);
    assert.equal(mediaDevices.getDisplayMedia, originalDisplay);
});

test("Quest compatibility allows hCaptcha through frame and script restrictions only when enabled", () => {
    for (const questCompatibility of [undefined, true, false]) {
        for (const blockUnknownEmbeds of [undefined, true, false]) {
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
            assert.equal("frame-src" in directives, blockUnknownEmbeds === true);
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
        "./session": await loadSource("session.ts"),
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

test("Attachment warnings distinguish deceptive names from ordinary multiple extensions", () => {
    for (const filename of ["photo.jpg", "archive.tar.gz", "report.final.pdf", "source.test.ts", "日本語.txt", "تقرير.pdf"]) {
        assert.equal(policy.inspectAttachmentName(filename), null, filename);
    }
    for (const filename of ["Invoice.PDF.EXE", "photo.jpg.lnk", "report.doc.cmd"]) {
        assert.ok(policy.inspectAttachmentName(filename).reasons.some(reason => reason.includes("double extension")), filename);
    }
    for (const filename of ["installer.exe", "script.ps1", "photo.jpg.ｅｘｅ", "photo.jpg.exe. "]) {
        assert.ok(policy.inspectAttachmentName(filename).reasons.some(reason => reason.includes("Executable")), filename);
    }
    for (const filename of ["photo\u202Egpj.exe", "photo.jpg\u200B.exe", "fake\nname.pdf"]) {
        const warning = policy.inspectAttachmentName(filename);
        assert.ok(warning.reasons.some(reason => reason.includes("invisible")), filename);
        assert.ok(!/[\p{Cc}\p{Cf}]/u.test(warning.name));
        assert.match(warning.name, /\[U\+[A-F0-9]+\]/);
    }
    assert.ok(policy.inspectAttachmentName("invoice.xlsm").reasons.some(reason => reason.includes("macros")));
    assert.ok(policy.inspectAttachmentName("../file.txt").reasons.some(reason => reason.includes("path separators")));
    const longName = policy.inspectAttachmentName(`${"x".repeat(500)}.pdf.exe`);
    assert.ok(longName.name.length <= 181);
    assert.ok(longName.name.endsWith(".pdf.exe"));
});

test("The local log is bounded, groups bursts and only retains nonidentifying fields", async () => {
    const { session, advance } = await sessionFixture();
    session.recordBlock("telemetry");
    assert.deepEqual(session.getBlockLog(), []);
    session.setBlockRecording(true);
    session.recordBlock("telemetry");
    advance(1000);
    session.recordBlock("telemetry");
    assert.equal(session.getBlockLog()[0].count, 2);
    const snapshot = session.getBlockLog();
    snapshot[0].count = 999;
    assert.equal(session.getBlockLog()[0].count, 2);
    for (let i = 0; i < 120; i++) {
        advance(10_001);
        session.recordBlock("telemetry");
    }
    assert.equal(session.getBlockLog().length, 100);
    for (const entry of session.getBlockLog()) assert.deepEqual(Object.keys(entry).sort(), ["category", "count", "id", "time"]);
    session.setBlockRecording(false);
    assert.deepEqual(session.getBlockLog(), []);
    session.recordBlock("telemetry");
    assert.deepEqual(session.getBlockLog(), []);
});

test("Temporary grants renew, expire and stop capture clones without changing permanent permissions", async () => {
    const { session, timers, advance } = await sessionFixture();
    let changes = 0;
    assert.equal(session.grantTemporaryPermission("allowCamera", 1), false);
    session.startPermissionSession(() => changes++);
    for (const duration of [0, -1, NaN, Infinity, 2, 60]) assert.equal(session.grantTemporaryPermission("allowCamera", duration), false);
    assert.equal(session.grantTemporaryPermission("allowCamera", 1), true);
    const track = { readyState: "live", stop() { this.readyState = "ended"; } };
    const clone = { ...track };
    session.registerTemporaryTracks("allowCamera", [track], false);
    session.registerTemporaryClone(track, clone);
    advance(30_000);
    assert.equal(session.grantTemporaryPermission("allowCamera", 5), true);
    assert.equal(timers.size, 1);
    advance(30_000);
    assert.equal(session.isPermissionAllowed("allowCamera", false), true);
    assert.equal(track.readyState, "live");
    advance(270_000, false);
    assert.equal(session.isPermissionAllowed("allowCamera", false), false);
    assert.equal(session.isPermissionAllowed("allowCamera", true), true);
    advance(0);
    assert.equal(track.readyState, "ended");
    assert.equal(clone.readyState, "ended");
    assert.equal(changes, 3);
    assert.equal(timers.size, 0);
    assert.deepEqual(session.getTemporaryPermissions(), []);
    session.grantTemporaryPermission("allowClipboardRead", 15);
    session.grantTemporaryPermission("allowDisplayCapture", 1);
    session.stopPermissionSession();
    assert.equal(timers.size, 0);
    assert.equal(session.isPermissionAllowed("allowClipboardRead", false), false);
    assert.equal(session.grantTemporaryPermission("allowClipboardRead", 1), false);
});

test("Runtime status checks installed guards, disabled settings, missing APIs and later overrides", async t => {
    const { runtime, window } = await runtimeFixture();
    const settings = { blockTelemetry: true, stripThirdPartyReferrers: false, blockUnsafeExternalProtocols: true };
    runtime.startHardening(settings, () => false);
    t.after(() => runtime.stopHardening());
    const status = name => runtime.getRuntimeProtections().find(item => item.name === name).status;
    assert.equal(status("Fetch request filtering"), "Active");
    assert.equal(status("Fetch referrer protection"), "Disabled");
    assert.equal(status("Camera blocking"), "Unavailable");
    window.fetch = async () => new Response();
    assert.equal(status("Fetch request filtering"), "Not applied");
    settings.blockUnsafeExternalProtocols = false;
    assert.equal(status("Unsafe window blocking"), "Disabled");
    runtime.stopHardening();
    assert.equal(status("Fetch request filtering"), "Disabled");
});

test("Desktop status reflects actual preferences and registered listeners", async () => {
    const { native, sender, event, configure } = await fixture();
    sender.getLastWebPreferences = () => ({ nodeIntegration: false, contextIsolation: true, webSecurity: true, sandbox: false });
    assert.equal(native.getSecurityStatus(event).navigationRestricted, false);
    await configure();
    assert.deepEqual(native.getSecurityStatus(event), {
        nodeIntegration: false, contextIsolation: true, webSecurity: true, sandbox: false,
        navigationRestricted: true, webviewsBlocked: true,
    });
    sender.removeAllListeners("will-redirect");
    assert.equal(native.getSecurityStatus(event).navigationRestricted, false);
    await native.restore(event);
    assert.equal(native.getSecurityStatus(event).webviewsBlocked, false);
    sender.getLastWebPreferences = () => ({});
    assert.equal(native.getSecurityStatus(event).sandbox, null);
    sender.mainFrame.url = "https://attacker.test";
    assert.equal(native.getSecurityStatus(event), null);
});

test("Clipboard grants expire even during a pending read and network log entries omit URLs", async t => {
    const { session, advance } = await sessionFixture();
    let resolveRead;
    const clipboard = { readText: () => new Promise(resolve => { resolveRead = resolve; }) };
    const { runtime, window } = await runtimeFixture({ clipboard }, session);
    const settings = { allowClipboardRead: false, blockTelemetry: true };
    session.startPermissionSession(() => {});
    session.setBlockRecording(true);
    runtime.startHardening(settings, () => false);
    t.after(() => { session.stopPermissionSession(); runtime.stopHardening(); });
    await assert.rejects(clipboard.readText(), { name: "NotAllowedError" });
    session.grantTemporaryPermission("allowClipboardRead", 1);
    const pending = clipboard.readText();
    advance(60_000, false);
    resolveRead("Private clipboard contents");
    await assert.rejects(pending, { name: "NotAllowedError" });
    await window.fetch("https://discord.com/api/v9/science?token=secret&message=private");
    const entries = session.getBlockLog();
    assert.equal(entries.at(-1).category, "telemetry");
    assert.ok(!JSON.stringify(entries).includes("secret"));
    assert.ok(!JSON.stringify(entries).includes("discord.com"));
    assert.equal(settings.allowClipboardRead, false);
});

test("Runtime temporary capture stops original and cloned tracks on revocation", async t => {
    const { session } = await sessionFixture();
    class Track {
        constructor(kind) { this.kind = kind; this.readyState = "live"; }
        stop() { this.readyState = "ended"; }
        clone() { return new Track(this.kind); }
    }
    class Stream {
        constructor(tracks) { this.tracks = tracks; }
        getTracks() { return this.tracks; }
        getAudioTracks() { return this.tracks.filter(track => track.kind === "audio"); }
        getVideoTracks() { return this.tracks.filter(track => track.kind === "video"); }
        clone() { return new Stream(this.tracks.map(track => new Track(track.kind))); }
    }
    const audio = new Track("audio");
    const video = new Track("video");
    const stream = new Stream([audio, video]);
    const mediaDevices = { getUserMedia: async () => stream };
    const { runtime } = await runtimeFixture({ mediaDevices }, session, { MediaStreamTrack: Track, MediaStream: Stream });
    const settings = { allowCamera: false, allowMicrophone: true };
    session.startPermissionSession(() => {});
    runtime.startHardening(settings, () => false);
    t.after(() => { session.stopPermissionSession(); runtime.stopHardening(); });
    await assert.rejects(mediaDevices.getUserMedia({ video: true }), { name: "NotAllowedError" });
    session.grantTemporaryPermission("allowCamera", 1);
    assert.equal(await mediaDevices.getUserMedia({ video: true, audio: true }), stream);
    const clone = video.clone();
    const clonedStream = stream.clone();
    session.revokeTemporaryPermission("allowCamera");
    assert.equal(video.readyState, "ended");
    assert.equal(clone.readyState, "ended");
    assert.equal(audio.readyState, "live");
    assert.equal(clonedStream.getVideoTracks()[0].readyState, "ended");
    assert.equal(clonedStream.getAudioTracks()[0].readyState, "live");
    assert.equal(settings.allowCamera, false);
});

test("Temporary grants cooperate with Discord microphone and camera gates", async t => {
    const { session, advance } = await sessionFixture();
    const actions = [];
    const videos = [];
    const FluxDispatcher = { dispatch: action => actions.push(action) };
    const VoiceActions = { setVideoEnabled: enabled => videos.push(enabled) };
    const originalDispatch = FluxDispatcher.dispatch;
    const originalVideo = VoiceActions.setVideoEnabled;
    const window = new EventTarget();
    const privacy = await loadSource("microphonePrivacy.ts", {
        "@utils/Logger": { Logger: class { warn() {} } },
        "@utils/misc": { isObject: value => typeof value === "object" && value !== null },
        "@webpack/common": {
            FluxDispatcher, VoiceActions,
            MediaEngineStore: { getMediaEngine: () => ({ connections: [] }), getMode: () => "VOICE_ACTIVITY", isSelfMute: () => false },
            SelectedChannelStore: { getVoiceChannelId: () => "call" },
        },
        "./session": session,
    }, { window, MediaStreamTrack: undefined });
    const settings = { allowCamera: false, allowMicrophone: false };
    session.startPermissionSession(() => { privacy.refreshCameraPrivacy(); privacy.refreshMicrophonePrivacy(); });
    privacy.startMicrophonePrivacy(settings);
    t.after(() => { session.stopPermissionSession(); privacy.stopMicrophonePrivacy(); });
    VoiceActions.setVideoEnabled(true);
    FluxDispatcher.dispatch({ type: "MEDIA_ENGINE_SET_AUDIO_ENABLED", enabled: true });
    assert.equal(videos.at(-1), false);
    assert.equal(actions.at(-1).enabled, false);
    session.grantTemporaryPermission("allowCamera", 1);
    session.grantTemporaryPermission("allowMicrophone", 1);
    VoiceActions.setVideoEnabled(true);
    FluxDispatcher.dispatch({ type: "MEDIA_ENGINE_SET_AUDIO_ENABLED", enabled: true });
    assert.equal(videos.at(-1), true);
    assert.equal(actions.at(-1).enabled, true);
    advance(60_000);
    assert.equal(videos.at(-1), false);
    assert.equal(actions.at(-1).enabled, false);
    assert.deepEqual(settings, { allowCamera: false, allowMicrophone: false });
    session.stopPermissionSession();
    privacy.stopMicrophonePrivacy();
    assert.equal(FluxDispatcher.dispatch, originalDispatch);
    assert.equal(VoiceActions.setVideoEnabled, originalVideo);
});
