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

const source = transformSync(readFileSync(new URL("index.tsx", import.meta.url), "utf8"), { loader: "tsx", format: "cjs" }).code;
const contextMenuSource = transformSync(readFileSync(new URL("../../api/ContextMenu.ts", import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code;
const createElement = (type, props, ...children) => ({ type, props: { ...props, ...(children.length ? { children } : {}) } });
const item = id => createElement("item", { id });

function fixture() {
    const lifecycle = { init() {}, deinit() {} };
    const dependencies = {
        "@api/Settings": { definePluginSettings: definitions => ({ store: Object.fromEntries(Object.entries(definitions).map(([key, definition]) => [key, definition.default])) }) },
        "@components/Button": { Button: "button" },
        "@utils/constants": { EquicordDevs: {} },
        "@utils/Logger": { Logger: class {} },
        "@utils/types": { __esModule: true, default: plugin => plugin, OptionType: {} },
        "@webpack/common": { Menu: { MenuItem: "item" } },
        "../_legalWarnings": { MonitoringLegalWarning: "warning" },
        "./activity": lifecycle,
        "./status": lifecycle,
        "./voice": lifecycle
    };
    function load(code) {
        const module = { exports: {} };
        compileFunction(code, ["require", "module", "exports", "React", "VencordNative"])(name => {
            assert.ok(Object.hasOwn(dependencies, name), name);
            return dependencies[name];
        }, module, module.exports, { createElement }, { pluginHelpers: { Stalker: {} } });
        return module.exports;
    }
    dependencies["@api/ContextMenu"] = load(contextMenuSource);
    const { default: plugin, settings } = load(source);
    settings.store.targets = "42";
    plugin.start();
    return { plugin, settings, patch: plugin.contextMenus["user-context"] };
}

test("Repeated suspension and restoration keeps one Stalker entry in reused menu children", () => {
    const { plugin, patch } = fixture();
    const native = [item("apps"), item("ignore"), item("block")];
    const group = [...native];
    const children = [createElement("group", { children: group })];
    for (let cycle = 0; cycle < 8; cycle++) {
        patch(children, { user: { id: "42" } });
        assert.deepEqual(group.map(child => child.props.id), ["apps", "vc-st-stalk", "ignore", "block"]);
        assert.equal(group[1].props.label, "Unstalk");
        assert.deepEqual(group.filter(child => child.props.id !== "vc-st-stalk"), native);
        plugin.stop();
        plugin.start();
    }
    plugin.stop();
});

test("Replaces existing duplicates and refreshes the action when the tracked user changes", () => {
    const { plugin, settings, patch } = fixture();
    const children = [item("vc-st-stalk"), item("apps"), item("vc-st-stalk"), item("ignore")];
    patch(children, { user: { id: "42" } });
    assert.deepEqual(children.map(child => child.props.id), ["apps", "vc-st-stalk", "ignore"]);
    children[1].props.action();
    assert.equal(settings.store.targets, "");
    patch(children, { user: { id: "43" } });
    assert.equal(children[1].props.label, "Stalk");
    children[1].props.action();
    assert.equal(settings.store.targets, "43");
    patch(children, { user: { id: "43" } });
    assert.equal(children[1].props.label, "Unstalk");
    assert.equal(children.length, 3);
    plugin.stop();
});
