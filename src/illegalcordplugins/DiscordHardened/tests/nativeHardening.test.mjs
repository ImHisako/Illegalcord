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
    const requestLog = await load("requestLog.ts");
    const nativeRequestLog = await load("nativeRequestLog.ts", { "./requestLog": requestLog });
    const nativeAdvancedLog = await load("nativeAdvancedLog.ts", { "@utils/misc": { isObject: value => typeof value === "object" && value !== null && !Array.isArray(value) }, "./requestLog": requestLog, "./nativeSecurity": security });
    const ses = {
        setPermissionCheckHandler(handler) { handlers.check = handler; },
        setPermissionRequestHandler(handler) { handlers.request = handler; },
        setDevicePermissionHandler(handler) { handlers.device = handler; },
        webRequest: {
            onBeforeRequest(filter, handler) { handlers.before = typeof filter === "function" || filter === null ? filter : handler; },
            onBeforeSendHeaders(handler) { handlers.headers = handler; },
            onCompleted(handler) { handlers.completed = handler; },
            onBeforeRedirect(handler) { handlers.redirect = handler; },
            onErrorOccurred(handler) { handlers.error = handler; },
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
        "./nativeRequestLog": nativeRequestLog,
    });
    const native = await load("native.ts", {
        "./browsers": { launchBrowser: async () => false, listInstalledBrowsers: async () => [] },
        "./nativePermissions": permissions, "./nativeSecurity": security, "./nativeSession": nativeSession,
        "./nativeAdvancedLog": nativeAdvancedLog,
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
    let requestId = 0;
    const request = (url, resourceType = "xhr") => new Promise(resolve => handlers.before({ id: ++requestId, method: "GET", url, resourceType }, resolve));
    return {
        settings: settings.plugins.DiscordHardened, logs, calls, handlers, ses, app, ready, permissions, security, network,
        nativeSession, native, session, sender, contents, event, details, request, requestLog, advance: ms => { now += ms; },
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

test("Advanced capture IPC validates toggles and releases the debugger when disabled", async () => {
    const f = await fixture({ recordWebSocketMessages: true });
    let attached = false;
    f.contents.isDevToolsOpened = () => false;
    f.contents.debugger = Object.assign(new EventEmitter(), {
        isAttached: () => attached,
        attach() { attached = true; },
        detach() { attached = false; this.emit("detach"); },
        async sendCommand() {},
    });
    assert.equal(await f.native.configureRequestCapture({ ...f.event, senderFrame: null }, true, true), null);
    assert.equal(await f.native.configureRequestCapture(f.event, "true", true), null);
    assert.equal(attached, false);
    assert.equal(await f.native.configureRequestCapture(f.event, true, false), true);
    assert.equal(attached, true);
    assert.equal(f.native.getRequestLog(f.event).advanced.webSockets, "Active");
    assert.equal(await f.native.configureRequestCapture(f.event, false, false), true);
    assert.equal(attached, false);
    assert.equal(f.contents.debugger.listenerCount("message"), 0);
    assert.equal(f.contents.listenerCount("destroyed"), 0);
    await f.nativeSession.releaseSession(f.ses);
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

test("Saved request rules block resources and new WebSocket connections with logging and the session firewall disabled", async () => {
    const target = "https://media.discordapp.net/assets/video.mp4";
    const socket = "wss://gateway.discord.gg/";
    const f = await fixture({ sessionFirewall: false, recordNetworkRequests: false, blockedRequestUrls: `${target}\n${socket}` });
    f.nativeSession.prepareSession(f.ses);
    for (const resource of ["image", "media", "script", "subFrame", "xhr", "other"])
        assert.deepEqual(await f.request(`${target}?signature=secret`, resource), { cancel: true });
    assert.deepEqual(await f.request(`${socket}?v=9&encoding=json`, "webSocket"), { cancel: true });
    assert.deepEqual(await f.request(`${target}/preview`, "media"), { cancel: false });
    assert.deepEqual(await f.request("https://other.example/assets/video.mp4", "media"), { cancel: false });
    assert.deepEqual(f.native.getRequestLog(f.event).entries, []);
    f.settings.allowedRequestUrls = target;
    assert.deepEqual(await f.request(target, "media"), { cancel: false });
    f.settings.allowedRequestUrls = "";
    f.settings.blockedRequestUrls = "";
    assert.deepEqual(await f.request(target, "media"), { cancel: false });
    await f.nativeSession.releaseSession(f.ses);
});

test("Allow rules override this plugin's filters and reset restores the built in block", async () => {
    const target = "https://discord.com/api/v9/science";
    const f = await fixture({ goofCordFirewall: true, allowedRequestUrls: target, blockedRequestUrls: target });
    f.nativeSession.prepareSession(f.ses);
    assert.deepEqual(await f.request(`${target}?test=1`), { cancel: false });
    f.settings.allowedRequestUrls = "";
    assert.deepEqual(await f.request(target), { cancel: true });
    f.settings.blockedRequestUrls = "";
    assert.deepEqual(await f.request(target), { cancel: true });
    f.settings.allowedRequestUrls = target;
    f.ses.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }));
    assert.deepEqual(await f.request(target), { cancel: true });
    await f.nativeSession.releaseSession(f.ses);
});

test("Rule targets normalize URLs and reject local events, hidden URLs and invalid lists", async () => {
    const { network } = await fixture();
    assert.equal(network.getRequestRuleTarget("HTTPS://EXAMPLE.COM:443/file?token=secret#part"), "https://example.com/file");
    for (const url of ["Voice engine", "Existing WebSocket connection", "data:,secret", "blob:https://discord.com/id", "file:///private", "https://user:password@example.com/file", "https://discord.com/api/webhooks/123/[redacted]", `https://example.com/${"a".repeat(2048)}`])
        assert.equal(network.getRequestRuleTarget(url), null);
    assert.equal(network.validateRequestRuleList(""), true);
    assert.equal(network.validateRequestRuleList("https://EXAMPLE.com/file\nwss://gateway.discord.gg/"), true);
    assert.equal(network.getRequestRuleDecision("https://example.com/", { blockedRequestUrls: "\n".repeat(200) + "https://example.com/" }), "Block");
    assert.equal(network.getRequestRuleDecision("https://example.com/", { blockedRequestUrls: ["https://example.com/"] }), null);
    for (const value of ["https://example.com/*", "https://example.com/file?token=secret", "https://example.com/#fragment", "file:///private", Array(201).fill("https://example.com/").join("\n")])
        assert.equal(typeof network.validateRequestRuleList(value), "string");
});

test("Request logs redact credentials and URL secrets before storing or exporting", async () => {
    const { createRequestLog, sanitizeRequestUrl } = await load("requestLog.ts");
    const log = createRequestLog(() => ({}));
    for (const [url, expected] of [
        ["https://user:password@discord.com/api/v9/webhooks/123/secret/messages/@original?token=secret#private", "https://discord.com/api/v9/webhooks/123/[redacted]/messages/@original"],
        ["https://discord.com/api/v9/interactions/123/secret/callback", "https://discord.com/api/v9/interactions/123/[redacted]/callback"],
        ["https://discord.gg/secret", "https://discord.gg/[redacted]"],
        ["https://discord.gift/secret", "https://discord.gift/[redacted]"],
        ["https://discord.com/api/v9/invites/secret", "https://discord.com/api/v9/invites/[redacted]"],
        ["wss://gateway.discord.gg/?token=secret", "wss://gateway.discord.gg/"],
    ]) {
        assert.equal(sanitizeRequestUrl(url), expected);
        log.record({ url, method: "GET", resourceType: "xhr", source: "Desktop", state: "Pending" });
    }
    for (const url of ["invalid", "data:secret", "file:///private", "javascript:secret"])
        assert.equal(sanitizeRequestUrl(url), null);
    assert.equal(JSON.stringify(log.snapshot()).includes("secret"), false);
    const snapshot = log.snapshot();
    snapshot.entries[0].url = "tampered";
    assert.notEqual(log.snapshot().entries[0].url, "tampered");
});

test("Request logs enforce live retention limits, pause capture and ignore cleared completions", async () => {
    let now = 1000;
    const { createRequestLog } = await load("requestLog.ts", {}, { Date: { now: () => now } });
    const settings = { requestLogLimit: 100, requestLogRetention: 5 };
    const log = createRequestLog(() => settings);
    const request = { url: "https://discord.com/api/v9/users/@me", method: "GET", resourceType: "xhr", source: "Desktop", state: "Pending" };
    for (let id = 0; id < 150; id++) log.record(request, id);
    assert.equal(log.snapshot().entries.length, 100);
    settings.recordNetworkRequests = false;
    log.record(request, 150);
    assert.equal(log.snapshot().entries.length, 100);
    now += 1000;
    log.finish(149, { state: "Completed", status: 200 });
    assert.equal(log.snapshot().entries.at(-1).duration, 1000);
    log.clear();
    log.finish(148, { state: "Completed", status: 200 });
    assert.deepEqual(log.snapshot().entries, []);
    settings.recordNetworkRequests = true;
    log.record(request);
    now += 300_001;
    log.prune();
    assert.deepEqual(log.snapshot().entries, []);
    settings.requestLogRetention = 0;
    log.record(request);
    now += 100_000_000;
    assert.equal(log.snapshot().entries.length, 1);
    settings.enabled = false;
    assert.deepEqual(log.snapshot().entries, []);
});

test("Desktop capture records all resource types, redirects, failures and firewall denials", async () => {
    const f = await fixture({ blockTelemetry: true });
    f.nativeSession.prepareSession(f.ses);
    for (const type of ["mainFrame", "subFrame", "stylesheet", "script", "image", "font", "xhr", "media", "webSocket", "other"])
        await f.request("https://discord.com/resource?private=value", type);
    f.handlers.completed({ id: 1, statusCode: 200, fromCache: true });
    f.handlers.redirect({ id: 2, statusCode: 302, fromCache: false });
    f.handlers.completed({ id: 3, statusCode: 404, fromCache: false });
    f.handlers.error({ id: 4, error: "net::ERR_CONNECTION_REFUSED", fromCache: false });
    await f.request("https://discord.com/api/v9/science");
    const log = f.native.getRequestLog(f.event);
    assert.equal(log.entries.length, 11);
    assert.equal(log.entries[0].state, "Completed");
    assert.equal(log.entries[0].fromCache, true);
    assert.equal(log.entries[1].state, "Redirected");
    assert.equal(log.entries[2].state, "Failed");
    assert.equal(log.entries[2].status, 404);
    assert.equal(log.entries[3].detail, "net::ERR_CONNECTION_REFUSED");
    assert.equal(log.entries.at(-1).state, "Blocked");
    assert.ok(log.entries.every(entry => !entry.url.includes("?")));
    assert.equal(f.native.getRequestLog({ ...f.event, senderFrame: null }), null);
    assert.equal(f.native.clearRequestLog({ ...f.event, senderFrame: null }), false);
    assert.equal(f.native.getRequestLog({ ...f.event, sender: { ...f.contents, session: {} } }), null);
    assert.equal(f.native.clearRequestLog(f.event), true);
    f.handlers.completed({ id: 10, statusCode: 200 });
    assert.deepEqual(f.native.getRequestLog(f.event).entries, []);
    await f.nativeSession.releaseSession(f.ses);
    assert.equal(f.handlers.completed, null);
    assert.equal(f.handlers.redirect, null);
    assert.equal(f.handlers.error, null);
});

test("Request cleanup runs while idle and releases its timer and listeners", async () => {
    let now = 1000;
    let cleanup;
    let cleared = false;
    const requestLog = await load("requestLog.ts", {}, { Date: { now: () => now } });
    const nativeRequestLog = await load("nativeRequestLog.ts", { "./requestLog": requestLog }, {
        setInterval: callback => { cleanup = callback; return { unref() {} }; },
        clearInterval: () => { cleared = true; },
    });
    const handlers = {};
    const ses = { webRequest: {
        onCompleted: callback => { handlers.completed = callback; },
        onBeforeRedirect: callback => { handlers.redirect = callback; },
        onErrorOccurred: callback => { handlers.error = callback; },
    } };
    const capture = nativeRequestLog.installRequestLog(ses, () => ({ requestLogRetention: 5 }));
    capture.begin({ id: 1, url: "https://discord.com/", method: "GET", resourceType: "mainFrame" });
    const { revision } = capture.log.snapshot();
    now += 300_001;
    cleanup();
    assert.ok(capture.log.snapshot().revision > revision);
    assert.deepEqual(capture.log.snapshot().entries, []);
    capture.stop();
    assert.equal(cleared, true);
    assert.deepEqual(handlers, { completed: null, redirect: null, error: null });
});

test("Browser capture observes new resource loads, honors pause and disconnects on stop", async () => {
    const requestLog = await load("requestLog.ts");
    let receive;
    let disconnected = false;
    let cleared = false;
    let observation;
    class Timing {
        constructor(values) { Object.assign(this, values); }
    }
    const capture = await load("requestCapture.ts", {
        "./requestLog": requestLog,
        "./voiceRequestLog": { installVoiceRequestLog: () => null },
        "@utils/Logger": { Logger: class { warn() {} } },
    }, {
        PerformanceResourceTiming: Timing,
        PerformanceObserver: class {
            constructor(callback) { receive = callback; }
            observe(options) { observation = options; }
            disconnect() { disconnected = true; }
        },
        performance: { now: () => 100, timeOrigin: Date.now() },
        setInterval: () => 1,
        clearInterval: () => { cleared = true; },
    });
    const settings = { recordNetworkRequests: true };
    capture.startRequestLogging(settings, false);
    assert.deepEqual(observation, { type: "resource", buffered: true });
    const entry = { name: "https://discord.com/resource?secret=value", startTime: 120, initiatorType: "fetch", duration: 12, responseStatus: 200 };
    receive({ getEntries: () => [new Timing({ ...entry, startTime: 80 }), new Timing(entry)] });
    assert.equal(capture.browserRequestLog.snapshot().entries.length, 1);
    assert.equal(capture.browserRequestLog.snapshot().entries[0].url, "https://discord.com/resource");
    settings.recordNetworkRequests = false;
    receive({ getEntries: () => [new Timing(entry)] });
    assert.equal(capture.browserRequestLog.snapshot().entries.length, 1);
    capture.stopRequestLogging();
    assert.equal(disconnected, true);
    assert.equal(cleared, true);
    assert.deepEqual(capture.browserRequestLog.snapshot().entries, []);
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
    const recorded = [];
    f.runtime.startHardening(f.settings, () => false, request => recorded.push(request));
    assert.equal((await f.window.fetch("https://discord.com/api/v9/science")).status, 204);
    assert.equal(f.requests.length, 0);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].state, "Blocked");
    assert.equal(recorded[0].source, "Firewall");
    assert.equal((await f.window.fetch("https://discord.com/api/v9/users/@me")).status, 200);
    assert.equal(f.requests[0][1].referrerPolicy, "no-referrer");
    assert.equal(f.requests[0][1].referrer, "");
    f.runtime.stopHardening();
    assert.equal(f.window.fetch, original);
});

test("Renderer rules can block, allow and reset an endpoint without restarting", async () => {
    const f = await rendererFixture();
    const target = "https://example.com/video.mp4";
    const entries = [];
    f.settings.blockedRequestUrls = target;
    f.runtime.startHardening(f.settings, () => false, entry => entries.push(entry));
    try {
        assert.equal((await f.window.fetch(`${target}?part=1`, { method: "POST" })).status, 204);
        assert.equal(f.requests.length, 0);
        assert.equal(entries[0].detail, "Request rule");
        f.settings.allowedRequestUrls = target;
        assert.equal((await f.window.fetch(`${target}?part=2`)).status, 200);
        assert.equal(f.requests.length, 1);
        f.settings.allowedRequestUrls = "";
        f.settings.blockedRequestUrls = "";
        assert.equal((await f.window.fetch(target)).status, 200);
        assert.equal(f.requests.length, 2);
    } finally {
        f.runtime.stopHardening();
    }
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
