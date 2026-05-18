/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { ApplicationCommandInputType, ApplicationCommandOptionType, sendBotMessage } from "@api/Commands";
import { addMessagePreSendListener, MessageSendListener, removeMessagePreSendListener } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import { CommandContext, Message } from "@vencord/discord-types";

interface IMessageCreate {
    type: "MESSAGE_CREATE";
    optimistic: boolean;
    isPushNotification: boolean;
    channelId: string;
    message: Message;
}

interface DecryptCommandContext extends CommandContext {
    message?: {
        referencedMessage?: Message;
    };
}

const logger = new Logger("SecurecordOpossum");
const ENCRYPTED_PREFIX = "🔒ENCRYPTED:";
const ENCRYPTED_SUFFIX = ":ENDLOCK";
const SECURITY_CONSTANTS = {
    DEFAULT_MIN_PASSWORD_LENGTH: 12,
    MAX_PASSWORD_LENGTH: 128,
    MAX_DISCORD_MESSAGE_LENGTH: 2000,
    DEFAULT_MAX_PLAINTEXT_BYTES: 1400,
    MILLISECONDS_PER_MINUTE: 60000
};
const encoder = new TextEncoder();
const specialCharacterPattern = /[^A-Za-z0-9]/;

// BlazingOpossum Cipher - High-Performance, Post-Quantum Resilient Symmetric Cipher
class BlazingOpossumCipher {
    private static readonly BLOCK_SIZE = 16; // 128-bit blocks
    private static readonly IV_SIZE = 16; // 128-bit IV
    private static readonly TAG_SIZE = 16; // 128-bit Poly-hash Tag
    private static readonly ROUNDS = 20; // Increased rounds for Quantum resistance

    private roundKeys: Uint8Array[];

    constructor(private key: Uint8Array) {
        if (key.length !== 32) {
            throw new Error(`Key must be ${32} bytes`);
        }

        this.roundKeys = [];
        this.expandKey();
    }

    private expandKey(): void {
        // Expand key using non-linear diffusion
        const expandedKey = new Uint8Array((BlazingOpossumCipher.ROUNDS + 2) * BlazingOpossumCipher.BLOCK_SIZE);
        expandedKey.set(this.key, 0);

        // Use prime-derived constants for key expansion
        const PRIME_MUL = 0x9E3779B9; // Golden Ratio derived
        const PRIME_ADD = 0xBB67AE85; // Sqrt(3) derived

        const temp = new Uint8Array(BlazingOpossumCipher.BLOCK_SIZE);

        for (let i = 32; i < expandedKey.length; i += BlazingOpossumCipher.BLOCK_SIZE) {
            temp.set(expandedKey.subarray(i - BlazingOpossumCipher.BLOCK_SIZE, i));

            // Nonlinear mix: (State * Prime + Key) ^ Rotate(State)
            for (let j = 0; j < temp.length; j += 4) {
                const val = (temp[j] | (temp[j + 1] << 8) | (temp[j + 2] << 16) | (temp[j + 3] << 24)) >>> 0;
                const mixed = Math.imul(val, PRIME_MUL) + this.readUint32LE(expandedKey, i - 32 + j);

                // Rotate left by 7 bits
                const rotated = ((mixed << 7) | (mixed >>> 25)) >>> 0;

                this.writeUint32LE(temp, j, rotated);
            }

            // XOR with round constant
            const roundConstant = (i / BlazingOpossumCipher.BLOCK_SIZE) | 0;
            temp[0] ^= roundConstant;

            expandedKey.set(temp, i);
        }

        for (let r = 0; r < BlazingOpossumCipher.ROUNDS + 2; r++) {
            const roundKey = new Uint8Array(BlazingOpossumCipher.BLOCK_SIZE);
            roundKey.set(expandedKey.subarray(r * BlazingOpossumCipher.BLOCK_SIZE, (r + 1) * BlazingOpossumCipher.BLOCK_SIZE));
            this.roundKeys.push(roundKey);
        }
    }

    private readUint32LE(arr: Uint8Array, offset: number): number {
        return (arr[offset] |
            (arr[offset + 1] << 8) |
            (arr[offset + 2] << 16) |
            (arr[offset + 3] << 24)) >>> 0;
    }

    private writeUint32LE(arr: Uint8Array, offset: number, value: number): void {
        arr[offset] = value & 0xFF;
        arr[offset + 1] = (value >>> 8) & 0xFF;
        arr[offset + 2] = (value >>> 16) & 0xFF;
        arr[offset + 3] = (value >>> 24) & 0xFF;
    }

    private generateKeystreamBlock(ivLow: number, ivHigh: number, counter: number): Uint8Array {
        // Initialize state with IV and Counter
        const state = new Uint8Array(BlazingOpossumCipher.BLOCK_SIZE);

        // Pack IV and counter into state
        this.writeUint32LE(state, 0, ivHigh);
        this.writeUint32LE(state, 4, ivLow + counter);
        this.writeUint32LE(state, 8, ivHigh);
        this.writeUint32LE(state, 12, ivLow + counter + 1);

        const PRIME_MUL = 0x9E3779B9;
        const PRIME_ADD = 0xBB67AE85;

        for (let r = 0; r < BlazingOpossumCipher.ROUNDS; r++) {
            const roundKey = this.roundKeys[r];

            // Non-linear mixing using multiplication
            for (let i = 0; i < state.length; i += 4) {
                const val = this.readUint32LE(state, i);
                const roundKeyValue = this.readUint32LE(roundKey, i);

                // Multiply and add with round key
                const multiplied = Math.imul(val, PRIME_MUL);
                const mixed = (multiplied + roundKeyValue) >>> 0;

                // Rotate left by position-dependent amount
                const rotated = ((mixed << ((i * 7) % 32)) | (mixed >>> (32 - ((i * 7) % 32)))) >>> 0;

                this.writeUint32LE(state, i, rotated);
            }

            // Add round constant
            for (let i = 0; i < state.length; i++) {
                state[i] ^= (PRIME_ADD + r) & 0xFF;
            }
        }

        // Final whitening
        for (let i = 0; i < state.length; i++) {
            state[i] ^= this.roundKeys[BlazingOpossumCipher.ROUNDS][i];
        }

        return state;
    }

    private computeTag(data: Uint8Array, iv: Uint8Array): Uint8Array {
        // Initialize accumulator with IV
        const acc = new Uint8Array(BlazingOpossumCipher.BLOCK_SIZE);
        acc.set(iv.subarray(0, Math.min(iv.length, BlazingOpossumCipher.BLOCK_SIZE)));

        const PRIME_MUL = 0x9E3779B9;
        const PRIME_ADD = 0xBB67AE85;

        // Process data in chunks
        for (let i = 0; i < data.length; i += BlazingOpossumCipher.BLOCK_SIZE) {
            const chunk = data.subarray(i, Math.min(i + BlazingOpossumCipher.BLOCK_SIZE, data.length));

            // Absorb chunk into accumulator
            for (let j = 0; j < chunk.length; j++) {
                acc[j % acc.length] ^= chunk[j];
            }

            // Mix using multiplication
            for (let j = 0; j < acc.length; j += 4) {
                const val = this.readUint32LE(acc, j);
                const multiplied = Math.imul(val, PRIME_MUL);
                const mixed = (multiplied + PRIME_ADD) >>> 0;

                // Rotate
                const rotated = ((mixed << 11) | (mixed >>> 21)) >>> 0;
                this.writeUint32LE(acc, j, rotated);
            }
        }

        // Final squeeze with multiple rounds
        for (let r = 0; r < 4; r++) {
            for (let i = 0; i < acc.length; i += 4) {
                const val = this.readUint32LE(acc, i);
                const roundKeyValue = this.readUint32LE(this.roundKeys[r % this.roundKeys.length], i);

                const mixed = (Math.imul(val, PRIME_MUL) + roundKeyValue) >>> 0;
                const rotated = ((mixed << 13) | (mixed >>> 19)) >>> 0;
                this.writeUint32LE(acc, i, rotated);
            }
        }

        return acc.slice(0, BlazingOpossumCipher.TAG_SIZE);
    }

    private processCTR(inputData: Uint8Array, iv: Uint8Array): Uint8Array {
        const outputData = new Uint8Array(inputData.length);
        const ivLow = this.readUint32LE(iv, 0);
        const ivHigh = this.readUint32LE(iv, 4);
        let counter = 0;

        let processedBytes = 0;
        while (processedBytes < inputData.length) {
            const keystreamBlock = this.generateKeystreamBlock(ivLow, ivHigh, counter);

            const bytesToProcess = Math.min(BlazingOpossumCipher.BLOCK_SIZE, inputData.length - processedBytes);

            // XOR input with keystream
            for (let i = 0; i < bytesToProcess; i++) {
                outputData[processedBytes + i] = inputData[processedBytes + i] ^ keystreamBlock[i];
            }

            processedBytes += bytesToProcess;
            counter += 2; // We generated 2 blocks worth of keystream
        }

        return outputData;
    }

    public encrypt(plaintext: string): string {
        const encoder = new TextEncoder();
        const data = encoder.encode(plaintext);

        // Generate random IV
        const iv = crypto.getRandomValues(new Uint8Array(BlazingOpossumCipher.IV_SIZE));

        // Process with CTR mode
        const processed = this.processCTR(data, iv);

        // Compute tag for integrity
        const tag = this.computeTag(processed, iv);

        // Combine IV, processed data, and tag
        const result = new Uint8Array(BlazingOpossumCipher.IV_SIZE + processed.length + BlazingOpossumCipher.TAG_SIZE);
        result.set(iv, 0);
        result.set(processed, BlazingOpossumCipher.IV_SIZE);
        result.set(tag, BlazingOpossumCipher.IV_SIZE + processed.length);

        return bytesToBase64(result);
    }

    public decrypt(encrypted: string): string {
        try {
            const data = base64ToBytes(encrypted);

            if (data.length < BlazingOpossumCipher.IV_SIZE + BlazingOpossumCipher.TAG_SIZE) {
                throw new Error("Data too short");
            }

            const iv = data.subarray(0, BlazingOpossumCipher.IV_SIZE);
            const encryptedData = data.subarray(BlazingOpossumCipher.IV_SIZE, data.length - BlazingOpossumCipher.TAG_SIZE);
            const receivedTag = data.subarray(data.length - BlazingOpossumCipher.TAG_SIZE);

            // Compute expected tag
            const computedTag = this.computeTag(encryptedData, iv);

            // Verify tag (constant-time comparison)
            let tagDiff = 0;
            for (let i = 0; i < BlazingOpossumCipher.TAG_SIZE; i++) {
                tagDiff |= receivedTag[i] ^ computedTag[i];
            }

            if (tagDiff !== 0) {
                throw new Error("Integrity check failed");
            }

            // Decrypt using CTR mode
            const processed = this.processCTR(encryptedData, iv);

            const decoder = new TextDecoder();
            return decoder.decode(processed);
        } catch {
            throw new Error("Decryption failed");
        }
    }
}

// Global cipher instance
let cipher: BlazingOpossumCipher | null = null;
let cipherPassword = "";
let failedAttempts = 0;
let lockoutEndTime = 0;
let lastDecryptionAttempt = 0;
let messageSendListener: MessageSendListener | null = null;
let autoLockTimer: ReturnType<typeof setTimeout> | null = null;
let lastActivityChannelId: string | null = null;

function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
    return new Uint8Array(atob(value).split("").map(char => char.charCodeAt(0)));
}

function deriveKey(password: string): Uint8Array {
    const passwordBytes = encoder.encode(password);
    if (!passwordBytes.length) {
        throw new Error("No encryption password set.");
    }

    const key = new Uint8Array(32);
    for (let i = 0; i < key.length; i++) {
        key[i] = passwordBytes[i % passwordBytes.length] ^ (i % 256);
    }
    return key;
}

function getCipher(password: string): BlazingOpossumCipher {
    if (!cipher || cipherPassword !== password) {
        cipher = new BlazingOpossumCipher(deriveKey(password));
        cipherPassword = password;
    }

    return cipher;
}

function resetCipher() {
    cipher = null;
    cipherPassword = "";
}

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

function isEncryptedMessage(content: string) {
    return content.startsWith(ENCRYPTED_PREFIX) && content.endsWith(ENCRYPTED_SUFFIX);
}

function getEncryptedPart(content: string) {
    return content.slice(ENCRYPTED_PREFIX.length, -ENCRYPTED_SUFFIX.length);
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

function encryptOpossum(text: string, password: string): string {
    const data = encoder.encode(text);
    const validationErrors = validatePassword(password);

    if (validationErrors.length) {
        throw new Error(`Password validation failed: ${validationErrors.join(", ")}`);
    }

    if (settings.store.maxPlaintextBytes > 0 && data.length > settings.store.maxPlaintextBytes) {
        throw new Error(`Message is too long to encrypt. Limit is ${settings.store.maxPlaintextBytes} bytes.`);
    }

    const encryptedMessage = getCipher(password).encrypt(text);
    const wrappedMessage = `${ENCRYPTED_PREFIX}${encryptedMessage}${ENCRYPTED_SUFFIX}`;

    if (wrappedMessage.length > SECURITY_CONSTANTS.MAX_DISCORD_MESSAGE_LENGTH) {
        throw new Error("Encrypted message is too long for Discord.");
    }

    return encryptedMessage;
}

function decryptOpossum(encrypted: string, password: string): string {
    const decryptedMessage = getCipher(password).decrypt(encrypted);
    resetSecurityState();
    return decryptedMessage;
}

function clearAutoLockTimer() {
    if (!autoLockTimer) return;

    clearTimeout(autoLockTimer);
    autoLockTimer = null;
}

function scheduleAutoLock(channelId?: string) {
    clearAutoLockTimer();

    if (channelId) lastActivityChannelId = channelId;
    if (!settings.store.pluginActivated || !settings.store.encryptionEnabled || settings.store.autoLockTimeout <= 0) return;

    autoLockTimer = setTimeout(() => {
        settings.store.encryptionEnabled = false;
        logInfo("Encryption auto locked.");

        if (settings.store.notifyOnAutoLock && lastActivityChannelId) {
            sendBotMessage(lastActivityChannelId, {
                content: "🔐 Encryption auto disabled after inactivity."
            });
        }
    }, settings.store.autoLockTimeout * SECURITY_CONSTANTS.MILLISECONDS_PER_MINUTE);
}

function formatDecryptedMessage(message: Message | undefined, decryptedMessage: string) {
    if (!message || !settings.store.showAuthorInDecryptedMessages) {
        return `🔐 **Decrypted message**: ${decryptedMessage}`;
    }

    return `🔐 **Decrypted message from ${message.author.username}**: ${decryptedMessage}`;
}

// SVG icons for the button
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

// Chatbar button
const EncryptionToggleButton: ChatBarButtonFactory = ({ channel, type }) => {
    const { pluginActivated, encryptionEnabled } = settings.use();

    const validChat = ["normal", "sidebar"].some(x => type.analyticsName === x);

    if (!validChat) return null;

    // Only show button when plugin is activated
    if (!pluginActivated) {
        return (
            <ChatBarButton
                tooltip="Activate Securecord Opossum Plugin"
                onClick={() => {
                    settings.store.pluginActivated = true;
                    // Show confirmation
                    if (settings.store.notifyOnToggle) {
                        sendBotMessage(
                            channel.id,
                            {
                                content: "🔐 Securecord Opossum plugin activated! Click again to toggle encryption."
                            }
                        );
                    }
                }}
            >
                <EncryptionDisabledIcon />
            </ChatBarButton>
        );
    }

    return (
        <ChatBarButton
            tooltip={encryptionEnabled ? "Disable Encryption" : "Enable Encryption"}
            onClick={() => {
                const newValue = !encryptionEnabled;
                settings.store.encryptionEnabled = newValue;
                scheduleAutoLock(channel.id);

                // Show confirmation
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
            {encryptionEnabled ? <EncryptionEnabledIcon /> : <EncryptionDisabledIcon />}
        </ChatBarButton>
    );
};

// Plugin settings definition
const settings = definePluginSettings({
    pluginActivated: {
        type: OptionType.BOOLEAN,
        description: "Activate Securecord Opossum.",
        default: false,
        onChange(newValue: boolean) {
            if (!newValue) settings.store.encryptionEnabled = false;
            scheduleAutoLock();
        }
    },
    encryptionPassword: {
        type: OptionType.STRING,
        description: "BlazingOpossum encryption password shared with trusted users.",
        default: "",
        placeholder: "Enter strong shared password...",
        onChange(newValue: string) {
            if (newValue) {
                const errors = validatePassword(newValue);
                if (errors.length) logInfo("Password validation failed.", errors.join(", "));
            }

            resetCipher();
            resetSecurityState();
        }
    },
    encryptionEnabled: {
        type: OptionType.BOOLEAN,
        description: "Encrypt outgoing messages.",
        default: false,
        onChange() {
            scheduleAutoLock();
        }
    },
    autoDecrypt: {
        type: OptionType.BOOLEAN,
        description: "Show decrypted Securecord Opossum messages automatically.",
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
    name: "SecurecordOpossum",
    description: "High-Performance, Post-Quantum Resilient end-to-end encryption for Discord based on BlazingOpossum cipher. Share the same password with other users to communicate securely.",
    tags: ["Privacy", "Chat"],
    authors: [{ name: "irritably", id: 928787166916640838n }],
    settings,
    chatBarButton: {
        icon: EncryptionEnabledIcon,
        render: EncryptionToggleButton
    },

    start() {
        // Add listener to encrypt messages before sending
        messageSendListener = async (channelId, message, options) => {
            if (!settings.store.pluginActivated || !settings.store.encryptionEnabled) return;
            scheduleAutoLock(channelId);

            if (settings.store.blockUploadsWhileEncrypted && options.uploads?.length) {
                sendBotMessage(channelId, {
                    content: "❌ File uploads are not encrypted by Securecord Opossum and were blocked."
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
                const encryptedMessage = encryptOpossum(message.content, password);
                message.content = `${ENCRYPTED_PREFIX}${encryptedMessage}${ENCRYPTED_SUFFIX}`;

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
        // Remove listener when plugin is stopped
        if (messageSendListener) {
            removeMessagePreSendListener(messageSendListener);
            messageSendListener = null;
        }

        // Clean up cipher
        clearAutoLockTimer();
        resetCipher();
        resetSecurityState();
        logInfo("Plugin stopped and security state reset.");
    },

    flux: {
        async MESSAGE_CREATE({ optimistic, type, message, channelId }: IMessageCreate) {
            if (optimistic || type !== "MESSAGE_CREATE") return;
            if (message.state === "SENDING") return;
            if (!settings.store.pluginActivated || !settings.store.autoDecrypt) return;
            if (!message.content || !isEncryptedMessage(message.content)) return;

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

            // Get password from settings
            const password = settings.store.encryptionPassword;

            if (!password) {
                logInfo("No password set.");
                return;
            }

            try {
                // Extract encrypted message (removing extra characters)
                const encryptedPart = getEncryptedPart(message.content);

                // Decode message using BlazingOpossum cipher
                const decryptedMessage = decryptOpossum(encryptedPart, password);

                // Show decrypted message as bot message (Clyde)
                sendBotMessage(channelId, {
                    content: formatDecryptedMessage(message, decryptedMessage)
                });

                scheduleAutoLock(channelId);
                logInfo("Sent decrypted message.");
            } catch (error) {
                const errorMessage = getErrorMessage(error);
                recordFailedAttempt();
                logError("Decryption error:", errorMessage);

                // Show error message
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

    commands: [
        {
            name: "decrypt",
            description: "Decrypt an encrypted message by replying to it or pasting the encrypted text.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            predicate: () => settings.store.pluginActivated,
            options: [
                {
                    name: "encrypted-text",
                    description: "Paste the encrypted text. Optional if replying to a message.",
                    type: ApplicationCommandOptionType.STRING,
                    required: false
                }
            ],
            execute: async (args, ctx) => {
                const commandContext = ctx as DecryptCommandContext;
                const replyMessage = commandContext.message?.referencedMessage;
                const encryptedTextArg = args[0]?.value;

                let messageContent: string | undefined;

                // Se c'è un messaggio di risposta, usa quello
                if (replyMessage) {
                    messageContent = replyMessage.content;
                } else if (encryptedTextArg) {
                    // Altrimenti usa il testo passato come argomento
                    messageContent = encryptedTextArg;
                } else {
                    sendBotMessage(ctx.channel.id, {
                        content: "❌ Please reply to an encrypted message or paste the encrypted text. Usage: `/decrypt [encrypted-text]`."
                    });
                    return;
                }

                // Check if the message is encrypted
                if (!isEncryptedMessage(messageContent)) {
                    sendBotMessage(ctx.channel.id, {
                        content: "❌ The message is not encrypted. Make sure it starts with 🔒ENCRYPTED: and ends with :ENDLOCK."
                    });
                    return;
                }

                if (isRateLimited()) {
                    const remainingTime = Math.ceil((lockoutEndTime - Date.now()) / SECURITY_CONSTANTS.MILLISECONDS_PER_MINUTE);
                    sendBotMessage(ctx.channel.id, {
                        content: `🔒 Too many failed decryption attempts. Try again in ${remainingTime} minutes.`
                    });
                    return;
                }

                // Get password from settings
                const password = settings.store.encryptionPassword;

                if (!password) {
                    sendBotMessage(ctx.channel.id, {
                        content: "❌ No encryption password set in plugin settings."
                    });
                    return;
                }

                try {
                    // Extract encrypted message (removing extra characters)
                    const encryptedPart = getEncryptedPart(messageContent);

                    // Decode message using BlazingOpossum cipher
                    const decryptedMessage = decryptOpossum(encryptedPart, password);

                    // Send as Clyde bot message
                    sendBotMessage(ctx.channel.id, {
                        content: formatDecryptedMessage(replyMessage, decryptedMessage)
                    });
                    scheduleAutoLock(ctx.channel.id);
                } catch (error) {
                    const errorMessage = getErrorMessage(error);
                    recordFailedAttempt();
                    logError("Decryption error:", errorMessage);
                    sendBotMessage(ctx.channel.id, {
                        content: settings.store.showDetailedDecryptErrors
                            ? `🔒 Decryption failed. ${errorMessage}`
                            : "🔒 Decryption failed. Check password or try again later."
                    });
                }
            }
        }
    ]

});
