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

function fixture() {
    const f = { elements: 0, settingsReads: 0, data: {}, toasts: [], uploads: [], timers: [] };
    const React = { createElement(type, props, ...children) {
        f.elements++;
        return { type, props: { ...props, children } };
    } };
    const dependencies = {
        "@api/Commands": { ApplicationCommandInputType: {} },
        "@api/SettingsSync/offline": { async importSettings(data) { f.imported = JSON.parse(data); } },
        "@components/Button": { Button: "button" },
        "@components/ErrorBoundary": { wrap: component => component },
        "@components/Heading": {}, "@components/Paragraph": {},
        "@utils/constants": { EquicordDevs: {} },
        "@utils/Logger": { Logger: class { error() {} } },
        "@utils/margins": { Margins: {} },
        "@utils/misc": { isObject: value => value !== null && typeof value === "object", parseUrl: value => URL.parse(value) },
        "@utils/types": { __esModule: true, default: plugin => plugin },
        "@webpack/common": {
            ChannelStore: { getChannel: id => ({ id }) }, DraftType: {},
            showToast: toast => f.toasts.push(toast),
            UploadHandler: { promptToUpload: files => f.uploads.push(files) }
        }
    };
    const module = { exports: {} };
    compileFunction(source + "\nmodule.exports.audit = { createSharedConfig, applySharedConfig };",
        ["module", "require", "React", "VencordNative", "setTimeout", "fetch"])(module, name => {
        assert.ok(Object.hasOwn(dependencies, name), name);
        return dependencies[name];
    }, React, { settings: { get() { f.settingsReads++; return f.data; } } }, callback => f.timers.push(callback), async () => ({ ok: true, text: async () => f.download }));
    f.plugin = module.exports.default;
    f.audit = module.exports.audit;
    return f;
}

test("Normal messages do not allocate plugin React elements or read configuration", () => {
    const f = fixture();
    for (const attachments of [[], [{ filename: "picture.png" }]]) {
        const message = { attachments };
        for (let index = 0; index < 29_000; index++) assert.equal(f.plugin.renderMessageAccessory({ message }), null);
        assert.equal(f.plugin.messagePopoverButton.render(message), null);
    }
    assert.equal(f.elements, 0);
    assert.equal(f.settingsReads, 0);
});

test("Configuration attachments still produce their apply button", () => {
    const f = fixture();
    const message = {
        attachments: [{ id: "1", filename: "picture.png" }, { id: "2", filename: "illegalcord-config.json" }],
        author: { username: "alice" }, channel_id: "channel"
    };
    const accessory = f.plugin.renderMessageAccessory({ message });
    assert.ok(accessory);
    const rendered = accessory.type(accessory.props);
    assert.equal(rendered.props.children[0].length, 1);
    assert.equal(f.plugin.messagePopoverButton.render(message).label, "Apply Illegalcord configuration");
});

test("Configuration export still removes private fields and sensitive values in nested arrays", () => {
    const f = fixture();
    f.data = {
        cloud: { token: "private" },
        plugins: {
            Stalker: { targets: "42", enabled: true },
            Example: { apiKey: "private", hotkey: "Ctrl+A", items: ["safe", "https://example.com/?token=private", { password: "private", label: "visible" }, [1, 2]] }
        }
    };
    const exported = JSON.parse(f.audit.createSharedConfig());
    assert.equal(exported.format, "illegalcord-shared-config");
    assert.equal(exported.version, 2);
    assert.deepEqual(exported.settings.plugins.Stalker, { enabled: true });
    assert.deepEqual(exported.settings.plugins.Example, { hotkey: "Ctrl+A", items: ["safe", { label: "visible" }, [1, 2]] });
    assert.equal(exported.settings.cloud, undefined);
    assert.ok(exported.omitted.includes("plugins.Example.items.1"));
});

test("Sharing prepares an attachment and importing retains the privacy filters", async () => {
    const f = fixture();
    f.data = { plugins: { Example: { enabled: true } } };
    f.plugin.commands[0].execute([], { channel: { id: "channel" } });
    f.timers[0]();
    assert.equal(f.uploads[0][0].name, "illegalcord-config.json");
    f.download = JSON.stringify({ format: "illegalcord-shared-config", version: 2, omitted: [], settings: { plugins: { Example: { enabled: true, token: "private" } } } });
    await f.audit.applySharedConfig({ size: f.download.length, url: "https://cdn.discordapp.com/attachments/1/2/config.json" });
    assert.deepEqual(f.imported, { settings: { plugins: { Example: { enabled: true } } } });
    assert.equal(f.toasts.at(-1).variant, "success");
});
