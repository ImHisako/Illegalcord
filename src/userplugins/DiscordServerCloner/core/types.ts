/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Guild } from "@vencord/discord-types";

import { CloneOptions } from "../types";
import { TaskQueue } from "../utils/TaskQueue";

export interface CloneContext {
    sourceGuild: Guild;
    fullGuildData: any;
    newGuildId: string;
    options: CloneOptions;
    roleIdMap: Record<string, string>;
    channelIdMap: Record<string, string>;
    taskQueue: TaskQueue;
    estimateChannels: any[];
    estimateRoles: any[];
    rolesProgressStart: number;
    rolesProgressEnd: number;
    channelsProgressStart: number;
    channelsProgressEnd: number;
    settingsProgressEnd: number;
    onboardingProgressStart: number;
}
