/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { copyWithToast, openUserProfile } from "@utils/discord";
import type { RenderModalProps } from "@vencord/discord-types";
import { Alerts, ChannelStore, GuildStore, Modal, NavigationRouter, openModal, ScrollerThin, showToast, TextInput, Toasts, useEffect, useState } from "@webpack/common";

import { getLogPage, getLogStats, setLogProtected, setLogsProtected } from "./db";
import { clearAllLogs, deleteLog, deleteManyLogs } from "./engine";
import { exportLogRecords, exportLogs, importLogs } from "./io";
import { settings } from "./settings";
import { LogRecord, LogStats, LogStatus, LogViewStatus } from "./types";
import { cl } from "./utils";

const STATUS_OPTIONS: LogViewStatus[] = ["ALL", LogStatus.DELETED, LogStatus.EDITED, LogStatus.GHOST_PINGED];
const STATUS_LABELS: Record<LogViewStatus, string> = {
    ALL: "All logs",
    [LogStatus.DELETED]: "Deleted",
    [LogStatus.EDITED]: "Edited",
    [LogStatus.GHOST_PINGED]: "Ghost pings"
};
const STATUS_CLASSES: Record<LogStatus, string> = {
    [LogStatus.DELETED]: "deleted",
    [LogStatus.EDITED]: "edited",
    [LogStatus.GHOST_PINGED]: "ghostPinged"
};

interface LogsModalProps {
    modalProps: RenderModalProps;
    initialQuery?: string;
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface LogEntryProps {
    record: LogRecord;
    onDelete: (id: string) => void;
    onProtect: (id: string, value: boolean) => void;
}

function LogEntry({ record, onDelete, onProtect }: LogEntryProps) {
    const { message, status } = record;
    const channel = ChannelStore.getChannel(message.channel_id);
    const guild = GuildStore.getGuild(message.guild_id ?? message.guildId ?? channel?.guild_id);
    const authorName = message.author.global_name ?? message.author.globalName ?? message.author.username;
    const location = guild && channel
        ? `#${channel.name} in ${guild.name}`
        : channel?.name ?? "Direct messages";

    return (
        <article className={cl("entry", { protected: record.protected })}>
            <div className={cl("entry-header")}>
                <div>
                    <strong>{authorName}</strong>
                    <span className={cl("meta")}>{location}</span>
                </div>
                <span className={cl("status", STATUS_CLASSES[status])}>{STATUS_LABELS[status]}</span>
            </div>
            <div className={cl("content")}>{message.content || "No text content."}</div>
            {message.attachments.length > 0 && (
                <div className={cl("attachments")}>
                    {message.attachments.map(attachment => (
                        <span key={attachment.id}>{attachment.filename}</span>
                    ))}
                </div>
            )}
            {message.editHistory && message.editHistory.length > 0 && (
                <details className={cl("history")}>
                    <summary>{message.editHistory.length} previous version{message.editHistory.length === 1 ? "" : "s"}</summary>
                    {message.editHistory.map(edit => (
                        <div key={`${edit.timestamp}:${edit.content}`} className={cl("history-entry")}>
                            <time>{new Date(edit.timestamp).toLocaleString()}</time>
                            <div>{edit.content || "No text content."}</div>
                        </div>
                    ))}
                </details>
            )}
            <div className={cl("entry-footer")}>
                <time>{new Date(message.timestamp).toLocaleString()}</time>
                <span>{message.attachments.length} attachment{message.attachments.length === 1 ? "" : "s"}</span>
                <div className={cl("actions")}>
                    <Button
                        size="xs"
                        variant={record.protected ? "positive" : "secondary"}
                        onClick={() => onProtect(message.id, !record.protected)}
                    >
                        {record.protected ? "Protected" : "Protect"}
                    </Button>
                    <Button size="xs" variant="secondary" onClick={() => copyWithToast(message.content)}>Copy</Button>
                    <Button size="xs" variant="secondary" onClick={() => copyWithToast(JSON.stringify(message, null, 2))}>Raw</Button>
                    <Button size="xs" variant="secondary" onClick={() => openUserProfile(message.author.id)}>Profile</Button>
                    <Button
                        size="xs"
                        variant="secondary"
                        onClick={() => NavigationRouter.transitionTo(`/channels/${guild?.id ?? "@me"}/${message.channel_id}/${message.id}`)}
                    >
                        Open
                    </Button>
                    <Button size="xs" variant="dangerSecondary" onClick={() => onDelete(message.id)}>Delete</Button>
                </div>
            </div>
        </article>
    );
}

function LogsModal({ modalProps, initialQuery = "" }: LogsModalProps) {
    const [status, setStatus] = useState<LogViewStatus>("ALL");
    const [query, setQuery] = useState(initialQuery);
    const [newest, setNewest] = useState(true);
    const [records, setRecords] = useState<LogRecord[]>([]);
    const [cursor, setCursor] = useState<string>();
    const [hasMore, setHasMore] = useState(false);
    const [total, setTotal] = useState(0);
    const [pending, setPending] = useState(true);
    const [revision, setRevision] = useState(0);
    const [statsRevision, setStatsRevision] = useState(0);
    const [stats, setStats] = useState<LogStats>();

    useEffect(() => {
        let active = true;
        setPending(true);

        const timeout = setTimeout(() => {
            getLogPage(status, newest, settings.store.pageSize, query)
                .then(page => {
                    if (!active) return;
                    setRecords(page.records);
                    setCursor(page.cursor);
                    setHasMore(page.hasMore);
                    setTotal(page.total);
                    setPending(false);
                })
                .catch(() => {
                    if (active) setPending(false);
                });
        }, 250);

        return () => {
            active = false;
            clearTimeout(timeout);
        };
    }, [status, query, newest, revision]);

    useEffect(() => {
        let active = true;
        getLogStats().then(value => {
            if (active) setStats(value);
        });
        return () => {
            active = false;
        };
    }, [statsRevision]);

    function refresh() {
        setRevision(current => current + 1);
        setStatsRevision(current => current + 1);
    }

    async function loadMore() {
        if (!cursor || pending) return;
        setPending(true);
        const page = await getLogPage(status, newest, settings.store.pageSize, query, cursor);
        setRecords(current => [...current, ...page.records]);
        setCursor(page.cursor);
        setHasMore(page.hasMore);
        setPending(false);
    }

    async function removeLog(id: string) {
        await deleteLog(id);
        setRecords(current => current.filter(record => record.message_id !== id));
        setTotal(current => Math.max(0, current - 1));
        setStatsRevision(current => current + 1);
    }

    async function protectLog(id: string, value: boolean) {
        const updated = await setLogProtected(id, value);
        if (!updated) return;
        setRecords(current => current.map(record => record.message_id === id ? updated : record));
        setStatsRevision(current => current + 1);
    }

    async function exportBackup() {
        try {
            const count = await exportLogs();
            showToast(`Exported ${count} message logs.`, Toasts.Type.SUCCESS);
        } catch (error) {
            showToast(error instanceof Error ? error.message : "Failed to export message logs.", Toasts.Type.FAILURE);
        }
    }

    async function importBackup() {
        try {
            const count = await importLogs();
            if (count == null) return;
            showToast(`Imported ${count} message logs.`, Toasts.Type.SUCCESS);
            refresh();
        } catch (error) {
            showToast(error instanceof Error ? error.message : "Failed to import message logs.", Toasts.Type.FAILURE);
        }
    }

    async function protectVisible(value: boolean) {
        const ids = records.map(record => record.message_id);
        await setLogsProtected(ids, value);
        setRecords(current => current.map(record => ({ ...record, protected: value })));
        setStatsRevision(current => current + 1);
    }

    function confirmClearVisible() {
        Alerts.show({
            title: "Clear visible logs",
            body: `Remove the ${records.length} currently loaded logs?`,
            confirmText: "Clear",
            confirmVariant: "critical-primary",
            cancelText: "Cancel",
            onConfirm: async () => {
                await deleteManyLogs(records.filter(record => !record.protected).map(record => record.message_id));
                refresh();
            }
        });
    }

    function confirmClearAll() {
        Alerts.show({
            title: "Clear unprotected logs",
            body: "Remove every saved log except protected entries?",
            confirmText: "Clear unprotected",
            confirmVariant: "critical-primary",
            cancelText: "Cancel",
            onConfirm: async () => {
                await clearAllLogs();
                refresh();
            }
        });
    }

    return (
        <Modal
            {...modalProps}
            size="lg"
            title={`Illegal Message Logger · ${total} ${STATUS_LABELS[status].toLowerCase()}`}
            actions={[
                { text: newest ? "Oldest first" : "Newest first", variant: "secondary", onClick: () => setNewest(value => !value) },
                { text: "Clear visible", variant: "critical-secondary", disabled: records.length === 0, onClick: confirmClearVisible },
                { text: "Clear unprotected", variant: "critical-primary", onClick: confirmClearAll }
            ]}
        >
            <div className={cl("root")}>
                <div className={cl("toolbar")}>
                    {stats && (
                        <div className={cl("stats")}>
                            <span><strong>{stats.total}</strong> total</span>
                            <span><strong>{stats.deleted}</strong> deleted</span>
                            <span><strong>{stats.edited}</strong> edited</span>
                            <span><strong>{stats.ghostPinged}</strong> ghost pings</span>
                            <span><strong>{stats.protected}</strong> protected</span>
                            <span><strong>{formatBytes(stats.estimatedBytes)}</strong> estimated</span>
                        </div>
                    )}
                    <div className={cl("tabs")}>
                        {STATUS_OPTIONS.map(option => (
                            <Button
                                key={option}
                                size="small"
                                variant={status === option ? "primary" : "secondary"}
                                onClick={() => setStatus(option)}
                            >
                                {STATUS_LABELS[option]}
                            </Button>
                        ))}
                    </div>
                    <TextInput value={query} onChange={setQuery} placeholder="Search content, author, channel, server, or ID" />
                    <details className={cl("search-help")}>
                        <summary>Advanced search syntax</summary>
                        <span>from:, channel:, guild:, id:, before:, after:, has:attachment, has:embed, has:link, has:edit, is:protected, is:deleted, is:edited, is:ghost. Prefix a term with - to exclude it.</span>
                    </details>
                    <div className={cl("backup-actions")}>
                        <Button size="small" variant="secondary" onClick={exportBackup}>Export backup</Button>
                        <Button size="small" variant="secondary" disabled={records.length === 0} onClick={() => exportLogRecords(records, "illegal-message-logger-visible")}>Export visible</Button>
                        <Button size="small" variant="secondary" onClick={importBackup}>Import backup</Button>
                        <Button size="small" variant="secondary" disabled={records.length === 0} onClick={() => protectVisible(true)}>Protect visible</Button>
                        <Button size="small" variant="secondary" disabled={records.length === 0} onClick={() => protectVisible(false)}>Unprotect visible</Button>
                    </div>
                </div>
                <ScrollerThin fade className={cl("scroller")}>
                    {records.map(record => <LogEntry key={record.message_id} record={record} onDelete={removeLog} onProtect={protectLog} />)}
                    {!pending && records.length === 0 && <div className={cl("empty")}>No matching logs.</div>}
                    {pending && <div className={cl("empty")}>Loading logs…</div>}
                    {!pending && hasMore && (
                        <Button className={cl("load-more")} variant="secondary" onClick={loadMore}>Load more</Button>
                    )}
                </ScrollerThin>
            </div>
        </Modal>
    );
}

const SafeLogsModal = ErrorBoundary.wrap(LogsModal, { noop: true });

export function openLogs(initialQuery?: string) {
    return openModal(modalProps => <SafeLogsModal modalProps={modalProps} initialQuery={initialQuery} />);
}
