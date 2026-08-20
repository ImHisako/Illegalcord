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

import { UserStore } from "@webpack/common";

import { PluginInfo } from "../../betterScreenshare.desktop/constants";
import { logger } from "../../betterScreenshare.desktop/logger";
import { screenshareAudioStore } from "../../betterScreenshare.desktop/stores/screenshareAudioStore";
import { Emitter, MediaEngineStore, patchConnectionAudioTransportOptions, Patcher, types } from "../../philsPluginLibrary";

export class ScreenshareAudioPatcher extends Patcher {
    private mediaEngineStore: types.MediaEngineStore;
    private mediaEngine: types.MediaEngine;
    public connection?: types.Connection;

    public oldSetTransportOptions: (...args: any[]) => void;
    public oldSetVoiceBitRate: types.Connection["setVoiceBitRate"];
    public forceUpdateTransportationOptions: () => void;

    constructor() {
        super();
        this.mediaEngineStore = MediaEngineStore;
        this.mediaEngine = this.mediaEngineStore.getMediaEngine();

        this.forceUpdateTransportationOptions = () => void 0;
        this.oldSetTransportOptions = () => void 0;
        this.oldSetVoiceBitRate = () => void 0;
    }

    public patch(): this {
        this.unpatch();

        const { get } = screenshareAudioStore;

        const connectionEventFunction =
            (connection: types.Connection) => {
                if (connection.context !== "stream" || connection.streamUserId !== UserStore.getCurrentUser().id) return;
                if (this.connection === connection) return;

                this.connection = connection;

                const {
                    forceUpdateTransportationOptions: forceUpdateTransportationOptionsAudio,
                    oldSetTransportOptions: oldSetTransportOptionsAudio,
                    oldSetVoiceBitRate
                } = patchConnectionAudioTransportOptions(connection, get, logger);

                this.forceUpdateTransportationOptions = forceUpdateTransportationOptionsAudio;
                this.oldSetTransportOptions = oldSetTransportOptionsAudio;
                this.oldSetVoiceBitRate = oldSetVoiceBitRate;

                const restoreConnection = () => {
                    connection.conn.setTransportOptions = oldSetTransportOptionsAudio;
                    connection.setVoiceBitRate = oldSetVoiceBitRate;
                };
                let didCleanupConnection = false;
                let removeConnectedListener: () => void = () => void 0;
                let removeDestroyListener: () => void = () => void 0;
                const cleanupConnection = () => {
                    if (didCleanupConnection) return;
                    didCleanupConnection = true;
                    restoreConnection();
                    removeConnectedListener();
                    removeDestroyListener();
                    this.unpatchFunctions = this.unpatchFunctions.filter(fn => fn !== cleanupConnection);
                };
                this.unpatchFunctions.push(cleanupConnection);

                removeConnectedListener = Emitter.addListener(connection.emitter, "on", "connected", () => {
                    this.forceUpdateTransportationOptions();
                }, PluginInfo.PLUGIN_NAME);

                removeDestroyListener = Emitter.addListener(connection.emitter, "on", "destroy", () => {
                    cleanupConnection();
                    if (this.connection === connection)
                        this.connection = undefined;

                    this.forceUpdateTransportationOptions = () => void 0;
                    this.oldSetTransportOptions = () => void 0;
                    this.oldSetVoiceBitRate = () => void 0;
                }, PluginInfo.PLUGIN_NAME);
            };

        this.unpatchFunctions.push(Emitter.addListener(
            this.mediaEngine.emitter,
            "on",
            "connection",
            connectionEventFunction,
            PluginInfo.PLUGIN_NAME
        ));

        return this;
    }

    public unpatch(): this {
        this._unpatch();
        this.connection = undefined;
        this.forceUpdateTransportationOptions = () => void 0;
        this.oldSetTransportOptions = () => void 0;
        this.oldSetVoiceBitRate = () => void 0;

        return this;
    }
}
