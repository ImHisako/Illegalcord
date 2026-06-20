/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { HeadphonesIcon, Microphone } from "@components/Icons";
import { settings as musicControlsSettings } from "@equicordplugins/musicControls/settings";
import { SpotifyStore } from "@equicordplugins/musicControls/spotify/SpotifyStore";
import { EquicordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelActions, ChannelStore, MediaEngineStore, ReactDOM, Tooltip, UserStore, useState, useStateFromStores, VoiceActions, VoiceStateStore } from "@webpack/common";
import type { MouseEvent, ReactNode, SVGProps } from "react";

interface ControlButtonProps {
    active?: boolean;
    children: ReactNode;
    danger?: boolean;
    label: string;
    onClick(): void;
}

interface IconProps extends SVGProps<SVGSVGElement> {
    size?: string;
}

const cl = classNameFactory("vc-illegalcord-dynamic-island-");
const SETTINGS_KEYS = ["islandColor"] satisfies Array<"islandColor">;
const settings = definePluginSettings({
    islandColor: {
        description: "Choose the Dynamic Island color.",
        type: OptionType.SELECT,
        options: [
            { label: "Transparent", value: "transparent", default: true },
            { label: "Discord theme", value: "theme" },
            { label: "AMOLED", value: "amoled" },
            { label: "White", value: "white" },
            { label: "Light blue", value: "blue" },
            { label: "Pink", value: "pink" }
        ]
    },
    showSpotifyPanel: {
        description: "Show the Spotify player in the Discord user panel.",
        type: OptionType.BOOLEAN,
        default: false,
        onChange: value => { musicControlsSettings.store.showSpotifyControls = value; }
    }
});

function Glyph({ path, size: _, ...props }: IconProps & { path: string; }) {
    return (
        <svg {...props} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d={path} />
        </svg>
    );
}

function IslandIcon(props: IconProps) {
    return <Glyph {...props} path="M12 3a9 9 0 1 0 9 9h-3a6 6 0 1 1-6-6V3Zm2 0v10.2a3 3 0 1 0 2 2.8V8h5V3h-7Z" />;
}

function ControlButton({ active, children, danger, label, onClick }: ControlButtonProps) {
    return (
        <Tooltip text={label} position="bottom">
            {tooltipProps => (
                <Button
                    {...tooltipProps}
                    aria-label={label}
                    className={cl("control", { active, danger })}
                    size="iconOnly"
                    variant="none"
                    onClick={(event: MouseEvent<HTMLButtonElement>) => {
                        event.stopPropagation();
                        onClick();
                    }}
                >
                    {children}
                </Button>
            )}
        </Tooltip>
    );
}

function SpotifySection() {
    const track = useStateFromStores([SpotifyStore], () => SpotifyStore.track);
    const isPlaying = useStateFromStores([SpotifyStore], () => SpotifyStore.isPlaying);
    if (!track) return null;

    return (
        <section className={cl("section")} aria-label="Spotify controls">
            <div className={cl("section-info")}>
                <img className={cl("cover")} src={track.album.image.url} alt="" draggable={false} />
                <div className={cl("copy")}>
                    <strong>{track.name}</strong>
                    <span>{track.artists.map(artist => artist.name).join(", ")}</span>
                </div>
            </div>
            <div className={cl("controls")}>
                <ControlButton label="Previous track" onClick={() => SpotifyStore.prev()}>
                    <Glyph path="M6 5h2v14H6V5Zm3 7 9-7v14l-9-7Z" />
                </ControlButton>
                <ControlButton label={isPlaying ? "Pause" : "Play"} active={isPlaying} onClick={() => SpotifyStore.setPlaying(!isPlaying)}>
                    <Glyph path={isPlaying ? "M6 5h4v14H6V5Zm8 0h4v14h-4V5Z" : "M8 5v14l11-7L8 5Z"} />
                </ControlButton>
                <ControlButton label="Next track" onClick={() => SpotifyStore.next()}>
                    <Glyph path="M16 5h2v14h-2V5ZM6 5l9 7-9 7V5Z" />
                </ControlButton>
            </div>
        </section>
    );
}

function VoiceSection({ channelId }: { channelId: string; }) {
    const channel = useStateFromStores([ChannelStore], () => ChannelStore.getChannel(channelId), [channelId]);
    const participantCount = useStateFromStores(
        [VoiceStateStore],
        () => Object.keys(VoiceStateStore.getVoiceStatesForChannel(channelId)).length,
        [channelId]
    );
    const isMuted = useStateFromStores([MediaEngineStore], () => MediaEngineStore.isSelfMute());
    const isDeafened = useStateFromStores([MediaEngineStore], () => MediaEngineStore.isSelfDeaf());

    return (
        <section className={cl("section")} aria-label="Discord call controls">
            <div className={cl("section-info")}>
                <div className={cl("call-indicator")}><span /></div>
                <div className={cl("copy")}>
                    <strong>{channel.name || "Discord call"}</strong>
                    <span>{participantCount} {participantCount === 1 ? "participant" : "participants"}</span>
                </div>
            </div>
            <div className={cl("controls")}>
                <ControlButton label={isMuted ? "Unmute" : "Mute"} danger={isMuted} onClick={() => VoiceActions.toggleSelfMute()}>
                    <Microphone />
                </ControlButton>
                <ControlButton label={isDeafened ? "Undeafen" : "Deafen"} danger={isDeafened} onClick={() => VoiceActions.toggleSelfDeaf()}>
                    <HeadphonesIcon />
                </ControlButton>
                <ControlButton label="Disconnect" danger onClick={() => ChannelActions.selectVoiceChannel(null)}>
                    <Glyph path="M5.5 12.5c4.3-2.2 8.7-2.2 13 0l-2 4-3-1v-2.1a9.8 9.8 0 0 0-3 0v2.1l-3 1-2-4ZM4 7.5A2.5 2.5 0 1 0 4 2.5a2.5 2.5 0 0 0 0 5Zm16 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                </ControlButton>
            </div>
        </section>
    );
}

function DynamicIsland() {
    const [expanded, setExpanded] = useState(false);
    const { islandColor } = settings.use(SETTINGS_KEYS);
    const track = useStateFromStores([SpotifyStore], () => SpotifyStore.track);
    const currentUser = UserStore.getCurrentUser();
    const voiceState = useStateFromStores([VoiceStateStore], () => VoiceStateStore.getVoiceStateForUser(currentUser.id));
    const channelId = voiceState?.channelId;
    const idle = !track && !channelId;

    return (
        <div className={cl("root", `color-${islandColor}`, { expanded, idle })}>
            <div
                className={cl("summary")}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                aria-label="Illegalcord Dynamic Island"
                onClick={() => setExpanded(value => !value)}
                onKeyDown={event => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setExpanded(value => !value);
                }}
            >
                {track
                    ? <img className={cl("summary-cover")} src={track.album.image.url} alt="" draggable={false} />
                    : <IslandIcon className={cl("summary-icon")} />}
                <div className={cl("summary-copy")}>
                    <strong>{track?.name ?? (channelId ? "Discord call" : "Illegalcord Dynamic Island")}</strong>
                    <span>{track
                        ? track.artists.map(artist => artist.name).join(", ")
                        : channelId ? "Call controls available" : "Ready for Spotify or a call"}</span>
                </div>
                {channelId && <span className={cl("live-dot")} aria-label="Call active" />}
                <span className={cl("beta")}>BETA</span>
            </div>
            {expanded && (
                <div className={cl("panel")}>
                    {track && <SpotifySection />}
                    {channelId && <VoiceSection channelId={channelId} />}
                    {idle && <div className={cl("empty")}>Start Spotify or join a Discord call to show controls.</div>}
                </div>
            )}
        </div>
    );
}

function DynamicIslandPortal() {
    return ReactDOM.createPortal(<DynamicIsland />, document.body);
}

const SafeDynamicIsland = ErrorBoundary.wrap(DynamicIslandPortal, { noop: true });

export default definePlugin({
    name: "IllegalcordDynamicIsland",
    description: "Beta plugin that adds a Dynamic Island for Spotify and Discord call controls.",
    authors: [EquicordDevs.irritably],
    tags: ["Media", "Voice"],
    dependencies: ["HeaderBarAPI", "MusicControls"],
    settings,

    start() {
        musicControlsSettings.store.showSpotifyControls = settings.store.showSpotifyPanel;
    },

    headerBarButton: {
        icon: IslandIcon,
        render: () => <SafeDynamicIsland />,
        priority: 10_000
    }
});
