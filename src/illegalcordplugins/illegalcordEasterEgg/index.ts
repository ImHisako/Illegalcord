/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { EquicordDevs } from "@utils/constants";
import { makeLazy } from "@utils/lazy";
import { classes, isAnyPluginDev } from "@utils/misc";
import definePlugin, { OptionType, Plugin, PluginAuthor } from "@utils/types";
import { React } from "@webpack/common";
import type { ElementType, HTMLAttributes } from "react";

import Plugins from "~plugins";

import style from "./style.css?managed";

const presetQuotes = [
    "Discord is spying on us",
    "Telegram is fedded",
    "The user of this client has been reported to the nearest law enforcement authorities for participating in violent or illegal activities.",
    "Oneplus, Vivo & IQOO Phones are better than Iphone & Samsung.",
    "Behave yourself Jesus is watching you.",
    "that you can share your screen at rates above 60 Hz with Betterscreenshare?",
    "Piracy is fundamentally a service problem, not a pricing problem",
    "We are Voices38",
    "stock Windows sucks get ReviOS from revi.cc",
    "Brave sucks when it comes to privacy get Waterfox / Librewolf browser"
];

const settings = definePluginSettings({
    developerVoiceSpectrum: {
        type: OptionType.BOOLEAN,
        description: "Cycle client developers' names through the color spectrum in voice channels.",
        default: true
    },
    additionalQuotes: {
        type: OptionType.STRING,
        description: "Add more random quotes, one per line.",
        default: "",
        multiline: true
    }
});

const VOICE_NAME_SETTINGS = ["developerVoiceSpectrum"] satisfies Array<keyof typeof settings.def>;
const getPluginAuthorIds = makeLazy(() => new Set(Object.values(Plugins).flatMap((plugin: Plugin) => plugin.authors.map((author: PluginAuthor) => author.id.toString()))));

interface DeveloperVoiceNameProps extends HTMLAttributes<HTMLElement> {
    component: ElementType;
    userId: string;
}

const DeveloperVoiceName = ErrorBoundary.wrap(({ component, userId, className, ...props }: DeveloperVoiceNameProps) => {
    const { developerVoiceSpectrum } = settings.use(VOICE_NAME_SETTINGS);
    return React.createElement(component, {
        ...props,
        className: classes(className, developerVoiceSpectrum && (isAnyPluginDev(userId) || getPluginAuthorIds().has(userId)) && "vc-illegalcord-easter-egg-spectrum")
    });
}, { noop: true });

export default definePlugin({
    name: "IllegalcordEasterEgg",
    description: "Shows random Illegalcord loading jokes and gives developers colorful names in voice channels.",
    authors: [EquicordDevs.irritably],
    tags: ["Fun"],
    enabledByDefault: true,
    settings,
    managedStyle: style,

    patches: [{
        find: "#{intl::LOADING_DID_YOU_KNOW}",
        replacement: [
            {
                match: /(?<=_loadingText=\(function\(\)\{)/,
                replace: "return $self.getQuote();"
            },
            {
                match: /(?<=_eventLoadingText=\(function\(\)\{)/,
                replace: "return $self.getQuote();",
                noWarn: true
            }
        ]
    }, {
        find: "#{intl::GUEST_NAME_SUFFIX})]",
        replacement: {
            match: /(?<=\(0,\i\.jsxs\)\()(\i(?:\.\i)?|"span"|"div"),\{(?=.{0,150}?children:\[.{0,200}?#{intl::GUEST_NAME_SUFFIX})/,
            replace: "$self.DeveloperVoiceName,{component:$1,userId:arguments[0].user.id,"
        }
    }],

    DeveloperVoiceName,

    getQuote() {
        const additionalQuotes = settings.store.additionalQuotes.split("\n").map((quote: string) => quote.trim()).filter(Boolean);
        const quotes = [...presetQuotes, ...additionalQuotes];
        return quotes[Math.floor(Math.random() * quotes.length)];
    }
});
