/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { EquicordDevs } from "@utils/constants";
import definePlugin, { OptionType, StartAt } from "@utils/types";
import { useEffect, useState } from "@webpack/common";

const Level = {
    Debug: "debug",
    Info: "info",
    Warn: "warn"
} as const;

type Level = typeof Level[keyof typeof Level];

interface CleanerStats {
    allowed: number;
    categoryFiltered: number;
    duplicates: number;
    levelFiltered: number;
}

const LEVEL_PRIORITY: Record<string, number> = {
    debug: 0,
    verbose: 0,
    trace: 0,
    info: 1,
    log: 1,
    warn: 2,
    warning: 2,
    error: 3
};
const MAX_RECENT_LOGS = 1000;
const STATS_REFRESH_MS = 1000;
const recentLogs = new Map<string, number>();
const stats: CleanerStats = {
    allowed: 0,
    categoryFiltered: 0,
    duplicates: 0,
    levelFiltered: 0
};
const statItems = [
    { label: "Allowed", value: "allowed" },
    { label: "Filtered by level", value: "levelFiltered" },
    { label: "Filtered by category", value: "categoryFiltered" },
    { label: "Duplicates", value: "duplicates" }
] as const satisfies readonly { label: string; value: keyof CleanerStats; }[];

let allowedLoggerPatterns: string[] = [];
let mutedLoggerPatterns: string[] = [];

const settings = definePluginSettings({
    minimumLevel: {
        type: OptionType.SELECT,
        description: "Choose the lowest Discord log level shown in DevTools.",
        options: [
            { label: "Debug", value: Level.Debug },
            { label: "Info", value: Level.Info },
            { label: "Warnings and errors", value: Level.Warn, default: true }
        ] as const
    },
    allowedLoggers: {
        type: OptionType.STRING,
        description: "Always show matching logger names. Separate entries with semicolons or new lines.",
        default: "",
        multiline: true,
        onChange: value => allowedLoggerPatterns = parsePatterns(value)
    },
    mutedLoggers: {
        type: OptionType.STRING,
        description: "Hide matching logger names below warning level. Separate entries with semicolons or new lines.",
        default: "Spotify",
        multiline: true,
        onChange: value => mutedLoggerPatterns = parsePatterns(value)
    },
    deduplicate: {
        type: OptionType.BOOLEAN,
        description: "Hide repeated Discord logs within a short interval.",
        default: true,
        onChange: enabled => {
            if (!enabled) recentLogs.clear();
        }
    },
    duplicateWindow: {
        type: OptionType.SLIDER,
        description: "Choose how long identical Discord logs are considered duplicates.",
        markers: [250, 500, 1000, 2000, 5000],
        default: 1000,
        stickToMarkers: true
    },
    statsPanel: {
        type: OptionType.COMPONENT,
        component: ErrorBoundary.wrap(StatsPanel, { noop: true })
    }
});

export default definePlugin({
    name: "ConsoleCleaner",
    description: "Filters noisy Discord logs and deduplicates repeated messages without replacing console methods.",
    authors: [EquicordDevs.irritably],
    tags: ["Developers", "Console", "Utility"],
    settings,
    startAt: StartAt.Init,

    patches: [
        {
            find: '"file-only"!==',
            replacement: {
                match: /(?<=&&)(?=console)/,
                replace: "$self.shouldLog(...arguments)&&"
            }
        }
    ],

    start() {
        allowedLoggerPatterns = parsePatterns(settings.store.allowedLoggers);
        mutedLoggerPatterns = parsePatterns(settings.store.mutedLoggers);
        resetStats();
    },

    stop() {
        recentLogs.clear();
        allowedLoggerPatterns = [];
        mutedLoggerPatterns = [];
    },

    shouldLog(logger: unknown, level: unknown, ...args: unknown[]) {
        if (typeof logger !== "string" || typeof level !== "string") {
            stats.allowed++;
            return true;
        }

        if (level === "error" || level === "warn" || level === "warning") {
            stats.allowed++;
            return true;
        }

        const loggerName = logger.toLowerCase();
        if (allowedLoggerPatterns.some(pattern => loggerName.includes(pattern))) {
            stats.allowed++;
            return true;
        }

        if (mutedLoggerPatterns.some(pattern => loggerName.includes(pattern))) {
            stats.categoryFiltered++;
            return false;
        }

        const priority = LEVEL_PRIORITY[level];
        const minimumLevel = settings.store.minimumLevel ?? Level.Warn;
        if (priority !== undefined && priority < LEVEL_PRIORITY[minimumLevel]) {
            stats.levelFiltered++;
            return false;
        }

        if (settings.store.deduplicate && isDuplicate(loggerName, level, args)) {
            stats.duplicates++;
            return false;
        }

        stats.allowed++;
        return true;
    }
});

function StatsPanel() {
    const [open, setOpen] = useState(false);
    const [snapshot, setSnapshot] = useState({ ...stats });

    useEffect(() => {
        if (!open) return;

        const interval = setInterval(() => setSnapshot({ ...stats }), STATS_REFRESH_MS);
        return () => clearInterval(interval);
    }, [open]);

    return (
        <Card variant="primary">
            <Flex flexDirection="column" gap="12px">
                <Flex justifyContent="space-between" alignItems="center" gap="12px">
                    <BaseText size="md" weight="semibold">ConsoleCleaner stats</BaseText>
                    <Flex gap="8px">
                        {open && (
                            <Button
                                size="small"
                                variant="secondary"
                                onClick={() => {
                                    resetStats();
                                    setSnapshot({ ...stats });
                                }}
                            >
                                Reset
                            </Button>
                        )}
                        <Button
                            size="small"
                            variant="secondary"
                            onClick={() => {
                                setSnapshot({ ...stats });
                                setOpen(value => !value);
                            }}
                        >
                            {open ? "Hide" : "Show"}
                        </Button>
                    </Flex>
                </Flex>
                {open && statItems.map(({ label, value }) => (
                    <Flex key={value} justifyContent="space-between" gap="12px">
                        <BaseText size="sm" color="text-muted">{label}</BaseText>
                        <BaseText size="sm" weight="semibold" tabularNumbers>{snapshot[value]}</BaseText>
                    </Flex>
                ))}
            </Flex>
        </Card>
    );
}

function parsePatterns(value: string) {
    return value
        .split(/[;\n]/)
        .map(pattern => pattern.trim().toLowerCase())
        .filter(Boolean);
}

function isDuplicate(logger: string, level: string, args: readonly unknown[]) {
    const message = findMessage(args);
    if (!message) return false;

    const key = `${logger}\0${level}\0${message}`;
    const now = Date.now();
    const previous = recentLogs.get(key);

    recentLogs.delete(key);
    recentLogs.set(key, now);

    if (recentLogs.size > MAX_RECENT_LOGS) {
        const oldest = recentLogs.keys().next().value;
        if (oldest) recentLogs.delete(oldest);
    }

    return previous !== undefined && now - previous < settings.store.duplicateWindow;
}

function findMessage(args: readonly unknown[]) {
    for (const value of args) {
        if (typeof value === "string") return value;
        if (!Array.isArray(value)) continue;

        const message = value.find(item => typeof item === "string");
        if (typeof message === "string") return message;
    }

    return undefined;
}

function resetStats() {
    for (const key of Object.keys(stats) as (keyof CleanerStats)[]) {
        stats[key] = 0;
    }

    recentLogs.clear();
}
