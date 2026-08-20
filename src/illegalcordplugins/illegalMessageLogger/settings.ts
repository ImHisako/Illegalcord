/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    hideFromToolbox: {
        type: OptionType.BOOLEAN,
        description: "Hide this plugin from Equicord Toolbox.",
        default: true
    },
    showHeaderButton: {
        type: OptionType.BOOLEAN,
        description: "Show a message log button in the channel header.",
        default: true
    },
    saveDeletes: {
        type: OptionType.BOOLEAN,
        description: "Save deleted messages.",
        default: true
    },
    saveEdits: {
        type: OptionType.BOOLEAN,
        description: "Save edited messages and their history.",
        default: true
    },
    saveGhostPings: {
        type: OptionType.BOOLEAN,
        description: "Save deleted messages that mentioned you as ghost pings.",
        default: true
    },
    notifyGhostPings: {
        type: OptionType.BOOLEAN,
        description: "Show a notification when a ghost ping is captured.",
        default: true
    },
    maxEditHistory: {
        type: OptionType.NUMBER,
        description: "Maximum saved revisions per message. Set to 0 for no limit.",
        default: 50,
        isValid: (value: number) => value >= 0 ? true : "The edit history limit cannot be negative."
    },
    memoryCacheLimit: {
        type: OptionType.NUMBER,
        description: "Maximum number of recent messages kept in memory.",
        default: 2000,
        isValid: (value: number) => value >= 100 ? true : "The memory cache limit must be at least 100."
    },
    batchDelayMs: {
        type: OptionType.NUMBER,
        description: "Delay used to group database writes into one transaction.",
        default: 250,
        isValid: (value: number) => value >= 50 && value <= 5000 ? true : "The batch delay must be between 50 and 5000 milliseconds."
    },
    messageLimit: {
        type: OptionType.NUMBER,
        description: "Maximum number of persistent logs. Set to 0 for no limit.",
        default: 5000,
        isValid: (value: number) => value >= 0 ? true : "The message limit cannot be negative."
    },
    retentionDays: {
        type: OptionType.NUMBER,
        description: "Remove logs older than this many days. Set to 0 to keep them indefinitely.",
        default: 0,
        isValid: (value: number) => value >= 0 ? true : "Retention days cannot be negative."
    },
    preserveCurrentChannel: {
        type: OptionType.BOOLEAN,
        description: "Keep the current channel when applying time-based retention.",
        default: true
    },
    maintenanceIntervalMinutes: {
        type: OptionType.NUMBER,
        description: "Minutes between batched database maintenance runs.",
        default: 10,
        isValid: (value: number) => value >= 1 ? true : "The maintenance interval must be at least one minute."
    },
    pageSize: {
        type: OptionType.NUMBER,
        description: "Number of logs loaded on each page.",
        default: 100,
        isValid: (value: number) => value >= 20 && value <= 500 ? true : "The page size must be between 20 and 500."
    },
    replaceOnImport: {
        type: OptionType.BOOLEAN,
        description: "Clear unprotected logs before importing a backup.",
        default: false
    }
});
