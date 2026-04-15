import { React } from "@webpack/common";
import { compareVersions } from "../utils/helpers";
import { showUpdateModal } from "./UpdateModal";
import { UPDATE_CHECK_URL, PLUGIN_VERSION } from "../constants";

export const VersionDisplay = () => {
    const [updateStatus, setUpdateStatus] = React.useState<string | null>(null);

    const checkUpdate = async () => {
        setUpdateStatus("Checking...");
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(UPDATE_CHECK_URL, {
                signal: controller.signal,
                headers: { 'Accept': 'application/vnd.github.v3+json' }
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                setUpdateStatus("Failed to check");
                return;
            }

            const data = await response.json();
            let latestVersion = data.tag_name || data.name || "";
            latestVersion = latestVersion.replace(/^v/i, '').trim();

            if (!latestVersion) {
                setUpdateStatus("No releases found");
                return;
            }

            const comparison = compareVersions(latestVersion, PLUGIN_VERSION);

            if (comparison > 0) {
                setUpdateStatus(`Update available: v${latestVersion}`);
                setTimeout(() => {
                    showUpdateModal(latestVersion, data.body || "No release notes available.");
                }, 500);
            } else {
                setUpdateStatus("You're up to date!");
            }
        } catch (e) {
            setUpdateStatus("Check failed");
        }
    };

    return (
        <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px",
            background: "var(--background-secondary)",
            borderRadius: "8px",
            marginBottom: "16px"
        }}>
            <div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--header-primary)" }}>
                    Server Cloner
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                    Version: <span style={{ color: "#5865f2", fontWeight: 600 }}>v{PLUGIN_VERSION}</span>
                    {updateStatus && (
                        <span style={{
                            marginLeft: "10px",
                            color: updateStatus.includes("available") ? "#43b581" :
                                updateStatus.includes("up to date") ? "#43b581" :
                                    updateStatus.includes("failed") || updateStatus.includes("Failed") ? "#f04747" : "var(--text-muted)"
                        }}>
                            • {updateStatus}
                        </span>
                    )}
                </div>
            </div>
            <button
                onClick={checkUpdate}
                disabled={updateStatus === "Checking..."}
                style={{
                    padding: "8px 16px",
                    borderRadius: "4px",
                    border: "none",
                    background: "#5865f2",
                    color: "white",
                    fontSize: "13px",
                    fontWeight: 500,
                    cursor: updateStatus === "Checking..." ? "not-allowed" : "pointer",
                    opacity: updateStatus === "Checking..." ? 0.7 : 1,
                    transition: "all 0.2s"
                }}
            >
                {updateStatus === "Checking..." ? "Checking..." : "Check for Updates"}
            </button>
        </div>
    );
};
