/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { React } from "@webpack/common";

import { getRequestRuleDecision, getRequestRuleTarget, type RequestRuleDecision, type RequestRuleSettings } from "./network";

interface RequestRuleActionsProps {
    url: string;
    rules: RequestRuleSettings;
    onChange: (target: string, decision: RequestRuleDecision) => void;
}

export function RequestRuleActions({ url, rules, onChange }: RequestRuleActionsProps) {
    const target = getRequestRuleTarget(url);
    if (!target) return null;
    const decision = getRequestRuleDecision(target, rules);
    return <div className="vc-discord-hardened-toolbar">
        <span>Rule: {decision === "Block" ? "Blocked" : decision === "Allow" ? "Allowed" : "Default filters"}</span>
        <Button size="small" variant="dangerPrimary" disabled={decision === "Block"} onClick={() => onChange(target, "Block")}>Block request</Button>
        <Button size="small" variant="secondary" disabled={decision === "Allow"} onClick={() => onChange(target, "Allow")}>Allow request</Button>
        {decision ? <Button size="small" variant="secondary" onClick={() => onChange(target, null)}>Reset rule</Button> : null}
    </div>;
}
