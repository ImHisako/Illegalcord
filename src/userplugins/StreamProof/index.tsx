/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { compileStyle, disableStyle, enableStyle, isStyleEnabled, requireStyle } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import type { Channel, Message, VoiceState } from "@vencord/discord-types";
import { ApplicationStreamingStore, Menu, React, showToast, StreamerModeStore, Toasts, useEffect, UserStore, useState, useStateFromStores, VoiceStateStore } from "@webpack/common";

import style from "./styles.css?managed";

const ProtectionMode = {
    Blur: "blur",
    Dim: "dim",
    Blackout: "blackout"
} as const;

type ProtectionMode = typeof ProtectionMode[keyof typeof ProtectionMode];

interface StreamEvent {
    streamKey: string;
}

let manualEnabled = false;
let autoEnabled = false;
let autoSuppressedForStream = false;
const revealedMessageIds = new Set<string>();
const stateListeners = new Set<() => void>();

const CHAT_BUTTON_SETTINGS = ["showChatBarButton"] as const;
const HEADER_BUTTON_SETTINGS = ["showHeaderBarButton"] as const;
const MESSAGE_ROW_SELECTOR = '[id^="chat-messages-"]';

function emitStateChange() {
    for (const listener of stateListeners) {
        listener();
    }
}

function useStreamProofUpdates() {
    const [, forceUpdate] = useState(0);

    useEffect(() => {
        const listener = () => forceUpdate(n => n + 1);
        stateListeners.add(listener);

        return () => {
            stateListeners.delete(listener);
        };
    }, []);
}

function getStreamKey(event: StreamEvent | string) {
    return typeof event === "string" ? event : event.streamKey;
}

function isOwnStreamKey(streamKey: string) {
    return streamKey.endsWith(UserStore.getCurrentUser().id);
}

function isScreensharing() {
    const currentUser = UserStore.getCurrentUser();
    if (ApplicationStreamingStore.getCurrentUserActiveStream()) return true;
    if (ApplicationStreamingStore.getActiveStreamForUser(currentUser.id)) return true;

    return VoiceStateStore.getVoiceStateForUser(currentUser.id)?.selfStream === true;
}

function isProtectionSourceActive() {
    return isScreensharing() || settings.store.includeStreamerMode && StreamerModeStore.hidePersonalInformation;
}

function isStreamProofActive() {
    return manualEnabled || autoEnabled;
}

function getFilter(strong: boolean) {
    const mode = settings.store.protectionMode;

    if (mode === ProtectionMode.Dim) return "opacity: .12; filter: grayscale(1) saturate(.25);";
    if (mode === ProtectionMode.Blackout) return "opacity: .18; filter: brightness(0); background: var(--background-modifier-accent);";

    const blur = Math.max(2, settings.store.blurStrength);
    return `filter: blur(${strong ? blur + 8 : blur}px);`;
}

function getRevealRule(selector: string) {
    return `${selector}{filter:none!important;/* override StreamProof hide filter while revealed */opacity:1!important;/* override StreamProof dim mode while revealed */color:var(--text-normal,#dcddde)!important;/* override Discord message text colors while revealed */-webkit-text-fill-color:var(--text-normal,#dcddde)!important;/* override Discord message text fill while revealed */background:transparent!important;/* override StreamProof blackout background while revealed */text-shadow:none!important;/* override Discord text effects while revealed */user-select:text;}${selector} *{filter:none!important;/* override inherited StreamProof hide filter while revealed */opacity:1!important;/* override inherited StreamProof dim mode while revealed */color:var(--text-normal,#dcddde)!important;/* override Discord nested text colors while revealed */-webkit-text-fill-color:var(--text-normal,#dcddde)!important;/* override Discord nested text fill while revealed */text-shadow:none!important;/* override Discord nested text effects while revealed */}${selector} a{pointer-events:auto;}`;
}

function getHoverSelector(selector: string) {
    return selector.split(",").map(part => `${part.trim()}:hover`).join(",");
}

function getHoverRevealRule(selector: string) {
    if (!settings.store.revealOnHover) return "";

    return getRevealRule(getHoverSelector(selector));
}

function getClickRevealSelectors() {
    return [...revealedMessageIds]
        .map(id => `#message-content-${id},#message-accessories-${id},#message-username-${id},#message-reply-context-${id}`)
        .join(",");
}

function getMessageHoverRevealRule() {
    if (!settings.store.revealOnHover) return "";

    const selectors: string[] = [];

    if (settings.store.protectMessages) {
        selectors.push(`${MESSAGE_ROW_SELECTOR}:hover [id^="message-content-"]`);
    }

    if (settings.store.protectMedia) {
        selectors.push(`${MESSAGE_ROW_SELECTOR}:hover [id^="message-accessories-"]`);
    }

    if (settings.store.protectUsernames) {
        selectors.push(
            `${MESSAGE_ROW_SELECTOR}:hover [id^="message-username-"]`,
            `${MESSAGE_ROW_SELECTOR}:hover [id^="message-reply-context-"]`,
            `${MESSAGE_ROW_SELECTOR}:has(+ ${MESSAGE_ROW_SELECTOR}:hover) [id^="message-username-"]`
        );
    }

    return selectors.length ? getRevealRule(selectors.join(",")) : "";
}

function buildRules(selector: string, strong = false) {
    const filter = getFilter(strong);
    const reveal = getHoverRevealRule(selector);
    const hoverSelector = getHoverSelector(selector);

    return `${selector}{${filter}transition:filter .16s ease,opacity .16s ease;user-select:none;cursor:help;border-radius:4px;}${selector} a{pointer-events:none;}${reveal}${reveal ? `${hoverSelector} a{pointer-events:auto;}` : ""}`;
}

function buildStyle() {
    const rules: string[] = [];

    if (settings.store.protectMessages) {
        rules.push(buildRules('[id^="message-content-"]'));
    }

    if (settings.store.protectMedia) {
        rules.push(buildRules('[id^="message-accessories-"]', true));
    }

    if (settings.store.protectUsernames) {
        rules.push(buildRules('[id^="message-username-"],[id^="message-reply-context-"]'));
    }

    if (settings.store.protectDmList) {
        rules.push(buildRules('[data-list-id="private-channels"] [data-list-item-id^="private-channels-uid_"],[data-list-id="private-channels"] [href^="/channels/@me/"]'));
    }

    if (settings.store.protectChannelList) {
        rules.push(buildRules('[data-list-id="channels"] [data-list-item-id^="channels___"]'));
    }

    rules.push(getMessageHoverRevealRule());

    if (settings.store.revealOnClick && revealedMessageIds.size) {
        rules.push(getRevealRule(getClickRevealSelectors()));
    }

    return rules.join("");
}

function syncStyle() {
    const managedStyle = requireStyle(style);
    managedStyle.source = buildStyle();

    if (isStyleEnabled(style)) {
        compileStyle(managedStyle);
    }
}

function showStateToast(active: boolean) {
    if (!settings.store.showToasts) return;

    showToast(active ? "StreamProof enabled." : "StreamProof disabled.", active ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE);
}

function applyStreamProof(showFeedback = false) {
    const active = isStreamProofActive();

    if (!active) {
        revealedMessageIds.clear();
    }

    syncStyle();

    if (active) enableStyle(style);
    else disableStyle(style);

    if (showFeedback) showStateToast(active);
    emitStateChange();
}

function syncAutoState() {
    if (!isProtectionSourceActive()) {
        if (settings.store.disableWhenStreamEnds) autoEnabled = false;
        autoSuppressedForStream = false;
        applyStreamProof();
        return;
    }

    if (settings.store.autoStreamProof && !autoSuppressedForStream) {
        autoEnabled = true;
    }

    applyStreamProof();
}

function setManualEnabled(value: boolean) {
    manualEnabled = value;

    if (value) {
        autoSuppressedForStream = false;
    } else if (autoEnabled) {
        autoEnabled = false;
        autoSuppressedForStream = isProtectionSourceActive();
    }

    applyStreamProof(true);
}

function toggleStreamProof() {
    setManualEnabled(!isStreamProofActive());
}

function setAutoEnabledForStream(value: boolean) {
    if (value) {
        autoSuppressedForStream = false;
        autoEnabled = settings.store.autoStreamProof;
    } else {
        if (settings.store.disableWhenStreamEnds) autoEnabled = false;
        autoSuppressedForStream = false;
    }

    applyStreamProof();
}

function handleStreamEvent(event: StreamEvent | string, value: boolean) {
    const streamKey = getStreamKey(event);
    if (!isOwnStreamKey(streamKey)) return;

    setAutoEnabledForStream(value);
}

function handleOwnVoiceState(voiceStates: VoiceState[]) {
    const currentUserId = UserStore.getCurrentUser().id;
    if (!voiceStates.some(state => state.userId === currentUserId)) return;

    syncAutoState();
}

function updateActiveStyle() {
    applyStreamProof();
}

function handleMessageClick(message: Message, _channel: Channel, event: MouseEvent) {
    if (!isStreamProofActive() || !settings.store.revealOnClick || event.button !== 0) return;

    if (revealedMessageIds.has(message.id)) revealedMessageIds.delete(message.id);
    else revealedMessageIds.add(message.id);

    event.preventDefault();
    syncStyle();
    emitStateChange();
}

const settings = definePluginSettings({
    autoStreamProof: {
        type: OptionType.BOOLEAN,
        description: "Automatically enable StreamProof when you start sharing your screen.",
        default: true,
        onChange(value: boolean) {
            if (value) syncAutoState();
            else {
                autoEnabled = false;
                autoSuppressedForStream = false;
                applyStreamProof();
            }
        }
    },
    disableWhenStreamEnds: {
        type: OptionType.BOOLEAN,
        description: "Disable automatic StreamProof when screen sharing stops.",
        default: true,
        onChange: syncAutoState
    },
    includeStreamerMode: {
        type: OptionType.BOOLEAN,
        description: "Also enable StreamProof when Streamer Mode hides personal information.",
        default: false,
        onChange: syncAutoState
    },
    showChatBarButton: {
        type: OptionType.BOOLEAN,
        description: "Show the StreamProof button in the chat bar.",
        default: true
    },
    showHeaderBarButton: {
        type: OptionType.BOOLEAN,
        description: "Show the StreamProof button in the top header bar.",
        default: false
    },
    protectionMode: {
        type: OptionType.SELECT,
        description: "How protected content should be hidden.",
        options: [
            { label: "Blur", value: ProtectionMode.Blur, default: true },
            { label: "Dim", value: ProtectionMode.Dim },
            { label: "Blackout", value: ProtectionMode.Blackout }
        ],
        onChange: updateActiveStyle
    },
    blurStrength: {
        type: OptionType.SLIDER,
        description: "Blur strength for protected content.",
        markers: [4, 8, 12, 16, 24],
        default: 16,
        stickToMarkers: false,
        hidden: () => settings.store.protectionMode !== ProtectionMode.Blur,
        onChange: updateActiveStyle
    },
    protectMessages: {
        type: OptionType.BOOLEAN,
        description: "Hide message text.",
        default: true,
        onChange: updateActiveStyle
    },
    protectMedia: {
        type: OptionType.BOOLEAN,
        description: "Hide images, videos, files, embeds and voice messages.",
        default: true,
        onChange: updateActiveStyle
    },
    protectUsernames: {
        type: OptionType.BOOLEAN,
        description: "Hide message usernames and reply previews.",
        default: true,
        onChange: updateActiveStyle
    },
    protectDmList: {
        type: OptionType.BOOLEAN,
        description: "Hide direct messages in the sidebar.",
        default: true,
        onChange: updateActiveStyle
    },
    protectChannelList: {
        type: OptionType.BOOLEAN,
        description: "Hide server channel names in the sidebar.",
        default: false,
        onChange: updateActiveStyle
    },
    revealOnHover: {
        type: OptionType.BOOLEAN,
        description: "Temporarily reveal protected content while hovering it.",
        default: false,
        onChange: updateActiveStyle
    },
    revealOnClick: {
        type: OptionType.BOOLEAN,
        description: "Reveal protected message content when clicking a message.",
        default: false,
        onChange(value: boolean) {
            if (!value) revealedMessageIds.clear();
            updateActiveStyle();
        }
    },
    showToasts: {
        type: OptionType.BOOLEAN,
        description: "Show a toast when StreamProof is toggled manually.",
        default: true
    }
});

const StreamProofIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg
        aria-hidden="true"
        role="img"
        width={width}
        height={height}
        className={className}
        viewBox="0 0 24 24"
    >
        <path fill="currentColor" d="M12 5C5.65 5 1 12 1 12s4.65 7 11 7 11-7 11-7-4.65-7-11-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
    </svg>
);

const StreamProofDisabledIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg
        aria-hidden="true"
        role="img"
        width={width}
        height={height}
        className={className}
        viewBox="0 0 24 24"
    >
        <path fill="currentColor" d="M2.22 2.22a.75.75 0 0 1 1.06 0l18.5 18.5a.75.75 0 1 1-1.06 1.06l-3.43-3.43A11.35 11.35 0 0 1 12 19C5.65 19 1 12 1 12s1.7-2.57 4.43-4.76L2.22 3.28a.75.75 0 0 1 0-1.06Zm4.3 6.08A10.4 10.4 0 0 0 3.08 12 9.57 9.57 0 0 0 12 17c1.47 0 2.85-.34 4.1-.93l-1.7-1.7A3 3 0 0 1 10.64 10.6L6.52 8.3ZM12 5c6.35 0 11 7 11 7a17.3 17.3 0 0 1-3.38 3.78l-1.43-1.43A13.77 13.77 0 0 0 20.92 12 9.57 9.57 0 0 0 12 7c-.76 0-1.49.09-2.18.26L8.18 5.62A11.62 11.62 0 0 1 12 5Z" />
    </svg>
);

const StreamProofButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const { showChatBarButton } = settings.use(CHAT_BUTTON_SETTINGS);
    const sharing = useStateFromStores(
        [ApplicationStreamingStore, VoiceStateStore, StreamerModeStore],
        isProtectionSourceActive
    );
    useStreamProofUpdates();

    if (!isMainChat || !showChatBarButton) return null;

    const active = isStreamProofActive();
    const tooltip = active
        ? "StreamProof is hiding sensitive content. Click to disable."
        : sharing
            ? "StreamProof is off for this screen share. Click to enable."
            : "Enable StreamProof.";

    return (
        <ChatBarButton
            tooltip={tooltip}
            onClick={toggleStreamProof}
            buttonProps={{ "aria-pressed": active }}
        >
            <span style={{ color: active ? "var(--status-danger)" : sharing ? "var(--status-positive)" : "currentColor" }}>
                {active ? <StreamProofDisabledIcon /> : <StreamProofIcon />}
            </span>
        </ChatBarButton>
    );
};

const WrappedStreamProofButton = ErrorBoundary.wrap(StreamProofButton, { noop: true });
const SafeStreamProofButton: ChatBarButtonFactory = props => <WrappedStreamProofButton {...props} />;

const StreamProofHeaderIcon: IconComponent = props => isStreamProofActive()
    ? <StreamProofDisabledIcon {...props} />
    : <StreamProofIcon {...props} />;

function StreamProofHeaderButton() {
    const { showHeaderBarButton } = settings.use(HEADER_BUTTON_SETTINGS);
    const sharing = useStateFromStores(
        [ApplicationStreamingStore, VoiceStateStore, StreamerModeStore],
        isProtectionSourceActive
    );
    useStreamProofUpdates();

    if (!showHeaderBarButton) return null;

    const active = isStreamProofActive();
    const tooltip = active
        ? "Disable StreamProof"
        : sharing
            ? "Enable StreamProof for this screen share"
            : "Enable StreamProof";

    return (
        <HeaderBarButton
            tooltip={tooltip}
            icon={StreamProofHeaderIcon}
            selected={active}
            onClick={toggleStreamProof}
        />
    );
}

const WrappedStreamProofHeaderButton = ErrorBoundary.wrap(StreamProofHeaderButton, { noop: true });
const SafeStreamProofHeaderButton = () => <WrappedStreamProofHeaderButton />;

export default definePlugin({
    name: "StreamProofEnhanched",
    description: "Hides sensitive chat content while screen sharing.",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    dependencies: ["ChatInputButtonAPI", "EquicordToolbox", "HeaderBarAPI", "MessageEventsAPI"],
    tags: ["Privacy", "Voice", "Chat"],
    enabledByDefault: true,
    settings,

    chatBarButton: {
        icon: StreamProofIcon,
        render: SafeStreamProofButton,
    },

    headerBarButton: {
        icon: StreamProofIcon,
        render: SafeStreamProofHeaderButton,
        priority: 1336
    },

    toolboxActions() {
        useStreamProofUpdates();

        return (
            <Menu.MenuCheckboxItem
                id="streamproof-toggle"
                label="Enable StreamProof"
                checked={isStreamProofActive()}
                action={toggleStreamProof}
            />
        );
    },

    onMessageClick: handleMessageClick,

    flux: {
        STREAM_CREATE(event: StreamEvent | string) {
            handleStreamEvent(event, true);
        },
        STREAM_DELETE(event: StreamEvent | string) {
            handleStreamEvent(event, false);
        },
        STREAM_START() {
            syncAutoState();
        },
        STREAM_STOP() {
            syncAutoState();
        },
        STREAMER_MODE_UPDATE() {
            if (settings.store.includeStreamerMode) syncAutoState();
        },
        RTC_CONNECTION_STATE() {
            syncAutoState();
        },
        VOICE_CHANNEL_SELECT() {
            syncAutoState();
        },
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            handleOwnVoiceState(voiceStates);
        }
    },

    start() {
        syncAutoState();
    },

    stop() {
        manualEnabled = false;
        autoEnabled = false;
        autoSuppressedForStream = false;
        revealedMessageIds.clear();
        disableStyle(style);
        emitStateChange();
    }
});
