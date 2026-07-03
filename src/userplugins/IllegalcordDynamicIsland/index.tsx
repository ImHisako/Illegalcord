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
import { classNameFactory } from "@utils/css";
import { useFixedTimer } from "@utils/react";
import { formatDurationMs } from "@utils/text";
import definePlugin, { OptionType } from "@utils/types";
import type { Message, Stream } from "@vencord/discord-types";
import { ApplicationStreamingStore, ChannelActions, ChannelStore, Clickable, FluxDispatcher, GuildMemberStore, IconUtils, MediaEngineStore, MessageStore, ReactDOM, Tooltip, useEffect, useRef, UserGuildSettingsStore, UserStore, useState, useStateFromStores, VoiceActions, VoiceStateStore } from "@webpack/common";
import type { MouseEvent, PointerEvent, ReactNode, SVGProps } from "react";

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
    id: string;
    title: string;
}

interface DynamicIslandRuntime {
    activeModule: symbol;
    notification: IslandNotification | null;
    notificationListeners: Set<() => void>;
    notificationTimeoutId: number | undefined;
    owner: symbol | null;
    portalListeners: Set<() => void>;
}

interface MessageWithMentions extends Omit<Message, "mentionEveryone" | "mentionRoles" | "mentions"> {
    mention_everyone: boolean;
    mention_roles: string[];
    mentions: Array<string | { id: string; }>;
}

interface SwipeStart {
    pointerId: number;
    startedAt: number;
    x: number;
    y: number;
}

const IslandType = {
    ScreenShare: "screen-share",
    Spotify: "spotify",
    Voice: "voice"
} as const;

type IslandType = typeof IslandType[keyof typeof IslandType];

const cl = classNameFactory("vc-illegalcord-dynamic-island-");
const NOTIFICATION_DURATION = 5000;
const RUNTIME_KEY = Symbol.for("IllegalcordDynamicIsland.runtime");
const SPOTIFY_IDLE_DURATION = 60_000;
const SWIPE_MIN_DISTANCE = 48;
const SWIPE_MIN_DURATION = 120;
const portalModule = Symbol();
const runtime = (Reflect.get(globalThis, RUNTIME_KEY) as DynamicIslandRuntime | undefined) ?? {
    activeModule: portalModule,
    notification: null,
    notificationListeners: new Set(),
    notificationTimeoutId: undefined,
    owner: null,
    portalListeners: new Set()
};
runtime.activeModule = portalModule;
runtime.owner = null;
Reflect.set(globalThis, RUNTIME_KEY, runtime);
runtime.portalListeners.forEach(listener => listener());
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
    keepIslandVisible: {
        description: "Keep the Dynamic Island visible when no activity is active.",
        type: OptionType.BOOLEAN,
        default: false
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
        default: false
    },
    showSpotifyPanel: {
        description: "Show the Spotify player in the Discord user panel.",
        type: OptionType.BOOLEAN,
        default: false,
        onChange: value => { musicControlsSettings.store.showSpotifyControls = value; }
    }
});
const SETTINGS_KEYS = ["islandColor", "keepIslandVisible", "showSpotifyIsland", "showVoiceIsland", "showScreenShareIsland", "morphNotifications"] satisfies Array<keyof typeof settings.store>;

function setIslandNotification(notification: IslandNotification | null) {
    if (runtime.notificationTimeoutId !== undefined) clearTimeout(runtime.notificationTimeoutId);
    runtime.notification = notification;
    runtime.notificationTimeoutId = notification
        ? window.setTimeout(() => setIslandNotification(null), NOTIFICATION_DURATION)
        : undefined;
    runtime.notificationListeners.forEach(listener => listener());
}

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
                    className={cl("control", { "control-active": active, "control-compact": compact, "control-danger": danger })}
                    size="iconOnly"
                    variant="none"
                    onClick={(event: MouseEvent<HTMLButtonElement>) => {
                        event.stopPropagation();
                        onClick();
                    }}
                    onPointerDown={event => event.stopPropagation()}
                >
                    {children}
                </Button>
            )}
        </Tooltip>
    );
}

function ScreenShareTimer({ startedAt }: { startedAt: number; }) {
    const elapsed = Date.now() - startedAt;
    const time = useFixedTimer({ initialTime: startedAt });
    return <>{formatDurationMs(time > 0 ? time : elapsed)}</>;
}

function VoiceIcon({ children, slashed }: { children: ReactNode; slashed: boolean; }) {
    return (
        <span className={cl("voice-icon", { "voice-icon-slashed": slashed })}>
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
    const [notification, setNotification] = useState(runtime.notification);
    const [primaryIsland, setPrimaryIsland] = useState<IslandType>(IslandType.ScreenShare);
    const [spotifyIdle, setSpotifyIdle] = useState(false);
    const [streamStartedAt, setStreamStartedAt] = useState(Date.now());
    const swipeStartRef = useRef<SwipeStart | null>(null);
    const suppressClickRef = useRef(false);
    const { islandColor, keepIslandVisible, morphNotifications, showScreenShareIsland, showSpotifyIsland, showVoiceIsland } = settings.use(SETTINGS_KEYS);
    const spotifyTrack = useStateFromStores([SpotifyStore], () => SpotifyStore.device?.is_active ? SpotifyStore.track : null);
    const isPlaying = useStateFromStores([SpotifyStore], () => SpotifyStore.isPlaying);
    const spotifyTrackId = spotifyTrack?.id;
    const activeStream = useStateFromStores([ApplicationStreamingStore], () => ApplicationStreamingStore.getCurrentUserActiveStream());
    const currentUser = UserStore.getCurrentUser();
    const voiceState = useStateFromStores([VoiceStateStore], () => VoiceStateStore.getVoiceStateForUser(currentUser.id));
    const track = showSpotifyIsland && !spotifyIdle ? spotifyTrack : null;
    const channelId = showVoiceIsland ? voiceState?.channelId : undefined;
    const stream = showScreenShareIsland ? activeStream : null;
    const streamKey = stream ? getStreamKey(stream) : null;
    const activeIslands: IslandType[] = [];
    if (stream) activeIslands.push(IslandType.ScreenShare);
    if (track) activeIslands.push(IslandType.Spotify);
    if (channelId) activeIslands.push(IslandType.Voice);
    const primary = activeIslands.includes(primaryIsland) ? primaryIsland : activeIslands[0];
    const primaryStream = primary === IslandType.ScreenShare ? stream : null;
    const primaryTrack = primary === IslandType.Spotify ? track : null;
    const primaryChannelId = primary === IslandType.Voice ? channelId : undefined;
    const idle = !track && !channelId && !stream;

    useEffect(() => {
        if (streamKey) setStreamStartedAt(Date.now());
    }, [streamKey]);

    useEffect(() => {
        setSpotifyIdle(false);
        if (!showSpotifyIsland || !spotifyTrackId || isPlaying) return;

        const timeoutId = window.setTimeout(() => setSpotifyIdle(true), SPOTIFY_IDLE_DURATION);
        return () => clearTimeout(timeoutId);
    }, [isPlaying, showSpotifyIsland, spotifyTrackId]);

    useEffect(() => {
        const updateNotification = () => setNotification(runtime.notification);
        runtime.notificationListeners.add(updateNotification);
        updateNotification();
        return () => { runtime.notificationListeners.delete(updateNotification); };
    }, []);

    useEffect(() => {
        if (!morphNotifications) {
            setIslandNotification(null);
            return;
        }

        const handleMessage = ({ message }: { message: MessageWithMentions; }) => {
            const me = UserStore.getCurrentUser();
            if (!me) return;

            const channel = ChannelStore.getChannel(message.channel_id);
            const storedMessage = MessageStore.getMessage(message.channel_id, message.id);
            if (!channel || message.author.id === me.id || storedMessage?.blocked) return;

            const directlyMentioned = message.mentions.some(mention => typeof mention === "string" ? mention === me.id : mention.id === me.id);
            const memberRoles = channel.guild_id ? GuildMemberStore.getMember(channel.guild_id, me.id)?.roles ?? [] : [];
            const roleMentioned = channel.guild_id != null
                && !UserGuildSettingsStore.isSuppressRolesEnabled(channel.guild_id)
                && message.mention_roles.some(roleId => memberRoles.includes(roleId));
            const everyoneMentioned = channel.guild_id != null
                && !UserGuildSettingsStore.isSuppressEveryoneEnabled(channel.guild_id)
                && message.mention_everyone;
            const mentioned = storedMessage?.mentioned === true || directlyMentioned || roleMentioned || everyoneMentioned;
            if (channel.guild_id && !mentioned) return;

            const author = UserStore.getUser(message.author.id) ?? message.author;
            setIslandNotification({
                avatarUrl: IconUtils.getUserAvatarURL(author, false, 64),
                body: message.content.trim() || (message.attachments.length ? "Sent an attachment." : "Sent a message."),
                id: message.id,
                title: author.globalName ?? author.username
            });
        };

        FluxDispatcher.subscribe("MESSAGE_CREATE", handleMessage);
        return () => FluxDispatcher.unsubscribe("MESSAGE_CREATE", handleMessage);
    }, [morphNotifications]);

    useEffect(() => {
        if (idle) setExpanded(false);
    }, [idle]);

    if (idle && !notification && !keepIslandVisible) return null;

    const activateSummary = () => {
        if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
        }

        setIslandNotification(null);
        setExpanded(value => !value);
    };

    const cyclePrimary = (direction: 1 | -1) => {
        if (activeIslands.length < 2 || !primary) return;

        const currentIndex = activeIslands.indexOf(primary);
        const nextIndex = (currentIndex + direction + activeIslands.length) % activeIslands.length;
        setPrimaryIsland(activeIslands[nextIndex]);
    };

    const beginSwipe = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        swipeStartRef.current = {
            pointerId: event.pointerId,
            startedAt: Date.now(),
            x: event.clientX,
            y: event.clientY
        };
        suppressClickRef.current = false;
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const finishSwipe = (event: PointerEvent<HTMLDivElement>) => {
        const start = swipeStartRef.current;
        swipeStartRef.current = null;
        if (!start || start.pointerId !== event.pointerId) return;

        const distanceX = event.clientX - start.x;
        const distanceY = event.clientY - start.y;
        if (Date.now() - start.startedAt < SWIPE_MIN_DURATION || Math.abs(distanceX) < SWIPE_MIN_DISTANCE || Math.abs(distanceX) <= Math.abs(distanceY)) return;

        suppressClickRef.current = true;
        cyclePrimary(distanceX > 0 ? 1 : -1);
    };

    return (
        <div className={cl("root", `color-${islandColor}`, {
            "root-expanded": expanded,
            "root-idle": idle,
            "root-notification": notification != null,
            "root-playing": isPlaying && primary === IslandType.Spotify,
            "root-sharing": primary === IslandType.ScreenShare
        })}>
            <Clickable
                className={cl("summary")}
                aria-expanded={expanded}
                aria-label="Illegalcord Dynamic Island"
                onClick={activateSummary}
                onPointerCancel={() => { swipeStartRef.current = null; }}
                onPointerDown={beginSwipe}
                onPointerUp={finishSwipe}
            >
                {notification
                    ? <img key={notification.id} className={cl("notification-avatar")} src={notification.avatarUrl} alt="" draggable={false} />
                    : primaryStream
                        ? <ScreenShareIcon className={cl("summary-icon", "stream-icon")} />
                        : primaryTrack
                            ? <img key={primaryTrack.album.image.url} className={cl("summary-cover")} src={primaryTrack.album.image.url} alt="" draggable={false} />
                            : <IslandIcon className={cl("summary-icon")} />}
                <div key={notification?.id ?? primary ?? "idle"} className={cl("summary-copy")}>
                    <strong>{notification?.title ?? (primaryStream ? "You are sharing your screen" : primaryTrack?.name ?? (primaryChannelId ? "Discord call" : "Illegalcord Dynamic Island"))}</strong>
                    <span>{notification?.body ?? (primaryStream
                        ? <>Live for <ScreenShareTimer startedAt={streamStartedAt} /></>
                        : primaryTrack
                            ? primaryTrack.artists.map(artist => artist.name).join(", ")
                            : primaryChannelId ? "Call controls available" : "Ready for your activities")}</span>
                </div>
                {!notification && primaryTrack && (
                    <span className={cl("visualizer")} aria-label={isPlaying ? "Spotify playing" : "Spotify paused"}>
                        <span /><span /><span />
                    </span>
                )}
                {!notification && primaryStream && (
                    <ControlButton compact label="Stop sharing" danger onClick={() => stopScreenShare(primaryStream)}>
                        <Glyph path="M7 7h10v10H7V7Z" />
                    </ControlButton>
                )}
                {!notification && primaryChannelId && <span className={cl("live-dot")} aria-label="Call active" />}
                {!notification && activeIslands.length > 1 && (
                    <span className={cl("pages")} aria-label={`${activeIslands.length} active Islands`}>
                        {activeIslands.map(type => <span key={type} className={cl("page", { "page-active": type === primary })} />)}
                    </span>
                )}
            </Clickable>
            {notification && <span key={notification.id} className={cl("notification-progress")} />}
            <div className={cl("panel-shell")} aria-hidden={!expanded}>
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
    const owner = useRef(Symbol()).current;
    const [, forceUpdate] = useState(0);

    useEffect(() => {
        const syncPortal = () => {
            if (runtime.activeModule === portalModule && runtime.owner == null) runtime.owner = owner;
            forceUpdate(value => value + 1);
        };

        runtime.portalListeners.add(syncPortal);
        syncPortal();
        return () => {
            runtime.portalListeners.delete(syncPortal);
            if (runtime.owner !== owner) return;
            runtime.owner = null;
            runtime.portalListeners.forEach(listener => listener());
        };
    }, [owner]);

    return runtime.activeModule === portalModule && runtime.owner === owner
        ? ReactDOM.createPortal(<DynamicIsland />, document.body)
        : null;
}

const SafeDynamicIsland = ErrorBoundary.wrap(DynamicIslandPortal, { noop: true });

export default definePlugin({
    name: "IllegalcordDynamicIsland",
    description: "Adds a Dynamic Island for Spotify, calls, screen sharing, and notifications.",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    tags: ["Media", "Voice"],
    dependencies: ["HeaderBarAPI", "MusicControls"],
    settings,

    start() {
        musicControlsSettings.store.showSpotifyControls = settings.store.showSpotifyPanel;
    },

    stop() {
        setIslandNotification(null);
    },

    headerBarButton: {
        icon: IslandIcon,
        render: () => <SafeDynamicIsland />,
        priority: 10_000
    }
});
