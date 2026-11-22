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

const source = readFileSync(new URL("../../src/illegalcordplugins/FakeMuteAndDeafen/audio.ts", import.meta.url), "utf8");
const { code } = transformSync(source, { loader: "ts", format: "cjs" });
const pluginSource = readFileSync(new URL("../../src/illegalcordplugins/FakeMuteAndDeafen/index.tsx", import.meta.url), "utf8");
const { code: pluginCode } = transformSync(pluginSource, { loader: "tsx", format: "cjs" });

function fixture(selfMute = false, selfDeaf = false) {
    const state = { selfMute, selfDeaf, channelId: "channel" };
    const muteChanges = [];
    const deafChanges = [];
    const timers = new Map();
    let timerId = 0;
    const connection = {
        context: "default",
        destroyed: false,
        selfMute: true,
        selfDeaf: true,
        inputMuted: true,
        outputDeafened: true,
        getSelfMute() { return this.selfMute; },
        getSelfDeaf() { return this.selfDeaf; },
        setSelfMute(value) { this.selfMute = value; this.inputMuted = value; muteChanges.push(value); },
        setSelfDeaf(value) { this.selfDeaf = value; this.outputDeafened = value; deafChanges.push(value); }
    };
    const connections = [connection];
    const dependencies = {
        "@api/Commands": { ApplicationCommandInputType: {} },
        "@api/Settings": {
            definePluginSettings(def) {
                const plain = Object.fromEntries(Object.entries(def).map(([key, option]) => [key, option.default]));
                const store = new Proxy(plain, {
                    set(target, key, value) {
                        if (target[key] === value) return true;
                        target[key] = value;
                        def[key].onChange?.(value);
                        return true;
                    }
                });
                return { store, plain };
            }
        },
        "@utils/constants": { Devs: {} },
        "@utils/Logger": { Logger: class { debug() {} warn() {} } },
        "@utils/misc": { tryOrElse: callback => callback() },
        "@utils/types": { __esModule: true, default: plugin => plugin, OptionType: {} },
        "@webpack": { findByPropsLazy: () => ({ didHavePermission: () => true }) },
        "@webpack/common": {
            MediaEngineStore: {
                getMediaEngine: () => ({ connections }),
                isSelfMute: () => state.selfMute,
                isMute: () => state.selfMute || state.selfDeaf,
                isSelfDeaf: () => state.selfDeaf,
                isSelfMutedTemporarily: () => false,
                isServerMute: () => false,
                isServerDeaf: () => false,
                isEnabled: () => true,
                emitChange() {}
            },
            SelectedChannelStore: { getVoiceChannelId: () => state.channelId },
            UserStore: { getCurrentUser: () => ({ id: "self" }) },
            VoiceStateStore: { getVoiceStatesForChannel: () => ({}) }
        }
    };
    const module = { exports: {} };
    const require = name => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
    };
    compileFunction(code, ["require", "module", "exports"])(require, module, module.exports);
    dependencies["./audio"] = module.exports;
    const pluginModule = { exports: {} };
    compileFunction(pluginCode, ["require", "module", "exports", "globalThis", "setTimeout", "clearTimeout"])(
        require, pluginModule, pluginModule.exports, {},
        callback => { const id = ++timerId; timers.set(id, callback); return id; },
        id => timers.delete(id)
    );
    const { default: plugin, settings } = pluginModule.exports;
    const flushTimers = () => {
        for (const [id, callback] of timers) {
            timers.delete(id);
            callback();
        }
    };
    return { restore: module.exports.restoreLocalAudio, state, connection, connections, muteChanges, deafChanges, plugin, settings, timers, flushTimers };
}

test("Restores the microphone when only fake mute is enabled", () => {
    const { restore, connection } = fixture();
    assert.equal(restore(true, false, false), true);
    assert.equal(connection.selfMute, false);
});

test("Keeps an existing Discord mute when fake mute is enabled", () => {
    const { restore, connection, muteChanges } = fixture(true);
    restore(true, false, false);
    assert.equal(connection.selfMute, true);
    assert.deepEqual(muteChanges, []);
});

test("Honors Discord mute changes during normal and forced audio restores", () => {
    const { restore, state, connection, muteChanges } = fixture();
    restore(true, false, false);
    state.selfMute = true;
    restore(true, false, false);
    restore(true, false, false, true);
    assert.equal(connection.selfMute, true);
    assert.deepEqual(muteChanges, [false, true]);

    state.selfMute = false;
    restore(true, false, false);
    assert.equal(connection.selfMute, false);
});

test("Restores fake deafen playback while keeping the Discord microphone muted", () => {
    const { restore, connection, muteChanges } = fixture(true);
    restore(false, true, false, true);
    assert.equal(connection.selfDeaf, false);
    assert.equal(connection.selfMute, true);
    assert.deepEqual(muteChanges, []);
});

test("Restores playback and microphone when only fake deafen is enabled", () => {
    const { restore, connection } = fixture();
    restore(false, true, false);
    assert.equal(connection.selfDeaf, false);
    assert.equal(connection.selfMute, false);
});

test("Keeps an existing Discord deafen when fake deafen is enabled", () => {
    for (const fakeMute of [false, true]) {
        const { restore, connection, muteChanges, deafChanges } = fixture(false, true);
        restore(fakeMute, true, false, true);
        assert.equal(connection.selfDeaf, true);
        assert.equal(connection.selfMute, true);
        assert.deepEqual(deafChanges, []);
        assert.deepEqual(muteChanges, []);
    }
});

test("Honors Discord deafen changes during normal and forced audio restores", () => {
    const { restore, state, connection, muteChanges, deafChanges } = fixture();
    restore(false, true, false);
    state.selfDeaf = true;
    restore(false, true, false);
    restore(false, true, false, true);
    assert.equal(connection.selfDeaf, true);
    assert.equal(connection.selfMute, true);
    assert.deepEqual(deafChanges, [false, true]);
    assert.deepEqual(muteChanges, [false, true]);

    state.selfDeaf = false;
    restore(false, true, false);
    assert.equal(connection.selfDeaf, false);
    assert.equal(connection.selfMute, false);
});

test("Keeps the microphone muted when Discord deafen and fake mute are enabled", () => {
    const { restore, connection, muteChanges } = fixture(false, true);
    restore(true, false, false, true);
    assert.equal(connection.selfDeaf, true);
    assert.equal(connection.selfMute, true);
    assert.deepEqual(muteChanges, []);
});

test("Restores the microphone after repeated Discord unmutes with fake modes still enabled", () => {
    for (const fakeDeafen of [false, true]) {
        const { restore, state, connection } = fixture(true);
        for (const force of [false, true, false]) {
            restore(true, fakeDeafen, false, force);
            assert.equal(connection.selfMute, true);

            state.selfMute = false;
            restore(true, fakeDeafen, false, force);
            assert.equal(connection.selfMute, false);

            state.selfMute = true;
            restore(true, fakeDeafen, false, force);
            assert.equal(connection.selfMute, true);
        }
    }
});

test("Restores microphone and playback after repeated Discord undeafens with fake modes still enabled", () => {
    for (const fakeMute of [false, true]) {
        const { restore, state, connection } = fixture(false, true);
        for (const force of [false, true, false]) {
            restore(fakeMute, true, false, force);
            assert.equal(connection.selfMute, true);
            assert.equal(connection.selfDeaf, true);

            state.selfDeaf = false;
            restore(fakeMute, true, false, force);
            assert.equal(connection.selfMute, false);
            assert.equal(connection.selfDeaf, false);

            state.selfDeaf = true;
            restore(fakeMute, true, false, force);
            assert.equal(connection.selfMute, true);
            assert.equal(connection.selfDeaf, true);
        }
    }
});

test("Keeps the microphone off after unmuting Discord while real deafen remains enabled", () => {
    const { restore, state, connection } = fixture(true, true);
    restore(true, true, false);
    state.selfMute = false;
    restore(true, true, false);
    assert.equal(connection.selfMute, true);
    assert.equal(connection.selfDeaf, true);

    state.selfDeaf = false;
    restore(true, true, false);
    assert.equal(connection.selfMute, false);
    assert.equal(connection.selfDeaf, false);
});

test("Restores only playback after undeafening Discord while real mute remains enabled", () => {
    const { restore, state, connection } = fixture(true, true);
    restore(true, true, false);
    state.selfDeaf = false;
    restore(true, true, false);
    assert.equal(connection.selfMute, true);
    assert.equal(connection.selfDeaf, false);

    state.selfMute = false;
    restore(true, true, false);
    assert.equal(connection.selfMute, false);
    assert.equal(connection.selfDeaf, false);
});

test("Disabling fake settings restores Discord audio and clears pending restores", () => {
    for (const [fakeMute, fakeDeafen] of [[true, false], [false, true], [true, true]]) {
        for (const selfMute of [false, true]) {
            for (const selfDeaf of [false, true]) {
                const { plugin, settings, state, connection, timers, flushTimers } = fixture();
                connection.selfDeaf = fakeDeafen;
                settings.store.fakeMute = fakeMute;
                settings.store.fakeDeafen = fakeDeafen;
                plugin.start();
                assert.equal(connection.selfMute, false);
                assert.equal(connection.selfDeaf, false);
                assert.equal(timers.size, 1);

                state.selfMute = selfMute;
                state.selfDeaf = selfDeaf;
                if (!fakeDeafen) connection.selfDeaf = selfDeaf;
                settings.store.fakeMute = false;
                settings.store.fakeDeafen = false;
                flushTimers();
                assert.equal(connection.selfMute, selfMute || selfDeaf);
                assert.equal(connection.selfDeaf, selfDeaf);
                assert.equal(timers.size, 0);
                const voiceState = { channelId: "channel", selfMute, selfDeaf, selfVideo: false, videoStreamParameters: null };
                assert.deepEqual(plugin.modifyVoiceState(voiceState), voiceState);
                plugin.stop();
            }
        }
    }
});

test("Stopping the plugin restores Discord audio and cancels pending restores", () => {
    for (const selfMute of [false, true]) {
        for (const selfDeaf of [false, true]) {
            const { plugin, settings, state, connection, timers, flushTimers } = fixture();
            settings.store.fakeMute = true;
            settings.store.fakeDeafen = true;
            plugin.start();
            assert.equal(connection.selfMute, false);
            assert.equal(connection.selfDeaf, false);

            state.selfMute = selfMute;
            state.selfDeaf = selfDeaf;
            plugin.stop();
            flushTimers();
            assert.equal(connection.selfMute, selfMute || selfDeaf);
            assert.equal(connection.selfDeaf, selfDeaf);
            assert.equal(settings.store.fakeMute, false);
            assert.equal(settings.store.fakeDeafen, false);
            assert.equal(timers.size, 0);
            const voiceState = { channelId: "channel", selfMute, selfDeaf, selfVideo: false, videoStreamParameters: null };
            assert.equal(plugin.modifyVoiceState(voiceState), voiceState);
        }
    }
});

test("Disabling one fake preserves the other until both are turned off", () => {
    for (const first of ["fakeMute", "fakeDeafen"]) {
        const { plugin, settings, connection, flushTimers } = fixture();
        settings.store.fakeMute = true;
        settings.store.fakeDeafen = true;
        plugin.start();
        settings.store[first] = false;
        flushTimers();
        assert.equal(connection.selfMute, false);
        assert.equal(connection.selfDeaf, false);
        const voiceState = { channelId: "channel", selfMute: false, selfDeaf: false, selfVideo: false, videoStreamParameters: null };
        const visible = plugin.modifyVoiceState(voiceState);
        assert.equal(visible.selfMute, first !== "fakeMute");
        assert.equal(visible.selfDeaf, first !== "fakeDeafen");

        settings.store.fakeMute = false;
        settings.store.fakeDeafen = false;
        flushTimers();
        assert.equal(connection.selfMute, false);
        assert.equal(connection.selfDeaf, false);
        assert.deepEqual(plugin.modifyVoiceState(voiceState), voiceState);
        plugin.stop();
    }
});

test("Changing voice channels restores the new connection and respects Discord mute and deafen", () => {
    for (const [fakeMute, fakeDeafen] of [[true, false], [false, true], [true, true]]) {
        for (const selfMute of [false, true]) {
            for (const selfDeaf of [false, true]) {
                const { plugin, settings, state, connection, connections, timers, flushTimers } = fixture();
                settings.store.fakeMute = fakeMute;
                settings.store.fakeDeafen = fakeDeafen;
                plugin.start();
                flushTimers();
                const oldMute = connection.selfMute;
                const oldDeaf = connection.selfDeaf;
                connection.destroyed = true;
                const next = { ...connection, destroyed: false, selfMute: true, selfDeaf: selfDeaf || fakeDeafen };
                const stream = { ...next, context: "stream", selfMute: true, selfDeaf: true };
                connections.push(next, stream);
                state.channelId = "other-channel";
                state.selfMute = selfMute;
                state.selfDeaf = selfDeaf;
                plugin.flux.VOICE_CHANNEL_SELECT({ channelId: state.channelId });
                plugin.flux.RTC_CONNECTION_STATE({ context: "default", state: "AUTHENTICATING" });
                plugin.flux.RTC_CONNECTION_STATE({ context: "default", state: "RTC_CONNECTING" });
                plugin.flux.RTC_CONNECTION_STATE({ context: "default", state: "RTC_CONNECTED" });
                plugin.onLocalAudioReset(next);
                assert.equal(timers.size, 1);
                flushTimers();
                assert.equal(next.selfMute, selfMute || selfDeaf);
                assert.equal(next.selfDeaf, selfDeaf);
                assert.equal(connection.selfMute, oldMute);
                assert.equal(connection.selfDeaf, oldDeaf);
                assert.equal(stream.selfMute, true);
                assert.equal(stream.selfDeaf, true);
                assert.equal(settings.store.fakeMute, fakeMute);
                assert.equal(settings.store.fakeDeafen, fakeDeafen);
                assert.equal(timers.size, 0);
                plugin.stop();
            }
        }
    }
});

test("Leaving and rejoining voice clears pending restores and preserves Discord mute and deafen", () => {
    for (const [fakeMute, fakeDeafen] of [[true, false], [false, true], [true, true]]) {
        for (const selfMute of [false, true]) {
            for (const selfDeaf of [false, true]) {
                const { plugin, settings, state, connection, connections, muteChanges, deafChanges, timers, flushTimers } = fixture();
                settings.store.fakeMute = fakeMute;
                settings.store.fakeDeafen = fakeDeafen;
                plugin.start();
                assert.equal(timers.size, 1);
                state.channelId = null;
                plugin.flux.VOICE_CHANNEL_SELECT({ channelId: null });
                connection.destroyed = true;
                const muteCount = muteChanges.length;
                const deafCount = deafChanges.length;
                plugin.flux.RTC_CONNECTION_STATE({ context: "default", state: "RTC_CONNECTED" });
                plugin.onLocalAudioReset(connection);
                flushTimers();
                assert.equal(timers.size, 0);
                assert.equal(muteChanges.length, muteCount);
                assert.equal(deafChanges.length, deafCount);
                const disconnected = { channelId: null, selfMute, selfDeaf, selfVideo: false, videoStreamParameters: null };
                assert.equal(plugin.modifyVoiceState(disconnected), disconnected);

                state.selfMute = selfMute;
                state.selfDeaf = selfDeaf;
                state.channelId = "rejoined-channel";
                const next = { ...connection, destroyed: false, selfMute: true, selfDeaf: selfDeaf || fakeDeafen };
                connections.push(next);
                plugin.flux.VOICE_CHANNEL_SELECT({ channelId: state.channelId });
                plugin.flux.RTC_CONNECTION_STATE({ context: "default", state: "RTC_CONNECTED" });
                flushTimers();
                assert.equal(next.selfMute, selfMute || selfDeaf);
                assert.equal(next.selfDeaf, selfDeaf);
                assert.equal(settings.store.fakeMute, fakeMute);
                assert.equal(settings.store.fakeDeafen, fakeDeafen);
                assert.equal(timers.size, 0);
                plugin.stop();
            }
        }
    }
});

test("Restores a late voice connection after the initial restore retries finish", () => {
    const { plugin, settings, state, connection, connections, timers, flushTimers } = fixture();
    settings.store.fakeMute = true;
    settings.store.fakeDeafen = true;
    plugin.start();
    connection.destroyed = true;
    connections.length = 0;
    state.channelId = "other-channel";
    plugin.flux.VOICE_CHANNEL_SELECT({ channelId: state.channelId });
    flushTimers();
    assert.equal(timers.size, 0);

    const next = { ...connection, destroyed: false, selfMute: true, selfDeaf: true };
    connections.push(next);
    plugin.flux.RTC_CONNECTION_STATE({ context: "default", state: "RTC_CONNECTED" });
    assert.equal(timers.size, 1);
    flushTimers();
    assert.equal(next.selfMute, false);
    assert.equal(next.selfDeaf, false);
    plugin.stop();
});

test("Pending voice restore retries use the latest Discord mute and deafen state", () => {
    const { plugin, settings, state, connection, connections, timers, flushTimers } = fixture();
    settings.store.fakeMute = true;
    settings.store.fakeDeafen = true;
    plugin.start();
    connection.destroyed = true;
    connections.length = 0;
    state.channelId = "other-channel";
    plugin.flux.VOICE_CHANNEL_SELECT({ channelId: state.channelId });
    const [id, callback] = timers.entries().next().value;
    timers.delete(id);
    callback();
    assert.equal(timers.size, 1);

    state.selfMute = true;
    state.selfDeaf = true;
    const next = { ...connection, destroyed: false, selfMute: true, selfDeaf: true };
    connections.push(next);
    plugin.flux.RTC_CONNECTION_STATE({ context: "default", state: "RTC_CONNECTED" });
    flushTimers();
    assert.equal(next.selfMute, true);
    assert.equal(next.selfDeaf, true);

    state.selfMute = false;
    state.selfDeaf = false;
    plugin.onLocalAudioReset(next);
    flushTimers();
    assert.equal(next.selfMute, false);
    assert.equal(next.selfDeaf, false);
    plugin.stop();
});

for (const [action, device] of [["AUDIO_SET_INPUT_DEVICE", "microphone"], ["AUDIO_SET_OUTPUT_DEVICE", "output device"]]) {
    test(`Changing the ${device} restores audio and respects Discord mute and deafen`, () => {
        for (const [fakeMute, fakeDeafen] of [[true, false], [false, true], [true, true]]) {
            for (const selfMute of [false, true]) {
                for (const selfDeaf of [false, true]) {
                    for (const replaceConnection of [false, true]) {
                        const { plugin, settings, state, connection, connections, timers, flushTimers } = fixture();
                        connection.setSelfDeaf(fakeDeafen);
                        settings.store.fakeMute = fakeMute;
                        settings.store.fakeDeafen = fakeDeafen;
                        plugin.start();
                        flushTimers();
                        state.selfMute = selfMute;
                        state.selfDeaf = selfDeaf;
                        connection.selfMute = selfMute || selfDeaf;
                        connection.selfDeaf = selfDeaf;
                        connection.inputMuted = true;
                        connection.outputDeafened = selfDeaf || fakeDeafen;
                        const current = replaceConnection
                            ? { ...connection, selfMute: true, selfDeaf: selfDeaf || fakeDeafen }
                            : connection;
                        if (replaceConnection) {
                            connection.destroyed = true;
                            connections.push(current);
                        }
                        plugin.flux[action]({ id: "new-device" });
                        plugin.flux[action]({ id: "another-device" });
                        assert.equal(timers.size, 1);
                        flushTimers();
                        assert.equal(current.selfMute, selfMute || selfDeaf);
                        assert.equal(current.selfDeaf, selfDeaf);
                        assert.equal(current.inputMuted, selfMute || selfDeaf);
                        assert.equal(current.outputDeafened, selfDeaf);
                        assert.equal(settings.store.fakeMute, fakeMute);
                        assert.equal(settings.store.fakeDeafen, fakeDeafen);
                        assert.equal(timers.size, 0);
                        plugin.stop();
                    }
                }
            }
        }
    });
}

test("Device changes outside voice or after plugin stop do not schedule audio restores", () => {
    const { plugin, settings, state, connection, timers, flushTimers } = fixture();
    settings.store.fakeMute = true;
    settings.store.fakeDeafen = true;
    plugin.start();
    flushTimers();
    state.channelId = null;
    connection.destroyed = true;
    plugin.flux.VOICE_CHANNEL_SELECT({ channelId: null });
    for (const action of ["AUDIO_SET_INPUT_DEVICE", "AUDIO_SET_OUTPUT_DEVICE"]) {
        plugin.flux[action]({ id: "new-device" });
        assert.equal(timers.size, 0);
    }

    plugin.stop();
    state.channelId = "channel";
    for (const action of ["AUDIO_SET_INPUT_DEVICE", "AUDIO_SET_OUTPUT_DEVICE"]) {
        plugin.flux[action]({ id: "new-device" });
        assert.equal(timers.size, 0);
    }
});
