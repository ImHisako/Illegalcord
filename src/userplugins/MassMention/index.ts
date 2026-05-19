/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2026 Hisako and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption } from "@api/Commands";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { sendMessage } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { GuildMemberStore, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    delayBetweenMessages: {
        type: OptionType.NUMBER,
        description: "Delay in milliseconds between each mention message to avoid rate limits.",
        default: 5000
    },
    excludeBots: {
        type: OptionType.BOOLEAN,
        description: "Exclude bot accounts from mentions.",
        default: true
    }
});

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export default definePlugin({
    name: "MassMention",
    description: "Mention multiple users in a server with configurable batch sizes. Use /massmention to start.",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    tags: ["Utility", "Chat"],
    settings,
    dependencies: ["CommandsAPI"],

    commands: [
        {
            name: "massmention",
            description: "Mention users in batches in the current server",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "mentions_per_message",
                    description: "Number of users to mention per message (1-50)",
                    type: ApplicationCommandOptionType.INTEGER,
                    required: true
                },
                {
                    name: "total_mentions",
                    description: "Total number of users to mention (leave empty for all)",
                    type: ApplicationCommandOptionType.INTEGER,
                    required: false
                }
            ],
            execute: async (opts, ctx) => {
                const { channel } = ctx;
                if (!channel?.guild_id) {
                    showNotification({
                        title: "MassMention",
                        body: "This command can only be used in a server.",
                        icon: "https://cdn.discordapp.com/embed/avatars/0.png"
                    });
                    return;
                }

                const guildId = channel.guild_id;
                const mentionsPerMessage = findOption(opts, "mentions_per_message", 10) as number;
                const totalMentionsOption = findOption(opts, "total_mentions") as number | undefined;
                const { excludeBots = true, delayBetweenMessages = 5000 } = settings.store;

                let members = GuildMemberStore.getMembers(guildId);
                if (!members || members.length === 0) {
                    showNotification({
                        title: "MassMention",
                        body: "No members found in this server.",
                        icon: "https://cdn.discordapp.com/embed/avatars/0.png"
                    });
                    return;
                }

                members = members.filter(m => {
                    if (excludeBots) {
                        const user = UserStore.getUser(m.userId);
                        if (user?.bot) return false;
                    }
                    return true;
                });

                if (!members.length) {
                    showNotification({
                        title: "MassMention",
                        body: "No valid users found to mention.",
                        icon: "https://cdn.discordapp.com/embed/avatars/0.png"
                    });
                    return;
                }

                const totalMentions = totalMentionsOption
                    ? Math.min(totalMentionsOption, members.length)
                    : members.length;

                showNotification({
                    title: "MassMention",
                    body: `Starting mass mention: ${totalMentions} users, ${mentionsPerMessage} per message.`,
                    icon: "https://cdn.discordapp.com/embed/avatars/0.png"
                });

                let index = 0;
                let successCount = 0;

                while (index < totalMentions) {
                    const endIndex = Math.min(index + mentionsPerMessage, totalMentions);
                    const currentBatch = members.slice(index, endIndex);
                    const mentionMsg = currentBatch.map(m => `<@${m.userId}>`).join(" ");

                    try {
                        sendMessage(channel.id, { content: mentionMsg });
                        successCount += currentBatch.length;
                    } catch (error) {
                        console.error("[MassMention] Failed to send mention:", error);
                    }

                    index = endIndex;

                    if (index < totalMentions) {
                        await sleep(delayBetweenMessages);
                    }
                }

                showNotification({
                    title: "MassMention",
                    body: `Mass mention complete! Mentioned ${successCount} users.`,
                    icon: "https://cdn.discordapp.com/embed/avatars/0.png"
                });
            }
        }
    ],

    start() {
        // Plugin started
    },

    stop() {
        // Plugin stopped
    }
});
