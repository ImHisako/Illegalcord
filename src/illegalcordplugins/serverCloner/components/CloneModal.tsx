/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { getTheme, Theme } from "@utils/discord";
import { Guild, RenderModalProps } from "@vencord/discord-types";
import { Button, Checkbox, GuildRoleStore, GuildStore, Modal, openModal, React, RestAPI, SearchableSelect, UserStore } from "@webpack/common";
import type { PointerEvent } from "react";

import { CloneOptions } from "../types";
import { extractChannels } from "../utils/api";

interface ConfirmOverwriteModalProps {
    deletingText: string;
    onConfirm: () => void;
    props: RenderModalProps;
    sourceName: string;
    targetName: string;
}

function ConfirmOverwriteModal({
    props,
    targetName,
    sourceName,
    deletingText,
    onConfirm,
}: ConfirmOverwriteModalProps) {
    const themeClass = getTheme() === Theme.Light ? "theme-light" : "theme-dark";
    return (
        <Modal
            {...props}
            title={<span className={themeClass}><span className="vc-server-cloner-title vc-server-cloner-danger">Confirm Overwrite</span></span>}
            actions={[
                { text: "Cancel", variant: "secondary", onClick: props.onClose },
                {
                    text: "Delete and overwrite",
                    variant: "critical-primary",
                    onClick: () => {
                        onConfirm();
                        props.onClose();
                    }
                }
            ]}
        >
            <div className={themeClass}>
                <div className="vc-server-cloner-confirmation">
                    <p>
                        This will <strong className="vc-server-cloner-danger">permanently delete</strong> all{" "}
                        {deletingText} in <strong>{targetName}</strong> and replace them with data from{" "}
                        <strong>{sourceName}</strong>.
                    </p>
                    <p className="vc-server-cloner-subtext vc-server-cloner-confirmation-warning">This action cannot be undone.</p>
                </div>
            </div>
        </Modal>
    );
}

const SafeConfirmOverwriteModal = ErrorBoundary.wrap(ConfirmOverwriteModal, { noop: true });

interface BoostWarningProps {
    guild: Guild;
    sourceSoundsCount: number;
    sourceStickersCount: number;
    targetGuildId: string | null;
}

function BoostWarning({
    guild,
    targetGuildId,
    sourceStickersCount,
    sourceSoundsCount,
}: BoostWarningProps) {
    const boostFeatures = React.useMemo(() => {
        const features: string[] = [];
        if (guild.banner) features.push("Server Banner (Level 2)");
        if (guild.splash) features.push("Invite Splash (Level 2)");
        const roles = GuildRoleStore.getSortedRoles(guild.id) || [];
        if (roles.some(role => role.icon)) features.push("Role Icons (Level 2)");
        if (guild.premiumTier >= 1) features.push("High Bitrate Voice (Level 1+)");
        if (sourceStickersCount > 0) features.push(`Custom Stickers (${sourceStickersCount} items)`);
        if (sourceSoundsCount > 0) features.push(`Soundboard Sounds (${sourceSoundsCount} items)`);
        return features;
    }, [guild.id, sourceStickersCount, sourceSoundsCount]);

    if (boostFeatures.length === 0) return null;

    const sourceTier = guild.premiumTier;
    const targetGuild = targetGuildId ? GuildStore.getGuild(targetGuildId) : null;
    const targetTier = targetGuild?.premiumTier ?? 0;
    const isNewServer = !targetGuildId;

    if (!isNewServer && targetTier >= sourceTier && targetTier >= 3) return null;

    return (
        <div className="vc-server-cloner-boost-warning">
            <strong className="vc-server-cloner-boost-title">
                Boost-Dependent Features:
            </strong>
            <div className="vc-server-cloner-boost-list">
                {boostFeatures.map(feature => <div key={feature}>• {feature}</div>)}
            </div>
            <div className="vc-server-cloner-boost-detail">
                {isNewServer
                    ? "New servers start at Level 0 (max 5 stickers, 8 soundboard slots). Remaining items will be skipped."
                    : `Target server is Level ${targetTier} (max ${targetTier === 0 ? 5 : targetTier === 1 ? 15 : targetTier === 2 ? 30 : 60} stickers, ${targetTier === 0 ? 8 : targetTier === 1 ? 24 : targetTier === 2 ? 36 : 48} sounds).`}
            </div>

        </div>
    );
}

interface CloneModalProps {
    guild: Guild;
    initialOptions?: Partial<CloneOptions>;
    onClone: (options: CloneOptions) => void;
    props: RenderModalProps;
}

function CloneModalComponent({
    props,
    guild,
    onClone,
    initialOptions,
}: CloneModalProps) {
    const [cloneChannels, setCloneChannels] = React.useState(initialOptions?.cloneChannels ?? true);
    const [cloneRoles, setCloneRoles] = React.useState(initialOptions?.cloneRoles ?? true);
    const [cloneOnboarding, setCloneOnboarding] = React.useState(initialOptions?.cloneOnboarding ?? true);
    const [cloneSystemFlags, setCloneSystemFlags] = React.useState(initialOptions?.cloneSystemFlags ?? true);
    const [cloneStickers, setCloneStickers] = React.useState(initialOptions?.cloneStickers ?? true);
    const [cloneSoundboard, setCloneSoundboard] = React.useState(initialOptions?.cloneSoundboard ?? true);
    const [resumeMode, setResumeMode] = React.useState(initialOptions?.resumeMode ?? false);
    const [targetGuildId, setTargetGuildId] = React.useState<string | null>(null);
    const [sourceStickersCount, setSourceStickersCount] = React.useState(0);
    const [sourceSoundsCount, setSourceSoundsCount] = React.useState(0);

    React.useEffect(() => {
        let cancelled = false;

        void Promise.all([
            RestAPI.get({ url: `/guilds/${guild.id}/stickers` }),
            RestAPI.get({ url: `/guilds/${guild.id}/soundboard-sounds` })
        ]).then(([stickerResponse, soundResponse]: [{ body?: unknown[]; }, { body?: unknown[] | { items?: unknown[]; }; }]) => {
            if (cancelled) return;
            setSourceStickersCount(stickerResponse.body?.length ?? 0);
            const sounds = Array.isArray(soundResponse.body) ? soundResponse.body : soundResponse.body?.items;
            setSourceSoundsCount(sounds?.length ?? 0);
        }).catch(() => {
            if (!cancelled) {
                setSourceStickersCount(0);
                setSourceSoundsCount(0);
            }
        });

        return () => { cancelled = true; };
    }, [guild.id]);

    const canOnboarding = cloneChannels && cloneRoles;

    React.useEffect(() => {
        if (!canOnboarding) setCloneOnboarding(false);
    }, [canOnboarding]);

    const ownedGuilds = React.useMemo(
        () =>
            Object.values(GuildStore.getGuilds()).filter(
                g => g.id !== guild.id && g.ownerId === UserStore.getCurrentUser()?.id
            ),
        [guild.id]
    );

    const nothingSelected = !cloneChannels && !cloneRoles && !cloneOnboarding && !cloneSystemFlags && !cloneStickers && !cloneSoundboard;

    const itemSummaryStr = React.useMemo(() => {
        const roleCount = cloneRoles ? (GuildRoleStore.getSortedRoles(guild.id) || []).filter(role => role.name !== "@everyone").length : 0;
        const channelCount = cloneChannels ? extractChannels(guild.id).length : 0;
        const stickerEst = cloneStickers ? sourceStickersCount : 0;
        const soundboardEst = cloneSoundboard ? sourceSoundsCount : 0;

        const parts: string[] = [];
        if (roleCount > 0) parts.push(`${roleCount} roles`);
        if (channelCount > 0) parts.push(`${channelCount} channels`);
        if (stickerEst > 0) parts.push(`${stickerEst} stickers`);
        if (soundboardEst > 0) parts.push(`${soundboardEst} sounds`);

        return parts.length > 0 ? parts.join(", ") : "None";
    }, [guild.id, cloneRoles, cloneChannels, cloneStickers, cloneSoundboard, sourceStickersCount, sourceSoundsCount]);

    const handleTargetChange = React.useCallback((v: string) => {
        setTargetGuildId(v === "new" ? null : v);
        if (v === "new") setResumeMode(false);
    }, []);

    const handleClone = React.useCallback(() => {
        if (nothingSelected) return;

        if (targetGuildId && !resumeMode) {
            const targetName = ownedGuilds.find((g: Guild) => g.id === targetGuildId)?.name ?? "the target server";
            const deletingParts: string[] = [];
            if (cloneChannels) deletingParts.push("channels");
            if (cloneRoles) deletingParts.push("roles");
            if (cloneStickers) deletingParts.push("stickers");
            if (cloneSoundboard) deletingParts.push("soundboard sounds");

            props.onClose();
            openModal((confirmProps: RenderModalProps) => (
                <SafeConfirmOverwriteModal
                    props={confirmProps}
                    targetName={targetName}
                    sourceName={guild.name}
                    deletingText={deletingParts.join(", ")}
                    onConfirm={() =>
                        onClone({ cloneChannels, cloneRoles, cloneOnboarding, cloneSystemFlags, cloneStickers, cloneSoundboard, resumeMode: false, targetGuildId })
                    }
                />
            ));
        } else {
            onClone({ cloneChannels, cloneRoles, cloneOnboarding, cloneSystemFlags, cloneStickers, cloneSoundboard, resumeMode, targetGuildId });
            props.onClose();
        }
    }, [nothingSelected, targetGuildId, resumeMode, cloneChannels, cloneRoles, cloneOnboarding, cloneSystemFlags, cloneStickers, cloneSoundboard, guild.name, ownedGuilds, onClone, props]);

    const selectOptions = React.useMemo(
        () => [
            { value: "new", label: "Create New Server" },
            ...ownedGuilds.map((g: Guild) => ({ value: g.id, label: g.name })),
        ],
        [ownedGuilds]
    );

    const selectValue = targetGuildId ?? "new";

    const themeClass = getTheme() === Theme.Light ? "theme-light" : "theme-dark";

    return (
        <Modal
            {...props}
            title={<span className={themeClass}><span className="vc-server-cloner-title">Clone Server: {guild.name}</span></span>}
            actionBarInput={!nothingSelected && (
                <div className={themeClass}>
                    <div className="vc-server-cloner-estimate">Selected items: <strong>{itemSummaryStr}</strong></div>
                </div>
            )}
            actions={[
                { text: "Cancel", variant: "secondary", onClick: props.onClose },
                {
                    text: targetGuildId ? resumeMode ? "Resume clone" : "Overwrite and clone" : "Create and clone",
                    variant: "primary",
                    onClick: handleClone,
                    disabled: nothingSelected
                }
            ]}
        >
            <div className={themeClass}>
                <div className="vc-server-cloner-content">
                    <div>
                        <span className="vc-server-cloner-label">
                            Clone To:
                        </span>
                        <SearchableSelect
                            options={selectOptions}
                            value={selectValue}
                            placeholder="Select destination..."
                            maxVisibleItems={5}
                            closeOnSelect={true}
                            onChange={handleTargetChange}
                        />
                        {targetGuildId && !resumeMode && (
                            <div className="vc-server-cloner-target-status vc-server-cloner-danger">
                                Warning: Selected items in the target server will be deleted and replaced!
                            </div>
                        )}
                        {targetGuildId && resumeMode && (
                            <div className="vc-server-cloner-target-status vc-server-cloner-success">
                                Resume mode: Only missing items will be added, nothing will be deleted.
                            </div>
                        )}
                    </div>

                    {targetGuildId && (
                        <div className="vc-server-cloner-mode-buttons">
                            <Button color={!resumeMode ? Button.Colors.BRAND : Button.Colors.PRIMARY} onClick={() => setResumeMode(false)}>Overwrite</Button>
                            <Button color={resumeMode ? Button.Colors.GREEN : Button.Colors.PRIMARY} onClick={() => setResumeMode(true)}>Resume</Button>
                        </div>
                    )}

                    <div className="vc-server-cloner-note">
                        <strong>Note:</strong>{" "}
                        Server Icon, Name, Banner, Splash, Description
                        {cloneSystemFlags ? ", and System Channel Flags" : ""} will always be cloned.
                    </div>

                    <div>
                        <span className="vc-server-cloner-label">
                            Core:
                        </span>
                        <Checkbox value={cloneChannels} type="inverted" onChange={(_event: PointerEvent<Element>, value: boolean) => setCloneChannels(value)}>
                            <span className="vc-server-cloner-option-title">Channels</span>
                            <span className="vc-server-cloner-option-description">
                                All channel types with topics, positions, and settings
                            </span>
                        </Checkbox>

                        <Checkbox value={cloneRoles} type="inverted" onChange={(_event: PointerEvent<Element>, value: boolean) => setCloneRoles(value)}>
                            <span className="vc-server-cloner-option-title">Roles</span>
                            <span className="vc-server-cloner-option-description">
                                With permissions, colors, and icons
                            </span>
                        </Checkbox>
                    </div>

                    <div>
                        <span className="vc-server-cloner-label">
                            Assets:
                        </span>
                        <Checkbox value={cloneStickers} type="inverted" onChange={(_event: PointerEvent<Element>, value: boolean) => setCloneStickers(value)}>
                            <span className="vc-server-cloner-option-title">Stickers</span>
                            <span className="vc-server-cloner-option-description">
                                Custom stickers (limited by boost level)
                            </span>
                        </Checkbox>

                        <Checkbox value={cloneSoundboard} type="inverted" onChange={(_event: PointerEvent<Element>, value: boolean) => setCloneSoundboard(value)}>
                            <span className="vc-server-cloner-option-title">Soundboard</span>
                            <span className="vc-server-cloner-option-description">
                                Custom soundboard sounds (limited by boost level)
                            </span>
                        </Checkbox>
                    </div>

                    <div>
                        <span className="vc-server-cloner-label">
                            Server Settings:
                        </span>

                        <Checkbox
                            value={cloneOnboarding}
                            type="inverted"
                            onChange={(_event: PointerEvent<Element>, value: boolean) => setCloneOnboarding(value)}
                            disabled={!canOnboarding}
                        >
                            <span className="vc-server-cloner-option-title">
                                Onboarding
                            </span>
                            <span className="vc-server-cloner-option-description">
                                {canOnboarding
                                    ? "Welcome prompts, default channels, and customization"
                                    : "Requires both Channels and Roles"}
                            </span>
                        </Checkbox>

                        <Checkbox value={cloneSystemFlags} type="inverted" onChange={(_event: PointerEvent<Element>, value: boolean) => setCloneSystemFlags(value)}>
                            <span className="vc-server-cloner-option-title">System Channel Flags</span>
                            <span className="vc-server-cloner-option-description">
                                Join/boost notification toggles
                            </span>
                        </Checkbox>
                    </div>

                    <BoostWarning guild={guild} targetGuildId={targetGuildId} sourceStickersCount={sourceStickersCount} sourceSoundsCount={sourceSoundsCount} />

                </div>
            </div>
        </Modal>
    );
}

export const CloneModal = ErrorBoundary.wrap(CloneModalComponent, { noop: true });
