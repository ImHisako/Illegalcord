/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType } from "@api/Commands";
import { importSettings } from "@api/SettingsSync/offline";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import { isObject, parseUrl } from "@utils/misc";
import definePlugin from "@utils/types";
import type { Message, MessageAttachment } from "@vencord/discord-types";
import { Button, ChannelStore, ConfirmModal, DraftType, openModal, showToast, Toasts, UploadHandler } from "@webpack/common";

const FILE_NAME = "illegalcord-config.json";
const FORMAT = "illegalcord-shared-config";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const SENSITIVE_KEYS = /(?:api.?keys?|tokens?|secrets?|passwords?|passphrases?|credentials?|webhooks?(?:.?urls?)?|cookies?|authorization|bearer|sessions?|userhash|usernames?|userids?)$/i;
const SENSITIVE_VALUES = /(?:discord(?:app)?\.com\/api\/webhooks\/\d+\/[^\s"']+|[?&](?:api.?key|token|secret|password|auth)=[^&\s"']+|https?:\/\/[^/\s:@]+:[^@\s/]+@)/i;
const PRIVATE_SETTING_PATHS = new Set([
    "cloud",
    "themeLinks",
    "enabledThemeLinks",
    "pinnedThemes",
    "plugins.Stalker.targets",
    "plugins.Surveillance.targets",
    "plugins.Surveillance.serverTargets",
    "plugins.OSINTToolkit.cordCatApiKey",
    "plugins.OSINTToolkit.geoSeeerApiKey",
    "plugins.AnonLi.apiKey",
    "plugins.MultiInstance.instances",
    "plugins.StatusCycler.accountStates",
    "plugins.NitroSniper",
    "plugins.NitroSniper Nighty Ver",
    "plugins.FileUpload.sharexConfig",
    "plugins.WebCordHardened.proxy",
    "plugins.WebCordHardened.proxyRules",
    "plugins.WebCordHardened.proxyBypassRules",
    "plugins.DiscordHardened.proxy",
    "plugins.DiscordHardened.proxyRules",
    "plugins.DiscordHardened.proxyBypassRules"
]);
const logger = new Logger("ShareClientConfig");

interface SharedConfig {
    format: typeof FORMAT;
    version: 2;
    createdAt: string;
    settings: object;
    omitted: string[];
}

function isSensitive(key: string, value: unknown, path: string): boolean {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const canContainSecret = typeof value === "string" || isObject(value) || Array.isArray(value);
    return PRIVATE_SETTING_PATHS.has(path)
        || path !== "plugins" && (
            canContainSecret && SENSITIVE_KEYS.test(normalizedKey)
            || canContainSecret && /(?:key|keyid)$/.test(normalizedKey) && !/(?:hotkey|keybind)$/.test(normalizedKey)
            || typeof value === "string" && SENSITIVE_VALUES.test(value)
        );
}

function sanitizeObject(input: object, path: string, omitted: string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
        const currentPath = path ? `${path}.${key}` : key;
        if (isSensitive(key, value, currentPath)) {
            omitted.push(currentPath);
            continue;
        }

        result[key] = sanitizeValue(value, currentPath, omitted);
    }

    return result;
}

function sanitizeValue(value: unknown, path: string, omitted: string[]): unknown {
    if (Array.isArray(value)) return value.flatMap((item, index) => {
        const itemPath = `${path}.${index}`;
        if (typeof item === "string" && SENSITIVE_VALUES.test(item)) {
            omitted.push(itemPath);
            return [];
        }

        return [sanitizeValue(item, itemPath, omitted)];
    });
    if (isObject(value)) return sanitizeObject(value, path, omitted);
    return value;
}

function createSharedConfig(): string {
    const omitted: string[] = [];
    const settings = sanitizeObject(VencordNative.settings.get(), "", omitted);

    const config: SharedConfig = {
        format: FORMAT,
        version: 2,
        createdAt: new Date().toISOString(),
        settings,
        omitted
    };

    return JSON.stringify(config);
}

function isSharedConfig(value: unknown): value is SharedConfig {
    return isObject(value)
        && "format" in value && value.format === FORMAT
        && "version" in value && value.version === 2
        && "settings" in value && isObject(value.settings)
        && "omitted" in value && Array.isArray(value.omitted) && value.omitted.every(item => typeof item === "string");
}

function isDiscordAttachment(url: string): boolean {
    const parsed = parseUrl(url);
    return parsed?.origin === "https://cdn.discordapp.com" && parsed.pathname.startsWith("/attachments/");
}

async function applySharedConfig(attachment: MessageAttachment): Promise<void> {
    try {
        if (attachment.size > MAX_FILE_SIZE || !isDiscordAttachment(attachment.url)) throw new Error("Invalid attachment.");

        const response = await fetch(attachment.url, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error("Failed to download the configuration.");

        const text = await response.text();
        if (text.length > MAX_FILE_SIZE) throw new Error("The configuration file is too large.");

        const parsed: unknown = JSON.parse(text);
        if (!isSharedConfig(parsed)) throw new Error("Invalid configuration format.");

        const settings = sanitizeObject(parsed.settings, "", []);
        await importSettings(JSON.stringify({ settings }), "plugins");
        showToast("Configuration applied. Restart Illegalcord to finish applying the changes.", Toasts.Type.SUCCESS);
    } catch (error) {
        logger.error("Failed to import shared configuration", error);
        showToast(error instanceof Error ? error.message : "Failed to import the configuration.", Toasts.Type.FAILURE);
    }
}

function openImportConfirmation(attachment: MessageAttachment, author: string) {
    openModal(props => (
        <ConfirmModal
            {...props}
            title="Apply this configuration?"
            confirmText="Apply"
            cancelText="Cancel"
            onConfirm={() => void applySharedConfig(attachment)}
        >
            <Paragraph>
                This will import {attachment.filename} shared by {author}, including which plugins are enabled.
                Your API keys and other recognized sensitive values will not be replaced. Restart Illegalcord after applying the configuration.
            </Paragraph>
        </ConfirmModal>
    ));
}

interface ConfigAccessoryProps {
    message?: Message;
}

const ConfigAccessory = ErrorBoundary.wrap(function ConfigAccessory({ message }: ConfigAccessoryProps) {
    if (!message) return null;
    const attachments = message.attachments.filter((attachment: MessageAttachment) => attachment.filename === FILE_NAME);
    if (!attachments.length) return null;

    return <>
        {attachments.map((attachment: MessageAttachment) => (
            <div key={attachment.id} className={Margins.top8}>
                <Button
                    size={Button.Sizes.SMALL}
                    onClick={() => openImportConfirmation(attachment, message.author.username)}
                >
                    Apply Illegalcord configuration
                </Button>
            </div>
        ))}
    </>;
}, { noop: true });

function ConfigIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M4 3h12l4 4v14H4V3Zm11 2v3h3l-3-3ZM7 12h10v-2H7v2Zm0 4h10v-2H7v2Zm0 4h7v-2H7v2Z" />
        </svg>
    );
}

export default definePlugin({
    name: "ShareClientConfig",
    description: "Share your Illegalcord configuration in chat without API keys or other sensitive values.",
    authors: [EquicordDevs.irritably],
    tags: ["Chat", "Privacy", "Utility"],
    dependencies: ["CommandsAPI", "MessageAccessoriesAPI", "MessagePopoverAPI"],

    settingsAboutComponent() {
        return (
            <>
                <Heading tag="h3">How ShareClientConfig works</Heading>
                <Paragraph>
                    Share your Illegalcord and plugin settings through a chat attachment.
                    ShareClientConfig must be enabled in each client to create or apply a configuration.
                </Paragraph>
                <Heading tag="h4">1. Share your configuration</Heading>
                <Paragraph>
                    Open the chat you want to share in and run <code>/share-config</code>.
                    The plugin prepares <code>{FILE_NAME}</code> and opens the Discord upload dialog.
                    You confirm sending the attachment yourself. The command does not send the message automatically.
                    The maximum file size is 5 MiB.
                </Paragraph>
                <Heading tag="h4">2. Apply a shared configuration</Heading>
                <Paragraph>
                    Click <strong>Apply Illegalcord configuration</strong> below the message containing <code>{FILE_NAME}</code>.
                    You can also use the same action in the message action bar.
                    Confirm with <strong>Apply</strong>, wait for the success message, then restart Illegalcord.
                    Keep the original attachment filename so the plugin can recognize it.
                </Paragraph>
                <Heading tag="h4">3. What changes in your client</Heading>
                <Paragraph>
                    Values in the file replace the corresponding settings, including which plugins are enabled.
                    Settings absent from the file stay unchanged. Missing plugins are not installed, and QuickCSS,
                    theme files, and data stored separately by plugins are not transferred.
                    You can save a backup from the Illegalcord settings before applying a configuration.
                </Paragraph>
                <Heading tag="h4">4. Which data is excluded</Heading>
                <Paragraph>
                    The plugin filters fields recognized as sensitive, such as API keys, tokens, passwords, and webhooks.
                    It also excludes selected private settings, cloud configuration, and theme lists.
                    Filtering also runs during import, so excluded values do not replace your local ones.
                    Detection relies on field names and known patterns and cannot guarantee that every personal detail is found.
                    Review the file contents before sharing it.
                </Paragraph>
            </>
        );
    },

    commands: [{
        name: "share-config",
        description: "Prepare your Illegalcord configuration for sharing without sensitive data.",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute(_args, context) {
            try {
                const data = createSharedConfig();
                if (data.length > MAX_FILE_SIZE) throw new Error("The configuration is too large to share.");

                const file = new File([data], FILE_NAME, { type: "application/json" });
                setTimeout(() => UploadHandler.promptToUpload([file], context.channel, DraftType.ChannelMessage), 10);
            } catch (error) {
                logger.error("Failed to prepare shared configuration", error);
                showToast(error instanceof Error ? error.message : "Failed to prepare the configuration.", Toasts.Type.FAILURE);
            }
        }
    }],

    renderMessageAccessory: (props: ConfigAccessoryProps) => <ConfigAccessory {...props} />,

    messagePopoverButton: {
        icon: ConfigIcon,
        render(message) {
            const attachment = message.attachments.find(item => item.filename === FILE_NAME);
            if (!attachment) return null;

            return {
                label: "Apply Illegalcord configuration",
                icon: ConfigIcon,
                message,
                channel: ChannelStore.getChannel(message.channel_id),
                onClick: () => openImportConfirmation(attachment, message.author.username)
            };
        }
    }
});
