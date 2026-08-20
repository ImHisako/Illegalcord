/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

const URL_REGEX = /https:\/\/[^\s<>()]+/gi;
const URL_TRAILING_PUNCTUATION_REGEX = /[),.!?]+$/;

const urlMap: Record<string, string> = {
    "https://www.tiktok.com": "https://www.tnktok.com",
    "https://vt.tiktok.com": "https://www.tnktok.com",
    "https://x.com": "https://www.fxtwitter.com",
    "https://www.twitter.com": "https://www.fxtwitter.com",
    "https://www.instagram.com": "https://www.kkinstagram.com"
};

export default definePlugin({
    name: "EmbeddedURLs",
    description: "Turns plain social links into embeddable URLs so posts and videos are fully viewable in Discord instead of forcing users to open the external site.",
    tags: ["Chat", "Media"],
    authors: [EquicordDevs.Dadian1],

    replaceUrl(match: string): string {
        const trailingPunctuation = URL_TRAILING_PUNCTUATION_REGEX.exec(match)?.[0] ?? "";
        const originalUrl = trailingPunctuation ? match.slice(0, -trailingPunctuation.length) : match;

        try {
            var newUrl = new URL(originalUrl);
        } catch (error) {
            return match;
        }

        const replacementOrigin = urlMap[newUrl.origin];
        if (!replacementOrigin) return match;

        return `${replacementOrigin}${newUrl.pathname}${newUrl.search}${newUrl.hash}${trailingPunctuation}`;
    },

    onBeforeMessageSend(_, msg) {
        msg.content = msg.content.replace(URL_REGEX, match => this.replaceUrl(match));
    }
});
