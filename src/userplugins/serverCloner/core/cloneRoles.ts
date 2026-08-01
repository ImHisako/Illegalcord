/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findByPropsLazy } from "@webpack";
import { GuildStore, IconUtils, RestAPI } from "@webpack/common";

import { state } from "../store";
import { checkGuildExistence, fetchGuildRoles } from "../utils/api";
import { handleCloneError } from "../utils/errorHandler";
import { arrayBufferToBase64, isRecord, replaceEmojis } from "../utils/helpers";
import { updateWithTime } from "../utils/notifications";
import { CloneContext, CloneEmoji, CloneRole, OnboardingData } from "./types";

const RoleIconUtils: { getRoleIconURL(data: { id: string; icon: string; size: number; }): string; } = findByPropsLazy("getRoleIconURL");
const MAX_EMOJI_BYTES = 1024 * 1024;

interface CreatedResponse {
    body?: { id?: unknown; };
}

function responseBody<T>(response: { body?: T; }): T | undefined {
    return response.body;
}

function errorCode(error: unknown): number | undefined {
    if (!isRecord(error)) return undefined;
    if (typeof error.code === "number") return error.code;
    if (isRecord(error.body) && typeof error.body.code === "number") return error.body.code;
    return undefined;
}

function isRateLimitExhausted(error: unknown): boolean {
    return isRecord(error) && error.rateLimitExhausted === true;
}

async function fetchImageDataUrl(url: string, mimeType: string): Promise<string> {
    const response = await fetch(url, { signal: state.abortController?.signal });
    if (!response.ok) throw new Error(`Discord CDN returned ${response.status}`);
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_EMOJI_BYTES) throw new Error("The image is too large to clone");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_EMOJI_BYTES) throw new Error("The image is too large to clone");
    return `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`;
}

export async function extractAndCloneEmojis(context: CloneContext): Promise<void> {
    const { sourceGuild, fullGuildData, options, estimateRoles, estimateChannels, newGuildId, assetQueue } = context;
    const customEmojiIds = new Set<string>();
    const addEmojisFromText = (text: string | null | undefined): void => {
        if (!text) return;
        for (const match of text.matchAll(/<a?:[a-zA-Z0-9_]+:(\d+)>/g)) customEmojiIds.add(match[1]);
    };

    addEmojisFromText(fullGuildData.description);
    if (options.cloneRoles) estimateRoles.forEach(role => addEmojisFromText(role.name));
    if (options.cloneChannels) {
        for (const channel of estimateChannels) {
            addEmojisFromText(channel.name);
            addEmojisFromText(channel.topic);
            channel.available_tags?.forEach(tag => {
                addEmojisFromText(tag.name);
                if (tag.emoji_id) customEmojiIds.add(tag.emoji_id);
            });
            if (channel.default_reaction_emoji?.emoji_id) customEmojiIds.add(channel.default_reaction_emoji.emoji_id);
        }
    }

    if (options.cloneOnboarding) {
        try {
            const response: { body?: OnboardingData; } = await RestAPI.get({ url: `/guilds/${sourceGuild.id}/onboarding` });
            response.body?.prompts?.forEach(prompt => {
                addEmojisFromText(prompt.title);
                prompt.options?.forEach(option => {
                    addEmojisFromText(option.title);
                    addEmojisFromText(option.description);
                    const id = option.emoji_id ?? option.emoji?.id;
                    if (id) customEmojiIds.add(id);
                });
            });
        } catch (error: unknown) {
            handleCloneError("Onboarding emoji scan", error);
        }
    }

    if (customEmojiIds.size === 0) return;

    const sourceResponse: { body?: CloneEmoji[]; } = await RestAPI.get({ url: `/guilds/${sourceGuild.id}/emojis` });
    const sourceEmojis = responseBody(sourceResponse) ?? [];
    const emojisToClone = sourceEmojis.filter(emoji => customEmojiIds.has(emoji.id));
    let targetEmojis: CloneEmoji[] = [];
    if (options.resumeMode) {
        const targetResponse: { body?: CloneEmoji[]; } = await RestAPI.get({ url: `/guilds/${newGuildId}/emojis` });
        targetEmojis = responseBody(targetResponse) ?? [];
    }

    let completed = 0;
    await Promise.all(emojisToClone.map(async emoji => {
        if (!state.isCloning) return;

        const existing = options.resumeMode ? targetEmojis.find(target => target.name === emoji.name) : undefined;
        if (existing) {
            state.emojiIdMap[emoji.id] = existing.id;
            completed++;
            return;
        }

        try {
            const image = await fetchImageDataUrl(
                IconUtils.getEmojiURL({ id: emoji.id, animated: emoji.animated === true, size: 256 }),
                emoji.animated ? "image/gif" : "image/png"
            );
            const createResponse: CreatedResponse = await assetQueue.execute(() => RestAPI.post({
                url: `/guilds/${newGuildId}/emojis`,
                body: { name: emoji.name, image, roles: [] }
            }));
            if (typeof createResponse.body?.id !== "string") throw new Error("Discord did not return the new emoji ID");
            state.emojiIdMap[emoji.id] = createResponse.body.id;
            completed++;
            updateWithTime(`Cloned emoji ${completed}/${emojisToClone.length}: ${emoji.name}`, 20);
        } catch (error: unknown) {
            handleCloneError("Emoji", error, emoji.name);
        }
    }));
}

function sameRole(source: CloneRole, target: CloneRole): boolean {
    return source.name === target.name
        && source.color === target.color
        && source.permissions.toString() === target.permissions.toString()
        && source.hoist === target.hoist
        && source.mentionable === target.mentionable;
}

export async function cloneRoles(context: CloneContext): Promise<number> {
    const { sourceGuild, newGuildId, options, estimateRoles, rolesProgressStart, rolesProgressEnd, roleQueue, roleIdMap } = context;
    const sortedRoles = estimateRoles.filter(role => role.name !== "@everyone" && !role.managed).sort((a, b) => b.position - a.position);
    const everyoneRole = estimateRoles.find(role => role.name === "@everyone");
    const existingTargetRoles = await fetchGuildRoles(newGuildId);
    const targetEveryoneRole = existingTargetRoles.find(role => role.name === "@everyone");
    const usedTargetRoleIds = new Set<string>();

    if (everyoneRole && targetEveryoneRole) {
        roleIdMap[everyoneRole.id] = targetEveryoneRole.id;
        try {
            await RestAPI.patch({
                url: `/guilds/${newGuildId}/roles/${targetEveryoneRole.id}`,
                body: { permissions: everyoneRole.permissions.toString() }
            });
        } catch (error: unknown) {
            handleCloneError("Role", error, "@everyone");
        }
    }

    if (options.resumeMode) {
        for (const role of sortedRoles) {
            const match = existingTargetRoles.find(target =>
                target.name !== "@everyone" && !usedTargetRoleIds.has(target.id) && sameRole(role, target)
            );
            if (!match) continue;
            roleIdMap[role.id] = match.id;
            usedTargetRoleIds.add(match.id);
        }
    }

    const rolesToCreate = sortedRoles.filter(role => !roleIdMap[role.id]);
    const canUseRoleIcons = (GuildStore.getGuild(newGuildId)?.premiumTier ?? 0) >= 2;
    let rolesFailed = 0;
    let rolesCreated = 0;
    let skipRemaining = false;

    await Promise.all(rolesToCreate.map(async role => {
        if (!state.isCloning || skipRemaining) return;

        try {
            checkGuildExistence(sourceGuild.id, newGuildId);
            const body: Record<string, unknown> = {
                color: role.color,
                hoist: role.hoist,
                mentionable: role.mentionable,
                name: replaceEmojis(role.name),
                permissions: role.permissions.toString()
            };

            if (canUseRoleIcons) {
                body.unicode_emoji = role.unicodeEmoji ?? role.unicode_emoji ?? null;
                if (role.icon) {
                    body.icon = await fetchImageDataUrl(
                        RoleIconUtils.getRoleIconURL({ id: role.id, icon: role.icon, size: 128 }),
                        "image/png"
                    );
                }
            }

            const response: CreatedResponse = await roleQueue.execute(async () => {
                try {
                    return await RestAPI.post({ url: `/guilds/${newGuildId}/roles`, body });
                } catch (error: unknown) {
                    if (errorCode(error) !== 50101) throw error;
                    delete body.icon;
                    delete body.unicode_emoji;
                    return RestAPI.post({ url: `/guilds/${newGuildId}/roles`, body });
                }
            }, message => updateWithTime(message, rolesProgressStart), undefined, 5);

            if (typeof response.body?.id !== "string") throw new Error("Discord did not return the new role ID");
            roleIdMap[role.id] = response.body.id;
            rolesCreated++;
            const progress = rolesProgressStart + rolesCreated / Math.max(rolesToCreate.length, 1) * (rolesProgressEnd - rolesProgressStart);
            updateWithTime(`Cloned role ${rolesCreated}/${rolesToCreate.length}: ${role.name}`, progress);
        } catch (error: unknown) {
            if (isRateLimitExhausted(error)) {
                rolesFailed += rolesToCreate.length - rolesCreated;
                skipRemaining = true;
                return;
            }
            rolesFailed++;
            handleCloneError("Role", error, role.name);
        }
    }));

    const positionUpdates = estimateRoles
        .filter(role => role.name !== "@everyone" && roleIdMap[role.id])
        .map(role => ({ id: roleIdMap[role.id], position: role.position }));
    if (positionUpdates.length > 0) {
        try {
            await roleQueue.execute(() => RestAPI.patch({ url: `/guilds/${newGuildId}/roles`, body: positionUpdates }));
        } catch (error: unknown) {
            handleCloneError("Role positions", error);
        }
    }

    return rolesFailed;
}
