/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Notice } from "@components/Notice";
import { Paragraph } from "@components/Paragraph";
import { classNameFactory } from "@utils/css";
import type { PluginNative } from "@utils/types";
import { saveFile } from "@utils/web";
import { moment, React, ScrollerThin, Select, TextInput, useEffect, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { settings } from "./index";
import { getRequestRuleTarget, type RequestRuleDecision, validateRequestRuleList } from "./network";
import { browserRequestLog, getVoiceLoggingStatus, refreshRequestLogging } from "./requestCapture";
import type { RequestEntry } from "./requestLog";
import { RequestRuleActions } from "./RequestRuleActions";

const Native = VencordNative.pluginHelpers.DiscordHardened as PluginNative<typeof import("./native")> | undefined;
const LOG_KEYS: Array<keyof typeof settings.def> = ["recordNetworkRequests", "recordWebSocketMessages", "recordLocalResources", "recordVoiceDiagnostics", "requestLogLimit", "requestLogRetention", "blockedRequestUrls", "allowedRequestUrls"];
const STATES = ["All", "Pending", "Completed", "Redirected", "Blocked", "Failed"];
const METHODS = ["All", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "CONNECT", "SEND", "RECEIVE", "STATS", "EVENT", "UNKNOWN"];
const SOURCES = ["All", "Desktop", "Browser", "Firewall", "WebSocket", "Local", "Voice"];
const PAGE_SIZE = 100;
const cl = classNameFactory("vc-discord-hardened-");

interface RequestPanelProps {
    controls: ReactNode;
}

export function RequestPanel({ controls }: RequestPanelProps) {
    const options = settings.use(LOG_KEYS);
    const [entries, setEntries] = useState<RequestEntry[]>([]);
    const [search, setSearch] = useState("");
    const [state, setState] = useState("All");
    const [method, setMethod] = useState("All");
    const [resource, setResource] = useState("All");
    const [source, setSource] = useState("All");
    const [coverage, setCoverage] = useState({ webSockets: "Disabled", localResources: "Disabled", voice: "Disabled", error: "" });
    const [pageIndex, setPageIndex] = useState(0);
    const [revision, setRevision] = useState(0);
    const [error, setError] = useState("");
    const [clearing, setClearing] = useState(false);
    const [ruleError, setRuleError] = useState("");

    useEffect(() => {
        let active = true;
        let timer: ReturnType<typeof setTimeout>;
        let previousVersion = "";
        async function refresh(): Promise<void> {
            try {
                const desktop = Native ? await Native.getRequestLog() : null;
                if (!active) return;
                const browser = browserRequestLog.snapshot();
                setCoverage({ webSockets: "Disabled", localResources: "Disabled", error: "", ...desktop?.advanced, voice: getVoiceLoggingStatus() });
                const version = `${desktop?.revision}:${browser.revision}`;
                if (version !== previousVersion) {
                    previousVersion = version;
                    setEntries([...(desktop?.entries ?? []), ...browser.entries].sort((a, b) => b.time - a.time || b.id - a.id));
                }
                setError(Native && !desktop ? "Desktop request capture is unavailable. Enable DiscordHardened and restart Discord." : "");
            } catch {
                if (active) setError("Could not read the request log. Retrying automatically.");
            } finally {
                if (active) timer = setTimeout(refresh, 1000);
            }
        }
        void refresh();
        return () => { active = false; clearTimeout(timer); };
    }, [revision]);

    const query = search.trim().toLowerCase();
    const filtered = entries.filter(entry => (state === "All" || entry.state === state)
        && (method === "All" || entry.method === method)
        && (resource === "All" || entry.resourceType === resource)
        && (source === "All" || entry.source === source)
        && `${entry.url} ${entry.method} ${entry.resourceType} ${entry.source} ${entry.state} ${entry.status ?? ""} ${entry.detail ?? ""}`.toLowerCase().includes(query));
    const resources = Array.from(new Set(["All", resource, ...entries.map(entry => entry.resourceType)]));
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const page = Math.min(pageIndex, pages - 1);
    const failed = entries.filter(entry => entry.state === "Failed" || entry.state === "Blocked").length;

    function changeRule(target: string, decision: RequestRuleDecision): void {
        const { blockedRequestUrls, allowedRequestUrls } = settings.plain;
        const blocked = blockedRequestUrls.split("\n").map((line: string) => line.trim()).filter((line: string) => line && getRequestRuleTarget(line) !== target);
        const allowed = allowedRequestUrls.split("\n").map((line: string) => line.trim()).filter((line: string) => line && getRequestRuleTarget(line) !== target);
        if (decision === "Block") blocked.push(target);
        if (decision === "Allow") allowed.push(target);
        const blockedValue = blocked.join("\n");
        const allowedValue = allowed.join("\n");
        const validation = [validateRequestRuleList(blockedValue), validateRequestRuleList(allowedValue)].find((result: true | string) => result !== true);
        if (typeof validation === "string") {
            setRuleError(validation);
            return;
        }
        settings.store.blockedRequestUrls = blockedValue;
        settings.store.allowedRequestUrls = allowedValue;
        setRuleError("");
    }

    async function clear(): Promise<void> {
        setClearing(true);
        try {
            if (Native && !await Native.clearRequestLog()) {
                setError("Could not clear the desktop request log.");
                return;
            }
            browserRequestLog.clear();
            setEntries([]);
            setPageIndex(0);
            setRevision(value => value + 1);
            setError("");
        } catch {
            setError("Could not clear the request log.");
        } finally {
            setClearing(false);
        }
    }

    return <section className={cl("panel")}>
        <div className={cl("overview")}>
            <div className={cl("metric")}><span>Capture</span><strong>{options.recordNetworkRequests ? "Active" : "Paused"}</strong><span>{Native ? "Chromium session and renderer firewall" : "Browser resource timing and renderer firewall"}</span></div>
            <div className={cl("metric")}><span>Retained entries</span><strong>{entries.length}</strong><span>{failed} blocked or failed</span></div>
            <div className={cl("metric")}><span>Automatic cleanup</span><strong>{options.requestLogRetention ? `${options.requestLogRetention} min` : "Entry limit"}</strong><span>Up to {options.requestLogLimit} entries per source</span></div>
        </div>
        <section className={cl("card")}>
            <Heading tag="h3">Request logging</Heading>
            <Notice.Warning>Logging may increase CPU and memory usage and cause Discord to lag, especially with additional capture sources enabled or the log panel open. Enable advanced logging only while troubleshooting. Lower the entry limit or pause capture if Discord slows down.</Notice.Warning>
            <Paragraph>{Native
                ? "Records API calls, resource loads, redirects and WebSocket handshakes in this Electron session, including requests from frames and workers. Enable the additional sources below to observe individual WebSocket messages, local resources and available voice diagnostics."
                : "Records resource timing exposed by this browser after capture starts, including API calls, scripts, images and media. Methods, cross origin status codes, failed loads, frames, workers and WebSocket handshakes may be unavailable. Full session capture requires Discord desktop."}</Paragraph>
            <Paragraph>Logs stay in memory until cleared, expired or Discord closes. Bodies, headers, query strings, credentials, known URL tokens and WebSocket payloads are excluded. Local data and blob identifiers are redacted. Pausing stops new entries and keeps existing logs.</Paragraph>
            <Paragraph>Expand a request to block or allow its exact URL for all methods. Rules ignore query parameters and apply to future requests and new WebSocket connections, including while logging is paused. Allow overrides this plugin's request filters. Reset restores the default filters. Manage saved rules in the settings below, even after clearing the logs. Redacted URLs and local or voice events cannot be targeted from the log. Other plugins, browser policies and proxy failures can still block allowed requests.</Paragraph>
            {!Native ? <Notice.Info>Browser rules apply to fetch, XMLHttpRequest and beacon calls. Desktop rules also cover resource loads, workers, frames and new WebSocket connections.</Notice.Info> : null}
            <details className={cl("details")}>
                <summary>Recording and automatic cleanup settings</summary>
                <div className="vc-plugins-settings">{controls}</div>
            </details>
        </section>
        <section className={cl("card")}>
            <div className={cl("toolbar")}>
                <Heading tag="h3">Additional capture sources</Heading>
                <Button size="small" variant="secondary" disabled={!Native || !options.recordNetworkRequests || !options.recordWebSocketMessages && !options.recordLocalResources} onClick={refreshRequestLogging}>Reconnect capture</Button>
            </div>
            <div className={cl("checks")}>
                <div className={cl("check")}><span>WebSocket message metadata</span><span className={cl("status")} data-status={coverage.webSockets}>{coverage.webSockets}</span></div>
                <div className={cl("check")}><span>Local blob and data loads</span><span className={cl("status")} data-status={coverage.localResources}>{coverage.localResources}</span></div>
                <div className={cl("check")}><span>Voice engine events and counters</span><span className={cl("status")} data-status={coverage.voice}>{coverage.voice}</span></div>
                <div className={cl("check")}><span>Native module packet capture</span><span className={cl("status")}>Unavailable</span></div>
                <div className={cl("check")}><span>Requests inside Discord servers</span><span className={cl("status")}>Unavailable</span></div>
            </div>
            <Paragraph>Listening means voice event listeners are installed. Counters appear only when the voice engine emits supported statistics and do not describe every native request or packet. The client cannot observe requests performed inside Discord servers.</Paragraph>
            <Paragraph>Additional sources start when enabled. Existing WebSocket connections may have an unavailable URL. Local loads and frames that Chromium does not expose cannot be listed. Open the recording settings above to enable these sources.</Paragraph>
            {coverage.error ? <Notice.Warning role="alert">{coverage.error}</Notice.Warning> : null}
        </section>
        <section className={cl("card")} aria-labelledby="vc-discord-hardened-requests">
            <div className={cl("toolbar")}>
                <Heading tag="h3" id="vc-discord-hardened-requests">Request logs</Heading>
                <div className={cl("toolbar")}>
                    <Button size="small" variant="secondary" onClick={() => settings.store.recordNetworkRequests = !options.recordNetworkRequests}>
                        {options.recordNetworkRequests ? "Pause capture" : "Resume capture"}
                    </Button>
                    <Button size="small" variant="secondary" disabled={!filtered.length} onClick={() => saveFile(new File([
                        JSON.stringify({ exportedAt: new Date().toISOString(), filters: { search, state, method, resource, source }, requests: filtered }, null, 2)
                    ], `discord-requests-${Date.now()}.json`, { type: "application/json" }))}>Export filtered logs</Button>
                    <Button size="small" variant="dangerPrimary" disabled={clearing} onClick={clear}>{clearing ? "Clearing..." : "Clear logs"}</Button>
                </div>
            </div>
            {error ? <Notice.Warning role="alert">{error}</Notice.Warning> : null}
            {ruleError ? <Notice.Warning role="alert">{ruleError}</Notice.Warning> : null}
            <TextInput aria-label="Search request logs" placeholder="Search URL, status code, method or error" value={search} onChange={(value: string) => { setSearch(value); setPageIndex(0); }} />
            <div className={cl("permission-controls")}>
                <div className={cl("field")} role="group" aria-labelledby="vc-discord-hardened-request-state">
                    <span id="vc-discord-hardened-request-state">Result</span>
                    <Select options={STATES.map(value => ({ value, label: value }))} isSelected={(value: string) => value === state} select={(value: string) => { setState(value); setPageIndex(0); }} serialize={(value: string) => value} />
                </div>
                <div className={cl("field")} role="group" aria-labelledby="vc-discord-hardened-request-method">
                    <span id="vc-discord-hardened-request-method">Method</span>
                    <Select options={METHODS.map(value => ({ value, label: value }))} isSelected={(value: string) => value === method} select={(value: string) => { setMethod(value); setPageIndex(0); }} serialize={(value: string) => value} />
                </div>
                <div className={cl("field")} role="group" aria-labelledby="vc-discord-hardened-request-resource">
                    <span id="vc-discord-hardened-request-resource">Resource</span>
                    <Select options={resources.map(value => ({ value, label: value }))} isSelected={(value: string) => value === resource} select={(value: string) => { setResource(value); setPageIndex(0); }} serialize={(value: string) => value} />
                </div>
                <div className={cl("field")} role="group" aria-labelledby="vc-discord-hardened-request-source">
                    <span id="vc-discord-hardened-request-source">Source</span>
                    <Select options={SOURCES.map(value => ({ value, label: value }))} isSelected={(value: string) => value === source} select={(value: string) => { setSource(value); setPageIndex(0); }} serialize={(value: string) => value} />
                </div>
            </div>
            <ScrollerThin className={cl("request-console")}>
                <div tabIndex={0} role="region" aria-label="Network request log">
                    {filtered.length ? filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(entry => <details key={`${entry.source}:${entry.id}`} className={cl("request-entry")}>
                        <summary>
                            <time dateTime={new Date(entry.time).toISOString()}>{moment(entry.time).format("HH:mm:ss.SSS")}</time>
                            <span>{entry.method}</span>
                            <span className={cl("status")} data-result={entry.state}>{entry.status ?? entry.state}</span>
                            <span>{entry.resourceType}</span>
                            <span className={cl("request-url")}>{entry.url}</span>
                        </summary>
                        <div className={cl("request-metadata")}>
                            <span>Result: {entry.state}</span><span>Source: {entry.source}</span>
                            <span>Duration: {entry.duration === undefined ? "Unavailable" : `${Math.round(entry.duration)} ms`}</span>
                            {entry.fromCache === undefined ? null : <span>Cache: {entry.fromCache ? "Yes" : "No"}</span>}
                            {entry.bytes === undefined ? null : <span>Size: {entry.bytes} bytes</span>}
                            {entry.opcode === undefined ? null : <span>Opcode: {entry.opcode}</span>}
                            {entry.detail ? <span>{entry.detail}</span> : null}
                        </div>
                        <RequestRuleActions url={entry.url} rules={options} onChange={changeRule} />
                    </details>) : <div className={cl("empty")}>{entries.length ? "No requests match these filters." : options.recordNetworkRequests ? "Waiting for requests. Browse Discord to see network activity." : "Capture is paused."}</div>}
                </div>
            </ScrollerThin>
            <div className={cl("toolbar")}>
                <Paragraph>{filtered.length} matching entries. Page {page + 1} of {pages}. Newest first.</Paragraph>
                <div className={cl("toolbar")}>
                    <Button size="small" variant="secondary" disabled={page === 0} onClick={() => setPageIndex(page - 1)}>Previous</Button>
                    <Button size="small" variant="secondary" disabled={page + 1 >= pages} onClick={() => setPageIndex(page + 1)}>Next</Button>
                </div>
            </div>
        </section>
    </section>;
}
