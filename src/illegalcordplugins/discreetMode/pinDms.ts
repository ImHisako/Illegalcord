/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { SettingsStore } from "@api/Settings";
import PinDMs from "@plugins/pinDms";
import { DEFAULT_CHUNK_SIZE } from "@plugins/pinDms/constants";
import { init } from "@plugins/pinDms/data";

const KEYS = ["active", "hideInterface", "manualMode", "enabled"] as const;

export function installPinDmsPrivacy(isInterfaceHidden: () => boolean) {
    const originals = {
        isPinned: PinDMs.isPinned,
        categoryLen: PinDMs.categoryLen,
        getSections: PinDMs.getSections,
        getAllUncollapsedChannels: PinDMs.getAllUncollapsedChannels,
        makeProps: PinDMs.makeProps,
        makeSpanProps: PinDMs.makeSpanProps,
        isCategoryIndex: PinDMs.isCategoryIndex,
        isChannelIndex: PinDMs.isChannelIndex,
        isChannelHidden: PinDMs.isChannelHidden,
        getScrollOffset: PinDMs.getScrollOffset
    };
    PinDMs.isPinned = id => !isInterfaceHidden() && originals.isPinned.call(PinDMs, id);
    PinDMs.categoryLen = () => isInterfaceHidden() ? 0 : originals.categoryLen.call(PinDMs);
    PinDMs.getSections = () => isInterfaceHidden() ? [] : originals.getSections.call(PinDMs);
    PinDMs.getAllUncollapsedChannels = () => isInterfaceHidden() ? [] : originals.getAllUncollapsedChannels.call(PinDMs);
    PinDMs.makeProps = (instance, props) => isInterfaceHidden() ? { ...props, chunkSize: DEFAULT_CHUNK_SIZE } : originals.makeProps.call(PinDMs, instance, props);
    PinDMs.makeSpanProps = () => isInterfaceHidden() ? undefined : originals.makeSpanProps.call(PinDMs);
    PinDMs.isCategoryIndex = section => !isInterfaceHidden() && originals.isCategoryIndex.call(PinDMs, section);
    PinDMs.isChannelIndex = (section, row) => !isInterfaceHidden() && originals.isChannelIndex.call(PinDMs, section, row);
    PinDMs.isChannelHidden = (section, row) => !isInterfaceHidden() && originals.isChannelHidden.call(PinDMs, section, row);
    PinDMs.getScrollOffset = (...args) => isInterfaceHidden() ? args[4] : originals.getScrollOffset.apply(PinDMs, args);

    function refresh() {
        if (isPluginEnabled("PinDMs")) void init();
    }
    for (const key of KEYS) SettingsStore.addChangeListener(`plugins.DiscreetMode.${key}`, refresh);
    refresh();

    return {
        refresh,
        stop() {
            for (const key of KEYS) SettingsStore.removeChangeListener(`plugins.DiscreetMode.${key}`, refresh);
            Object.assign(PinDMs, originals);
            refresh();
        }
    };
}
