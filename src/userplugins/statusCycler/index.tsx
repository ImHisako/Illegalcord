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
import { settings as musicControlsSettings } from "@equicordplugins/musicControls/settings";
import { getLyrics } from "@equicordplugins/musicControls/spotify/lyrics/api";
import type { SyncedLyric } from "@equicordplugins/musicControls/spotify/lyrics/providers/types";
import { SpotifyStore as SpotifyPlayerStore } from "@equicordplugins/musicControls/spotify/SpotifyStore";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { chooseFile } from "@utils/web";
import type { Channel, SpotifyTrack } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";
import { Alerts, ChannelStore, Clickable, Popout, SelectedChannelStore, showToast, SpotifyStore as DiscordSpotifyStore, TextArea, Toasts, useRef, UserStore, useStateFromStores } from "@webpack/common";

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

interface SpotifyLyricMatch {
    currentIndex?: number;
    nextIndex?: number;
    rawIndex: number;
    staleIndex?: number;
}

interface AccountStatusState {
    emojis?: string;
    phrases?: string;
    sourceFileName?: string;
}

interface StatusUpdate {
    errorMessage: string;
    spotify?: {
        clearStale?: boolean;
        lyricIndex: number;
        timeline: number;
        trackId: string;
    };
    value: CustomStatusSetting;
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

const ACCOUNT_SETTING_KEYS: "accountStates"[] = ["accountStates"];
const CUSTOM_EMOJI_REGEX = /^<a?:([\w-]+):(\d+)>$/;
const EMOJI_INTENTION = { STATUS: 1 } as const;
const SPOTIFY_LYRIC_STALE_AFTER_SECONDS = 8;
const SPOTIFY_LYRICS_END_GRACE_MS = 15_000;
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
let spotifyTimeline = 0;
let lastSpotifyLyricIndex: number | undefined;
let pendingSpotifyBackwardLyricIndex: number | undefined;
let spotifyBackwardConfirmations = 0;
let nextSpotifyLyricsUpdateAt = 0;
let pendingStatusUpdate: StatusUpdate | undefined;
let statusUpdateInFlight = false;
let lastSpotifyStatusText: string | undefined;
const phraseIndexes = new Map<string, number>();
const emojiIndexes = new Map<string, number>();

function getCurrentUserId() {
    return UserStore.getCurrentUser()?.id;
}

function getAccountKey() {
    return getCurrentUserId() ?? "default";
}

function getAccountState() {
    const userId = getCurrentUserId();
    return userId ? settings.plain.accountStates?.[userId] : undefined;
}

function setAccountState(update: AccountStatusState) {
    const userId = getCurrentUserId();

    if (!userId) {
        if (update.phrases !== undefined) settings.store.phrases = update.phrases;
        if (update.emojis !== undefined) settings.store.emojis = update.emojis;
        if ("sourceFileName" in update) settings.store.sourceFileName = update.sourceFileName;
        return;
    }

    const accountStates = settings.plain.accountStates ?? {};

    settings.store.accountStates = {
        ...accountStates,
        [userId]: {
            ...accountStates[userId],
            ...update
        }
    };
}

function getAccountPhrases() {
    return getAccountState()?.phrases ?? settings.store.phrases;
}

function getAccountEmojis() {
    return getAccountState()?.emojis ?? settings.store.emojis;
}

function getSeededIndex(seed: string, length: number) {
    let hash = 0;

    for (let i = 0; i < seed.length; i++) {
        hash = (hash * 31 + seed.charCodeAt(i)) % length;
    }

    return hash;
}

function takeNextIndex(indexes: Map<string, number>, length: number, seed: string) {
    const key = getAccountKey();
    const index = (indexes.get(key) ?? getSeededIndex(`${key}:${seed}`, length)) % length;
    indexes.set(key, (index + 1) % length);
    return index;
}

function resetCurrentIndex(indexes: Map<string, number>) {
    indexes.set(getAccountKey(), 0);
}

function getPhrases(value = getAccountPhrases()) {
    return value.split(/\r?\n|\r/).map(line => line.trim()).filter(Boolean);
}

function getEmojis(value = getAccountEmojis()): StatusEmoji[] {
    return value.split(/\r?\n|\r/).map(line => {
        const emoji = line.trim();
        const customEmoji = emoji.match(CUSTOM_EMOJI_REGEX);

        return {
            emojiId: customEmoji?.[2] ?? "0",
            emojiName: customEmoji?.[1] ?? emoji
        };
    }).filter(emoji => emoji.emojiName);
}

function phrasesHavePriority() {
    return settings.plain.prioritizePhrases && getPhrases().length > 0;
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

function getSpotifyPositionMs(reportedPosition?: number) {
    if (reportedPosition !== undefined) return reportedPosition;
    if (SpotifyPlayerStore.track?.id === spotifyPlaybackTrackId) return SpotifyPlayerStore.position;
    const activity = DiscordSpotifyStore.getActivity();

    return activity && DiscordSpotifyStore.getTrack()?.id === spotifyPlaybackTrackId
        ? Math.max(0, Date.now() - activity.timestamps.start)
        : 0;
}

function getSpotifyPosition(reportedPosition?: number) {
    return (getSpotifyPositionMs(reportedPosition) + (musicControlsSettings.plain.lyricDelay ?? 0)) / 1_000;
}

function getSpotifyLyricMatch(position: number): SpotifyLyricMatch {
    let left = 0;
    let right = spotifyLyrics.length - 1;
    let currentIndex: number | undefined;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const lyric = spotifyLyrics[mid];
        const nextLyric = spotifyLyrics[mid + 1];

        if (lyric.time <= position && (!nextLyric || nextLyric.time > position)) {
            currentIndex = mid;
            break;
        }

        if (lyric.time > position) {
            right = mid - 1;
        } else {
            left = mid + 1;
        }
    }

    const nextIndex = (currentIndex !== undefined ? currentIndex + 1 : left);
    const currentLyric = currentIndex !== undefined ? spotifyLyrics[currentIndex] : undefined;

    if (currentIndex !== undefined && currentLyric && position - currentLyric.time > SPOTIFY_LYRIC_STALE_AFTER_SECONDS) {
        return {
            currentIndex: undefined,
            nextIndex: nextIndex < spotifyLyrics.length ? nextIndex : undefined,
            rawIndex: currentIndex,
            staleIndex: currentIndex
        };
    }

    return {
        currentIndex,
        nextIndex: nextIndex < spotifyLyrics.length ? nextIndex : undefined,
        rawIndex: currentIndex ?? -1,
        staleIndex: undefined
    };
}

function isCurrentSpotifyUpdate(update: NonNullable<StatusUpdate["spotify"]>, text: string) {
    if (!active || !spotifyOverrideActive || !spotifyPlaybackActive || update.trackId !== spotifyPlaybackTrackId || update.timeline !== spotifyTimeline) return false;

    const match = getSpotifyLyricMatch(getSpotifyPosition());
    if (update.clearStale) return match.staleIndex === update.lyricIndex && text === "";

    return match.currentIndex === update.lyricIndex
        && (lastSpotifyLyricIndex === undefined || update.lyricIndex >= lastSpotifyLyricIndex)
        && spotifyLyrics[update.lyricIndex]?.text?.trim().slice(0, 128) === text;
}

function updateStatus(update: StatusUpdate) {
    if (statusUpdateInFlight || !CustomStatusSettings) {
        pendingStatusUpdate = update;
        return;
    }

    if (update.spotify && !isCurrentSpotifyUpdate(update.spotify, update.value.text)) {
        if (pendingStatusUpdate) {
            const next = pendingStatusUpdate;
            pendingStatusUpdate = undefined;
            updateStatus(next);
        }
        return;
    }

    statusUpdateInFlight = true;
    pendingStatusUpdate = undefined;

    if (update.spotify && !isCurrentSpotifyUpdate(update.spotify, update.value.text)) {
        statusUpdateInFlight = false;
        if (pendingStatusUpdate) updateStatus(pendingStatusUpdate);
        return;
    }

    if (update.spotify) {
        lastSpotifyLyricIndex = update.spotify.lyricIndex;
        lastSpotifyStatusText = update.spotify.clearStale ? undefined : update.value.text;
    }

    void CustomStatusSettings.updateSetting(update.value)
        .catch(error => logger.error(update.errorMessage, error))
        .finally(() => {
            statusUpdateInFlight = false;
            if (pendingStatusUpdate) updateStatus(pendingStatusUpdate);
        });
}

function clearStaleSpotifyLyricStatus(trackId: string, lyricIndex: number) {
    if (!CustomStatusSettings || !lastSpotifyStatusText || lastSpotifyLyricIndex !== lyricIndex) return;

    const current = CustomStatusSettings.getSetting();
    if (current?.text !== lastSpotifyStatusText) return;

    updateStatus({
        errorMessage: "Could not clear the stale Spotify lyric status.",
        spotify: {
            clearStale: true,
            lyricIndex,
            timeline: spotifyTimeline,
            trackId
        },
        value: {
            text: "",
            expiresAtMs: "0",
            emojiId: current.emojiId,
            emojiName: current.emojiName,
            createdAtMs: String(Date.now())
        }
    });
}

function applyNextStatus() {
    if (!active || spotifyOverrideActive) return;

    const phrases = getPhrases();
    const emojis = getEmojis();
    if ((!phrases.length && !emojis.length) || !CustomStatusSettings) return;

    const current = CustomStatusSettings.getSetting();
    let text = current?.text ?? "";
    let emojiId = current?.emojiId ?? "0";
    let emojiName = current?.emojiName ?? "";

    if (phrases.length) {
        const nextIndex = takeNextIndex(phraseIndexes, phrases.length, "phrases");
        text = phrases[nextIndex];
    }

    if (emojis.length) {
        const nextEmojiIndex = takeNextIndex(emojiIndexes, emojis.length, "emojis");
        ({ emojiId, emojiName } = emojis[nextEmojiIndex]);
    }

    setNextSpotifyLyricsUpdate();

    updateStatus({
        errorMessage: "Could not update the custom status.",
        value: {
            text,
            expiresAtMs: "0",
            emojiId,
            emojiName,
            createdAtMs: String(Date.now())
        }
    });
}

function scheduleSpotifyLyric(reportedPosition?: number) {
    if (lyricsTimeoutId !== undefined) clearTimeout(lyricsTimeoutId);
    lyricsTimeoutId = undefined;

    const trackId = spotifyPlaybackTrackId;
    if (!active || !settings.plain.useSpotifyLyrics || phrasesHavePriority() || !spotifyPlaybackActive || !trackId || spotifyLyricsTrackId !== trackId || !spotifyLyrics.length) return;

    const position = getSpotifyPosition(reportedPosition);
    const match = getSpotifyLyricMatch(position);
    const { currentIndex } = match;

    if (lastSpotifyLyricIndex !== undefined && match.rawIndex < lastSpotifyLyricIndex) {
        if (reportedPosition !== undefined && pendingSpotifyBackwardLyricIndex !== undefined && match.rawIndex >= pendingSpotifyBackwardLyricIndex && match.rawIndex <= pendingSpotifyBackwardLyricIndex + 1) {
            spotifyBackwardConfirmations++;
            pendingSpotifyBackwardLyricIndex = match.rawIndex;
            if (spotifyBackwardConfirmations >= 3) {
                spotifyTimeline++;
                lastSpotifyLyricIndex = undefined;
                lastSpotifyStatusText = undefined;
                pendingSpotifyBackwardLyricIndex = undefined;
                spotifyBackwardConfirmations = 0;
                pendingStatusUpdate = undefined;
            } else {
                return;
            }
        } else {
            if (reportedPosition !== undefined) {
                pendingSpotifyBackwardLyricIndex = match.rawIndex;
                spotifyBackwardConfirmations = 1;
            }
            return;
        }
    } else {
        pendingSpotifyBackwardLyricIndex = undefined;
        spotifyBackwardConfirmations = 0;
    }

    if (match.staleIndex !== undefined) clearStaleSpotifyLyricStatus(trackId, match.staleIndex);

    const text = currentIndex !== undefined ? spotifyLyrics[currentIndex]?.text?.trim() : undefined;
    if (currentIndex !== undefined && text && currentIndex !== lastSpotifyLyricIndex && CustomStatusSettings) {
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
            const nextEmojiIndex = takeNextIndex(emojiIndexes, emojis.length, "emojis");
            ({ emojiId, emojiName } = emojis[nextEmojiIndex]);
        }

        setNextSpotifyLyricsUpdate();

        updateStatus({
            errorMessage: "Could not update the custom status with Spotify lyrics.",
            spotify: {
                lyricIndex: currentIndex,
                timeline: spotifyTimeline,
                trackId
            },
            value: {
                text: text.slice(0, 128),
                expiresAtMs: "0",
                emojiId,
                emojiName,
                createdAtMs: String(Date.now())
            }
        });
    }

    const nextTimes = [
        currentIndex !== undefined ? spotifyLyrics[currentIndex].time + SPOTIFY_LYRIC_STALE_AFTER_SECONDS : undefined,
        match.nextIndex !== undefined ? spotifyLyrics[match.nextIndex].time : undefined
    ].filter((time): time is number => time !== undefined && time > position);
    const nextTime = Math.min(...nextTimes);

    if (Number.isFinite(nextTime)) {
        lyricsTimeoutId = setTimeout(scheduleSpotifyLyric, Math.max(100, (nextTime - position) * 1_000));
    } else {
        lyricsTimeoutId = setTimeout(() => {
            lyricsTimeoutId = undefined;
            spotifyLyrics = [];
            resumePhraseRotation();
        }, SPOTIFY_LYRICS_END_GRACE_MS);
    }
}

function resumePhraseRotation() {
    if (lyricsTimeoutId !== undefined) clearTimeout(lyricsTimeoutId);
    lyricsTimeoutId = undefined;

    if (!spotifyOverrideActive) return;
    spotifyOverrideActive = false;
    spotifyTimeline++;
    lastSpotifyLyricIndex = undefined;
    lastSpotifyStatusText = undefined;
    pendingSpotifyBackwardLyricIndex = undefined;
    spotifyBackwardConfirmations = 0;
    restartRotation();
}

async function startSpotifyLyrics(track: SpotifyTrack, position?: number) {
    if (phrasesHavePriority()) return;

    const trackChanged = spotifyPlaybackTrackId !== track.id;
    spotifyPlaybackActive = true;
    spotifyPlaybackTrackId = track.id;

    if (spotifyLyricsTrackId === track.id && !spotifyLyrics.length) return;

    if (!spotifyOverrideActive || trackChanged) pendingStatusUpdate = undefined;
    spotifyOverrideActive = true;
    if (intervalId !== undefined) clearInterval(intervalId);
    intervalId = undefined;

    if (trackChanged) {
        spotifyLyrics = [];
        spotifyLyricsTrackId = undefined;
        spotifyTimeline++;
        lastSpotifyLyricIndex = undefined;
        lastSpotifyStatusText = undefined;
        pendingSpotifyBackwardLyricIndex = undefined;
        spotifyBackwardConfirmations = 0;
        nextSpotifyLyricsUpdateAt = 0;
        if (lyricsTimeoutId !== undefined) clearTimeout(lyricsTimeoutId);
        lyricsTimeoutId = undefined;
    }

    if (spotifyLyricsTrackId === track.id) {
        if (spotifyLyrics.length) {
            scheduleSpotifyLyric(position);
        }
        return;
    }

    if (loadingSpotifyTrackId === track.id) return;
    loadingSpotifyTrackId = track.id;

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
    const lyricsInfo = await getLyrics(lyricsTrack).catch(error => {
        logger.error("Could not load Spotify lyrics.", error);
        return null;
    });
    if (loadingSpotifyTrackId === track.id) loadingSpotifyTrackId = undefined;

    if (!active || !settings.plain.useSpotifyLyrics || phrasesHavePriority() || !spotifyPlaybackActive || DiscordSpotifyStore.getTrack()?.id !== track.id) return;

    spotifyLyricsTrackId = track.id;
    spotifyLyrics = lyricsInfo?.lyricsVersions[lyricsInfo.useLyric]
        ?.filter(lyric => lyric.text?.trim())
        .sort((a, b) => a.time - b.time) ?? [];

    if (!spotifyLyrics.length) {
        resumePhraseRotation();
        return;
    }

    scheduleSpotifyLyric();
}

function stopSpotifyLyrics() {
    spotifyPlaybackActive = false;
    loadingSpotifyTrackId = undefined;
    resumePhraseRotation();
}

function syncSpotifyLyrics(enabled: boolean) {
    if (!active) return;

    if (!enabled || phrasesHavePriority()) {
        stopSpotifyLyrics();
        return;
    }

    const track = DiscordSpotifyStore.getTrack();
    const activity = DiscordSpotifyStore.getActivity();
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

function restartPhraseRotation() {
    resetCurrentIndex(phraseIndexes);
    restartRotation();
    syncSpotifyLyrics(settings.store.useSpotifyLyrics);
}

function restartWithFirstPhrase() {
    setAccountState({ sourceFileName: undefined });
    restartPhraseRotation();
}

function restartWithFirstEmoji() {
    resetCurrentIndex(emojiIndexes);
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

        setAccountState({
            phrases: phrases.join("\n"),
            sourceFileName: file.name
        });
        restartPhraseRotation();
        showToast(`Imported ${phrases.length} ${phrases.length === 1 ? "phrase" : "phrases"} from ${file.name}.`, Toasts.Type.SUCCESS);
    } catch (error) {
        logger.error("Could not read the selected text file.", error);
        showToast("Could not read the selected file.", Toasts.Type.FAILURE);
    }
}

function PhrasesSetting() {
    const currentUser = useStateFromStores([UserStore], () => UserStore.getCurrentUser());
    const { accountStates } = settings.use(ACCOUNT_SETTING_KEYS);
    const phrases = currentUser ? accountStates?.[currentUser.id]?.phrases ?? settings.store.phrases : settings.store.phrases;

    return (
        <Flex flexDirection="column" gap="8px">
            <span>
                {currentUser
                    ? `Custom status phrases for @${currentUser.username}, one per line.`
                    : "Custom status phrases for this account, one per line."}
            </span>
            <TextArea
                value={phrases}
                placeholder={"First phrase\nSecond phrase\nThird phrase"}
                onChange={value => {
                    setAccountState({
                        phrases: value,
                        sourceFileName: undefined
                    });
                    restartPhraseRotation();
                }}
            />
        </Flex>
    );
}

const SafePhrasesSetting = ErrorBoundary.wrap(PhrasesSetting, { noop: true });

function ImportSetting() {
    const currentUser = useStateFromStores([UserStore], () => UserStore.getCurrentUser());
    const { accountStates } = settings.use(ACCOUNT_SETTING_KEYS);
    const phrases = currentUser ? accountStates?.[currentUser.id]?.phrases ?? settings.store.phrases : settings.store.phrases;
    const sourceFileName = currentUser ? accountStates?.[currentUser.id]?.sourceFileName ?? settings.store.sourceFileName : settings.store.sourceFileName;
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

function EmojiSetting() {
    const currentUser = useStateFromStores([UserStore], () => UserStore.getCurrentUser());
    const { accountStates } = settings.use(ACCOUNT_SETTING_KEYS);
    const emojis = currentUser ? accountStates?.[currentUser.id]?.emojis ?? settings.store.emojis : settings.store.emojis;
    const triggerRef = useRef<HTMLDivElement>(null);
    const channel = useStateFromStores([SelectedChannelStore, ChannelStore], () => {
        const channelId = SelectedChannelStore.getChannelId();
        return channelId ? ChannelStore.getChannel(channelId) : null;
    });

    return (
        <Flex flexDirection="column" gap="8px">
            <span>
                {currentUser
                    ? `Status emojis for @${currentUser.username}, one per line. Unicode, custom and animated Discord emojis are supported.`
                    : "Status emojis for this account, one per line. Unicode, custom and animated Discord emojis are supported."}
            </span>
            <Flex alignItems="center" gap="8px">
                <TextArea
                    value={emojis}
                    placeholder={"😀\n<:custom:123456789012345678>\n<a:animated:123456789012345678>"}
                    onChange={value => {
                        setAccountState({ emojis: value });
                        restartWithFirstEmoji();
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
                                    setAccountState({ emojis: nextEmojis });
                                    restartWithFirstEmoji();
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
        type: OptionType.COMPONENT,
        description: "Custom status phrases, one per line.",
        component: SafePhrasesSetting,
        default: "",
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
    prioritizePhrases: {
        type: OptionType.BOOLEAN,
        description: "Give configured phrases priority over Spotify lyrics while music is playing.",
        default: false,
        onChange: () => syncSpotifyLyrics(settings.store.useSpotifyLyrics)
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
    accountStates?: Record<string, AccountStatusState>;
    sourceFileName?: string;
}>();

export default definePlugin({
    name: "StatusCycler",
    description: "Automatically rotates through custom status phrases and emojis at a configurable interval.",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    tags: ["Activity", "Utility"],
    dependencies: ["UserSettingsAPI"],
    settings,

    start() {
        active = true;
        syncSpotifyLyrics(settings.store.useSpotifyLyrics);
        restartRotation();
    },

    stop() {
        active = false;
        spotifyPlaybackActive = false;
        spotifyOverrideActive = false;
        loadingSpotifyTrackId = undefined;
        spotifyTimeline++;
        lastSpotifyLyricIndex = undefined;
        lastSpotifyStatusText = undefined;
        pendingSpotifyBackwardLyricIndex = undefined;
        spotifyBackwardConfirmations = 0;
        pendingStatusUpdate = undefined;
        spotifyLyrics = [];
        spotifyLyricsTrackId = undefined;
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
        CONNECTION_OPEN() {
            pendingStatusUpdate = undefined;
            stopSpotifyLyrics();
            restartRotation();
            syncSpotifyLyrics(settings.store.useSpotifyLyrics);
        },

        async SPOTIFY_PLAYER_STATE({ track, position, isPlaying }: SpotifyPlayerState) {
            if (!settings.plain.useSpotifyLyrics || phrasesHavePriority()) return;

            if (!track || !isPlaying) {
                stopSpotifyLyrics();
                return;
            }

            await startSpotifyLyrics(track, position);
        }
    }
});
