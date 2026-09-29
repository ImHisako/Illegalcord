/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useSettings } from "@api/Settings";
import { Heading } from "@components/Heading";
import { Notice } from "@components/Notice";
import { Paragraph } from "@components/Paragraph";
import { Alerts, Button, Checkbox, React, useState } from "@webpack/common";

import Plugins from "~plugins";

import { cleanConfig, cleanupCandidates, parseConfig } from "./config";
import { type ActionProps, applyConfig, snapshot } from "./utils";

export function Cleanup({ busy, run, canApply }: ActionProps) {
    useSettings();
    const current = parseConfig(snapshot());
    const candidates = cleanupCandidates(current, Plugins);
    const [choices, setChoices] = useState<Record<string, boolean>>({});
    const selected = candidates.filter(candidate => choices[candidate.name] ?? candidate.kind === "removed");

    function clean() {
        const base = snapshot();
        const names = selected.map(candidate => candidate.name);
        Alerts.show({
            title: "Clean plugin configuration",
            body: `Remove saved configuration for ${names.length} selected plugins? A recovery backup will be created first. Disabled plugins will keep their disabled state.`,
            confirmText: "Back up and clean",
            cancelText: "Cancel",
            onConfirm: () => void run(async () => {
                const cleaned = cleanConfig(parseConfig(base), Plugins, names);
                await applyConfig(JSON.stringify(cleaned), base, "Before plugin configuration cleanup", canApply);
                setChoices({});
                return `Cleaned ${names.length} plugin configurations and saved settings.json. A recovery backup is available.`;
            })
        });
    }

    return <div className="vc-config-editor-stack">
        <Heading tag="h3">Clean unused plugin settings</Heading>
        <Paragraph>Checks Vencord, Equicord, Illegalcord and user plugins against this client build. Missing plugins are selected automatically. Disabled plugins are optional and keep enabled set to false after cleanup.</Paragraph>
        <Notice.Info>A plugin missing from this build may still exist in another client or platform. Cleanup reduces configuration size; it does not unload plugins or clear their separate DataStore data.</Notice.Info>
        <div className="vc-config-editor-toolbar">
            <Paragraph>{selected.length} selected · About {(selected.reduce((bytes, candidate) => bytes + candidate.bytes, 0) / 1024).toFixed(1)} KB of plugin values</Paragraph>
            <Button disabled={busy || !selected.length} onClick={clean}>Back up and clean selected</Button>
        </div>
        {!candidates.length ? <Paragraph>No unused plugin settings found.</Paragraph> : null}
        <div className="vc-config-editor-backups">
            {candidates.map(candidate => <div className="vc-config-editor-row" key={candidate.name}>
                <Checkbox value={choices[candidate.name] ?? candidate.kind === "removed"} disabled={busy} onChange={(_, checked: boolean) => setChoices({ ...choices, [candidate.name]: checked })}>
                    <strong>{candidate.name}</strong>
                </Checkbox>
                <Paragraph>{candidate.kind === "removed" ? "Not in this build" : "Disabled"}</Paragraph>
            </div>)}
        </div>
    </div>;
}
