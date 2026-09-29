/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Heading } from "@components/Heading";
import { Notice } from "@components/Notice";
import { Paragraph } from "@components/Paragraph";
import { Alerts, Button, moment, React, TextInput, useEffect, useState } from "@webpack/common";

import type { BackupInfo } from "./config";
import { type ActionProps, applyConfig, authorName, Native, saveBackup, snapshot } from "./utils";

export function Backups({ busy, run, canApply }: ActionProps) {
    const [name, setName] = useState("");
    const [author, setAuthor] = useState(authorName);
    const [backups, setBackups] = useState<BackupInfo[]>([]);
    const [directory, setDirectory] = useState("");
    const [unreadable, setUnreadable] = useState(0);
    const [error, setError] = useState("");

    async function refresh() {
        try {
            const result = await Native.listBackups();
            if (!canApply()) return;
            if (!result.success) throw new Error(result.error);
            setBackups(result.backups);
            setDirectory(result.directory);
            setUnreadable(result.unreadable);
            setError("");
        } catch {
            if (canApply()) setError("Could not read ConfigBackups. Refresh to try again.");
        }
    }

    useEffect(() => { if (!busy) void refresh(); }, [busy]);

    function restore(backup: BackupInfo) {
        Alerts.show({
            title: "Restore configuration",
            body: `Restore “${backup.name}” by ${backup.author}? The current configuration will be backed up first, then replaced in settings.json.`,
            confirmText: "Restore",
            cancelText: "Cancel",
            onConfirm: () => void run(async () => {
                const base = snapshot();
                const result = await Native.loadBackup(backup.id);
                if (!result.success) throw new Error(result.error);
                await applyConfig(JSON.stringify(result.backup.settings), base, "Before restoring a backup", canApply);
                return "Backup restored to settings.json. Restart the client to apply any plugin activation and startup changes.";
            })
        });
    }

    return <div className="vc-config-editor-stack">
        <Heading tag="h3">Named configuration backups</Heading>
        <Paragraph>Backups contain all settings.json values, including plugin configuration. Each copy includes its name, creation date and author. Quick CSS, native settings and plugin DataStore files are separate and are not included.</Paragraph>
        <div className="vc-config-editor-fields">
            <label>Configuration name<TextInput value={name} onChange={setName} maxLength={80} placeholder="My daily setup" disabled={busy} /></label>
            <label>Author<TextInput value={author} onChange={setAuthor} maxLength={100} disabled={busy} /></label>
        </div>
        <div className="vc-config-editor-toolbar">
            <Button disabled={busy || !name.trim() || !author.trim()} onClick={() => void run(async () => {
                await saveBackup(name, author);
                setName("");
                return "Configuration backup saved in ConfigBackups.";
            })}>Create backup</Button>
            <Button color={Button.Colors.PRIMARY} disabled={busy} onClick={() => void refresh()}>Refresh backups</Button>
        </div>
        {directory ? <Paragraph className="vc-config-editor-path">{directory}</Paragraph> : null}
        {error ? <Notice.Warning>{error}</Notice.Warning> : null}
        {unreadable ? <Notice.Warning>{unreadable} backup files could not be read. They were left unchanged.</Notice.Warning> : null}
        {!backups.length && !error ? <Paragraph>No backups yet. Create a named backup or apply your first configuration change.</Paragraph> : null}
        <div className="vc-config-editor-backups">
            {backups.map(backup => <div className="vc-config-editor-row" key={backup.id}>
                <div>
                    <Paragraph><strong>{backup.name}</strong></Paragraph>
                    <Paragraph>{moment(backup.createdAt).format("LLL")} · {backup.author}</Paragraph>
                </div>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} disabled={busy} onClick={() => restore(backup)}>Restore</Button>
            </div>)}
        </div>
    </div>;
}
