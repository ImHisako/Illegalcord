/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileFunction } from "node:vm";

import { transformSync } from "esbuild";

const { code } = transformSync(readFileSync(new URL("index.tsx", import.meta.url), "utf8"), { loader: "tsx", format: "cjs" });

function fixture({ connected = true, present = [] } = {}) {
    const state = { connected, channelId: "voice", deaf: false, outputVolume: 100, streaming: false };
    const voiceUsers = new Set(["10000", ...present]);
    const players = [], playback = [], toasts = [];
    const observable = properties => Object.assign({
        listeners: new Set(),
        addChangeListener(callback) { this.listeners.add(callback); },
        removeChangeListener(callback) { assert.ok(this.listeners.delete(callback)); },
        emitChange() { for (const callback of this.listeners) callback(); }
    }, properties);
    const stores = {
        MediaEngineStore: observable({ isDeaf: () => state.deaf, getOutputVolume: () => state.outputVolume }),
        StreamerModeStore: observable({ enabled: false, disableSounds: false }),
        ApplicationStreamingStore: observable({ getCurrentUserActiveStream: () => state.streaming ? {} : null }),
        RTCConnectionStore: { isConnected: () => state.connected, getChannelId: () => state.channelId },
        ChannelStore: { getChannel: () => ({ guild_id: "guild", name: "Voice" }) },
        GuildStore: { getGuild: () => ({ ownerId: "owner", name: "Guild" }) },
        GuildRoleStore: { getSortedRoles: () => [{ id: "staff-role", permissions: 8n }] },
        GuildMemberStore: { getMember: () => ({ roles: ["staff-role"] }) },
        UserStore: { getCurrentUser: () => ({ id: "10000" }), getUser: id => ({ id, username: id, bot: id === "30000" }) },
        VoiceStateStore: { getVoiceStatesForChannel: () => Object.fromEntries([...voiceUsers].map(id => [id, { userId: id }])) },
        IconUtils: { getDefaultAvatarURL: () => "avatar", getUserAvatarURL: () => "avatar" },
        PermissionsBits: Object.fromEntries(["ADMINISTRATOR", "MANAGE_GUILD", "MANAGE_CHANNELS", "MANAGE_ROLES", "MANAGE_NICKNAMES", "MANAGE_MESSAGES", "KICK_MEMBERS", "BAN_MEMBERS", "MODERATE_MEMBERS", "MOVE_MEMBERS", "MUTE_MEMBERS", "DEAFEN_MEMBERS"].map((key, i) => [key, 1n << BigInt(i + 3)])),
        React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: "fragment" },
        showToast: toast => toasts.push(toast),
        useStateFromStores: (dependencies, selector) => { assert.ok(dependencies.includes(stores.UserStore)); return selector(); }
    };
    const dependencies = {
        "@api/AudioPlayer": { createAudioPlayer(source, options) {
            const player = {
                source, options, volume: 100, playing: false, deleted: false,
                restart() { this.playing = true; playback.push({ source, volume: this.volume }); },
                stop() { this.playing = false; },
                delete() { this.playing = false; this.deleted = true; }
            };
            players.push(player);
            return player;
        } },
        "@api/Notifications": { showNotification: notification => toasts.push(notification) },
        "@api/Settings": { definePluginSettings(def) {
            const values = Object.fromEntries(Object.entries(def).map(([key, option]) => [key, option.default ?? option.options?.find(choice => choice.default)?.value]));
            const store = new Proxy(values, { set(target, key, value) {
                target[key] = value;
                def[key].onChange?.(value);
                return true;
            } });
            return { def, store, use: () => store };
        } },
        "@components/Button": {},
        "@components/ErrorBoundary": { wrap: component => component },
        "@utils/constants": { EquicordDevs: {} },
        "@utils/Logger": { Logger: class { warn() {} } },
        "@utils/misc": { parseUrl(value) { try { return new URL(value); } catch { return null; } } },
        "@utils/types": { __esModule: true, default: plugin => plugin, OptionType: {} },
        "@utils/web": {},
        "@webpack/common": stores
    };
    const module = { exports: {} };
    compileFunction(code, ["require", "module", "exports"])(name => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
    }, module, module.exports);
    const plugin = module.exports.default;
    const changeVoice = (entering, ids) => {
        for (const id of ids) entering ? voiceUsers.add(id) : voiceUsers.delete(id);
        plugin.flux.VOICE_STATE_UPDATES({ voiceStates: ids.map(userId => ({ userId, channelId: entering ? "voice" : undefined, oldChannelId: entering ? undefined : "voice", guildId: "guild" })) });
    };
    return { plugin, settings: plugin.settings.store, state, stores, players, playback, toasts, join: (...ids) => changeVoice(true, ids), leave: (...ids) => changeVoice(false, ids) };
}

test("preloads two sounds and reuses them with one playback per batch", () => {
    const f = fixture();
    f.plugin.start();
    assert.equal(f.players.length, 2);
    for (const player of f.players) {
        assert.equal(player.options.preload, true);
        assert.equal(player.options.persistent, true);
        assert.match(player.source, /^https:\/\/cdn\.jsdelivr\.net\/gh\/ImHisako\/Illegalcord@[a-f0-9]{40}\//);
    }
    assert.equal(f.playback.length, 0);
    f.join("20000", "40000");
    f.join("20000");
    assert.equal(f.toasts.length, 2);
    assert.equal(f.playback.length, 1);
    f.leave("20000", "40000");
    assert.equal(f.playback.length, 2);
    assert.match(f.playback[1].source, /leave\.wav$/);
    assert.equal(f.players.length, 2);
    assert.equal(f.players.filter(player => player.playing).length, 1);
    f.plugin.stop();
});

test("ignores a remembered voice channel until RTC connects, then seeds once", () => {
    const f = fixture({ connected: false, present: ["20000"] });
    f.plugin.start();
    f.plugin.flux.CONNECTION_OPEN();
    f.plugin.flux.VOICE_CHANNEL_SELECT({ channelId: "voice" });
    f.join("40000");
    assert.equal(f.toasts.length, 0);
    f.state.connected = true;
    f.plugin.flux.RTC_CONNECTION_STATE();
    f.plugin.flux.RTC_CONNECTION_STATE();
    f.join("20000", "40000");
    assert.equal(f.toasts.length, 1);
    assert.equal(f.playback.length, 1);
    f.plugin.stop();
});

test("still tracks departures when existing staff notifications are disabled", () => {
    const f = fixture({ present: ["20000"] });
    f.settings.notifyAlreadyInVc = false;
    f.plugin.start();
    assert.equal(f.toasts.length, 0);
    f.leave("20000");
    assert.equal(f.toasts.length, 1);
    assert.match(f.playback[0].source, /leave\.wav$/);
    f.plugin.stop();
});

test("bot filter applies to explicit includes, highlighting and existing members", () => {
    const f = fixture({ present: ["30000"] });
    f.settings.userIncludeIds = "30000";
    f.plugin.start();
    assert.equal(f.toasts.length, 0);
    const name = f.plugin.renderVoiceName({ user: { id: "30000" }, guildId: "guild" }, "Bot");
    assert.equal(name.type(name.props).type, "fragment");
    f.settings.ignoreBots = false;
    assert.equal(name.type(name.props).type, "span");
    f.leave("30000");
    assert.equal(f.toasts.length, 1);
    f.join("30000");
    f.settings.ignoreBots = true;
    f.leave("30000");
    assert.equal(f.toasts.length, 2);
    f.plugin.stop();
});

test("obeys deafen and live Discord output volume without replaying muted alerts", () => {
    const f = fixture();
    f.plugin.start();
    f.state.deaf = true;
    f.join("20000");
    assert.equal(f.playback.length, 0);
    assert.equal(f.toasts.length, 1);
    f.state.deaf = false;
    f.state.outputVolume = 50;
    f.stores.MediaEngineStore.emitChange();
    f.join("40000");
    assert.equal(f.playback[0].volume, 18);
    f.state.deaf = true;
    f.stores.MediaEngineStore.emitChange();
    assert.ok(f.players.every(player => !player.playing && player.volume === 0));
    f.state.deaf = false;
    f.state.outputVolume = 0;
    f.stores.MediaEngineStore.emitChange();
    f.join("50000");
    f.state.outputVolume = 100;
    f.stores.MediaEngineStore.emitChange();
    assert.equal(f.playback.length, 1);
    f.plugin.stop();
});

test("can mute screen shares and streamer mode, including audio already playing", () => {
    const f = fixture();
    f.plugin.start();
    f.join("20000");
    f.settings.muteWhileStreaming = true;
    f.state.streaming = true;
    f.stores.ApplicationStreamingStore.emitChange();
    assert.ok(f.players.every(player => !player.playing));
    f.join("40000");
    assert.equal(f.playback.length, 1);
    f.state.streaming = false;
    f.stores.StreamerModeStore.enabled = true;
    f.stores.StreamerModeStore.emitChange();
    f.join("50000");
    assert.equal(f.playback.length, 1);
    f.settings.muteWhileStreaming = false;
    f.stores.StreamerModeStore.disableSounds = true;
    f.stores.StreamerModeStore.emitChange();
    f.join("60000");
    assert.equal(f.playback.length, 1);
    f.plugin.stop();
});

test("refreshes custom audio, validates URLs and preserves uploaded file priority", () => {
    const f = fixture();
    f.plugin.start();
    const validation = f.plugin.settings.def.customJoinSound.isValid;
    assert.equal(validation(""), true);
    assert.equal(validation("https://example.com/sound.mp3"), true);
    assert.equal(typeof validation("javascript:alert(1)"), "string");
    f.settings.useCustomSounds = true;
    assert.ok(f.players.slice(0, 2).every(player => player.deleted));
    f.settings.customJoinSound = "https://example.com/sound.mp3";
    f.settings.customJoinSoundData = "data:audio/mpeg;base64,AAAA";
    f.join("20000");
    assert.equal(f.playback[0].source, f.settings.customJoinSoundData);
    f.settings.customJoinSound = "file:///private/audio.mp3";
    f.settings.customJoinSoundData = "";
    f.join("40000");
    assert.match(f.playback[1].source, /trollface-smile\.mp3$/);
    f.plugin.stop();
});

test("disabling and stopping release audio and store listeners", () => {
    const f = fixture();
    f.settings.enableSounds = false;
    f.plugin.start();
    assert.equal(f.players.length, 0);
    f.settings.enableSounds = true;
    f.join("20000");
    f.settings.enableSounds = false;
    assert.ok(f.players.every(player => player.deleted && !player.playing));
    f.settings.enableSounds = true;
    f.plugin.stop();
    assert.ok(f.players.every(player => player.deleted));
    for (const store of [f.stores.MediaEngineStore, f.stores.StreamerModeStore, f.stores.ApplicationStreamingStore]) assert.equal(store.listeners.size, 0);
    const count = f.players.length;
    f.settings.customJoinSound = "https://example.com/changed.mp3";
    assert.equal(f.players.length, count);
});
