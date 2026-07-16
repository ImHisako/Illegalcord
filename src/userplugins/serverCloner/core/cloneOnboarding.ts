import { RestAPI } from "@webpack/common";
import { replaceEmojis } from "../utils/helpers";
import { updateWithTime } from "../utils/notifications";
import { throwIfCancelled, state } from "../store";
import { handleCloneError } from "../utils/errorHandler";
import { CloneContext } from "./types";

export async function cloneOnboarding(ctx: CloneContext) {
    const { sourceGuild, newGuildId, channelIdMap, roleIdMap, taskQueue, onboardingProgressStart } = ctx;

    try {
        updateWithTime(`Cloning onboarding settings...`, onboardingProgressStart);

        const onboardingResp = await RestAPI.get({ url: `/guilds/${sourceGuild.id}/onboarding` });
        const onboarding = (onboardingResp as any).body;

        if (onboarding) {
            let sfI = 0;
            const genId = (existingId?: string) => existingId || ((BigInt(Date.now()) - 1420070400000n) << 22n | BigInt(sfI++)).toString();

            const filteredOptions: string[] = [];

            const mappedPrompts = (onboarding.prompts || [])
                .map((prompt: any) => ({
                    id: genId(prompt.id),
                    title: replaceEmojis(prompt.title) || "Prompt",
                    type: prompt.type || 0,
                    required: prompt.required || false,
                    single_select: prompt.single_select || false,
                    in_onboarding: prompt.in_onboarding || false,
                    options: (prompt.options || [])
                        .map((opt: any) => {
                            const mappedOpt: any = {
                                id: genId(opt.id),
                                title: replaceEmojis(opt.title) || "Option",
                                role_ids: (opt.role_ids || [])
                                    .map((id: string) => roleIdMap[id])
                                    .filter(Boolean),
                                channel_ids: (opt.channel_ids || [])
                                    .map((id: string) => channelIdMap[id])
                                    .filter(Boolean)
                             };
                             if (opt.description) mappedOpt.description = replaceEmojis(opt.description);
                             const origEmojiId = opt.emoji_id || opt.emoji?.id || null;
                             const origEmojiName = opt.emoji_name || opt.emoji?.name || null;
                             const origEmojiAnimated = opt.emoji_animated || opt.emoji?.animated || false;

                             if (origEmojiId && state.emojiIdMap[origEmojiId]) {
                                 mappedOpt.emoji_id = state.emojiIdMap[origEmojiId];
                                 mappedOpt.emoji_name = origEmojiName;
                                 mappedOpt.emoji_animated = origEmojiAnimated;
                             } else if (origEmojiId) {
                                 mappedOpt.emoji_id = null;
                                 mappedOpt.emoji_name = null;
                                 mappedOpt.emoji_animated = false;
                             } else {
                                 mappedOpt.emoji_id = null;
                                 mappedOpt.emoji_name = origEmojiName;
                                 mappedOpt.emoji_animated = origEmojiAnimated;
                             }

                             return mappedOpt;
                         })
                         .filter((opt: any) => {
                             const keep = opt.role_ids.length > 0 || opt.channel_ids.length > 0;
                             if (!keep) filteredOptions.push(opt.title);
                             return keep;
                         })
                }))
                .filter((prompt: any) => prompt.options.length > 0);

            if (filteredOptions.length > 0) {
                console.log(`[ServerCloner] Filtered out ${filteredOptions.length} onboarding options due to missing roles/channels:`, filteredOptions);
            }

            const mappedDefaultChannels = (onboarding.default_channel_ids || [])
                .map((id: string) => channelIdMap[id])
                .filter(Boolean);

            const doOnboardingPut = async (enabled: boolean) => {
                await RestAPI.put({
                    url: `/guilds/${newGuildId}/onboarding`,
                    body: {
                        prompts: mappedPrompts,
                        default_channel_ids: mappedDefaultChannels,
                        enabled: enabled,
                        mode: onboarding.mode || 0
                    }
                });
            };

            await taskQueue.execute(async () => {
                try {
                    await doOnboardingPut(onboarding.enabled);
                } catch (err: any) {
                    console.log("[ServerCloner] Onboarding requirements check failed. Attempting auto-fix and fallback...", err.body || err.text);

                    let fixedAny = false;
                    if (err.body?.code === 50035 && err.body?.errors?.default_channel_ids) {
                        const errs = err.body.errors.default_channel_ids;
                        const rootErrors = errs._errors || [];
                        const hasRootPermissionError = rootErrors.some((e: any) =>
                            e.code === "DEFAULT_CHANNEL_REQUIRES_EVERYONE_ACCESS" ||
                            e.code === "ONBOARDING_DEFAULT_CHANNEL_NOT_EVERYONE" ||
                            (typeof e.message === "string" && e.message.includes("Default channel requires @everyone access"))
                        );

                        const channelsToFix = new Set<string>();

                        if (hasRootPermissionError) {
                            for (const id of mappedDefaultChannels) {
                                channelsToFix.add(id);
                            }
                        } else {
                            const badIndices = Object.keys(errs).filter(k => k !== "_errors");
                            for (const idxStr of badIndices) {
                                const channelId = mappedDefaultChannels[parseInt(idxStr, 10)];
                                if (channelId) channelsToFix.add(channelId);
                            }
                        }

                        for (const channelId of channelsToFix) {
                            console.log(`[ServerCloner] Auto-fixing @everyone permission for default channel ${channelId}`);
                            try {
                                await taskQueue.execute(async () => {
                                    await RestAPI.put({
                                        url: `/channels/${channelId}/permissions/${newGuildId}`,
                                        body: {
                                            type: 0,
                                            allow: "1024",
                                            deny: "0"
                                        }
                                    });
                                });
                                fixedAny = true;
                            } catch (fixErr) {
                                console.warn(`[ServerCloner] Failed to auto-fix permission for ${channelId}:`, fixErr);
                            }
                        }
                    }

                    if (fixedAny) {
                        try {
                            console.log("[ServerCloner] Retrying onboarding after fixing permissions...");
                            return await doOnboardingPut(onboarding.enabled);
                        } catch (retryErr: any) {
                            console.warn("[ServerCloner] Retry onboarding failed:", retryErr.body || retryErr.text);
                            err = retryErr;
                        }
                    }

                    if (onboarding.enabled) {
                        console.log("[ServerCloner] Onboarding requirements still not met. Retrying with enabled: false (prompts will still be cloned).");
                        try {
                            await doOnboardingPut(false);
                        } catch (err2: any) {
                            console.error("[ServerCloner] Onboarding fallback failed:", err2.body || err2.text);
                            throw err2;
                        }
                    } else {
                        throw err;
                    }
                }
            });
        }

    } catch (e) {
        handleCloneError("Onboarding", e);
    }
}