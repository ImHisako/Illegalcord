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

function fixture(modules = []) {
    const listeners = new Set();
    const enabled = new Set();
    const warnings = [];
    const dependencies = {
        "@api/PluginManager": { isPluginEnabled: name => enabled.has(name) },
        "@api/Settings": { definePluginSettings(def) {
            const values = Object.fromEntries(Object.entries(def).map(([key, option]) => [key, option.default]));
            return { store: new Proxy(values, { set(target, key, value) {
                target[key] = value;
                def[key].onChange?.(value);
                return true;
            } }) };
        } },
        "@utils/constants": { EquicordDevs: {} },
        "@utils/Logger": { Logger: class { warn(...args) { warnings.push(args); } } },
        "@utils/misc": { isObject: value => typeof value === "object" && value !== null && !Array.isArray(value) },
        "@utils/types": { __esModule: true, default: plugin => plugin, OptionType: {} },
        "@webpack": { findAll: filter => modules.filter(filter), moduleListeners: listeners }
    };
    const module = { exports: {} };
    compileFunction(code, ["require", "module", "exports"])(name => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
    }, module, module.exports);
    return { plugin: module.exports.default, listeners, enabled, warnings };
}

function globals(skipAnimation = false) {
    return { skipAnimation, assignments: 0, assign(options) {
        this.assignments++;
        this.skipAnimation = options.skipAnimation;
    } };
}

test("Skips existing and late loaded springs once and restores their original preferences", () => {
    const existing = globals();
    const reducedMotion = globals(true);
    const f = fixture([existing, { Globals: existing, Springs: {} }, reducedMotion]);
    f.plugin.start();
    assert.equal(existing.skipAnimation, true);
    assert.equal(existing.assignments, 1);
    const late = globals();
    for (const listener of f.listeners) {
        listener(late);
        listener({ Globals: late, Springs: {} });
        listener({ unrelated: true });
    }
    assert.equal(late.skipAnimation, true);
    assert.equal(late.assignments, 1);
    f.plugin.stop();
    assert.equal(existing.skipAnimation, false);
    assert.equal(late.skipAnimation, false);
    assert.equal(reducedMotion.skipAnimation, true);
    assert.equal(f.listeners.size, 0);
});

test("Setting changes remove the listener and disabling respects DisableAnimations", () => {
    const spring = globals();
    const f = fixture([spring]);
    f.plugin.start();
    f.plugin.settings.store.disableSpringAnimations = false;
    assert.equal(spring.skipAnimation, false);
    assert.equal(f.listeners.size, 0);
    f.plugin.settings.store.disableSpringAnimations = true;
    assert.equal(f.listeners.size, 1);
    f.enabled.add("DisableAnimations");
    f.plugin.stop();
    assert.equal(spring.skipAnimation, true);
    assert.equal(f.listeners.size, 0);
    f.plugin.start();
    assert.equal(f.listeners.size, 0);
});

test("Failing spring modules do not prevent other animations from being skipped or restored", () => {
    const spring = globals();
    const f = fixture([{ skipAnimation: false, assign() { throw new Error("Unavailable"); } }, spring]);
    assert.doesNotThrow(() => f.plugin.start());
    assert.equal(spring.skipAnimation, true);
    assert.doesNotThrow(() => f.plugin.stop());
    assert.equal(spring.skipAnimation, false);
    assert.equal(f.warnings.length, 2);
    assert.equal(f.listeners.size, 0);
});
