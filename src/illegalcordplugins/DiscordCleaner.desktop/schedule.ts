/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const ON_CREATION = -1;

export const frequencies = [
    { label: "Manual only", value: 0, default: true },
    { label: "As soon as files are created", value: ON_CREATION },
    { label: "Every minute", value: 1 },
    { label: "Every 5 minutes", value: 5 },
    { label: "Every 15 minutes", value: 15 },
    { label: "Every 30 minutes", value: 30 },
    { label: "Every hour", value: 60 },
    { label: "Every 6 hours", value: 360 },
    { label: "Every 24 hours", value: 1440 },
];
