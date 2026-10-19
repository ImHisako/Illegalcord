/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import { Alerts, createRoot, React } from "@webpack/common";
import type { ReactNode } from "react";
import type { Root } from "react-dom/client";

interface SupportAlert {
    title: ReactNode;
    body: ReactNode;
    confirmText?: string;
    cancelText?: string;
    onConfirm?(): void | Promise<void>;
    onCancel?(): void;
}

interface SupportOverlayProps {
    content: ReactNode;
    alert: SupportAlert | null;
}

const logger = new Logger("CrashHandlerEnhanced");
let root: Root | undefined;
let container: HTMLDivElement | undefined;
let renderContent: ((onClose: () => void) => ReactNode) | undefined;
let currentAlert: SupportAlert | null = null;

export function closeSupportPopup() {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
    renderContent = undefined;
    currentAlert = null;
}

function dismissAlert(confirm: boolean) {
    const alert = currentAlert;
    if (!alert) return;
    currentAlert = null;
    renderSupportPopup();
    try {
        const result = confirm ? alert.onConfirm?.() : alert.onCancel?.();
        Promise.resolve(result).catch(error => {
            logger.error("Crash recovery action failed.", error);
            showSupportAlert({ title: "Recovery action failed.", body: "Try restarting the client before repeating this action." });
        });
    } catch (error) {
        logger.error("Crash recovery action failed.", error);
        showSupportAlert({ title: "Recovery action failed.", body: "Try restarting the client before repeating this action." });
    }
}

function SupportOverlay({ content, alert }: SupportOverlayProps) {
    const dialog = React.useRef<HTMLDialogElement>(null);
    React.useLayoutEffect(() => {
        const element = dialog.current;
        element?.showModal();
        return () => element?.close();
    }, []);

    return (
        <dialog ref={dialog} className="vc-crash-handler-enhanced-overlay" aria-label="Illegalcord crash recovery" tabIndex={-1} onCancel={event => {
            event.preventDefault();
            if (alert) dismissAlert(false);
            else closeSupportPopup();
        }}>
            <div hidden={alert !== null}>{content}</div>
            {alert && (
                <section className="vc-crash-handler-enhanced-fallback" role="alertdialog" aria-label="Crash recovery confirmation">
                    <BaseText size="lg" weight="semibold">{alert.title}</BaseText>
                    <BaseText>{alert.body}</BaseText>
                    <div className="vc-crash-handler-enhanced-footer-actions">
                        <Button variant="secondary" onClick={() => dismissAlert(false)}>{alert.cancelText ?? "Cancel"}</Button>
                        <Button autoFocus onClick={() => dismissAlert(true)}>{alert.confirmText ?? "Continue"}</Button>
                    </div>
                </section>
            )}
        </dialog>
    );
}

const SafeSupportOverlay = ErrorBoundary.wrap(SupportOverlay, { noop: true });

function renderSupportPopup() {
    if (root && renderContent) root.render(<SafeSupportOverlay content={renderContent(closeSupportPopup)} alert={currentAlert} />);
}

export function openSupportPopup(render: (onClose: () => void) => ReactNode) {
    if (!root) {
        container = document.createElement("div");
        document.body.append(container);
        root = createRoot(container);
    }
    currentAlert = null;
    renderContent = render;
    renderSupportPopup();
}

export function showSupportAlert(alert: SupportAlert) {
    if (!root) {
        Alerts.show(alert);
        return;
    }
    currentAlert = alert;
    renderSupportPopup();
}
