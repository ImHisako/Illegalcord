/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { Heading } from "@components/Heading";
import { Notice } from "@components/Notice";
import { Paragraph } from "@components/Paragraph";
import { SettingsTab, wrapTab } from "@components/settings";
import { React, TabBar, useEffect, useRef, useState } from "@webpack/common";

import { Backups } from "./Backups";
import { Cleanup } from "./Cleanup";
import { Editor } from "./Editor";

function SettingsPage() {
    const [tab, setTab] = useState("editor");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [failed, setFailed] = useState(false);
    const running = useRef(false);
    const active = useRef(true);

    useEffect(() => {
        active.current = true;
        return () => { active.current = false; };
    }, []);

    async function run(action: () => Promise<string>) {
        if (running.current || !active.current) return false;
        running.current = true;
        setBusy(true);
        setMessage("");
        try {
            const result = await action();
            if (active.current) { setMessage(result); setFailed(false); }
            return true;
        } catch (error) {
            if (active.current) {
                setMessage(error instanceof Error ? error.message : "The configuration operation failed.");
                setFailed(true);
            }
            return false;
        } finally {
            running.current = false;
            if (active.current) setBusy(false);
        }
    }

    const props = { busy, run, canApply: () => active.current };
    return <SettingsTab>
        <div className="vc-config-editor-stack">
            <div>
                <Heading tag="h2">Config Editor</Heading>
                <Paragraph>Edit settings.json, keep named recovery copies and clean unused plugin configuration.</Paragraph>
            </div>
            <TabBar type="top" look="brand" selectedItem={tab} onItemSelect={setTab}>
                <TabBar.Item id="editor">Live editor</TabBar.Item>
                <TabBar.Item id="backups">Backups and restore</TabBar.Item>
                <TabBar.Item id="cleanup">Plugin cleanup</TabBar.Item>
            </TabBar>
            {busy ? <Paragraph role="status">Saving configuration and recovery data...</Paragraph> : null}
            {message ? <Notice variant={failed ? "warning" : "positive"} role="status">{message}</Notice> : null}
            <div hidden={tab !== "editor"}><Editor {...props} visible={tab === "editor"} /></div>
            <div hidden={tab !== "backups"}><Backups {...props} /></div>
            <div hidden={tab !== "cleanup"}><Cleanup {...props} /></div>
        </div>
    </SettingsTab>;
}

export default wrapTab(SettingsPage, "Config Editor");
