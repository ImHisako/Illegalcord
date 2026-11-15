/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function isValidProxyValue(value: unknown, allowEmpty: boolean): value is string {
    return typeof value === "string" && value.length <= 4096 && (allowEmpty || Boolean(value.trim())) && !/[\r\n\0@]/.test(value);
}

export function getHttpProxyEndpoint(rules: unknown): URL | null {
    if (!isValidProxyValue(rules, false)) return null;
    const value = rules.trim();
    if (!/^(?:https?:\/\/)?(?:\[[\da-f:.]+\]|[^:/\s,;=@?#\\%]+)(?::\d{1,5})?\/?$/i.test(value)) return null;
    const url = value.includes("://") ? value : `http://${value}`;
    if (!URL.canParse(url)) return null;
    const endpoint = new URL(url);
    return endpoint.port === "0" ? null : endpoint;
}
