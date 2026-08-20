/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, React } from "@webpack/common";

import { PLUGIN_VERSION, UPDATE_CHECK_URL } from "../constants";
import { compareVersions } from "../utils/helpers";
import { showUpdateModal } from "./UpdateModal";

type UpdateStatus = "idle" | "checking" | "up-to-date" | "available" | "failed";

interface GitHubRelease {
    body?: string;
    name?: string;
    tag_name?: string;
}

function isGitHubRelease(value: unknown): value is GitHubRelease {
    if (typeof value !== "object" || value === null) return false;
    const release = value as Record<string, unknown>;
    return (release.body === undefined || typeof release.body === "string")
        && (release.name === undefined || typeof release.name === "string")
        && (release.tag_name === undefined || typeof release.tag_name === "string");
}

export const VersionDisplay = () => {
    const [status, setStatus] = React.useState<UpdateStatus>("idle");
    const [latestVer, setLatestVer] = React.useState<string | null>(null);
    const controllerRef = React.useRef<AbortController | null>(null);

    React.useEffect(() => () => controllerRef.current?.abort(), []);

    async function checkUpdate(): Promise<void> {
        setStatus("checking");
        const controller = new AbortController();
        controllerRef.current = controller;
        let timedOut = false;
        const timeoutId = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, 5000);

        try {
            const response = await fetch(UPDATE_CHECK_URL, {
                signal: controller.signal,
                headers: { Accept: "application/vnd.github.v3+json" },
            });

            if (!response.ok) {
                setStatus("failed");
                return;
            }

            const value: unknown = await response.json();
            if (!isGitHubRelease(value)) {
                setStatus("failed");
                return;
            }

            const ver = (value.tag_name || value.name || "").replace(/^v/i, "").trim();

            if (!ver) {
                setStatus("failed");
                return;
            }

            if (compareVersions(ver, PLUGIN_VERSION) > 0) {
                setLatestVer(ver);
                setStatus("available");
                showUpdateModal(ver, value.body || "No release notes available.");
            } else {
                setStatus("up-to-date");
            }
        } catch (error: unknown) {
            if (timedOut || !(error instanceof DOMException && error.name === "AbortError")) setStatus("failed");
        } finally {
            clearTimeout(timeoutId);
            if (controllerRef.current === controller) controllerRef.current = null;
        }
    }

    const statusLabel = React.useMemo(() => {
        switch (status) {
            case "checking": return { text: "Checking...", color: "var(--text-muted)" };
            case "up-to-date": return { text: "You're up to date!", color: "var(--text-positive)" };
            case "available": return { text: `Update available: v${latestVer}`, color: "var(--text-warning)" };
            case "failed": return { text: "Check failed", color: "var(--status-danger)" };
            default: return null;
        }
    }, [status, latestVer]);

    return (
        <div className="vc-server-cloner-version">
            <div>
                <div className="vc-server-cloner-version-title">Server Cloner</div>
                <div className="vc-server-cloner-version-status">
                    <span>v{PLUGIN_VERSION}</span>
                    {statusLabel && (
                        <span style={{ color: statusLabel.color }}>
                            &nbsp;• {statusLabel.text}
                        </span>
                    )}
                </div>
            </div>

            <Button
                onClick={checkUpdate}
                disabled={status === "checking"}
            >
                {status === "checking" ? "Checking…" : "Check for Updates"}
            </Button>
        </div>
    );
};
