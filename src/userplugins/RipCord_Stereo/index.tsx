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
    }
});

const VoiceModule = findByPropsLazy("updateVideoQuality");
const VoiceSettingsStore = findByPropsLazy("getEchoCancellation");

export default definePlugin({
    name: "RipCordStereoFixed",
    authors: [{ name: "Hahac", id: 1140323729432399882n }],
    description: "Enhanced stereo sound with configurable settings",
    settings,

    patches: [
        {
            find: "updateVideoQuality",
            replacement: {
                match: /updateVideoQuality\(\i\){/,
                replace: "$&$self.enhanceAudio(this);"
            }
        }
    ],

    enhanceAudio(thisObj: any) {
        try {
            this.checkSettings();
            if (!thisObj.conn?.setTransportOptions) return;

            const original = thisObj.conn.setTransportOptions;
            thisObj.conn.setTransportOptions = function(obj: any) {
                if (obj.audioEncoder) {
                    obj.audioEncoder.params = { stereo: settings.store.stereoLevel.toString() };
                    obj.audioEncoder.channels = parseFloat(settings.store.stereoLevel.toString());
                }
                if (obj.fec) obj.fec = false;
                const targetBitrate = settings.store.bitrate * 1000;
                if (obj.encodingVoiceBitRate < targetBitrate) {
                    obj.encodingVoiceBitRate = targetBitrate;
                }
                return original.call(this, obj);
            };

            if (!this.checkSettings() && settings.store.enableToasts) {
                showNotification({
                    title: "RipCordStereoFixed",
                    body: `Stereo enhanced!`,
                    color: "var(--green-360)"
                });
            }
        } catch (err) {
            console.error("[RipCordStereoFixed] Error:", err);
        }
    },

    checkSettings() {
        try {
            if (!VoiceSettingsStore) return false;
            const hasIssues = 
                VoiceSettingsStore.getNoiseSuppression?.() ||
                VoiceSettingsStore.getNoiseCancellation?.() ||
                VoiceSettingsStore.getEchoCancellation?.();
            
            if (hasIssues && settings.store.enableToasts) {
                showNotification({
                    title: "RipCordStereoFixed Warning",
                    body: "Disable echo cancellation and noise suppression in Discord settings!",
                    color: "var(--yellow-360)"
                });
            }
            return hasIssues;
        } catch (err) {
            return false;
        }
    },

    start() {
        if (settings.store.enableToasts) {
            showNotification({
                title: "RipCordStereoFixed",
                body: "Plugin activated!",
                color: "var(--brand-500)"
            });
        }
    },

    stop() {}
});