/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compileFunction, Script } from "node:vm";

import { transformSync } from "esbuild";

function loadSource(path, dependencies = {}, globals = {}) {
    const source = readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
    const { code } = transformSync(source, { loader: "tsx", format: "cjs" });
    const module = { exports: {} };
    compileFunction(code, ["require", "module", "exports", ...Object.keys(globals)])(name => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
    }, module, module.exports, ...Object.values(globals));
    return module.exports;
}

const { SettingsStore } = loadSource("shared/SettingsStore.ts");
const { canonicalizeMatch } = loadSource("utils/patches.ts", { "./intlHash": { runtimeHashMessageKey: () => assert.fail("Unexpected intl lookup.") } });
const customProfile = { width: 1920, height: 1080, framerate: 75, resolutionEnabled: true, framerateEnabled: true };

function fixture(profile = {}) {
    const settingsStore = new SettingsStore({ plugins: { BetterScreenshare: { stores: { ScreenshareStore: { currentProfile: { ...profile } } } } } });
    const own = { id: "own", stream: { ownerId: "self" }, maxFrameRate: 30, maxResolution: { width: 1280, height: 720 } };
    const other = { id: "other", stream: { ownerId: "other" }, maxFrameRate: 60, maxResolution: { width: 2560, height: 1440 } };
    const state = { participants: [own, other], changes: 0 };
    const patchers = [];
    const subscriptions = [];
    const store = {
        getParticipants(channelId) { assert.equal(this, store); assert.equal(channelId, "channel"); return state.participants; },
        getFilteredParticipants(channelId) { return this.getParticipants(channelId); },
        getParticipant(channelId, id) { return this.getParticipants(channelId).find(participant => participant.id === id) ?? null; },
        getSelectedParticipant(channelId) { return this.getParticipant(channelId, "own"); },
        getStreamParticipants(channelId) { return this.getParticipants(channelId); },
        emitChange() { state.changes++; }
    };
    class Patcher {
        patch() { patchers.push(this); return this; }
        unpatch() { this.stopped = true; }
    }
    const dependencies = {
        "@api/ContextMenu": {},
        "@api/Settings": { definePluginSettings: def => ({ def }), SettingsStore: settingsStore, useSettings: paths => { subscriptions.push(paths); return settingsStore.store; } },
        "@components/Heading": {},
        "@components/Icons": {},
        "@components/Paragraph": {},
        "@utils/constants": { Devs: {} },
        "@utils/discord": { getIntlMessage: (key, { fps }) => `${fps} FPS` },
        "@utils/types": { __esModule: true, default: plugin => plugin, OptionType: {} },
        "@webpack": { findComponentByCodeLazy: () => () => null },
        "@webpack/common": { ChannelRTCStore: store, UserStore: { getCurrentUser: () => ({ id: "self" }) } },
        "../betterScreenshare.desktop/constants": { PluginInfo: { PLUGIN_NAME: "BetterScreenshare" } },
        "../betterScreenshare.desktop/modals": {},
        "../betterScreenshare.desktop/patchers": { ScreensharePatcher: Patcher, ScreenshareAudioPatcher: Patcher },
        "../betterScreenshare.desktop/patches": {},
        "../betterScreenshare.desktop/stores": {
            initScreenshareStore() {}, initScreenshareAudioStore() {},
            screenshareStore: { get: () => settingsStore.store.plugins.BetterScreenshare.stores.ScreenshareStore }
        },
        "../philsPluginLibrary": { Emitter: { removeAllListeners: name => assert.equal(name, "BetterScreenshare") } }
    };
    const forbidden = () => assert.fail("Screenshare quality updates must not inspect the DOM or schedule timers.");
    const plugin = loadSource("illegalcordplugins/betterScreenshare.desktop/index.tsx", dependencies, {
        document: new Proxy({}, { get: forbidden }), MutationObserver: forbidden, setTimeout: forbidden
    }).default;
    return { plugin, store, state, settingsStore, patchers, own, other, subscriptions };
}

test("starts without DOM observers or timers and restores store methods on stop", () => {
    const f = fixture(customProfile);
    const original = { ...f.store };
    f.plugin.start();
    assert.equal(f.patchers.length, 2);
    assert.equal(f.state.changes, 1);
    f.plugin.stop();
    for (const key of Object.keys(original)) assert.equal(f.store[key], original[key]);
    assert.ok(f.patchers.every(patcher => patcher.stopped));
    assert.equal(f.state.changes, 2);
    f.settingsStore.store.plugins.BetterScreenshare.stores.ScreenshareStore.currentProfile.framerate = 120;
    assert.equal(f.state.changes, 2);
});

test("supplies custom quality to tiles and selected streams without changing other users", () => {
    const f = fixture(customProfile);
    f.plugin.start();
    for (const method of ["getParticipants", "getFilteredParticipants", "getStreamParticipants"]) {
        const participants = f.store[method]("channel");
        assert.notEqual(participants, f.state.participants);
        assert.deepEqual(participants[0], { ...f.own, maxFrameRate: 75, maxResolution: { width: 1920, height: 1080 } });
        assert.equal(participants[1], f.other);
    }
    assert.equal(f.store.getParticipant("channel", "own").maxFrameRate, 75);
    assert.equal(f.store.getSelectedParticipant("channel").maxResolution.height, 1080);
    assert.equal(f.store.getParticipant("channel", "missing"), null);
    assert.equal(f.own.maxFrameRate, 30);
    assert.deepEqual(f.own.maxResolution, { width: 1280, height: 720 });
    f.plugin.stop();
});

test("preserves participant references when quality is unchanged or overrides are disabled", () => {
    for (const profile of [{}, { ...customProfile, height: 720, width: 1280, framerate: 30 }]) {
        const f = fixture(profile);
        f.plugin.start();
        assert.equal(f.store.getParticipants("channel"), f.state.participants);
        assert.equal(f.store.getFilteredParticipants("channel"), f.state.participants);
        assert.equal(f.store.getStreamParticipants("channel"), f.state.participants);
        assert.equal(f.store.getParticipant("channel", "own"), f.own);
        assert.equal(f.store.getSelectedParticipant("channel"), f.own);
        f.state.participants = [f.other];
        assert.equal(f.store.getParticipants("channel"), f.state.participants);
        f.plugin.stop();
    }
});

test("does not clone participants again when Discord chains store getters", () => {
    const f = fixture(customProfile);
    let inner;
    f.store.getFilteredParticipants = function (channelId) {
        inner = this.getParticipants(channelId);
        return inner;
    };
    f.plugin.start();
    assert.equal(f.store.getFilteredParticipants("channel"), inner);
    f.plugin.stop();
});

test("refreshes quality only for screenshare settings and cleans up across restarts", () => {
    const f = fixture(customProfile);
    f.plugin.start();
    const storeSettings = f.settingsStore.store.plugins.BetterScreenshare.stores;
    storeSettings.ScreenshareStore.currentProfile.framerate = 120;
    assert.equal(f.state.changes, 2);
    assert.equal(f.store.getSelectedParticipant("channel").maxFrameRate, 120);
    storeSettings.ScreenshareAudioStore = { currentProfile: {} };
    f.settingsStore.store.plugins.BetterScreenshare.hideDefaultSettings = false;
    assert.equal(f.state.changes, 2);
    storeSettings.ScreenshareStore.currentProfile = {};
    assert.equal(f.state.changes, 3);
    assert.equal(f.store.getParticipants("channel"), f.state.participants);
    f.plugin.stop();
    f.plugin.start();
    const before = f.state.changes;
    storeSettings.ScreenshareStore.currentProfile = { ...customProfile };
    assert.equal(f.state.changes, before + 1);
    assert.equal(f.store.getSelectedParticipant("channel").maxFrameRate, 75);
    f.plugin.stop();
});

test("reuses unchanged quality options and copies only the overridden encoding fields", () => {
    const f = fixture();
    const options = { capture: { width: 1280, height: 720 }, encode: { width: 1280, height: 720 }, bitrateTarget: 2000000 };
    const submitted = { sourceId: "screen", quality: options };
    assert.equal(f.plugin.patchStreamQuality(options), options);
    assert.equal(f.plugin.patchStreamSubmitOptions(submitted), submitted);
    f.settingsStore.store.plugins.BetterScreenshare.stores.ScreenshareStore.currentProfile = { videoBitrateEnabled: true, videoBitrate: 5000 };
    const bitrate = f.plugin.patchStreamQuality(options);
    assert.equal(bitrate.bitrateMin, 5000000);
    assert.equal(bitrate.bitrateMax, 5000000);
    assert.equal(bitrate.bitrateTarget, 5000000);
    assert.equal(bitrate.capture, options.capture);
    assert.equal(bitrate.encode, options.encode);
    f.settingsStore.store.plugins.BetterScreenshare.stores.ScreenshareStore.currentProfile = { ...customProfile };
    const { quality } = f.plugin.patchGoLiveSource(submitted);
    assert.equal(quality.resolution, 1080);
    assert.equal(quality.frameRate, 75);
    assert.equal(quality.capture.framerate, 75);
    assert.equal(quality.encode.pixelCount, 1920 * 1080);
    assert.notEqual(quality.capture, options.capture);
    assert.notEqual(quality.encode, options.encode);
    assert.equal(options.capture.width, 1280);
    assert.equal(options.bitrateTarget, 2000000);
});

test("shows configured local FPS when Discord's quality hook still returns 60", () => {
    const f = fixture({ ...customProfile, framerate: 165 });
    const participant = { user: { id: "self" }, maxFrameRate: 165 };
    const nativeQuality = { maxFrameRate: 60, maxResolution: { width: 0, height: 720, type: "source" } };
    const quality = f.plugin.useDisplayedStreamQuality(participant, nativeQuality);
    assert.equal(quality.maxFrameRate, 165);
    assert.deepEqual(quality.maxResolution, { width: 1920, height: 1080, type: "fixed" });
    assert.equal(nativeQuality.maxFrameRate, 60);
    assert.equal(nativeQuality.maxResolution.type, "source");
    assert.equal(f.plugin.useDisplayedStreamQuality({ user: { id: "other" } }, nativeQuality), nativeQuality);
    const profile = f.settingsStore.store.plugins.BetterScreenshare.stores.ScreenshareStore.currentProfile;
    profile.framerate = 240;
    assert.equal(f.plugin.useDisplayedStreamQuality(participant, nativeQuality).maxFrameRate, 240);
    profile.framerateEnabled = false;
    profile.resolutionEnabled = false;
    assert.equal(f.plugin.useDisplayedStreamQuality(participant, nativeQuality), nativeQuality);
    assert.deepEqual(f.subscriptions[0], ["plugins.BetterScreenshare.stores.ScreenshareStore.*"]);
    assert.ok(f.subscriptions.every(paths => paths === f.subscriptions[0]));
});

test("keeps matching quality references and handles missing quality", () => {
    const f = fixture(customProfile);
    const participant = { user: { id: "self" } };
    const quality = { maxFrameRate: 75, maxResolution: { width: 1920, height: 1080, type: "fixed" } };
    assert.equal(f.plugin.useDisplayedStreamQuality(participant, quality), quality);
    assert.equal(f.plugin.useDisplayedStreamQuality(participant, null), null);
    const sourceQuality = { ...quality, maxResolution: { ...quality.maxResolution, type: "source" } };
    assert.equal(f.plugin.useDisplayedStreamQuality(participant, sourceQuality).maxResolution.type, "fixed");
});

test("wraps Discord's memoized local quality after its native 60 FPS calculation", () => {
    const f = fixture({ ...customProfile, framerate: 165 });
    const patch = f.plugin.patches.find(patch => patch.find === '"useMaxQuality"');
    const module = '({quality:function(p){let q={fps:60,resolution:720};return R.useMemo(()=>p.user.id==="self"?{maxFrameRate:q.fps,maxResolution:resolve("useMaxQuality",null,{width:0,height:q.resolution,type:"fixed"},q.fps)}:p.quality,[p,q])}})';
    const match = canonicalizeMatch(patch.replacement.match);
    assert.equal([...module.matchAll(new RegExp(match.source, "g"))].length, 1);
    const patched = module.replace(match, patch.replacement.replace.replaceAll("$self", "plugin"));
    new Script(patched);
    const hook = compileFunction(`return ${patched};`, ["R", "resolve", "plugin"])(
        { useMemo: callback => callback() }, (location, guild, quality) => quality, f.plugin
    ).quality;
    assert.equal(hook({ user: { id: "self" } }).maxFrameRate, 165);
    const otherQuality = { maxFrameRate: 30, maxResolution: { height: 480, width: 720, type: "fixed" } };
    assert.equal(hook({ user: { id: "other" }, quality: otherQuality }), otherQuality);
});
