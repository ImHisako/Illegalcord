/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";

const logger = new Logger("GatewayLogger");

export default definePlugin({
    name: "GatewayLogger",
    description: "logs gateway events to the console",
    tags: ["Developers", "Utility"],
    authors: [
        EquicordDevs.zastix,
        EquicordDevs.Death
    ],
    patches: [
        {
            find: "[FAST CONNECT] successfully took over websocket",
            replacement: [{
                // i know its bad but i do not care
                match: /(\i)\.unpack\(e\)(.*?)case (\i)\.(\i)\.DISPATCH:/,
                replace: "$1.unpack(e)$2case $3.$4.DISPATCH:$self.log($1.unpack(e));"
            }]
        }
    ],
    log: logger.log.bind(logger)
});
