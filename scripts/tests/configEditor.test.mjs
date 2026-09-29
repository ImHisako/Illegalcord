/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { compileFunction } from "node:vm";

import { transform } from "esbuild";

async function loadSource(name, dependencies = {}, globals = {}) {
    const source = fs.readFileSync(new URL(`../../src/${name}`, import.meta.url), "utf8");
    const { code } = await transform(source, { loader: "ts", format: "cjs" });
    const module = { exports: {} };
    const require = name => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
    };
    compileFunction(code, ["require", "module", "exports", ...Object.keys(globals)])(require, module, module.exports, ...Object.values(globals));
    return module.exports;
}

const prefix = "illegalcordplugins/configEditor.desktop/";
const config = await loadSource(`${prefix}config.ts`);
const { SettingsStore } = await loadSource("shared/SettingsStore.ts");
const initial = () => ({
    autoUpdate: true,
    cloud: { authenticated: false, settingsSync: false, settingsSyncVersion: 123 },
    plugins: {
        ConfigEditor: { enabled: true },
        Active: { enabled: true, volume: 10, filter: { text: "old", nested: true } },
        Disabled: { enabled: false, token: "local value", settingsSyncVersion: 7 },
        Removed: { enabled: true, data: [1, 2, 3] }
    }
});

test("Rejects malformed, unsafe, oversized and structurally invalid configurations", () => {
    for (const text of ["{", "null", "[]", "{}", '{"plugins":[],"cloud":{}}', '{"plugins":{"X":{"enabled":"yes"}},"cloud":{}}', '{"plugins":{},"cloud":{},"__proto__":{"polluted":true}}', '{"plugins":{},"cloud":{},"x":1e999}']) {
        assert.throws(() => config.parseConfig(text));
    }
    assert.throws(() => config.parseConfig(JSON.stringify({ ...initial(), huge: "a".repeat(config.MAX_CONFIG_SIZE) })));
    assert.throws(() => config.parseConfig('{"plugins":{},"cloud":{},"deep":' + "[".repeat(70) + "0" + "]".repeat(70) + "}"));
    assert.equal(config.parseConfig(JSON.stringify(initial())).plugins.Active.volume, 10);
});

test("Snapshots omit only the managed cloud timestamp", () => {
    const parsed = JSON.parse(config.serializeConfig(initial()));
    assert.equal(parsed.cloud.settingsSyncVersion, undefined);
    assert.equal(parsed.plugins.Disabled.settingsSyncVersion, 7);
});

test("Cleanup covers all installed plugin sources and never reactivates a disabled plugin", () => {
    const current = initial();
    const installed = { ConfigEditor: { started: true }, Active: { started: true }, Disabled: { started: false } };
    assert.deepEqual(config.cleanupCandidates(current, installed).map(({ name, kind }) => ({ name, kind })), [
        { name: "Disabled", kind: "disabled" }, { name: "Removed", kind: "removed" }
    ]);
    const cleaned = config.cleanConfig(current, installed, ["Active", "Disabled", "Removed"]);
    assert.deepEqual(cleaned.plugins.Disabled, { enabled: false });
    assert.equal(cleaned.plugins.Removed, undefined);
    assert.deepEqual(cleaned.plugins.Active, current.plugins.Active);
    assert.ok(current.plugins.Removed);
    for (const protection of ["started", "required", "isDependency"]) {
        assert.equal(config.cleanupCandidates(current, { ...installed, Disabled: { [protection]: true } }).some(item => item.name === "Disabled"), false);
    }
});

test("Applies exact setting paths once and preserves store references and cloud metadata", () => {
    const store = new SettingsStore(initial());
    const root = store.plain;
    const seen = [];
    store.addChangeListener("plugins.Active.filter", value => seen.push(value));
    const next = config.parseConfig(config.serializeConfig(root));
    next.plugins.Active.filter = { text: "new", nested: false };
    next.plugins.Disabled = { enabled: false };
    delete next.plugins.Removed;
    config.syncObject(store.store, next);
    assert.equal(store.plain, root);
    assert.deepEqual(seen, [{ text: "new", nested: false }]);
    assert.deepEqual(root.plugins.Disabled, { enabled: false });
    assert.equal(root.cloud.settingsSyncVersion, 123);
    assert.equal(root.plugins.Removed, undefined);
});

async function nativeFixture(t, overrides = {}) {
    const directory = fs.mkdtempSync(path.join(tmpdir(), "config-editor-test-"));
    const settingsFile = path.join(directory, "settings", "settings.json");
    fs.mkdirSync(path.dirname(settingsFile));
    const renderer = { plain: initial() };
    fs.writeFileSync(settingsFile, JSON.stringify(renderer.plain));
    t.after(() => {
        const resolved = path.resolve(directory);
        assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
        assert.ok(path.basename(resolved).startsWith("config-editor-test-"));
        fs.rmSync(resolved, { recursive: true, force: true });
    });
    const native = await loadSource(`${prefix}native.ts`, {
        "@illegalcordplugins/DiscordHardened/nativeSecurity": { isTrustedSender: event => event.trusted },
        "@main/settings": { RendererSettings: renderer },
        "@main/utils/constants": { DATA_DIR: directory, SETTINGS_FILE: settingsFile },
        crypto, fs: { ...fs, ...overrides }, path, "./config": config
    });
    return { native, renderer, directory, settingsFile, event: { trusted: true } };
}

test("Backups preserve names, authors, server dates and exact configuration", async t => {
    const { native, renderer, directory, event, settingsFile } = await nativeFixture(t);
    const result = native.createBackup(event, "My daily setup", "Hisako");
    assert.equal(result.success, true);
    assert.ok(fs.existsSync(path.join(directory, "ConfigBackups", `${result.backup.id}.json`)));
    const loaded = native.loadBackup(event, result.backup.id);
    assert.equal(loaded.success, true);
    assert.equal(loaded.backup.name, "My daily setup");
    assert.equal(loaded.backup.author, "Hisako");
    assert.ok(Number.isFinite(Date.parse(loaded.backup.createdAt)));
    assert.deepEqual(loaded.backup.settings, renderer.plain);
    renderer.plain.plugins.Active.volume = 99;
    assert.equal(native.flushSettings(event).success, true);
    renderer.plain = loaded.backup.settings;
    assert.equal(native.flushSettings(event).success, true);
    assert.equal(JSON.parse(fs.readFileSync(settingsFile, "utf8")).plugins.Active.volume, 10);
    assert.deepEqual(fs.readdirSync(path.dirname(settingsFile)), ["settings.json"]);
    assert.equal(native.listBackups(event).backups.length, 1);
});

test("Rejects untrusted senders, invalid metadata and path traversal", async t => {
    const { native, event, directory } = await nativeFixture(t);
    for (const operation of [() => native.createBackup({ trusted: false }, "X", "Y"), () => native.listBackups({ trusted: false }), () => native.loadBackup({ trusted: false }, "x"), () => native.flushSettings({ trusted: false })]) {
        assert.equal(operation().success, false);
    }
    assert.equal(fs.existsSync(path.join(directory, "ConfigBackups")), false);
    for (const id of ["../settings/settings", "C:\\settings", null, {}, "x".repeat(1000)]) assert.equal(native.loadBackup(event, id).success, false);
    for (const name of ["", "a".repeat(81), "bad\nname", null]) assert.equal(native.createBackup(event, name, "Author").success, false);
});

test("Invalid backup files are reported without deleting valid backups", async t => {
    const { native, event, directory } = await nativeFixture(t);
    native.createBackup(event, "Valid", "Author");
    fs.writeFileSync(path.join(directory, "ConfigBackups", `${crypto.randomUUID()}.json`), "broken");
    const list = native.listBackups(event);
    assert.equal(list.success, true);
    assert.equal(list.backups.length, 1);
    assert.equal(list.unreadable, 1);
    assert.equal(fs.readdirSync(path.join(directory, "ConfigBackups")).length, 2);
});

test("Failed atomic writes leave settings.json intact and return scrubbed errors", async t => {
    const { native, event, renderer, settingsFile } = await nativeFixture(t, { renameSync() { throw new Error("Secret main process path"); } });
    renderer.plain.autoUpdate = false;
    const result = native.flushSettings(event);
    assert.equal(result.success, false);
    assert.equal(result.error.includes("Secret"), false);
    assert.equal(JSON.parse(fs.readFileSync(settingsFile, "utf8")).autoUpdate, true);
    assert.deepEqual(fs.readdirSync(path.dirname(settingsFile)), ["settings.json"]);
});

async function rendererFixture() {
    const store = new SettingsStore(initial());
    const backups = [];
    let saved = 0;
    let failBackup = false;
    let failFlush = false;
    let duringBackup = () => {};
    const utils = await loadSource(`${prefix}utils.ts`, {
        "@api/Settings": { PlainSettings: store.plain, Settings: store.store },
        "@utils/types": { OptionType: { STRING: 0, NUMBER: 1, BIGINT: 2, BOOLEAN: 3, SELECT: 4, SLIDER: 5, COMPONENT: 6, CUSTOM: 7 } },
        "@webpack/common": { UserStore: { getCurrentUser: () => ({ username: "Author" }) } },
        "~plugins": { __esModule: true, default: {
            ConfigEditor: {},
            Active: { settings: { def: { volume: { type: 1, default: 10, isValid: value => value >= 0 && value <= 100 }, filter: { type: 7 } } } },
            Disabled: {}, Required: { required: true }
        } },
        "./config": config
    }, {
        VencordNative: {
            settings: { set: async () => { saved++; } },
            pluginHelpers: { ConfigEditor: {
                createBackup: async name => {
                    if (failBackup) return { success: false, error: "Backup failed." };
                    const backup = { name, settings: structuredClone(store.plain) };
                    backups.push(backup);
                    duringBackup();
                    return { success: true, backup };
                },
                flushSettings: async () => failFlush ? { success: false, error: "Disk full." } : { success: true }
            } }
        }
    });
    return { store, utils, backups, get saved() { return saved; }, failBackup() { failBackup = true; }, failFlush() { failFlush = true; }, duringBackup(fn) { duringBackup = fn; } };
}

test("Live application validates plugin values, backs up first and triggers setting listeners", async () => {
    const { store, utils, backups } = await rendererFixture();
    const base = utils.snapshot();
    const next = config.parseConfig(base);
    next.plugins.Active.volume = 20;
    const observed = [];
    store.addChangeListener("plugins.Active.volume", value => observed.push(value));
    await utils.applyConfig(JSON.stringify(next), base, "Before live edit");
    assert.equal(backups[0].settings.plugins.Active.volume, 10);
    assert.equal(store.plain.plugins.Active.volume, 20);
    assert.deepEqual(observed, [20]);
    next.plugins.Active.volume = -1;
    await assert.rejects(() => utils.applyConfig(JSON.stringify(next), utils.snapshot(), "Invalid"), /validation/);
    assert.equal(backups.length, 1);
});

test("Refuses invalid core types and required plugin disablement", async () => {
    const { utils } = await rendererFixture();
    const next = config.parseConfig(utils.snapshot());
    next.autoUpdate = "no";
    assert.throws(() => utils.validateConfig(JSON.stringify(next)), /boolean/);
    next.autoUpdate = true;
    next.plugins.Required = { enabled: false };
    assert.throws(() => utils.validateConfig(JSON.stringify(next)), /required/);
});

test("Conflicts and cancellation cannot overwrite newer settings", async () => {
    const fixture = await rendererFixture();
    const base = fixture.utils.snapshot();
    const next = config.parseConfig(base);
    next.plugins.Active.volume = 20;
    fixture.duringBackup(() => { fixture.store.store.plugins.Active.volume = 30; });
    await assert.rejects(() => fixture.utils.applyConfig(JSON.stringify(next), base, "Conflict"), /changed/);
    assert.equal(fixture.store.plain.plugins.Active.volume, 30);
    fixture.duringBackup(() => {});
    await assert.rejects(() => fixture.utils.applyConfig(JSON.stringify(next), fixture.utils.snapshot(), "Cancelled", () => false), /cancelled/);
    assert.equal(fixture.store.plain.plugins.Active.volume, 30);
});

test("Restores omitted active settings to their declared defaults", async () => {
    const { utils, store } = await rendererFixture();
    store.store.plugins.Active.volume = 40;
    const base = utils.snapshot();
    const next = config.parseConfig(base);
    delete next.plugins.Active.volume;
    await utils.applyConfig(JSON.stringify(next), base, "Restore defaults");
    assert.equal(store.plain.plugins.Active.volume, 10);
});

test("Backup failure prevents changes and save failure restores previous values", async () => {
    for (const fail of ["failBackup", "failFlush"]) {
        const fixture = await rendererFixture();
        const base = fixture.utils.snapshot();
        const next = config.parseConfig(base);
        next.plugins.Active.volume = 20;
        fixture[fail]();
        await assert.rejects(() => fixture.utils.applyConfig(JSON.stringify(next), base, "Recovery"));
        assert.equal(fixture.store.plain.plugins.Active.volume, 10);
    }
});
