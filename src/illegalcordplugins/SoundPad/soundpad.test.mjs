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

import ts from "typescript";

const sources = Object.fromEntries(["player.ts", "index.tsx"].map(file => [file, ts.transpileModule(
    readFileSync(new URL(file, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: false } }
).outputText]));

function load(file, dependencies, globals) {
    const module = { exports: {} };
    compileFunction(sources[file], ["module", "exports", "require", ...Object.keys(globals)])(
        module, module.exports, name => {
            assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
            return dependencies[name];
        }, ...Object.values(globals)
    );
    return module.exports;
}

function microphone() {
    const track = { stopped: false, stop() { this.stopped = true; } };
    return { track, getTracks: () => [track] };
}

function fixture() {
    const f = {
        outputs: [], requests: [], devices: [], reads: 0, toasts: [],
        capture: async () => microphone(), sink: async () => {}, play: async () => {}
    };
    const mediaDevices = Object.assign(new EventTarget(), {
        async enumerateDevices() { f.reads++; return f.devices; },
        getUserMedia(options) { f.requests.push(options); return f.capture(); }
    });
    f.globals = {
        navigator: { mediaDevices },
        Audio: class {
            constructor(url) {
                this.src = url;
                this.srcObject = null;
                this.paused = true;
                f.outputs.push(this);
            }
            async setSinkId(id) { this.sinkId = id; await f.sink(); }
            async play() { await f.play(); this.paused = false; }
            pause() { this.paused = true; }
        }
    };
    f.player = load("player.ts", {}, f.globals);
    return f;
}

function mount(f, saved = {}) {
    const effects = [];
    f.states = [];
    const settings = {
        store: { inputDeviceId: "default", outputDeviceId: "default", ...saved },
        use() { return this.store; }
    };
    const React = {
        createElement: (type, props) => ({ type, props }),
        useReducer: () => [0, () => {}],
        useState(value) {
            const index = f.states.push(value) - 1;
            return [value, next => { f.states[index] = next; }];
        },
        useEffect: effect => effects.push(effect)
    };
    const plugin = load("index.tsx", {
        "./style.css": {},
        "./player": f.player,
        "@api/Settings": { definePluginSettings: () => settings },
        "@api/UserArea": {},
        "@components/BaseText": {},
        "@components/Button": {},
        "@components/ErrorBoundary": { default: { wrap: component => component } },
        "@components/FormSwitch": {},
        "@utils/constants": { EquicordDevs: { irritably: {} } },
        "@utils/Logger": { Logger: class { error() {} } },
        "@utils/types": { default: value => value, makeRange: () => [], OptionType: {} },
        "@utils/web": {},
        "@webpack/common": {
            React, showToast: toast => f.toasts.push(toast),
            openModal: render => { f.modal = render({ onClose() {} }); }
        }
    }, f.globals).default;
    plugin.toolboxActions["Open SoundPad"]();
    f.modal.type(f.modal.props);
    const cleanups = effects.map(effect => effect());
    f.unmount = () => cleanups.forEach(cleanup => cleanup());
    return settings.store;
}

test("Device selectors use browser IDs, reset native IDs, and refresh on browser device changes", async () => {
    const f = fixture();
    f.devices = [
        { kind: "audioinput", deviceId: "browser-mic", label: "Physical microphone" },
        { kind: "audiooutput", deviceId: "browser-cable", label: "CABLE Input" },
        { kind: "videoinput", deviceId: "camera", label: "Webcam" }
    ];
    const store = mount(f, { inputDeviceId: "native-mic", outputDeviceId: "native-cable" });
    await setImmediate();
    assert.deepEqual(f.states, [
        [{ label: "Default microphone", value: "default" }, { label: "Physical microphone", value: "browser-mic" }],
        [{ label: "Default output", value: "default" }, { label: "CABLE Input", value: "browser-cable" }]
    ]);
    assert.equal(store.inputDeviceId, "default");
    assert.equal(store.outputDeviceId, "default");
    store.inputDeviceId = "browser-mic";
    store.outputDeviceId = "browser-cable";
    f.globals.navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
    await setImmediate();
    assert.equal(store.inputDeviceId, "browser-mic");
    assert.equal(store.outputDeviceId, "browser-cable");
    f.devices = [];
    f.globals.navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
    await setImmediate();
    assert.equal(store.inputDeviceId, "default");
    assert.equal(store.outputDeviceId, "default");
    f.unmount();
    const { reads } = f;
    f.globals.navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
    assert.equal(f.reads, reads);
});

test("Permission access refreshes device labels and immediately releases the temporary microphone", async () => {
    const f = fixture();
    const stream = microphone();
    f.devices = [{ kind: "audioinput", deviceId: "", label: "" }];
    f.capture = async () => {
        f.devices = [{ kind: "audiooutput", deviceId: "browser-cable", label: "CABLE Input" }];
        return stream;
    };
    mount(f);
    await setImmediate();
    assert.equal(stream.track.stopped, true);
    assert.deepEqual(f.states[1][1], { label: "CABLE Input", value: "browser-cable" });
    assert.equal(f.reads, 2);
    f.unmount();
});

test("Permission access closes its temporary microphone even after the modal closes", async () => {
    const f = fixture();
    const capture = Promise.withResolvers();
    const stream = microphone();
    f.devices = [{ kind: "audioinput", deviceId: "", label: "" }];
    f.capture = () => capture.promise;
    mount(f);
    await setImmediate();
    assert.equal(f.requests.length, 1);
    f.unmount();
    capture.resolve(stream);
    await setImmediate();
    assert.equal(stream.track.stopped, true);
    assert.deepEqual(f.states, [[], []]);
    assert.equal(f.reads, 1);
});

test("A microphone uses the browser device ID and releases its output and tracks on stop", async () => {
    const f = fixture();
    const stream = microphone();
    f.capture = async () => stream;
    assert.equal(await f.player.startMicrophone("browser-mic", "browser-cable", 80), true);
    assert.deepEqual(f.requests[0].audio.deviceId, { exact: "browser-mic" });
    assert.equal(f.outputs[0].sinkId, "browser-cable");
    assert.equal(f.outputs[0].volume, 0.8);
    assert.equal(f.outputs[0].srcObject, stream);
    f.player.dispose();
    assert.equal(stream.track.stopped, true);
    assert.equal(f.outputs[0].srcObject, null);
    assert.equal(f.outputs[0].paused, true);
    assert.equal(f.player.isMicrophoneActive(), false);
});

for (const stage of ["capture", "sink", "play"]) {
    test(`Stopping during microphone ${stage} prevents late activation`, async () => {
        const f = fixture();
        const stream = microphone();
        const pending = Promise.withResolvers();
        f.capture = async () => stream;
        f[stage] = () => pending.promise;
        const started = f.player.startMicrophone("default", "browser-cable", 100);
        assert.equal(f.player.isMicrophoneActive(), true);
        await setImmediate();
        f.player.dispose();
        assert.equal(f.player.isMicrophoneActive(), false);
        pending.resolve(stream);
        assert.equal(await started, false);
        assert.equal(stream.track.stopped, true);
        for (const output of f.outputs) {
            assert.equal(output.srcObject, null);
            assert.equal(output.paused, true);
        }
    });

    test(`Failure during microphone ${stage} cleans up capture`, async () => {
        const f = fixture();
        const stream = microphone();
        const error = new Error("Audio access failed");
        f.capture = async () => stream;
        f[stage] = async () => { throw error; };
        await assert.rejects(f.player.startMicrophone("default", "browser-cable", 100), error);
        assert.equal(f.player.isMicrophoneActive(), false);
        if (stage !== "capture") assert.equal(stream.track.stopped, true);
        for (const output of f.outputs) {
            assert.equal(output.srcObject, null);
            assert.equal(output.paused, true);
        }
    });
}

for (const rejected of [false, true]) {
    test(`A superseded microphone request cannot stop the new capture when it ${rejected ? "rejects" : "resolves"}`, async () => {
        const f = fixture();
        const first = Promise.withResolvers();
        const oldStream = microphone();
        const newStream = microphone();
        f.capture = () => first.promise;
        const oldRequest = f.player.startMicrophone("old-mic", "browser-cable", 100);
        f.capture = async () => newStream;
        assert.equal(await f.player.startMicrophone("new-mic", "browser-cable", 100), true);
        if (rejected) first.reject(new Error("Old request denied"));
        else first.resolve(oldStream);
        assert.equal(await oldRequest, false);
        if (!rejected) assert.equal(oldStream.track.stopped, true);
        assert.equal(newStream.track.stopped, false);
        assert.equal(f.player.isMicrophoneActive(), true);
        f.player.dispose();
        assert.equal(newStream.track.stopped, true);
    });
}

for (const stage of ["sink", "play"]) {
    test(`Stopping a sound during ${stage} prevents late playback`, async () => {
        const f = fixture();
        const pending = Promise.withResolvers();
        f[stage] = () => pending.promise;
        const started = f.player.playSound({ id: "sound", url: "blob:sound" }, "browser-cable", 80, true);
        await setImmediate();
        f.player.dispose();
        pending.resolve();
        await started;
        assert.equal(f.player.isPlaying("sound"), false);
        assert.ok(f.outputs.every(output => output.paused));
    });
}
