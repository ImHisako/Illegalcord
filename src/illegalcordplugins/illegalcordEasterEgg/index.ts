/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { EquicordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

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
    additionalQuotes: {
        type: OptionType.STRING,
        description: "Add more random quotes, one per line.",
        default: "",
        multiline: true
    }
});

export default definePlugin({
    name: "IllegalcordEasterEgg",
    description: "Shows random Illegalcord jokes under Did you know while loading.",
    authors: [EquicordDevs.irritably],
    tags: ["Fun"],
    enabledByDefault: true,
    settings,

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
    }],

    getQuote() {
        const additionalQuotes = settings.store.additionalQuotes.split("\n").map((quote: string) => quote.trim()).filter(Boolean);
        const quotes = [...presetQuotes, ...additionalQuotes];
        return quotes[Math.floor(Math.random() * quotes.length)];
    }
});
