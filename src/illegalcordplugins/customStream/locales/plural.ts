/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function pluralEn(count: number, one: string, other: string): string {
    return count === 1 ? one : other;
}

const ruRules = (() => {
    try {
        return new Intl.PluralRules("ru-RU");
    } catch {
        return null;
    }
})();

function selectRuManually(count: number): "one" | "few" | "many" {
    const abs = Math.abs(Math.floor(count));
    const lastTwo = abs % 100;
    const last = abs % 10;

    if (lastTwo >= 11 && lastTwo <= 14) return "many";
    if (last === 1) return "one";
    if (last >= 2 && last <= 4) return "few";
    return "many";
}

export function pluralRu(count: number, one: string, few: string, many: string): string {
    const category = ruRules?.select(count) ?? selectRuManually(count);
    if (category === "one") return one;
    if (category === "few") return few;
    return many;
}
