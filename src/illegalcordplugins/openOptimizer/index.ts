/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "OpenOptimizer",
    description: "Uses Hisako's Optimizations to reduce interface animations without delaying updates.",
    tags: ["Utility"],
    authors: [EquicordDevs.seth],
    hidden: true,
    dependencies: ["Hisako's Optimizations"]
});
