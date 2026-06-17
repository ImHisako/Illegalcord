/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, migratePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { sendMessage } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { Channel, Message } from "@vencord/discord-types";
import { MouseEvent } from "react";

let ignore = false;

// Taken From Signature :)
const settings = definePluginSettings({
    forwardPreface: {
        description: "What should forwarded from be prefaced with",
        type: OptionType.SELECT,
        options: [
            { label: ">", value: ">", default: true },
            { label: "-#", value: "-#" }
        ]
    },
    dontFollowForwards: {
        description: "After forwarding a single message, don't jump to it. Hold shift to ignore this behavior",
        displayName: "Don't Follow Forwards",
        type: OptionType.BOOLEAN,
        default: false,
        restartNeeded: true,
    }
});

migratePluginSettings("BetterForwards", "ForwardAnywhere");
export default definePlugin({
    name: "BetterForwards",
    description: "If a forward fails, send it as a normal message. Also allows nsfw forwards. See settings for various other improvements to forwarding.",
    tags: ["Chat", "Utility"],
    authors: [Devs.thororen, Devs.sadan],
    settings,
    patches: [
        {
            find: "#{intl::MESSAGE_FORWARDING_NSFW_NOT_ALLOWED}",
            replacement: {
                match: /(\{if\().{0,50}(\)return.{0,25}#{intl::MESSAGE_FORWARDING_NSFW_NOT_ALLOWED})/,
                replace: "$1false$2",
            }
        },
        {
            find: "#{intl::MESSAGE_ACTION_FORWARD_TO}",
            replacement: {
                match: /(?<=let (\i)=.{0,25}rejected.{0,25}\);)(?=.{0,25}message:(\i))/,
                replace: "if ($1) return $self.sendForward($1,$2);",
            }
        },
        {
            find: "#{intl::MESSAGE_FORWARD_MESSAGE_PLACEHOLDER}",
            predicate: () => settings.store.dontFollowForwards,
            replacement: [
                {
                    match: /(?<=transitionToDestination:)(1===\i\.length)(?=,|\})/,
                    replace: "$self.shouldTransition($1)"
                },
                {
                    // there are two useCallbacks with clearDraft in this module
                    // we need to anchor to the one that is used as an onClick handler
                    match: /((\i)=\i\.useCallback\(\()(\)=>\{)(null!=\i&&\i\.\i\.clearDraft)(?=.{1500,2000}onClick:\2)/,
                    replace: (_, beforeParen, _1, beforeBody, body) => `${beforeParen}vencordArg1${beforeBody}$self.setShift(vencordArg1);${body}`
                }
            ]
        }
    ],

    sendForward(channels: Channel[], message: Message) {
        const chunkSize = 5;
        channels.forEach(c => {
            if (message.attachments.length) {
                for (let i = 0; i < message.attachments.length; i += chunkSize) {
                    const group = message.attachments.slice(i, i + chunkSize);
                    const text = `${message.content}\nAttachments:\n${group.map(a => a.url).join("\n")}\n${settings.store.forwardPreface} Forwarded from <#${message.channel_id}>`;
                    sendMessage(c.id, { content: text });
                }
            } else {
                sendMessage(c.id, {
                    content: `${message.content}\n${settings.store.forwardPreface} Forwarded from <#${message.channel_id}>`
                });
            }
        });
    },

    shouldTransition(origCond: boolean): boolean {
        return ignore ? origCond : false;
    },

    setShift(event: MouseEvent | undefined) {
        ignore = !!event?.shiftKey;
    }
});
