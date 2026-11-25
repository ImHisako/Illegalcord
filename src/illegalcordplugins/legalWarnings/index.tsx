/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Margins } from "@components/margins";
import { Notice } from "@components/Notice";
import { AddonCard } from "@components/settings/AddonCard";
import { openSettingsTabModal } from "@components/settings/tabs/BaseTab";
import PluginsTab from "@components/settings/tabs/plugins";
import { PluginCard } from "@components/settings/tabs/plugins/PluginCard";
import SettingsPlugin from "@plugins/_core/settings";
import { EquicordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Alerts, React } from "@webpack/common";

const settings = definePluginSettings({
    showActivationWarnings: {
        type: OptionType.BOOLEAN,
        description: "Show safety popups before enabling plugins, including warnings about Discord API usage.",
        default: true
    }
});

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

function ApiUsageWarning() {
    return (
        <Notice.Warning className={Margins.bottom8}>
            <strong>Discord API usage warning.</strong>
            <p>ClanSwitcher and StatusCycler use Discord&apos;s APIs and may pose a higher risk to your account. Consider these risks before enabling them.</p>
        </Notice.Warning>
    );
}

export const MonitoringLegalWarning = ErrorBoundary.wrap(MonitoringWarning, { noop: true });
export const GhostSelfbotLegalWarning = ErrorBoundary.wrap(GhostSelfbotWarning, { noop: true });
export const AutomationLegalWarning = ErrorBoundary.wrap(AutomationWarning, { noop: true });
export const MessageLoggerLegalWarning = ErrorBoundary.wrap(MessageLoggerWarning, { noop: true });
export const SniperLegalWarning = ErrorBoundary.wrap(SniperWarning, { noop: true });

const ApiUsageLegalWarning = ErrorBoundary.wrap(ApiUsageWarning, { noop: true });

const activationWarnings: Record<string, { Component?: React.ComponentType; details?: string; apiAbuse: boolean; } | undefined> = {
    Stalker: { Component: MonitoringLegalWarning, apiAbuse: false },
    Surveillance: { Component: MonitoringLegalWarning, apiAbuse: false },
    GhostSelfbot: { Component: GhostSelfbotLegalWarning, apiAbuse: true },
    AutoModBypass: { Component: AutomationLegalWarning, apiAbuse: false },
    MassMention: { Component: AutomationLegalWarning, apiAbuse: true },
    IllegalMessageLogger: { Component: MessageLoggerLegalWarning, apiAbuse: false },
    NitroSniper: { Component: SniperLegalWarning, apiAbuse: true },
    ClanSwitcher: { Component: ApiUsageLegalWarning, apiAbuse: true },
    StatusCycler: { Component: ApiUsageLegalWarning, apiAbuse: true },
    DontLimitMe: { details: "DontLimitMe raises the local outgoing message queue limit. It does not remove Discord's server limits. Repeated or unsolicited messaging can put your account at risk.", apiAbuse: false },
    "NitroSniper Nighty Ver": { Component: SniperLegalWarning, apiAbuse: true },
    ServerCloner: { details: "ServerCloner automates requests that can create, change or delete server channels, roles, permissions and assets. Use it only on servers you are authorized to manage, review the target server carefully, and respect Discord's request limits.", apiAbuse: true },
    MutualScanner: { details: "MutualScanner automatically requests server members and user profiles to find mutual friends. Large scans can generate many requests and collect other users' data. Scan only for an authorized purpose and respect privacy and request limits.", apiAbuse: true },
    SendTrail: { details: "SendTrail can automatically delete selected messages through Discord's API. Review your selection before starting because deletion is permanent. Large purges can generate many requests.", apiAbuse: true },
    SilentDelete: { details: "SilentDelete sends and deletes replacement messages and may delete the originals. Its silent purge command repeats these actions across multiple messages, generating additional API requests and permanent deletions.", apiAbuse: true },
    SilentEdit: { details: "SilentEdit sends a replacement message and can delete the original instead of performing a normal edit. This produces additional API requests and can permanently remove the original message.", apiAbuse: true },
    FollowUser: { details: "FollowUser automatically joins or leaves voice channels to follow another user. Repeated moves generate account actions. Use it with the other person's consent and do not use it for harassment or to evade moderation.", apiAbuse: true },
    PlatformSpoofer: { details: "PlatformSpoofer changes the platform information sent when your client identifies to Discord's Gateway. This changes the client information visible to Discord and may put your account at risk.", apiAbuse: false },
    FakeMuteAndDeafen: { details: "FakeMuteAndDeafen changes mute, deafen or video flags in the voice state sent through Discord's Gateway. Other users may see a different state from your actual microphone or audio state. Consider the privacy and account risks before enabling it.", apiAbuse: false },
    BoostCounts: { details: "BoostCounts uses your Discord account token to request server boost information from Discord's API when you open its booster list. Avoid repeated requests and only access server data you are permitted to view.", apiAbuse: false },
    DetectBlock: { details: "DetectBlock can request user profiles through Discord's API to infer whether another user has blocked you. Respect other users' boundaries and avoid repeated or extensive checks.", apiAbuse: false },
    LarpCord: { details: "LarpCord mainly changes your local profile preview, but it also requests collectible product information from Discord's API. Use these previews responsibly and respect Discord's request limits.", apiAbuse: false },
    AnonLi: { details: "AnonLi uploads files to an external service and can send the resulting link through your Discord account. Only upload content you are allowed to share and review what you send.", apiAbuse: false },
    IGP: { details: "IGP uses Discord's message sending actions for encrypted messages and key sharing. Encryption does not authorize spam or abusive messages. Protect your private keys and review the recipients and material you share.", apiAbuse: false }
};

let restoreSettingsEntry: (() => void) | undefined;
let toolboxPluginsTab: React.ComponentType = PluginsTab;

export default definePlugin({
    name: "LegalWarnings",
    description: "Displays legal and responsible use warnings for Illegalcord plugins.",
    authors: [EquicordDevs.irritably],
    enabledByDefault: true,
    requiresRestart: true,
    settings,

    start() {
        const { buildEntry } = SettingsPlugin;
        const { confirmEnable } = this;
        let active = true;

        const ProtectedPluginCard = ErrorBoundary.wrap((props: Parameters<typeof PluginCard>[0]) => {
            const card: React.ReactElement<React.ComponentProps<typeof AddonCard>> = PluginCard(props);
            const { setEnabled } = card.props;
            return (
                <AddonCard {...card.props} setEnabled={async (enabled: boolean) => {
                    if (enabled && active && activationWarnings[props.plugin.name]) {
                        if (!await confirmEnable(props.plugin.name) || !active || isPluginEnabled(props.plugin.name)) return;
                    }
                    setEnabled(enabled);
                }} />
            );
        }, { noop: true });

        function wrapCards(node: React.ReactNode): React.ReactNode {
            if (Array.isArray(node)) {
                const children = node.map(wrapCards);
                return children.some((child: React.ReactNode, index: number) => child !== node[index]) ? children : node;
            }
            if (node === null || typeof node !== "object" || !("type" in node) || !("props" in node)) return node;

            if (node.type === PluginCard) {
                const props = node.props as Parameters<typeof PluginCard>[0];
                return <ProtectedPluginCard {...props} key={node.key ?? undefined} />;
            }

            const element = node as React.ReactElement<{ children?: React.ReactNode; }>;
            const children = wrapCards(element.props.children);
            if (children === element.props.children) return node;
            return React.createElement(element.type, { ...element.props, key: element.key ?? undefined }, children);
        }

        const ProtectedPluginsTab = ErrorBoundary.wrap(() => wrapCards(PluginsTab()), { noop: true });
        toolboxPluginsTab = ProtectedPluginsTab;
        const wrappedBuildEntry: typeof buildEntry = (options: Parameters<typeof buildEntry>[0]) => {
            return buildEntry.call(SettingsPlugin, active && options.key === "equicord_plugins"
                ? { ...options, Component: ProtectedPluginsTab }
                : options);
        };
        SettingsPlugin.buildEntry = wrappedBuildEntry;
        restoreSettingsEntry = () => {
            active = false;
            if (SettingsPlugin.buildEntry === wrappedBuildEntry) SettingsPlugin.buildEntry = buildEntry;
        };
    },

    stop() {
        toolboxPluginsTab = PluginsTab;
        restoreSettingsEntry?.();
        restoreSettingsEntry = undefined;
    },

    contextMenus: {
        "vc-toolbox"(children: Parameters<NavContextMenuPatchCallback>[0]) {
            const group = findGroupChildrenByChildId("plugins", children);
            const item: React.ReactElement<{ id: string; action(): void; }> | null | undefined = group?.find(
                (child: React.ReactElement<{ id: string; }> | null | undefined) => child?.props.id === "plugins"
            );
            if (item) item.props.action = () => openSettingsTabModal(toolboxPluginsTab);
        }
    },

    async confirmEnable(pluginName: string) {
        const warning = activationWarnings[pluginName];
        if (!warning || !settings.store.showActivationWarnings) return true;

        const { Component, details, apiAbuse } = warning;
        return Alerts.confirm({
            title: `Enable ${pluginName}?`,
            body: (
                <>
                    {Component ? <Component /> : null}
                    {details ? <Notice.Warning className={Margins.bottom8}>{details}</Notice.Warning> : null}
                    <p>
                        <strong>API abuse risk: </strong>
                        {apiAbuse
                            ? "This plugin automates Discord API actions, which may put your account at greater risk if used excessively or abusively."
                            : "This plugin is not flagged for bulk Discord API automation. The safety warning above still applies."}
                    </p>
                    <Button type="button" variant="secondary" onClick={async () => {
                        if (await Alerts.confirm({
                            title: "Are you sure?",
                            body: "You will no longer see safety popups when enabling plugins, including warnings about which plugins use Discord's APIs or may pose an API abuse risk. You can turn these popups back on in the LegalWarnings settings.",
                            confirmText: "Stop showing warnings",
                            cancelText: "Keep warnings"
                        })) settings.store.showActivationWarnings = false;
                    }}>
                        Do not show these warnings again
                    </Button>
                </>
            ),
            confirmText: "Enable plugin",
            cancelText: "Cancel"
        });
    }
});
