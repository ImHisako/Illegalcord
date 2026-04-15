import { Guild } from "@vencord/discord-types";
import { CloneOptions } from "../types";
import { RateLimiter } from "../utils/rateLimiter";

export interface CloneContext {
    sourceGuild: Guild;
    fullGuildData: any;
    newGuildId: string;
    options: CloneOptions;
    roleIdMap: Record<string, string>;
    channelIdMap: Record<string, string>;
    roleRateLimiter: RateLimiter;
    channelRateLimiter: RateLimiter;
    estimateChannels: any[];
    estimateRoles: any[];
    rolesProgressStart: number;
    rolesProgressEnd: number;
    channelsProgressStart: number;
    channelsProgressEnd: number;
    settingsProgressEnd: number;
    onboardingProgressStart: number;
}
