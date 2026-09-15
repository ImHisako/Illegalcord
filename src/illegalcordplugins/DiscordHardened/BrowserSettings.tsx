/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Paragraph } from "@components/Paragraph";
import { Margins } from "@utils/margins";
import type { PluginNative } from "@utils/types";
import { Button, React, Select, useEffect, useState } from "@webpack/common";

import type { InstalledBrowser } from "./browsers";
import { settings } from "./index";

const Native = VencordNative.pluginHelpers.DiscordHardened as PluginNative<typeof import("./native")> | undefined;
const BROWSER_KEYS: ["externalBrowser"] = ["externalBrowser"];

function describeProtection(value: boolean | null): string {
    return value === null ? "unavailable" : value ? "enabled" : "disabled";
}

export function BrowserSettings() {
    const { externalBrowser } = settings.use(BROWSER_KEYS);
    const [browsers, setBrowsers] = useState<InstalledBrowser[]>([]);
    const [loading, setLoading] = useState(true);
    const [refresh, setRefresh] = useState(0);
    const [failed, setFailed] = useState(false);
    const [security, setSecurity] = useState<Awaited<ReturnType<NonNullable<typeof Native>["getSecurityStatus"]>>>(null);

    useEffect(() => {
        let active = true;
        if (!Native) {
            setLoading(false);
            setFailed(true);
            return;
        }
        setLoading(true);
        setFailed(false);
        Promise.all([Native.getInstalledBrowsers(), Native.getSecurityStatus()]).then(([installed, status]) => {
            if (!active) return;
            setBrowsers(installed);
            setSecurity(status);
        }).catch(() => {
            if (active) setFailed(true);
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, [refresh]);

    return <>
        <Select
            options={[{ label: "System default", value: "system" }, ...browsers.map(browser => ({ label: browser.name, value: browser.id }))]}
            isSelected={(value: string) => value === externalBrowser}
            select={(value: string) => { settings.store.externalBrowser = value; }}
            serialize={(value: string) => value}
            placeholder={loading ? "Detecting installed browsers..." : "Select an installed browser"}
            isDisabled={loading || failed}
        />
        <Button className={Margins.top8} onClick={() => setRefresh(value => value + 1)} disabled={loading}>Refresh installed browsers</Button>
        {failed ? <Paragraph>Could not detect installed browsers. Try refreshing the list.</Paragraph> : null}
        {!loading && !failed && externalBrowser !== "system" && !browsers.some(browser => browser.id === externalBrowser)
            ? <Paragraph>The selected browser is unavailable. Links stay blocked until you select an available browser.</Paragraph> : null}
        <Paragraph>Detects registered browsers and standard installation folders. Portable installations in other folders may not appear. Choosing Tor Browser only routes opened links through that browser, not Discord traffic.</Paragraph>
        {security ? <>
            <Paragraph>Current window: Node integration {describeProtection(security.nodeIntegration)}; context isolation {describeProtection(security.contextIsolation)}; web security {describeProtection(security.webSecurity)}; renderer sandbox {describeProtection(security.sandbox)}.</Paragraph>
            {security.sandbox === false ? <Paragraph>The current Illegalcord preload requires an unsandboxed renderer. Minimum privilege cannot enable its sandbox without replacing the loader.</Paragraph> : null}
        </> : null}
    </>;
}
