/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { Paragraph } from "@components/Paragraph";
import { EquicordDevs, IS_LINUX, IS_WINDOWS } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { chooseFile } from "@utils/web";
import { Button, useEffect, useState } from "@webpack/common";

import type { IconMode, IconResult } from "./native";

const Native = VencordNative.pluginHelpers.ClientIcon as PluginNative<typeof import("./native")>;
const logger = new Logger("ClientIcon");
const KEYS: Array<"mode"> = ["mode"];
const supported = IS_WINDOWS || IS_LINUX;
let started = false;

const settings = definePluginSettings({
    shortcuts: {
        type: OptionType.BOOLEAN,
        description: "Also update this client's desktop and application menu shortcuts.",
        default: true,
        disabled: !supported,
        onChange: () => { if (started) void applyIcon(settings.plain.mode ?? "illegalcord"); }
    }
}).withPrivateSettings<{ mode?: IconMode; }>();

async function applyIcon(mode: IconMode, data?: string): Promise<IconResult> {
    try {
        const result = await Native.configure(mode, settings.plain.shortcuts, data);
        if (result.success) {
            settings.store.mode = mode;
            if (result.failed) logger.warn("Some shortcuts could not be updated or restored.");
        } else logger.warn(result.error);
        return result;
    } catch {
        logger.error("Could not reach the native icon service.");
        return { success: false, error: "The icon service is unavailable. Restart the client and try again." };
    }
}

function IconSettings() {
    const { mode = "illegalcord" } = settings.use(KEYS);
    const [preview, setPreview] = useState("");
    const [client, setClient] = useState("");
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!supported) return;
        let cancelled = false;
        Native.preview(mode).then(result => {
            if (cancelled) return;
            if (result.success) {
                setPreview(result.preview);
                setClient(result.client);
            } else setMessage(result.error);
        }).catch(() => { if (!cancelled) setMessage("The icon preview is unavailable. Restart the client and try again."); });
        return () => { cancelled = true; };
    }, [mode]);

    async function changeIcon(nextMode: IconMode) {
        try {
            let data: string | undefined;
            if (nextMode === "custom") {
                const file = await chooseFile("image/png,.png");
                if (!file) return;
                if (file.size > 2 * 1024 * 1024) {
                    setMessage("Choose a PNG image up to 2 MB.");
                    return;
                }
                setBusy(true);
                data = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Invalid image."));
                    reader.onerror = () => reject(reader.error);
                    reader.readAsDataURL(file);
                });
            }
            setBusy(true);
            const result = await applyIcon(nextMode, data);
            if (!result.success) {
                setMessage(result.error);
                return;
            }
            setPreview(result.preview);
            setClient(result.client);
            setMessage(result.failed
                ? "The window icon was updated, but some shortcuts could not be updated or restored. You can retry with the same button."
                : `${nextMode === "original" ? "Original icon restored" : "Icon applied"}. Shortcuts updated: ${result.changed}.`);
        } catch {
            setMessage("The image could not be read. Try another PNG file.");
        } finally {
            setBusy(false);
        }
    }

    if (!supported) return <Paragraph>ClientIcon supports Windows and Linux.</Paragraph>;

    return <>
        <Paragraph>Choose an icon for the current client. Your selection is applied on startup. PNG images must be no larger than 2 MB and 4096 pixels per side.</Paragraph>
        <Flex alignItems="center">
            {preview ? <img src={preview} width={64} height={64} alt="Current client icon" /> : null}
            <Paragraph>{client || "Current client"}</Paragraph>
        </Flex>
        <Flex flexWrap="wrap">
            <Button disabled={busy} onClick={() => changeIcon("illegalcord")}>Use Illegalcord icon</Button>
            <Button disabled={busy} onClick={() => changeIcon("custom")}>Choose PNG</Button>
            <Button disabled={busy} onClick={() => changeIcon("original")}>Restore original</Button>
        </Flex>
        {message ? <Paragraph role="status">{message}</Paragraph> : null}
        <Paragraph>{IS_LINUX
            ? "Application menu changes use local launcher overrides. On Wayland, the dock may use the launcher icon and require a client restart. Sandboxed installations may restrict access to launchers. The tray icon is unchanged."
            : "The running client's taskbar icon is updated too. Enable shortcut updates to keep the icon when the client is closed. If a pinned icon stays unchanged, unpin the client and pin it again. The tray icon next to the clock is unchanged."}</Paragraph>
    </>;
}

export default definePlugin({
    name: "ClientIcon",
    description: "Changes the current client's window and shortcut icons on Windows and Linux.",
    authors: [EquicordDevs.irritably],
    settings,
    settingsAboutComponent: ErrorBoundary.wrap(IconSettings, { noop: true }),
    async start() {
        if (!supported) return;
        started = true;
        await applyIcon(settings.plain.mode ?? "illegalcord");
    },
    async stop() {
        started = false;
        if (!supported) return;
        try {
            const result = await Native.configure("original", false);
            if (!result.success) logger.warn(result.error);
            else if (result.failed) logger.warn("Some shortcut icons could not be restored. Enable ClientIcon and try Restore original.");
        } catch {
            logger.error("Could not restore the original client icon.");
        }
    }
});
