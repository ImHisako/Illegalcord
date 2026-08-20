/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled, plugins } from "@api/PluginManager";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { Heading } from "@components/Heading";
import { classNameFactory } from "@utils/css";
import type { RenderModalProps } from "@vencord/discord-types";
import { Checkbox, closeModal, Modal, openModal, React } from "@webpack/common";

import { type Language, RECOMMENDED_PLUGIN_COPY, RECOMMENDED_PLUGIN_NAMES, type RecommendedPluginName, TUTORIAL_STEPS, UI_COPY } from "./data";
import { enableSelectedRecommendations, getAvailableRecommendations, getClearedRecommendations, getInitialRecommendations, openRecommendedPluginSettings, openSettingsPanel } from "./pluginActions";
import { getTutorialLanguage, markTutorialSeen, saveTutorialLanguage } from "./storage";

const cl = classNameFactory("vc-illegalcord-tutorial-");

interface TutorialModalProps {
    modalProps: RenderModalProps;
    initialStep?: number;
}

type RecommendationState = Record<RecommendedPluginName, boolean>;

let activeModalKey: string | undefined;

function normalizeStepIndex(stepIndex: unknown) {
    const maxStepIndex = TUTORIAL_STEPS.length - 1;
    const index = typeof stepIndex === "number" && Number.isFinite(stepIndex)
        ? Math.trunc(stepIndex)
        : 0;

    return Math.min(Math.max(index, 0), maxStepIndex);
}

function LanguageSwitch({ language, setLanguage }: { language: Language; setLanguage(language: Language): void; }) {
    const copy = UI_COPY[language];

    function selectLanguage(nextLanguage: Language) {
        setLanguage(nextLanguage);
        saveTutorialLanguage(nextLanguage);
    }

    return (
        <Flex alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={8} className={cl("language")}>
            <BaseText size="sm" weight="semibold">{copy.languageLabel}</BaseText>
            <Flex gap={8}>
                <Button size="small" variant={language === "en" ? "primary" : "secondary"} onClick={() => selectLanguage("en")}>
                    {copy.english}
                </Button>
                <Button size="small" variant={language === "it" ? "primary" : "secondary"} onClick={() => selectLanguage("it")}>
                    {copy.italian}
                </Button>
            </Flex>
        </Flex>
    );
}

function StepNavigation({ stepIndex, setStepIndex, language }: {
    stepIndex: number;
    setStepIndex(index: number): void;
    language: Language;
}) {
    const copy = UI_COPY[language];

    return (
        <nav className={cl("step-nav")} aria-label={copy.progressLabel}>
            {TUTORIAL_STEPS.map((step, index) => (
                <Button
                    key={step.title.en}
                    size="small"
                    variant={index === stepIndex ? "primary" : "secondary"}
                    className={cl("step-button")}
                    onClick={() => setStepIndex(index)}
                >
                    <span className={cl("step-index")}>{index + 1}</span>
                    <span>{step.title[language]}</span>
                </Button>
            ))}
        </nav>
    );
}

function ProgressBar({ stepIndex }: { stepIndex: number; }) {
    const width = `${((stepIndex + 1) / TUTORIAL_STEPS.length) * 100}%`;

    return (
        <div className={cl("progress")}>
            <div className={cl("progress-fill")} style={{ width }} />
        </div>
    );
}

function RecommendationList({ selected, setSelected, language }: {
    selected: RecommendationState;
    setSelected: React.Dispatch<React.SetStateAction<RecommendationState>>;
    language: Language;
}) {
    const copy = UI_COPY[language];

    return (
        <Flex flexDirection="column" gap={10}>
            <Flex gap={8} flexWrap="wrap" className={cl("recommendation-actions")}>
                <Button size="small" variant="secondary" onClick={() => setSelected(getAvailableRecommendations())}>
                    {copy.selectAvailable}
                </Button>
                <Button size="small" variant="secondary" onClick={() => setSelected(getClearedRecommendations())}>
                    {copy.clearSelection}
                </Button>
                <Button size="small" onClick={() => enableSelectedRecommendations(selected, language)}>
                    {copy.enableSelected}
                </Button>
            </Flex>

            <div className={cl("recommendation-list")}>
                {RECOMMENDED_PLUGIN_NAMES.map(name => {
                    const available = Boolean(plugins[name]);
                    const enabled = available && isPluginEnabled(name);

                    return (
                        <div key={name} className={cl("recommendation-row")}>
                            <Checkbox
                                value={enabled || selected[name]}
                                disabled={!available || enabled}
                                onChange={(_event, checked) => setSelected(current => ({ ...current, [name]: checked }))}
                            >
                                <Flex flexDirection="column" gap={2}>
                                    <BaseText size="sm" weight="semibold">
                                        {name}{enabled ? copy.alreadyActive : !available ? copy.unavailable : ""}
                                    </BaseText>
                                    <BaseText size="xs" color="text-muted">
                                        {RECOMMENDED_PLUGIN_COPY[name][language]}
                                    </BaseText>
                                </Flex>
                            </Checkbox>
                            <Button
                                size="small"
                                variant="secondary"
                                disabled={!available}
                                onClick={() => openRecommendedPluginSettings(name, language)}
                            >
                                {copy.pluginSettings}
                            </Button>
                        </div>
                    );
                })}
            </div>
        </Flex>
    );
}

function TutorialModal({ modalProps, initialStep = 0 }: TutorialModalProps) {
    const [stepIndex, setStepIndex] = React.useState(normalizeStepIndex(initialStep));
    const [selected, setSelected] = React.useState(getInitialRecommendations);
    const [language, setLanguage] = React.useState<Language>("en");
    const copy = UI_COPY[language];
    const step = TUTORIAL_STEPS[stepIndex];
    const isLastStep = stepIndex === TUTORIAL_STEPS.length - 1;

    React.useEffect(() => {
        void getTutorialLanguage().then(setLanguage);
    }, []);

    function close() {
        activeModalKey = undefined;
        modalProps.onClose();
    }

    function finish() {
        markTutorialSeen();
        close();
    }

    return (
        <Modal
            {...modalProps}
            onClose={close}
            size="lg"
            title="Illegalcord Tutorial"
            subtitle={`${stepIndex + 1}/${TUTORIAL_STEPS.length} · ${step.route[language]}`}
            actions={[
                {
                    text: copy.later,
                    variant: "secondary",
                    onClick: close
                },
                {
                    text: copy.neverAgain,
                    variant: "secondary",
                    onClick: finish
                },
                {
                    text: isLastStep ? copy.done : copy.next,
                    variant: "primary",
                    onClick: () => isLastStep ? finish() : setStepIndex(index => normalizeStepIndex(index + 1))
                }
            ]}
        >
            <div className={cl("root")}>
                <LanguageSwitch language={language} setLanguage={setLanguage} />
                <ProgressBar stepIndex={stepIndex} />

                <div className={cl("layout")}>
                    <StepNavigation stepIndex={stepIndex} setStepIndex={setStepIndex} language={language} />

                    <div className={cl("content", { "content-with-aside": step.kind === "recommendations" })}>
                        <div className={cl("main")}>
                            <Card className={cl("panel")}>
                                <Flex flexDirection="column" gap={8}>
                                    <BaseText size="xs" color="text-muted">{copy.stepLabel} {stepIndex + 1}</BaseText>
                                    <Heading tag="h3">{step.title[language]}</Heading>
                                    <BaseText tag="p" size="sm" color="text-muted">
                                        {step.body[language]}
                                    </BaseText>
                                </Flex>
                            </Card>

                            <Card className={cl("panel")}>
                                <Flex flexDirection="column" gap={10}>
                                    <BaseText size="sm" weight="semibold">{copy.whatNext}</BaseText>
                                    <ul className={cl("bullets")}>
                                        {step.bullets[language].map(item => <li key={item}>{item}</li>)}
                                    </ul>
                                    <Flex gap={8} flexWrap="wrap">
                                        {step.actionLabel && (
                                            <Button size="small" variant="secondary" onClick={() => openSettingsPanel(step.panel)}>
                                                {step.actionLabel[language]}
                                            </Button>
                                        )}
                                        {step.secondaryActionLabel && (
                                            <Button size="small" variant="secondary" onClick={() => openSettingsPanel(step.secondaryPanel)}>
                                                {step.secondaryActionLabel[language]}
                                            </Button>
                                        )}
                                    </Flex>
                                </Flex>
                            </Card>
                        </div>

                        {step.kind === "recommendations" && (
                            <Card className={cl("panel", "recommendations-panel")}>
                                <Flex flexDirection="column" gap={12}>
                                    <BaseText size="sm" weight="semibold">{copy.recommendationsTitle}</BaseText>
                                    <RecommendationList selected={selected} setSelected={setSelected} language={language} />
                                </Flex>
                            </Card>
                        )}
                    </div>
                </div>

                <Flex justifyContent="space-between" alignItems="center" gap={8} flexWrap="wrap">
                    <Button
                        size="small"
                        variant="secondary"
                        disabled={stepIndex === 0}
                        onClick={() => setStepIndex(index => Math.max(0, index - 1))}
                    >
                        {copy.back}
                    </Button>
                    <BaseText size="xs" color="text-muted">
                        {copy.reopenHint}
                    </BaseText>
                </Flex>
            </div>
        </Modal>
    );
}

const SafeTutorialModal = ErrorBoundary.wrap(TutorialModal, { noop: true });

export function openTutorial(initialStep?: unknown) {
    closeTutorial();
    const normalizedInitialStep = normalizeStepIndex(initialStep);

    activeModalKey = openModal(modalProps => {
        const onClose = () => {
            activeModalKey = undefined;
            modalProps.onClose();
        };

        return <SafeTutorialModal modalProps={{ ...modalProps, onClose }} initialStep={normalizedInitialStep} />;
    });
}

export function closeTutorial() {
    if (!activeModalKey) return;

    closeModal(activeModalKey);
    activeModalKey = undefined;
}
