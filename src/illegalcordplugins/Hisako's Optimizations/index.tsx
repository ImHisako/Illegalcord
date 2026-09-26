/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { isObject } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { findAll } from "@webpack";

interface SpringModule {
    Globals: {
        assign(options: { skipAnimation: boolean; }): void;
    };
    Springs: object;
}

const logger = new Logger("HisakoOptimizations");
let springModules: SpringModule[] = [];
let started = false;

const settings = definePluginSettings({
    disableSpringAnimations: {
        type: OptionType.BOOLEAN,
        description: "Skip Discord spring animations.",
        default: true,
        disabled: () => isPluginEnabled("DisableAnimations"),
        onChange(value) {
            if (!started) return;
            if (value && springModules.length === 0) loadSpringModules();
            setSpringAnimations(value);
        }
    },
    throttleActivityDom: {
        type: OptionType.BOOLEAN,
        description: "Legacy setting. Activity DOM updates are no longer delayed.",
        default: false,
        hidden: true
    },
    activityDomDelay: {
        type: OptionType.SLIDER,
        description: "Legacy setting. Activity DOM updates are no longer delayed.",
        markers: [25, 50, 75, 100, 150, 200],
        default: 100,
        stickToMarkers: false,
        hidden: true
    },
    disableTypingDots: {
        type: OptionType.BOOLEAN,
        description: "Disable the CPU intensive typing dots animation.",
        default: true,
        disabled: () => isPluginEnabled("NoTypingAnimation"),
        restartNeeded: true
    }
});

function hasCallableAssign(value: unknown): value is SpringModule["Globals"] {
    return isObject(value) && "assign" in value && typeof value.assign === "function";
}

function isSpringModule(value: unknown): value is SpringModule {
    if (!isObject(value)) return false;

    const module = value as Partial<Record<keyof SpringModule, unknown>>;
    return hasCallableAssign(module.Globals) && isObject(module.Springs);
}

function loadSpringModules() {
    const modules: SpringModule[] = [];

    for (const module of findAll(isSpringModule)) {
        if (isSpringModule(module)) modules.push(module);
    }

    springModules = modules;
}

function setSpringAnimations(skipAnimation: boolean) {
    for (const module of springModules) {
        try {
            module.Globals.assign({ skipAnimation });
        } catch (error) {
            logger.warn("Failed to update a Discord animation module.", error);
        }
    }
}

export default definePlugin({
    name: "Hisako's Optimizations",
    description: "Reduces Discord spring and typing animations.",
    authors: [EquicordDevs.irritably],
    tags: ["Utility", "Appearance"],
    searchTerms: ["performance", "optimization", "lag", "animation"],
    settings,

    patches: [
        {
            find: "dotCycle",
            predicate: () => settings.store.disableTypingDots && !isPluginEnabled("NoTypingAnimation"),
            replacement: {
                match: /focused:(\i)/g,
                replace: (_, focused) => `_focused:${focused}=false`
            }
        }
    ],

    start() {
        started = true;

        if (settings.store.disableSpringAnimations && !isPluginEnabled("DisableAnimations")) {
            loadSpringModules();
            setSpringAnimations(true);
        }
    },

    stop() {
        started = false;

        if (springModules.length !== 0 && !isPluginEnabled("DisableAnimations")) {
            setSpringAnimations(false);
        }

        springModules = [];
    }
});
