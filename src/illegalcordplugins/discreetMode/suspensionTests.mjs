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

const source = transformSync(readFileSync(new URL("suspension.ts", import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code;

function fixture({ active = false, snapshot, failSave = false } = {}) {
    const plugins = {
        DiscreetMode: { name: "DiscreetMode", dependencies: ["CommandsAPI"] },
        LarpCord: { name: "LarpCord", dependencies: ["HeaderBarAPI"] },
        CommandsAPI: { name: "CommandsAPI", required: true },
        HeaderBarAPI: { name: "HeaderBarAPI" },
        Settings: { name: "Settings", required: true },
        StaffDetector: { name: "StaffDetector", started: true },
        StatusCycler: { name: "StatusCycler", started: true },
        FakeNitro: { name: "FakeNitro", started: true },
        Announcements: { name: "Announcements", required: true, started: true },
        InitiallyOff: { name: "InitiallyOff" }
    };
    const meta = Object.fromEntries(Object.keys(plugins).map(name => [name, { folderName: `src/${name.endsWith("API") ? "plugins/_api" : name === "Settings" ? "plugins/_core" : "illegalcordplugins"}/${name}` }]));
    const state = {
        plugins: Object.fromEntries(Object.keys(plugins).map(name => [name, { enabled: name !== "InitiallyOff" && name !== "Announcements" }])),
        cloud: { settingsSync: true }
    };
    const data = { active, suspendedPlugins: snapshot };
    const listeners = new Map();
    const store = new Proxy(data, { set(target, key, value) {
        const changed = target[key] !== value;
        target[key] = value;
        if (changed) listeners.get(`plugins.DiscreetMode.${key}`)?.();
        return true;
    } });
    state.plugins.DiscreetMode = store;
    store.enabled = true;
    const saved = [];
    const errors = [];
    const stopped = [];
    const reloads = [];
    const patches = Object.keys(plugins).map(plugin => ({ plugin }));
    const dependencies = {
        "~plugins": { __esModule: true, default: plugins, PluginMeta: meta },
        "./settings": { settings: { store } },
        "@webpack/patcher": { patches },
        "@api/PluginManager": {
            isPluginEnabled: name => plugins[name].required || plugins[name].isDependency || state.plugins[name].enabled,
            stopPlugin: plugin => { stopped.push(plugin.name); plugin.started = false; }
        },
        "@api/Settings": { Settings: state, SettingsStore: {
            plain: state,
            addChangeListener(key, listener) { listeners.set(key, listener); },
            removeChangeListener(key, listener) { assert.equal(listeners.get(key), listener); listeners.delete(key); }
        } },
        "@utils/Logger": { Logger: class { error(...args) { errors.push(args); } } }
    };
    const module = { exports: {} };
    compileFunction(source, ["require", "module", "exports", "VencordNative", "location"])(name => {
        assert.ok(Object.hasOwn(dependencies, name), name);
        return dependencies[name];
    }, module, module.exports, { settings: { async set(value) {
        if (failSave) throw new Error("Write failed");
        saved.push(structuredClone({ ...value, plugins: { ...value.plugins, DiscreetMode: data } }));
    } } }, { reload: () => reloads.push(true) });
    const install = module.exports.installPluginSuspension;
    return { plugins, state, store, data, install, saved, errors, stopped, reloads, patches, listeners };
}

async function settle() {
    await new Promise(resolve => setImmediate(resolve));
}

test("Suspends plugin automations and notifications, saves enabled choices and restores them before reloading", async () => {
    const f = fixture();
    const handle = f.install();
    handle.onReady();
    f.store.active = true;
    await settle();
    assert.equal(f.state.plugins.StaffDetector.enabled, false);
    assert.equal(f.state.plugins.StatusCycler.enabled, false);
    assert.equal(f.state.plugins.FakeNitro.enabled, false);
    assert.equal(f.plugins.Announcements.required, false);
    assert.deepEqual(f.stopped.sort(), ["Announcements", "FakeNitro", "StaffDetector", "StatusCycler"]);
    assert.equal(f.state.plugins.LarpCord.enabled, true);
    assert.equal(f.state.plugins.DiscreetMode.enabled, true);
    assert.equal(f.state.plugins.CommandsAPI.enabled, true);
    assert.equal(f.state.cloud.settingsSync, false);
    assert.equal(f.saved[0].plugins.DiscreetMode.suspendedPlugins.plugins.StaffDetector, true);
    assert.equal(f.reloads.length, 1);
    f.store.active = false;
    await settle();
    assert.equal(f.state.plugins.StaffDetector.enabled, true);
    assert.equal(f.state.plugins.InitiallyOff.enabled, false);
    assert.equal(f.state.plugins.Announcements.enabled, false);
    assert.equal(f.plugins.Announcements.required, true);
    assert.equal(f.state.cloud.settingsSync, true);
    assert.equal(f.store.suspendedPlugins, undefined);
    assert.equal(f.reloads.length, 2);
    assert.equal(f.saved.at(-1).plugins.StaffDetector.enabled, true);
    handle.stop();
    assert.equal(f.listeners.size, 0);
});

test("Prunes feature patches at boot, retains infrastructure and restores a previous session's snapshot", async () => {
    const f = fixture({ active: true, snapshot: { plugins: { StaffDetector: true, StatusCycler: true, InitiallyOff: false, Announcements: false }, settingsSync: true } });
    f.state.plugins.StaffDetector.enabled = false;
    f.state.plugins.StatusCycler.enabled = false;
    const handle = f.install();
    handle.onReady();
    await settle();
    assert.equal(f.reloads.length, 0);
    assert.deepEqual(f.patches.map(patch => patch.plugin), ["DiscreetMode", "LarpCord", "CommandsAPI", "HeaderBarAPI", "Settings"]);
    assert.equal(f.store.suspendedPlugins.plugins.StaffDetector, true);
    f.store.active = false;
    await settle();
    assert.equal(f.state.plugins.StaffDetector.enabled, true);
    assert.equal(f.state.plugins.StatusCycler.enabled, true);
    assert.equal(f.store.suspendedPlugins, undefined);
    handle.stop();
});

test("Coalesces rapid toggles without losing the original plugin selection", async () => {
    const f = fixture();
    const handle = f.install();
    handle.onReady();
    f.store.active = true;
    f.store.active = false;
    await settle();
    assert.equal(f.store.active, false);
    assert.equal(f.state.plugins.StaffDetector.enabled, true);
    assert.equal(f.state.plugins.InitiallyOff.enabled, false);
    assert.equal(f.store.suspendedPlugins, undefined);
    assert.equal(f.reloads.length, 1);
    assert.equal(f.stopped.length, 0);
    handle.stop();
});

test("Retains a recoverable backup on save failure and never reloads unsaved settings", async () => {
    const f = fixture({ failSave: true });
    const handle = f.install();
    handle.onReady();
    f.store.active = true;
    await settle();
    assert.equal(f.reloads.length, 0);
    assert.equal(f.store.suspendedPlugins.plugins.StaffDetector, true);
    assert.equal(f.errors.length, 1);
    assert.equal(f.stopped.length, 0);
    f.store.active = false;
    await settle();
    assert.equal(f.state.plugins.StaffDetector.enabled, true);
    assert.equal(f.store.suspendedPlugins.plugins.StaffDetector, true);
    assert.equal(f.reloads.length, 0);
    handle.stop();
    await settle();
});

test("Recovers plugins if the active flag was cleared while a saved suspension was still present", async () => {
    const f = fixture({ snapshot: { plugins: { StaffDetector: true, InitiallyOff: false }, settingsSync: true } });
    f.state.plugins.StaffDetector.enabled = false;
    const handle = f.install();
    await settle();
    assert.equal(f.state.plugins.StaffDetector.enabled, true);
    assert.equal(f.store.suspendedPlugins, undefined);
    assert.equal(f.reloads.length, 1);
    handle.stop();
});

test("Restores suspended plugins when DiscreetMode itself is disabled", async () => {
    const f = fixture();
    const handle = f.install();
    handle.onReady();
    f.store.active = true;
    await settle();
    f.store.enabled = false;
    handle.stop();
    await settle();
    assert.equal(f.state.plugins.StaffDetector.enabled, true);
    assert.equal(f.state.plugins.InitiallyOff.enabled, false);
    assert.equal(f.store.suspendedPlugins, undefined);
    assert.equal(f.listeners.size, 0);
    assert.equal(f.reloads.length, 2);
});
