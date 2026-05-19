/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { GithubIcon, OpenExternalIcon } from "@components/Icons";
import { classNameFactory } from "@utils/css";
import { CloseButton, closeModal, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";

const TELEGRAM_URL = "https://t.me/Illegalcord";
const GITHUB_URL = "https://github.com/ImHisako/Illegalcord";
const cl = classNameFactory("vc-illegalcord-announcements-");

let hasOpened = false;

const settings = definePluginSettings({
    showStartupModal: {
        type: OptionType.BOOLEAN,
        description: "Show the Illegalcord announcements popup on startup.",
        default: true
    }
});

interface AnnouncementModalProps {
    modalProps: ModalProps;
}

function openExternal(url: string) {
    VencordNative.native.openExternal(url);
}

function IllegalcordAnnouncementModal({ modalProps }: AnnouncementModalProps) {
    const dismissForever = () => {
        settings.store.showStartupModal = false;
        modalProps.onClose();
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM} className={cl("modal")}>
            <ModalHeader separator={false} className={cl("header")}>
                <div className={cl("header-content")}>
                    <BaseText tag="h2" size="lg" weight="semibold" className={cl("title")}>
                        Illegalcord Updates
                    </BaseText>
                    <BaseText tag="p" size="sm" color="text-muted" className={cl("description")}>
                        Join the Telegram for updates, announcements, issue notices, and a direct place to contact the Illegalcord maintainer.
                    </BaseText>
                </div>
                <CloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <ModalContent className={cl("content")}>
                <div className={cl("actions")}>
                    <section className={cl("action")}>
                        <div>
                            <BaseText size="md" weight="semibold">Telegram community</BaseText>
                            <BaseText tag="p" size="sm" color="text-muted">
                                Updates, announcements, problem reports, and support contact live here.
                            </BaseText>
                        </div>
                        <Button onClick={() => openExternal(TELEGRAM_URL)} className={cl("action-button")}>
                            Join Telegram
                            <OpenExternalIcon height={16} width={16} />
                        </Button>
                    </section>

                    <section className={cl("action")}>
                        <div>
                            <BaseText size="md" weight="semibold">Source code</BaseText>
                            <BaseText tag="p" size="sm" color="text-muted">
                                Star the GitHub repository if Illegalcord is useful to you.
                            </BaseText>
                        </div>
                        <Button variant="secondary" onClick={() => openExternal(GITHUB_URL)} className={cl("action-button")}>
                            Star on GitHub
                            <GithubIcon height={16} width={16} />
                        </Button>
                    </section>
                </div>
            </ModalContent>

            <ModalFooter separator={false}>
                <Flex justifyContent="flex-end" flexWrap="wrap" gap="8px" className={cl("footer")}>
                    <Button variant="secondary" onClick={dismissForever}>
                        Do not show again
                    </Button>
                    <Button onClick={modalProps.onClose}>
                        Continue
                    </Button>
                </Flex>
            </ModalFooter>
        </ModalRoot>
    );
}

const SafeIllegalcordAnnouncementModal = ErrorBoundary.wrap(IllegalcordAnnouncementModal, { noop: true });

function IllegalcordAnnouncementSettings() {
    return (
        <div className={cl("settings")}>
            <BaseText tag="p" size="sm" color="text-muted">
                You can reopen the announcement popup here whenever you want.
            </BaseText>
            <Button size="small" onClick={() => openIllegalcordAnnouncementModal(true)}>
                Open popup
            </Button>
        </div>
    );
}

const SafeIllegalcordAnnouncementSettings = ErrorBoundary.wrap(IllegalcordAnnouncementSettings, { noop: true });

export function openIllegalcordAnnouncementModal(force = false) {
    if (!force && (!settings.store.showStartupModal || hasOpened)) return;

    hasOpened = true;
    const modalKey = openModal(modalProps => (
        <ErrorBoundary noop onError={() => closeModal(modalKey)}>
            <SafeIllegalcordAnnouncementModal modalProps={modalProps} />
        </ErrorBoundary>
    ));
}

export default definePlugin({
    name: "IllegalcordAnnouncements",
    description: "Shows Illegalcord Telegram and GitHub announcements.",
    tags: ["Utility"],
    authors: [{ name: "irritably", id: 928787166916640838n }],
    required: true,
    enabledByDefault: true,
    settings,
    settingsAboutComponent: SafeIllegalcordAnnouncementSettings,
    toolboxActions: {
        "Open Illegalcord popup": () => openIllegalcordAnnouncementModal(true)
    },
    flux: {
        POST_CONNECTION_OPEN() {
            openIllegalcordAnnouncementModal();
        }
    }
});
