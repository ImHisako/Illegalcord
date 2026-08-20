/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";
import { readFile } from "fs/promises";
import { join } from "path";

import type { NativeWebhookResponse, NightyGiftWebhookConfig } from "./types";
function getNightyConfigPath() {
    const appData = process.env.APPDATA;
    if (!appData) return null;

    return join(appData, "Nighty Selfbot", "data", "scripts", "json", "nitro_sniper", "nitro_sniper_config.json");
}

export async function getNightyGiftWebhookConfig(_: IpcMainInvokeEvent): Promise<NightyGiftWebhookConfig | null> {
    const configPath = getNightyConfigPath();
    if (!configPath) return null;

    try {
        const raw = await readFile(configPath, "utf-8");
        const data = JSON.parse(raw);
        return {
            enabled: Boolean(data.gift_webhook_enabled),
            url: typeof data.gift_webhook_url === "string" ? data.gift_webhook_url : ""
        };
    } catch {
        return null;
    }
}

export async function sendWebhook(_: IpcMainInvokeEvent, webhookUrl: string, payload: string): Promise<NativeWebhookResponse> {
    try {
        const url = new URL(webhookUrl);
        url.searchParams.set("wait", "true");

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: payload
        });

        return {
            status: response.status,
            data: await response.text()
        };
    } catch (error) {
        return {
            status: -1,
            data: error instanceof Error ? error.message : String(error)
        };
    }
}
