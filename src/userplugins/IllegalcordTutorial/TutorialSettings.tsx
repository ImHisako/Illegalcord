/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Flex } from "@components/Flex";
import { React } from "@webpack/common";

import { type Language, UI_COPY } from "./data";
import { getTutorialLanguage, resetTutorialSeen, saveTutorialLanguage } from "./storage";
import { openTutorial } from "./TutorialModal";

export default function TutorialSettings() {
    const [language, setLanguage] = React.useState<Language>("en");
    const copy = UI_COPY[language];

    React.useEffect(() => {
        void getTutorialLanguage().then(setLanguage);
    }, []);

    function changeLanguage(nextLanguage: Language) {
        setLanguage(nextLanguage);
        saveTutorialLanguage(nextLanguage);
    }

    return (
        <Card>
            <Flex alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={10}>
                <Flex flexDirection="column" gap={4}>
                    <BaseText size="sm" weight="semibold">Illegalcord Tutorial</BaseText>
                    <BaseText size="xs" color="text-muted">
                        {copy.settingsDescription}
                    </BaseText>
                </Flex>
                <Flex gap={8} flexWrap="wrap">
                    <Button size="small" variant={language === "en" ? "primary" : "secondary"} onClick={() => changeLanguage("en")}>
                        {copy.english}
                    </Button>
                    <Button size="small" variant={language === "it" ? "primary" : "secondary"} onClick={() => changeLanguage("it")}>
                        {copy.italian}
                    </Button>
                    <Button size="small" variant="secondary" onClick={() => openTutorial()}>
                        {copy.openTutorial}
                    </Button>
                    <Button size="small" variant="secondary" onClick={() => openTutorial(2)}>
                        {copy.openRecommendations}
                    </Button>
                    <Button size="small" variant="secondary" onClick={resetTutorialSeen}>
                        {copy.showNextStartup}
                    </Button>
                </Flex>
            </Flex>
        </Card>
    );
}
