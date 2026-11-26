/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { compileFunction } from "node:vm";

import { transform } from "esbuild";

const require = createRequire(import.meta.url);

async function load(file, dependencies) {
    const source = await readFile(new URL(`../../src/${file}`, import.meta.url), "utf8");
    const { code } = await transform(source, { loader: "tsx", format: "cjs" });
    const module = { exports: {} };
    compileFunction(code, ["require", "module", "exports"])(name => {
        assert.ok(Object.hasOwn(dependencies, name), name);
        return dependencies[name];
    }, module, module.exports);
    return module.exports;
}

test("ws: Dynamic Island accepts WebNowPlaying, updates tracks and releases its server", { timeout: 15_000 }, async t => {
    const ws = require("ws");
    let server;
    class LocalServer extends ws.WebSocketServer {
        constructor(options) {
            super({ ...options, port: 0 });
            server = this;
        }
    }
    const bridge = await load("illegalcordplugins/IllegalcordDynamicIsland/native.ts", { ws: { ...ws, WebSocketServer: LocalServer } });
    const sender = new EventEmitter();
    const event = { sender };
    t.after(() => bridge.configure(event, false, "rpc"));
    t.after(() => bridge.configure(event, false, "island"));
    assert.equal((await bridge.configure(event, true)).error, null);

    const url = `ws://127.0.0.1:${server.address().port}`;
    const connection = once(server, "connection");
    const client = new ws.WebSocket(url, { origin: "chrome-extension://jfakgfcdgpghbbefmdfjkbdlibjgnbli" });
    const greeting = once(client, "message");
    t.after(() => client.terminate());
    await once(client, "open");
    const [peer] = await connection;
    assert.match(String((await greeting)[0]), /ADAPTER_VERSION/);
    for (const message of ["PLAYER_NAME SoundCloud", "TITLE Compatibility test", "ARTIST Test artist", "COVER_URL https://i1.sndcdn.com/test.jpg", "STATE PLAYING"]) {
        const received = once(peer, "message");
        client.send(message);
        await received;
    }
    assert.deepEqual(bridge.getState(event).track, { title: "Compatibility test", artist: "Test artist", cover: "https://i1.sndcdn.com/test.jpg", playing: true });
    const command = once(client, "message");
    assert.equal(bridge.control(event, "pause"), true);
    assert.equal(String((await command)[0]), "TRY_SET_STATE PAUSED");

    const rejected = new ws.WebSocket(url, { origin: "https://example.invalid" });
    const rejection = once(rejected, "error");
    assert.match((await rejection)[0].message, /401/);

    await bridge.configure(event, true, "rpc");
    await bridge.configure(event, false, "island");
    assert.equal(client.readyState, ws.WebSocket.OPEN);
    const closed = once(client, "close");
    await bridge.configure(event, false, "rpc");
    await closed;
    assert.equal(sender.listenerCount("destroyed"), 0);
    assert.equal(sender.listenerCount("render-process-gone"), 0);
});

test("Zod: SongSpotlight preserves its song schemas and rejects oversized imports before parsing entries", async () => {
    const { SongSchema, UserDataSchema } = await import("@song-spotlight/api/structs");
    const { services } = await import("@song-spotlight/api/handlers");
    const songs = services.map(service => ({ service: service.name, type: service.types[0], id: "compatibility-test" }));
    assert.ok(songs.length > 0);
    for (const song of songs) assert.deepEqual(SongSchema.parse(song), song);
    assert.deepEqual(UserDataSchema.max(songs.length).parse(songs), songs);
    assert.equal(SongSchema.safeParse({ service: "invalid", type: "invalid", id: "test" }).success, false);
    assert.equal(UserDataSchema.safeParse({ songs }).success, false);

    const oversized = Array.from({ length: 10 }, () => ({ get service() { throw new Error("Oversized entries must not be parsed."); } }));
    const result = UserDataSchema.max(5).safeParse(oversized);
    assert.equal(result.success, false);
    assert.equal(result.error.issues.length, 1);
    assert.equal(result.error.issues[0].code, "too_big");
});

test("Moment: Italian dates, relative times, offsets and strict parsing remain compatible", () => {
    const moment = require("moment");
    require("moment/locale/it");
    const date = moment.parseZone("2026-11-26T12:34:56+01:00").locale("it");
    assert.equal(date.format("YYYY-MM-DD HH:mm Z"), "2026-11-26 12:34 +01:00");
    assert.equal(date.format("D MMMM YYYY"), "26 novembre 2026");
    assert.equal(date.clone().subtract(1, "minute").from(date), "un minuto fa");
    assert.equal(moment.duration(60, "seconds").locale("it").humanize(), "un minuto");
    assert.equal(moment("2026-02-30", "YYYY-MM-DD", true).isValid(), false);
    assert.equal(moment("2024-02-29", "YYYY-MM-DD", true).isValid(), true);
});
