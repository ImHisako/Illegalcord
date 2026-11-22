/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { migratePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { ImageIcon } from "@components/Icons";
import definePlugin from "@utils/types";
import { closeModal, Menu, openModal, UserStore } from "@webpack/common";

import { GalleryModal } from "./components/GalleryModal";
import { StreamPreviewPanelButton } from "./components/PanelButton";
import { captureFrame, FrameSource, PLACEHOLDER_FRAME, VideoFrame } from "./frames";
import { HealthPart, markPatched } from "./health";
import { registerHotkey, unregisterHotkey } from "./hotkey";
import { OLD_PLUGIN_NAMES, T } from "./i18n";
import { getActiveProfile, getProfiles, loadLibrary, unloadLibrary } from "./library";
import {
    ensureCustomThumbnail,
    isOwnStreamEvent,
    onStreamEnded,
    onUploadDone,
    onUploaderStarted,
    onUploaderStopped,
    onUploadFailed,
    onVideoStateChanged,
    pickThumbnail,
    startOnAir,
    stopOnAir,
    streamKeyOf,
    willSendCustom
} from "./onAir";
import { DEFAULT_HOTKEY, PLUGIN_NAME, settings, unwatchSettings, watchSettings } from "./settings";
import managedStyle from "./style.css?managed";
import { forgetAllThumbs, warmThumbs } from "./thumbs";
import { logger } from "./utils";

migratePluginSettings(PLUGIN_NAME, ...OLD_PLUGIN_NAMES);

const GALLERY_MODAL_KEY = "custom-stream-preview-gallery";
let galleryOpen = false;

function openGallery() {
    if (galleryOpen) return;
    galleryOpen = true;
    openModal(props => <GalleryModal rootProps={props} />, {
        modalKey: GALLERY_MODAL_KEY,
        onCloseCallback: () => { galleryOpen = false; }
    });
}

function toggleGallery() {
    if (!galleryOpen) {
        openGallery();
        return;
    }
    closeModal(GALLERY_MODAL_KEY);
    galleryOpen = false;
}

const streamContextMenuPatch: NavContextMenuPatchCallback = (children, { stream }: { stream?: { ownerId: string; }; }) => {
    if (!stream || stream.ownerId !== UserStore.getCurrentUser()?.id) return;

    const item = (
        <Menu.MenuItem
            id="custom-stream-preview"
            label={T.contextMenuItem}
            icon={ImageIcon}
            action={openGallery}
        />
    );

    const group = findGroupChildrenByChildId(["fullscreen", "popout"], children);
    if (group) group.push(item);
    else children.push(<Menu.MenuSeparator />, item);
};

function nextPreviewFrame(source: FrameSource, streamId: string): Promise<VideoFrame> {
    return willSendCustom() ? Promise.resolve(PLACEHOLDER_FRAME) : captureFrame(source, streamId);
}

function marked(part: HealthPart, build: (match: string, ...groups: string[]) => string) {
    return (match: string, ...groups: string[]) => {
        markPatched(part);
        return build(match, ...groups);
    };
}

const PanelButton = ErrorBoundary.wrap(
    (props: { nameplate?: unknown; }) => <StreamPreviewPanelButton nameplate={props?.nameplate} onOpen={openGallery} />,
    { noop: true }
);

export default definePlugin({
    name: PLUGIN_NAME,
    get description() {
        return T.pluginDescription;
    },
    authors: [{ name: "TopQ", id: 523800559791374356n }],
    settings,
    managedStyle,

    patches: [
        {
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            replacement: {
                match: /(children:\[)(.{0,150}?)(accountContainerRef)/,
                replace: marked("panel", (_, open, between, ref) => `${open}$self.PanelButton(arguments[0]),${between}${ref}`)
            }
        },
        {
            find: '"ApplicationStreamPreviewUploadManager"',
            replacement: [
                {
                    match: /(\i)\.getNextVideoOutputFrame\((\i)\)\.then\(/,
                    replace: marked("frame", (_, engine, stream) => `$self.nextPreviewFrame(${engine},${stream}).then(`)
                },
                {
                    match: /if\(!(\i)\)try\{(?=.{0,300}?nextPreviewFrame)/,
                    replace: marked("pauseGate", (_, paused) => `if(!${paused}||$self.willSendCustom())try{`)
                },
                {
                    match: /(\i)\?(\i)\.start\(6e4,(\i)\):\2\.start\(3e5,\3\)/,
                    replace: marked("settle", (_, paused, timer, again) => `($self.onUploadDone(),${paused}&&!$self.willSendCustom())?${timer}.start(6e4,${again}):${timer}.start(3e5,${again})`)
                },
                {
                    match: /subscribe\("STREAM_DELETE",(\i)\)/,
                    replace: marked("streamDelete", (_, stop) => `subscribe("STREAM_DELETE",e=>$self.isOwnStreamEvent(e)&&${stop}())`)
                },
                {
                    match: /(\i)\.toDataURL\("image\/jpeg"\)/,
                    replace: marked("thumbnail", (_, canvas) => `$self.pickThumbnail(()=>${canvas}.toDataURL("image/jpeg"))`)
                },
                {
                    match: /\{thumbnail:(\i)\}/g,
                    replace: marked("upload", (_, thumbnail) => `{thumbnail:$self.ensureCustomThumbnail(${thumbnail})}`)
                },
                {
                    match: /"Failed to post stream preview",(\i)\)/,
                    replace: marked("failure", (match, error) => `${match},$self.onUploadFailed(${error})`)
                }
            ]
        }
    ],

    flux: {
        RTC_CONNECTION_VIDEO(event: { guildId?: string | null; channelId: string; userId: string; streamId?: string | null; context?: string; }) {
            if (event.context !== "stream" || event.streamId == null || event.userId !== UserStore.getCurrentUser()?.id) return;
            onUploaderStarted(streamKeyOf(event.guildId, event.channelId, event.userId));
        },
        STREAM_DELETE(event: { streamKey?: string; }) {
            if (isOwnStreamEvent(event)) onStreamEnded();
        },
        STREAM_STOP(event: { streamKey?: string; }) {
            if (isOwnStreamEvent(event)) onStreamEnded();
        },
        CONNECTION_OPEN: onUploaderStopped,
        LOGOUT: onStreamEnded,
        MEDIA_ENGINE_VIDEO_STATE_CHANGED({ videoState }: { videoState?: string; }) {
            onVideoStateChanged(videoState === "paused");
        }
    },

    contextMenus: {
        "stream-context": streamContextMenuPatch
    },

    toolboxActions() {
        return <Menu.MenuItem id="custom-stream-gallery" label={T.toolboxOpen} action={openGallery} />;
    },

    PanelButton,
    pickThumbnail,
    ensureCustomThumbnail,
    onUploadFailed,
    onUploadDone,
    willSendCustom,
    isOwnStreamEvent,
    nextPreviewFrame,

    async start() {
        registerHotkey(() => settings.store.hotkey || DEFAULT_HOTKEY, toggleGallery);
        watchSettings();

        await loadLibrary();
        await startOnAir();

        const active = getActiveProfile();
        logger.info(`Loaded ${getProfiles().length} profiles, "${active.name}" is active with ${active.images.length} images`);

        const others = getProfiles().filter(profile => profile.id !== active.id);
        void warmThumbs([...active.images, ...others.flatMap(profile => profile.images)]);
    },

    stop() {
        unregisterHotkey();
        unwatchSettings();
        stopOnAir();
        unloadLibrary();
        forgetAllThumbs();
        closeModal(GALLERY_MODAL_KEY);
        galleryOpen = false;
    }
});
