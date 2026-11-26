/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";

const logger = new Logger("GatewayLogger");
const settings = definePluginSettings({
    includePayloads: {
        type: OptionType.BOOLEAN,
        description: "Include full gateway payloads in console logs. This uses more CPU and memory.",
        default: false
    }
});
const pending: string[] = [];
let pendingBytes = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let active = false;

function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (!pending.length) return;
    logger.log(pending.join("\n"));
    pending.length = 0;
    pendingBytes = 0;
}

export default definePlugin({
    name: "GatewayLogger",
    description: "Logs gateway events to the console with optional full payloads.",
    tags: ["Developers", "Utility"],
    authors: [
        EquicordDevs.zastix,
        EquicordDevs.Death
    ],
    settings,
    patches: [
        {
            find: "[FAST CONNECT] successfully took over websocket",
            replacement: [{
                match: /(?<![\w$.])\i(?:\.\i){0,2}\.unpack\(\i\)/,
                replace: "$self.log($&)"
            }]
        }
    ],
    start() {
        active = true;
    },
    stop() {
        active = false;
        flush();
    },
    log<T>(packet: T): T {
        if (!active || typeof packet !== "object" || packet === null || !("op" in packet) || packet.op !== 0) return packet;
        const entry = settings.plain.includePayloads ? JSON.stringify(packet)
            : `${"t" in packet ? packet.t : "DISPATCH"} (${"s" in packet ? packet.s : ""})`;
        if (pendingBytes + entry.length > 131_072) flush();
        pending.push(entry);
        pendingBytes += entry.length;
        if (pending.length >= 32 || pendingBytes >= 131_072) flush();
        else timer ??= setTimeout(flush, 250);
        return packet;
    }
});
