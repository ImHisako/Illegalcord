import { RestAPI, GuildStore } from "@webpack/common";
import { replaceEmojis, arrayBufferToBase64, sleep } from "../utils/helpers";
import { checkGuildExistence, fetchGuildRoles } from "../utils/api";
import { updateWithTime } from "../utils/notifications";
import { handleCloneError } from "../utils/errorHandler";
import { state, throwIfCancelled } from "../store";
import { CloneContext } from "./types";

export async function extractAndCloneEmojis(ctx: CloneContext) {
    const { sourceGuild, fullGuildData, options, estimateRoles, estimateChannels, newGuildId } = ctx;
    const customEmojiIds = new Set<string>();

    const addEmojisFromText = (text: string | null | undefined) => {
        if (!text) return;
        const matches = text.matchAll(/<a?:[a-zA-Z0-9_]+:(\d+)>/g);
        for (const match of matches) {
            customEmojiIds.add(match[1]);
        }
    };

    addEmojisFromText(fullGuildData.description);

    if (options.cloneRoles) {
        for (const role of estimateRoles) {
            addEmojisFromText(role.name);
        }
    }

    if (options.cloneChannels) {
        for (const ch of estimateChannels) {
            addEmojisFromText(ch.name);
            addEmojisFromText(ch.topic);
            if (ch.available_tags) {
                for (const tag of ch.available_tags) {
                    addEmojisFromText(tag.name);
                    if (tag.emoji_id) customEmojiIds.add(tag.emoji_id);
                }
            }
            if (ch.default_reaction_emoji?.emoji_id) {
                customEmojiIds.add(ch.default_reaction_emoji.emoji_id);
            }
        }
    }

    if (options.cloneOnboarding) {
        try {
            const onboardingResp = await RestAPI.get({ url: `/guilds/${sourceGuild.id}/onboarding` });
            const onboardingData = (onboardingResp as any).body;
            if (onboardingData) {
                for (const prompt of (onboardingData.prompts || [])) {
                    addEmojisFromText(prompt.title);
                    for (const opt of (prompt.options || [])) {
                        addEmojisFromText(opt.title);
                        addEmojisFromText(opt.description);
                        const eid = opt.emoji_id || opt.emoji?.id || null;
                        if (eid) customEmojiIds.add(eid);
                    }
                }
            }
        } catch (e) { }
    }

    if (customEmojiIds.size > 0) {
        updateWithTime(`Cloning ${customEmojiIds.size} used emojis...`, 20);

        try {
            const sourceEmojisResp = await RestAPI.get({ url: `/guilds/${sourceGuild.id}/emojis` });
            const sourceEmojis = (sourceEmojisResp as any).body || [];
            const emojisToClone = sourceEmojis.filter((e: any) => customEmojiIds.has(e.id));

            let targetEmojis: any[] = [];
            if (options.resumeMode && newGuildId) {
                try {
                    const targetEmojisResp = await RestAPI.get({ url: `/guilds/${newGuildId}/emojis` });
                    targetEmojis = (targetEmojisResp as any).body || [];
                } catch (e) {
                    console.warn("[ServerCloner] Failed to fetch target emojis for resume mode:", e);
                }
            }

            let emojiStep = 0;
            for (const emoji of emojisToClone) {
                if (!state.isCloning) break;
                emojiStep++;

                if (options.resumeMode) {
                    const existing = targetEmojis.find(e => e.name === emoji.name);
                    if (existing) {
                        state.emojiIdMap[emoji.id] = existing.id;
                        updateWithTime(`Skipping existing emoji (${emojiStep}/${emojisToClone.length})...`, 20 + (emojiStep / emojisToClone.length) * 5);
                        continue;
                    }
                }

                updateWithTime(`Cloning used emojis (${emojiStep}/${emojisToClone.length})...`, 20 + (emojiStep / emojisToClone.length) * 5);

                try {
                    const ext = emoji.animated ? "gif" : "png";
                    const emojiUrl = `https://cdn.discordapp.com/emojis/${emoji.id}.${ext}?size=256`;
                    const response = await fetch(emojiUrl);
                    if (response.ok) {
                        const buffer = await response.arrayBuffer();
                        const base64 = typeof window !== "undefined"
                            ? btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''))
                            : Buffer.from(buffer).toString('base64');
                        const imageStr = `data:image/${ext};base64,${base64}`;

                        const createResp = await RestAPI.post({
                            url: `/guilds/${newGuildId}/emojis`,
                            body: {
                                name: emoji.name,
                                image: imageStr,
                                roles: []
                            }
                        });
                        if (createResp?.body?.id) {
                            state.emojiIdMap[emoji.id] = createResp.body.id;
                            await sleep(1500);
                        }
                    }
                } catch (e) {
                    handleCloneError("Emoji", e, emoji.name);
                }
            }
        } catch (e) {
            console.warn("[ServerCloner] Failed to fetch source emojis for extraction:", e);
        }
    }
}

export async function cloneRoles(ctx: CloneContext): Promise<number> {
    let rolesFailed = 0;
    const { sourceGuild, newGuildId, options, estimateRoles, rolesProgressStart, rolesProgressEnd, roleRateLimiter, roleIdMap } = ctx;
    
    let skipRoles = false;
    if (state.mainProgressNotificationId) {
        const skipBtn = document.getElementById(state.mainProgressNotificationId)?.querySelector(".cloner-skip-roles-btn") as HTMLElement;
        if (skipBtn) skipBtn.style.display = "";
        
        // Hijack the skip callback to work inside this function context
        const ogSkip = state.skipRolesCallback;
        state.skipRolesCallback = () => {
            skipRoles = true;
            if (ogSkip) ogSkip();
        };
    }

    const sortedRoles = estimateRoles.filter(r => r.name !== "@everyone").sort((a, b) => b.position - a.position);
    const everyoneRole = estimateRoles.find(r => r.name === "@everyone");

    const newRoles = await RestAPI.get({ url: `/guilds/${newGuildId}/roles` });
    const existingTargetRoles = newRoles.body || [];
    const newEveryoneRole = existingTargetRoles.find((r: any) => r.name === "@everyone");

    if (everyoneRole && newEveryoneRole) {
        roleIdMap[everyoneRole.id] = newEveryoneRole.id;
        try {
            await RestAPI.patch({
                url: `/guilds/${newGuildId}/roles/${newEveryoneRole.id}`,
                body: { permissions: everyoneRole.permissions.toString() }
            });
        } catch (e) {
            console.warn("[ServerCloner] Failed to update @everyone role:", e);
        }
    }

    if (options.resumeMode) {
        for (const role of sortedRoles) {
            const match = existingTargetRoles.find((r: any) => r.name === role.name && r.name !== "@everyone");
            if (match) {
                roleIdMap[role.id] = match.id;
                const expectedName = replaceEmojis(role.name) || role.name;
                if (match.name !== expectedName) {
                    try {
                        await RestAPI.patch({
                            url: `/guilds/${newGuildId}/roles/${match.id}`,
                            body: { name: expectedName }
                        });
                    } catch (e) {
                        console.warn(`[ServerCloner] Failed to patch existing role emoji: ${role.name}`, e);
                    }
                }
            }
        }
    }

    const rolesToCreate = options.resumeMode ? sortedRoles.filter(r => !roleIdMap[r.id]) : sortedRoles;
    const actionLabel = options.resumeMode ? "Resuming" : "Cloning";

    const targetGuildForTier = GuildStore.getGuild(newGuildId);
    const targetTier = (targetGuildForTier as any)?.premiumTier || 0;
    const canUseRoleIcons = targetTier >= 2;

    let roleStep = 0;
    for (const role of rolesToCreate) {
        if (!state.isCloning) break;
        if (skipRoles) {
            updateWithTime(`Skipping roles...`, rolesProgressEnd);
            break;
        }

        try {
            checkGuildExistence(sourceGuild.id, newGuildId);
            roleStep++;
            updateWithTime(`${actionLabel} role ${roleStep}/${rolesToCreate.length}: ${role.name}`, rolesProgressStart + ((roleStep / Math.max(rolesToCreate.length, 1)) * (rolesProgressEnd - rolesProgressStart)));

            const rolePayload: any = {
                name: replaceEmojis(role.name),
                permissions: role.permissions.toString(),
                color: role.color,
                hoist: role.hoist,
                mentionable: role.mentionable,
            };

            if (canUseRoleIcons) {
                rolePayload.unicode_emoji = (role as any).unicodeEmoji || (role as any).unicode_emoji || null;
                const roleIcon = (role as any).icon;
                if (roleIcon) {
                    try {
                        const iconUrl = `https://cdn.discordapp.com/role-icons/${role.id}/${roleIcon}.png?size=128`;
                        const iconResp = await fetch(iconUrl);
                        if (iconResp.ok) {
                            const iconBuf = await iconResp.arrayBuffer();
                            rolePayload.icon = `data:image/png;base64,${arrayBufferToBase64(iconBuf)}`;
                        }
                    } catch (_) { }
                }
            }

            const response = await roleRateLimiter.execute(async () => {
                try {
                    return await RestAPI.post({ url: `/guilds/${newGuildId}/roles`, body: rolePayload });
                } catch (e: any) {
                    let code = e?.body?.code || e?.code;
                    if (!code && e?.text) {
                        try { code = JSON.parse(e.text)?.code; } catch (_) { }
                    }
                    if (code === 50101) {
                        delete rolePayload.icon;
                        delete rolePayload.unicode_emoji;
                        return await RestAPI.post({ url: `/guilds/${newGuildId}/roles`, body: rolePayload });
                    }
                    throw e;
                }
            }, undefined, () => skipRoles, 5);

            if (response?.body?.id) {
                roleIdMap[role.id] = response.body.id;
            }
        } catch (e: any) {
            if (e?.rateLimitExhausted) {
                rolesFailed += (rolesToCreate.length - roleStep);
                updateWithTime(`Rate limited, skipping remaining roles...`, rolesProgressEnd);
                break;
            }
            rolesFailed++;
            handleCloneError("Role", e, role.name);
        }
    }

    if (options.resumeMode && rolesToCreate.length === 0) {
        updateWithTime(`All roles already exist, skipping...`, rolesProgressEnd);
    }
    
    if (state.mainProgressNotificationId) {
        const skipBtn = document.getElementById(state.mainProgressNotificationId)?.querySelector(".cloner-skip-roles-btn") as HTMLElement;
        if (skipBtn) skipBtn.style.display = "none";
    }

    return rolesFailed;
}
