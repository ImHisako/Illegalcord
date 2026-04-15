import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";
import { VersionDisplay } from "./components/VersionDisplay";

export const settings = definePluginSettings({
    versionInfo: {
        type: OptionType.COMPONENT,
        description: "",
        component: VersionDisplay
    },
    channelDelay: {
        type: OptionType.SLIDER,
        description: "Base delay between API requests (ms) - actual delay varies randomly",
        default: 800,
        markers: [500, 800, 1000, 1500, 2000],
        stickToMarkers: false
    }
});
