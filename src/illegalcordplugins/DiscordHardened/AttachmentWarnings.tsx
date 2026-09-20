/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
import ErrorBoundary from "@components/ErrorBoundary";
import { Notice } from "@components/Notice";
import { Paragraph } from "@components/Paragraph";
import type { Message } from "@vencord/discord-types";
import { React } from "@webpack/common";

import { settings } from "./index";
import { inspectAttachmentName } from "./policy";

const WARNING_KEYS: ["warnSuspiciousAttachments"] = ["warnSuspiciousAttachments"];
let started = false;

interface AttachmentWarningsProps {
    message?: Message;
}

const AttachmentWarnings = ErrorBoundary.wrap(function AttachmentWarnings({ message }: AttachmentWarningsProps) {
    const { warnSuspiciousAttachments } = settings.use(WARNING_KEYS);
    if (!warnSuspiciousAttachments || !message) return null;
    const warnings = message.attachments.flatMap(attachment => {
        const warning = inspectAttachmentName(attachment.filename);
        return warning ? [{ id: attachment.id, ...warning }] : [];
    });
    if (!warnings.length) return null;
    return <Notice.Warning>
        <Paragraph><strong>Check these attachments before opening them.</strong> Filename checks only. No file contents have been scanned.</Paragraph>
        {warnings.map(warning => <Paragraph key={warning.id}>
            <bdi>{warning.name}</bdi>: {warning.reasons.join(" ")}
        </Paragraph>)}
    </Notice.Warning>;
}, { noop: true });

export function refreshAttachmentWarnings(): void {
    if (started && settings.store.warnSuspiciousAttachments) addMessageAccessory("DiscordHardened", (props: AttachmentWarningsProps) => <AttachmentWarnings {...props} />);
    else removeMessageAccessory("DiscordHardened");
}

export function startAttachmentWarnings(): void {
    started = true;
    refreshAttachmentWarnings();
}

export function stopAttachmentWarnings(): void {
    started = false;
    removeMessageAccessory("DiscordHardened");
}
