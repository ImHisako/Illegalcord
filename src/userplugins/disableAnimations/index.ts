/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { findAll } from "@webpack";

export default definePlugin({
	name: "DisableAnimations",
	description: "Disables most of Discord's animations.",
	tags: ["Appearance", "Accessibility"],
	authors: [{ name: "S€th", id: 1273447359417942128n }],
	start() {
		this.springs = findAll(mod => (
			typeof mod.Globals === "object" && typeof mod.Springs === "object"
		));

		for (const spring of this.springs) {
			if (spring.Globals && typeof spring.Globals.assign === "function") {
				spring.Globals.assign({
					skipAnimation: true,
				});
			}
		}

		this.css = null;
	},
	stop() {
		for (const spring of this.springs) {
			if (spring.Globals && typeof spring.Globals.assign === "function") {
				spring.Globals.assign({
					skipAnimation: false,
				});
			}
		}
	},
});
