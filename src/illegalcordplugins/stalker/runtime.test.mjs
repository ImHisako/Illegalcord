/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { compileFunction } from "node:vm";

import { transformSync } from "esbuild";

const sources = Object.fromEntries(["index.tsx", "activity.ts", "status.ts", "voice.ts"].map(file => [file,
    transformSync(readFileSync(new URL(file, import.meta.url), "utf8"), { loader: "tsx", format: "cjs" }).code
]));

function fixture(options = {}) {
    const f = {
        statuses: {}, activities: {}, clients: {}, voices: {}, logs: [], notifications: [], errors: [],
        presenceListeners: new Set(), voiceListeners: new Set(), messages: new Set(),
        fullStateReads: 0, activityReads: 0, statusReads: 0, voiceMemberReads: 0, messageCalls: 0
    };
    const lifecycle = () => ({ init() {}, deinit() {} });
    const activity = lifecycle();
    const status = lifecycle();
    const voice = lifecycle();
    const voiceStore = {
        addChangeListener: listener => f.voiceListeners.add(listener),
        removeChangeListener: listener => f.voiceListeners.delete(listener),
        getVoiceStateForUser: id => f.voices[id],
        getVoiceStatesForChannel() { f.voiceMemberReads++; return f.voices; }
    };
    const user = id => ({ id, username: `user${id}`, getAvatarURL: () => "avatar" });
    const common = {
        PresenceStore: {
            addChangeListener: listener => f.presenceListeners.add(listener),
            removeChangeListener: listener => f.presenceListeners.delete(listener),
            getStatus(id) { f.statusReads++; return f.statuses[id] ?? "offline"; },
            getState() { f.fullStateReads++; return { statuses: f.statuses }; },
            getActivities(id) { f.activityReads++; return f.activities[id] ?? []; },
            getClientStatus: id => f.clients[id]
        },
        VoiceStateStore: voiceStore,
        UserStore: { getUser: user }, GuildStore: { getGuild: id => ({ id, name: "Guild" }) },
        ChannelStore: { getChannel: id => ({ id, name: "Voice", guild_id: "guild", isGuildVoice: () => true, isGuildStageVoice: () => false }), getDMFromUserId: id => id },
        NavigationRouter: { transitionTo() {} }, Menu: {},
        FluxDispatcher: {
            subscribe(event, listener) { assert.equal(event, "MESSAGE_CREATE"); f.messages.add(listener); },
            unsubscribe(event, listener) { assert.equal(event, "MESSAGE_CREATE"); assert.ok(f.messages.delete(listener)); }
        }
    };
    const dependencies = {
        "@api/ContextMenu": {},
        "@api/Settings": { definePluginSettings(def) {
            const values = { ...Object.fromEntries(Object.entries(def).map(([key, value]) => [key, value.default])), ...options };
            return { store: new Proxy(values, { set(target, key, value) { target[key] = value; def[key].onChange?.(value); return true; } }), def };
        } },
        "@components/Button": {}, "@illegalcordplugins/legalWarnings": {},
        "@utils/constants": { EquicordDevs: {} },
        "@utils/Logger": { Logger: class { error(...args) { f.errors.push(args); } warn() {} } },
        "@utils/types": { __esModule: true, default: plugin => plugin, OptionType: {} },
        "@api/Notifications": { async showNotification(data) { f.notifications.push(data); } },
        "@webpack/common": common,
        "@webpack": { findByPropsLazy: () => ({ selectVoiceChannel() {} }), findStoreLazy: () => voiceStore },
        "@vencord/discord-types/enums": { ActivityType: { PLAYING: 0, STREAMING: 1, LISTENING: 2, WATCHING: 3, CUSTOM_STATUS: 4, COMPETING: 5, HANG_STATUS: 6 } },
        "./activity": activity, "./status": status, "./voice": voice
    };
    const native = {
        async appendStalkerLog(contents) { f.logs.push(JSON.parse(contents)); return { success: true }; },
        readStalkerLog() { throw new Error("Renderer must not load the log history"); },
        writeStalkerLog() { throw new Error("Renderer must not rewrite the log history"); }
    };
    function load(file) {
        const module = { exports: {} };
        compileFunction(sources[file], ["module", "require", "VencordNative"])(module, name => {
            assert.ok(Object.hasOwn(dependencies, name), name);
            return dependencies[name];
        }, { pluginHelpers: { Stalker: native } });
        return module.exports;
    }
    const main = dependencies["."] = load("index.tsx");
    Object.assign(activity, load("activity.ts"));
    Object.assign(status, load("status.ts"));
    Object.assign(voice, load("voice.ts"));
    f.plugin = main.default;
    f.settings = main.settings.store;
    f.emitPresence = () => [...f.presenceListeners].forEach(listener => listener());
    f.emitVoice = () => [...f.voiceListeners].forEach(listener => listener());
    f.emitMessage = (id = "42") => [...f.messages].forEach(listener => {
        f.messageCalls++;
        listener({ message: { id: "message", author: user(id), channel_id: "channel", content: "Hello" } });
    });
    f.plugin.start();
    return f;
}

test("An empty target list installs no background listeners or message callbacks", () => {
    const f = fixture();
    assert.equal(f.presenceListeners.size, 0);
    assert.equal(f.voiceListeners.size, 0);
    for (let index = 0; index < 27_000; index++) f.emitMessage();
    assert.equal(f.messageCalls, 0);
    assert.equal(f.logs.length, 0);
    f.plugin.stop();
});

test("Default monitoring avoids all-user copies, activity snapshots and disabled message logging", () => {
    const f = fixture({ targets: "42" });
    assert.equal(f.presenceListeners.size, 1);
    for (let index = 0; index < 1000; index++) { f.emitPresence(); f.emitMessage(); }
    assert.equal(f.fullStateReads, 0);
    assert.equal(f.activityReads, 0);
    assert.equal(f.messageCalls, 0);
    f.statuses["42"] = "online";
    f.emitPresence();
    assert.equal(f.notifications.length, 1);
    f.emitPresence();
    assert.equal(f.notifications.length, 1);
    f.plugin.stop();
});

test("Message logging subscribes only while enabled and sends single entries without history copies", async () => {
    const f = fixture({ targets: "42", logMessages: true });
    assert.equal(f.messages.size, 0);
    f.settings.enableLogging = true;
    assert.equal(f.messages.size, 1);
    f.emitMessage("43");
    f.emitMessage();
    await setImmediate();
    assert.equal(f.logs.length, 1);
    assert.equal(f.logs[0].action, "message_send");
    f.settings.enableLogging = false;
    f.emitMessage();
    assert.equal(f.logs.length, 1);
    assert.equal(f.messages.size, 0);
    f.plugin.stop();
    assert.equal(f.presenceListeners.size, 0);
    assert.equal(f.voiceListeners.size, 0);
});

test("Activity, custom status and client status changes remain observable without JSON signatures", async () => {
    const f = fixture({ targets: "42", enableLogging: true });
    f.activities["42"] = [{ type: 0, name: "Game", details: "Level 1" }];
    f.emitPresence();
    f.activities["42"] = [{ type: 0, name: "Game", details: "Level 2" }, { type: 4, name: "Custom", state: "Hello" }];
    f.clients["42"] = { desktop: "online" };
    f.emitPresence();
    f.activities["42"] = [];
    f.emitPresence();
    await setImmediate();
    for (const action of ["activity_start", "activity_update", "activity_stop", "custom_status_change", "client_status_change"]) assert.ok(f.logs.some(entry => entry.action === action), action);
    assert.equal(f.errors.length, 0);
    f.plugin.stop();
});

test("Voice notifications skip log details when logging is off and unchanged voice states do no work", async () => {
    const f = fixture({ targets: "42" });
    f.voices["42"] = { userId: "42", channelId: "voice", selfMute: false };
    f.emitVoice();
    assert.equal(f.notifications.length, 1);
    assert.equal(f.voiceMemberReads, 0);
    for (let index = 0; index < 100; index++) f.emitVoice();
    assert.equal(f.notifications.length, 1);
    f.settings.enableLogging = true;
    f.voices["42"] = { ...f.voices["42"], selfMute: true };
    f.emitVoice();
    delete f.voices["42"];
    f.emitVoice();
    await setImmediate();
    assert.ok(f.logs.some(entry => entry.action === "voice_update"));
    assert.ok(f.logs.some(entry => entry.action === "voice_leave"));
    f.plugin.stop();
});

test("Changing targets reseeds state and stopping removes every subscription", () => {
    const f = fixture({ targets: "42", enableLogging: true, logMessages: true });
    f.settings.targets = "43,43";
    f.statuses["42"] = "online";
    f.emitPresence();
    assert.equal(f.notifications.length, 0);
    f.statuses["43"] = "online";
    f.emitPresence();
    assert.equal(f.notifications.length, 1);
    assert.equal(f.presenceListeners.size, 2);
    f.plugin.stop();
    assert.equal(f.presenceListeners.size, 0);
    assert.equal(f.voiceListeners.size, 0);
    assert.equal(f.messages.size, 0);
    f.settings.notifyActivities = true;
    assert.equal(f.presenceListeners.size, 0);
});
