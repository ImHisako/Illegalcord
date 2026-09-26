/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { AttachmentIcon, LogsIcon } from "@components/Icons";
import { copyWithToast, openUserProfile } from "@utils/discord";
import { parseUrl } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { Alerts, ChannelStore, GuildStore, lodash, MaskedLink, Modal, NavigationRouter, openModal, Parser, ScrollerThin, showToast, TextInput, Toasts, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { getLogPage, getLogStats, runMaintenance, setLogProtected, setLogsProtected } from "./db";
import { clearAllLogs, deleteLog, deleteManyLogs, flushQueuedLogs } from "./engine";
import { exportLogRecords, exportLogs, importLogs } from "./io";
import { settings } from "./settings";
import { LogRecord, LogStats, LogStatus, LogViewStatus } from "./types";
import { cl } from "./utils";

const STATUS_OPTIONS: LogViewStatus[] = ["ALL", LogStatus.DELETED, LogStatus.EDITED, LogStatus.GHOST_PINGED];
const LIMIT_SETTINGS: Array<"messageLimit"> = ["messageLimit"];
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
    busy: boolean;
}

function LogEntry({ record, onDelete, onProtect, busy }: LogEntryProps) {
    const { message, status } = record;
    const [expanded, setExpanded] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const longContent = message.content.length > 600 || message.content.split("\n", 9).length > 8;
    const content = longContent && !expanded ? `${message.content.slice(0, 600).split("\n").slice(0, 8).join("\n")}…` : message.content;
    const parsedContent = useMemo(() => Parser.parse(content), [content]);
    const channel = ChannelStore.getChannel(message.channel_id);
    const guild = GuildStore.getGuild(message.guild_id ?? message.guildId ?? channel?.guild_id);
    const authorName = message.author.global_name ?? message.author.globalName ?? message.author.username;
    const location = guild && channel
        ? `#${channel.name} in ${guild.name}`
        : channel?.name || (guild ? `Channel ${message.channel_id} in ${guild.name}` : message.guild_id || message.guildId ? `Channel ${message.channel_id}` : "Direct messages");

    return (
        <article className={cl("entry", STATUS_CLASSES[status], { protected: record.protected })}>
            <div className={cl("entry-header")}>
                <div className={cl("identity")}>
                    <strong className={cl("author")} title={message.author.id}>{authorName}</strong>
                    <span className={cl("location")} title={location}>{location}</span>
                </div>
                <span className={cl("status", STATUS_CLASSES[status])}>{STATUS_LABELS[status]}</span>
            </div>
            <div className={cl("content", { collapsed: longContent && !expanded })}>
                {message.content ? parsedContent : <span className={cl("muted")}>No text content.</span>}
            </div>
            {longContent ? <Button size="xs" variant="link" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Collapse message" : "Show full message"}</Button> : null}
            {message.attachments.length > 0 && (
                <div className={cl("attachments")}>
                    {message.attachments.map(attachment => {
                        const url = parseUrl(attachment.url);
                        if (!url || !["https:", "http:"].includes(url.protocol)) return null;
                        return (
                            <MaskedLink key={attachment.id} href={url.href}>
                                <AttachmentIcon width={14} height={14} />
                                {attachment.filename}
                            </MaskedLink>
                        );
                    })}
                </div>
            )}
            {message.editHistory && message.editHistory.length > 0 && (
                <details className={cl("history")} onToggle={event => setHistoryOpen(event.currentTarget.open)}>
                    <summary>{message.editHistory.length} previous version{message.editHistory.length === 1 ? "" : "s"}</summary>
                    {historyOpen ? message.editHistory.map(edit => (
                        <div key={`${edit.timestamp}:${edit.content}`} className={cl("history-entry")}>
                            <time>{new Date(edit.timestamp).toLocaleString()}</time>
                            <div>{edit.content ? Parser.parse(edit.content) : "No text content."}</div>
                        </div>
                    )) : null}
                </details>
            )}
            <div className={cl("entry-footer")}>
                <div className={cl("entry-meta")}>
                    <time dateTime={message.timestamp} title="Message sent">{new Date(message.timestamp).toLocaleString()}</time>
                    {record.protected ? <span className={cl("protected-label")}>Protected from cleanup</span> : null}
                    {message.attachments.length > 0 && (
                        <span>{message.attachments.length} attachment{message.attachments.length === 1 ? "" : "s"}</span>
                    )}
                </div>
                <div className={cl("actions")}>
                    <Button
                        size="xs"
                        variant={record.protected ? "positive" : "secondary"}
                        disabled={busy}
                        onClick={() => onProtect(message.id, !record.protected)}
                    >
                        {record.protected ? "Protected" : "Protect"}
                    </Button>
                    <Button size="xs" variant="secondary" title="Copy message text" onClick={() => copyWithToast(message.content)}>Copy</Button>
                    <Button
                        size="xs"
                        variant="secondary"
                        title="Jump to message"
                        onClick={() => NavigationRouter.transitionTo(`/channels/${guild?.id ?? "@me"}/${message.channel_id}/${message.id}`)}
                    >
                        Open
                    </Button>
                    <details className={cl("entry-tools")}>
                        <summary>More actions</summary>
                        <div className={cl("actions")}>
                            <Button size="xs" variant="secondary" title="Copy raw message data" onClick={() => copyWithToast(JSON.stringify(message, null, 2))}>Copy raw data</Button>
                            <Button size="xs" variant="secondary" onClick={() => openUserProfile(message.author.id)}>Author profile</Button>
                            <Button size="xs" variant="dangerSecondary" disabled={busy || record.protected} title={record.protected ? "Unprotect this log before deleting it" : "Delete this log"} onClick={() => onDelete(message.id)}>Delete log</Button>
                        </div>
                    </details>
                </div>
            </div>
        </article>
    );
}

const SafeLogEntry = ErrorBoundary.wrap(LogEntry, { noop: true });

function LogsModal({ modalProps, initialQuery = "" }: LogsModalProps) {
    const { messageLimit } = settings.use(LIMIT_SETTINGS);
    const [limitInput, setLimitInput] = useState(String(messageLimit));
    const [status, setStatus] = useState<LogViewStatus>("ALL");
    const [query, setQuery] = useState(initialQuery);
    const [newest, setNewest] = useState(true);
    const [records, setRecords] = useState<LogRecord[]>([]);
    const [cursor, setCursor] = useState<string>();
    const [pageCursors, setPageCursors] = useState<Array<string | undefined>>([undefined]);
    const [pageIndex, setPageIndex] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [total, setTotal] = useState(0);
    const [pending, setPending] = useState(true);
    const [revision, setRevision] = useState(0);
    const [stats, setStats] = useState<LogStats>();
    const [protectedOnly, setProtectedOnly] = useState(false);
    const [attachmentsOnly, setAttachmentsOnly] = useState(false);
    const [compact, setCompact] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const request = useRef(0);
    const controller = useRef<AbortController | undefined>(undefined);
    const searchQuery = [query, protectedOnly ? "is:protected" : "", attachmentsOnly ? "has:attachment" : ""].filter(Boolean).join(" ");
    const unprotectedCount = records.filter(record => !record.protected).length;
    const hasFilters = Boolean(query || protectedOnly || attachmentsOnly || status !== "ALL");
    const limit = Number(limitInput);
    const validLimit = limitInput.trim() !== "" && settings.def.messageLimit.isValid(limit) === true;

    useEffect(() => setLimitInput(String(messageLimit)), [messageLimit]);

    useEffect(() => {
        const currentRequest = ++request.current;
        const abortController = new AbortController();
        controller.current = abortController;
        setPending(true);
        setRecords([]);
        setCursor(undefined);
        setHasMore(false);
        setPageCursors([undefined]);
        setPageIndex(0);
        setError("");

        const load = lodash.debounce(async () => {
            try {
                await flushQueuedLogs();
                const [page, summary] = await Promise.all([getLogPage(status, newest, settings.store.pageSize, searchQuery, undefined, abortController.signal), getLogStats()]);
                if (currentRequest !== request.current) return;
                setRecords(page.records);
                setCursor(page.cursor);
                setHasMore(page.hasMore);
                setTotal(page.total);
                setStats(summary);
            } catch {
                if (currentRequest === request.current) setError("Could not load the message logs. Try refreshing the archive.");
            } finally {
                if (currentRequest === request.current) setPending(false);
            }
        }, 250);
        load();

        return () => {
            request.current++;
            controller.current?.abort();
            load.cancel();
        };
    }, [status, searchQuery, newest, revision]);

    function refresh() {
        setRevision(current => current + 1);
    }

    async function changePage(next: boolean) {
        if (pending || (next ? !cursor : pageIndex === 0)) return;
        const currentRequest = request.current;
        controller.current?.abort();
        const abortController = new AbortController();
        controller.current = abortController;
        const nextIndex = pageIndex + (next ? 1 : -1);
        const pageCursor = next ? cursor : pageCursors[nextIndex];
        setPending(true);
        setError("");
        try {
            const page = await getLogPage(status, newest, settings.store.pageSize, searchQuery, pageCursor, abortController.signal);
            if (currentRequest !== request.current) return;
            setRecords(page.records);
            setPageIndex(nextIndex);
            if (next) setPageCursors(current => [...current.slice(0, nextIndex), pageCursor]);
            setCursor(page.cursor);
            setHasMore(page.hasMore);
        } catch {
            if (currentRequest === request.current) setError("Could not load this page. Your current results are still available.");
        } finally {
            if (currentRequest === request.current) setPending(false);
        }
    }

    async function runAction(action: () => Promise<unknown>, reload = true) {
        if (busy) return;
        setBusy(true);
        try {
            await action();
            if (reload) refresh();
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return;
            showToast(error instanceof Error ? error.message : "The log action failed. Please try again.", Toasts.Type.FAILURE);
        } finally {
            setBusy(false);
        }
    }

    async function measureStorage() {
        const currentRequest = request.current;
        await runAction(async () => {
            const summary = await getLogStats(true, controller.current?.signal);
            if (currentRequest === request.current) setStats(summary);
        }, false);
    }

    function removeLog(id: string) {
        Alerts.show({
            title: "Delete this log?",
            body: "This removes the saved log and its edit history from this device.",
            confirmText: "Delete log",
            confirmVariant: "critical-primary",
            cancelText: "Cancel",
            onConfirm: () => runAction(() => deleteLog(id))
        });
    }

    async function protectLog(id: string, value: boolean) {
        await runAction(() => setLogProtected(id, value));
    }

    async function exportBackup() {
        await runAction(async () => {
            await flushQueuedLogs();
            const count = await exportLogs();
            showToast(`Exported ${count} message logs.`, Toasts.Type.SUCCESS);
        }, false);
    }

    async function importBackup() {
        await runAction(async () => {
            const count = await importLogs();
            if (count == null) return;
            showToast(`Imported ${count} message logs.`, Toasts.Type.SUCCESS);
        });
    }

    async function protectVisible(value: boolean) {
        const ids = records.map(record => record.message_id);
        await runAction(() => setLogsProtected(ids, value));
    }

    function confirmClearVisible() {
        const ids = records.filter(record => !record.protected).map(record => record.message_id);
        Alerts.show({
            title: "Clear loaded logs",
            body: `Remove ${ids.length} unprotected logs from the loaded results? Protected entries will be kept.`,
            confirmText: "Clear",
            confirmVariant: "critical-primary",
            cancelText: "Cancel",
            onConfirm: () => runAction(() => deleteManyLogs(ids))
        });
    }

    function confirmClearAll() {
        Alerts.show({
            title: "Clear unprotected logs",
            body: "Remove every saved log except protected entries?",
            confirmText: "Clear unprotected",
            confirmVariant: "critical-primary",
            cancelText: "Cancel",
            onConfirm: () => runAction(() => clearAllLogs())
        });
    }

    function resetFilters() {
        setQuery("");
        setStatus("ALL");
        setProtectedOnly(false);
        setAttachmentsOnly(false);
    }

    return (
        <Modal
            {...modalProps}
            size="xl"
            title="Illegal Message Logger"
            subtitle="Browse deleted messages, edit history, and ghost pings saved on this device."
            actions={[{ text: "Done", variant: "secondary", onClick: modalProps.onClose }]}
        >
            <div className={cl("root", { compact })}>
                <div className={cl("toolbar")}>
                    <div className={cl("overview")}>
                        <div aria-live="polite">
                            <strong>{pending ? "Loading archive…" : error && records.length === 0 ? "Archive unavailable" : `${records.length.toLocaleString()} log${records.length === 1 ? "" : "s"} on this page`}</strong>
                            <span>{pending ? "Searching saved messages" : error ? "Refresh to try again" : `${total.toLocaleString()} saved in this category · ${hasFilters ? "Filtered results" : "All saved messages"}`}</span>
                        </div>
                        <div className={cl("view-actions")}>
                            <Button size="small" variant="secondary" aria-pressed={compact} onClick={() => setCompact(value => !value)}>{compact ? "Comfortable view" : "Compact view"}</Button>
                            <Button
                                className={cl("sort")}
                                size="small"
                                variant="secondary"
                                onClick={() => setNewest(value => !value)}
                            >
                                {newest ? "Newest first" : "Oldest first"}
                            </Button>
                            <Button size="small" variant="secondary" disabled={pending || busy} onClick={refresh}>Refresh</Button>
                        </div>
                    </div>
                    <div className={cl("search-row")}>
                        <TextInput
                            aria-label="Search message logs"
                            value={query}
                            onChange={setQuery}
                            placeholder="Search messages, previous versions, people, or channels…"
                        />
                        <Button size="small" variant="secondary" disabled={!hasFilters} onClick={resetFilters}>Reset filters</Button>
                    </div>
                    <div className={cl("filters")}>
                        <span className={cl("section-label")}>Filter</span>
                        <div className={cl("tabs")}>
                            {STATUS_OPTIONS.map(option => (
                                <Button
                                    key={option}
                                    size="small"
                                    variant={status === option ? "primary" : "secondary"}
                                    aria-pressed={status === option}
                                    onClick={() => setStatus(option)}
                                >
                                    {STATUS_LABELS[option]}
                                    {stats ? <span className={cl("count")}>{(option === "ALL" ? stats.total : option === LogStatus.DELETED ? stats.deleted : option === LogStatus.EDITED ? stats.edited : stats.ghostPinged).toLocaleString()}</span> : null}
                                </Button>
                            ))}
                        </div>
                    </div>
                    <div className={cl("quick-filters")}>
                        <Button size="xs" variant={protectedOnly ? "positive" : "secondary"} aria-pressed={protectedOnly} onClick={() => setProtectedOnly(value => !value)}>Protected only</Button>
                        <Button size="xs" variant={attachmentsOnly ? "primary" : "secondary"} aria-pressed={attachmentsOnly} onClick={() => setAttachmentsOnly(value => !value)}><AttachmentIcon width={14} height={14} /> With attachments</Button>
                        <details className={cl("search-help")}>
                            <summary>Advanced search syntax</summary>
                            <span><code>from:</code>, <code>channel:</code>, <code>guild:</code>, <code>id:</code>, <code>before:2026-09-01</code>, <code>after:</code>, <code>has:attachment</code>, <code>has:embed</code>, <code>has:link</code>, <code>has:edit</code>, <code>is:protected</code>, <code>is:deleted</code>, <code>is:edited</code>, <code>is:ghost</code>. Use quotes for phrases and prefix a term with <code>-</code> to exclude it, for example <code>{'-"not this phrase"'}</code>.</span>
                        </details>
                    </div>
                    <details className={cl("management")}>
                        <summary>Archive overview and tools <span>{busy ? "Working…" : `${records.length} loaded logs`}</span></summary>
                        <label className={cl("section-label")} htmlFor="illegal-ml-message-limit">Maximum saved messages</label>
                        <div className={cl("search-row")}>
                            <TextInput
                                id="illegal-ml-message-limit"
                                type="number"
                                min={0}
                                step={1}
                                value={limitInput}
                                onChange={setLimitInput}
                                disabled={busy}
                                aria-invalid={!validLimit}
                                aria-describedby="illegal-ml-message-limit-help"
                            />
                            <Button size="small" disabled={busy || !validLimit} onClick={() => runAction(async () => {
                                settings.store.messageLimit = limit;
                                await flushQueuedLogs();
                                await runMaintenance(limit, 0);
                                showToast("Saved message limit applied.", Toasts.Type.SUCCESS);
                            })}>Apply limit</Button>
                        </div>
                        <p id="illegal-ml-message-limit-help">Use a whole number of 0 or greater. 0 means no limit. Applying a limit removes the oldest unprotected logs. Protected logs are always kept, even above the limit.</p>
                        {stats && (
                            <div className={cl("stats")}>
                                <span><strong>{stats.total.toLocaleString()}</strong> Total</span>
                                <span><strong>{stats.deleted.toLocaleString()}</strong> Deleted</span>
                                <span><strong>{stats.edited.toLocaleString()}</strong> Edited</span>
                                <span><strong>{stats.ghostPinged.toLocaleString()}</strong> Ghost pings</span>
                                <span><strong>{stats.protected?.toLocaleString() ?? "Not measured"}</strong> Protected</span>
                                <span><strong>{stats.estimatedBytes === undefined ? "Not measured" : formatBytes(stats.estimatedBytes)}</strong> Estimated storage</span>
                            </div>
                        )}
                        <div className={cl("backup-actions")}>
                            <Button size="small" variant="secondary" disabled={busy || pending} onClick={measureStorage}>Measure storage</Button>
                            <Button size="small" variant="secondary" disabled={busy} onClick={exportBackup}>Export all</Button>
                            <Button size="small" variant="secondary" disabled={busy || pending || records.length === 0} onClick={() => exportLogRecords(records, "illegal-message-logger-visible")}>Export loaded</Button>
                            <Button size="small" variant="secondary" disabled={busy} onClick={importBackup}>Import backup</Button>
                            <Button size="small" variant="secondary" disabled={busy || pending || records.length === 0} onClick={() => protectVisible(true)}>Protect loaded</Button>
                            <Button size="small" variant="secondary" disabled={busy || pending || records.length === 0} onClick={() => protectVisible(false)}>Unprotect loaded</Button>
                            <Button size="small" variant="dangerSecondary" disabled={busy || pending || unprotectedCount === 0} onClick={confirmClearVisible}>Clear loaded</Button>
                            <Button size="small" variant="dangerSecondary" disabled={busy || pending || !stats?.total || stats.total === stats.protected} onClick={confirmClearAll}>Clear all unprotected</Button>
                        </div>
                        <p>Actions labeled “loaded” affect only this page. “Clear all unprotected” affects the entire archive. Storage is estimated on request. Full backups include all saved logs and their message content.</p>
                    </details>
                </div>
                <ScrollerThin key={`${pageIndex}:${status}:${newest}:${searchQuery}:${revision}`} fade className={cl("scroller")} aria-busy={pending}>
                    {error ? <div className={cl("error")} role="alert"><strong>Archive unavailable</strong><span>{error}</span><Button size="small" variant="secondary" onClick={refresh}>Retry</Button></div> : null}
                    {records.map(record => <SafeLogEntry key={record.message_id} record={record} onDelete={removeLog} onProtect={protectLog} busy={busy || pending} />)}
                    {!pending && !error && records.length === 0 ? (
                        <div className={cl("empty")}>
                            <LogsIcon width={36} height={36} />
                            <strong>{hasFilters ? "No matching logs" : "Your archive is empty"}</strong>
                            <span>{hasFilters ? "Try another filter or search query." : "Deleted messages, edits and ghost pings will appear here when captured."}</span>
                            {hasFilters ? <Button size="small" variant="secondary" onClick={resetFilters}>Show all logs</Button> : null}
                        </div>
                    ) : null}
                    {pending && <div className={cl("empty")}><span>Loading logs…</span></div>}
                </ScrollerThin>
                <div className={cl("pagination")}>
                    <Button size="small" variant="secondary" disabled={pending || busy || pageIndex === 0} onClick={() => changePage(false)}>Previous</Button>
                    <span role="status">Page {(pageIndex + 1).toLocaleString()}{pending ? " · Loading…" : ""}</span>
                    <Button size="small" variant="secondary" disabled={pending || busy || !hasMore} onClick={() => changePage(true)}>Next</Button>
                </div>
            </div>
        </Modal>
    );
}

const SafeLogsModal = ErrorBoundary.wrap(LogsModal, { noop: true });

export function openLogs(initialQuery?: string) {
    return openModal(modalProps => <SafeLogsModal modalProps={modalProps} initialQuery={initialQuery} />);
}
