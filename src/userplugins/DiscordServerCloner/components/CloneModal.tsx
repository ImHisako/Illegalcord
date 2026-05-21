/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Guild, RenderModalProps } from "@vencord/discord-types";
import { Checkbox, GuildRoleStore, GuildStore, Modal, openModal,React, SearchableSelect, UserStore } from "@webpack/common";

import { CloneOptions } from "../types";
import { extractChannels } from "../utils/api";

export const CloneModal = ({ props, guild, onClone }: { props: RenderModalProps; guild: Guild; onClone: (options: CloneOptions) => void; }) => {
    const [cloneChannels, setCloneChannels] = React.useState(true);
    const [cloneRoles, setCloneRoles] = React.useState(true);
    const [cloneOnboarding, setCloneOnboarding] = React.useState(true);
    const [cloneSystemFlags, setCloneSystemFlags] = React.useState(true);

    const [resumeMode, setResumeMode] = React.useState(false);
    const [targetGuildId, setTargetGuildId] = React.useState<string | null>(null);

    const canOnboarding = cloneChannels && cloneRoles;

    React.useEffect(() => {
        if (!canOnboarding) setCloneOnboarding(false);
    }, [canOnboarding]);

    const ownedGuilds = React.useMemo(() => {
        const allGuilds = Object.values(GuildStore.getGuilds()) as Guild[];
        return allGuilds.filter(g => g.id !== guild.id && g.ownerId === UserStore.getCurrentUser()?.id);
    }, [guild.id]);

    const nothingSelected = !cloneChannels && !cloneRoles && !cloneOnboarding && !cloneSystemFlags;

    const estimatedTime = React.useMemo(() => {
        const roleCount = cloneRoles ? (GuildRoleStore.getSortedRoles(guild.id) || []).filter((r: any) => r.name !== "@everyone").length : 0;
        const channelCount = cloneChannels ? extractChannels(guild.id, false).length : 0;
        const onboardingEstimate = cloneOnboarding ? 2 : 0;

        const perItemDelay = 1.5;
        const setupTime = 5;
        const deleteTime = (targetGuildId && !resumeMode) ? (channelCount * 1.2 + roleCount * 1.2) : 0;

        const totalSeconds = setupTime + deleteTime + (roleCount * perItemDelay) + (channelCount * perItemDelay) + (onboardingEstimate * perItemDelay);

        if (totalSeconds < 60) return `~${Math.ceil(totalSeconds)}s`;
        const mins = Math.floor(totalSeconds / 60);
        const secs = Math.ceil(totalSeconds % 60);
        return secs > 0 ? `~${mins}m ${secs}s` : `~${mins}m`;
    }, [guild.id, cloneRoles, cloneChannels, cloneOnboarding, targetGuildId, resumeMode]);

    const handleClone = () => {
        if (nothingSelected) return;
        if (targetGuildId && !resumeMode) {
            const targetName = ownedGuilds.find((g: Guild) => g.id === targetGuildId)?.name || "the target server";
            const deletingParts: string[] = [];
            if (cloneChannels) deletingParts.push("channels");
            if (cloneRoles) deletingParts.push("roles");
            const deletingText = deletingParts.join(", ");
            props.onClose();
            openModal(confirmProps => (
                <Modal
                    {...confirmProps}
                    title={<span style={{ color: "#f04747", fontSize: "20px", fontWeight: 600 }}>⚠️ Confirm Overwrite</span>}
                    actions={[
                        {
                            text: "Cancel",
                            variant: "secondary",
                            onClick: confirmProps.onClose
                        },
                        {
                            text: "Delete & Overwrite",
                            variant: "critical-primary",
                            onClick: () => {
                                onClone({ cloneChannels, cloneRoles, cloneOnboarding, cloneSystemFlags, resumeMode: false, targetGuildId });
                                confirmProps.onClose();
                            }
                        }
                    ]}
                >
                    <div style={{ padding: "16px 0", fontSize: "14px", color: "#ffffff", lineHeight: 1.6 }}>
                        <p>This will <strong style={{ color: "#f04747" }}>permanently delete</strong> all {deletingText} in <strong>{targetName}</strong> and replace them with data from <strong>{guild.name}</strong>.</p>
                        <p style={{ marginTop: "12px", color: "#a0a3a6" }}>This action cannot be undone.</p>
                    </div>
                </Modal>
            ));
        } else {
            onClone({ cloneChannels, cloneRoles, cloneOnboarding, cloneSystemFlags, resumeMode, targetGuildId });
            props.onClose();
        }
    };

    return (
        <Modal
            {...props}
            title={<span style={{ color: "#fff", fontSize: "20px", fontWeight: 600 }}>Clone Server: {guild.name}</span>}
            actionBarInput={!nothingSelected && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px", background: "rgba(88,101,242,0.1)", borderRadius: "8px", fontSize: "13px", color: "#b5bac1" }}>
                    <span style={{ fontSize: "16px" }}>⏱️</span>
                    <span>Estimated time: <strong style={{ color: "#fff" }}>{estimatedTime}</strong></span>
                </div>
            )}
            actions={[
                {
                    text: "Cancel",
                    variant: "secondary",
                    onClick: props.onClose
                },
                {
                    text: targetGuildId ? (resumeMode ? "Resume Clone" : "Overwrite & Clone") : "Create & Clone",
                    variant: "primary",
                    disabled: nothingSelected,
                    onClick: handleClone
                }
            ]}
        >
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "8px 0", minHeight: "450px" }}>

                    <div>
                        <span style={{ color: "#fff", fontSize: "14px", fontWeight: 600, marginBottom: "8px", display: "block" }}>Clone To:</span>
                        <SearchableSelect
                            options={[
                                { value: "new", label: "Create New Server" },
                                ...ownedGuilds.map((g: Guild) => ({ value: g.id, label: g.name }))
                            ]}
                            value={{ value: targetGuildId || "new", label: targetGuildId ? ownedGuilds.find((g: Guild) => g.id === targetGuildId)?.name || "Server" : "Create New Server" }}
                            placeholder="Select destination..."
                            maxVisibleItems={5}
                            closeOnSelect={true}
                            onChange={(v: string) => {
                                setTargetGuildId(v === "new" ? null : v);
                                if (v === "new") setResumeMode(false);
                            }}
                        />
                        {targetGuildId && !resumeMode && (
                            <div style={{ fontSize: "12px", color: "#f04747", marginTop: "6px" }}>
                                ⚠️ Warning: Selected items in the target server will be deleted and replaced!
                            </div>
                        )}
                        {targetGuildId && resumeMode && (
                            <div style={{ fontSize: "12px", color: "#43b581", marginTop: "6px" }}>
                                ✓ Resume mode: Only missing items will be added, nothing will be deleted.
                            </div>
                        )}
                    </div>

                    {targetGuildId && (
                        <div style={{ display: "flex", gap: "8px" }}>
                            <button
                                onClick={() => setResumeMode(false)}
                                style={{
                                    flex: 1, padding: "10px", borderRadius: "8px", border: "2px solid",
                                    borderColor: !resumeMode ? "#5865f2" : "var(--background-modifier-accent)",
                                    background: !resumeMode ? "rgba(88,101,242,0.15)" : "var(--background-secondary)",
                                    color: !resumeMode ? "#5865f2" : "var(--text-muted)",
                                    cursor: "pointer", fontWeight: 600, fontSize: "13px", transition: "all 0.2s"
                                }}
                            >
                                Overwrite
                            </button>
                            <button
                                onClick={() => setResumeMode(true)}
                                style={{
                                    flex: 1, padding: "10px", borderRadius: "8px", border: "2px solid",
                                    borderColor: resumeMode ? "#43b581" : "var(--background-modifier-accent)",
                                    background: resumeMode ? "rgba(67,181,129,0.15)" : "var(--background-secondary)",
                                    color: resumeMode ? "#43b581" : "var(--text-muted)",
                                    cursor: "pointer", fontWeight: 600, fontSize: "13px", transition: "all 0.2s"
                                }}
                            >
                                Resume
                            </button>
                        </div>
                    )}

                    <div style={{ background: "var(--background-secondary)", padding: "12px", borderRadius: "8px", fontSize: "13px", color: "#dbdee1" }}>
                        <strong style={{ color: "#fff" }}>Note:</strong> Server Icon, Name, Banner, Splash, Description{cloneSystemFlags ? ", and System Channel Flags" : ""} will always be cloned.
                    </div>

                    <div>
                        <span style={{ color: "#fff", fontSize: "14px", fontWeight: 600, marginBottom: "8px", display: "block" }}>Core:</span>
                        <Checkbox
                            value={cloneChannels}
                            type="inverted"
                            onChange={(_: any, val: boolean) => setCloneChannels(val)}
                        >
                            <span style={{ color: "#fff", fontWeight: 500 }}>Channels</span>
                            <span style={{ fontSize: "12px", color: "#b5bac1", display: "block", marginTop: "2px" }}>
                                All channel types with topics, positions, and settings
                            </span>
                        </Checkbox>

                        <Checkbox
                            value={cloneRoles}
                            type="inverted"
                            onChange={(_: any, val: boolean) => setCloneRoles(val)}
                        >
                            <span style={{ color: "#fff", fontWeight: 500 }}>Roles</span>
                            <span style={{ fontSize: "12px", color: "#b5bac1", display: "block", marginTop: "2px" }}>
                                With permissions, colors, and icons
                            </span>
                        </Checkbox>
                    </div>

                    <div>
                        <span style={{ color: "#fff", fontSize: "14px", fontWeight: 600, marginBottom: "8px", display: "block" }}>Server Settings:</span>

                        <Checkbox
                            value={cloneOnboarding}
                            type="inverted"
                            onChange={(_: any, val: boolean) => setCloneOnboarding(val)}
                            disabled={!canOnboarding}
                        >
                            <span style={{ color: canOnboarding ? "#fff" : "#72767d", fontWeight: 500 }}>Onboarding</span>
                            <span style={{ fontSize: "12px", color: canOnboarding ? "#b5bac1" : "#72767d", display: "block", marginTop: "2px" }}>
                                {canOnboarding ? "Welcome prompts, default channels, and customization" : "⚠️ Requires both Channels and Roles"}
                            </span>
                        </Checkbox>

                        <Checkbox
                            value={cloneSystemFlags}
                            type="inverted"
                            onChange={(_: any, val: boolean) => setCloneSystemFlags(val)}
                        >
                            <span style={{ color: "#fff", fontWeight: 500 }}>System Channel Flags</span>
                            <span style={{ fontSize: "12px", color: "#b5bac1", display: "block", marginTop: "2px" }}>
                                Join/boost notification toggles
                            </span>
                        </Checkbox>
                    </div>

                    {(() => {
                        const sourceTier = (guild as any).premiumTier || 0;
                        const boostFeatures: string[] = [];
                        if ((guild as any).banner) boostFeatures.push("Server Banner (Level 2)");
                        if ((guild as any).splash) boostFeatures.push("Invite Splash (Level 2)");
                        const roles = GuildRoleStore.getSortedRoles(guild.id) || [];
                        if (roles.some((r: any) => r.icon)) boostFeatures.push("Role Icons (Level 2)");
                        if (sourceTier >= 1) boostFeatures.push("High Bitrate Voice (Level 1+)");

                        if (boostFeatures.length === 0) return null;

                        const targetGuild = targetGuildId ? GuildStore.getGuild(targetGuildId) : null;
                        const targetTier = targetGuild ? (targetGuild as any).premiumTier || 0 : 0;
                        const isNewServer = !targetGuildId;

                        if (!isNewServer && targetTier >= sourceTier) return null;

                        return (
                            <div style={{ background: "rgba(250,166,26,0.1)", border: "1px solid rgba(250,166,26,0.3)", padding: "12px", borderRadius: "8px", fontSize: "12px", color: "#faa61a" }}>
                                <strong style={{ display: "block", marginBottom: "6px" }}>⚡ Boost-Dependent Features:</strong>
                                <div style={{ color: "#dbdee1", lineHeight: 1.7 }}>
                                    {boostFeatures.map((f, i) => (
                                        <div key={i}>• {f}</div>
                                    ))}
                                </div>
                                <div style={{ marginTop: "8px", color: "#faa61a", fontStyle: "italic" }}>
                                    {isNewServer
                                        ? "⚠️ New servers have no boosts — these features will be skipped."
                                        : `⚠️ Target server is Level ${targetTier}, source is Level ${sourceTier} — some features may fail.`
                                    }
                                </div>
                            </div>
                        );
                    })()}

            </div>
        </Modal>
    );
};
