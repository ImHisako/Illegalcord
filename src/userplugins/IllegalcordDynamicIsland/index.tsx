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
import { useFixedTimer } from "@utils/react";
import { formatDurationMs } from "@utils/text";
import definePlugin, { OptionType } from "@utils/types";
import type { Message, Stream } from "@vencord/discord-types";
import { ApplicationStreamingStore, ChannelActions, ChannelStore, FluxDispatcher, IconUtils, MediaEngineStore, MessageStore, NavigationRouter, ReactDOM, SelectedChannelStore, Tooltip, useEffect, UserGuildSettingsStore, UserStore, useState, useStateFromStores, VoiceActions, VoiceStateStore } from "@webpack/common";
import type { MouseEvent, ReactNode, SVGProps } from "react";

interface ControlButtonProps {
    active?: boolean;
    children: ReactNode;
    compact?: boolean;
    danger?: boolean;
    label: string;
    onClick(): void;
}

interface IconProps extends SVGProps<SVGSVGElement> {
    size?: string;
}

interface IslandNotification {
    avatarUrl: string;
    body: string;
    channelId: string;
    guildId: string | null;
    id: string;
    title: string;
}

const cl = classNameFactory("vc-illegalcord-dynamic-island-");
const SETTINGS_KEYS = ["islandColor", "showSpotifyIsland", "showVoiceIsland", "showScreenShareIsland", "morphNotifications"] as const;
const NOTIFICATION_DURATION = 5000;
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
    showSpotifyIsland: {
        description: "Show Spotify activity in the Dynamic Island.",
        type: OptionType.BOOLEAN,
        default: true
    },
    showVoiceIsland: {
        description: "Show Discord call controls in the Dynamic Island.",
        type: OptionType.BOOLEAN,
        default: true
    },
    showScreenShareIsland: {
        description: "Show screen sharing status, timer, and quick stop controls in the Dynamic Island.",
        type: OptionType.BOOLEAN,
        default: true
    },
    morphNotifications: {
        description: "Temporarily morph the Dynamic Island for direct messages and mentions.",
        type: OptionType.BOOLEAN,
        default: true
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

function ScreenShareIcon(props: IconProps) {
    return <Glyph {...props} path="M3 4h18a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-7v2h3v2H7v-2h3v-2H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 2v11h18V6H3Zm8 2 5 3.5-5 3.5V8Z" />;
}

function getStreamKey(stream: Stream) {
    return stream.streamType === "guild"
        ? `guild:${stream.guildId}:${stream.channelId}:${stream.ownerId}`
        : `call:${stream.channelId}:${stream.ownerId}`;
}

function stopScreenShare(stream: Stream) {
    FluxDispatcher.dispatch({
        type: "STREAM_STOP",
        streamKey: getStreamKey(stream),
        appContext: "APP"
    });
}

function ControlButton({ active, children, compact, danger, label, onClick }: ControlButtonProps) {
    return (
        <Tooltip text={label} position="bottom">
            {tooltipProps => (
                <Button
                    {...tooltipProps}
                    aria-label={label}
                    className={cl("control", { active, compact, danger })}
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

function ScreenShareTimer({ startedAt }: { startedAt: number; }) {
    return <>{formatDurationMs(useFixedTimer({ initialTime: startedAt }))}</>;
}

function VoiceIcon({ children, slashed }: { children: ReactNode; slashed: boolean; }) {
    return (
        <span className={cl("voice-icon", { slashed })}>
            {children}
            <span className={cl("slash")} />
        </span>
    );
}

function SpotifySection() {
    const track = useStateFromStores([SpotifyStore], () => SpotifyStore.device?.is_active ? SpotifyStore.track : null);
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
                    <VoiceIcon slashed={isMuted}><Microphone /></VoiceIcon>
                </ControlButton>
                <ControlButton label={isDeafened ? "Undeafen" : "Deafen"} danger={isDeafened} onClick={() => VoiceActions.toggleSelfDeaf()}>
                    <VoiceIcon slashed={isDeafened}><HeadphonesIcon /></VoiceIcon>
                </ControlButton>
                <ControlButton label="Disconnect" danger onClick={() => ChannelActions.selectVoiceChannel(null)}>
                    <Glyph path="M5.5 12.5c4.3-2.2 8.7-2.2 13 0l-2 4-3-1v-2.1a9.8 9.8 0 0 0-3 0v2.1l-3 1-2-4ZM4 7.5A2.5 2.5 0 1 0 4 2.5a2.5 2.5 0 0 0 0 5Zm16 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                </ControlButton>
            </div>
        </section>
    );
}

function ScreenShareSection({ startedAt, stream }: { startedAt: number; stream: Stream; }) {
    const channel = useStateFromStores([ChannelStore], () => ChannelStore.getChannel(stream.channelId), [stream.channelId]);
    const viewerCount = useStateFromStores([ApplicationStreamingStore], () => ApplicationStreamingStore.getViewerIds(stream).length, [stream]);

    return (
        <section className={cl("section", "screen-section")} aria-label="Screen sharing controls">
            <div className={cl("section-info")}>
                <div className={cl("stream-indicator")}><ScreenShareIcon /></div>
                <div className={cl("copy")}>
                    <strong>{channel.name || "Screen sharing"}</strong>
                    <span><ScreenShareTimer startedAt={startedAt} /> · {viewerCount} {viewerCount === 1 ? "viewer" : "viewers"}</span>
                </div>
            </div>
            <div className={cl("controls")}>
                <ControlButton label="Stop sharing" danger onClick={() => stopScreenShare(stream)}>
                    <Glyph path="M7 7h10v10H7V7Z" />
                </ControlButton>
            </div>
        </section>
    );
}

function DynamicIsland() {
    const [expanded, setExpanded] = useState(false);
    const [notification, setNotification] = useState<IslandNotification | null>(null);
    const [streamStartedAt, setStreamStartedAt] = useState(Date.now());
    const { islandColor, morphNotifications, showScreenShareIsland, showSpotifyIsland, showVoiceIsland } = settings.use(SETTINGS_KEYS);
    const spotifyTrack = useStateFromStores([SpotifyStore], () => SpotifyStore.device?.is_active ? SpotifyStore.track : null);
    const isPlaying = useStateFromStores([SpotifyStore], () => SpotifyStore.isPlaying);
    const activeStream = useStateFromStores([ApplicationStreamingStore], () => ApplicationStreamingStore.getCurrentUserActiveStream());
    const currentUser = UserStore.getCurrentUser();
    const voiceState = useStateFromStores([VoiceStateStore], () => VoiceStateStore.getVoiceStateForUser(currentUser.id));
    const track = showSpotifyIsland ? spotifyTrack : null;
    const channelId = showVoiceIsland ? voiceState?.channelId : undefined;
    const stream = showScreenShareIsland ? activeStream : null;
    const streamKey = stream ? getStreamKey(stream) : null;
    const isExpanded = expanded && !notification;
    const idle = !track && !channelId && !stream;

    useEffect(() => {
        if (streamKey) setStreamStartedAt(Date.now());
    }, [streamKey]);

    useEffect(() => {
        if (!morphNotifications) {
            setNotification(null);
            return;
        }

        let timeoutId: number | undefined;
        const handleMessage = ({ message }: { message: Message; }) => {
            const channel = ChannelStore.getChannel(message.channel_id);
            if (!channel || message.author.id === currentUser.id || message.blocked || channel.id === SelectedChannelStore.getChannelId()) return;
            if (channel.guild_id && (UserGuildSettingsStore.isMuted(channel.guild_id) || UserGuildSettingsStore.isChannelMuted(channel.guild_id, channel.id))) return;

            const storedMessage = MessageStore.getMessage(message.channel_id, message.id);
            if (channel.guild_id && !(storedMessage?.mentioned ?? message.mentioned)) return;

            if (timeoutId !== undefined) clearTimeout(timeoutId);
            setNotification({
                avatarUrl: IconUtils.getUserAvatarURL(message.author, false, 64),
                body: message.content.trim() || (message.attachments.length ? "Sent an attachment." : "Sent a message."),
                channelId: channel.id,
                guildId: channel.guild_id,
                id: message.id,
                title: message.author.globalName ?? message.author.username
            });
            timeoutId = window.setTimeout(() => setNotification(null), NOTIFICATION_DURATION);
        };

        FluxDispatcher.subscribe("MESSAGE_CREATE", handleMessage);
        return () => {
            FluxDispatcher.unsubscribe("MESSAGE_CREATE", handleMessage);
            if (timeoutId !== undefined) clearTimeout(timeoutId);
        };
    }, [currentUser.id, morphNotifications]);

    const activateSummary = () => {
        if (notification) {
            NavigationRouter.transitionTo(`/channels/${notification.guildId ?? "@me"}/${notification.channelId}/${notification.id}`);
            setNotification(null);
            return;
        }

        setExpanded(value => !value);
    };

    return (
        <div className={cl("root", `color-${islandColor}`, { expanded: isExpanded, idle, notification: notification != null, playing: isPlaying && !stream, sharing: stream != null })}>
            <div
                className={cl("summary")}
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                aria-label="Illegalcord Dynamic Island"
                onClick={activateSummary}
                onKeyDown={event => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    activateSummary();
                }}
            >
                {notification
                    ? <img key={notification.id} className={cl("notification-avatar")} src={notification.avatarUrl} alt="" />
                    : stream
                        ? <ScreenShareIcon className={cl("summary-icon", "stream-icon")} />
                        : track
                            ? <img key={track.album.image.url} className={cl("summary-cover")} src={track.album.image.url} alt="" draggable={false} />
                            : <IslandIcon className={cl("summary-icon")} />}
                <div key={notification?.id ?? streamKey ?? track?.id ?? channelId ?? "idle"} className={cl("summary-copy")}>
                    <strong>{notification?.title ?? (stream ? "You are sharing your screen" : track?.name ?? (channelId ? "Discord call" : "Illegalcord Dynamic Island"))}</strong>
                    <span>{notification?.body ?? (stream
                        ? <>Live for <ScreenShareTimer startedAt={streamStartedAt} /></>
                        : track
                            ? track.artists.map(artist => artist.name).join(", ")
                            : channelId ? "Call controls available" : "Ready for your activities")}</span>
                </div>
                {!notification && !stream && track && (
                    <span className={cl("visualizer")} aria-label={isPlaying ? "Spotify playing" : "Spotify paused"}>
                        <span /><span /><span />
                    </span>
                )}
                {!notification && stream && (
                    <ControlButton compact label="Stop sharing" danger onClick={() => stopScreenShare(stream)}>
                        <Glyph path="M7 7h10v10H7V7Z" />
                    </ControlButton>
                )}
                {!notification && !stream && channelId && <span className={cl("live-dot")} aria-label="Call active" />}
                <span className={cl("beta")}>{notification ? "NEW" : "BETA"}</span>
            </div>
            {notification && <span key={notification.id} className={cl("notification-progress")} />}
            <div className={cl("panel-shell")} aria-hidden={!isExpanded}>
                <div className={cl("panel-clip")}>
                    <div className={cl("panel")}>
                        {stream && <ScreenShareSection stream={stream} startedAt={streamStartedAt} />}
                        {track && <SpotifySection />}
                        {channelId && <VoiceSection channelId={channelId} />}
                        {idle && <div className={cl("empty")}>Enable an Island type, play music, or join a call to show controls.</div>}
                    </div>
                </div>
            </div>
        </div>
    );
}

function DynamicIslandPortal() {
    return ReactDOM.createPortal(<DynamicIsland />, document.body);
}

const SafeDynamicIsland = ErrorBoundary.wrap(DynamicIslandPortal, { noop: true });

export default definePlugin({
    name: "IllegalcordDynamicIsland",
    description: "Adds a Dynamic Island for Spotify, calls, screen sharing, and notifications.",
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
