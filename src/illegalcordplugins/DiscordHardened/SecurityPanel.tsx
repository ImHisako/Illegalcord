/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { Notice } from "@components/Notice";
import { Paragraph } from "@components/Paragraph";
import { Margins } from "@utils/margins";
import { useFixedTimer } from "@utils/react";
import { formatDuration } from "@utils/text";
import type { PluginNative } from "@utils/types";
import { Button, moment, React, Select, useEffect, useState } from "@webpack/common";

import { settings } from "./index";
import { getRuntimeProtections } from "./runtime";
import { clearBlockLog, getBlockLog, getTemporaryPermissions, grantTemporaryPermission, revokeTemporaryPermission, TEMPORARY_PERMISSIONS, type TemporaryPermission } from "./session";

const Native = VencordNative.pluginHelpers.DiscordHardened as PluginNative<typeof import("./native")> | undefined;
const PANEL_KEYS: Array<TemporaryPermission | "recordBlockedEvents"> = ["recordBlockedEvents", "allowCamera", "allowMicrophone", "allowDisplayCapture", "allowClipboardRead", "allowDeviceEnumeration", "allowSpeakerSelection"];
const PERMISSION_OPTIONS = Object.entries(TEMPORARY_PERMISSIONS).map(([value, label]) => ({ value: value as TemporaryPermission, label }));
const DURATION_OPTIONS = [1, 5, 15].map(value => ({ value, label: `${value} ${value === 1 ? "minute" : "minutes"}` }));

export function SecurityPanel() {
    const options = settings.use(PANEL_KEYS);
    const [permission, setPermission] = useState<TemporaryPermission>("allowClipboardRead");
    const [minutes, setMinutes] = useState(5);
    const [revision, setRevision] = useState(0);
    const [security, setSecurity] = useState<Awaited<ReturnType<NonNullable<typeof Native>["getSecurityStatus"]>>>(null);
    const [loading, setLoading] = useState(Boolean(Native));
    const [grantFailed, setGrantFailed] = useState(false);
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
    const desktopChecks = security ? [
        { name: "Node integration disabled", active: security.nodeIntegration === null ? null : !security.nodeIntegration },
        { name: "Context isolation", active: security.contextIsolation },
        { name: "Web security", active: security.webSecurity },
        { name: "Renderer sandbox", active: security.sandbox },
        { name: "External navigation blocking", active: security.navigationRestricted },
        { name: "Electron webview blocking", active: security.webviewsBlocked },
    ] : [];

    return <section className={Margins.bottom20}>
        <Heading tag="h3">Protection status</Heading>
        <Paragraph>Active means the selected browser API guard is still installed and its restriction is enabled. Disabled includes temporary permissions. Unavailable means the browser does not expose that API. Not applied means a guard failed or was replaced. These checks cover this window, not other frames or every native Discord API.</Paragraph>
        {getRuntimeProtections().map(protection => <Flex key={protection.name} justifyContent="space-between">
            <Paragraph>{protection.name}</Paragraph><Paragraph><strong>{protection.status}</strong></Paragraph>
        </Flex>)}
        <Heading tag="h4">Desktop snapshot</Heading>
        {loading ? <Paragraph>Checking desktop protections...</Paragraph> : security ? <>
            {desktopChecks.map(check => <Flex key={check.name} justifyContent="space-between">
                <Paragraph>{check.name}</Paragraph><Paragraph><strong>{check.active === null ? "Unavailable" : check.active ? "Active" : "Not active"}</strong></Paragraph>
            </Flex>)}
            {security.sandbox === false ? <Notice.Warning>The current Illegalcord loader requires an unsandboxed renderer. The sandbox is not active.</Notice.Warning> : null}
        </> : <Paragraph>Desktop protections could not be verified in this window.</Paragraph>}
        <Button className={Margins.top8} onClick={() => setRevision(value => value + 1)} disabled={!Native || loading}>Refresh desktop status</Button>

        <Heading tag="h3" className={Margins.top20}>Temporary permissions</Heading>
        <Paragraph>Allow one capability in this window for a limited time. Browser permission prompts still apply. Saved preferences stay unchanged. Mute and push to talk protections still apply. Temporary capture tracks and their clones stop when the grant expires, is revoked or the plugin stops.</Paragraph>
        <Select
            options={PERMISSION_OPTIONS}
            isSelected={(value: TemporaryPermission) => value === permission}
            select={(value: TemporaryPermission) => { setPermission(value); setGrantFailed(false); }}
            serialize={(value: TemporaryPermission) => value}
        />
        <div className={Margins.top8}>
            <Select options={DURATION_OPTIONS} isSelected={(value: number) => value === minutes} select={setMinutes} serialize={(value: number) => String(value)} />
        </div>
        <Button className={Margins.top8} disabled={options[permission]} onClick={() => setGrantFailed(!grantTemporaryPermission(permission, minutes))}>Allow temporarily</Button>
        {options[permission] ? <Paragraph>This capability is already allowed in your saved preferences. Disable it below to use temporary grants.</Paragraph> : null}
        {grantFailed ? <Paragraph>The temporary permission could not be granted. Enable DiscordHardened first.</Paragraph> : null}
        {grants.length ? grants.map(grant => <Flex key={grant.permission} className={Margins.top8} alignItems="center" justifyContent="space-between">
            <Paragraph>{TEMPORARY_PERMISSIONS[grant.permission]}: {formatDuration(Math.max(0, grant.expiresAt - Date.now()))} remaining.</Paragraph>
            <Button onClick={() => revokeTemporaryPermission(grant.permission)}>Revoke</Button>
        </Flex>) : <Paragraph>No temporary permissions are active.</Paragraph>}

        <Heading tag="h3" className={Margins.top20}>Local block log</Heading>
        <Paragraph>Stores up to 100 recent entries in memory for this session. Only categories, times and counts are recorded. No domains, URLs, filenames, message text or account data. Consecutive blocks of the same category within ten seconds are grouped. Covers intercepted requests and browser API denials, not native Electron events.</Paragraph>
        <Button onClick={clearBlockLog} disabled={!events.length}>Clear log</Button>
        {!options.recordBlockedEvents ? <Paragraph>Recording is disabled. Enable it under Network protection.</Paragraph> : !events.length ? <Paragraph>No blocks recorded in this session.</Paragraph> : null}
        {events.map(event => <Paragraph key={event.id}>
            {moment(event.time).format("HH:mm:ss")} · {event.category} · {event.count} {event.count === 1 ? "block" : "blocks"}
        </Paragraph>)}
    </section>;
}
