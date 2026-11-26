/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import { compileFunction } from "node:vm";

import { transform } from "esbuild";

async function load(file, dependencies, globals = {}, suffix = "") {
    const source = await readFile(new URL(`../../src/illegalcordplugins/${file}`, import.meta.url), "utf8");
    const { code } = await transform(source + suffix, { loader: "tsx", format: "cjs" });
    const module = { exports: {} };
    compileFunction(code, ["require", "module", "exports", ...Object.keys(globals)])(name => {
        assert.ok(Object.hasOwn(dependencies, name), name);
        return dependencies[name];
    }, module, module.exports, ...Object.values(globals));
    return module.exports;
}

function timers() {
    const tasks = new Map();
    let id = 0;
    return {
        tasks,
        setTimeout(callback, delay) { tasks.set(++id, { callback, delay }); return id; },
        clearTimeout(id) { tasks.delete(id); },
        fire() { for (const [id, { callback }] of [...tasks]) { tasks.delete(id); callback(); } }
    };
}

function emitter() {
    const listeners = new Set();
    return { listeners, emit() { for (const listener of listeners) listener(); }, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}

function settings(def, options = {}) {
    const values = { ...Object.fromEntries(Object.entries(def).map(([key, option]) => [key, option.default])), ...options };
    return { def, plain: values, store: new Proxy(values, { set(target, key, value) { target[key] = value; def[key].onChange?.(value); return true; } }) };
}

const Logger = class { log() {} info() {} warn() {} error() {} };
const pluginTypes = { __esModule: true, default: value => value, OptionType: {} };

async function customStream(options = {}) {
    const values = new Map();
    const reads = [];
    const writes = [];
    const liveUrls = new Set();
    const library = {}, thumbs = {};
    const f = { values, reads, writes, liveUrls, conversions: 0, thumbnails: 0, get: null, getMany: null, thumbnail: null, convert: null };
    const imageCount = options.count ?? 12;
    const images = Array.from({ length: imageCount }, (_, index) => ({ id: String(index), size: options.bytes ?? 1024 }));
    for (const image of images) values.set(`CustomStreamTopQ_Image_${image.id}`, new Blob([new Uint8Array(image.size)]));
    values.set("CustomStreamTopQ_Library", { version: options.version ?? 4, activeId: "default", profiles: [{ id: "default", name: "Default", imageIds: images.map(image => image.id), imageSizes: images.map(image => image.size), currentIndex: 0 }] });
    const DataStore = {
        async get(key) { reads.push(key); return f.get ? f.get(key) : values.get(key); },
        async getMany(keys) { reads.push(...keys); return f.getMany ? f.getMany(keys) : keys.map(key => values.get(key)); },
        async set(key, value) { writes.push(key); values.set(key, value); },
        async setMany(entries) { for (const [key, value] of entries) { writes.push(key); values.set(key, value); } },
        async delMany(keys) { for (const key of keys) values.delete(key); }
    };
    let urlId = 0;
    const globals = {
        URL: { createObjectURL() { const url = `blob:${++urlId}`; liveUrls.add(url); return url; }, revokeObjectURL(url) { liveUrls.delete(url); } }
    };
    const dependencies = {
        "@api/index": { DataStore }, "@webpack/common": { UserStore: { getCurrentUser: () => ({ id: "owner" }) } },
        "./utils": { createEmitter: emitter, logger: new Logger() }, "./thumbs": thumbs, "./library": library,
        "./media": {
            async makeThumbnail(blob) { f.thumbnails++; return f.thumbnail ? f.thumbnail(blob) : new Blob(["thumbnail"]); },
            async toUploadDataUrl(blob) { f.conversions++; return f.convert ? f.convert(blob) : "data:image/jpeg;base64,image"; }
        },
        "./settings": { settings: { store: { replaceEnabled: true, slideshowEnabled: false, slideshowRandom: false } }, settingsChanged: emitter() }
    };
    Object.assign(library, await load("customStream/library.ts", dependencies, {}, "\nexport const cacheState = () => ({ bytes: cachedBytes, jobs: imageJobs.size });"));
    Object.assign(thumbs, await load("customStream/thumbs.ts", dependencies, globals, "\nexport const jobCount = () => jobs.size;"));
    dependencies["./schedule"] = await load("customStream/schedule.ts", {});
    f.air = await load("customStream/onAir.ts", dependencies, {}, "\nexport const retainedUris = () => dataUris.size;");
    f.library = library;
    f.thumbs = thumbs;
    f.settingsChanged = dependencies["./settings"].settingsChanged;
    await library.loadLibrary();
    return f;
}

test("CustomStream loads only metadata at startup and keeps all images available", async () => {
    const f = await customStream();
    assert.equal(f.reads.some(key => key.startsWith("CustomStreamTopQ_Image_")), false);
    assert.equal(f.library.getActiveProfile().images.length, 12);
    assert.equal(f.library.getActiveProfile().images.some(image => "blob" in image), false);
    assert.deepEqual(f.library.cacheState(), { bytes: 0, jobs: 0 });
    assert.equal((await f.library.loadImage(f.library.getActiveProfile().images[11])).size, 1024);
    f.library.unloadLibrary();
});

test("CustomStream upgrades version 3 without losing image IDs or sizes", async () => {
    const f = await customStream({ version: 3, count: 35 });
    assert.equal(f.values.get("CustomStreamTopQ_Library").version, 4);
    assert.equal(f.library.getActiveProfile().images.length, 35);
    assert.equal(f.library.getActiveProfile().images[34].size, 1024);
    assert.deepEqual(f.library.cacheState(), { bytes: 0, jobs: 0 });
});

test("CustomStream image cache stays within eight MiB without deleting stored images", async () => {
    const f = await customStream({ bytes: 1024 * 1024 });
    for (const image of f.library.getActiveProfile().images) await f.library.loadImage(image);
    assert.equal(f.library.cacheState().bytes, 8 * 1024 * 1024);
    assert.equal(f.library.getActiveProfile().images.length, 12);
    assert.equal(f.values.has("CustomStreamTopQ_Image_0"), true);
    f.library.unloadLibrary();
    assert.deepEqual(f.library.cacheState(), { bytes: 0, jobs: 0 });
});

test("CustomStream ignores image and library reads completing after unload", async () => {
    const f = await customStream();
    let resolveImage;
    const blob = f.values.get("CustomStreamTopQ_Image_0");
    f.get = () => new Promise(resolve => { resolveImage = resolve; });
    const image = f.library.loadImage(f.library.getActiveProfile().images[0]);
    f.library.unloadLibrary();
    resolveImage(blob);
    await image;
    assert.deepEqual(f.library.cacheState(), { bytes: 0, jobs: 0 });
    let resolveMeta;
    f.get = () => new Promise(resolve => { resolveMeta = resolve; });
    const loading = f.library.loadLibrary();
    await tick();
    f.library.unloadLibrary();
    resolveMeta(f.values.get("CustomStreamTopQ_Library"));
    await loading;
    assert.deepEqual(f.library.getProfiles(), []);
});

test("CustomStream preserves queued metadata writes when the plugin stops", async () => {
    const f = await customStream();
    const writing = f.library.setCurrentIndex("default", 2);
    f.library.unloadLibrary();
    await writing;
    const saved = f.values.get("CustomStreamTopQ_Library");
    assert.equal(saved.profiles[0].imageIds.length, 12);
    assert.equal(saved.profiles[0].currentIndex, 2);
});

test("CustomStream never recreates thumbnail URLs after cleanup", async () => {
    const f = await customStream();
    let finish;
    f.getMany = () => new Promise(resolve => { finish = resolve; });
    const pending = f.thumbs.loadThumb(f.library.getActiveProfile().images[0]);
    await tick();
    f.thumbs.forgetAllThumbs();
    finish([new Blob(["thumb"])]);
    assert.equal(await pending, "");
    assert.equal(f.liveUrls.size, 0);
    assert.equal(f.thumbs.peekThumb("0"), undefined);
    assert.equal(f.thumbs.jobCount(), 0);
});

test("CustomStream cancels queued thumbnail generation and revokes completed URLs", async () => {
    const f = await customStream({ count: 5 });
    const completions = [];
    f.thumbnail = () => new Promise(resolve => completions.push(resolve));
    const jobs = f.library.getActiveProfile().images.map(image => f.thumbs.loadThumb(image));
    await tick();
    assert.equal(f.thumbnails, 2);
    f.thumbs.forgetAllThumbs();
    completions.forEach(resolve => resolve(new Blob(["thumb"])));
    assert.deepEqual(await Promise.all(jobs), ["", "", "", "", ""]);
    assert.equal(f.thumbnails, 2);
    assert.equal(f.liveUrls.size, 0);
    f.thumbnail = null;
    await f.thumbs.loadThumb(f.library.getActiveProfile().images[0]);
    assert.equal(f.liveUrls.size, 1);
    f.thumbs.forgetAllThumbs();
    assert.equal(f.liveUrls.size, 0);
});

test("CustomStream does not let an old thumbnail job erase a restarted job", async () => {
    const f = await customStream();
    const completions = [];
    f.getMany = () => new Promise(resolve => completions.push(resolve));
    const image = f.library.getActiveProfile().images[0];
    const old = f.thumbs.loadThumb(image);
    await tick();
    f.thumbs.forgetAllThumbs();
    const current = f.thumbs.loadThumb(image);
    await tick();
    completions[0]([new Blob(["old"])]);
    await old;
    assert.equal(f.thumbs.jobCount(), 1);
    completions[1]([new Blob(["current"])]);
    await current;
    assert.equal(f.liveUrls.size, 1);
    f.thumbs.forgetAllThumbs();
});

test("CustomStream deduplicates pending conversions and discards their results after stop", async () => {
    const f = await customStream();
    let finish;
    f.convert = () => new Promise(resolve => { finish = resolve; });
    const starting = f.air.startOnAir();
    await tick();
    f.air.chooseImage(0);
    f.air.onUploaderStarted("stream");
    await tick();
    assert.equal(f.conversions, 1);
    f.air.stopOnAir();
    finish("data:image/jpeg;base64,late");
    await starting;
    assert.equal(f.air.retainedUris(), 0);
    assert.equal(f.library.libraryChanged.listeners.size, 0);
    assert.equal(f.settingsChanged.listeners.size, 0);
});

test("CustomStream installs no listeners after an asynchronous startup was stopped", async () => {
    const f = await customStream();
    let finish;
    f.get = () => new Promise(resolve => { finish = resolve; });
    const starting = f.air.startOnAir();
    f.air.stopOnAir();
    finish(undefined);
    await starting;
    assert.equal(f.library.libraryChanged.listeners.size, 0);
    assert.equal(f.settingsChanged.listeners.size, 0);
});

async function gateway(options = {}) {
    const clock = timers(), logs = [];
    const plugin = (await load("gatewayLogger/index.tsx", {
        "@api/Settings": { definePluginSettings: def => settings(def, options) },
        "@utils/constants": { EquicordDevs: {} }, "@utils/types": pluginTypes,
        "@utils/Logger": { Logger: class { log(value) { logs.push(value); } } }
    }, clock)).default;
    plugin.start();
    return { plugin, clock, logs };
}

test("GatewayLogger decodes dispatches once and returns the exact decoded packet", async () => {
    const f = await gateway();
    const replacement = f.plugin.patches[0].replacement[0];
    const pattern = new RegExp(replacement.match.source.replaceAll("\\i", "[A-Za-z_$][\\w$]*"), replacement.match.flags);
    const code = "const decoded=codec.unpack(frame);switch(decoded.op){case Gateway.Opcodes.DISPATCH:return decoded;default:return decoded;}".replace(pattern, replacement.replace.replaceAll("$self", "plugin"));
    let calls = 0;
    const packet = { op: 0, t: "MESSAGE_CREATE", s: 1, d: { content: "message" } };
    assert.equal(compileFunction(code, ["codec", "frame", "plugin", "Gateway"])({ unpack() { calls++; return packet; } }, {}, f.plugin, { Opcodes: { DISPATCH: 0 } }), packet);
    assert.equal(calls, 1);
    f.plugin.stop();
    assert.equal(f.logs.length, 1);
});

test("GatewayLogger batches dispatch summaries and keeps payload objects out of console", async () => {
    const f = await gateway();
    for (let i = 0; i < 100; i++) f.plugin.log({ op: 0, t: "PRESENCE_UPDATE", s: i, d: { content: "payload" } });
    assert.equal(f.logs.length, 3);
    assert.equal(f.clock.tasks.size, 1);
    f.clock.fire();
    assert.equal(f.logs.length, 4);
    assert.equal(f.logs.join("\n").split("\n").length, 100);
    assert.equal(f.logs.every(value => typeof value === "string" && !value.includes("payload")), true);
    f.plugin.stop();
    assert.equal(f.clock.tasks.size, 0);
});

test("GatewayLogger retains full payload logging as serialized snapshots", async () => {
    const f = await gateway({ includePayloads: true });
    const packet = { op: 0, t: "MESSAGE_CREATE", s: 1, d: { content: "original" } };
    f.plugin.log(packet);
    packet.d.content = "modified";
    f.plugin.stop();
    assert.equal(JSON.parse(f.logs[0]).d.content, "original");
    assert.equal(f.clock.tasks.size, 0);
    f.plugin.log(packet);
    assert.equal(f.logs.length, 1);
});

test("GatewayLogger ignores non-dispatch frames and flushes oversized payloads immediately", async () => {
    const f = await gateway({ includePayloads: true });
    const heartbeat = { op: 11, d: null };
    assert.equal(f.plugin.log(heartbeat), heartbeat);
    assert.equal(f.logs.length, 0);
    f.plugin.log({ op: 0, t: "TEST", d: "x".repeat(200000) });
    assert.equal(f.logs.length, 1);
    assert.equal(f.clock.tasks.size, 0);
    f.plugin.stop();
});

test("OpenOptimizer uses the existing safe optimizer without patching synchronous DOM operations", async () => {
    const clock = timers();
    const original = child => child;
    const Element = { prototype: { appendChild: original, removeChild: original } };
    const plugin = (await load("openOptimizer/index.ts", { "@utils/constants": { EquicordDevs: {} }, "@utils/types": pluginTypes }, { ...clock, Element })).default;
    assert.deepEqual(plugin.dependencies, ["Hisako's Optimizations"]);
    plugin.start?.();
    const child = { className: "activity" };
    assert.equal(Element.prototype.appendChild(child), child);
    assert.equal(clock.tasks.size, 0);
    assert.equal(Element.prototype.removeChild, original);
});

async function surveillance(options = {}) {
    const clock = timers();
    const listeners = new Set(), flux = new Map();
    const events = [], notifications = [];
    const statuses = {}, activities = {};
    let maps = 0;
    class CountedMap extends Map { constructor(...args) { super(...args); maps++; } }
    const user = id => ({ id, username: id, bot: false, getAvatarURL: () => "avatar" });
    const common = {
        PresenceStore: {
            getState: () => ({ statuses }), getActivities: id => activities[id] ?? [],
            addChangeListener: listener => listeners.add(listener), removeChangeListener: listener => listeners.delete(listener)
        },
        UserStore: { getCurrentUser: () => user("self"), getUser: user },
        ChannelStore: { getChannel: id => ({ id, guild_id: "10", name: "Channel" }) },
        GuildStore: { getGuild: id => ({ id, name: "Guild" }) },
        RelationshipStore: { isFriend: () => false }, VoiceStateStore: {}, Menu: {}, SettingsRouter: {},
        FluxDispatcher: {
            subscribe(event, handler) { assert.equal(flux.has(event), false); flux.set(event, handler); },
            unsubscribe(event, handler) { assert.equal(flux.get(event), handler); flux.delete(event); }
        }
    };
    const module = await load("Surveillance/index.tsx", {
        "@api/ContextMenu": {}, "@api/Notifications": { async showNotification(data) { notifications.push(data); } },
        "@api/Settings": { definePluginSettings: def => settings(def, options) }, "@components/Icons": {},
        "@illegalcordplugins/legalWarnings": {}, "@plugins/_core/settings": { __esModule: true, default: { customEntries: [] } },
        "@utils/constants": { EquicordDevs: {} }, "@utils/lazyReact": { LazyComponent: () => () => null },
        "@utils/Logger": { Logger }, "@utils/misc": { removeFromArray(array, predicate) { const index = array.findIndex(predicate); if (index !== -1) array.splice(index, 1); } },
        "@utils/types": pluginTypes, "@webpack/common": common,
        "@vencord/discord-types/enums": { ActivityType: { STREAMING: 1, LISTENING: 2, WATCHING: 3, CUSTOM_STATUS: 4, COMPETING: 5, HANG_STATUS: 6 } },
        "./store": { recordEvent: event => events.push(event), stopStore: async () => {}, trimEvents: async () => {} }
    }, { ...clock, Map: CountedMap }, "\nexport const stateSizes = () => ({ users: seenServerUsers.size, activities: lastActivities.size, typing: typingCooldowns.size, updates: updateCooldowns.size });");
    const plugin = module.default;
    plugin.start();
    clock.fire();
    return {
        plugin, settings: module.settings.store, events, notifications, listeners, flux, statuses, activities, clock,
        stateSizes: module.stateSizes, resetMaps() { maps = 0; }, maps: () => maps,
        presence() { for (const listener of listeners) listener(); },
        emit(event, data) { flux.get(event)?.(data); },
        message(id) { flux.get("MESSAGE_CREATE")?.({ message: { id: "message" + id, channel_id: "channel", author: user(id), content: "hello", attachments: [] } }); }
    };
}

test("Surveillance installs no tracking listeners without targets", async () => {
    const f = await surveillance();
    assert.equal(f.listeners.size, 0);
    assert.equal(f.flux.size, 0);
    await f.plugin.stop();
    assert.equal(f.clock.tasks.size, 0);
});

test("Surveillance reuses activity snapshots while preserving in-place activity changes", async () => {
    const f = await surveillance({ targets: "42" });
    f.activities["42"] = [{ type: 0, name: "Game", details: "First" }];
    f.presence();
    assert.equal(f.events.at(-1).type, "activity_start");
    f.resetMaps();
    for (let i = 0; i < 1000; i++) f.presence();
    assert.equal(f.maps(), 0);
    assert.equal(f.events.length, 1);
    f.activities["42"][0].details = "Second";
    f.presence();
    assert.equal(f.events.at(-1).type, "activity_update");
    assert.match(f.events.at(-1).details, /First.*Second/);
    f.activities["42"] = [];
    f.presence();
    assert.equal(f.events.at(-1).type, "activity_stop");
    f.statuses["42"] = "online";
    f.presence();
    assert.equal(f.events.at(-1).type, "status");
    await f.plugin.stop();
    assert.equal(f.listeners.size, 0);
    assert.equal(f.flux.size, 0);
});

test("Surveillance releases departed members while retaining explicitly tracked users", async () => {
    const f = await surveillance({ serverTargets: "10", targets: "43" });
    f.message("42");
    f.message("43");
    assert.equal(f.stateSizes().users, 2);
    f.emit("GUILD_MEMBER_REMOVE", { guildId: "10", userId: "42" });
    assert.equal(f.stateSizes().users, 1);
    f.statuses["42"] = "online";
    const before = f.events.length;
    f.presence();
    assert.equal(f.events.length, before);
    f.emit("GUILD_DELETE", { guildId: "10" });
    assert.equal(f.stateSizes().users, 0);
    f.statuses["43"] = "online";
    f.presence();
    assert.equal(f.events.at(-1).userId, "43");
    assert.equal(f.events.at(-1).type, "status");
    await f.plugin.stop();
});

test("Surveillance bounds notification backlog and keeps every event in the log", async () => {
    const f = await surveillance({ targets: "42", notifyEvents: true });
    for (let i = 0; i < 100; i++) { f.statuses["42"] = i % 2 ? "offline" : "online"; f.presence(); }
    assert.equal(f.events.length, 100);
    assert.equal(f.notifications.length, 1);
    f.notifications[0].onClose();
    assert.equal(f.notifications.length, 2);
    assert.match(f.notifications[1].body, /99 new events/);
    f.statuses["42"] = "online";
    f.presence();
    await f.plugin.stop();
    f.notifications[1].onClose();
    assert.equal(f.notifications.length, 2);
});

test("Surveillance bounds cooldown maps during a burst of distinct typing users", async () => {
    const f = await surveillance({ serverTargets: "10" });
    for (let i = 0; i < 3000; i++) f.emit("TYPING_START", { userId: String(i), channelId: "channel" });
    assert.equal(f.stateSizes().typing, 2000);
    assert.equal(f.events.length, 3000);
    f.emit("GUILD_DELETE", { guildId: "10" });
    assert.equal(f.stateSizes().users, 0);
    assert.equal(f.stateSizes().activities, 0);
    await f.plugin.stop();
    assert.equal(f.stateSizes().typing, 0);
});

async function surveillanceStore(saved = []) {
    const clock = timers(), writes = [];
    const f = { saved, writes, clock, set: null, get: null };
    f.store = await load("Surveillance/store.ts", {
        "@api/DataStore": {
            async get() { return f.get ? f.get() : structuredClone(f.saved); },
            async set(_key, events) {
                const snapshot = structuredClone(events);
                writes.push(snapshot);
                if (f.set) await f.set(snapshot);
                f.saved = snapshot;
            }
        }, "@utils/Logger": { Logger }
    }, clock);
    return f;
}

const event = (id, scope = "person") => ({ id: String(id), timestamp: id, scope, userId: "42", type: "status" });

test("Surveillance batches immutable history updates and preserves event ordering", async () => {
    const f = await surveillanceStore([event(-1)]);
    await f.store.loadEvents(1000);
    await tick();
    const previous = f.store.getEvents();
    let updates = 0;
    const unsubscribe = f.store.subscribe(() => updates++);
    for (let i = 0; i < 1000; i++) f.store.recordEvent(event(i), 1000);
    assert.equal(f.clock.tasks.size, 1);
    await tick();
    assert.equal(updates, 1);
    assert.deepEqual(previous, [event(-1)]);
    assert.equal(f.store.getEvents().length, 1000);
    assert.equal(f.store.getEvents()[0].id, "999");
    assert.equal(f.store.getEvents().at(-1).id, "0");
    unsubscribe();
    await f.store.stopStore(1000);
    assert.equal(f.clock.tasks.size, 0);
    assert.equal(f.saved.length, 1000);
    assert.deepEqual(f.store.getEvents(), []);
});

test("Surveillance flushes pending events on stop and reloads them without duplication", async () => {
    const f = await surveillanceStore([event(-1)]);
    f.store.recordEvent(event(0), 1000);
    f.store.recordEvent(event(1), 1000);
    await f.store.stopStore(1000);
    assert.deepEqual(f.saved.map(event => event.id), ["1", "0", "-1"]);
    assert.equal(f.clock.tasks.size, 0);
    assert.deepEqual((await f.store.loadEvents(1000)).map(event => event.id), ["1", "0", "-1"]);
    await f.store.stopStore(1000);
});

test("Surveillance coalesces writes while persistence is busy", async () => {
    const f = await surveillanceStore();
    await f.store.loadEvents(1000);
    await tick();
    let finish;
    f.set = () => new Promise(resolve => { finish = resolve; });
    f.store.recordEvent(event(0), 1000);
    f.clock.fire();
    await tick();
    for (let i = 1; i < 100; i++) f.store.recordEvent(event(i), 1000);
    f.clock.fire();
    await tick();
    assert.equal(f.writes.length, 1);
    f.set = null;
    finish();
    await tick();
    assert.equal(f.writes.length, 2);
    assert.equal(f.saved.length, 100);
    await f.store.stopStore(1000);
});

test("Surveillance clears only the selected scope even when history was not loaded", async () => {
    const f = await surveillanceStore([event(0, "server"), event(1, "person")]);
    await f.store.clearEvents("server");
    assert.deepEqual(f.saved, [event(1, "person")]);
    await f.store.stopStore(1000);
});

test("Surveillance ignores history reads that finish after a clean shutdown", async () => {
    const f = await surveillanceStore();
    let finish;
    f.get = () => new Promise(resolve => { finish = resolve; });
    const loading = f.store.loadEvents(1000);
    await f.store.stopStore(1000);
    finish([event(0)]);
    await loading;
    assert.deepEqual(f.store.getEvents(), []);
});

test("CustomStream migrates legacy Blob profiles into metadata without losing image content", async () => {
    const f = await customStream();
    const blob = new Blob(["legacy"]);
    f.library.unloadLibrary();
    f.values.delete("CustomStreamTopQ_Library");
    f.values.set("CustomStreamTopQ_ProfilesV2", { profiles: [{ id: "default", name: "Default", images: [blob] }] });
    await f.library.loadLibrary();
    assert.equal(f.values.get("CustomStreamTopQ_Library").version, 4);
    const { images } = f.library.getActiveProfile();
    assert.equal(images.length, 1);
    assert.equal(await (await f.library.loadImage(images[0])).text(), "legacy");
});

test("CustomStream upload resizing allocates one small canvas and closes the bitmap", async () => {
    const allocations = [], draws = [];
    let closed = 0;
    const bitmap = { width: 1280, height: 720, close() { closed++; } };
    const media = await load("customStream/media.ts", {}, {
        createImageBitmap: async () => bitmap,
        OffscreenCanvas: class {
            constructor(width, height) { allocations.push([width, height]); }
            getContext() { return { drawImage(...args) { draws.push(args); } }; }
            async convertToBlob() { return new Blob(["jpeg"]); }
        },
        FileReader: class {
            readAsDataURL() { this.result = "data:image/jpeg;base64,jpeg"; queueMicrotask(() => this.onload()); }
        }
    });
    assert.equal(await media.toUploadDataUrl(new Blob()), "data:image/jpeg;base64,jpeg");
    assert.deepEqual(allocations, [[512, 288]]);
    assert.deepEqual(draws, [[bitmap, 0, 0, 512, 288]]);
    assert.equal(closed, 1);
});

test("GatewayLogger patch supports a qualified decoder receiver without changing dispatch", async () => {
    const f = await gateway();
    const replacement = f.plugin.patches[0].replacement[0];
    const pattern = new RegExp(replacement.match.source.replaceAll("\\i", "[A-Za-z_$][\\w$]*"), replacement.match.flags);
    const code = "const packet=this.decoder.unpack(input);switch(packet.op){case Gateway.Opcodes.DISPATCH:return packet;default:return packet;}".replace(pattern, replacement.replace.replaceAll("$self", "plugin"));
    const packet = { op: 0, t: "EVENT", s: 2 };
    const codec = { decoder: { unpack: () => packet } };
    assert.equal(compileFunction(code, ["input", "plugin", "Gateway"]).call(codec, {}, f.plugin, { Opcodes: { DISPATCH: 0 } }), packet);
    f.plugin.stop();
    assert.equal(f.logs.length, 1);
});

test("Surveillance retains a bounded unsaved batch when storage fails and retries on the next stop", async () => {
    const f = await surveillanceStore([event(-1)]);
    await f.store.loadEvents(1000);
    f.set = async () => { throw new Error("Storage unavailable"); };
    f.store.recordEvent(event(0), 1000);
    await f.store.stopStore(1000);
    assert.equal(f.clock.tasks.size, 0);
    assert.deepEqual(f.store.getEvents().map(event => event.id), ["0", "-1"]);
    assert.deepEqual(f.saved, [event(-1)]);
    f.set = null;
    await f.store.stopStore(1000);
    assert.deepEqual(f.saved.map(event => event.id), ["0", "-1"]);
    assert.deepEqual(f.store.getEvents(), []);
});

test("Surveillance does not overwrite saved history after a transient read failure", async () => {
    const f = await surveillanceStore([event(-1)]);
    f.get = async () => { throw new Error("Storage unavailable"); };
    f.store.recordEvent(event(0), 1000);
    await f.store.stopStore(1000);
    assert.deepEqual(f.saved, [event(-1)]);
    assert.equal(f.writes.length, 0);
    assert.equal(f.clock.tasks.size, 0);
    f.get = null;
    await f.store.stopStore(1000);
    assert.deepEqual(f.saved.map(event => event.id), ["0", "-1"]);
    assert.deepEqual(f.store.getEvents(), []);
});
