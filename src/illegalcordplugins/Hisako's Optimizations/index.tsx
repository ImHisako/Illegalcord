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
import { findAll, moduleListeners } from "@webpack";

interface SpringModule {
    Globals: {
        skipAnimation: boolean;
        assign(options: { skipAnimation: boolean; }): void;
    };
    Springs: object;
}

const logger = new Logger("HisakoOptimizations");
const springGlobals = new Map<SpringModule["Globals"], boolean>();
let started = false;

const settings = definePluginSettings({
    disableSpringAnimations: {
        type: OptionType.BOOLEAN,
        description: "Skip Discord spring animations.",
        default: true,
        disabled: () => isPluginEnabled("DisableAnimations"),
        onChange: syncSpringAnimations
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

function isSpringGlobals(value: unknown): value is SpringModule["Globals"] {
    return isObject(value) && "assign" in value && typeof value.assign === "function"
        && "skipAnimation" in value && typeof value.skipAnimation === "boolean";
}

function isSpringModule(value: unknown): value is SpringModule {
    if (!isObject(value)) return false;

    const module = value as Partial<Record<keyof SpringModule, unknown>>;
    return isSpringGlobals(module.Globals) && isObject(module.Springs);
}

function skipSpringAnimations(value: unknown) {
    const globals = isSpringModule(value) ? value.Globals : value;
    if (!isSpringGlobals(globals) || springGlobals.has(globals)) return;

    try {
        springGlobals.set(globals, globals.skipAnimation);
        globals.assign({ skipAnimation: true });
    } catch (error) {
        logger.warn("Failed to update a Discord animation module.", error);
    }
}

function syncSpringAnimations() {
    const otherPluginEnabled = isPluginEnabled("DisableAnimations");
    if (started && settings.store.disableSpringAnimations && !otherPluginEnabled) {
        if (moduleListeners.has(skipSpringAnimations)) return;

        moduleListeners.add(skipSpringAnimations);
        for (const module of findAll((value: unknown) => isSpringGlobals(value) || isSpringModule(value))) skipSpringAnimations(module);
        return;
    }

    moduleListeners.delete(skipSpringAnimations);
    for (const [globals, skipAnimation] of springGlobals) {
        try {
            if (!otherPluginEnabled) globals.assign({ skipAnimation });
        } catch (error) {
            logger.warn("Failed to update a Discord animation module.", error);
        }
    }
    springGlobals.clear();
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
            group: true,
            replacement: [
                {
                    match: /focused:(\i)/g,
                    replace: (_: string, focused: string) => `_focused:${focused}=false`
                },
                {
                    match: /(?<=to:)async \i=>\{.{0,350}?\}(?=\}\),"animate-always")/,
                    replace: "()=>{}"
                }
            ]
        }
    ],

    start() {
        started = true;
        syncSpringAnimations();
    },

    stop() {
        started = false;
        syncSpringAnimations();
    }
});
