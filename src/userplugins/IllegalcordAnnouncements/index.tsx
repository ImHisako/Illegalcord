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
import { GithubIcon, OpenExternalIcon } from "@components/Icons";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { closeModal, Modal, openModal } from "@webpack/common";

const TELEGRAM_URL = "https://t.me/Illegalcord";
const GITHUB_URL = "https://github.com/ImHisako/Illegalcord";
const cl = classNameFactory("vc-illegalcord-announcements-");
const DISCORD_LOCK_UNLOCKED_EVENT = "vencord-discordlock-unlocked";

let hasOpened = false;
let pendingOpen = false;
let pendingForceOpen = false;

const settings = definePluginSettings({
    showStartupModal: {
        type: OptionType.BOOLEAN,
        description: "Show the Illegalcord announcements popup on startup.",
        default: true
    }
});

interface AnnouncementModalProps {
    modalProps: RenderModalProps;
}

function openExternal(url: string) {
    VencordNative.native.openExternal(url);
}

function isDiscordLockActive() {
    return document.documentElement.dataset.discordLockActive === "true" || document.getElementById("vcl-overlay") != null;
}

function deferUntilDiscordUnlock(force: boolean) {
    pendingForceOpen ||= force;
    if (pendingOpen) return;

    pendingOpen = true;
    window.addEventListener(DISCORD_LOCK_UNLOCKED_EVENT, () => {
        const forceOpen = pendingForceOpen;
        pendingOpen = false;
        pendingForceOpen = false;
        openIllegalcordAnnouncementModal(forceOpen);
    }, { once: true });
}

function IllegalcordAnnouncementModal({ modalProps }: AnnouncementModalProps) {
    const dismissForever = () => {
        settings.store.showStartupModal = false;
        modalProps.onClose();
    };

    return (
        <Modal
            {...modalProps}
            size="md"
            title={<BaseText tag="h2" size="lg" weight="semibold" className={cl("title")}>Illegalcord Updates</BaseText>}
            subtitle="Join the Telegram for updates, announcements, issue notices, and a direct place to contact the Illegalcord maintainer."
            actions={[
                {
                    text: "Do not show again",
                    variant: "secondary",
                    onClick: dismissForever
                },
                {
                    text: "Continue",
                    variant: "primary",
                    onClick: modalProps.onClose
                }
            ]}
        >
            <div className={cl("modal")}>
            <div className={cl("content")}>
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
            </div>
            </div>
        </Modal>
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
    if (isDiscordLockActive()) {
        deferUntilDiscordUnlock(force);
        return;
    }

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
