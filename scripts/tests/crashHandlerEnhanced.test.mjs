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

const directory = new URL("../../src/illegalcordplugins/crashHandlerEnhanched/", import.meta.url);
const source = readFileSync(new URL("index.tsx", directory), "utf8");
const createElement = (type, props, ...children) => ({ type, props: { ...props, children } });

function load(code, globals) {
    const transformed = transformSync(code, { loader: "tsx", format: "cjs" }).code;
    return compileFunction(transformed, Object.keys(globals))(...Object.values(globals));
}

function supportFixture() {
    const hosts = new Set();
    const roots = [];
    const alerts = [];
    const errors = [];
    const effects = [];
    const dialog = { showModal() { this.open = true; }, close() { this.open = false; }, open: false };
    const dependencies = {
        "@components/BaseText": { BaseText: "text" },
        "@components/Button": { Button: "button" },
        "@components/ErrorBoundary": { wrap: component => component },
        "@utils/Logger": { Logger: class { error(...args) { errors.push(args); } } },
        "@webpack/common": {
            React: { createElement, useRef: () => ({ current: dialog }), useLayoutEffect: effect => effects.push(effect) },
            Alerts: { show: alert => alerts.push(alert) },
            createRoot: host => {
                const root = { host, render(element) { this.element = element; }, unmount() { this.unmounted = true; } };
                roots.push(root);
                return root;
            }
        }
    };
    const module = { exports: {} };
    load(readFileSync(new URL("support.tsx", directory), "utf8"), {
        module, exports: module.exports,
        require: name => { assert.ok(Object.hasOwn(dependencies, name)); return dependencies[name]; },
        document: { createElement: () => ({ remove() { hosts.delete(this); } }), body: { append: host => hosts.add(host) } }
    });
    const overlay = () => {
        const { type, props } = roots.at(-1).element;
        return type(props);
    };
    const open = () => module.exports.openSupportPopup(onClose => createElement("panel", { onClose }));
    return { ...module.exports, open, overlay, hosts, roots, alerts, errors, effects, dialog };
}

function nodes(element) {
    if (element == null || typeof element !== "object") return [];
    if (Array.isArray(element)) return element.flatMap(nodes);
    if (typeof element.type === "function") return nodes(element.type(element.props));
    return [element, ...nodes(element.props.children)];
}

test("Keeps the crash popup outside Discord and reuses its root for repeated crashes", () => {
    const fixture = supportFixture();
    fixture.open();
    assert.equal(fixture.hosts.size, 1);
    assert.equal(fixture.roots.length, 1);
    assert.equal(fixture.overlay().type, "dialog");
    const cleanup = fixture.effects[0]();
    assert.equal(fixture.dialog.open, true);
    fixture.showSupportAlert({ title: "Previous action", body: "Pending confirmation" });
    fixture.openSupportPopup(onClose => createElement("updated-report", { onClose }));
    assert.equal(fixture.roots.length, 1);
    assert.equal(fixture.roots[0].element.props.content.type, "updated-report");
    assert.equal(fixture.roots[0].element.props.alert, null);
    assert.equal(fixture.alerts.length, 0);
    fixture.closeSupportPopup();
    cleanup();
    assert.equal(fixture.hosts.size, 0);
    assert.equal(fixture.roots[0].unmounted, true);
    assert.equal(fixture.dialog.open, false);
    fixture.open();
    assert.equal(fixture.roots.length, 2);
});

test("Runs confirmation and cancellation without Discord alerts or losing the recovery panel", () => {
    const fixture = supportFixture();
    fixture.open();
    let confirmed = 0;
    let cancelled = 0;
    fixture.showSupportAlert({ title: "Safe mode", body: "Restart?", onConfirm: () => { confirmed++; }, onCancel: () => { cancelled++; } });
    let buttons = nodes(fixture.overlay()).filter(node => node.type === "button");
    buttons[0].props.onClick();
    assert.equal(cancelled, 1);
    assert.equal(fixture.roots[0].element.props.alert, null);
    fixture.showSupportAlert({ title: "Test plugin", body: "Disable?", onConfirm: () => { confirmed++; } });
    buttons = nodes(fixture.overlay()).filter(node => node.type === "button");
    buttons[1].props.onClick();
    assert.equal(confirmed, 1);
    assert.equal(fixture.roots[0].element.props.alert, null);
    assert.equal(fixture.hosts.size, 1);
    assert.equal(fixture.alerts.length, 0);
});

test("Preserves a followup confirmation and reports asynchronous recovery failures", async () => {
    const fixture = supportFixture();
    fixture.open();
    fixture.showSupportAlert({ title: "Test", body: "Disable?", onConfirm: () => {
        fixture.showSupportAlert({ title: "Restart required", body: "Restart now?" });
    } });
    nodes(fixture.overlay()).filter(node => node.type === "button")[1].props.onClick();
    assert.equal(fixture.roots[0].element.props.alert.title, "Restart required");
    fixture.showSupportAlert({ title: "Failing action", body: "Try?", onConfirm: async () => { throw new Error("Test failure"); } });
    nodes(fixture.overlay()).filter(node => node.type === "button")[1].props.onClick();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(fixture.roots[0].element.props.alert.title, "Recovery action failed.");
    assert.equal(fixture.errors.length, 1);
});

test("Escape cancels an active confirmation before dismissing the popup", () => {
    const fixture = supportFixture();
    fixture.open();
    let prevented = 0;
    const event = { preventDefault: () => { prevented++; } };
    fixture.showSupportAlert({ title: "Confirm", body: "Confirm?" });
    fixture.overlay().props.onCancel(event);
    assert.equal(fixture.hosts.size, 1);
    fixture.overlay().props.onCancel(event);
    assert.equal(prevented, 2);
    assert.equal(fixture.hosts.size, 0);
});

test("Opens the popup before touching a broken Discord boundary and keeps it after failed recovery", () => {
    const calls = [];
    const timers = [];
    const report = { recentCrashCount: 1 };
    const start = source.indexOf("function handleCrash(");
    const end = source.indexOf("function normalizeGlobalError(", start);
    const handleCrash = load("let isRecovering = false, queuedCrash = null, recoveryTimer, hasPromptedForUpdate = false;\n" + source.slice(start, end) + "\nreturn handleCrash;", {
        createReport: () => report, maybeDisableSuspectedPlugin() {}, saveReport() {}, writeCrashLog() {},
        settings: { store: { showSupportPopup: true, recoverClient: true } },
        openCrashSupportModal: () => calls.push("popup"),
        setTimeout: callback => { timers.push(callback); return timers.length; },
        recoverCrashBoundary: () => false, shouldNotifyCrash: () => true,
        showNotification() {}, rememberCrashNotification() {}, maybePromptToUpdate() {}, logger: { debug() {} }
    });
    handleCrash({ setState: () => calls.push("boundary") }, { error: new Error("Crash") });
    assert.deepEqual(calls, ["popup", "boundary"]);
    timers.shift()();
    assert.equal(report.recovered, false);
    assert.equal(calls.at(-1), "popup");
});

test("Catches errors in Discord's crash screen and schedules a single independent recovery", () => {
    const timers = [];
    const failures = [];
    const start = source.indexOf("    renderRoot(render:");
    const method = source.slice(start, source.lastIndexOf("\n});"));
    const plugin = load("let renderFailureTimer; const plugin = {" + method + "}; return plugin;", {
        setTimeout: callback => { timers.push(callback); return timers.length; }, reportScreenFailure: error => failures.push(error),
        React: { createElement }, SafeCrashSupportScreen: "monitor"
    });
    const error = new Error("Discord crash screen also failed");
    assert.equal(plugin.renderRoot(() => { throw error; }), null);
    assert.equal(plugin.renderRoot(() => { throw error; }), null);
    assert.equal(timers.length, 1);
    timers.shift()();
    assert.deepEqual(failures, [error]);
});

test("Includes the settings diagnostics and history in the popup without Discord scrollers", () => {
    const store = { crashCount: "1", lastCrashAt: "1234567890000", lastCrashReport: "Report", autoDisabledPlugins: "[]", safeModePlugins: "" };
    const report = { recentCrashCount: 1, recovered: false, kind: "render", possiblePlugins: [], recurringPlugins: [], patchedModules: [], message: "Test crash" };
    const history = [{ id: "1", timestamp: 1234567890000, kind: "render", message: "Test crash", suspectedPlugin: "Example", fingerprint: "test", recentPluginNames: ["Example"] }];
    const events = [{ timestamp: 1234567890000, kind: "start" }];
    const globals = {
        React: { createElement, useState: initial => [initial, () => {}] },
        BaseText: "text", Button: "button", Flex: "flex", WarningIcon: "icon", OpenExternalIcon: "icon", CopyIcon: "icon",
        ScrollerThin: () => { throw new Error("Discord scroller is broken"); },
        ErrorBoundary: { wrap: component => component },
        settings: { store, use: () => store }, SETTINGS_KEYS: [], latestReport: report,
        cl: value => value, readStringList: JSON.parse, readDiagnosticTest: () => null,
        readCrashHistory: () => JSON.parse(store.crashHistory ?? JSON.stringify(history)),
        readDiagnosticEvents: () => JSON.parse(store.diagnosticEvents ?? JSON.stringify(events)),
        Plugins: { Example: { name: "Example" } }, Settings: { plugins: { Example: { enabled: true } } },
        isPluginEnabled: () => true, CRASH_KIND_LABELS: { render: "Screen rendering crash" }, Native: undefined
    };
    for (const name of ["openCrashSupportModal", "copyLatestReport", "openCrashLogsFolder", "openProcessCrashFolder", "restoreSafeMode", "requestSafeMode", "clearClientCache", "restoreAutoDisabledPlugin", "triggerTestCrash", "markPluginTestWithoutCrash", "restoreTestedPlugin", "beginPluginTest", "relaunch", "disableOptionalPlugins", "checkAndUpdateIllegalcord", "openExternal"]) globals[name] = () => {};
    const modal = source.slice(source.indexOf("function CrashSupportModal("), source.indexOf("function CrashSupportScreen("));
    const settings = source.slice(source.indexOf("function CrashHandlerSettings("), source.indexOf("export default definePlugin("));
    const render = load(modal + settings + "\nreturn CrashSupportModal;", globals);
    const elements = nodes(render({ modalProps: { onClose() {} }, report }));
    const text = elements.flatMap(element => element.props.children).filter(child => typeof child === "string").join(" ");
    for (const label of ["Reports and logs", "Recovery", "Diagnostics", "Recent plugin changes and client starts", "Recent errors", "Recorded errors:"]) assert.ok(text.includes(label), label);
    const buttons = elements.filter(element => element.type === "button");
    const findButton = label => buttons.find(button => button.props.children.includes(label));
    assert.equal(findButton("Open popup"), undefined);
    assert.equal(findButton("Open logs folder").props.disabled, true);
    assert.equal(findButton("Open process dumps").props.disabled, true);
    assert.ok(text.includes("Example"));
    findButton("Clear activity").props.onClick();
    assert.equal(store.diagnosticEvents, "[]");
    findButton("Clear errors").props.onClick();
    assert.equal(store.crashHistory, "[]");
    assert.equal(store.crashCount, "0");
    assert.equal(store.lastCrashReport, "");
});
