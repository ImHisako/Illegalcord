/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

export default definePlugin({
	name: "OpenOptimizer",
	description: "Ports OpenAsar's optimizer code.",
	tags: ["Utility"],
	authors: [{ name: "S€th", id: 1273447359417942128n }],
	methods: ["removeChild", "appendChild"],
	start() {
		for (const method of this.methods as (keyof Element)[]) {
			this[`_${method}`] = Element.prototype[method];
			// @ts-ignore
			Element.prototype[method] = this.optimize(Element.prototype[method]);
		}
	},
	stop() {
		for (const method of this.methods as (keyof Element)[]) {
			// @ts-ignore
			Element.prototype[method] = this[`_${method}`];
		}
	},

	// @ts-ignore
	optimize: orig =>
		// @ts-ignore
		function (...args) {
			if (
				typeof args[0].className === "string" &&
				(args[0].className.indexOf("activity") !== -1 ||
					args[0].className.indexOf("subText") !== -1 ||
					args[0].className.indexOf("botText") !== -1 ||
					args[0].className.indexOf("clanTag") !== -1)
			)
				// @ts-ignore
				return setTimeout(() => orig.apply(this, args), 100);

			// @ts-ignore
			return orig.apply(this, args);
		},
});
