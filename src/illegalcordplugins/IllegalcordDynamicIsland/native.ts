/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent, WebContents } from "electron";
import { WebSocket, WebSocketServer } from "ws";

export interface SoundCloudTrack {
    title: string;
    artist: string;
    cover: string;
    playing: boolean;
}

interface Player extends SoundCloudTrack {
    name: string;
    stopped: boolean;
}

let server: WebSocketServer | undefined;
let owner: WebContents | undefined;
let error: string | null = null;
let pending = Promise.resolve();
const players = new Map<WebSocket, Player>();

function snapshot() {
    const active = [...players.values()].filter(player => player.name === "SoundCloud" && player.title && !player.stopped);
    const player = active.find(player => player.playing) ?? active[0];
    const track: SoundCloudTrack | null = player
        ? { title: player.title, artist: player.artist, cover: player.cover, playing: player.playing }
        : null;
    return { track, error };
}

function closeServer(): Promise<void> {
    const current = server;
    server = undefined;
    players.clear();
    if (owner) {
        owner.removeListener("destroyed", stopOnExit);
        owner.removeListener("render-process-gone", stopOnExit);
        owner = undefined;
    }
    return new Promise(resolve => {
        if (!current) return resolve();
        current.clients.forEach(client => client.terminate());
        current.close(() => resolve());
    });
}

function stopOnExit() {
    pending = pending.then(closeServer);
}

function updatePlayer(player: Player, message: string) {
    const separator = message.indexOf(" ");
    if (separator < 0) return;
    const key = message.slice(0, separator);
    const value = message.slice(separator + 1);
    switch (key) {
        case "PLAYER_NAME":
            player.name = value.slice(0, 128);
            break;
        case "TITLE":
            player.title = value.slice(0, 512);
            break;
        case "ARTIST":
            player.artist = value.slice(0, 512);
            break;
        case "STATE":
            player.playing = value === "PLAYING";
            player.stopped = value !== "PLAYING" && value !== "PAUSED";
            break;
        case "COVER_URL": {
            player.cover = "";
            if (value.length > 2048 || !URL.canParse(value)) break;
            const url = new URL(value);
            if (url.protocol === "https:" && /^i\d\.sndcdn\.com$/.test(url.hostname) && !url.port && !url.username && !url.password)
                player.cover = url.href;
            break;
        }
    }
}

export function configure(event: IpcMainInvokeEvent, enabled: unknown) {
    if (typeof enabled !== "boolean") return Promise.resolve({ track: null, error: "Invalid SoundCloud setting." });

    const result = pending.then(async () => {
        if (!enabled) {
            await closeServer();
            error = null;
        } else if (!server) {
            error = null;
            owner = event.sender;
            owner.once("destroyed", stopOnExit);
            owner.once("render-process-gone", stopOnExit);
            await new Promise<void>(resolve => {
                const current = new WebSocketServer({
                    host: "127.0.0.1",
                    port: 8975,
                    maxPayload: 16_384,
                    perMessageDeflate: false,
                    verifyClient: ({ origin }) => origin === "chrome-extension://jfakgfcdgpghbbefmdfjkbdlibjgnbli"
                        || /^moz-extension:\/\/[a-f0-9-]{36}$/.test(origin)
                });
                server = current;
                current.once("listening", resolve);
                current.on("error", () => {
                    error = "Could not start WebNowPlaying on port 8975. Close any other adapter using this port, then toggle SoundCloud off and on.";
                    resolve();
                });
                current.on("connection", client => {
                    if (players.size >= 4) {
                        client.close(1008);
                        return;
                    }
                    const player: Player = { name: "", title: "", artist: "", cover: "", playing: false, stopped: true };
                    players.set(client, player);
                    client.send("ADAPTER_VERSION 1.0.0;WNPLIB_REVISION 2");
                    client.on("message", (data, binary) => {
                        if (binary) return client.close(1003);
                        updatePlayer(player, data.toString());
                    });
                    client.on("close", () => players.delete(client));
                    client.on("error", () => {
                        players.delete(client);
                        client.terminate();
                    });
                });
            });
        }
        return snapshot();
    });
    pending = result.then(() => {});
    return result;
}

export function getState(_: IpcMainInvokeEvent) {
    return snapshot();
}

export function control(_: IpcMainInvokeEvent, action: unknown) {
    if (action !== "play" && action !== "pause" && action !== "previous" && action !== "next") return false;

    const active = [...players].filter(([, player]) => player.name === "SoundCloud" && player.title && !player.stopped);
    const selected = active.find(([, player]) => player.playing) ?? active[0];
    if (!selected || selected[0].readyState !== WebSocket.OPEN) return false;

    const command = {
        play: "TRY_SET_STATE PLAYING",
        pause: "TRY_SET_STATE PAUSED",
        previous: "TRY_SKIP_PREVIOUS",
        next: "TRY_SKIP_NEXT"
    }[action];
    selected[0].send(command);
    return true;
}
