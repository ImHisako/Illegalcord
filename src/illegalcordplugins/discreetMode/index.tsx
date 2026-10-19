/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import type { ProfileBadge } from "@api/Badges";
import { registerCommand, unregisterCommand, VencordCommand } from "@api/Commands";
import { _addChannelToolbarButtons } from "@api/HeaderBar";
import { isPluginEnabled } from "@api/PluginManager";
import { useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import UserAreaAPI from "@equicordplugins/_api/userArea";
import BadgeAPI from "@plugins/_api/badges";
import SettingsPlugin from "@plugins/_core/settings";
import { EquicordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import definePlugin, { StartAt } from "@utils/types";
import type { Activity } from "@vencord/discord-types";
import { onceReady } from "@webpack";
import { ApplicationStreamingStore, StreamerModeStore, useStateFromStores } from "@webpack/common";
import type { PropsWithChildren, ReactNode } from "react";

import { installLarpCordPrivacy } from "./larpCord";
import { installPinDmsPrivacy } from "./pinDms";
import { handleKeyDown, refreshActivities, settings, toggleDiscreetMode } from "./settings";
import { installPluginSuspension } from "./suspension";
import { installVisualPrivacy } from "./visuals";

const cl = classNameFactory("vc-discreet-mode-");
const logger = new Logger("DiscreetMode");
const INTERFACE_KEYS: Array<"active" | "hideInterface" | "manualMode"> = ["active", "hideInterface", "manualMode"];
const ENABLED_KEYS: Parameters<typeof useSettings>[0] = ["plugins.DiscreetMode.enabled"];
const CLIENT_NAMES = /\b(?:illegalcord|equicord|vencord|vesktop|equibop|betterdiscord|nightcord|testcord)\b/i;
const RECOGNIZABLE_PLUGINS: Record<string, string> = {
    CustomRPC: "Custom activities remain public unless they mention a filtered client name.",
    RichPresence: "Extra music and application activities remain public.",
    FakeNitro: "Some emoji and sticker features send recognizable links.",
    StatusCycler: "Custom status changes remain public.",
    ClientTheme: "Custom client colors remain visible in screen captures.",
    BadgeSelector: "Modified local profile badges can remain visible in screen captures.",
    ServerBadges: "Modified local server badges remain visible in screen captures.",
    MessageLoggerEnhanced: "Deleted and edited messages can remain visible in screen captures.",
    IllegalMessageLogger: "Local message logs remain visible in screen captures.",
    ShowHiddenChannels: "Hidden channel entries remain visible in screen captures."
};
const AUDIT_KEYS: Parameters<typeof useSettings>[0] = Object.keys(RECOGNIZABLE_PLUGINS).map((name: string) => `plugins.${name}.enabled` as const);
let restoreInterface: (() => void) | undefined;
let restoreVisuals: (() => void) | undefined;
let restoreSettingsLayout: (() => void) | undefined;
let refreshProfiles: (() => void) | undefined;
let restoreSuspension: (() => void) | undefined;
const commands: VencordCommand[] = [
    { name: "discreet", description: "Toggle discreet mode.", execute: toggleDiscreetMode },
    {
        name: "discreet-settings",
        description: "Show or hide the Illegalcord settings section.",
        execute() { settings.store.hideSettings = !settings.store.hideSettings; }
    }
];

function isSharing() {
    return ApplicationStreamingStore.getCurrentUserActiveStream() != null || StreamerModeStore.enabled;
}

function isInterfaceHidden() {
    if (!isPluginEnabled("DiscreetMode")) return false;
    const { active, hideInterface, manualMode } = settings.plain;
    return active && hideInterface && (manualMode || isSharing());
}

function useInterfaceHidden() {
    const { active, hideInterface, manualMode } = settings.use(INTERFACE_KEYS);
    const { enabled } = useSettings(ENABLED_KEYS).plugins.DiscreetMode;
    const sharing = useStateFromStores([ApplicationStreamingStore, StreamerModeStore], isSharing);
    return enabled && active && hideInterface && (manualMode || sharing);
}

const DiscreetInterface = ErrorBoundary.wrap(function DiscreetInterface({ children }: PropsWithChildren) {
    return useInterfaceHidden() ? null : <>{children}</>;
}, { noop: true });

const ChatBarWrapper = ErrorBoundary.wrap(function ChatBarWrapper({ children }: PropsWithChildren) {
    return <span className={cl("chatbar", { hidden: useInterfaceHidden() })}>{children}</span>;
}, { noop: true });

function wrapButtons(children: ReactNode) {
    return [<DiscreetInterface key="vc-discreet-mode-interface">{children}</DiscreetInterface>];
}

function DiscreetModeAbout() {
    useSettings(AUDIT_KEYS);
    const active = useInterfaceHidden();
    const recognizable = Object.entries(RECOGNIZABLE_PLUGINS).filter(([name]: [string, string]) => isPluginEnabled(name));

    return (
        <>
            <Paragraph>{active ? "The discreet interface is active." : "The discreet interface is visible."}</Paragraph>
            <Paragraph>
                Hide mode hides plugin controls, blocks toasts and pauses running plugin features, including StaffDetector alerts, without reloading Discord.
                Already applied patches can continue to affect messages and other screens in hide mode.
                Suspend mode reloads Discord to remove feature patches and restores your plugin choices with another reload when you leave it.
                Core components, APIs and LarpCord contact replacements remain available. Your enabled plugin choices stay unchanged.
            </Paragraph>
            <Paragraph>
                Chat bar, header and user area plugin buttons are hidden, including Dynamic Island.
                Plugin icons in profiles, messages, member lists and the server list are hidden, including PlatformIndicators and the Questify button.
                Added context menu entries and custom badges are hidden when opened in this mode.
                Illegalcord badges on your own profile and other users' profiles are also hidden locally, including badges added by BadgeSelector.
                LarpCord profile changes are suspended in this mode. Its email and phone replacements remain active.
                PinDMs categories and custom ordering are hidden without deleting your pins.
                StaffDetector name colors, CallTimer timers and BannersEverywhere banners are hidden.
                Version details are hidden in this mode.
            </Paragraph>
            <Paragraph>
                Press the configured shortcut (F6 by default) or use /discreet to hide or restore Illegalcord.
                The shortcut works while Discord is focused, including when its settings section is hidden.
                Reopen settings after toggling to update the sidebar. Use /discreet-settings to change the sidebar preference.
            </Paragraph>
            <Paragraph>
                Themes and crash recovery screens can still reveal modifications.
                Public badges loaded by another user's client must be removed from their public source.
                This plugin cannot erase messages or activities other users have already seen.
            </Paragraph>
            <Paragraph>Enabled plugins with additional effects to review:</Paragraph>
            {recognizable.length ? <ul>{recognizable.map(([name, reason]: [string, string]) => <li key={name}><strong>{name}:</strong> {reason}</li>)}</ul>
                : <Paragraph>No plugins from the review list are enabled.</Paragraph>}
        </>
    );
}

export default definePlugin({
    name: "DiscreetMode",
    description: "Reduces visible client mod clues in activities and screen captures.",
    authors: [EquicordDevs.irritably],
    startAt: StartAt.Init,
    tags: ["Privacy", "Utility"],
    dependencies: ["CommandsAPI", "UserSettingsAPI", "HeaderBarAPI", "UserAreaAPI", "BadgeAPI", "ContextMenuAPI", "NicknameIconsAPI", "MemberListDecoratorsAPI", "MessageDecorationsAPI", "ServerListAPI"],
    settings,
    settingsAboutComponent: ErrorBoundary.wrap(DiscreetModeAbout, { noop: true }),
    patches: [
        {
            find: '"LocalActivityStore"',
            replacement: {
                match: /\.LISTENING.{0,250}?([,:])(?=!?\i\(\)\(\i,\i\))(?<=(\i)\.push.{0,250}?)/,
                replace: "$&$2=$2.filter($self.isActivityAllowed)$1"
            }
        },
        {
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /Vencord\.Api\.HeaderBar\._addHeaderBarButtons\(\)/,
                replace: "$self.wrapButtons($&)"
            }
        },
        {
            find: "Missing channel in Channel.renderHeaderToolbar",
            replacement: {
                match: /Vencord\.Api\.HeaderBar\._addChannelToolbarButtons\((\i)\)/,
                replace: "$self.addToolbarButtons($1)"
            }
        },
        {
            find: "Menu API only allows Items",
            replacement: {
                match: /Vencord\.Api\.ContextMenu\._usePatchContextMenu\((\i)\)/,
                replace: "($self.isInterfaceHidden()?$1:$&)"
            }
        },
        {
            find: 'location:"UserProfileBadgeListRows"',
            replacement: {
                match: /\(0,\i\.\i\)\(\i,\i\)(?=,\{[^}]{0,150}?pendingBadgeDisplayOrder:)/,
                replace: "$self.useBadges($&)"
            }
        },
        {
            find: "#{intl::USER_PROFILE_PRONOUNS}",
            replacement: {
                match: /(?<=\.\.\.)Vencord\.Api\.NicknameIcons\._renderIcons\(\{userId:arguments\[0\]\.user\?\.id\}\)/,
                replace: "$self.wrapButtons($&)"
            }
        },
        {
            find: "#{intl::GUILD_OWNER}),children:",
            replacement: {
                match: /Vencord\.Api\.MemberListDecorators\.__getDecorators\(arguments\[0\],'guild'\)/,
                replace: "$self.wrapButtons($&)"
            }
        },
        {
            find: "PrivateChannel.renderAvatar",
            replacement: {
                match: /Vencord\.Api\.MemberListDecorators\.__getDecorators\(arguments\[0\],'dm'\)/,
                replace: "$self.wrapButtons($&)"
            }
        },
        {
            find: "#{intl::GUILD_COMMUNICATION_DISABLED_ICON_TOOLTIP_BODY}",
            replacement: {
                match: /Vencord\.Api\.MessageDecorations\.__addDecorationsToMessage\(arguments\[0\]\)/,
                replace: "$self.wrapButtons($&)"
            }
        },
        {
            find: "#{intl::DISCODO_DISABLED}",
            replacement: {
                match: /Vencord\.Api\.ServerList\.renderAll\(Vencord\.Api\.ServerList\.ServerListRenderPosition\.Above\)/,
                replace: "$self.wrapButtons($&)"
            }
        },
        {
            find: ".setGuildsTree(",
            replacement: {
                match: /Vencord\.Api\.ServerList\.renderAll\(Vencord\.Api\.ServerList\.ServerListRenderPosition\.(?:In|Below)\)/g,
                replace: "$self.wrapButtons($&)"
            }
        },
        {
            find: ".currentToastMap.has(",
            replacement: {
                match: /(?<=function \i\(\i\)\{)(?=let \i=\i\?\.surface\?\?"app")/,
                replace: "if($self.isDiscreetActive())return;"
            }
        }
    ],
    toolboxActions: { "Toggle discreet interface": toggleDiscreetMode },
    chatBarButtonWrapper: { wrapper: (children: ReactNode) => <ChatBarWrapper>{children}</ChatBarWrapper>, priority: -100 },
    flux: {
        STREAM_CREATE() { refreshProfiles?.(); },
        STREAM_DELETE() { refreshProfiles?.(); },
        STREAMER_MODE_UPDATE() { refreshProfiles?.(); }
    },

    start() {
        window.addEventListener("keydown", handleKeyDown, true);
        restoreVisuals = installVisualPrivacy(isInterfaceHidden, useInterfaceHidden);
        const { buildLayout } = SettingsPlugin;
        SettingsPlugin.buildLayout = builder => {
            if (!settings.plain.active || !settings.plain.hideSettings) return buildLayout.call(SettingsPlugin, builder);
            return builder.buildLayout().filter(node => node.key !== "equicord_section");
        };
        restoreSettingsLayout = () => { SettingsPlugin.buildLayout = buildLayout; };
        const suspension = installPluginSuspension();
        let cancelled = false;
        restoreSuspension = () => {
            cancelled = true;
            suspension.stop();
        };
        void onceReady.then(() => {
            if (cancelled) return;
            suspension.onReady();
            this.startInterface();
        }).catch((error: unknown) => logger.error("Could not initialize the discreet interface.", error));
    },

    startInterface() {
        const larpCordPrivacy = installLarpCordPrivacy(isInterfaceHidden);
        const pinDmsPrivacy = installPinDmsPrivacy(isInterfaceHidden);
        refreshProfiles = () => {
            larpCordPrivacy.refresh();
            pinDmsPrivacy.refresh();
        };
        const { getInfoString, makeInfoElements } = SettingsPlugin;
        const { getBadges } = BadgeAPI;
        const { renderButtons } = UserAreaAPI;

        SettingsPlugin.getInfoString = () => isInterfaceHidden() ? "" : getInfoString.call(SettingsPlugin);
        SettingsPlugin.makeInfoElements = (...args: Parameters<typeof makeInfoElements>) => makeInfoElements.apply(SettingsPlugin, args)
            .map(element => <DiscreetInterface key={element.key}>{element}</DiscreetInterface>);
        BadgeAPI.getBadges = (profile: Parameters<typeof getBadges>[0]) => isInterfaceHidden() ? [] : getBadges.call(BadgeAPI, profile);
        UserAreaAPI.renderButtons = (props: Parameters<typeof renderButtons>[0]) => wrapButtons(renderButtons.call(UserAreaAPI, props));
        restoreInterface = () => {
            for (const command of commands) unregisterCommand(command.name);
            larpCordPrivacy.stop();
            pinDmsPrivacy.stop();
            refreshProfiles = undefined;
            SettingsPlugin.getInfoString = getInfoString;
            SettingsPlugin.makeInfoElements = makeInfoElements;
            BadgeAPI.getBadges = getBadges;
            UserAreaAPI.renderButtons = renderButtons;
        };
        for (const command of commands) registerCommand(command, this.name);
        refreshActivities();
    },

    stop() {
        restoreSuspension?.();
        restoreSuspension = undefined;
        window.removeEventListener("keydown", handleKeyDown, true);
        restoreInterface?.();
        restoreInterface = undefined;
        restoreVisuals?.();
        restoreVisuals = undefined;
        restoreSettingsLayout?.();
        restoreSettingsLayout = undefined;
        refreshActivities();
    },

    isInterfaceHidden,
    wrapButtons,

    isDiscreetActive() {
        return isPluginEnabled("DiscreetMode") && settings.plain.active;
    },

    useBadges(badges: Array<ProfileBadge & { icon?: string; }>) {
        const hidden = useInterfaceHidden();
        return hidden ? badges.filter(badge => ![
            badge.id.replaceAll("_", " "), badge.description, badge.iconSrc, badge.icon, badge.link
        ].some((text: string | undefined) => text != null && CLIENT_NAMES.test(text))) : badges;
    },

    addToolbarButtons(toolbar: ReactNode[]) {
        const buttons: ReactNode[] = [];
        _addChannelToolbarButtons(buttons);
        toolbar.push(...wrapButtons(buttons));
    },

    isActivityAllowed(activity: Activity) {
        if (!isPluginEnabled("DiscreetMode") || !settings.plain.active || !settings.plain.hideBrandedActivities) return true;
        return ![
            activity.name, activity.details, activity.state, activity.url, activity.details_url, activity.state_url,
            ...Object.values(activity.assets ?? {}), ...activity.buttons ?? [], ...activity.metadata?.button_urls ?? []
        ].some((text: string | undefined) => text != null && CLIENT_NAMES.test(text));
    }
});
