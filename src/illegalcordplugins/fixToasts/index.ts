/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EquicordDevs } from "@utils/constants";
import { isObject } from "@utils/misc";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "FixToasts",
    description: "Prevents crashes when plugins display toast notifications.",
    authors: [EquicordDevs.irritably],
    enabledByDefault: true,
    required: true,

    patches: [{
        find: 'variant:"default",icon:',
        replacement: {
            match: /function (\i)\((\i),\i\)\{(?=let \i=arguments\.length>2)/,
            replace: '$&if($self.isObject($2)&&"message"in $2)return $1($2.message,$2.type,$2.options);'
        }
    }],

    isObject
});
