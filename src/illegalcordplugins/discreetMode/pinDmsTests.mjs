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

function fixture() {
    const category = { id: "friends", name: "Friends", color: 0, channels: ["pinned"], collapsed: false };
    const categories = [category];
    const store = { pinOrder: 0, canCollapseDmSection: true, dmSectionCollapsed: true, userBasedCategoryList: { self: categories } };
    const settings = { store, use() {} };
    const state = { hidden: false, enabled: true, userId: "self", updates: 0 };
    const listeners = new Map();
    const dependencies = {
        "./styles.css": {},
        "@api/PluginManager": { isPluginEnabled: () => state.enabled },
        "@api/Settings": {
            definePluginSettings: () => settings,
            SettingsStore: {
                addChangeListener(key, callback) { assert.equal(listeners.has(key), false); listeners.set(key, callback); },
                removeChangeListener(key, callback) { assert.equal(listeners.get(key), callback); listeners.delete(key); }
            }
        },
        "@components/ErrorBoundary": { wrap: component => component },
        "@plugins/pinDms": { PinOrder: { LastMessage: 0, Custom: 1 }, settings },
        "@plugins/pinDms/constants": { DEFAULT_CHUNK_SIZE: 256 },
        "@utils/constants": { Devs: { Ven: {}, Aria: {} } },
        "@utils/misc": { classes: (...values) => values.join(" ") },
        "@utils/react": { useForceUpdater: () => () => { state.updates++; } },
        "@utils/types": { __esModule: true, default: plugin => plugin, OptionType: {}, StartAt: {} },
        "@webpack": { findCssClassesLazy: () => ({}) },
        "@webpack/common": {
            PrivateChannelSortStore: { getPrivateChannelIds: () => ["recent", "pinned"] },
            UserStore: { getCurrentUser: () => ({ id: state.userId }) },
            React: { createElement: (type, props) => ({ type, props }) }
        },
        "./settings": { settings },
        "./components/contextMenu": { contextMenus: {} },
        "./components/CreateCategoryModal": {},
        "./constants": { DEFAULT_CHUNK_SIZE: 256 }
    };
    function load(path) {
        const { code } = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), { loader: "tsx", format: "cjs" });
        const module = { exports: {} };
        compileFunction(code, ["require", "module", "exports"])(name => {
            assert.ok(Object.hasOwn(dependencies, name), name);
            return dependencies[name];
        }, module, module.exports);
        return module.exports;
    }
    const data = load("../../plugins/pinDms/data.ts");
    dependencies["./data"] = data;
    const plugin = load("../../plugins/pinDms/index.tsx").default;
    dependencies["@plugins/pinDms"] = { __esModule: true, default: plugin };
    dependencies["@plugins/pinDms/data"] = data;
    const { installPinDmsPrivacy } = load("pinDms.ts");
    plugin.usePinnedDms();
    void data.init();
    return { plugin, data, store, state, categories, category, listeners, install: () => installPinDmsPrivacy(() => state.hidden) };
}

test("Hides saved PinDMs categories, collapsed sections and ordering while keeping every DM accessible", () => {
    const f = fixture();
    const saved = structuredClone(f.store);
    const instance = { props: { privateChannelIds: ["recent"], selectedChannelId: "recent" } };
    assert.equal(f.plugin.isPinned("pinned"), true);
    assert.deepEqual(f.plugin.makeProps(instance, { sections: [1, 1] }).sections, [1, 1, 1]);
    assert.equal(f.plugin.isChannelHidden(2, 0), true);
    const handle = f.install();
    f.state.hidden = true;
    f.listeners.get("plugins.DiscreetMode.active")();
    assert.equal(f.plugin.isPinned("pinned"), false);
    assert.deepEqual(["recent", "pinned"].filter(id => !f.plugin.isPinned(id)), ["recent", "pinned"]);
    assert.equal(f.plugin.categoryLen(), 0);
    assert.deepEqual(f.plugin.getSections(), []);
    assert.deepEqual(f.plugin.getAllUncollapsedChannels(), []);
    const props = { sections: [1, 2] };
    assert.deepEqual(f.plugin.makeProps(instance, props).sections, [1, 2]);
    assert.deepEqual(props.sections, [1, 2]);
    assert.equal(f.plugin.isCategoryIndex(1), false);
    assert.equal(f.plugin.isChannelIndex(1, 0), false);
    assert.equal(f.plugin.isChannelHidden(2, 0), false);
    assert.equal(f.plugin.makeSpanProps(), undefined);
    assert.equal(f.plugin.getScrollOffset("pinned", 44, 8, 2, 120), 120);
    assert.deepEqual(f.store, saved);
    assert.equal(f.data.currentUserCategories, f.categories);
    assert.ok(f.state.updates >= 3);
    f.state.hidden = false;
    f.listeners.get("plugins.DiscreetMode.active")();
    assert.equal(f.plugin.isPinned("pinned"), true);
    assert.deepEqual(f.plugin.makeProps(instance, { sections: [1, 1] }).sections, [1, 1, 1]);
    assert.equal(f.plugin.isChannelHidden(2, 0), true);
    assert.equal(f.plugin.makeSpanProps().role, "button");
    assert.equal(f.plugin.getScrollOffset("pinned", 44, 8, 2, 120), 96);
    handle.stop();
    assert.deepEqual(f.store, saved);
    assert.equal(f.listeners.size, 0);
});

test("Uses the current account's pins and restores exact methods when DiscreetMode stops", () => {
    const f = fixture();
    const originals = { ...f.plugin };
    const handle = f.install();
    f.state.hidden = true;
    const other = { id: "other", name: "Other account", color: 0, channels: ["other-dm"] };
    f.store.userBasedCategoryList.other = [other];
    f.state.userId = "other";
    void f.data.init();
    assert.equal(f.plugin.isPinned("other-dm"), false);
    handle.stop();
    assert.equal(f.plugin.isPinned("other-dm"), true);
    assert.equal(f.plugin.isPinned("pinned"), false);
    assert.equal(f.data.currentUserCategories[0], other);
    for (const [key, value] of Object.entries(originals)) {
        if (typeof value === "function") assert.equal(f.plugin[key], value, key);
    }
    assert.equal(f.listeners.size, 0);
});
