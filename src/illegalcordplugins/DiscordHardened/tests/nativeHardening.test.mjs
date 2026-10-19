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

async function load(name, dependencies = {}, globals = {}) {
    const source = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
    return evaluate(source, dependencies, globals);
}

async function evaluate(source, dependencies, globals = {}) {
    const { code } = await transform(source, { loader: "ts", format: "cjs" });
    const module = { exports: {} };
    compileFunction(code, ["require", "module", "exports", ...Object.keys(globals)])(name => {
        assert.ok(Object.hasOwn(dependencies, name), name);
        return dependencies[name];
    }, module, module.exports, ...Object.values(globals));
    return module.exports;
}

async function fixture(options = {}) {
    const settings = { plugins: { DiscordHardened: {
        enabled: true, electronPermissionControls: true, sessionFirewall: true,
        goofCordFirewall: false, proxy: false, ...options,
    }, NoTrack: { enabled: false } } };
    const logs = [];
    const logger = { Logger: class {
        info(value) { logs.push(value); }
        warn(value) { logs.push(value); }
        error(value) { logs.push(value); }
    } };
    const text = { escapeRegExp: value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") };
    const session = await load("session.ts");
    const security = await load("nativeSecurity.ts");
    const network = await load("network.ts", { "@utils/Logger": logger, "@utils/text": text });
    let now = 1000;
    const permissions = await load("nativePermissions.ts", {
        "@main/settings": { RendererSettings: { store: settings } },
        "./nativeSecurity": security, "./session": session,
    }, { Date: { now: () => now } });
    const calls = [];
    const handlers = {};
    const ses = {
        setPermissionCheckHandler(handler) { handlers.check = handler; },
        setPermissionRequestHandler(handler) { handlers.request = handler; },
        setDevicePermissionHandler(handler) { handlers.device = handler; },
        webRequest: {
            onBeforeRequest(filter, handler) { handlers.before = typeof filter === "function" || filter === null ? filter : handler; },
            onBeforeSendHeaders(handler) { handlers.headers = handler; },
        },
        async setProxy(value) { calls.push(value); },
        async closeAllConnections() { calls.push("closed"); },
    };
    let ready;
    const app = Object.assign(new EventEmitter(), { whenReady: () => new Promise(resolve => { ready = resolve; }) });
    const nativeSession = await load("nativeSession.ts", {
        "@main/settings": { RendererSettings: { store: settings } },
        "@utils/Logger": logger, "@utils/text": text,
        electron: { app, session: { defaultSession: ses } },
        "./nativePermissions": permissions, "./network": network,
    });
    const native = await load("native.ts", {
        "./browsers": { launchBrowser: async () => false, listInstalledBrowsers: async () => [] },
        "./nativePermissions": permissions, "./nativeSecurity": security, "./nativeSession": nativeSession,
    });
    function sender(id = 1) {
        return Object.assign(new EventEmitter(), {
            id, session: ses, mainFrame: { url: "https://discord.com/channels/@me", origin: "https://discord.com" },
            isDestroyed() { return false; },
            getURL() { return this.mainFrame.url; },
            getUserAgent: () => "Chrome/120 Electron/30 Discord/1",
            setUserAgent() {},
            getLastWebPreferences: () => ({ contextIsolation: true, sandbox: false }),
        });
    }
    const contents = sender();
    const event = { sender: contents, senderFrame: contents.mainFrame };
    const details = { isMainFrame: true, requestingUrl: contents.getURL(), mediaType: "audio", mediaTypes: ["audio"] };
    const request = (url, resourceType = "xhr") => new Promise(resolve => handlers.before({ url, resourceType }, resolve));
    return {
        settings: settings.plugins.DiscordHardened, logs, calls, handlers, ses, app, ready, permissions, security, network,
        nativeSession, native, session, sender, contents, event, details, request, advance: ms => { now += ms; },
    };
}

test("Plugin IPC rejects mismatched and opaque security origins", async () => {
    const f = await fixture();
    assert.equal(f.security.isTrustedSender(f.event), true);
    for (const origin of ["null", "https://canary.discord.com", "https://attacker.invalid"]) {
        f.contents.mainFrame.origin = origin;
        assert.equal(f.security.isTrustedSender(f.event), false);
    }
    f.contents.mainFrame.origin = "https://discord.com";
    assert.equal(f.security.isTrustedSender({ ...f.event, senderFrame: { ...f.contents.mainFrame } }), false);
});

test("Native permissions enforce capability, origin and frame even without renderer guards", async () => {
    const f = await fixture({ allowMicrophone: false, allowCamera: true });
    f.nativeSession.prepareSession(f.ses);
    assert.equal(f.handlers.check(f.contents, "media", "https://discord.com", f.details), false);
    assert.equal(f.handlers.check(f.contents, "media", "https://discord.com", { ...f.details, mediaType: "video" }), true);
    assert.equal(f.handlers.check(f.contents, "media", "https://attacker.invalid", f.details), false);
    assert.equal(f.handlers.check(f.contents, "media", "https://discord.com", { ...f.details, isMainFrame: false }), false);
    assert.equal(f.handlers.check(null, "notifications", "https://discord.com", f.details), false);
    assert.equal(f.handlers.check(f.contents, "unknown", "https://discord.com", f.details), false);
    assert.equal(f.handlers.device({ origin: "https://discord.com", deviceType: "usb" }), false);
});

test("Temporary native permissions are bounded, expire and stay scoped to their window", async () => {
    const f = await fixture({ allowMicrophone: false });
    f.nativeSession.prepareSession(f.ses);
    assert.equal(f.permissions.setTemporaryPermissions(f.event, [{ permission: "allowMicrophone", expiresAt: 61_000 }]), true);
    assert.equal(f.handlers.check(f.contents, "media", "https://discord.com", f.details), true);
    assert.equal(f.handlers.check(f.sender(2), "media", "https://discord.com", f.details), false);
    assert.equal(f.permissions.setTemporaryPermissions(f.event, [{ permission: "allowMicrophone", expiresAt: 1_000_000 }]), false);
    assert.equal(f.permissions.setTemporaryPermissions(f.event, [{ permission: "unknown", expiresAt: 2000 }]), false);
    assert.equal(f.permissions.setTemporaryPermissions({ ...f.event, senderFrame: null }, []), false);
    f.advance(60_000);
    assert.equal(f.handlers.check(f.contents, "media", "https://discord.com", f.details), false);
    f.permissions.setTemporaryPermissions(f.event, []);
    assert.equal(f.contents.listenerCount("destroyed"), 0);
});

test("Revocation during a host permission prompt is checked again before granting", async () => {
    const f = await fixture({ allowMicrophone: false });
    f.nativeSession.prepareSession(f.ses);
    f.permissions.setTemporaryPermissions(f.event, [{ permission: "allowMicrophone", expiresAt: 61_000 }]);
    let complete;
    f.ses.setPermissionRequestHandler((_contents, _permission, callback) => { complete = callback; });
    let granted;
    f.handlers.request(f.contents, "media", value => { granted = value; }, f.details);
    f.permissions.setTemporaryPermissions(f.event, []);
    complete(true);
    assert.equal(granted, false);
});

test("Host permission denials survive later registrations and the control can be disabled", async () => {
    const f = await fixture({ allowMicrophone: false });
    const check = f.ses.setPermissionCheckHandler;
    f.nativeSession.prepareSession(f.ses);
    f.ses.setPermissionCheckHandler(() => false);
    f.ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    f.settings.electronPermissionControls = false;
    assert.equal(f.handlers.check(f.contents, "media", "https://discord.com", f.details), false);
    f.ses.setPermissionCheckHandler(() => true);
    assert.equal(f.handlers.check(f.contents, "media", "https://discord.com", f.details), true);
    await f.nativeSession.releaseSession(f.ses);
    assert.equal(f.ses.setPermissionCheckHandler, check);
    assert.equal(f.handlers.check(f.contents, "media", "https://discord.com", f.details), true);
});

test("Disabling native permission controls at startup preserves Electron's original handlers", async () => {
    const f = await fixture({ electronPermissionControls: false });
    const original = f.ses.setPermissionCheckHandler;
    const host = () => false;
    f.ses.setPermissionCheckHandler(host);
    f.nativeSession.prepareSession(f.ses);
    assert.equal(f.ses.setPermissionCheckHandler, original);
    assert.equal(f.handlers.check, host);
    assert.equal(f.handlers.device, undefined);
    assert.equal(f.nativeSession.getSessionStatus(f.ses).permissionsEnforced, false);
    f.settings.electronPermissionControls = true;
    assert.equal(f.nativeSession.getSessionStatus(f.ses).permissionsEnforced, false);
});

test("Hardware access can be allowed explicitly without overriding a host denial", async () => {
    const f = await fixture({ blockHardwareAccess: false });
    f.nativeSession.prepareSession(f.ses);
    assert.equal(f.handlers.device({ origin: "https://discord.com", deviceType: "usb" }), true);
    assert.equal(f.handlers.device({ origin: "https://attacker.invalid", deviceType: "usb" }), false);
    f.ses.setDevicePermissionHandler(() => false);
    assert.equal(f.handlers.device({ origin: "https://discord.com", deviceType: "usb" }), false);
});

test("Startup requests wait for proxy configuration and old connections to close", async () => {
    const f = await fixture({ proxy: true, proxyRules: "127.0.0.1:8080", proxyBeforeLoad: true });
    let configured;
    let closed;
    f.ses.setProxy = () => new Promise(resolve => { configured = resolve; });
    f.ses.closeAllConnections = () => new Promise(resolve => { closed = resolve; });
    f.ready();
    await Promise.resolve();
    await Promise.resolve();
    let completed = false;
    const pending = f.request("https://discord.com/api/v9/users/@me").then(value => { completed = true; return value; });
    assert.equal(f.nativeSession.getSessionStatus(f.ses).proxyStatus, "Pending");
    assert.equal(completed, false);
    configured();
    await Promise.resolve();
    assert.equal(completed, false);
    closed();
    assert.deepEqual(await pending, { cancel: false });
    assert.equal(f.nativeSession.getSessionStatus(f.ses).proxyStatus, "Active");
});

test("Proxy failure blocks requests while native navigation guards remain installed", async () => {
    const f = await fixture({ proxy: true, proxyRules: "127.0.0.1:8080" });
    f.ses.setProxy = async () => { throw new Error("Private native path"); };
    assert.equal(await f.native.configure(f.event, false, false, false, false, true, "127.0.0.1:8080", "", true, true), true);
    assert.equal(f.native.getSecurityStatus(f.event).proxyStatus, "Failed");
    assert.equal(f.native.getSecurityStatus(f.event).navigationRestricted, true);
    assert.equal(f.native.getSecurityStatus(f.event).webviewsBlocked, true);
    assert.deepEqual(await f.request("https://discord.com/api/v9/users/@me"), { cancel: true });
    assert.equal(f.logs.some(log => log.includes("Private native path")), false);
});

test("Proxy restoration failure keeps session traffic blocked", async () => {
    const f = await fixture({ proxy: true, proxyRules: "127.0.0.1:8080" });
    await f.nativeSession.prepareSession(f.ses).ready;
    f.ses.setProxy = async () => { throw new Error("Private native path"); };
    assert.equal(await f.nativeSession.releaseSession(f.ses), false);
    assert.deepEqual(await f.request("https://discord.com/"), { cancel: true });
});

test("Malformed stored proxy rules block requests without throwing during startup", async () => {
    const f = await fixture({ proxy: true, proxyRules: 42 });
    assert.equal(await f.nativeSession.prepareSession(f.ses).ready, false);
    assert.equal(f.nativeSession.getSessionStatus(f.ses).proxyStatus, "Failed");
    assert.deepEqual(await f.request("https://discord.com/"), { cancel: true });
    assert.equal(f.calls.length, 0);
});

test("Requests also wait for a newer proxy configuration queued during startup", async () => {
    const f = await fixture();
    const completions = [];
    f.ses.setProxy = () => new Promise(resolve => completions.push(resolve));
    const first = f.nativeSession.configureSessionProxy(f.ses, "127.0.0.1:8080", "");
    let completed = false;
    const request = f.request("https://discord.com/").then(value => { completed = true; return value; });
    const second = f.nativeSession.configureSessionProxy(f.ses, "127.0.0.1:9090", "");
    await Promise.resolve();
    completions[0]();
    await first;
    await Promise.resolve();
    assert.equal(completed, false);
    completions[1]();
    assert.equal(await second, true);
    assert.deepEqual(await request, { cancel: false });
});

test("Restoring one window does not reset another window's session proxy", async () => {
    const f = await fixture({ proxy: true, proxyRules: "127.0.0.1:8080" });
    const other = f.sender(2);
    await f.native.configure(f.event, false, false, false, false, true, "127.0.0.1:8080", "", true, true);
    await f.native.configure({ sender: other, senderFrame: other.mainFrame }, false, false, false, false, true, "127.0.0.1:8080", "", true, true);
    assert.equal(await f.native.restore(f.event), true);
    assert.equal(f.calls.some(call => call.mode === "system"), false);
    assert.equal(f.nativeSession.getSessionStatus(f.ses).proxyStatus, "Active");
    assert.equal(await f.native.restore({ sender: other, senderFrame: other.mainFrame }), true);
    assert.equal(f.calls.filter(call => call.mode === "system").length, 1);
});

test("Session filtering covers worker requests and resources and respects its switch", async () => {
    const f = await fixture({ blockTelemetry: true, logBlockedRequests: true });
    f.nativeSession.prepareSession(f.ses);
    for (const resourceType of ["xhr", "script", "subFrame", "image", "other"]) {
        assert.deepEqual(await f.request("https://discord.com/api/v9/science", resourceType), { cancel: true });
    }
    assert.deepEqual(await f.request("https://discord.com/api/v9/users/@me"), { cancel: false });
    assert.equal(f.logs.some(log => /https:|users|science/.test(log)), false);
    f.settings.sessionFirewall = false;
    assert.deepEqual(await f.request("https://discord.com/api/v9/science"), { cancel: false });
});

test("Quest compatibility preserves hCaptcha scripts while explicit firewall rules still apply", async () => {
    const f = await fixture();
    f.nativeSession.prepareSession(f.ses);
    const url = "https://js.hcaptcha.com/1/api.js";
    assert.deepEqual(await f.request(url, "script"), { cancel: false });
    f.settings.questCompatibility = false;
    assert.deepEqual(await f.request(url, "script"), { cancel: true });
    f.settings.questCompatibility = true;
    f.settings.goofCordFirewall = true;
    f.settings.firewallBlocklist = url;
    assert.deepEqual(await f.request(url, "script"), { cancel: true });
});

test("Session filtering preserves host filters, redirects, cancellations and listener removal", async () => {
    const f = await fixture();
    f.nativeSession.prepareSession(f.ses);
    let called = 0;
    f.ses.webRequest.onBeforeRequest({ urls: ["https://*.example.com/*"] }, (_details, callback) => {
        called++;
        callback({ redirectURL: "https://example.org/" });
    });
    assert.deepEqual(await f.request("https://example.com/path"), { redirectURL: "https://example.org/" });
    assert.deepEqual(await f.request("https://sub.example.com/path"), { redirectURL: "https://example.org/" });
    assert.deepEqual(await f.request("https://sub.example.com:8443/path"), { redirectURL: "https://example.org/" });
    assert.deepEqual(await f.request("https://discord.com/path"), { cancel: false });
    assert.equal(called, 3);
    assert.deepEqual(await f.request("https://discord.com/api/v9/science"), { cancel: true });
    f.ses.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }));
    assert.deepEqual(await f.request("https://example.org/"), { cancel: true });
    f.ses.webRequest.onBeforeRequest(null);
    assert.deepEqual(await f.request("https://example.org/"), { cancel: false });
    assert.deepEqual(await f.request("https://discord.com/api/v9/science"), { cancel: true });
});

test("Startup hooks protect default-session windows without changing unrelated sessions", async () => {
    const f = await fixture();
    f.app.emit("web-contents-created", {}, { session: {} });
    assert.equal(f.handlers.before, undefined);
    f.app.emit("web-contents-created", {}, f.contents);
    assert.equal(typeof f.handlers.before, "function");
    f.app.emit("will-quit");
    assert.equal(f.app.listenerCount("web-contents-created"), 0);
    assert.equal(f.handlers.before, null);
    assert.equal(f.handlers.check, null);
});

test("MultiInstance policy preservation keeps original header casing and values", async () => {
    const source = await readFile(new URL("../../MultiInstance/native.ts", import.meta.url), "utf8");
    const functionSource = source.slice(source.indexOf("function removeBlockingHeaders"), source.indexOf("function configureSession"));
    const settings = { plugins: { DiscordHardened: { enabled: true, preserveMultiInstancePolicies: true } } };
    const { removeBlockingHeaders } = await evaluate(functionSource + "\nexport { removeBlockingHeaders };", {}, {
        RendererSettings: { store: settings },
    });
    const headers = {
        "Content-Security-Policy": ["default-src 'self'; script-src 'nonce-secret'"],
        "permissions-policy": ["camera=(), microphone=()"],
        "content-security-policy-report-only": ["default-src 'self'"],
        "Content-Type": ["text/html"],
    };
    const result = removeBlockingHeaders(headers);
    assert.deepEqual(result, headers);
    assert.notEqual(result, headers);
    settings.plugins.DiscordHardened.preserveMultiInstancePolicies = false;
    assert.deepEqual(removeBlockingHeaders(headers), { "Content-Type": ["text/html"] });
    settings.plugins.DiscordHardened.preserveMultiInstancePolicies = true;
    settings.plugins.DiscordHardened.enabled = false;
    assert.deepEqual(removeBlockingHeaders(headers), { "Content-Type": ["text/html"] });
    assert.deepEqual(removeBlockingHeaders(undefined), {});
});

async function rendererFixture(navigator = {}) {
    const f = await fixture();
    const requests = [];
    const opened = [];
    const window = {
        fetch: async (...args) => { requests.push(args); return new Response(null, { status: 200 }); },
        open: (...args) => { opened.push(args); return null; },
    };
    const runtime = await load("runtime.ts", {
        "@api/PluginManager": { isPluginEnabled: () => false },
        "@api/UserSettings": { getUserSetting: () => null },
        "@utils/Logger": { Logger: class { warn() {} info() {} } },
        "./microphonePrivacy": { registerMicrophoneStream() {} },
        "./network": f.network, "./session": f.session,
    }, {
        navigator, window, Navigator: undefined, HTMLCanvasElement: undefined, Notification: undefined, Element: undefined,
        XMLHttpRequest: class { open() {} send() {} },
        location: { href: "https://discord.com/channels/@me", origin: "https://discord.com" },
    });
    return { ...f, runtime, window, requests, opened };
}

test("Renderer filtering still shares the same rules and restores the original fetch", async () => {
    const f = await rendererFixture();
    const original = f.window.fetch;
    f.settings.blockTelemetry = true;
    f.settings.stripThirdPartyReferrers = true;
    f.runtime.startHardening(f.settings, () => false);
    assert.equal((await f.window.fetch("https://discord.com/api/v9/science")).status, 204);
    assert.equal(f.requests.length, 0);
    assert.equal((await f.window.fetch("https://discord.com/api/v9/users/@me")).status, 200);
    assert.equal(f.requests[0][1].referrerPolicy, "no-referrer");
    assert.equal(f.requests[0][1].referrer, "");
    f.runtime.stopHardening();
    assert.equal(f.window.fetch, original);
});

test("Renderer window protections still reject unsafe URLs and isolate external windows", async () => {
    const f = await rendererFixture();
    f.settings.blockUnsafeExternalProtocols = true;
    f.settings.isolateExternalWindows = true;
    f.settings.stripThirdPartyReferrers = true;
    f.runtime.startHardening(f.settings, () => false);
    f.window.open("javascript:alert(1)");
    assert.equal(f.opened.length, 0);
    f.window.open("https://example.com/path", "_blank", "noopener=false,noreferrer=0");
    assert.equal(f.opened.length, 1);
    assert.equal(f.opened[0][2], ",noopener,noreferrer");
    f.runtime.stopHardening();
});

test("Renderer temporary media capture still stops tracks when revoked", async () => {
    const track = { kind: "audio", readyState: "live", stop() { this.readyState = "ended"; } };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [] };
    const devices = { getUserMedia: async () => stream };
    const original = devices.getUserMedia;
    const f = await rendererFixture({ mediaDevices: devices });
    f.settings.allowMicrophone = false;
    f.session.startPermissionSession(() => {});
    f.runtime.startHardening(f.settings, () => false);
    try {
        await assert.rejects(devices.getUserMedia({ audio: true }), { name: "NotAllowedError" });
        assert.equal(f.session.grantTemporaryPermission("allowMicrophone", 1), true);
        assert.equal(await devices.getUserMedia({ audio: true }), stream);
        f.session.revokeTemporaryPermission("allowMicrophone");
        assert.equal(track.readyState, "ended");
    } finally {
        f.runtime.stopHardening();
        f.session.stopPermissionSession();
    }
    assert.equal(devices.getUserMedia, original);
});
