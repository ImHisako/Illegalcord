/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { EquicordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import definePlugin from "@utils/types";

const cl = classNameFactory("vc-plugins-");

function NightcordTestcordIcon() {
    return (
        <svg aria-label="Nightcord and Testcord" className={cl("source")} role="img" viewBox="0 0 100 100">
            <defs>
                <clipPath id="vc-nightcord-port-nightcord">
                    <path d="M0 0H100L0 100Z" />
                </clipPath>
                <clipPath id="vc-nightcord-port-testcord">
                    <path d="M100 0V100H0Z" />
                </clipPath>
            </defs>
            <image clipPath="url(#vc-nightcord-port-nightcord)" height="100" href="https://nightcord.st/image.png" width="100" />
            <image clipPath="url(#vc-nightcord-port-testcord)" height="100" href="https://raw.githubusercontent.com/TestcordDev/TestCord/main/browser/icon.png" width="100" />
        </svg>
    );
}

const SafeNightcordTestcordIcon = ErrorBoundary.wrap(NightcordTestcordIcon, { noop: true });

export default definePlugin({
    name: "NightcordPort",
    description: "Marks Illegalcord plugins ported from Nightcord and Testcord.",
    authors: [EquicordDevs.irritably],
    required: true,
    enabledByDefault: true,

    isNightcordPlugin(name: string) {
        return name === "LarpCord" || name === "StreamProofEnhanched";
    },

    getPluginSource(name: string) {
        return name === "LarpCord"
            ? { badge: <SafeNightcordTestcordIcon />, tooltip: "Nightcord / Testcord Plugin" }
            : null;
    }
});
