import { React } from "@webpack/common";
import { compareVersions } from "../utils/helpers";
import { showUpdateModal } from "./UpdateModal";
import { UPDATE_CHECK_URL, PLUGIN_VERSION } from "../constants";

type UpdateStatus = "idle" | "checking" | "up-to-date" | "available" | "failed";

export const VersionDisplay = () => {
    const [status, setStatus]           = React.useState<UpdateStatus>("idle");
    const [latestVer, setLatestVer]     = React.useState<string | null>(null);

    const checkUpdate = React.useCallback(async () => {
        setStatus("checking");
        try {
            const controller = new AbortController();
            const timeoutId  = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(UPDATE_CHECK_URL, {
                signal: controller.signal,
                headers: { Accept: "application/vnd.github.v3+json" },
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                setStatus("failed");
                return;
            }

            const data = await response.json();
            let ver = (data.tag_name || data.name || "").replace(/^v/i, "").trim();

            if (!ver) {
                setStatus("failed");
                return;
            }

            if (compareVersions(ver, PLUGIN_VERSION) > 0) {
                setLatestVer(ver);
                setStatus("available");
                setTimeout(() => showUpdateModal(ver, data.body || "No release notes available."), 500);
            } else {
                setStatus("up-to-date");
            }
        } catch {
            setStatus("failed");
        }
    }, []);

    const statusLabel = React.useMemo(() => {
        switch (status) {
            case "checking":   return { text: "Checking...",              color: "var(--text-muted)" };
            case "up-to-date": return { text: "You're up to date!",       color: "var(--text-positive)" };
            case "available":  return { text: `Update available: v${latestVer}`, color: "#ffaa00" };
            case "failed":     return { text: "Check failed",             color: "var(--status-danger)" };
            default:           return null;
        }
    }, [status, latestVer]);

    return (
        <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            background: "var(--background-secondary)",
            borderRadius: "8px",
            marginBottom: "16px",
        }}>
            <div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-normal)" }}>
                    Server Cloner
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-link)", marginTop: "3px", display: "flex", alignItems: "center", gap: "4px" }}>
                    <span>v{PLUGIN_VERSION}</span>
                    {statusLabel && (
                        <span style={{ color: statusLabel.color }}>
                            &nbsp;• {statusLabel.text}
                        </span>
                    )}
                </div>
            </div>

            <button
                onClick={checkUpdate}
                disabled={status === "checking"}
                style={{
                    padding: "7px 14px",
                    borderRadius: "6px",
                    border: "none",
                    background: status === "checking" ? "var(--background-modifier-accent)" : "#5865f2",
                    color: "white",
                    fontSize: "13px",
                    fontWeight: 500,
                    cursor: status === "checking" ? "not-allowed" : "pointer",
                    opacity: status === "checking" ? 0.65 : 1,
                    transition: "background 0.15s ease, opacity 0.15s ease",
                }}
            >
                {status === "checking" ? "Checking…" : "Check for Updates"}
            </button>
        </div>
    );
};