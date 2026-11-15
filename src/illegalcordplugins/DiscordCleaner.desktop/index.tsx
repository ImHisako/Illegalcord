/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import { EquicordDevs } from "@utils/constants";
import { Margins } from "@utils/margins";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { React, useState } from "@webpack/common";

import { frequencies } from "./schedule";

const Native = VencordNative.pluginHelpers.DiscordCleaner as PluginNative<typeof import("./native")>;
const CLEANUP_KEYS: ["cache", "logs", "temporary"] = ["cache", "logs", "temporary"];

const settings = definePluginSettings({
    frequency: {
        type: OptionType.SELECT,
        displayName: "Cleanup frequency",
        description: "Schedule cleanup while Discord is running. Immediate mode reacts to new cache files, logs and temporary files. All selected items are also checked every minute.",
        options: frequencies,
    },
    cache: {
        type: OptionType.BOOLEAN,
        description: "Clear browser, code and shader caches.",
        default: true,
    },
    logs: {
        type: OptionType.BOOLEAN,
        description: "Remove Discord logs and WebRTC diagnostics.",
        default: true,
    },
    temporary: {
        type: OptionType.BOOLEAN,
        description: "Remove temporary files older than 24 hours or as soon as they are created in immediate mode. Crash dumps are removed after 24 hours.",
        default: true,
    },
});

function CleanerSettings() {
    const { cache, logs, temporary } = settings.use(CLEANUP_KEYS);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");

    async function clean() {
        setBusy(true);
        setStatus("");
        try {
            const result = await Native.clean(cache, logs, temporary);
            if (!result.success) {
                setStatus(result.error);
                return;
            }
            const { files, failedCaches } = result;
            const summary: string[] = [];
            if (cache) summary.push(failedCaches.length ? `Could not clear ${failedCaches.join(", ")}.` : "Cleared browser caches.");
            if (logs || temporary) {
                summary.push(files.removed === 1 ? "Removed 1 file." : `Removed ${files.removed} files.`);
                if (files.failed) summary.push("Some files or folders could not be accessed. You can try again after restarting Discord.");
            }
            setStatus(summary.join(" "));
        } catch {
            setStatus("Could not reach the cleanup service. Restart Discord and try again.");
        } finally {
            setBusy(false);
        }
    }

    return <>
        <Paragraph className={Margins.bottom8}>Free up space used by this Discord client. Your sign in, settings and downloads are kept.</Paragraph>
        <Paragraph>Cleanup removes leftover files. Preventing remote code execution (RCE) requires security updates and mitigations in Discord and Electron.</Paragraph>
        <Button className={Margins.top8} onClick={() => void clean()} disabled={busy || !(cache || logs || temporary)}>
            {busy ? "Cleaning Discord files…" : "Clean Discord files"}
        </Button>
        {status ? <Paragraph className={Margins.top8} role="status">{status}</Paragraph> : null}
    </>;
}

export default definePlugin({
    name: "DiscordCleaner",
    description: "Clears Discord cache, logs and old temporary files on Windows, Linux and macOS.",
    authors: [EquicordDevs.irritably],
    settings,
    settingsAboutComponent: ErrorBoundary.wrap(CleanerSettings, { noop: true }),
});
