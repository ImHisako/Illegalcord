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
    const { code } = await transform(source, { loader: "ts", format: "cjs" });
    const module = { exports: {} };
    compileFunction(code, ["require", "module", "exports", ...Object.keys(globals)])(name => {
        assert.ok(Object.hasOwn(dependencies, name), name);
        return dependencies[name];
    }, module, module.exports, ...Object.values(globals));
    return module.exports;
}

const misc = { isObject: value => typeof value === "object" && value !== null && !Array.isArray(value) };
const requestLog = await load("requestLog.ts");
const security = await load("nativeSecurity.ts");
const { createAdvancedRequestLog } = await load("nativeAdvancedLog.ts", { "@utils/misc": misc, "./requestLog": requestLog, "./nativeSecurity": security });

async function fixture(options = {}) {
    const settings = { recordWebSocketMessages: true, recordLocalResources: true, ...options };
    const log = requestLog.createRequestLog(() => settings);
    const calls = [];
    let attached = false;
    let destroyed = false;
    const debuggerApi = Object.assign(new EventEmitter(), {
        isAttached: () => attached,
        attach(version) { calls.push(["attach", version]); attached = true; },
        detach() { calls.push(["detach"]); attached = false; this.emit("detach"); },
        async sendCommand(...args) { calls.push(args); },
    });
    const contents = Object.assign(new EventEmitter(), {
        id: 1,
        debugger: debuggerApi,
        isDestroyed: () => destroyed,
        isDevToolsOpened: () => false,
    });
    const capture = createAdvancedRequestLog(contents, log, true, true);
    const emit = (method, params, session = "") => debuggerApi.emit("message", {}, method, params, session);
    const destroy = () => { destroyed = true; contents.emit("destroyed"); };
    await capture.start();
    return { settings, log, calls, debuggerApi, contents, capture, emit, destroy };
}

test("WebSocket messages retain direction, opcode and byte size without payloads or URL secrets", async () => {
    const f = await fixture();
    f.emit("Network.webSocketCreated", { requestId: "1", url: "wss://gateway.discord.gg/?token=SECRET" });
    f.emit("Network.webSocketFrameSent", { requestId: "1", response: { opcode: 1, payloadData: "SECRET🔒" } });
    f.emit("Network.webSocketFrameReceived", { requestId: "1", response: { opcode: 2, payloadData: Buffer.from("SECRET").toString("base64") } });
    f.emit("Network.webSocketFrameReceived", { requestId: "existing", response: { opcode: 1, payloadData: "SECRET" } });
    const { entries } = f.log.snapshot();
    assert.equal(entries.length, 3);
    assert.equal(entries[0].method, "SEND");
    assert.equal(entries[0].bytes, Buffer.byteLength("SECRET🔒"));
    assert.equal(entries[0].url, "wss://gateway.discord.gg/");
    assert.equal(entries[1].method, "RECEIVE");
    assert.equal(entries[1].opcode, 2);
    assert.equal(entries[1].bytes, 6);
    assert.equal(entries[2].url, "Existing WebSocket connection");
    assert.equal(JSON.stringify(entries).includes("SECRET"), false);
    f.capture.stop();
});

test("Local resource payloads and blob identifiers are redacted before retention", async () => {
    const f = await fixture();
    for (const [id, url] of [["data", "data:image/png;base64,SECRET"], ["blob", "blob:https://discord.com/SECRET"]]) {
        f.emit("Network.requestWillBeSent", { requestId: id, request: { url, method: "GET" }, type: "Image" });
        f.emit("Network.responseReceived", { requestId: id, response: { status: 200 } });
        f.emit("Network.loadingFinished", { requestId: id });
    }
    const { entries } = f.log.snapshot();
    assert.equal(entries[0].url, "data:image/png;[redacted]");
    assert.equal(entries[1].url, "blob:https://discord.com/[redacted]");
    assert.ok(entries.every(entry => entry.source === "Local" && entry.state === "Completed" && entry.status === 200));
    assert.equal(JSON.stringify(entries).includes("SECRET"), false);
    assert.equal(requestLog.sanitizeRequestUrl("data:text/html,SECRET"), null);
    f.capture.stop();
});

test("Optional sources require opt in and obey pause, clearing and resource failure events", async () => {
    const f = await fixture({ recordWebSocketMessages: false, recordLocalResources: false });
    f.emit("Network.webSocketFrameSent", { requestId: "1", response: { opcode: 1, payloadData: "SECRET" } });
    f.emit("Network.requestWillBeSent", { requestId: "2", request: { url: "data:,SECRET" } });
    assert.deepEqual(f.log.snapshot().entries, []);
    f.settings.recordLocalResources = true;
    f.emit("Network.requestWillBeSent", { requestId: "3", request: { url: "data:,SECRET" } });
    f.emit("Network.loadingFailed", { requestId: "3", errorText: "SECRET" });
    assert.equal(f.log.snapshot().entries[0].state, "Failed");
    assert.equal(JSON.stringify(f.log.snapshot()).includes("SECRET"), false);
    f.settings.recordNetworkRequests = false;
    f.emit("Network.requestWillBeSent", { requestId: "4", request: { url: "data:,SECRET" } });
    assert.equal(f.log.snapshot().entries.length, 1);
    f.log.clear();
    f.emit("Network.loadingFinished", { requestId: "4" });
    assert.deepEqual(f.log.snapshot().entries, []);
    f.capture.stop();
});

test("Frame and worker sessions are instrumented without pausing them", async () => {
    const f = await fixture();
    f.emit("Target.attachedToTarget", { sessionId: "worker" });
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(f.calls.some(([method, , session]) => method === "Network.enable" && session === "worker"));
    assert.ok(f.calls.some(([method, params, session]) => method === "Target.setAutoAttach" && session === "worker" && params.waitForDebuggerOnStart === false));
    f.emit("Network.webSocketCreated", { requestId: "1", url: "wss://worker.example.test/" }, "worker");
    f.emit("Network.webSocketFrameReceived", { requestId: "1", response: { opcode: 1, payloadData: "SECRET" } }, "worker");
    assert.equal(f.log.snapshot().entries[0].url, "wss://worker.example.test/");
    f.capture.stop();
});

test("Detach and shutdown report unavailable capture and release listeners", async () => {
    const f = await fixture();
    assert.equal(f.capture.status().webSockets, "Active");
    f.emit("Network.requestWillBeSent", { requestId: "1", request: { url: "data:,SECRET" } });
    f.debuggerApi.detach();
    assert.equal(f.capture.status().webSockets, "Unavailable");
    assert.match(f.capture.status().error, /disconnected/);
    assert.equal(f.log.snapshot().entries[0].state, "Failed");
    f.capture.stop();
    assert.equal(f.debuggerApi.listenerCount("message"), 0);
    assert.equal(f.debuggerApi.listenerCount("detach"), 0);
    assert.equal(f.contents.listenerCount("destroyed"), 0);
    const destroyed = await fixture();
    destroyed.destroy();
    assert.equal(destroyed.debuggerApi.listenerCount("message"), 0);
});

test("Advanced capture does not take over an attached debugger or open DevTools", async () => {
    const f = await fixture();
    const other = createAdvancedRequestLog(f.contents, f.log, true, true);
    await other.start();
    assert.equal(other.status().webSockets, "Unavailable");
    other.stop();
    assert.equal(f.debuggerApi.isAttached(), true);
    assert.equal(f.capture.status().webSockets, "Active");
    f.capture.stop();
    f.contents.isDevToolsOpened = () => true;
    const devTools = createAdvancedRequestLog(f.contents, f.log, true, false);
    await devTools.start();
    assert.equal(devTools.status().webSockets, "Unavailable");
    assert.equal(f.debuggerApi.isAttached(), false);
});

test("Advanced observation stops if the main window leaves Discord", async () => {
    const f = await fixture();
    f.contents.emit("did-navigate", {}, "https://discord.com/channels/@me");
    assert.equal(f.capture.status().webSockets, "Active");
    f.contents.emit("did-navigate", {}, "https://example.test/");
    assert.equal(f.debuggerApi.isAttached(), false);
    assert.equal(f.capture.status().webSockets, "Unavailable");
    assert.equal(f.contents.listenerCount("did-navigate"), 0);
});

test("Failed or cancelled startup releases only the debugger owned by capture", async () => {
    const f = await fixture();
    f.capture.stop();
    f.debuggerApi.sendCommand = async () => { throw new Error("SECRET"); };
    const failed = createAdvancedRequestLog(f.contents, f.log, true, true);
    await failed.start();
    assert.equal(f.debuggerApi.isAttached(), false);
    assert.equal(f.debuggerApi.listenerCount("message"), 0);
    assert.equal(failed.status().webSockets, "Unavailable");
    assert.equal(failed.status().error.includes("SECRET"), false);
    let complete;
    f.debuggerApi.sendCommand = () => new Promise(resolve => { complete = resolve; });
    const cancelled = createAdvancedRequestLog(f.contents, f.log, true, true);
    const starting = cancelled.start();
    cancelled.stop();
    complete({});
    await starting;
    assert.equal(f.debuggerApi.isAttached(), false);
    assert.equal(f.debuggerApi.listenerCount("message"), 0);
});

test("Voice diagnostics keep only supported numeric counters and release engine listeners", async () => {
    const emitter = new EventEmitter();
    const connection = new EventEmitter();
    connection.on("error", () => {});
    const voice = await load("voiceRequestLog.ts", {
        "@utils/misc": misc,
        "@webpack/common": { MediaEngineStore: { getMediaEngine: () => ({ emitter, connections: new Set([{ emitter: connection }]) }) } },
    });
    const log = requestLog.createRequestLog(() => ({ recordVoiceDiagnostics: true }));
    const stop = voice.installVoiceRequestLog(log);
    const stats = { token: "SECRET", transport: { ping: 42, bytesSent: 1024, localAddress: "SECRET" }, rtp: { outbound: [{ bytesSent: 512, packetsSent: 10, audioLevel: 0.5, userId: "SECRET" }] } };
    emitter.emit("connection-stats", "SECRET", stats);
    connection.emit("connected", { token: "SECRET" });
    connection.emit("error", new Error("SECRET"));
    const { entries } = log.snapshot();
    assert.match(entries[0].detail, /transport.ping: 42/);
    assert.match(entries[0].detail, /outbound.0.packetsSent: 10/);
    assert.equal(entries[1].resourceType, "voiceConnection");
    assert.equal(entries[2].state, "Failed");
    assert.equal(JSON.stringify(entries).includes("SECRET"), false);
    assert.equal(JSON.stringify(entries).includes("audioLevel"), false);
    stop();
    assert.equal(emitter.listenerCount("connection-stats"), 0);
    assert.equal(emitter.listenerCount("connection"), 0);
    assert.equal(connection.listenerCount("connected"), 0);
    assert.equal(connection.listenerCount("error"), 1);
    assert.equal(connection.listenerCount("destroy"), 0);
});

test("Voice counters are bounded and malformed or unsupported stats do not expose raw values", async () => {
    const voice = await load("voiceRequestLog.ts", { "@utils/misc": misc, "@webpack/common": {} });
    assert.equal(voice.summarizeVoiceStats([null, "SECRET", { token: "SECRET", ping: NaN, bytesSent: -1 }]), "Voice statistics received without supported counters.");
    const many = { rtp: { outbound: Array.from({ length: 1000 }, () => ({ bytesSent: 1, packetsSent: 2, packetsLost: 3, ping: 4, token: "SECRET" })) } };
    assert.ok(voice.summarizeVoiceStats([many]).split(", ").length <= 64);
});
