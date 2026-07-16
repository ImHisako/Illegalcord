import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";
import { VersionDisplay } from "./components/VersionDisplay";

export const settings = definePluginSettings({
    versionInfo: {
        type: OptionType.COMPONENT,
        description: "",
        component: VersionDisplay
    }
});