/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { sendBotMessage } from "@api/Commands";
import { addMessagePreSendListener, MessageSendListener, removeMessagePreSendListener } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";

interface IMessageCreate {
    type: "MESSAGE_CREATE";
    optimistic: boolean;
    isPushNotification: boolean;
    channelId: string;
    message: Message;
}

const SECURITY_CONSTANTS = {
    DEFAULT_MIN_PASSWORD_LENGTH: 12,
    MAX_PASSWORD_LENGTH: 128,
    MIN_PBKDF2_ITERATIONS: 100000,
    MAX_PBKDF2_ITERATIONS: 600000,
    LEGACY_PBKDF2_ITERATIONS: 200000,
    SALT_LENGTH: 32,
    IV_LENGTH: 12,
    ITERATION_LENGTH: 4,
    VERSION_LEGACY: 1,
    VERSION_CURRENT: 2,
    ENCRYPTION_MARKER_START: "🔒SECURE:",
    ENCRYPTION_MARKER_END: ":ENDSECURE",
    MAX_DISCORD_MESSAGE_LENGTH: 2000,
    DEFAULT_MAX_PLAINTEXT_BYTES: 1400,
    MILLISECONDS_PER_MINUTE: 60000,
    GCM_ADDITIONAL_DATA: "Securecord:v2"
};

const logger = new Logger("Securecord");
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const specialCharacterPattern = /[^A-Za-z0-9]/;

let failedAttempts = 0;
let lockoutEndTime = 0;
let lastDecryptionAttempt = 0;
let messageSendListener: MessageSendListener | null = null;
let autoLockTimer: ReturnType<typeof setTimeout> | null = null;
let lastActivityChannelId: string | null = null;

function validatePassword(password: string): string[] {
    const errors: string[] = [];

    if (!password) {
        errors.push("Password is required");
        return errors;
    }

    const minLength = settings.store.strictPasswordPolicy
        ? settings.store.minPasswordLength
        : 1;

    if (password.length < minLength) {
        errors.push(`Password must be at least ${minLength} characters long`);
    }

    if (password.length > SECURITY_CONSTANTS.MAX_PASSWORD_LENGTH) {
        errors.push(`Password must be no more than ${SECURITY_CONSTANTS.MAX_PASSWORD_LENGTH} characters long`);
    }

    if (!settings.store.strictPasswordPolicy) {
        return errors;
    }

    if (!/[A-Z]/.test(password)) {
        errors.push("Password must contain at least one uppercase letter");
    }

    if (!/[a-z]/.test(password)) {
        errors.push("Password must contain at least one lowercase letter");
    }

    if (!/\d/.test(password)) {
        errors.push("Password must contain at least one number");
    }

    if (!specialCharacterPattern.test(password)) {
        errors.push("Password must contain at least one special character");
    }

    return errors;
}

function isRateLimited(): boolean {
    if (!settings.store.maxFailedAttempts || !settings.store.lockoutMinutes) return false;

    const now = Date.now();
    const lockoutDuration = settings.store.lockoutMinutes * SECURITY_CONSTANTS.MILLISECONDS_PER_MINUTE;

    if (lockoutEndTime > now) {
        return true;
    }

    if (now - lastDecryptionAttempt > lockoutDuration) {
        failedAttempts = 0;
        lockoutEndTime = 0;
    }

    return false;
}

function recordFailedAttempt(): void {
    if (!settings.store.maxFailedAttempts || !settings.store.lockoutMinutes) return;

    failedAttempts++;
    lastDecryptionAttempt = Date.now();

    if (failedAttempts >= settings.store.maxFailedAttempts) {
        lockoutEndTime = Date.now() + settings.store.lockoutMinutes * SECURITY_CONSTANTS.MILLISECONDS_PER_MINUTE;
    }
}

function resetSecurityState(): void {
    failedAttempts = 0;
    lockoutEndTime = 0;
    lastDecryptionAttempt = 0;
}

function logInfo(...args: unknown[]) {
    if (settings.store.enableLogging) logger.info(...args);
}

function logError(...args: unknown[]) {
    if (settings.store.enableLogging) logger.error(...args);
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getPbkdf2Iterations(): number {
    const iterations = Number(settings.store.pbkdf2Iterations);
    if (!Number.isFinite(iterations)) return SECURITY_CONSTANTS.LEGACY_PBKDF2_ITERATIONS;

    return Math.min(
        SECURITY_CONSTANTS.MAX_PBKDF2_ITERATIONS,
        Math.max(SECURITY_CONSTANTS.MIN_PBKDF2_ITERATIONS, Math.trunc(iterations))
    );
}

function isEncryptedMessage(content: string): boolean {
    return content.startsWith(SECURITY_CONSTANTS.ENCRYPTION_MARKER_START) &&
        content.endsWith(SECURITY_CONSTANTS.ENCRYPTION_MARKER_END);
}

function getEncryptedPart(content: string): string {
    return content.slice(
        SECURITY_CONSTANTS.ENCRYPTION_MARKER_START.length,
        -SECURITY_CONSTANTS.ENCRYPTION_MARKER_END.length
    );
}

function bytesToBase64(bytes: Uint8Array, urlSafe: boolean): string {
    let binary = "";

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    const base64 = btoa(binary);
    if (!urlSafe) return base64;

    return base64
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
}

function base64ToBytes(value: string): Uint8Array {
    let base64 = value.trim().replace(/-/g, "+").replace(/_/g, "/");

    while (base64.length % 4 !== 0) {
        base64 += "=";
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

function writeUint32(value: number): Uint8Array {
    const bytes = new Uint8Array(SECURITY_CONSTANTS.ITERATION_LENGTH);
    bytes[0] = value >>> 24;
    bytes[1] = value >>> 16;
    bytes[2] = value >>> 8;
    bytes[3] = value;
    return bytes;
}

function readUint32(bytes: Uint8Array, offset: number): number {
    return (
        (bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]
    ) >>> 0;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}

async function deriveAESKey(password: string, salt: Uint8Array, iterations: number, usages: KeyUsage[]): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        toArrayBuffer(encoder.encode(password)),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: toArrayBuffer(salt),
            iterations,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        usages
    );
}

async function encryptAES(text: string, password: string): Promise<string> {
    const data = encoder.encode(text);
    const validationErrors = validatePassword(password);

    if (validationErrors.length) {
        throw new Error(`Password validation failed: ${validationErrors.join(", ")}`);
    }

    if (settings.store.maxPlaintextBytes > 0 && data.length > settings.store.maxPlaintextBytes) {
        throw new Error(`Message is too long to encrypt. Limit is ${settings.store.maxPlaintextBytes} bytes.`);
    }

    const iterations = getPbkdf2Iterations();
    const salt = crypto.getRandomValues(new Uint8Array(SECURITY_CONSTANTS.SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(SECURITY_CONSTANTS.IV_LENGTH));
    const key = await deriveAESKey(password, salt, iterations, ["encrypt"]);

    const encrypted = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: toArrayBuffer(iv),
            additionalData: toArrayBuffer(encoder.encode(SECURITY_CONSTANTS.GCM_ADDITIONAL_DATA))
        },
        key,
        toArrayBuffer(data)
    );

    const version = new Uint8Array([SECURITY_CONSTANTS.VERSION_CURRENT]);
    const iterationBytes = writeUint32(iterations);
    const encryptedBytes = new Uint8Array(encrypted);
    const result = new Uint8Array(
        version.length +
        iterationBytes.length +
        salt.length +
        iv.length +
        encryptedBytes.length
    );

    let offset = 0;
    result.set(version, offset);
    offset += version.length;
    result.set(iterationBytes, offset);
    offset += iterationBytes.length;
    result.set(salt, offset);
    offset += salt.length;
    result.set(iv, offset);
    offset += iv.length;
    result.set(encryptedBytes, offset);

    const encryptedMessage = bytesToBase64(result, settings.store.urlSafeBase64);
    const wrappedMessage = `${SECURITY_CONSTANTS.ENCRYPTION_MARKER_START}${encryptedMessage}${SECURITY_CONSTANTS.ENCRYPTION_MARKER_END}`;

    if (wrappedMessage.length > SECURITY_CONSTANTS.MAX_DISCORD_MESSAGE_LENGTH) {
        throw new Error("Encrypted message is too long for Discord.");
    }

    return encryptedMessage;
}

async function decryptAES(encrypted: string, password: string): Promise<string> {
    const data = base64ToBytes(encrypted);
    const minLegacyLength = 1 + SECURITY_CONSTANTS.SALT_LENGTH + SECURITY_CONSTANTS.IV_LENGTH;

    if (data.length < minLegacyLength) {
        throw new Error("Invalid encrypted data format.");
    }

    let offset = 0;
    const version = data[offset];
    offset += 1;

    let iterations = SECURITY_CONSTANTS.LEGACY_PBKDF2_ITERATIONS;
    let additionalData: ArrayBuffer | undefined;

    if (version === SECURITY_CONSTANTS.VERSION_CURRENT) {
        const minCurrentLength = minLegacyLength + SECURITY_CONSTANTS.ITERATION_LENGTH;
        if (data.length < minCurrentLength) {
            throw new Error("Invalid encrypted data format.");
        }

        iterations = readUint32(data, offset);
        offset += SECURITY_CONSTANTS.ITERATION_LENGTH;
        additionalData = toArrayBuffer(encoder.encode(SECURITY_CONSTANTS.GCM_ADDITIONAL_DATA));
    } else if (version !== SECURITY_CONSTANTS.VERSION_LEGACY || !settings.store.acceptLegacyPayloads) {
        throw new Error("Unsupported encryption version.");
    }

    if (
        iterations < SECURITY_CONSTANTS.MIN_PBKDF2_ITERATIONS ||
        iterations > SECURITY_CONSTANTS.MAX_PBKDF2_ITERATIONS
    ) {
        throw new Error("Invalid encryption parameters.");
    }

    const salt = data.slice(offset, offset + SECURITY_CONSTANTS.SALT_LENGTH);
    offset += SECURITY_CONSTANTS.SALT_LENGTH;
    const iv = data.slice(offset, offset + SECURITY_CONSTANTS.IV_LENGTH);
    offset += SECURITY_CONSTANTS.IV_LENGTH;
    const encryptedData = data.slice(offset);
    const key = await deriveAESKey(password, salt, iterations, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData },
        key,
        toArrayBuffer(encryptedData)
    );

    resetSecurityState();
    return decoder.decode(decrypted);
}

function clearAutoLockTimer() {
    if (!autoLockTimer) return;

    clearTimeout(autoLockTimer);
    autoLockTimer = null;
}

function scheduleAutoLock(channelId?: string) {
    clearAutoLockTimer();

    if (channelId) lastActivityChannelId = channelId;
    if (!settings.store.enableEncryption || settings.store.autoLockTimeout <= 0) return;

    autoLockTimer = setTimeout(() => {
        settings.store.enableEncryption = false;
        logInfo("Encryption auto locked.");

        if (settings.store.notifyOnAutoLock && lastActivityChannelId) {
            sendBotMessage(lastActivityChannelId, {
                content: "🔐 Encryption auto disabled after inactivity."
            });
        }
    }, settings.store.autoLockTimeout * SECURITY_CONSTANTS.MILLISECONDS_PER_MINUTE);
}

function formatDecryptedMessage(message: Message, decryptedMessage: string) {
    if (!settings.store.showAuthorInDecryptedMessages) {
        return `🔐 **Decrypted message**: ${decryptedMessage}`;
    }

    return `🔐 **Decrypted message from ${message.author.username}**: ${decryptedMessage}`;
}

const EncryptionEnabledIcon: IconComponent = ({ height = 20, width = 20, className }) => {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            className={className}
        >
            <path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM8.9 6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2H8.9V6z" />
        </svg>
    );
};

const EncryptionDisabledIcon: IconComponent = ({ height = 20, width = 20, className }) => {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            className={className}
        >
            <path fill="currentColor" d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" />
        </svg>
    );
};

const EncryptionToggleButton: ChatBarButtonFactory = ({ channel, type }) => {
    const { enableEncryption } = settings.use();

    const validChat = ["normal", "sidebar"].some(x => type.analyticsName === x);

    if (!validChat) return null;

    return (
        <ChatBarButton
            tooltip={enableEncryption ? "Disable Encryption" : "Enable Encryption"}
            onClick={() => {
                const newValue = !enableEncryption;
                settings.store.enableEncryption = newValue;
                scheduleAutoLock(channel.id);

                if (settings.store.notifyOnToggle) {
                    sendBotMessage(
                        channel.id,
                        {
                            content: `🔐 Encryption ${newValue ? "enabled" : "disabled"}!${newValue ? "\n⚠️ Share your password only with trusted contacts." : ""}`
                        }
                    );
                }
            }}
        >
            {enableEncryption ? <EncryptionEnabledIcon /> : <EncryptionDisabledIcon />}
        </ChatBarButton>
    );
};

const settings = definePluginSettings({
    encryptionPassword: {
        type: OptionType.STRING,
        description: "AES-256 encryption password shared with trusted users.",
        default: "",
        placeholder: "Enter strong shared password...",
        onChange(newValue: string) {
            if (newValue) {
                const errors = validatePassword(newValue);
                if (errors.length) logInfo("Password validation failed.", errors.join(", "));
            }

            resetSecurityState();
        }
    },
    enableEncryption: {
        type: OptionType.BOOLEAN,
        description: "Encrypt outgoing messages.",
        default: false
    },
    autoDecrypt: {
        type: OptionType.BOOLEAN,
        description: "Show decrypted Securecord messages automatically.",
        default: true
    },
    strictPasswordPolicy: {
        type: OptionType.BOOLEAN,
        description: "Require uppercase, lowercase, number and special character in the password.",
        default: true
    },
    minPasswordLength: {
        type: OptionType.SLIDER,
        description: "Minimum password length when strict policy is enabled.",
        markers: [8, 12, 16, 20, 24, 32],
        default: SECURITY_CONSTANTS.DEFAULT_MIN_PASSWORD_LENGTH,
        stickToMarkers: true
    },
    pbkdf2Iterations: {
        type: OptionType.SELECT,
        description: "PBKDF2 iterations for new encrypted messages.",
        options: [
            { label: "Balanced 200k", value: 200000, default: true },
            { label: "Stronger 310k", value: 310000 },
            { label: "Very strong 600k", value: 600000 },
            { label: "Compatibility 100k", value: 100000 }
        ]
    },
    maxPlaintextBytes: {
        type: OptionType.NUMBER,
        description: "Maximum plaintext size in bytes before encryption. Use 0 to disable.",
        default: SECURITY_CONSTANTS.DEFAULT_MAX_PLAINTEXT_BYTES,
        onChange(newValue: number) {
            if (newValue < 0) settings.store.maxPlaintextBytes = 0;
        }
    },
    blockUploadsWhileEncrypted: {
        type: OptionType.BOOLEAN,
        description: "Block file uploads while encryption is enabled.",
        default: true
    },
    cancelOnEncryptionError: {
        type: OptionType.BOOLEAN,
        description: "Block plaintext sending when encryption fails.",
        default: true
    },
    encryptEmptyMessages: {
        type: OptionType.BOOLEAN,
        description: "Encrypt blank or whitespace only messages.",
        default: false
    },
    urlSafeBase64: {
        type: OptionType.BOOLEAN,
        description: "Use URL-safe base64 for new encrypted payloads.",
        default: true
    },
    acceptLegacyPayloads: {
        type: OptionType.BOOLEAN,
        description: "Allow decrypting older Securecord version 1 payloads.",
        default: true
    },
    maxFailedAttempts: {
        type: OptionType.SLIDER,
        description: "Failed decrypt attempts before lockout. Use 0 to disable.",
        markers: [0, 3, 5, 8, 10],
        default: 5,
        stickToMarkers: true
    },
    lockoutMinutes: {
        type: OptionType.SLIDER,
        description: "Minutes to pause decrypt attempts after lockout. Use 0 to disable.",
        markers: [0, 1, 5, 10, 30],
        default: 5,
        stickToMarkers: true
    },
    autoLockTimeout: {
        type: OptionType.SLIDER,
        description: "Auto-disable encryption after minutes of inactivity. Use 0 to disable.",
        markers: [0, 5, 15, 30, 60, 240],
        default: 30,
        stickToMarkers: true,
        onChange() {
            scheduleAutoLock();
        }
    },
    showAuthorInDecryptedMessages: {
        type: OptionType.BOOLEAN,
        description: "Include the sender name in decrypted Clyde messages.",
        default: true
    },
    showDecryptErrors: {
        type: OptionType.BOOLEAN,
        description: "Show Clyde messages when decryption fails.",
        default: true
    },
    showDetailedDecryptErrors: {
        type: OptionType.BOOLEAN,
        description: "Show detailed decrypt errors instead of a generic warning.",
        default: false
    },
    notifyOnToggle: {
        type: OptionType.BOOLEAN,
        description: "Show a Clyde message when encryption is toggled.",
        default: true
    },
    notifyOnEncrypt: {
        type: OptionType.BOOLEAN,
        description: "Show a Clyde message after encrypting an outgoing message.",
        default: false
    },
    notifyOnEncryptionFailure: {
        type: OptionType.BOOLEAN,
        description: "Show a Clyde message when outgoing encryption fails.",
        default: true
    },
    notifyOnAutoLock: {
        type: OptionType.BOOLEAN,
        description: "Show a Clyde message when auto lock disables encryption.",
        default: true
    },
    enableLogging: {
        type: OptionType.BOOLEAN,
        description: "Enable debug logs.",
        default: false
    }
});

export default definePlugin({
    name: "Securecord",
    description: "AES-256 end-to-end encryption for Discord. Share the same password with other users to communicate securely.",
    tags: ["Privacy", "Chat"],
    authors: [{ name: "irritably", id: 928787166916640838n }],
    settings,
    chatBarButton: {
        icon: EncryptionEnabledIcon,
        render: EncryptionToggleButton
    },

    flux: {
        async MESSAGE_CREATE({ optimistic, type, message, channelId }: IMessageCreate) {
            if (optimistic || type !== "MESSAGE_CREATE") return;
            if (message.state === "SENDING") return;
            if (!settings.store.autoDecrypt || !message.content || !isEncryptedMessage(message.content)) return;

            logInfo("Received encrypted message from", message.author.username);

            if (isRateLimited()) {
                const remainingTime = Math.ceil((lockoutEndTime - Date.now()) / SECURITY_CONSTANTS.MILLISECONDS_PER_MINUTE);
                if (settings.store.showDecryptErrors) {
                    sendBotMessage(channelId, {
                        content: `🔒 Too many failed decryption attempts. Try again in ${remainingTime} minutes.`
                    });
                }
                return;
            }

            const password = settings.store.encryptionPassword;
            if (!password) {
                logInfo("No password set.");
                return;
            }

            try {
                const decryptedMessage = await decryptAES(getEncryptedPart(message.content), password);
                sendBotMessage(channelId, {
                    content: formatDecryptedMessage(message, decryptedMessage)
                });
                scheduleAutoLock(channelId);
                logInfo("Sent decrypted message.");
            } catch (error) {
                const errorMessage = getErrorMessage(error);
                recordFailedAttempt();
                logError("Decryption error:", errorMessage);

                if (settings.store.showDecryptErrors) {
                    sendBotMessage(channelId, {
                        content: settings.store.showDetailedDecryptErrors
                            ? `🔒 Decryption failed for message from ${message.author.username}. ${errorMessage}`
                            : `🔒 Decryption failed for message from ${message.author.username}. Check password or try again later.`
                    });
                }
            }
        },
    },

    start() {
        messageSendListener = async (channelId, message, options) => {
            if (!settings.store.enableEncryption) return;
            scheduleAutoLock(channelId);

            if (settings.store.blockUploadsWhileEncrypted && options.uploads?.length) {
                sendBotMessage(channelId, {
                    content: "❌ File uploads are not encrypted by Securecord and were blocked."
                });
                return { cancel: true };
            }

            if (!message.content || isEncryptedMessage(message.content)) return;
            if (!settings.store.encryptEmptyMessages && !message.content.trim()) return;

            const password = settings.store.encryptionPassword;
            if (!password) {
                if (settings.store.notifyOnEncryptionFailure) {
                    sendBotMessage(channelId, {
                        content: "❌ No encryption password set in plugin settings."
                    });
                }
                return { cancel: settings.store.cancelOnEncryptionError };
            }

            try {
                const encryptedMessage = await encryptAES(message.content, password);
                message.content = `${SECURITY_CONSTANTS.ENCRYPTION_MARKER_START}${encryptedMessage}${SECURITY_CONSTANTS.ENCRYPTION_MARKER_END}`;

                if (settings.store.notifyOnEncrypt) {
                    sendBotMessage(channelId, {
                        content: "🔐 Message encrypted."
                    });
                }

                logInfo("Message encrypted.");
            } catch (error) {
                const errorMessage = getErrorMessage(error);
                logError("Message encryption error:", errorMessage);

                if (settings.store.notifyOnEncryptionFailure) {
                    sendBotMessage(channelId, {
                        content: `❌ Message encryption failed. ${settings.store.cancelOnEncryptionError ? "The plaintext message was not sent." : "Check your password settings."}`
                    });
                }

                return { cancel: settings.store.cancelOnEncryptionError };
            }
        };

        addMessagePreSendListener(messageSendListener);
        scheduleAutoLock();
        logInfo("Plugin loaded successfully.");
    },

    stop() {
        if (messageSendListener) {
            removeMessagePreSendListener(messageSendListener);
            messageSendListener = null;
        }

        clearAutoLockTimer();
        resetSecurityState();
        logInfo("Plugin stopped and security state reset.");
    }
});
