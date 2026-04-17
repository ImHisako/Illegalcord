import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "ExpandedWidgets",
    description: "Enables setting multiple of the same tags for a game in your profile",
    tags: ["Chat", "Appearance"],
    authors: [
        Devs.sadie
    ],
    patches: [
        {
            find: "BETTER_THAN_YOU]:{",
            replacement: {
                match: /(type:)"radio"/,
                replace: "$1\"checkbox\""
            }
        }
    ]
});