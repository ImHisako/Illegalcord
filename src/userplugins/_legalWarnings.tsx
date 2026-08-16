/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Margins } from "@components/margins";
import { Notice } from "@components/Notice";

function MonitoringWarning() {
    return (
        <Notice.Warning className={Margins.bottom8}>
            <strong>Authorized and responsible use only.</strong>
            <p>Use this plugin only with your own account and data or in an expressly authorized moderation, research, or security context. You are responsible for having any required lawful basis, consent or notice, minimizing what is collected, restricting access, and deleting local logs when they are no longer needed.</p>
            <p>Do not use it for stalking, harassment, intimidation, doxxing, unauthorized profiling, or monitoring communications you are not entitled to access. Local storage does not make unauthorized monitoring lawful. Nothing in this notice excludes liability that cannot be excluded under applicable law.</p>
        </Notice.Warning>
    );
}

function GhostSelfbotWarning() {
    return (
        <Notice.Warning className={Margins.bottom8}>
            <strong>High-risk account and credential feature.</strong>
            <p>Selfbots violate Discord&apos;s rules and can result in account termination. Use only your own account and token. Token auto-fill writes the credential to readable files on this computer so the independently downloaded Ghost program can authenticate with Discord. Never use, import, or share another person&apos;s token.</p>
            <p>You are responsible for reviewing the Ghost code or executable, protecting its files, webhook configuration, and token, and accepting the platform and security risks before launch. Illegalcord does not receive the token through this integration. Nothing in this notice excludes liability that cannot be excluded under applicable law.</p>
        </Notice.Warning>
    );
}

function AutomationWarning() {
    return (
        <Notice.Warning className={Margins.bottom8}>
            <strong>Do not use this feature abusively.</strong>
            <p>You are responsible for every message or automated action produced by this plugin. Do not use it for spam, mass harassment, unwanted mentions, scraping, rate-limit evasion, or bypassing moderation and server rules. Use only where you have permission and where the action complies with applicable law and platform rules.</p>
            <p>Nothing in this notice excludes liability that cannot be excluded under applicable law.</p>
        </Notice.Warning>
    );
}

function SafetyBypassWarning() {
    return (
        <Notice.Warning className={Margins.bottom8}>
            <strong>Age and safety controls must still be respected.</strong>
            <p>Do not use this plugin to misrepresent your age, evade parental or platform safeguards, or access content you are not legally permitted to view. A client-side modification does not create authorization or a legal right to bypass a restriction. You are responsible for satisfying age requirements and all applicable laws and platform rules.</p>
            <p>Nothing in this notice excludes liability that cannot be excluded under applicable law.</p>
        </Notice.Warning>
    );
}

function MessageLoggerWarning() {
    return (
        <Notice.Warning className={Margins.bottom8}>
            <strong>Persistent message storage has privacy consequences.</strong>
            <p>Log only messages you are authorized to access and retain. You are responsible for any required lawful basis or notice, access controls, a proportionate retention period, and secure deletion. Do not use restored or deleted content for harassment, doxxing, coercion, or unauthorized profiling.</p>
            <p>Nothing in this notice excludes liability that cannot be excluded under applicable law.</p>
        </Notice.Warning>
    );
}

function SniperWarning() {
    return (
        <Notice.Warning className={Margins.bottom8}>
            <strong>Automated redemption and external-service warning.</strong>
            <p>You are responsible for ensuring that every redemption attempt is authorized and complies with Discord&apos;s rules. Do not use automation, third-party CAPTCHA services, proxies, or webhooks to claim codes unfairly, evade safeguards, misuse another account, or expose personal data and credentials.</p>
            <p>Nothing in this notice excludes liability that cannot be excluded under applicable law.</p>
        </Notice.Warning>
    );
}

export const MonitoringLegalWarning = ErrorBoundary.wrap(MonitoringWarning, { noop: true });
export const GhostSelfbotLegalWarning = ErrorBoundary.wrap(GhostSelfbotWarning, { noop: true });
export const AutomationLegalWarning = ErrorBoundary.wrap(AutomationWarning, { noop: true });
export const SafetyBypassLegalWarning = ErrorBoundary.wrap(SafetyBypassWarning, { noop: true });
export const MessageLoggerLegalWarning = ErrorBoundary.wrap(MessageLoggerWarning, { noop: true });
export const SniperLegalWarning = ErrorBoundary.wrap(SniperWarning, { noop: true });
