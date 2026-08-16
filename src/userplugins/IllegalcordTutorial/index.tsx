/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";

import { hasSeenTutorial, resetTutorialSeen } from "./storage";
import { closeTutorial, openTutorial } from "./TutorialModal";
import TutorialSettings from "./TutorialSettings";

let tutorialTimeout: number | undefined;

const settings = definePluginSettings({
    hideFromToolbox: {
        type: OptionType.BOOLEAN,
        description: "Hide this plugin from Equicord Toolbox.",
        default: true
    }
});

const SafeTutorialSettings = ErrorBoundary.wrap(TutorialSettings, { noop: true });

async function openFirstRunTutorial() {
    if (await hasSeenTutorial()) return;

    openTutorial();
}

export default definePlugin({
    name: "IllegalcordTutorial",
    description: "Shows a first-run guided tutorial for Illegalcord features.",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    required: true,
    enabledByDefault: true,
    settings,
    settingsAboutComponent: SafeTutorialSettings,
    get toolboxActions(): Record<string, () => void> {
        if (settings.store.hideFromToolbox) return {};

        return {
            "Open Illegalcord tutorial": openTutorial,
            "Show Illegalcord tutorial next startup": resetTutorialSeen
        };
    },

    start() {
        tutorialTimeout = window.setTimeout(() => {
            void openFirstRunTutorial().catch(() => undefined);
        }, 1500);
    },

    stop() {
        if (tutorialTimeout !== undefined) {
            clearTimeout(tutorialTimeout);
            tutorialTimeout = undefined;
        }

        closeTutorial();
    }
});
