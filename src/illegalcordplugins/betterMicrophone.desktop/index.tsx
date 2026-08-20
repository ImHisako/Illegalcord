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

import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, type UserAreaRenderProps } from "@api/UserArea";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

import { PluginInfo } from "../betterMicrophone.desktop/constants";
import { openMicrophoneSettingsModal } from "../betterMicrophone.desktop/modals";
import { MicrophonePatcher } from "../betterMicrophone.desktop/patchers";
import { initMicrophoneStore } from "../betterMicrophone.desktop/stores";
import { Emitter, MicrophoneSettingsIcon } from "../philsPluginLibrary";

const SETTINGS_KEYS: Array<"hideSettingsIcon"> = ["hideSettingsIcon"];

function micSettingsButton({ hideTooltips, iconForeground, nameplate }: UserAreaRenderProps) {
    const { hideSettingsIcon } = settings.use(SETTINGS_KEYS);
    if (hideSettingsIcon) return null;

    return (
        <UserAreaButton
            tooltipText={hideTooltips ? void 0 : "Change microphone settings"}
            icon={<MicrophoneSettingsIcon className={iconForeground} />}
            plated={nameplate != null}
            role="button"
            onClick={openMicrophoneSettingsModal}
        />
    );
}

const settings = definePluginSettings({
    hideSettingsIcon: {
        type: OptionType.BOOLEAN,
        description: "Hide the settings icon.",
        default: true,
    }
});

export default definePlugin({
    name: "BetterMicrophone",
    description: "This plugin allows you to further customize your microphone.",
    tags: ["Voice", "Customisation"],
    authors: [Devs.phil],
    dependencies: ["PhilsPluginLibrary", "UserAreaAPI"],
    settings: settings,
    userAreaButton: {
        icon: MicrophoneSettingsIcon,
        render: micSettingsButton
    },
    start(): void {
        initMicrophoneStore();

        this.microphonePatcher = new MicrophonePatcher().patch();
    },
    stop(): void {
        this.microphonePatcher?.unpatch();

        Emitter.removeAllListeners(PluginInfo.PLUGIN_NAME);
    },
    toolboxActions: {
        "Open Microphone Settings": openMicrophoneSettingsModal
    }
});
