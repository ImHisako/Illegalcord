/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { copyWithToast, openImageModal } from "@utils/discord";
import { Logger } from "@utils/Logger";
import type { RenderModalProps } from "@vencord/discord-types";
import { Alerts, Button, Clickable, closeModal, Menu, Modal, NavigationRouter, openModal, Parser, showToast, TextInput, Toasts, useEffect, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { PASSWORD_KEYS, settings } from "./settings";
import { type BookmarkProtectionState, cleanupExpiredBookmarks, clearBookmarks, getBookmarkProtectionState, getVisibleBookmarks, removeBookmark, type VisibleBookmark } from "./store";

const cl = classNameFactory("vc-secure-bookmarks-");
const logger = new Logger("SecureBookmarks");

let activeModalKey: string | null = null;

function closeAllSecureBookmarksModals(): void {
    if (!activeModalKey) return;
    closeModal(activeModalKey);
    activeModalKey = null;
}

function formatExpiry(expiresAt: number | null): string {
    if (expiresAt === null) return "No expiry";

    const diff = expiresAt - Date.now();
    if (diff <= 0) return "Expired";

    const minutes = Math.ceil(diff / 60_000);
    if (minutes < 60) return `${minutes}m left`;

    const hours = Math.ceil(minutes / 60);
    if (hours < 48) return `${hours}h left`;

    return `${Math.ceil(hours / 24)}d left`;
}

function summarizeBookmark(bookmark: VisibleBookmark): string {
    if (bookmark.content.trim()) return bookmark.content.trim();
    if (bookmark.images?.length) return `${bookmark.images.length} image${bookmark.images.length === 1 ? "" : "s"}`;
    if (bookmark.attachmentNames.length) return `${bookmark.attachmentNames.length} attachment${bookmark.attachmentNames.length === 1 ? "" : "s"}`;
    if (bookmark.embedCount) return `${bookmark.embedCount} embed${bookmark.embedCount === 1 ? "" : "s"}`;
    return "Saved message";
}

function parsedMessageContent(bookmark: VisibleBookmark): ReactNode {
    const content = summarizeBookmark(bookmark);
    if (!bookmark.content.trim()) return content;

    return Parser.parse(bookmark.content, true, {
        channelId: bookmark.channelId,
        messageId: bookmark.messageId,
        allowLinks: true,
        allowHeading: true,
        allowList: true,
        allowEmojiLinks: true,
        viewingChannelId: bookmark.channelId
    });
}

function jumpToBookmark(bookmark: VisibleBookmark): void {
    NavigationRouter.transitionTo(`/channels/${bookmark.guildId ?? "@me"}/${bookmark.channelId}/${bookmark.messageId}`);
    closeAllSecureBookmarksModals();
}

function BookmarkImages({ bookmark }: { bookmark: VisibleBookmark; }) {
    const images = bookmark.images ?? [];
    if (!images.length) return null;

    return (
        <div className={cl("images")}>
            {images.map(image => (
                <Clickable
                    key={image.url}
                    className={cl("image-button")}
                    onClick={() => openImageModal({
                        url: image.proxyUrl || image.url,
                        original: image.url,
                        width: image.width ?? 1,
                        height: image.height ?? 1
                    })}
                >
                    <img
                        className={cl("image")}
                        src={image.proxyUrl || image.url}
                        alt={image.filename}
                    />
                </Clickable>
            ))}
        </div>
    );
}

interface UnlockViewProps {
    onUnlock: (password: string) => void;
}

function UnlockView({ onUnlock }: UnlockViewProps) {
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");

    const unlock = () => {
        if (password !== settings.store.password) {
            setError("Wrong password.");
            return;
        }

        setError("");
        onUnlock(password);
    };

    return (
        <div className={cl("unlock")}>
            <BaseText tag="p" size="sm" color="text-muted">
                Enter your SecureBookmarks password to show saved bookmarks.
            </BaseText>
            <TextInput
                value={password}
                onChange={setPassword}
                placeholder="Password"
                type="password"
                autoComplete="current-password"
            />
            {error && <BaseText size="sm" color="text-danger">{error}</BaseText>}
            <Button size="small" onClick={unlock}>Unlock</Button>
        </div>
    );
}

interface BookmarksListProps {
    password: string;
}

function BookmarksList({ password }: BookmarksListProps) {
    const [bookmarks, setBookmarks] = useState<VisibleBookmark[]>([]);
    const [pending, setPending] = useState(true);
    const [error, setError] = useState("");

    const reload = () => {
        setPending(true);
        void getVisibleBookmarks(password)
            .then(nextBookmarks => {
                setBookmarks(nextBookmarks);
                setError("");
            })
            .catch(err => {
                logger.error("Failed to decrypt bookmarks.", err);
                setError("Could not decrypt bookmarks with this password.");
            })
            .finally(() => setPending(false));
    };

    useEffect(reload, [password]);

    const remove = (id: string) => {
        void removeBookmark(id)
            .then(reload)
            .then(() => showToast("Bookmark removed.", Toasts.Type.SUCCESS));
    };

    const confirmClear = () => {
        Alerts.show({
            title: "Clear SecureBookmarks",
            body: "Are you sure you want to delete all saved bookmarks?",
            confirmText: "Clear",
            confirmVariant: "critical-primary",
            cancelText: "Cancel",
            onConfirm: () => {
                void clearBookmarks()
                    .then(reload)
                    .then(() => showToast("Bookmarks cleared.", Toasts.Type.SUCCESS));
            }
        });
    };

    if (pending) return <BaseText size="sm" color="text-muted">Loading bookmarks.</BaseText>;
    if (error) return <BaseText size="sm" color="text-danger">{error}</BaseText>;

    return (
        <div className={cl("list")}>
            {!bookmarks.length ? (
                <BaseText size="sm" color="text-muted">No saved bookmarks.</BaseText>
            ) : (
                <>
                    <div className={cl("toolbar")}>
                        <BaseText size="sm" color="text-muted">{bookmarks.length} saved bookmark{bookmarks.length === 1 ? "" : "s"}.</BaseText>
                        <Button size="small" color="RED" onClick={confirmClear}>Clear all</Button>
                    </div>
                    {bookmarks.map(bookmark => (
                        <div className={cl("item")} key={bookmark.id}>
                            <div className={cl("item-main")}>
                                <BaseText size="sm" weight="semibold" lineClamp={1}>
                                    {bookmark.authorName} in #{bookmark.channelName}
                                </BaseText>
                                <BaseText size="sm" className={cl("content")}>
                                    {parsedMessageContent(bookmark)}
                                </BaseText>
                                <BookmarkImages bookmark={bookmark} />
                                <BaseText size="xs" color="text-muted">
                                    {new Date(bookmark.messageTimestamp).toLocaleString()} - {formatExpiry(bookmark.expiresAt)}
                                </BaseText>
                            </div>
                            <div className={cl("actions")}>
                                <Button size="small" onClick={() => jumpToBookmark(bookmark)}>Jump</Button>
                                <Button size="small" color="PRIMARY" onClick={() => copyWithToast(bookmark.link, "Bookmark link copied.")}>Copy link</Button>
                                <Button size="small" color="PRIMARY" onClick={() => copyWithToast(bookmark.content || summarizeBookmark(bookmark), "Bookmark text copied.")}>Copy text</Button>
                                <Button size="small" color="RED" onClick={() => remove(bookmark.id)}>Delete</Button>
                            </div>
                        </div>
                    ))}
                </>
            )}
        </div>
    );
}

interface SecureBookmarksModalProps {
    modalProps: RenderModalProps;
    close: () => void;
}

function SecureBookmarksModalInner({ modalProps, close }: SecureBookmarksModalProps) {
    const { usePassword, password } = settings.use(PASSWORD_KEYS);
    const [unlockedPassword, setUnlockedPassword] = useState("");
    const [protection, setProtection] = useState<BookmarkProtectionState | null>(null);

    useEffect(() => {
        void getBookmarkProtectionState().then(setProtection);
    }, []);

    const passwordNeeded = Boolean(protection?.hasEncrypted || usePassword && protection?.total);
    const needsUnlock = passwordNeeded && unlockedPassword !== password;

    return (
        <Modal
            {...modalProps}
            size="lg"
            title="SecureBookmarks"
            actions={[{ text: "Close", variant: "secondary", onClick: close }]}
        >
            {!protection ? (
                <BaseText size="sm" color="text-muted">Loading bookmarks.</BaseText>
            ) : passwordNeeded && !password ? (
                <BaseText size="sm" color="text-danger">Set a SecureBookmarks password in plugin settings first.</BaseText>
            ) : needsUnlock ? (
                <UnlockView onUnlock={setUnlockedPassword} />
            ) : (
                <BookmarksList password={unlockedPassword} />
            )}
        </Modal>
    );
}

const SecureBookmarksModal = ErrorBoundary.wrap(SecureBookmarksModalInner, { noop: true });

export function openSecureBookmarksModal(): void {
    closeAllSecureBookmarksModals();

    const key = openModal(props => (
        <SecureBookmarksModal
            modalProps={props}
            close={() => {
                closeModal(key);
                activeModalKey = null;
            }}
        />
    ));
    activeModalKey = key;
}

export function renderSecureBookmarksToolboxMenu() {
    const [count, setCount] = useState(0);

    useEffect(() => {
        void cleanupExpiredBookmarks().then(store => setCount(store.records.length));
    }, []);

    return (
        <Menu.MenuItem
            id="secure-bookmarks-menu"
            label={`SecureBookmarks${count ? ` (${count})` : ""}`}
            action={openSecureBookmarksModal}
        >
            <Menu.MenuItem
                id="secure-bookmarks-open"
                label="Open bookmarks"
                action={openSecureBookmarksModal}
            />
            <Menu.MenuItem
                id="secure-bookmarks-clear-expired"
                label="Clear expired bookmarks"
                action={() => {
                    void cleanupExpiredBookmarks()
                        .then(store => {
                            setCount(store.records.length);
                            showToast("Expired bookmarks cleared.", Toasts.Type.SUCCESS);
                        });
                }}
            />
        </Menu.MenuItem>
    );
}
