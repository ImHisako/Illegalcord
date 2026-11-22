/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, Tooltip } from "@webpack/common";

import { getHealthVersion, HEALTH_PARTS, HealthSummary, subscribeHealth, summarizeHealth } from "../health";
import { T } from "../i18n";
import { cl } from "../utils";

export function useHealth(): HealthSummary {
    React.useSyncExternalStore(subscribeHealth, getHealthVersion);
    return summarizeHealth();
}

export function HealthBadge() {
    const health = useHealth();
    const tone = health.swapBroken ? "broken" : health.broken.length > 0 ? "partial" : "ok";
    const label = health.swapBroken
        ? T.healthBroken
        : health.broken.length > 0 ? T.healthPartial(health.broken.length, health.total) : T.healthOk;

    const lines = HEALTH_PARTS.map(part => `${health.broken.includes(part) ? "✗" : "✓"} ${T.healthPart[part]}`);

    return (
        <Tooltip text={<div className={cl("health-list")}>{lines.map(line => <div key={line}>{line}</div>)}</div>}>
            {({ onMouseEnter, onMouseLeave }) => (
                <span className={cl("health", `health-${tone}`)} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
                    <span className={cl("health-dot")} />
                    {label}
                </span>
            )}
        </Tooltip>
    );
}
