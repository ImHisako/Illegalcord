/*
 * IllegalCord RipCord Stereo Plugin
 * Ported from BetterDiscord RipCordStereo plugin
 * Copyright (c) 2026 Hisako
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
import { showNotification } from "@api/Notifications";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";

const settings = definePluginSettings({
    enableToasts: {
        description: "Enable Toasts",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: false
    },
    stereoLevel: {
        description: "Stereo Level (2.0 = Full Stereo)",
        type: OptionType.SLIDER,
        markers: [1.0, 1.5, 2.0, 2.5, 3.0],
        default: 2.0,
        stickToMarkers: true
    },
    bitrate: {
        description: "Voice Bitrate (kbps)",
        type: OptionType.SLIDER,
        markers: [32, 64, 128, 256, 300],
        default: 300,
        stickToMarkers: true
    },
    enablePrioritySpeaker: {
        description: "Enable Priority Speaker",
        type: OptionType.BOOLEAN,
        default: true,
        restartNeeded: false
    }
});

const VoiceModule = findByPropsLazy("updateVideoQuality");
const VoiceSettingsStore = findByPropsLazy("getEchoCancellation");

export default definePlugin({
    name: "RipCord_Stereo",
    authors: [{ name: "Hahac", id: 1140323729432399882n }],
    description: "Enhanced stereo sound with configurable settings for premium audio quality",
    settings,

    patches: [
        {
            find: "updateVideoQuality",
            replacement: {
                match: /updateVideoQuality\(\i\){/,
                replace: "$&$self.enhanceAudioQuality(this);"
            }
        }
    ],

    enhanceAudioQuality(thisObj: any) {
        try {
            // Check voice settings warnings
            this.checkVoiceSettings();

            if (!thisObj.conn?.setTransportOptions) return;

            const originalSetTransportOptions = thisObj.conn.setTransportOptions;
            
            thisObj.conn.setTransportOptions = function(obj: any) {
                if (obj.audioEncoder) {
                    // Enhanced stereo configuration
                    obj.audioEncoder.params = {
                        stereo: settings.store.stereoLevel.toString()
                    };
                    obj.audioEncoder.channels = parseFloat(settings.store.stereoLevel.toString());
                }
                
                // Disable error correction for cleaner audio
                if (obj.fec) {
                    obj.fec = false;
                }
                
                // Set high-quality bitrate
                const targetBitrate = settings.store.bitrate * 1000; // Convert kbps to bps
                if (obj.encodingVoiceBitRate < targetBitrate) {
                    obj.encodingVoiceBitRate = targetBitrate;
                }
                
                // Advanced priority speaker handling
                if (settings.store.enablePrioritySpeaker && obj.prioritySpeaker) {
                    obj.prioritySpeaker = true;
                    if (obj.prioritySpeakerDucking) {
                        obj.prioritySpeakerDucking = 10e9; // Maximum ducking
                    }
                }
                
                return originalSetTransportOptions.call(this, obj);
            };
            
            // Show success notification
            if (!this.checkVoiceSettings() && settings.store.enableToasts) {
                showNotification({
                    title: "RipCord_Stereo",
                    body: `Stereo enhanced with ${settings.store.stereoLevel} channels at ${settings.store.bitrate}kbps!`,
                    color: "var(--green-360)"
                });
            }
        } catch (err) {
            console.error("[RipCord_Stereo] Error enhancing audio:", err);
        }
    },

    checkVoiceSettings() {
        try {
            if (!VoiceSettingsStore) return false;
            
            const hasIssues = 
                VoiceSettingsStore.getNoiseSuppression?.() ||
                VoiceSettingsStore.getNoiseCancellation?.() ||
                VoiceSettingsStore.getEchoCancellation?.();
            
            if (hasIssues && settings.store.enableToasts) {
                showNotification({
                    title: "RipCord_Stereo Warning",
                    body: "Disable echo cancellation, noise reduction, and noise suppression in Discord voice settings for optimal stereo quality!",
                    color: "var(--yellow-360)"
                });
            }
            
            return hasIssues;
        } catch (err) {
            console.error("[RipCord_Stereo] Error checking voice settings:", err);
            return false;
        }
    },

    start() {
        // Plugin started
        if (settings.store.enableToasts) {
            showNotification({
                title: "RipCord_Stereo",
                body: "Plugin activated! Premium stereo sound ready.",
                color: "var(--brand-500)"
            });
        }
    },

    stop() {
        // Cleanup if needed
    }
});
