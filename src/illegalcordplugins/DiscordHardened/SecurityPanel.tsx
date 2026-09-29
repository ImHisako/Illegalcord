/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { Heading } from "@components/Heading";
import { Notice } from "@components/Notice";
import { Paragraph } from "@components/Paragraph";
import { classNameFactory } from "@utils/css";
import { useFixedTimer, useForceUpdater } from "@utils/react";
import { formatDuration } from "@utils/text";
import type { PluginNative } from "@utils/types";
import { Button, moment, React, ScrollerThin, Select, TextInput, useEffect, useState } from "@webpack/common";

import { settings } from "./index";
import { getRuntimeProtections } from "./runtime";
import { clearBlockLog, getBlockLog, getTemporaryPermissions, grantTemporaryPermission, revokeTemporaryPermission, TEMPORARY_PERMISSIONS, type TemporaryPermission } from "./session";

const Native = VencordNative.pluginHelpers.DiscordHardened as PluginNative<typeof import("./native")> | undefined;
const PANEL_KEYS: Array<TemporaryPermission | "recordBlockedEvents"> = ["recordBlockedEvents", "allowCamera", "allowMicrophone", "allowDisplayCapture", "allowClipboardRead", "allowDeviceEnumeration", "allowSpeakerSelection"];
const PERMISSION_OPTIONS = Object.entries(TEMPORARY_PERMISSIONS).map(([value, label]) => ({ value: value as TemporaryPermission, label }));
const DURATION_OPTIONS = [1, 5, 15].map(value => ({ value, label: `${value} ${value === 1 ? "minute" : "minutes"}` }));
const cl = classNameFactory("vc-discord-hardened-");

export function SecurityPanel() {
    const options = settings.use(PANEL_KEYS);
    const [permission, setPermission] = useState<TemporaryPermission>("allowClipboardRead");
    const [minutes, setMinutes] = useState(5);
    const [revision, setRevision] = useState(0);
    const [security, setSecurity] = useState<Awaited<ReturnType<NonNullable<typeof Native>["getSecurityStatus"]>>>(null);
    const [loading, setLoading] = useState(Boolean(Native));
    const [grantFailed, setGrantFailed] = useState(false);
    const [search, setSearch] = useState("");
    const forceUpdate = useForceUpdater();
    useFixedTimer({ initialTime: 0 });

    useEffect(() => {
        if (!Native) return;
        let active = true;
        setLoading(true);
        setSecurity(null);
        Native.getSecurityStatus().then(status => {
            if (active) setSecurity(status);
        }).catch(() => {
            if (active) setSecurity(null);
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, [revision]);

    const grants = getTemporaryPermissions();
    const events = getBlockLog().toReversed();
    const query = search.trim().toLowerCase();
    const filteredEvents = events.filter(event => event.category.toLowerCase().includes(query));
    const protections = getRuntimeProtections();
    const activeProtections = protections.filter(protection => protection.status === "Active").length;
    const desktopChecks = security ? [
        { name: "Node integration disabled", active: security.nodeIntegration === null ? null : !security.nodeIntegration },
        { name: "Context isolation", active: security.contextIsolation },
        { name: "Web security", active: security.webSecurity },
        { name: "Renderer sandbox", active: security.sandbox },
        { name: "External navigation blocking", active: security.navigationRestricted },
        { name: "Electron webview blocking", active: security.webviewsBlocked },
    ] : [];

    return <section className={cl("panel")}>
        <div className={cl("overview")}>
            <div className={cl("metric")}>
                <span>Browser guards active</span>
                <strong>{activeProtections}<small> / {protections.length}</small></strong>
                <span>In this window</span>
            </div>
            <div className={cl("metric")}>
                <span>Temporary permissions</span>
                <strong>{grants.length}</strong>
                <span>{grants.length ? "Expire automatically" : "No active grants"}</span>
            </div>
            <div className={cl("metric")}>
                <span>Recorded blocks</span>
                <strong>{events.reduce((total, event) => total + event.count, 0)}</strong>
                <span>Across {events.length} retained entries</span>
            </div>
        </div>

        <section className={cl("card")} aria-labelledby="vc-discord-hardened-protections">
            <div>
                <Heading tag="h3" id="vc-discord-hardened-protections">Protection status</Heading>
                <Paragraph>Live browser API checks for this window.</Paragraph>
            </div>
            <div className={cl("checks")}>
                {protections.map(protection => <div key={protection.name} className={cl("check")}>
                    <span>{protection.name}</span>
                    <span className={cl("status")} data-status={protection.status}>{protection.status}</span>
                </div>)}
            </div>
            <details className={cl("details")}>
                <summary>What these statuses mean</summary>
                <Paragraph>Active means the guard is installed and its restriction is enabled. Disabled includes temporary permissions. Unavailable means the browser does not expose that API. Not applied means a guard failed or was replaced. These checks cover this window, not other frames or every native Discord API.</Paragraph>
            </details>
        </section>

        <section className={cl("card")} aria-labelledby="vc-discord-hardened-desktop">
            <div className={cl("toolbar")}>
                <div>
                    <Heading tag="h3" id="vc-discord-hardened-desktop">Desktop snapshot</Heading>
                    <Paragraph>Electron protections at the last check.</Paragraph>
                </div>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => setRevision(value => value + 1)} disabled={!Native || loading}>
                    {loading ? "Checking..." : "Refresh desktop status"}
                </Button>
            </div>
            {loading ? <Paragraph role="status">Checking desktop protections...</Paragraph> : security ? <>
                <div className={cl("checks")}>
                    {desktopChecks.map(check => <div key={check.name} className={cl("check")}>
                        <span>{check.name}</span>
                        <span className={cl("status")} data-status={check.active === null ? "Unavailable" : check.active ? "Active" : "Not active"}>
                            {check.active === null ? "Unavailable" : check.active ? "Active" : "Not active"}
                        </span>
                    </div>)}
                </div>
                {security.sandbox === false ? <Notice.Warning>The current Illegalcord loader requires an unsandboxed renderer. The sandbox is not active.</Notice.Warning> : null}
            </> : <Paragraph>Desktop protections could not be verified in this window.</Paragraph>}
        </section>

        <section className={cl("card")} aria-labelledby="vc-discord-hardened-permissions">
            <div>
                <Heading tag="h3" id="vc-discord-hardened-permissions">Temporary permissions</Heading>
                <Paragraph>Allow a capability for a limited time without changing your saved preferences.</Paragraph>
            </div>
            <div className={cl("permission-controls")}>
                <div className={cl("field")} role="group" aria-labelledby="vc-discord-hardened-capability">
                    <span id="vc-discord-hardened-capability">Capability</span>
                    <Select
                        options={PERMISSION_OPTIONS}
                        isSelected={(value: TemporaryPermission) => value === permission}
                        select={(value: TemporaryPermission) => { setPermission(value); setGrantFailed(false); }}
                        serialize={(value: TemporaryPermission) => value}
                    />
                </div>
                <div className={cl("field")} role="group" aria-labelledby="vc-discord-hardened-duration">
                    <span id="vc-discord-hardened-duration">Duration</span>
                    <Select options={DURATION_OPTIONS} isSelected={(value: number) => value === minutes} select={setMinutes} serialize={(value: number) => String(value)} />
                </div>
                <Button disabled={options[permission]} onClick={() => { setGrantFailed(!grantTemporaryPermission(permission, minutes)); forceUpdate(); }}>Allow temporarily</Button>
            </div>
            {options[permission] ? <Notice.Info>This capability is already allowed in your saved preferences. Disable it in the Settings tab to use temporary grants.</Notice.Info> : null}
            {grantFailed ? <Notice.Warning role="alert">The temporary permission could not be granted. Enable DiscordHardened first.</Notice.Warning> : null}
            {grants.length ? <div className={cl("grants")}>
                {grants.map(grant => <div key={grant.permission} className={cl("toolbar", "grant")}>
                    <div>
                        <Paragraph><strong>{TEMPORARY_PERMISSIONS[grant.permission]}</strong></Paragraph>
                        <Paragraph className={cl("countdown")}>{formatDuration(Math.max(0, grant.expiresAt - Date.now()))} remaining</Paragraph>
                    </div>
                    <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} aria-label={`Revoke ${TEMPORARY_PERMISSIONS[grant.permission]}`} onClick={() => { revokeTemporaryPermission(grant.permission); forceUpdate(); }}>Revoke</Button>
                </div>)}
            </div> : <Paragraph className={cl("empty")}>No temporary permissions are active.</Paragraph>}
            <details className={cl("details")}>
                <summary>How temporary access works</summary>
                <Paragraph>Browser permission prompts, mute and push to talk protections still apply. Temporary capture tracks and their clones stop when the grant expires, is revoked or the plugin stops.</Paragraph>
            </details>
        </section>

        <section className={cl("card")} aria-labelledby="vc-discord-hardened-log">
            <div className={cl("toolbar")}>
                <div>
                    <Heading tag="h3" id="vc-discord-hardened-log">Log console</Heading>
                    <Paragraph>{events.length}/100 entries · Newest first · Stored in memory</Paragraph>
                </div>
                <span className={cl("status")} data-status={options.recordBlockedEvents ? "Active" : "Disabled"}>{options.recordBlockedEvents ? "Recording enabled" : "Recording disabled"}</span>
            </div>
            <div className={cl("toolbar")}>
                <div className={cl("search")}>
                    <TextInput value={search} onChange={setSearch} placeholder="Filter by category..." aria-label="Filter log by category" />
                </div>
                <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => { clearBlockLog(); forceUpdate(); }} disabled={!events.length}>Clear log</Button>
            </div>
            {query ? <Paragraph role="status">{filteredEvents.length} of {events.length} entries match.</Paragraph> : null}
            <ScrollerThin className={cl("console")}>
                <div tabIndex={0} role="region" aria-label="DiscordHardened log console">
                    {!options.recordBlockedEvents ? <div className={cl("empty")}>Recording is disabled. Enable it under Network protection in the Settings tab.</div> : !events.length ? <div className={cl("empty")}>No blocks recorded in this session.</div> : !filteredEvents.length ? <div className={cl("empty")}>No matching categories. Try another filter.</div> : null}
                    {filteredEvents.map(event => <div className={cl("console-entry")} key={event.id}>
                        <time className={cl("console-time")} dateTime={new Date(event.time).toISOString()} title={moment(event.time).format("LLL")}>{moment(event.time).format("HH:mm:ss")}</time>
                        <span className={cl("console-label")}>Blocked</span>
                        <span className={cl("console-category")}>{event.category}</span>
                        <span className={cl("console-count")}>{event.count} {event.count === 1 ? "block" : "blocks"}</span>
                    </div>)}
                </div>
            </ScrollerThin>
            <details className={cl("details")}>
                <summary>What gets recorded</summary>
                <Paragraph>Only categories, times and counts are recorded. No domains, URLs, filenames, message text or account data. Consecutive blocks of the same category within ten seconds are grouped. Covers intercepted requests and browser API denials, not native Electron events. Up to 100 recent entries are retained for this session.</Paragraph>
            </details>
        </section>
    </section>;
}
