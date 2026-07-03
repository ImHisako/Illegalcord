/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { filters, find } from "@webpack";

const logger = new Logger("NSFWGateBypass");
let intervalId: ReturnType<typeof setInterval> | undefined;

export default definePlugin({
    name: "NSFWGateBypass",
    description: "Forces 'Verified Adult' status, unlocks Stages, and clears all invite blocks.",
    tags: ["Privacy", "Servers"],
    authors: [
        {
            name: "dxrx99",
            id: 1463629522359423152n
        },
        {
            name: "omaw",
            id: 1474576133088481351n
        }
    ],

    patches: [
        {
            find: "#{intl::AGE_GATE_AGE_VERIFIED}",
            replacement: {
                match: /return (\i)\.ageVerified\b/,
                replace: "return ($1.ageVerified,true)",
            },
        },
        {
            find: "#{intl::AGE_GATE_NSFW_BODY}",
            replacement: {
                match: /if\s*\((\i\.isNSFW\b[^)]{0,60})\)/,
                replace: "if(($1,false))",
            },
        },
        {
            find: "useAgeGateVerifyContentForGuild",
            replacement: {
                match: /null==(\i)\.nsfwAllowed/,
                replace: "false",
            },
        },
        {
            find: "#{intl::AGE_GATE_NSFW_BODY}",
            replacement: {
                match: /(\i)\.nsfwLevel\s*>=\s*(\i)\b/,
                replace: "$1.nsfwLevel>=($2,Infinity)",
            },
        },
        {
            find: "#{intl::AGE_GATE_FAMILY_CENTER_BODY}",
            replacement: {
                match: /(\i)\.isFamilyCenterEnabled\b/,
                replace: "($1.isFamilyCenterEnabled,false)",
            },
        },

    ],

    start() {
        const safeFindByProps = (...props: string[]) =>
            find(filters.byProps(...props), { isIndirect: true }) as Record<string, any> | null;

        const UserStore = safeFindByProps("getCurrentUser");
        const InviteStore = safeFindByProps("getInvite", "resolveInvite");
        const StageStore = safeFindByProps("isStageSpeakerAllowed");

        const applyMasterMask = () => {
            const user = UserStore?.getCurrentUser();
            if (!user) return;

            const adultDOB = "1997-11-24";

            try {
                Object.defineProperties(user, {
                    date_of_birth: { get: () => adultDOB, configurable: true },
                    ageGroup: { get: () => 1, configurable: true },
                    ageVerificationStatus: { get: () => 3, configurable: true },
                    age_gate_done: { get: () => true, configurable: true },
                    underage: { get: () => false, configurable: true },
                    nsfwAllowed: { get: () => true, configurable: true },
                    guild_nsfw_allowed: { get: () => true, configurable: true }
                });
            } catch (error) {
                logger.warn("Failed to modify user properties", error);
            }

            if (typeof user.flags === "number") {
                user.flags |= 2;
                user.flags |= (1 << 18);
            }
        };

        applyMasterMask();
        intervalId = setInterval(applyMasterMask, 500);

        if (StageStore) {
            StageStore.isStageSpeakerAllowed = () => true;
            StageStore.getStageSpeakerVerificationStatus = () => ({ verified: true });
        }

        if (InviteStore) {
            const originalGetInvite = InviteStore.getInvite;
            InviteStore.getInvite = function(...args: any[]) {
                const invite = originalGetInvite.apply(this, args);
                if (invite) {
                    invite.is_minimum_age_verified = true;
                    invite.state = "RESOLVED";
                    if (invite.guild) {
                        invite.guild.nsfw = false;
                        invite.guild.nsfw_level = 0;
                    }
                }
                return invite;
            };
        }

        const ChannelNSFW = safeFindByProps("isNSFW");
        if (ChannelNSFW) {
            ChannelNSFW.isNSFW = () => false;
        }
    },

    stop() {
        if (intervalId !== undefined) {
            clearInterval(intervalId);
            intervalId = undefined;
        }
    }
});
