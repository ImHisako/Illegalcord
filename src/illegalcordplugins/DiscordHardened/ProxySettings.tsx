/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { Margins } from "@utils/margins";
import type { PluginNative } from "@utils/types";
import { React, TextInput, useEffect, useState } from "@webpack/common";

import { settings } from "./index";
import { getHttpProxyEndpoint } from "./proxy";

const Native = VencordNative.pluginHelpers.DiscordHardened as PluginNative<typeof import("./native")> | undefined;
const PROXY_KEYS: ["proxyRules"] = ["proxyRules"];

export function ProxySettings() {
    const { proxyRules } = settings.use(PROXY_KEYS);
    const endpoint = getHttpProxyEndpoint(proxyRules);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [savedFor, setSavedFor] = useState<string | null>(null);
    const [busy, setBusy] = useState(true);
    const [status, setStatus] = useState("");

    useEffect(() => {
        if (!Native) return;
        let active = true;
        Native.getProxyLogin().then(value => {
            if (active) setSavedFor(value);
        }).catch(() => {
            if (active) setStatus("Could not read the saved proxy settings.");
        }).finally(() => {
            if (active) setBusy(false);
        });
        return () => { active = false; };
    }, []);

    async function updateLogin(remove: boolean) {
        if (!Native || (!remove && !endpoint)) return;
        setBusy(true);
        try {
            const result = remove ? await Native.deleteProxyLogin() : await Native.saveProxyLogin(proxyRules, username, password);
            if (result !== true) {
                setStatus(typeof result === "string" ? result : "Could not remove proxy credentials.");
                return;
            }
            setSavedFor(remove ? null : endpoint?.origin ?? null);
            setUsername("");
            setPassword("");
            setStatus(remove ? "Credentials removed. Restart Discord to apply the change." : "Credentials saved. Restart Discord to apply the change.");
        } catch {
            setStatus("Could not update proxy credentials.");
        } finally {
            setBusy(false);
        }
    }

    if (!Native) return null;
    return <div>
        <Paragraph className={Margins.bottom8}>Optional login for a single HTTP or HTTPS proxy. Credentials are encrypted and saved on this device.</Paragraph>
        {savedFor ? <Paragraph className={Margins.bottom8}>Credentials saved for {savedFor}.</Paragraph> : null}
        {endpoint ? <>
            <TextInput value={username} onChange={setUsername} placeholder="Proxy username" aria-label="Proxy username" autoComplete="off" maxLength={1024} disabled={busy} />
            <div className={Margins.top8}>
                <TextInput type="password" value={password} onChange={setPassword} placeholder="Proxy password" aria-label="Proxy password" autoComplete="off" maxLength={1024} disabled={busy} />
            </div>
            <Button className={Margins.top8} onClick={() => void updateLogin(false)} disabled={busy || !username}>Save proxy credentials</Button>
        </> : null}
        {savedFor ? <Button className={Margins.top8} variant="secondary" onClick={() => void updateLogin(true)} disabled={busy}>Remove proxy credentials</Button> : null}
        {status ? <Paragraph className={Margins.top8} role="status">{status}</Paragraph> : null}
    </div>;
}
