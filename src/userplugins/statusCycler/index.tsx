/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { getLyricsLrclib } from "@equicordplugins/musicControls/spotify/lyrics/providers/lrclibAPI";
import type { SyncedLyric } from "@equicordplugins/musicControls/spotify/lyrics/providers/types";
import { EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, type PluginNative, type PluginSettingComponentProps } from "@utils/types";
import { chooseFile } from "@utils/web";
import type { Channel, SpotifyTrack } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";
import { Alerts, ChannelStore, Clickable, Popout, SelectedChannelStore, showToast, SpotifyStore, TextArea, Toasts, useRef, useState, useStateFromStores } from "@webpack/common";

interface CustomStatusSetting {
    createdAtMs?: string;
    emojiId: string;
    emojiName: string;
    expiresAtMs: string;
    text: string;
}

interface SpotifyPlayerState {
    isPlaying?: boolean;
    position?: number;
    track: SpotifyTrack | null;
}

interface StatusEmoji {
    emojiId: string;
    emojiName: string;
}

interface EmojiSelectPayload {
    animated?: boolean;
    id?: string | null;
    name?: string | null;
    optionallyDiverseSequence?: string;
}

interface ReactionEmojiPickerProps {
    channel?: Channel | null;
    closePopout(): void;
    onSelectEmoji(selection: {
        emoji: EmojiSelectPayload | null;
        willClose: boolean;
    }): void;
    pickerIntention: number;
}

const IMPORT_SETTING_KEYS: ("phrases" | "sourceFileName")[] = ["phrases", "sourceFileName"];
const CUSTOM_EMOJI_REGEX = /^<a?:([\w-]+):(\d+)>$/;
const EMOJI_INTENTION = { STATUS: 1 } as const;
const SPOTIFY_POSITION_JITTER_MS = 2_000;
const logger = new Logger("StatusCycler");
const CustomStatusSettings = getUserSettingLazy<CustomStatusSetting | null>("status", "customStatus");
const Native = VencordNative?.pluginHelpers?.StatusCycler as PluginNative<typeof import("./native")> | undefined;
const ReactionEmojiPicker = findComponentByCodeLazy<ReactionEmojiPickerProps>(
    "showAddEmojiButton:",
    "pickerIntention:",
    "messageId:"
);

let active = false;
let intervalId: ReturnType<typeof setInterval> | undefined;
let lyricsTimeoutId: ReturnType<typeof setTimeout> | undefined;
let loadingSpotifyTrackId: string | undefined;
let spotifyLyrics: SyncedLyric[] = [];
let spotifyLyricsTrackId: string | undefined;
let spotifyOverrideActive = false;
let spotifyPlaybackActive = false;
let spotifyPlaybackTrackId: string | undefined;
let spotifyPosition = 0;
let spotifyPositionUpdatedAt = 0;
let lastLyricText: string | undefined;
let nextSpotifyLyricsUpdateAt = 0;

function getPhrases(value = settings.store.phrases) {
    return value.split(/\r?\n|\r/).map(line => line.trim()).filter(Boolean);
}

function getEmojis(value = settings.store.emojis): StatusEmoji[] {
    return value.split(/\r?\n|\r/).map(line => {
        const emoji = line.trim();
        const customEmoji = emoji.match(CUSTOM_EMOJI_REGEX);

        return {
            emojiId: customEmoji?.[2] ?? "0",
            emojiName: customEmoji?.[1] ?? emoji
        };
    }).filter(emoji => emoji.emojiName);
}

function setNextSpotifyLyricsUpdate() {
    const delay = settings.plain.spotifyLyricsUpdateDelay * 1_000;
    const variation = settings.plain.humanizeSpotifyLyricsDelay ? Math.random() * delay * 0.35 : 0;
    nextSpotifyLyricsUpdateAt = Date.now() + delay + variation;
}

function restartSpotifyLyricsDelay() {
    nextSpotifyLyricsUpdateAt = 0;
    scheduleSpotifyLyric();
}

function applyNextStatus() {
    const phrases = getPhrases();
    const emojis = getEmojis();
    if ((!phrases.length && !emojis.length) || !CustomStatusSettings) return;

    const current = CustomStatusSettings.getSetting();
    let text = current?.text ?? "";
    let emojiId = current?.emojiId ?? "0";
    let emojiName = current?.emojiName ?? "";

    if (phrases.length) {
        const nextIndex = (settings.store.nextIndex ?? 0) % phrases.length;
        text = phrases[nextIndex];
        settings.store.nextIndex = (nextIndex + 1) % phrases.length;
    }

    if (emojis.length) {
        const nextEmojiIndex = (settings.store.nextEmojiIndex ?? 0) % emojis.length;
        ({ emojiId, emojiName } = emojis[nextEmojiIndex]);
        settings.store.nextEmojiIndex = (nextEmojiIndex + 1) % emojis.length;
    }

    setNextSpotifyLyricsUpdate();

    void CustomStatusSettings.updateSetting({
        text,
        expiresAtMs: "0",
        emojiId,
        emojiName,
        createdAtMs: String(Date.now())
    }).catch(error => logger.error("Could not update the custom status.", error));
}

function scheduleSpotifyLyric() {
    if (lyricsTimeoutId !== undefined) clearTimeout(lyricsTimeoutId);
    lyricsTimeoutId = undefined;

    if (!active || !settings.plain.useSpotifyLyrics || !spotifyPlaybackActive || !spotifyLyrics.length) return;

    const position = (spotifyPosition + Date.now() - spotifyPositionUpdatedAt) / 1_000;
    let currentIndex = -1;

    for (let index = 0; index < spotifyLyrics.length; index++) {
        if (spotifyLyrics[index].time > position) break;
        currentIndex = index;
    }

    const text = spotifyLyrics[currentIndex]?.text?.trim();
    if (text && text !== lastLyricText && CustomStatusSettings) {
        const remainingDelay = nextSpotifyLyricsUpdateAt - Date.now();
        if (remainingDelay > 0) {
            lyricsTimeoutId = setTimeout(scheduleSpotifyLyric, remainingDelay);
            return;
        }

        const current = CustomStatusSettings.getSetting();
        let emojiId = current?.emojiId ?? "0";
        let emojiName = current?.emojiName ?? "";
        const emojis = getEmojis();

        if (emojis.length) {
            const nextEmojiIndex = (settings.store.nextEmojiIndex ?? 0) % emojis.length;
            ({ emojiId, emojiName } = emojis[nextEmojiIndex]);
            settings.store.nextEmojiIndex = (nextEmojiIndex + 1) % emojis.length;
        }

        lastLyricText = text;
        setNextSpotifyLyricsUpdate();

        void CustomStatusSettings.updateSetting({
            text: text.slice(0, 128),
            expiresAtMs: "0",
            emojiId,
            emojiName,
            createdAtMs: String(Date.now())
        }).catch(error => logger.error("Could not update the custom status with Spotify lyrics.", error));
    }

    const nextLyric = spotifyLyrics.slice(currentIndex + 1).find(lyric => lyric.time > position);
    if (nextLyric) {
        lyricsTimeoutId = setTimeout(scheduleSpotifyLyric, Math.max(100, (nextLyric.time - position) * 1_000));
    }
}

function resumePhraseRotation() {
    if (lyricsTimeoutId !== undefined) clearTimeout(lyricsTimeoutId);
    lyricsTimeoutId = undefined;
    lastLyricText = undefined;

    if (!spotifyOverrideActive) return;
    spotifyOverrideActive = false;
    restartRotation();
}

async function startSpotifyLyrics(track: SpotifyTrack, position?: number) {
    const trackChanged = spotifyPlaybackTrackId !== track.id;
    const playbackResumed = !spotifyPlaybackActive;
    spotifyPlaybackActive = true;
    spotifyPlaybackTrackId = track.id;

    if (position !== undefined || trackChanged) {
        const now = Date.now();
        const activity = SpotifyStore.getTrack()?.id === track.id ? SpotifyStore.getActivity() : null;
        const reportedPosition = position ?? (activity ? Math.max(0, now - activity.timestamps.start) : 0);
        const estimatedPosition = spotifyPosition + now - spotifyPositionUpdatedAt;

        if (trackChanged || playbackResumed || Math.abs(reportedPosition - estimatedPosition) > SPOTIFY_POSITION_JITTER_MS) {
            spotifyPosition = reportedPosition;
            spotifyPositionUpdatedAt = now;
        }
    } else if (playbackResumed) {
        spotifyPositionUpdatedAt = Date.now();
    }

    if (spotifyLyricsTrackId === track.id) {
        if (spotifyLyrics.length) {
            if (intervalId !== undefined) clearInterval(intervalId);
            intervalId = undefined;
            spotifyOverrideActive = true;
            scheduleSpotifyLyric();
        }
        return;
    }

    if (loadingSpotifyTrackId === track.id) return;
    loadingSpotifyTrackId = track.id;
    lastLyricText = undefined;
    if (lyricsTimeoutId !== undefined) clearTimeout(lyricsTimeoutId);
    lyricsTimeoutId = undefined;

    const lyricsTrack = {
        ...track,
        album: {
            ...track.album,
            image: track.album.image ?? { height: 0, width: 0, url: "" }
        },
        artists: track.artists.map(artist => ({
            ...artist,
            href: "",
            type: "artist",
            uri: `spotify:artist:${artist.id}`
        }))
    };
    const lyricsInfo = await getLyricsLrclib(lyricsTrack).catch(error => {
        logger.error("Could not load Spotify lyrics.", error);
        return null;
    });
    if (loadingSpotifyTrackId === track.id) loadingSpotifyTrackId = undefined;

    if (!active || !settings.plain.useSpotifyLyrics || !spotifyPlaybackActive || SpotifyStore.getTrack()?.id !== track.id) return;

    spotifyLyricsTrackId = track.id;
    spotifyLyrics = lyricsInfo?.lyricsVersions[lyricsInfo.useLyric]?.filter(lyric => lyric.text) ?? [];

    if (!spotifyLyrics.length) {
        resumePhraseRotation();
        return;
    }

    if (intervalId !== undefined) clearInterval(intervalId);
    intervalId = undefined;
    spotifyOverrideActive = true;
    scheduleSpotifyLyric();
}

function stopSpotifyLyrics() {
    if (spotifyPlaybackActive) {
        spotifyPosition += Date.now() - spotifyPositionUpdatedAt;
        spotifyPositionUpdatedAt = Date.now();
    }
    spotifyPlaybackActive = false;
    loadingSpotifyTrackId = undefined;
    resumePhraseRotation();
}

function syncSpotifyLyrics(enabled: boolean) {
    if (!active) return;

    if (!enabled) {
        stopSpotifyLyrics();
        return;
    }

    const track = SpotifyStore.getTrack();
    const activity = SpotifyStore.getActivity();
    if (!track || !activity) return;

    void startSpotifyLyrics(track, Math.max(0, Date.now() - activity.timestamps.start))
        .catch(error => logger.error("Could not load Spotify lyrics.", error));
}

function restartRotation() {
    if (!active || spotifyOverrideActive) return;

    if (intervalId !== undefined) clearInterval(intervalId);
    intervalId = undefined;

    if (!getPhrases().length && !getEmojis().length) return;

    applyNextStatus();
    intervalId = setInterval(applyNextStatus, settings.store.rotationInterval * 1_000);
}

function restartWithFirstPhrase() {
    settings.store.nextIndex = 0;
    settings.store.sourceFileName = undefined;
    restartRotation();
}

function restartWithFirstEmoji() {
    settings.store.nextEmojiIndex = 0;
    restartRotation();
}

async function importPhrases() {
    const file = await chooseFile(".txt,text/plain");
    if (!file) return;

    try {
        const phrases = getPhrases(await file.text());
        if (!phrases.length) {
            showToast("The file does not contain any valid phrases.", Toasts.Type.FAILURE);
            return;
        }

        settings.store.phrases = phrases.join("\n");
        settings.store.sourceFileName = file.name;
        showToast(`Imported ${phrases.length} ${phrases.length === 1 ? "phrase" : "phrases"} from ${file.name}.`, Toasts.Type.SUCCESS);
    } catch (error) {
        logger.error("Could not read the selected text file.", error);
        showToast("Could not read the selected file.", Toasts.Type.FAILURE);
    }
}

function ImportSetting() {
    const { phrases, sourceFileName } = settings.use(IMPORT_SETTING_KEYS);
    const count = getPhrases(phrases).length;

    return (
        <Flex flexDirection="column" gap="8px">
            <Button onClick={() => void importPhrases()}>Select TXT file</Button>
            <span>
                {sourceFileName
                    ? `${sourceFileName}: ${count} ${count === 1 ? "phrase" : "phrases"}.`
                    : "No file selected."}
            </span>
        </Flex>
    );
}

const SafeImportSetting = ErrorBoundary.wrap(ImportSetting, { noop: true });

function EmojiSetting({ setValue }: PluginSettingComponentProps) {
    const [emojis, setEmojis] = useState(settings.store.emojis);
    const triggerRef = useRef<HTMLDivElement>(null);
    const channel = useStateFromStores([SelectedChannelStore, ChannelStore], () => {
        const channelId = SelectedChannelStore.getChannelId();
        return channelId ? ChannelStore.getChannel(channelId) : null;
    });

    return (
        <Flex flexDirection="column" gap="8px">
            <span>Status emojis, one per line. Unicode, custom and animated Discord emojis are supported.</span>
            <Flex alignItems="center" gap="8px">
                <TextArea
                    value={emojis}
                    placeholder={"😀\n<:custom:123456789012345678>\n<a:animated:123456789012345678>"}
                    onChange={value => {
                        setEmojis(value);
                        setValue(value);
                    }}
                />
                <Popout
                    position="bottom"
                    align="right"
                    targetElementRef={triggerRef}
                    renderPopout={({ closePopout }) => (
                        <ReactionEmojiPicker
                            channel={channel}
                            closePopout={closePopout}
                            pickerIntention={EMOJI_INTENTION.STATUS}
                            onSelectEmoji={({ emoji, willClose }) => {
                                const selectedEmoji = emoji?.id && emoji.name
                                    ? `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`
                                    : emoji?.optionallyDiverseSequence?.trim() || emoji?.name?.trim();

                                if (selectedEmoji) {
                                    const nextEmojis = [...emojis.split(/\r?\n|\r/).map(line => line.trim()).filter(Boolean), selectedEmoji].join("\n");
                                    setEmojis(nextEmojis);
                                    setValue(nextEmojis);
                                }
                                if (willClose) closePopout();
                            }}
                        />
                    )}
                >
                    {popoutProps => (
                        <div {...popoutProps} ref={triggerRef}>
                            <Clickable
                                aria-label="Add emoji from Discord"
                                className="vc-status-cycler-emoji-button"
                            >
                                🤓
                            </Clickable>
                        </div>
                    )}
                </Popout>
            </Flex>
        </Flex>
    );
}

const SafeEmojiSetting = ErrorBoundary.wrap(EmojiSetting, { noop: true });

function SpicetifyInstallerSetting() {
    const confirmInstall = () => Alerts.show({
        title: "Install Spicetify?",
        body: "This downloads and runs the official Spicetify installer from GitHub in a terminal. Spicetify Marketplace will be selected automatically.",
        confirmText: "Install",
        cancelText: "Cancel",
        onConfirm: () => {
            if (!Native) {
                showToast("The Spicetify installer is only available in the desktop client.", Toasts.Type.FAILURE);
                return;
            }

            showToast("Opening the Spicetify installer.", Toasts.Type.MESSAGE);
            void Native.installSpicetify()
                .then(result => showToast(
                    result.success ? "Spicetify installer opened in a terminal." : result.error,
                    result.success ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE
                ))
                .catch(error => {
                    logger.error("Could not open the Spicetify installer.", error);
                    showToast("Could not open the Spicetify installer.", Toasts.Type.FAILURE);
                });
        }
    });

    return (
        <Button onClick={confirmInstall}>Install Spicetify</Button>
    );
}

const SafeSpicetifyInstallerSetting = ErrorBoundary.wrap(SpicetifyInstallerSetting, { noop: true });

const settings = definePluginSettings({
    phrases: {
        type: OptionType.STRING,
        description: "Custom status phrases, one per line.",
        default: "",
        multiline: true,
        componentProps: {
            placeholder: "First phrase\nSecond phrase\nThird phrase"
        },
        onChange: restartWithFirstPhrase
    },
    emojis: {
        type: OptionType.COMPONENT,
        component: SafeEmojiSetting,
        default: "",
        onChange: restartWithFirstEmoji
    },
    rotationInterval: {
        type: OptionType.NUMBER,
        description: "Seconds between each custom status change.",
        default: 10,
        isValid: (value: number) => value >= 1 || "Rotation interval must be at least 1 second.",
        onChange: restartRotation
    },
    useSpotifyLyrics: {
        type: OptionType.BOOLEAN,
        description: "Use synchronized Spotify lyrics as your custom status while Spotify is playing.",
        default: false,
        onChange: syncSpotifyLyrics
    },
    spotifyLyricsUpdateDelay: {
        type: OptionType.NUMBER,
        description: "Minimum seconds between Spotify lyric status updates. Set to 0 to disable the delay.",
        default: 0,
        isValid: (value: number) => value >= 0 || "Spotify lyrics update delay cannot be negative.",
        onChange: restartSpotifyLyricsDelay
    },
    humanizeSpotifyLyricsDelay: {
        type: OptionType.BOOLEAN,
        description: "Add up to 35% random variation to the Spotify lyrics update delay.",
        default: false,
        onChange: restartSpotifyLyricsDelay
    },
    spicetifyInstaller: {
        type: OptionType.COMPONENT,
        description: "Spicetify modifies the Spotify desktop client and adds support for themes, extensions, and custom apps. Marketplace is installed automatically.",
        component: SafeSpicetifyInstallerSetting
    },
    importFile: {
        type: OptionType.COMPONENT,
        description: "Import phrases from a TXT file, one per line.",
        component: SafeImportSetting
    }
}).withPrivateSettings<{
    nextEmojiIndex?: number;
    nextIndex?: number;
    sourceFileName?: string;
}>();

export default definePlugin({
    name: "StatusCycler",
    description: "Automatically rotates through custom status phrases and emojis at a configurable interval.",
    authors: [EquicordDevs.irritably],
    tags: ["Activity", "Utility"],
    dependencies: ["UserSettingsAPI"],
    settings,

    start() {
        active = true;
        restartRotation();
        syncSpotifyLyrics(settings.store.useSpotifyLyrics);
    },

    stop() {
        active = false;
        spotifyPlaybackActive = false;
        spotifyOverrideActive = false;
        loadingSpotifyTrackId = undefined;
        lastLyricText = undefined;
        if (intervalId !== undefined) {
            clearInterval(intervalId);
            intervalId = undefined;
        }
        if (lyricsTimeoutId !== undefined) {
            clearTimeout(lyricsTimeoutId);
            lyricsTimeoutId = undefined;
        }
    },

    flux: {
        async SPOTIFY_PLAYER_STATE({ track, position, isPlaying }: SpotifyPlayerState) {
            if (!settings.plain.useSpotifyLyrics) return;

            if (!track || !isPlaying) {
                stopSpotifyLyrics();
                return;
            }

            await startSpotifyLyrics(track, position);
        }
    }
});
