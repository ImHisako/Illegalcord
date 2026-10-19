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

const source = readFileSync(new URL("index.tsx", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("settings.ts", import.meta.url), "utf8");
const larpSource = readFileSync(new URL("larpCord.ts", import.meta.url), "utf8");
const visualsSource = readFileSync(new URL("visuals.tsx", import.meta.url), "utf8");
const keyboardSource = readFileSync(new URL("../../equicordplugins/commandPalette/ui/keyboard.ts", import.meta.url), "utf8");
const createElement = (type, props, ...children) => ({ type, props: { ...props, children } });
const canonicalize = expression => new RegExp(expression.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"), expression.flags);
const donorBadges = {
    "928787166916640838": [
        { tooltip: "Illegalcord Owner", badge: "https://i.pinimg.com/1200x/08/08/b7/0808b717977c0d086c1338a250184182.jpg" },
        { tooltip: "Opsec Demon", badge: "https://i.pinimg.com/originals/74/1e/cd/741ecd47052dcf596c516cb99e265ff9.gif" },
        { tooltip: "Illegalcord Contributor", badge: "https://i.pinimg.com/736x/bb/e5/53/bbe553e5ebac8c93c75b2673131af6f4.jpg" }
    ],
    "1353316492296327219": [
        { tooltip: "Illegalcord Cavia", badge: "https://i.pinimg.com/736x/0f/a9/9a/0fa99af2c7f37b8c8454825751c7eeab.jpg" }
    ],
    "341301663912558612": [
        { tooltip: "Sayan", badge: "https://i.pinimg.com/1200x/58/77/53/58775386d4d567d6bbf50e8652c0995d.jpg" }
    ]
};

function visible(node) {
    if (node == null || typeof node === "boolean") return [];
    if (Array.isArray(node)) return node.flatMap(visible);
    if (typeof node !== "object") return [node];
    return typeof node.type === "function" ? visible(node.type(node.props)) : visible(node.props.children);
}

function fixture(active = true, donorData = {}, { deferReady = false } = {}) {
    const state = { enabled: true, stream: null, streamerMode: false };
    const settings = {};
    const refreshed = [];
    const warnings = [];
    const listeners = new Map();
    const registeredCommands = new Map();
    const readyCallbacks = [];
    const window = {
        addEventListener(type, listener, capture) { assert.equal(capture, true); assert.ok(!listeners.has(type)); listeners.set(type, listener); },
        removeEventListener(type, listener, capture) { assert.equal(capture, true); assert.equal(listeners.get(type), listener); listeners.delete(type); }
    };
    class HTMLElement {
        constructor(editable) { this.editable = editable; }
        closest() { return this.editable ? this : null; }
    }
    const reviewPlugins = new Set();
    const changes = new Map();
    const emitted = [];
    class User {
        constructor(id) { Object.assign(this, { id, username: "Real name", email: "real@example.invalid", phone: "1111", avatar: "real-avatar", publicFlags: 0 }); }
        getTag() { return this.username; }
    }
    const realUser = new User("self");
    const realProfile = { userId: "self", bio: "Real bio", badges: [{ id: "real" }], banner: "real-banner", profileEffect: null };
    const stores = {
        UserStore: { getUser: id => id === "self" ? realUser : undefined, getCurrentUser: () => realUser, emitChange: () => emitted.push("user") },
        UserProfileStore: { getUserProfile: () => realProfile, getGuildMemberProfile: () => realProfile, emitChange: () => emitted.push("profile") },
        GuildMemberStore: { getMember: () => ({ nick: "Real nick" }), emitChange: () => emitted.push("member") },
        IconUtils: { getUserAvatarURL: user => user.avatar, getAvatarDecorationURL: () => "real-decoration" },
        SnowflakeUtils: { extractTimestamp: () => 42 }
    };
    const accounts = { getUsers: () => [realUser], getValidUsers: () => [realUser], emitChange: () => emitted.push("account") };
    stores.IconUtils[Symbol.for("vencord.lazy.get")] = () => stores.IconUtils;
    const larp = {
        fakeCurrentUser: user => user?.id === "self" ? Object.assign(new User("self"), user, { username: "Fake name", email: "fake@example.invalid", phone: "9999", publicFlags: 1, avatarDecoration: "fake-decoration" }) : user,
        hookUserProfile: profile => ({ ...profile, bio: "Fake bio", banner: "fake-banner", badges: [{ id: "staff" }], profileEffect: "fake-effect" }),
        patchBannerUrl: () => "fake-banner"
    };
    const originalLarp = { ...larp };
    const layout = [{ key: "native" }, { key: "equicord_section" }];
    const builder = { key: "$Root", buildLayout: () => layout };
    const core = {
        marker: "Mod version",
        buildLayout() { assert.equal(this, core); return layout; },
        getInfoString() { return this.marker; },
        makeInfoElements() { return [this.marker]; }
    };
    const badges = { getBadges: profile => [
        { id: "custom", userId: profile.userId },
        ...(donorData[profile.userId] ?? []).map((badge, index) => ({
            id: `illegalcord_donor_badge_${index}`,
            userId: profile.userId,
            description: badge.tooltip,
            iconSrc: badge.badge
        }))
    ] };
    const userArea = { renderButtons: props => [props.nameplate ?? "User area button"] };
    const visualCalls = [];
    const staff = { renderVoiceName(props, children) { assert.equal(this, staff); visualCalls.push("staff"); return createElement("span", { style: { color: "red" } }, children); } };
    const timer = {
        renderTimer(userId) { assert.equal(this, timer); visualCalls.push(userId); return "User call timer"; },
        renderConnectionTimer(props) { assert.equal(this, timer); visualCalls.push(props.channelId); return "Connection timer"; }
    };
    const banners = {
        memberListBannerHook(user) { assert.equal(this, banners); visualCalls.push(user.id); return createElement("img", { src: "banner", className: "vc-banners-everywhere-memberlist" }); },
        nameplate() { assert.equal(this, banners); return undefined; }
    };
    const originalVisuals = { staff: { ...staff }, timer: { ...timer }, banners: { ...banners } };
    const originals = { ...core, getBadges: badges.getBadges, renderButtons: userArea.renderButtons };
    const dependencies = {
        "./style.css": {},
        "@api/Commands": {
            registerCommand(command) { assert.ok(!registeredCommands.has(command.name)); registeredCommands.set(command.name, command); },
            unregisterCommand(name) { registeredCommands.delete(name); }
        },
        "@api/HeaderBar": { _addChannelToolbarButtons: buttons => buttons.push("Plugin toolbar button") },
        "@api/PluginManager": { isPluginEnabled: name => name === "DiscreetMode" ? state.enabled : reviewPlugins.has(name) },
        "@api/Settings": {
            definePluginSettings: definitions => {
                const plain = Object.fromEntries(Object.entries(definitions).map(([key, definition]) => [key, definition.default ?? definition.options?.find(option => option.default)?.value]));
                const store = new Proxy(plain, {
                    set(target, key, value) {
                        if (target[key] === value) return true;
                        target[key] = value;
                        definitions[key].onChange?.(value);
                        for (const callback of changes.get(`plugins.DiscreetMode.${key}`) ?? []) callback();
                        return true;
                    }
                });
                Object.assign(settings, { store, plain, use: () => store, def: definitions, withPrivateSettings: () => settings });
                return settings;
            },
            useSettings: () => ({ plugins: { DiscreetMode: { enabled: state.enabled } } }),
            SettingsStore: {
                addChangeListener(key, callback) { const set = changes.get(key) ?? new Set(); set.add(callback); changes.set(key, set); },
                removeChangeListener(key, callback) { changes.get(key)?.delete(callback); }
            }
        },
        "@api/UserSettings": { getUserSettingLazy: () => ({ updateSetting: callback => { refreshed.push(callback(true)); return Promise.resolve(); } }) },
        "@components/ErrorBoundary": { wrap: component => component },
        "@components/Paragraph": { Paragraph: "p" },
        "@equicordplugins/_api/userArea": userArea,
        "@plugins/_api/badges": badges,
        "@plugins/_core/settings": core,
        "@illegalcordplugins/LarpCord": larp,
        "@illegalcordplugins/StaffDetector": staff,
        "@plugins/callTimer": timer,
        "@equicordplugins/bannersEverywhere": banners,
        "@webpack": { findByProps: () => accounts, onceReady: { then(callback) { if (deferReady) readyCallbacks.push(callback); else callback(); return Promise.resolve(); } } },
        "@utils/constants": { EquicordDevs: { irritably: {} } },
        "@utils/css": { classNameFactory: prefix => (...parts) => parts.flatMap(part => typeof part === "string" ? [prefix + part] : Object.keys(part).filter(key => part[key]).map(key => prefix + key)).join(" ") },
        "@utils/Logger": { Logger: class { warn(...args) { warnings.push(args); } } },
        "@utils/lazy": { SYM_LAZY_GET: Symbol.for("vencord.lazy.get") },
        "@utils/types": { __esModule: true, default: plugin => plugin, OptionType: { BOOLEAN: 1, STRING: 2, SELECT: 3 }, StartAt: { Init: 0 } },
        "@webpack/common": {
            ...stores,
            ApplicationStreamingStore: { getCurrentUserActiveStream: () => state.stream },
            StreamerModeStore: { get enabled() { return state.streamerMode; } },
            useStateFromStores: (stores, selector) => { assert.equal(stores.length, 2); return selector(); }
        }
    };
    function load(source) {
        const module = { exports: {} };
        compileFunction(transformSync(source, { loader: "tsx", format: "cjs" }).code, ["require", "module", "exports", "React", "window", "HTMLElement"])(name => {
            assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
            return dependencies[name];
        }, module, module.exports, { createElement, Fragment: "fragment" }, window, HTMLElement);
        return module.exports;
    }
    dependencies["@equicordplugins/commandPalette/ui/keyboard"] = load(keyboardSource);
    dependencies["./settings"] = load(settingsSource);
    dependencies["./larpCord"] = load(larpSource);
    dependencies["./visuals"] = load(visualsSource);
    dependencies["./pinDms"] = { installPinDmsPrivacy: () => ({ refresh() {}, stop() {} }) };
    dependencies["./suspension"] = { installPluginSuspension: () => ({ onReady() {}, stop() {} }) };
    const loaded = load(source + "\nexport const testCommands = commands;");
    const plugin = loaded.default;
    plugin.commands = loaded.testCommands;
    if (active) {
        settings.plain.active = true;
        settings.plain.manualMode = false;
    }
    return { plugin, state, settings: settings.store, definitions: settings.def, core, badges, userArea, originals, layout, builder, readyCallbacks, refreshed, warnings, reviewPlugins, listeners, HTMLElement, stores, accounts, larp, originalLarp, realUser, realProfile, changes, emitted, registeredCommands, staff, timer, banners, originalVisuals, visualCalls };
}

test("Filters branded activity fields without changing ordinary activities or their source objects", () => {
    const { plugin, settings, state } = fixture();
    const ordinary = { name: "A game", type: 0, flags: 0 };
    assert.equal(plugin.isActivityAllowed(ordinary), true);
    for (const extra of [
        { name: "Illegalcord" }, { details: "Using EQUICORD" }, { state: "Vencord" },
        { url: "https://vencord.dev" }, { details_url: "https://equicord.org" }, { state_url: "https://example.com/Illegalcord" },
        { assets: { large_text: "Vesktop", small_image: "https://example.com/Equibop.png" } },
        { buttons: ["BetterDiscord"] }, { metadata: { button_urls: ["https://example.com/nightcord"] } }
    ]) {
        const activity = { ...ordinary, ...extra };
        const before = structuredClone(activity);
        assert.equal(plugin.isActivityAllowed(activity), false);
        assert.deepEqual(activity, before);
    }
    settings.hideBrandedActivities = false;
    assert.equal(plugin.isActivityAllowed({ ...ordinary, name: "Illegalcord" }), true);
    settings.hideBrandedActivities = true;
    state.enabled = false;
    assert.equal(plugin.isActivityAllowed({ ...ordinary, name: "Illegalcord" }), true);
});

test("Only hides the interface for own sharing, Streamer Mode or the manual setting", () => {
    const { plugin, settings, state } = fixture();
    assert.equal(plugin.isInterfaceHidden(), false);
    state.stream = { streamKey: "own stream" };
    assert.equal(plugin.isInterfaceHidden(), true);
    state.stream = null;
    state.streamerMode = true;
    assert.equal(plugin.isInterfaceHidden(), true);
    state.streamerMode = false;
    settings.active = false;
    settings.manualMode = true;
    plugin.commands[0].execute();
    assert.equal(plugin.isInterfaceHidden(), true);
    plugin.commands[0].execute();
    assert.equal(plugin.isInterfaceHidden(), false);
    settings.manualMode = true;
    settings.active = true;
    settings.hideInterface = false;
    assert.equal(plugin.isInterfaceHidden(), false);
    settings.hideInterface = true;
    state.enabled = false;
    assert.equal(plugin.isInterfaceHidden(), false);
});

test("Restores all runtime overrides and preserves original layouts, settings and method receivers", () => {
    const f = fixture();
    f.settings.hideSettings = false;
    for (let cycle = 0; cycle < 2; cycle++) {
        f.settings.active = true;
        f.settings.manualMode = false;
        f.plugin.start();
        assert.equal(f.core.buildLayout(f.builder), f.layout);
        const version = f.core.makeInfoElements();
        assert.deepEqual(visible(version), ["Mod version"]);
        f.settings.manualMode = true;
        f.settings.hideSettings = true;
        assert.deepEqual(f.core.buildLayout(f.builder), [{ key: "native" }]);
        assert.equal(f.layout.length, 2);
        assert.equal(f.core.getInfoString(), "");
        assert.deepEqual(f.badges.getBadges({ userId: "123" }), []);
        assert.deepEqual(visible(version), []);
        assert.deepEqual(visible(f.userArea.renderButtons({})), []);
        f.plugin.commands[1].execute();
        assert.equal(f.core.buildLayout(f.builder), f.layout);
        f.plugin.commands[0].execute();
        assert.deepEqual(visible(version), ["Mod version"]);
        assert.deepEqual(f.badges.getBadges({ userId: "123" }), [{ id: "custom", userId: "123" }]);
        f.plugin.stop();
        assert.equal(f.registeredCommands.size, 0);
        for (const key of ["buildLayout", "getInfoString", "makeInfoElements"]) assert.equal(f.core[key], f.originals[key]);
        assert.equal(f.badges.getBadges, f.originals.getBadges);
        assert.equal(f.userArea.renderButtons, f.originals.renderButtons);
    }
    assert.deepEqual(f.refreshed, [true, true, true, true, true, true, true]);
    assert.equal(f.settings.hideBrandedActivities, true);
    assert.deepEqual(f.warnings, []);
});

test("Hides the complete Illegalcord settings section by default and restores access independently of sharing", () => {
    const { plugin, settings, state, core, layout, builder } = fixture();
    const otherSection = { key: "discord_other" };
    layout.push(otherSection);
    plugin.start();
    assert.equal(settings.hideSettings, true);
    assert.equal(plugin.isInterfaceHidden(), false);
    assert.deepEqual(core.buildLayout(builder), [{ key: "native" }, otherSection]);
    assert.deepEqual(layout.map(section => section.key), ["native", "equicord_section", "discord_other"]);
    const command = plugin.commands.find(command => command.name === "discreet-settings");
    assert.ok(command);
    command.execute();
    assert.equal(core.buildLayout(builder), layout);
    state.stream = { streamKey: "own stream" };
    assert.equal(core.buildLayout(builder), layout);
    command.execute();
    assert.deepEqual(core.buildLayout(builder), [{ key: "native" }, otherSection]);
    plugin.stop();
    assert.equal(core.buildLayout(builder), layout);
});

test("Preserves separate version rows so enabling the plugin does not widen the settings sidebar", () => {
    const f = fixture(false);
    const labels = ["Equicord abc123 (Standalone)", "Electron 41.0.0", "Chromium 146.0.0.0"];
    const elements = labels.map(text => ({ type: "span", key: text, props: { className: "version", children: [text] } }));
    const makeInfoElements = f.core.makeInfoElements = function (Component, className) {
        assert.equal(this, f.core);
        assert.equal(Component, "span");
        assert.equal(className, "version");
        return elements;
    };
    f.plugin.start();
    const rows = f.core.makeInfoElements("span", "version");
    assert.deepEqual(rows.map(visible), labels.map(text => [text]));
    for (let index = 0; index < elements.length; index++) assert.equal(rows[index].props.children[0], elements[index]);
    press(f, "F6");
    assert.deepEqual(rows.map(visible), [[], [], []]);
    press(f, "F6");
    assert.deepEqual(rows.map(visible), labels.map(text => [text]));
    f.plugin.stop();
    assert.equal(f.core.makeInfoElements, makeInfoElements);
    assert.equal(f.core.makeInfoElements("span", "version"), elements);
});

test("Leaves native toolbar controls intact and makes injected controls reactive", () => {
    const { plugin, settings } = fixture();
    const toolbar = ["Native button"];
    plugin.addToolbarButtons(toolbar);
    assert.deepEqual(visible(toolbar), ["Native button", "Plugin toolbar button"]);
    settings.manualMode = true;
    assert.deepEqual(visible(toolbar), ["Native button"]);
    const wrapped = plugin.chatBarButtonWrapper.wrapper("Original chat buttons");
    const span = wrapped.type(wrapped.props);
    assert.ok(span.props.className.includes("vc-discreet-mode-hidden"));
    assert.deepEqual(visible(span), ["Original chat buttons"]);
    settings.manualMode = false;
    assert.deepEqual(visible(toolbar), ["Native button", "Plugin toolbar button"]);
});

test("Keeps Illegalcord entries out of the initial native sidebar layout before webpack is ready", () => {
    for (const mode of ["hide", "suspend"]) {
        const f = fixture(true, {}, { deferReady: true });
        f.settings.mode = mode;
        const nativeEntry = { key: "user_section", buildLayout: () => [{ key: "account" }] };
        const nativeLayout = [nativeEntry];
        const builder = { key: "$Root", buildLayout() { assert.equal(this, builder); return nativeLayout; } };
        let injections = 0;
        const buildLayout = f.core.buildLayout = function (builder) {
            assert.equal(this, f.core);
            injections++;
            const layout = builder.buildLayout();
            layout.push({ key: "equicord_section", title: "Kamidere Mutual Scanner" });
            return layout;
        };
        f.plugin.start();
        assert.equal(f.registeredCommands.size, 0);
        assert.deepEqual(f.core.buildLayout(builder), [nativeEntry]);
        assert.equal(injections, 0);
        assert.deepEqual(nativeLayout, [nativeEntry]);
        assert.equal(f.core.buildLayout(builder)[0], nativeEntry);
        f.plugin.stop();
        assert.equal(f.core.buildLayout, buildLayout);
        for (const callback of f.readyCallbacks) callback();
        assert.equal(f.core.buildLayout, buildLayout);
        assert.equal(f.listeners.size, 0);
    }
});

test("Filters activities before publication and skips menu additions without changing Discord's menu props", () => {
    const { plugin, settings } = fixture();
    const [activityPatch, , , menuPatch] = plugin.patches;
    const code = "function publish(activity){let items=[];items.push({type:types.LISTENING,...activity}),emit()(items,changed);return items}";
    const patched = code.replace(canonicalize(activityPatch.replacement.match), activityPatch.replacement.replace.replaceAll("$self", "DiscreetMode"));
    assert.notEqual(patched, code);
    const published = [];
    const publish = compileFunction(patched + ";return publish;", ["DiscreetMode", "types", "emit", "changed"])(plugin, { LISTENING: 2 }, () => activities => published.push(activities), true);
    publish({ name: "Illegalcord" });
    publish({ name: "Music" });
    assert.deepEqual(published.map(activities => activities.map(activity => activity.name)), [[], ["Music"]]);
    const menu = "return Vencord.Api.ContextMenu._usePatchContextMenu(props)";
    const menuCode = menu.replace(canonicalize(menuPatch.replacement.match), menuPatch.replacement.replace.replaceAll("$self", "DiscreetMode"));
    const props = { children: ["Discord menu item"] };
    const renderMenu = compileFunction(menuCode, ["DiscreetMode", "Vencord", "props"]);
    const api = { Api: { ContextMenu: { _usePatchContextMenu: original => ({ ...original, added: true }) } } };
    assert.equal(renderMenu(plugin, api, props).added, true);
    settings.manualMode = true;
    assert.equal(renderMenu(plugin, api, props), props);
    assert.deepEqual(props, { children: ["Discord menu item"] });
});

test("Wraps the existing header and toolbar API calls while preserving native controls", () => {
    const { plugin, settings } = fixture();
    const [, headerPatch, toolbarPatch] = plugin.patches;
    const headerSource = 'return ["Native header button",...Vencord.Api.HeaderBar._addHeaderBarButtons()]';
    const headerCode = headerSource.replace(canonicalize(headerPatch.replacement.match), headerPatch.replacement.replace.replaceAll("$self", "DiscreetMode"));
    assert.notEqual(headerCode, headerSource);
    const api = { Api: { HeaderBar: { _addHeaderBarButtons: () => ["Plugin header button"] } } };
    const header = compileFunction(headerCode, ["DiscreetMode", "Vencord"])(plugin, api);
    const toolbarSource = 'let buttons=["Native toolbar button"];Vencord.Api.HeaderBar._addChannelToolbarButtons(buttons);return buttons';
    const toolbarCode = toolbarSource.replace(canonicalize(toolbarPatch.replacement.match), toolbarPatch.replacement.replace.replaceAll("$self", "DiscreetMode"));
    assert.notEqual(toolbarCode, toolbarSource);
    const toolbar = compileFunction(toolbarCode, ["DiscreetMode"])(plugin);
    assert.deepEqual(visible(header), ["Native header button", "Plugin header button"]);
    assert.deepEqual(visible(toolbar), ["Native toolbar button", "Plugin toolbar button"]);
    settings.manualMode = true;
    assert.deepEqual(visible(header), ["Native header button"]);
    assert.deepEqual(visible(toolbar), ["Native toolbar button"]);
});

test("Reviews enabled recognizable plugins and explains public badge limitations", () => {
    const { plugin, reviewPlugins } = fixture();
    reviewPlugins.add("FakeNitro");
    const text = visible(createElement(plugin.settingsAboutComponent)).join(" ");
    assert.ok(text.includes("FakeNitro"));
    assert.ok(!text.includes("CustomRPC"));
    assert.ok(text.includes("public source"));
    assert.ok(text.includes("/discreet"));
    assert.deepEqual([...reviewPlugins], ["FakeNitro"]);
});

function press(fixture, key, overrides = {}) {
    const event = {
        key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
        repeat: false, isComposing: false, defaultPrevented: false, target: null,
        preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { this.stopped = true; },
        ...overrides
    };
    fixture.listeners.get("keydown")?.(event);
    return event;
}

test("F6 toggles all discreet effects and restores the interface even while streaming", () => {
    const f = fixture(false);
    assert.equal(f.settings.active, false);
    assert.equal(f.settings.keybind, "F6");
    assert.equal(f.settings.mode, "hide");
    assert.deepEqual(f.definitions.mode.options.map(option => option.value), ["hide", "suspend"]);
    f.settings.manualMode = false;
    f.plugin.start();
    const buttons = f.userArea.renderButtons({});
    const branded = { name: "Illegalcord", type: 0, flags: 0 };
    assert.equal(f.core.buildLayout(f.builder), f.layout);
    assert.equal(f.plugin.isActivityAllowed(branded), true);
    const event = press(f, "F6");
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, true);
    assert.equal(f.plugin.isInterfaceHidden(), true);
    assert.deepEqual(visible(buttons), []);
    assert.deepEqual(f.core.buildLayout(f.builder), [{ key: "native" }]);
    assert.equal(f.plugin.isActivityAllowed(branded), false);
    f.state.stream = { streamKey: "own stream" };
    press(f, "F6");
    assert.equal(f.plugin.isInterfaceHidden(), false);
    assert.deepEqual(visible(buttons), ["User area button"]);
    assert.equal(f.core.buildLayout(f.builder), f.layout);
    assert.equal(f.plugin.isActivityAllowed(branded), true);
    assert.deepEqual(f.badges.getBadges({ userId: "123" }), [{ id: "custom", userId: "123" }]);
    f.plugin.stop();
    assert.equal(f.listeners.size, 0);
    assert.deepEqual(f.refreshed, [true, true, true, true]);
    press(f, "F6");
    assert.equal(f.settings.active, false);
});

test("Keybind changes apply immediately with exact modifiers and ignore held keys and text composition", () => {
    const f = fixture(false);
    f.plugin.start();
    for (const overrides of [{ repeat: true }, { isComposing: true }, { defaultPrevented: true }, { shiftKey: true }]) {
        press(f, "F6", overrides);
        assert.equal(f.settings.active, false);
    }
    f.settings.keybind = " Ctrl + Shift + D ";
    press(f, "F6");
    press(f, "d", { ctrlKey: true });
    assert.equal(f.settings.active, false);
    press(f, "D", { ctrlKey: true, shiftKey: true, target: new f.HTMLElement(true) });
    assert.equal(f.settings.active, true);
    press(f, "D", { ctrlKey: true, shiftKey: true, altKey: true });
    assert.equal(f.settings.active, true);
    press(f, "D", { ctrlKey: true, shiftKey: true });
    assert.equal(f.settings.active, false);
    f.settings.keybind = "d";
    assert.equal(press(f, "d", { target: new f.HTMLElement(true) }).defaultPrevented, false);
    assert.equal(f.settings.active, false);
    press(f, "d");
    assert.equal(f.settings.active, true);
    f.settings.keybind = "F6";
    press(f, "F6", { target: new f.HTMLElement(true) });
    assert.equal(f.settings.active, false);
    f.plugin.stop();
});

test("Rejects invalid shortcuts and keeps command and toolbox toggles equivalent to the keybind", () => {
    const f = fixture(false);
    for (const key of ["F6", "F24", "Ctrl+Shift+D", " alt + F7 ", "Meta+Space", "Escape"]) {
        assert.equal(f.definitions.keybind.isValid(key), true, key);
    }
    for (const key of ["", "Ctrl", "F25", "Ctrl+Ctrl+D", "Ctrl+", "D+G", "Control+D", "F6++"]) {
        assert.equal(typeof f.definitions.keybind.isValid(key), "string", key);
    }
    f.plugin.commands[0].execute();
    assert.equal(f.plugin.isInterfaceHidden(), true);
    f.plugin.toolboxActions["Toggle discreet interface"]();
    assert.equal(f.plugin.isInterfaceHidden(), false);
    assert.equal(f.settings.manualMode, true);
});

test("Hides local client badges for self and other profiles while preserving native Discord badges and original data", () => {
    const f = fixture(false);
    f.plugin.start();
    const discordBadges = [{ id: "staff", description: "Discord Staff", icon: "staff-icon" }, { id: "premium", description: "Nitro", icon: "nitro-icon" }];
    const localBadges = [
        { id: "illegalcord_donor_badge_0", description: "Supporter" },
        { id: "custom", description: "Illegalcord Developer", icon: "local-icon" },
        { id: "custom-image", icon: "https://example.com/Illegalcord.png" },
        { id: "custom-link", link: "https://example.com/illegalcord" },
        { id: "custom-source", iconSrc: "https://example.com/Illegalcord.png" }
    ];
    const saved = structuredClone(localBadges);
    const patch = f.plugin.patches.find(patch => patch.find.includes("UserProfileBadgeListRows"));
    assert.ok(patch);
    const source = "let native=(0,source.getBadges)(profile,legacy),{pendingBadgeHiddenBadges:hidden,pendingBadgeDisplayOrder:order}=pending;return native";
    const patched = source.replace(canonicalize(patch.replacement.match), patch.replacement.replace.replaceAll("$self", "DiscreetMode"));
    assert.notEqual(patched, source);
    const render = compileFunction(patched, ["DiscreetMode", "source", "profile", "legacy", "pending"]);
    const profiles = ["self", "other"].map(userId => ({ userId, getBadges: () => [...f.badges.getBadges({ userId }), ...discordBadges, ...localBadges] }));
    const getBadges = { getBadges: profile => profile.getBadges() };
    for (const profile of profiles) {
        assert.equal(render(f.plugin, getBadges, profile, false, {}).length, 8);
    }
    press(f, "F6");
    for (const profile of profiles) {
        assert.deepEqual(render(f.plugin, getBadges, profile, false, {}), discordBadges);
    }
    assert.deepEqual(localBadges, saved);
    press(f, "F6");
    for (const profile of profiles) {
        assert.equal(render(f.plugin, getBadges, profile, false, {}).length, 8);
    }
    f.plugin.stop();
});

test("Hides and restores five supplied donor badges, including badges whose tooltip does not mention Illegalcord", () => {
    const f = fixture(false, donorBadges);
    const saved = structuredClone(donorBadges);
    const profiles = Object.keys(donorBadges).map(userId => ({ userId }));
    assert.equal(Object.values(donorBadges).flat().length, 5);
    f.plugin.start();
    const original = profiles.map(profile => f.badges.getBadges(profile));
    assert.deepEqual(original.flatMap(badges => badges.slice(1).map(badge => badge.description)), [
        "Illegalcord Owner", "Opsec Demon", "Illegalcord Contributor", "Illegalcord Cavia", "Sayan"
    ]);
    for (const [index, profile] of profiles.entries()) {
        assert.deepEqual(original[index].slice(1).map(badge => badge.iconSrc), donorBadges[profile.userId].map(badge => badge.badge));
    }
    press(f, "F6");
    for (const profile of profiles) assert.deepEqual(f.badges.getBadges(profile), []);
    assert.deepEqual(donorBadges, saved);
    press(f, "F6");
    assert.deepEqual(profiles.map(profile => f.badges.getBadges(profile)), original);
    f.plugin.stop();
    assert.deepEqual(profiles.map(profile => f.badges.getBadges(profile)), original);
});

test("F6 hides platform indicators and Questify across API surfaces without hiding native Discord controls", () => {
    const f = fixture(false);
    f.plugin.start();
    const api = { Api: {
        NicknameIcons: { _renderIcons: () => ["Profile platform icon"] },
        MemberListDecorators: { __getDecorators: (_props, type) => [`${type} platform icon`] },
        MessageDecorations: { __addDecorationsToMessage: () => ["Message platform icon"] },
        ServerList: {
            ServerListRenderPosition: { Above: 0, In: 1, Below: 2 },
            renderAll: position => [position === 0 ? "Questify button" : `Server list plugin icon ${position}`]
        }
    } };
    const cases = [
        ["#{intl::USER_PROFILE_PRONOUNS}", "return [...Vencord.Api.NicknameIcons._renderIcons({userId:arguments[0].user?.id}),\"Discord name\"]", ["Profile platform icon", "Discord name"]],
        ["#{intl::GUILD_OWNER}),children:", "return [Vencord.Api.MemberListDecorators.__getDecorators(arguments[0],'guild'),\"Server owner\"]", ["guild platform icon", "Server owner"]],
        ["PrivateChannel.renderAvatar", "return [Vencord.Api.MemberListDecorators.__getDecorators(arguments[0],'dm'),\"Discord DM icon\"]", ["dm platform icon", "Discord DM icon"]],
        ["#{intl::GUILD_COMMUNICATION_DISABLED_ICON_TOOLTIP_BODY}", "return [\"Discord bot tag\",Vencord.Api.MessageDecorations.__addDecorationsToMessage(arguments[0])]", ["Discord bot tag", "Message platform icon"]],
        ["#{intl::DISCODO_DISABLED}", "return [\"Discord home\"].concat(Vencord.Api.ServerList.renderAll(Vencord.Api.ServerList.ServerListRenderPosition.Above))", ["Discord home", "Questify button"]],
        [".setGuildsTree(", "return Vencord.Api.ServerList.renderAll(Vencord.Api.ServerList.ServerListRenderPosition.In).concat([\"Discord server\",...Vencord.Api.ServerList.renderAll(Vencord.Api.ServerList.ServerListRenderPosition.Below)])", ["Server list plugin icon 1", "Discord server", "Server list plugin icon 2"]]
    ];
    const rendered = cases.map(([find, source, expected]) => {
        const patch = f.plugin.patches.find(patch => patch.find === find);
        assert.ok(patch, find);
        const code = source.replace(canonicalize(patch.replacement.match), patch.replacement.replace.replaceAll("$self", "DiscreetMode"));
        assert.notEqual(code, source);
        const render = compileFunction(`return function(props){${code}}`, ["DiscreetMode", "Vencord"])(f.plugin, api);
        const node = render({ user: { id: "123" } });
        assert.deepEqual(visible(node), expected);
        return { node, expected };
    });
    press(f, "F6");
    for (const { node, expected } of rendered) {
        assert.deepEqual(visible(node), expected.filter(text => text.startsWith("Discord") || text === "Server owner"));
    }
    press(f, "F6");
    for (const { node, expected } of rendered) assert.deepEqual(visible(node), expected);
    f.plugin.stop();
});

test("Suspends late LarpCord hooks and cached cosmetic data while keeping email and phone substitutions", () => {
    const f = fixture(false);
    f.reviewPlugins.add("LarpCord");
    f.plugin.start();
    const { UserStore, UserProfileStore, GuildMemberStore, IconUtils, SnowflakeUtils } = f.stores;
    const nativeUser = UserStore.getUser.bind(UserStore);
    const nativeProfile = UserProfileStore.getUserProfile.bind(UserProfileStore);
    const nativeAvatar = IconUtils.getUserAvatarURL.bind(IconUtils);
    const cachedUser = f.larp.fakeCurrentUser(nativeUser("self"));
    const fakeCurrent = () => cachedUser;
    const fakeGetUser = id => f.larp.fakeCurrentUser(nativeUser(id));
    const fakeProfile = () => f.larp.hookUserProfile(nativeProfile("self"));
    const fakeAvatar = user => user.id === "self" ? "fake-avatar" : nativeAvatar(user);
    UserStore.getCurrentUser = fakeCurrent;
    UserStore.getUser = fakeGetUser;
    UserProfileStore.getUserProfile = fakeProfile;
    UserProfileStore.getGuildMemberProfile = fakeProfile;
    GuildMemberStore.getMember = () => ({ nick: "Fake nick" });
    IconUtils.getUserAvatarURL = fakeAvatar;
    IconUtils.getAvatarDecorationURL = () => "fake-decoration";
    SnowflakeUtils.extractTimestamp = () => 900;
    f.accounts.getUsers = f.accounts.getValidUsers = () => [cachedUser];
    assert.equal(UserStore.getCurrentUser().username, "Fake name");
    assert.deepEqual(UserProfileStore.getUserProfile("self").badges, [{ id: "staff" }]);
    const before = f.emitted.length;
    press(f, "F6");
    assert.ok(f.emitted.length > before);
    const privateUser = UserStore.getCurrentUser();
    assert.equal(privateUser.username, "Real name");
    assert.equal(privateUser.email, "fake@example.invalid");
    assert.equal(privateUser.phone, "9999");
    assert.equal(UserStore.getCurrentUser(), privateUser);
    assert.equal(UserStore.getUser("self"), privateUser);
    assert.equal({ ...privateUser }.username, "Real name");
    assert.equal({ ...privateUser }.email, "fake@example.invalid");
    assert.equal(UserProfileStore.getUserProfile("self"), f.realProfile);
    assert.equal(UserProfileStore.getGuildMemberProfile("self", "guild"), f.realProfile);
    assert.deepEqual(GuildMemberStore.getMember("guild", "self"), { nick: "Real nick" });
    assert.equal(IconUtils.getUserAvatarURL(f.realUser), "real-avatar");
    assert.equal(IconUtils.getAvatarDecorationURL({}), "real-decoration");
    assert.equal(SnowflakeUtils.extractTimestamp("self"), 42);
    assert.equal(f.accounts.getUsers()[0], f.realUser);
    assert.equal(f.accounts.getValidUsers()[0], f.realUser);
    assert.equal(f.larp.patchBannerUrl({}), null);
    const contacts = f.larp.fakeCurrentUser(cachedUser);
    assert.equal(contacts.username, "Real name");
    assert.equal(contacts.getTag(), "Real name");
    assert.equal(contacts.publicFlags, 0);
    assert.equal(contacts.avatarDecoration, undefined);
    assert.equal(contacts.email, "fake@example.invalid");
    assert.equal(contacts.phone, "9999");
    f.realUser.username = "Updated real name";
    assert.equal(UserStore.getCurrentUser(), privateUser);
    assert.equal(privateUser.username, "Updated real name");
    assert.equal(f.realUser.email, "real@example.invalid");
    assert.deepEqual(f.realProfile.badges, [{ id: "real" }]);
    press(f, "F6");
    assert.equal(UserStore.getCurrentUser(), cachedUser);
    assert.equal(UserProfileStore.getUserProfile("self").bio, "Fake bio");
    assert.equal(IconUtils.getUserAvatarURL(f.realUser), "fake-avatar");
    press(f, "F6");
    f.plugin.stop();
    assert.equal(UserStore.getCurrentUser, fakeCurrent);
    assert.equal(UserStore.getUser, fakeGetUser);
    assert.equal(UserProfileStore.getUserProfile, fakeProfile);
    assert.equal(IconUtils.getUserAvatarURL, fakeAvatar);
    assert.equal(f.larp.fakeCurrentUser, f.originalLarp.fakeCurrentUser);
    assert.equal(UserStore.getUser("self").username, "Fake name");
    assert.equal([...f.changes.values()].reduce((count, set) => count + set.size, 0), 0);
});

test("Restores exact descriptors without LarpCord hooks and refreshes profiles for automatic sharing changes", () => {
    const f = fixture(false);
    const original = Object.getOwnPropertyDescriptor(f.stores.UserStore, "getUser");
    f.plugin.start();
    f.settings.manualMode = false;
    f.settings.active = true;
    f.state.stream = { streamKey: "self" };
    const count = f.emitted.length;
    f.plugin.flux.STREAM_CREATE();
    f.plugin.flux.STREAM_DELETE();
    f.plugin.flux.STREAMER_MODE_UPDATE();
    assert.equal(f.emitted.length, count + 12);
    assert.equal(f.larp.patchBannerUrl({}), "fake-banner");
    f.reviewPlugins.add("LarpCord");
    assert.equal(f.larp.patchBannerUrl({}), null);
    f.state.stream = null;
    assert.equal(f.larp.patchBannerUrl({}), "fake-banner");
    f.plugin.stop();
    assert.deepEqual(Object.getOwnPropertyDescriptor(f.stores.UserStore, "getUser"), original);
});

test("Leaves fixed webpack exports intact while installing and removing LarpCord privacy", () => {
    const f = fixture(false);
    const original = f.stores.SnowflakeUtils.extractTimestamp;
    Object.defineProperty(f.stores.SnowflakeUtils, "extractTimestamp", { value: original, configurable: false, writable: false });
    f.reviewPlugins.add("LarpCord");
    f.plugin.start();
    press(f, "F6");
    assert.equal(f.stores.SnowflakeUtils.extractTimestamp, original);
    f.plugin.stop();
    assert.equal(f.stores.SnowflakeUtils.extractTimestamp, original);
});

test("Drops toasts during discreet mode instead of queuing them for later", () => {
    const f = fixture(false);
    const patch = f.plugin.patches.find(patch => patch.find === ".currentToastMap.has(");
    const source = "return function show(toast){let surface=toast?.surface??\"app\";sent.push({surface,toast});}";
    const code = source.replace(canonicalize(patch.replacement.match), patch.replacement.replace.replaceAll("$self", "DiscreetMode"));
    assert.notEqual(code, source);
    const sent = [];
    const show = compileFunction(code, ["DiscreetMode", "sent"])(f.plugin, sent);
    show({ text: "Before" });
    f.settings.active = true;
    f.settings.hideInterface = false;
    show({ text: "Hidden" });
    assert.equal(sent.length, 1);
    f.settings.active = false;
    show({ text: "After" });
    assert.deepEqual(sent.map(item => item.toast.text), ["Before", "After"]);
    f.settings.active = true;
    f.state.enabled = false;
    show({ text: "Plugin disabled" });
    assert.equal(sent.length, 3);
});

test("F6 removes staff colors, both call timers and member banners from already rendered components", () => {
    const f = fixture(false);
    f.plugin.start();
    const staffName = f.staff.renderVoiceName({ user: { id: "staff" }, guildId: "guild" }, "Staff name");
    const userTimer = f.timer.renderTimer("user");
    const connectionTimer = f.timer.renderConnectionTimer({ channelId: "voice" });
    const nativePlate = { src: "native-nameplate" };
    const banner = f.banners.memberListBannerHook({ id: "user" }, nativePlate);
    const render = node => node.type(node.props);
    assert.deepEqual(render(staffName).props.style, { color: "red" });
    assert.deepEqual(visible([userTimer, connectionTimer]), ["User call timer", "Connection timer"]);
    assert.equal(render(banner).type, "img");
    assert.equal(f.banners.nameplate(nativePlate), undefined);
    const count = f.visualCalls.length;
    press(f, "F6");
    assert.equal(render(staffName), "Staff name");
    assert.equal(render(userTimer), null);
    assert.equal(render(connectionTimer), null);
    assert.equal(render(banner), null);
    assert.equal(f.banners.nameplate(nativePlate), nativePlate);
    assert.equal(f.visualCalls.length, count);
    press(f, "F6");
    assert.deepEqual(render(staffName).props.style, { color: "red" });
    assert.deepEqual(visible([userTimer, connectionTimer]), ["User call timer", "Connection timer"]);
    assert.equal(render(banner).type, "img");
    f.plugin.stop();
    for (const name of ["staff", "timer", "banners"]) {
        for (const [key, original] of Object.entries(f.originalVisuals[name])) assert.equal(f[name][key], original);
    }
});
