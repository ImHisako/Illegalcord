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

const warningSource = transformSync(readFileSync(new URL("index.tsx", import.meta.url), "utf8"), { loader: "tsx", format: "cjs" }).code;
const cardSource = transformSync(readFileSync(new URL("../../components/settings/tabs/plugins/PluginCard.tsx", import.meta.url), "utf8"), { loader: "tsx", format: "cjs" }).code;
const contextMenuSource = transformSync(readFileSync(new URL("../../api/ContextMenu.ts", import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code;
const buttonSource = transformSync(readFileSync(new URL("../../components/Button.tsx", import.meta.url), "utf8"), { loader: "tsx", format: "cjs" }).code;
const React = { createElement(type, props, ...children) {
    const { key = null, ...rest } = props ?? {};
    return { type, key, props: { ...rest, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) } };
}, Fragment: "fragment" };

function textOf(node) {
    if (Array.isArray(node)) return node.map(textOf).join("");
    if (node == null || typeof node === "boolean") return "";
    if (typeof node !== "object") return String(node);
    return textOf(typeof node.type === "function" ? node.type(node.props) : node.props.children);
}

function findDisableButton(node) {
    if (Array.isArray(node)) return node.map(findDisableButton).find(Boolean);
    if (node == null || typeof node !== "object") return;
    if (typeof node.type === "function") return findDisableButton(node.type(node.props));
    if (node.type === "button" && textOf(node) === "Do not show these warnings again") return node;
    return findDisableButton(node.props.children);
}

function fixture({ name = "ClanSwitcher", enabled = false, warningsEnabled = true, requiresRestart = false, dependencyRestart = false, showActivationWarnings } = {}) {
    const plugin = { name, description: "Test plugin.", started: enabled, requiresRestart };
    const settings = { plugins: { [name]: { enabled }, LegalWarnings: { enabled: warningsEnabled } } };
    if (showActivationWarnings !== undefined) settings.plugins.LegalWarnings.showActivationWarnings = showActivationWarnings;
    const calls = [];
    const dialogs = [];
    const openedTabs = [];
    const settingsPlugin = { buildEntry: options => options };
    const originalBuildEntry = settingsPlugin.buildEntry;
    const sentinel = { type: "div", key: null, ref() {}, props: { style: { height: 32 } } };
    const confirmations = [];
    const dependencies = {
        "@components/ErrorBoundary": { __esModule: true, default: { wrap: component => component } },
        "@components/margins": { Margins: { bottom8: "bottom8" } },
        "@components/Notice": { Notice: { Warning: "warning" } },
        "@utils/constants": { EquicordDevs: { irritably: { name: "irritably" } } },
        "@utils/types": { __esModule: true, default: value => value, OptionType: {} },
        "@webpack/common": {
            React,
            Alerts: {
                confirm(dialog) {
                    dialogs.push(dialog);
                    return new Promise(resolve => confirmations.push(resolve));
                }
            },
            showToast: () => calls.push("toast")
        },
        "@api/Notices": { NoticeColors: {}, showNotice: () => calls.push("notice") },
        "@api/Settings": { Settings: settings, definePluginSettings(def) {
            const store = settings.plugins.LegalWarnings;
            for (const [key, option] of Object.entries(def)) {
                if (!(key in store)) store[key] = option.default;
            }
            return { def, store };
        } },
        "@api/PluginManager": {
            hasAnyVisibleSettings: () => false,
            isPluginEnabled: name => settings.plugins[name].enabled,
            pluginRequiresRestart: plugin => plugin.requiresRestart,
            startDependenciesRecursive: () => { calls.push("dependencies"); return { restartNeeded: dependencyRestart, failures: [] }; },
            startPlugin: () => { calls.push("start"); plugin.started = true; return true; },
            stopPlugin: () => { calls.push("stop"); plugin.started = false; return true; }
        },
        "@components/Icons": { CogWheel: "cog", InfoIcon: "info" },
        "@components/settings/AddonCard": { AddonCard: "card" },
        "@components/settings/tabs/BaseTab": { openSettingsTabModal: Component => openedTabs.push(Component) },
        "@plugins/_core/settings": { __esModule: true, default: settingsPlugin },
        "@utils/css": { classNameFactory: () => () => "" },
        "@utils/misc": { classes: (...values) => values.filter(Boolean).join(" ") },
        "@utils/Logger": { Logger: class {} },
        "~plugins": { PluginMeta: { [name]: { folderName: `src/illegalcordplugins/${name}` } } },
        "./PluginModal": { openPluginModal() {} },
        "./Button.css": {},
        "./Icons": { OpenExternalIcon: "icon" },
        "./Link": { Link: "link" }
    };
    function load(source) {
        const module = { exports: {} };
        compileFunction(source, ["require", "module", "exports", "React"])(name => {
            assert.ok(Object.hasOwn(dependencies, name), name);
            return dependencies[name];
        }, module, module.exports, React);
        return module.exports;
    }
    const { PluginCard } = load(cardSource);
    function PluginsTab() {
        return React.createElement("section", null, [[React.createElement(PluginCard, { key: name, plugin, onRestartNeeded: () => calls.push("restart") })], sentinel]);
    }
    dependencies["@components/settings/tabs/plugins"] = { __esModule: true, default: PluginsTab };
    dependencies["@components/settings/tabs/plugins/PluginCard"] = { PluginCard };
    dependencies["@api/ContextMenu"] = load(contextMenuSource);
    dependencies["@components/Button"] = load(buttonSource);
    const { default: warnings } = load(warningSource);
    if (warningsEnabled) warnings.start();

    function findCard(node) {
        if (Array.isArray(node)) return node.map(findCard).find(Boolean);
        if (node == null || typeof node !== "object") return;
        return node.props.plugin === plugin ? node : findCard(node.props.children);
    }

    function renderTab() {
        const entry = settingsPlugin.buildEntry({ key: "equicord_plugins", Component: PluginsTab });
        return entry.Component();
    }

    function renderCard(Component) {
        const card = findCard(Component ? Component() : renderTab());
        assert.equal(card.key, name);
        return card.type(card.props);
    }

    return {
        plugin, settings, calls, dialogs, openedTabs, warnings, settingsPlugin, originalBuildEntry, originalPluginsTab: PluginsTab, sentinel, renderTab, renderCard,
        toggle: enabled => renderCard().props.setEnabled(enabled),
        confirm: (value, index = confirmations.length - 1) => confirmations[index](value),
        disableFutureWarnings: () => findDisableButton(dialogs[0].body).props.onClick()
    };
}

const coveredPlugins = [
    ["Stalker", "Authorized and responsible use only.", false],
    ["Surveillance", "Authorized and responsible use only.", false],
    ["GhostSelfbot", "High-risk account and credential feature.", true],
    ["AutoModBypass", "Do not use this feature abusively.", false],
    ["MassMention", "Do not use this feature abusively.", true],
    ["IllegalMessageLogger", "Persistent message storage has privacy consequences.", false],
    ["NitroSniper", "Automated redemption and external-service warning.", true],
    ["ClanSwitcher", "Discord API usage warning.", true],
    ["StatusCycler", "Discord API usage warning.", true],
    ["DontLimitMe", "DontLimitMe raises the local outgoing message queue limit.", false],
    ["NitroSniper Nighty Ver", "Automated redemption and external-service warning.", true],
    ["ServerCloner", "ServerCloner automates requests that can create, change or delete", true],
    ["MutualScanner", "MutualScanner automatically requests server members and user profiles", true],
    ["SendTrail", "SendTrail can automatically delete selected messages", true],
    ["SilentDelete", "SilentDelete sends and deletes replacement messages", true],
    ["SilentEdit", "SilentEdit sends a replacement message and can delete the original", true],
    ["FollowUser", "FollowUser automatically joins or leaves voice channels", true],
    ["PlatformSpoofer", "PlatformSpoofer changes the platform information", false],
    ["FakeMuteAndDeafen", "FakeMuteAndDeafen changes mute, deafen or video flags", false],
    ["BoostCounts", "BoostCounts uses your Discord account token", false],
    ["DetectBlock", "DetectBlock can request user profiles", false],
    ["LarpCord", "LarpCord mainly changes your local profile preview", false],
    ["AnonLi", "AnonLi uploads files to an external service", false],
    ["IGP", "IGP uses Discord's message sending actions", false]
];

for (const [name, warning, apiAbuse] of coveredPlugins) {
    test(`${name} shows its safety warning and API risk before activation`, async () => {
        const f = fixture({ name });
        const pending = f.toggle(true);
        assert.equal(f.dialogs.length, 1);
        assert.equal(f.dialogs[0].title, `Enable ${name}?`);
        const body = textOf(f.dialogs[0].body);
        assert.ok(body.includes(warning));
        assert.ok(body.includes(apiAbuse ? "This plugin automates Discord API actions" : "This plugin is not flagged for bulk Discord API automation"));
        const button = findDisableButton(f.dialogs[0].body);
        assert.ok(button, "The warning body must render the opt out button");
        assert.equal(button.props.type, "button");
        assert.equal(f.settings.plugins[name].enabled, false);
        assert.deepEqual(f.calls, []);
        f.confirm(true);
        await pending;
        assert.equal(f.settings.plugins[name].enabled, true);
        assert.deepEqual(f.calls, ["dependencies", "start"]);
    });
}

test("Cancelling leaves the plugin and its dependencies disabled", async () => {
    const f = fixture();
    const pending = f.toggle(true);
    f.confirm(false);
    await pending;
    assert.equal(f.settings.plugins.ClanSwitcher.enabled, false);
    assert.equal(f.plugin.started, false);
    assert.deepEqual(f.calls, []);
});

test("Each activation requires confirmation and disabling does not", async () => {
    const f = fixture({ enabled: true });
    await f.toggle(false);
    assert.equal(f.dialogs.length, 0);
    assert.equal(f.settings.plugins.ClanSwitcher.enabled, false);
    const pending = f.toggle(true);
    assert.equal(f.dialogs.length, 1);
    assert.deepEqual(f.calls, ["stop"]);
    f.confirm(false);
    await pending;
    assert.equal(f.settings.plugins.ClanSwitcher.enabled, false);
});

test("Unlisted plugins activate without a safety popup", async () => {
    const f = fixture({ name: "UnlistedPlugin" });
    await f.toggle(true);
    assert.equal(f.dialogs.length, 0);
    assert.equal(f.settings.plugins.UnlistedPlugin.enabled, true);
    assert.deepEqual(f.calls, ["dependencies", "start"]);
});

test("Disabling LegalWarnings disables its activation confirmations", async () => {
    const f = fixture({ warningsEnabled: false });
    await f.toggle(true);
    assert.equal(f.dialogs.length, 0);
    assert.equal(f.settings.plugins.ClanSwitcher.enabled, true);
});

test("Activation warnings are enabled by default", () => {
    const f = fixture();
    assert.equal(f.warnings.settings.def.showActivationWarnings.default, true);
    assert.equal(f.warnings.settings.store.showActivationWarnings, true);
});

test("The popup preference takes effect immediately and can be turned back on", async () => {
    const f = fixture({ showActivationWarnings: false });
    assert.equal(f.warnings.settings.store.showActivationWarnings, false);
    await f.toggle(true);
    assert.equal(f.dialogs.length, 0);
    assert.equal(f.settings.plugins.ClanSwitcher.enabled, true);
    await f.toggle(false);
    f.warnings.settings.store.showActivationWarnings = true;
    const pending = f.toggle(true);
    assert.equal(f.dialogs.length, 1);
    f.confirm(false);
    await pending;
    assert.equal(f.settings.plugins.ClanSwitcher.enabled, false);
});

test("Rejecting the second confirmation keeps safety popups enabled", async () => {
    const f = fixture();
    const pending = f.toggle(true);
    const disable = f.disableFutureWarnings();
    assert.equal(f.dialogs.length, 2);
    assert.equal(f.dialogs[1].title, "Are you sure?");
    assert.match(f.dialogs[1].body, /Discord's APIs/);
    assert.match(f.dialogs[1].body, /LegalWarnings settings/);
    assert.equal(f.warnings.settings.store.showActivationWarnings, true);
    f.confirm(false);
    await disable;
    assert.equal(f.warnings.settings.store.showActivationWarnings, true);
    assert.deepEqual(f.calls, []);
    f.confirm(false, 0);
    await pending;
    assert.equal(f.settings.plugins.ClanSwitcher.enabled, false);
});

test("Confirming the opt out saves the preference without enabling the current plugin", async () => {
    const f = fixture();
    const pending = f.toggle(true);
    const disable = f.disableFutureWarnings();
    f.confirm(true);
    await disable;
    assert.equal(f.settings.plugins.LegalWarnings.showActivationWarnings, false);
    assert.equal(f.settings.plugins.ClanSwitcher.enabled, false);
    assert.deepEqual(f.calls, []);
    f.confirm(false, 0);
    await pending;
    await f.toggle(true);
    assert.equal(f.dialogs.length, 2);
    assert.equal(f.settings.plugins.ClanSwitcher.enabled, true);
});

test("The original enable action still works after turning off future warnings", async () => {
    const f = fixture();
    const pending = f.toggle(true);
    const disable = f.disableFutureWarnings();
    f.confirm(true);
    await disable;
    assert.equal(f.settings.plugins.ClanSwitcher.enabled, false);
    assert.deepEqual(f.calls, []);
    f.confirm(true, 0);
    await pending;
    assert.equal(f.settings.plugins.ClanSwitcher.enabled, true);
    assert.deepEqual(f.calls, ["dependencies", "start"]);
});

test("Starting and stopping LegalWarnings installs and removes its settings integration", async () => {
    const f = fixture({ warningsEnabled: false });
    assert.equal(f.settingsPlugin.buildEntry, f.originalBuildEntry);
    assert.equal(f.warnings.requiresRestart, true);
    f.warnings.start();
    assert.notEqual(f.settingsPlugin.buildEntry, f.originalBuildEntry);
    const card = f.renderCard();
    f.warnings.stop();
    assert.equal(f.settingsPlugin.buildEntry, f.originalBuildEntry);
    await card.props.setEnabled(true);
    assert.equal(f.dialogs.length, 0);
    assert.equal(f.settings.plugins.ClanSwitcher.enabled, true);
    f.warnings.stop();
});

test("Stopping LegalWarnings cancels an activation awaiting confirmation", async () => {
    const f = fixture();
    const pending = f.toggle(true);
    f.warnings.stop();
    f.confirm(true);
    await pending;
    assert.equal(f.settings.plugins.ClanSwitcher.enabled, false);
    assert.deepEqual(f.calls, []);
});

test("LegalWarnings preserves other settings tabs and later integrations", async () => {
    const f = fixture();
    const Component = () => null;
    assert.equal(f.settingsPlugin.buildEntry({ key: "equicord_themes", Component }).Component, Component);
    const wrappedBuildEntry = f.settingsPlugin.buildEntry;
    const otherBuildEntry = options => wrappedBuildEntry(options);
    f.settingsPlugin.buildEntry = otherBuildEntry;
    f.warnings.stop();
    assert.equal(f.settingsPlugin.buildEntry, otherBuildEntry);
    await f.toggle(true);
    assert.equal(f.dialogs.length, 0);
    assert.equal(f.settings.plugins.ClanSwitcher.enabled, true);
});

test("Starting LegalWarnings does not prompt for plugins already enabled", () => {
    const f = fixture({ enabled: true });
    f.renderCard();
    assert.equal(f.dialogs.length, 0);
    assert.deepEqual(f.calls, []);
});

test("Wrapping plugin cards preserves unrelated elements and scrolling refs", () => {
    const f = fixture();
    assert.equal(f.renderTab().props.children[1], f.sentinel);
});

test("The Toolbox plugin list uses the same confirmation and restores its tab on stop", async () => {
    const f = fixture();
    const item = React.createElement("item", { id: "plugins", action() {} });
    const other = React.createElement("item", { id: "notifications", action() {} });
    const originalOtherAction = other.props.action;
    f.warnings.contextMenus["vc-toolbox"]([React.createElement("group", null, [other, item])]);
    assert.equal(other.props.action, originalOtherAction);
    item.props.action();
    const pending = f.renderCard(f.openedTabs[0]).props.setEnabled(true);
    assert.equal(f.dialogs.length, 1);
    assert.deepEqual(f.calls, []);
    f.confirm(false);
    await pending;
    assert.equal(f.settings.plugins.ClanSwitcher.enabled, false);
    f.warnings.stop();
    item.props.action();
    assert.equal(f.openedTabs[1], f.originalPluginsTab);
});

test("A Toolbox menu without the plugin list is left unchanged", () => {
    const f = fixture();
    const item = React.createElement("item", { id: "notifications", action() {} });
    const { action } = item.props;
    f.warnings.contextMenus["vc-toolbox"]([item]);
    assert.equal(item.props.action, action);
});

for (const options of [{ requiresRestart: true }, { dependencyRestart: true }]) {
    test(`Confirmation precedes restart activation with ${Object.keys(options)[0]}`, async () => {
        const f = fixture({ name: "NitroSniper", ...options });
        const pending = f.toggle(true);
        assert.equal(f.settings.plugins.NitroSniper.enabled, false);
        assert.deepEqual(f.calls, []);
        f.confirm(true);
        await pending;
        assert.equal(f.settings.plugins.NitroSniper.enabled, true);
        assert.equal(f.plugin.started, false);
        assert.deepEqual(f.calls, ["dependencies", "restart"]);
    });
}

test("Confirmation does not restart a plugin enabled while the popup was open", async () => {
    const f = fixture();
    const pending = f.toggle(true);
    f.settings.plugins.ClanSwitcher.enabled = true;
    f.plugin.started = true;
    f.confirm(true);
    await pending;
    assert.equal(f.settings.plugins.ClanSwitcher.enabled, true);
    assert.deepEqual(f.calls, []);
});
