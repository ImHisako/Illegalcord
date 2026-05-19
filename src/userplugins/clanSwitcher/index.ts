/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps } from "@webpack";

// ─── Settings ────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    clans: {
        type: OptionType.STRING,
        default: "",
        description: "Clan IDs (comma-separated)"
    },
    intervalSeconds: {
        type: OptionType.NUMBER,
        default: 5,
        description: "Interval between clan switches (in seconds, min 1)"
    },
    randomizeOrder: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Randomize clan rotation order"
    },
    enableLogs: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Enable console logging"
    }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getToken(): string | null {
    return findByProps("getToken")?.getToken?.() ?? null;
}

function getClanList(): string[] {
    return settings.store.clans
        .split(",")
        .map(c => c.trim())
        .filter(Boolean);
}

function log(...args: any[]) {
    if (settings.store.enableLogs)
        console.log("[Clan Switcher]", ...args);
}

function warn(...args: any[]) {
    if (settings.store.enableLogs)
        console.warn("[Clan Switcher]", ...args);
}

async function switchClan(clanId: string): Promise<void> {
    const token = getToken();
    if (!token) {
        warn("Could not retrieve token. Skipping switch.");
        return;
    }

    try {
        const res = await fetch("https://discord.com/api/v9/users/@me/clan", {
            method: "PUT",
            headers: {
                "authorization": token,
                "content-type": "application/json",
                "origin": "https://discord.com",
                "referer": "https://discord.com/channels/@me",
                "x-discord-locale": "en-US",
                "x-discord-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone
            },
            body: JSON.stringify({
                identity_enabled: true,
                identity_guild_id: clanId
            })
        });

        if (!res.ok) {
            warn(`Switch to clan ${clanId} failed: HTTP ${res.status}`);
        } else {
            log(`Switched to clan: ${clanId}`);
        }
    } catch (err) {
        warn("Network error during clan switch:", err);
    }
}

// ─── Plugin State ─────────────────────────────────────────────────────────────

let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
let clanIndex = 0;
let isRunning = false;

function getIntervalMs(): number {
    return Math.max(1, settings.store.intervalSeconds ?? 5) * 1000;
}

function getNextClanId(list: string[]): string {
    if (settings.store.randomizeOrder) {
        return list[Math.floor(Math.random() * list.length)];
    }
    const id = list[clanIndex % list.length];
    clanIndex++;
    return id;
}

function scheduleNext() {
    if (!isRunning) return;
    timeoutHandle = setTimeout(tick, getIntervalMs());
}

async function tick() {
    if (!isRunning) return;

    const token = getToken();
    if (!token) {
        warn("No token available. Retrying next interval.");
        scheduleNext();
        return;
    }

    const clanList = getClanList();
    if (clanList.length === 0) {
        warn("No IDs available. Check settings.");
        scheduleNext();
        return;
    }

    const clanId = getNextClanId(clanList);
    await switchClan(clanId);
    scheduleNext();
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "ClanSwitcher",
    description: "Automatically rotates Discord clan tags at a configurable interval.",
    tags: ["Appearance", "Utility"],
    authors: [{ name: "irritably", id: 928787166916640838n }],
    settings,

    start() {
        if (isRunning) return;

        const token = getToken();
        if (!token) {
            warn("Failed to retrieve token on start. Plugin will retry automatically.");
        }

        const clanList = getClanList();
        if (clanList.length === 0) {
            warn("No clan IDs configured. Add them in plugin settings.");
        }

        clanIndex = 0;
        isRunning = true;
        log("Started.");
        tick();
    },

    stop() {
        isRunning = false;
        if (timeoutHandle !== null) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
        }
        log("Stopped.");
    }
});
