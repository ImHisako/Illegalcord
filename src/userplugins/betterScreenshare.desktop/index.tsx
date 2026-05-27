/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { findGroupChildrenByChildId, type NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { MainSettingsIcon } from "@components/Icons";
import { Devs } from "@utils/constants";
import { getIntlMessage } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { ChannelRTCStore, Menu, showToast, Toasts, UserStore } from "@webpack/common";

import { PluginInfo } from "../betterScreenshare.desktop/constants";
import { openScreenshareModal } from "../betterScreenshare.desktop/modals";
import { ScreenshareAudioPatcher, ScreensharePatcher } from "../betterScreenshare.desktop/patchers";
import { GoLivePanelWrapper, replacedSubmitFunction } from "../betterScreenshare.desktop/patches";
import { initScreenshareAudioStore, initScreenshareStore, screenshareStore } from "../betterScreenshare.desktop/stores";
import { Emitter, ScreenshareSettingsIcon } from "../philsPluginLibrary";

const Button = findComponentByCodeLazy(".NONE,disabled:", ".PANEL_BUTTON");

interface StreamVideoQualityOptions {
    width?: number;
    height?: number;
    framerate?: number;
    pixelCount?: number;
}

interface StreamQualityOptions {
    bitrateMin?: number;
    bitrateMax?: number;
    bitrateTarget?: number;
    resolution?: number;
    frameRate?: number;
    framerate?: number;
    capture?: StreamVideoQualityOptions;
    encode?: StreamVideoQualityOptions;
}

interface StreamSubmitOptions extends StreamQualityOptions {
    quality?: unknown;
}

interface StreamFramerateOption {
    id: string;
    value: number;
    label: string;
}

interface StreamContextProps {
    stream: {
        ownerId: string;
    };
}

interface QuickQualityPreset {
    label: string;
    width: number;
    height: number;
    framerate: number;
    videoBitrate: number;
}

const quickQualityPresets = [
    { label: "Balanced 720p60", width: 1280, height: 720, framerate: 60, videoBitrate: 2500 },
    { label: "Sharp 1080p60", width: 1920, height: 1080, framerate: 75, videoBitrate: 5000 },
    { label: "High 1440p60", width: 2560, height: 1440, framerate: 144, videoBitrate: 10000 },
] satisfies QuickQualityPreset[];

const quickResolutions = [
    { label: "480p", width: 720, height: 480 },
    { label: "720p", width: 1280, height: 720 },
    { label: "1080p", width: 1920, height: 1080 },
    { label: "1440p", width: 2560, height: 1440 },
    { label: "2160p", width: 3840, height: 2160 },
] as const;

const quickFramerates = [15, 30, 60, 120, 144, 165, 240] as const;
const quickBitrates = [2500, 5000, 7500, 10000] as const;

function isStreamQualityOptions(opts: unknown): opts is StreamQualityOptions {
    return typeof opts === "object" && opts !== null && !Array.isArray(opts);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function screenshareSettingsButton() {

    return (
        <Button
            tooltipText="Change screenshare settings"
            icon={ScreenshareSettingsIcon}
            role="button"
            onClick={openScreenshareModal}
        />
    );
}

function refreshActiveScreenshareOptions() {
    const plugin = BetterScreenshare;
    const { screensharePatcher, screenshareAudioPatcher } = plugin;

    if (screensharePatcher) {
        screensharePatcher.forceUpdateTransportationOptions();
        if (screensharePatcher.hasActiveDesktopSource()) {
            screensharePatcher.forceUpdateDesktopEncodingOptions();
            screensharePatcher.forceUpdateDesktopSourceOptions();
        }
    }

    if (screenshareAudioPatcher)
        screenshareAudioPatcher.forceUpdateTransportationOptions();
}

function notifyQuickSettingsChange(label: string) {
    refreshActiveScreenshareOptions();
    showToast(`BetterScreenshare: ${label} applied.`, Toasts.Type.SUCCESS);
}

function applyQualityPreset(preset: QuickQualityPreset) {
    const store = screenshareStore.get();

    store.setWidth(preset.width);
    store.setHeight(preset.height);
    store.setResolutionEnabled(true);
    store.setFramerate(preset.framerate);
    store.setFramerateEnabled(true);
    store.setVideoBitrate(preset.videoBitrate);
    store.setVideoBitrateEnabled(true);
    notifyQuickSettingsChange(preset.label);
}

function applyResolution(width?: number, height?: number) {
    const store = screenshareStore.get();

    store.setWidth(width);
    store.setHeight(height);
    store.setResolutionEnabled(width !== undefined && height !== undefined);
    notifyQuickSettingsChange(width && height ? `${height}p` : "Default resolution");
}

function applyFramerate(framerate?: number) {
    const store = screenshareStore.get();

    store.setFramerate(framerate);
    store.setFramerateEnabled(framerate !== undefined);
    notifyQuickSettingsChange(framerate ? `${framerate} FPS` : "Default framerate");
}

function applyVideoBitrate(videoBitrate?: number) {
    const store = screenshareStore.get();

    store.setVideoBitrate(videoBitrate);
    store.setVideoBitrateEnabled(videoBitrate !== undefined);
    notifyQuickSettingsChange(videoBitrate ? `${videoBitrate} kbps` : "Default bitrate");
}

const streamContextPatch: NavContextMenuPatchCallback = (children, props: StreamContextProps) => {
    const user = UserStore.getCurrentUser();
    if (!user || props.stream.ownerId !== user.id) return;

    const { currentProfile } = screenshareStore.get();
    const menuItem = (
        <Menu.MenuItem
            id="better-screenshare-settings"
            label="BetterScreenshare"
            icon={MainSettingsIcon}
        >
            <Menu.MenuItem id="better-screenshare-quality" label="Quality Preset">
                {quickQualityPresets.map(preset => (
                    <Menu.MenuRadioItem
                        key={preset.label}
                        id={`better-screenshare-quality-${preset.height}-${preset.framerate}`}
                        group="better-screenshare-quality"
                        label={preset.label}
                        checked={
                            currentProfile.resolutionEnabled === true &&
                            currentProfile.framerateEnabled === true &&
                            currentProfile.videoBitrateEnabled === true &&
                            currentProfile.width === preset.width &&
                            currentProfile.height === preset.height &&
                            currentProfile.framerate === preset.framerate &&
                            currentProfile.videoBitrate === preset.videoBitrate
                        }
                        action={() => applyQualityPreset(preset)}
                    />
                ))}
            </Menu.MenuItem>
            <Menu.MenuItem id="better-screenshare-resolution" label="Resolution">
                <Menu.MenuRadioItem
                    id="better-screenshare-resolution-default"
                    group="better-screenshare-resolution"
                    label="Discord default"
                    checked={currentProfile.resolutionEnabled !== true}
                    action={() => applyResolution()}
                />
                {quickResolutions.map(({ label, width, height }) => (
                    <Menu.MenuRadioItem
                        key={label}
                        id={`better-screenshare-resolution-${height}`}
                        group="better-screenshare-resolution"
                        label={label}
                        checked={currentProfile.resolutionEnabled === true && currentProfile.width === width && currentProfile.height === height}
                        action={() => applyResolution(width, height)}
                    />
                ))}
            </Menu.MenuItem>
            <Menu.MenuItem id="better-screenshare-framerate" label="Framerate">
                <Menu.MenuRadioItem
                    id="better-screenshare-framerate-default"
                    group="better-screenshare-framerate"
                    label="Discord default"
                    checked={currentProfile.framerateEnabled !== true}
                    action={() => applyFramerate()}
                />
                {quickFramerates.map(framerate => (
                    <Menu.MenuRadioItem
                        key={framerate}
                        id={`better-screenshare-framerate-${framerate}`}
                        group="better-screenshare-framerate"
                        label={`${framerate} FPS`}
                        checked={currentProfile.framerateEnabled === true && currentProfile.framerate === framerate}
                        action={() => applyFramerate(framerate)}
                    />
                ))}
            </Menu.MenuItem>
            <Menu.MenuItem id="better-screenshare-bitrate" label="Video Bitrate">
                <Menu.MenuRadioItem
                    id="better-screenshare-bitrate-default"
                    group="better-screenshare-bitrate"
                    label="Discord default"
                    checked={currentProfile.videoBitrateEnabled !== true}
                    action={() => applyVideoBitrate()}
                />
                {quickBitrates.map(videoBitrate => (
                    <Menu.MenuRadioItem
                        key={videoBitrate}
                        id={`better-screenshare-bitrate-${videoBitrate}`}
                        group="better-screenshare-bitrate"
                        label={`${videoBitrate} kbps`}
                        checked={currentProfile.videoBitrateEnabled === true && currentProfile.videoBitrate === videoBitrate}
                        action={() => applyVideoBitrate(videoBitrate)}
                    />
                ))}
            </Menu.MenuItem>
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="better-screenshare-advanced-settings"
                label="Advanced Settings"
                action={openScreenshareModal}
            />
        </Menu.MenuItem>
    );

    const group = findGroupChildrenByChildId(["fullscreen", "popout"], children);
    if (group) {
        group.push(menuItem);
        return;
    }

    children.push(<Menu.MenuSeparator />, <Menu.MenuGroup>{menuItem}</Menu.MenuGroup>);
};

function patchStreamQuality(opts: StreamQualityOptions) {
    if (!screenshareStore) return opts;

    const { currentProfile } = screenshareStore.get();
    const {
        framerate,
        framerateEnabled,
        height,
        resolutionEnabled,
        videoBitrate,
        videoBitrateEnabled,
        width
    } = currentProfile;
    const next = { ...opts };
    let capture = opts.capture ? { ...opts.capture } : undefined;
    let encode = opts.encode ? { ...opts.encode } : undefined;

    if (videoBitrateEnabled && videoBitrate) {
        const bitrate = Math.round(videoBitrate * 1000);

        next.bitrateMin = bitrate;
        next.bitrateMax = bitrate;
        next.bitrateTarget = bitrate;
    }

    if (resolutionEnabled && width && height) {
        const pixelCount = width * height;

        next.resolution = height;
        capture = { ...capture, width, height, pixelCount };
        encode = { ...encode, width, height, pixelCount };
    }

    if (framerateEnabled && framerate) {
        next.frameRate = framerate;
        next.framerate = framerate;
        capture = { ...capture, framerate };
        encode = { ...encode, framerate };
    }

    if (capture) next.capture = capture;
    if (encode) next.encode = encode;

    return next;
}

function patchStreamSubmitOptions(opts: unknown) {
    if (!isStreamQualityOptions(opts)) return opts;

    const submitOptions = opts as StreamSubmitOptions;
    if (isStreamQualityOptions(submitOptions.quality))
        return { ...submitOptions, quality: patchStreamQuality(submitOptions.quality) };

    return patchStreamQuality(opts);
}

function patchGoLiveSource(source: unknown) {
    return patchStreamSubmitOptions(source);
}

function patchStreamFramerates(framerates: StreamFramerateOption[]) {
    if (!screenshareStore) return framerates;

    const { framerate, framerateEnabled } = screenshareStore.get().currentProfile;
    if (!framerateEnabled || !framerate) return framerates;

    const next = framerates.filter(option => option.value !== framerate);
    next.push({
        id: `${framerate}fps`,
        value: framerate,
        label: getIntlMessage("SCREENSHARE_FPS_ABBREVIATED", {
            fps: framerate
        })
    });

    return next.sort((a, b) => a.value - b.value);
}

function patchDisplayedStreamParticipant<T>(participant: T): T {
    if (!isRecord(participant) || !screenshareStore) return participant;

    const { stream } = participant;
    if (!isRecord(stream) || stream.ownerId !== UserStore.getCurrentUser().id) return participant;

    const { currentProfile } = screenshareStore.get();
    const {
        framerate,
        framerateEnabled,
        height,
        resolutionEnabled,
        width
    } = currentProfile;
    let next: Record<string, unknown> | undefined;

    if (framerateEnabled && framerate)
        next = { ...participant, maxFrameRate: framerate };

    if (resolutionEnabled && width && height)
        next = { ...(next ?? participant), maxResolution: { width, height } };

    return (next ?? participant) as T;
}

function patchDisplayedStreamParticipants<T>(participants: T[]): T[] {
    let changed = false;
    const next = participants.map(participant => {
        const patchedParticipant = patchDisplayedStreamParticipant(participant);
        changed ||= patchedParticipant !== participant;

        return patchedParticipant;
    });

    return changed ? next : participants;
}

function patchChannelRTCStore() {
    const oldGetFilteredParticipants = ChannelRTCStore.getFilteredParticipants;
    const oldGetParticipant = ChannelRTCStore.getParticipant;
    const oldGetParticipants = ChannelRTCStore.getParticipants;

    ChannelRTCStore.getFilteredParticipants = function (...args: Parameters<typeof oldGetFilteredParticipants>) {
        return patchDisplayedStreamParticipants(Reflect.apply(oldGetFilteredParticipants, this, args));
    };

    ChannelRTCStore.getParticipant = function (...args: Parameters<typeof oldGetParticipant>) {
        return patchDisplayedStreamParticipant(Reflect.apply(oldGetParticipant, this, args));
    };

    ChannelRTCStore.getParticipants = function (...args: Parameters<typeof oldGetParticipants>) {
        return patchDisplayedStreamParticipants(Reflect.apply(oldGetParticipants, this, args));
    };

    return () => {
        ChannelRTCStore.getFilteredParticipants = oldGetFilteredParticipants;
        ChannelRTCStore.getParticipant = oldGetParticipant;
        ChannelRTCStore.getParticipants = oldGetParticipants;
    };
}

const BetterScreenshare = definePlugin({
    name: "BetterScreenshare",
    description: "This plugin allows you to further customize your screen sharing.",
    tags: ["Voice", "Customisation"],
    authors: [Devs.phil],
    dependencies: ["PhilsPluginLibrary"],
    patches: [
        {
            find: "GoLiveModal: user cannot be undefined", // Module: 60594; canaryRelease: 364525; L431
            replacement: {
                match: /onSubmit:(\w+)/,
                replace: "onSubmit:$self.replacedSubmitFunction($1)"
            }
        },
        {
            find: "StreamSettings: user cannot be undefined", // Module: 641115; canaryRelease: 364525; L254
            replacement: {
                match: /\(.{0,10}(,{.{0,100}modalContent)/,
                replace: "($self.GoLivePanelWrapper$1"
            }
        },
        {
            find: ".StreamPreviewIntro", // Stream settings modal
            replacement: {
                match: /className:\i\.buttons,.{0,100}children:\[/,
                replace: "$&$self.screenshareSettingsButton(),"
            }
        },
        {
            find: "#{intl::STREAM_FPS_OPTION}",
            all: true,
            replacement: [
                {
                    match: /guildPremiumTier:\i\.\i\.TIER_\d,?/g,
                    replace: ""
                },
                {
                    match: /\[\{.{0,25}\i\.\i\.FPS_15.{0,900}\}\]/,
                    replace: "$self.patchStreamFramerates($&)"
                }
            ]
        },
        {
            find: "this.getDefaultGoliveQuality()",
            replacement: [
                {
                    match: /(this\.goliveMaxQuality)=(this\.getDefaultGoliveQuality\(\))/,
                    replace: "$1=$self.patchStreamQuality($2)"
                },
                {
                    match: /setGoliveQuality\((\i)\)\{/,
                    replace: "setGoliveQuality($1){$1=$self.patchStreamQuality($1);"
                }
            ]
        },
        {
            find: "setVideoBroadcast(this.shouldConnectionBroadcastVideo",
            replacement: {
                match: /setGoLiveSource\((\i),(\i)\)\{/,
                replace: "setGoLiveSource($1,$2){$1=$self.patchGoLiveSource($1);$2=$self.patchGoLiveSource($2);"
            }
        }
    ],
    settings: definePluginSettings({
        hideDefaultSettings: {
            type: OptionType.BOOLEAN,
            description: "Hide Discord screen sharing settings.",
            default: true,
        }
    }),
    contextMenus: {
        "stream-context": streamContextPatch
    },
    start(): void {
        initScreenshareStore();
        initScreenshareAudioStore();
        this.unpatchChannelRTCStore?.();
        this.unpatchChannelRTCStore = patchChannelRTCStore();
        this.screensharePatcher = new ScreensharePatcher().patch();
        this.screenshareAudioPatcher = new ScreenshareAudioPatcher().patch();

    },
    stop(): void {
        this.unpatchChannelRTCStore?.();
        this.unpatchChannelRTCStore = undefined;
        this.screenshareAudioPatcher?.unpatch();
        this.screensharePatcher?.unpatch();
        Emitter.removeAllListeners(PluginInfo.PLUGIN_NAME);
    },
    toolboxActions: {
        "Open Screenshare Settings": openScreenshareModal
    },
    replacedSubmitFunction,
    GoLivePanelWrapper,
    patchGoLiveSource,
    patchStreamFramerates,
    patchStreamQuality,
    patchStreamSubmitOptions,
    screenshareSettingsButton
});

export default BetterScreenshare;
