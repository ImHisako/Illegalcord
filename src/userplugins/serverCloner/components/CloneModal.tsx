import { Checkbox, GuildRoleStore, GuildStore, Modal, openModal, React, SearchableSelect, UserStore } from "@webpack/common";
import { Guild, RenderModalProps } from "@vencord/discord-types";
import { CloneOptions } from "../types";
import { extractChannels } from "../utils/api";
import { getTheme, Theme } from "@utils/discord";


function ConfirmOverwriteModal({
    props,
    targetName,
    sourceName,
    deletingText,
    onConfirm,
}: {
    props: RenderModalProps;
    targetName: string;
    sourceName: string;
    deletingText: string;
    onConfirm: () => void;
}) {
    const themeClass = getTheme() === Theme.Light ? "theme-light" : "theme-dark";
    return (
        <Modal
            {...props}
            title={
                <span className={themeClass}>
                    <span className="sc-modal-title" style={{ color: "var(--status-danger)" }}>
                        Confirm Overwrite
                    </span>
                </span>
            }
            actions={[
                {
                    text: "Cancel",
                    variant: "secondary",
                    onClick: props.onClose
                },
                {
                    text: "Delete & Overwrite",
                    variant: "critical-primary",
                    onClick: () => {
                        onConfirm();
                        props.onClose();
                    }
                }
            ]}
        >
            <div className={themeClass}>
                <div className="sc-modal-text" style={{ padding: "16px 0" }}>
                    <p>
                        This will <strong style={{ color: "var(--status-danger)" }}>permanently delete</strong> all{" "}
                        {deletingText} in <strong>{targetName}</strong> and replace them with data from{" "}
                        <strong>{sourceName}</strong>.
                    </p>
                    <p className="sc-modal-subtext" style={{ marginTop: "12px" }}>This action cannot be undone.</p>
                </div>
            </div>
        </Modal>
    );
}


function BoostWarning({
    guild,
    targetGuildId,
    ownedGuilds,
    sourceStickersCount,
    sourceSoundsCount,
}: {
    guild: Guild;
    targetGuildId: string | null;
    ownedGuilds: Guild[];
    sourceStickersCount: number;
    sourceSoundsCount: number;
}) {
    const boostFeatures = React.useMemo(() => {
        const features: string[] = [];
        if ((guild as any).banner)  features.push("Server Banner (Level 2)");
        if ((guild as any).splash)  features.push("Invite Splash (Level 2)");
        const roles = GuildRoleStore.getSortedRoles(guild.id) || [];
        if (roles.some((r: any) => r.icon)) features.push("Role Icons (Level 2)");
        if (((guild as any).premiumTier || 0) >= 1) features.push("High Bitrate Voice (Level 1+)");
        if (sourceStickersCount > 0) features.push(`Custom Stickers (${sourceStickersCount} items)`);
        if (sourceSoundsCount > 0) features.push(`Soundboard Sounds (${sourceSoundsCount} items)`);
        return features;
    }, [guild.id, sourceStickersCount, sourceSoundsCount]);

    if (boostFeatures.length === 0) return null;

    const sourceTier = (guild as any).premiumTier || 0;
    const targetGuild = targetGuildId ? GuildStore.getGuild(targetGuildId) : null;
    const targetTier = targetGuild ? (targetGuild as any).premiumTier || 0 : 0;
    const isNewServer = !targetGuildId;

    if (!isNewServer && targetTier >= sourceTier && targetTier >= 3) return null;

    return (
        <div style={{
            background: "rgba(250,166,26,0.06)",
            border: "1px solid rgba(250,166,26,0.22)",
            padding: "12px",
            borderRadius: "8px",
        }}>
            <strong className="sc-modal-title-bold" style={{ display: "block", marginBottom: "6px", color: "#faa61a" }}>
                Boost-Dependent Features:
            </strong>
            <div className="sc-modal-text" style={{ lineHeight: 1.6 }}>
                {boostFeatures.map((f, i) => <div key={i}>• {f}</div>)}
            </div>
            <div className="sc-modal-subtext" style={{ marginTop: "8px", fontStyle: "italic", color: "#faa61a" }}>
                {isNewServer
                    ? "New servers start at Level 0 (max 5 stickers, 8 soundboard slots). Remaining items will be skipped."
                    : `Target server is Level ${targetTier} (max ${targetTier === 0 ? 5 : targetTier === 1 ? 15 : targetTier === 2 ? 30 : 60} stickers, ${targetTier === 0 ? 8 : targetTier === 1 ? 24 : targetTier === 2 ? 36 : 48} sounds).`}
            </div>

        </div>
    );
}


function ModeButton({
    label,
    active,
    color,
    onClick,
}: {
    label: string;
    active: boolean;
    color: string;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            style={{
                flex: 1,
                padding: "10px",
                borderRadius: "8px",
                border: `2px solid ${active ? color : "var(--background-modifier-accent)"}`,
                background: active ? `${color}22` : "var(--background-secondary)",
                color: active ? color : "var(--text-muted)",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "13px",
                fontFamily: "var(--font-primary), 'gg sans', sans-serif",
                transition: "border-color 0.15s ease, background 0.15s ease, color 0.15s ease",
            }}
        >
            {label}
        </button>
    );
}


export const CloneModal = ({
    props,
    guild,
    onClone,
    initialOptions,
}: {
    props: RenderModalProps;
    guild: Guild;
    onClone: (options: CloneOptions) => void;
    initialOptions?: Partial<CloneOptions>;
}) => {
    const [cloneChannels, setCloneChannels]       = React.useState(initialOptions?.cloneChannels ?? true);
    const [cloneRoles, setCloneRoles]             = React.useState(initialOptions?.cloneRoles ?? true);
    const [cloneOnboarding, setCloneOnboarding]   = React.useState(initialOptions?.cloneOnboarding ?? true);
    const [cloneSystemFlags, setCloneSystemFlags] = React.useState(initialOptions?.cloneSystemFlags ?? true);
    const [cloneStickers, setCloneStickers]       = React.useState(initialOptions?.cloneStickers ?? true);
    const [cloneSoundboard, setCloneSoundboard]   = React.useState(initialOptions?.cloneSoundboard ?? true);
    const [resumeMode, setResumeMode]             = React.useState(initialOptions?.resumeMode ?? false);
    const [targetGuildId, setTargetGuildId]       = React.useState<string | null>(null);
    const [sourceStickersCount, setSourceStickersCount] = React.useState(0);
    const [sourceSoundsCount, setSourceSoundsCount] = React.useState(0);

    React.useEffect(() => {
        const { RestAPI } = require("@webpack/common");
        RestAPI.get({ url: `/guilds/${guild.id}/stickers` }).then((resp: any) => {
            const list = resp.body || [];
            setSourceStickersCount(list.length);
        }).catch(() => {});

        RestAPI.get({ url: `/guilds/${guild.id}/soundboard-sounds` }).then((resp: any) => {
            const list = resp.body?.items || resp.body || [];
            setSourceSoundsCount(list.length);
        }).catch(() => {});
    }, [guild.id]);

    const canOnboarding = cloneChannels && cloneRoles;

    React.useEffect(() => {
        if (!canOnboarding) setCloneOnboarding(false);
    }, [canOnboarding]);

    const ownedGuilds = React.useMemo(
        () =>
            (Object.values(GuildStore.getGuilds()) as Guild[]).filter(
                g => g.id !== guild.id && g.ownerId === UserStore.getCurrentUser()?.id
            ),
        [guild.id]
    );

    const nothingSelected = !cloneChannels && !cloneRoles && !cloneOnboarding && !cloneSystemFlags && !cloneStickers && !cloneSoundboard;

    const estimatedTime = React.useMemo(() => {
        const roleCount     = cloneRoles    ? (GuildRoleStore.getSortedRoles(guild.id) || []).filter((r: any) => r.name !== "@everyone").length : 0;
        const channelCount  = cloneChannels ? extractChannels(guild.id, true).length : 0;
        const onboardingEst = cloneOnboarding ? 2 : 0;
        const stickerEst    = cloneStickers ? sourceStickersCount : 0;
        const soundboardEst = cloneSoundboard ? sourceSoundsCount : 0;

        const perItemDelay = 1.5;
        const setupTime    = 5;
        const deleteTime   = (targetGuildId && !resumeMode)
            ? (channelCount * 1.2 + roleCount * 1.2 + stickerEst * 1.0 + soundboardEst * 1.0)
            : 0;

        const totalSeconds = setupTime + deleteTime
            + (roleCount + channelCount + onboardingEst + stickerEst + soundboardEst) * perItemDelay;

        if (totalSeconds < 60) return `~${Math.ceil(totalSeconds)}s`;
        const mins = Math.floor(totalSeconds / 60);
        const secs = Math.ceil(totalSeconds % 60);
        return secs > 0 ? `~${mins}m ${secs}s` : `~${mins}m`;

    }, [guild.id, cloneRoles, cloneChannels, cloneOnboarding, cloneStickers, cloneSoundboard, sourceStickersCount, sourceSoundsCount, targetGuildId, resumeMode]);

    const handleTargetChange = React.useCallback((v: string) => {
        setTargetGuildId(v === "new" ? null : v);
        if (v === "new") setResumeMode(false);
    }, []);

    const handleClone = React.useCallback(() => {
        if (nothingSelected) return;

        if (targetGuildId && !resumeMode) {
            const targetName    = ownedGuilds.find((g: Guild) => g.id === targetGuildId)?.name ?? "the target server";
            const deletingParts: string[] = [];
            if (cloneChannels) deletingParts.push("channels");
            if (cloneRoles)    deletingParts.push("roles");
            if (cloneStickers) deletingParts.push("stickers");
            if (cloneSoundboard) deletingParts.push("soundboard sounds");

            props.onClose();
            openModal((confirmProps: RenderModalProps) => (
                <ConfirmOverwriteModal
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
            title={
                <span className={themeClass}>
                    <span className="sc-modal-title">Clone Server: {guild.name}</span>
                </span>
            }
            actionBarInput={!nothingSelected && (
                <div className={themeClass}>
                    <div className="sc-modal-estimate-box">
                        <span>Estimated time: <strong>{estimatedTime}</strong></span>
                    </div>
                </div>
            )}
            actions={[
                {
                    text: "Cancel",
                    variant: "secondary",
                    onClick: props.onClose
                },
                {
                    text: targetGuildId
                        ? resumeMode ? "Resume Clone" : "Overwrite & Clone"
                        : "Create & Clone",
                    variant: "primary",
                    onClick: handleClone,
                    disabled: nothingSelected
                }
            ]}
        >
            <div className={themeClass}>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "8px 0", minHeight: "450px" }}>

                    {}
                    <div>
                        <span className="sc-modal-label">
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
                            <div className="sc-modal-subtext" style={{ color: "var(--status-danger)", marginTop: "6px", fontWeight: 600 }}>
                                Warning: Selected items in the target server will be deleted and replaced!
                            </div>
                        )}
                        {targetGuildId && resumeMode && (
                            <div className="sc-modal-subtext" style={{ color: "var(--text-positive)", marginTop: "6px", fontWeight: 600 }}>
                                Resume mode: Only missing items will be added, nothing will be deleted.
                            </div>
                        )}
                    </div>

                    {}
                    {targetGuildId && (
                        <div style={{ display: "flex", gap: "8px" }}>
                            <ModeButton
                                label="Overwrite"
                                active={!resumeMode}
                                color="#5865f2"
                                onClick={() => setResumeMode(false)}
                            />
                            <ModeButton
                                label="Resume"
                                active={resumeMode}
                                color="#43b581"
                                onClick={() => setResumeMode(true)}
                            />
                        </div>
                    )}

                    {}
                    <div className="sc-modal-note-box">
                        <strong>Note:</strong>{" "}
                        Server Icon, Name, Banner, Splash, Description
                        {cloneSystemFlags ? ", and System Channel Flags" : ""} will always be cloned.
                    </div>

                    {}
                    <div>
                        <span className="sc-modal-label">
                            Core:
                        </span>
                        <Checkbox value={cloneChannels} type="inverted" onChange={(_: any, val: boolean) => setCloneChannels(val)}>
                            <span className="sc-modal-title-bold" style={{ fontWeight: 500 }}>Channels</span>
                            <span className="sc-modal-subtext" style={{ display: "block", marginTop: "2px" }}>
                                All channel types with topics, positions, and settings
                            </span>
                        </Checkbox>

                        <Checkbox value={cloneRoles} type="inverted" onChange={(_: any, val: boolean) => setCloneRoles(val)}>
                            <span className="sc-modal-title-bold" style={{ fontWeight: 500 }}>Roles</span>
                            <span className="sc-modal-subtext" style={{ display: "block", marginTop: "2px" }}>
                                With permissions, colors, and icons
                            </span>
                        </Checkbox>
                    </div>

                    {}
                    <div>
                        <span className="sc-modal-label">
                            Assets:
                        </span>
                        <Checkbox value={cloneStickers} type="inverted" onChange={(_: any, val: boolean) => setCloneStickers(val)}>
                            <span className="sc-modal-title-bold" style={{ fontWeight: 500 }}>Stickers</span>
                            <span className="sc-modal-subtext" style={{ display: "block", marginTop: "2px" }}>
                                Custom stickers (limited by boost level)
                            </span>
                        </Checkbox>

                        <Checkbox value={cloneSoundboard} type="inverted" onChange={(_: any, val: boolean) => setCloneSoundboard(val)}>
                            <span className="sc-modal-title-bold" style={{ fontWeight: 500 }}>Soundboard</span>
                            <span className="sc-modal-subtext" style={{ display: "block", marginTop: "2px" }}>
                                Custom soundboard sounds (limited by boost level)
                            </span>
                        </Checkbox>
                    </div>

                    {}
                    <div>
                        <span className="sc-modal-label">
                            Server Settings:
                        </span>

                        <Checkbox
                            value={cloneOnboarding}
                            type="inverted"
                            onChange={(_: any, val: boolean) => setCloneOnboarding(val)}
                            disabled={!canOnboarding}
                        >
                            <span className="sc-modal-title-bold" style={{ fontWeight: 500 }}>
                                Onboarding
                            </span>
                            <span className="sc-modal-subtext" style={{ display: "block", marginTop: "2px" }}>
                                {canOnboarding
                                    ? "Welcome prompts, default channels, and customization"
                                    : "Requires both Channels and Roles"}
                            </span>
                        </Checkbox>

                        <Checkbox value={cloneSystemFlags} type="inverted" onChange={(_: any, val: boolean) => setCloneSystemFlags(val)}>
                            <span className="sc-modal-title-bold" style={{ fontWeight: 500 }}>System Channel Flags</span>
                            <span className="sc-modal-subtext" style={{ display: "block", marginTop: "2px" }}>
                                Join/boost notification toggles
                            </span>
                        </Checkbox>
                    </div>

                    {}
                    <BoostWarning guild={guild} targetGuildId={targetGuildId} ownedGuilds={ownedGuilds} sourceStickersCount={sourceStickersCount} sourceSoundsCount={sourceSoundsCount} />

                </div>
            </div>
        </Modal>
    );
};
