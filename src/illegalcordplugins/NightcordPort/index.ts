/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "NightcordPort",
    description: "Marks Illegalcord plugins ported from Nightcord.",
    authors: [EquicordDevs.irritably],
    required: true,
    enabledByDefault: true,

    isNightcordPlugin(name: string) {
        return name === "LarpCord" || name === "StreamProofEnhanched";
    }
});
