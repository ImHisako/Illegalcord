/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { ApplicationCommandInputType, ApplicationCommandOptionType, sendBotMessage } from "@api/Commands";
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, showToast, Toasts, UserStore } from "@webpack/common";

import { buildDecryptModal } from "./decryptModal";
import { buildModal } from "./modal";

const ChatBarIcon: ChatBarButtonFactory = ({ isMainChat, channel }) => {
    if (!isMainChat) return null;

    if (!channel || (channel.type !== 1 && channel.type !== 3)) {
        return null; // not a DM or Group DM → don't render
    }

    return (
        <ChatBarButton
            tooltip="PGP/GPG Encrypt"
            onClick={() => buildModal()}

            buttonProps={{
                "aria-haspopup": "dialog",
            }}

        >
            <svg version="1.1"
                id="Capa_1"
                width="20"
                height="20"
                viewBox="0 0 47 47"
            >
                <g>
                    <path fill="currentColor" d="M23.5,0C10.522,0,0,10.522,0,23.5C0,36.479,10.522,47,23.5,47C36.479,47,47,36.479,47,23.5C47,10.522,36.479,0,23.5,0z
                    M30.07,34.686L30.07,34.686c0,2.53-2.941,4.58-6.573,4.58c-3.631,0-6.577-2.05-6.577-4.58c0-0.494,3.648-14.979,3.648-14.979
                    c-2.024-1.06-3.418-3.161-3.418-5.609c0-3.515,2.838-6.362,6.361-6.362c3.514,0,6.35,2.848,6.35,6.362
                    c0,2.448-1.391,4.55-3.416,5.609c0,0,3.598,14.455,3.611,14.88l0.022,0.099H30.07z" />
                </g>
            </svg>

        </ChatBarButton>
    );
};

function DecryptMessageIcon() {
    return (
        <svg
            fill="currentColor"
            width={20} height={20}
            viewBox={"0 0 16 16"}
        >
            <path d="M10.5 9C12.9853 9 15 6.98528 15 4.5C15 2.01472 12.9853 0 10.5 0C8.01475 0 6.00003 2.01472 6.00003 4.5C6.00003 5.38054 6.25294 6.20201 6.69008 6.89574L0.585815 13L3.58292 15.9971L4.99714 14.5829L3.41424 13L5.00003 11.4142L6.58292 12.9971L7.99714 11.5829L6.41424 10L8.10429 8.30995C8.79801 8.74709 9.61949 9 10.5 9ZM10.5 7C11.8807 7 13 5.88071 13 4.5C13 3.11929 11.8807 2 10.5 2C9.11932 2 8.00003 3.11929 8.00003 4.5C8.00003 5.88071 9.11932 7 10.5 7Z" />
        </svg>
    );
}

function formatKey(key: string): string {
    const trimmed = key.trim();
    const markers = trimmed.match(/-----.*?-----/g);
    const start = markers?.at(0);
    const end = markers?.at(-1);

    if (!start || !end || trimmed.includes("\n")) return trimmed;

    return `${start}\n${trimmed.replace(start, "").replace(end, "").trim().replace(/\s+/g, "\n")}\n${end}`;
}

function normalizeSingleLineKey(key: string): string {
    // Remove extra whitespace and normalize the key
    const normalized = key.trim();

    // If the key appears to be in single-line format, try to reformat it
    if (!normalized.includes("\n") && normalized.includes("-----BEGIN PGP") && normalized.includes("-----END PGP")) {
        // Extract the header
        const headerMatch = normalized.match(/(-----BEGIN PGP [^-----]+-----)/);
        const header = headerMatch ? headerMatch[1] : "";

        // Extract the footer
        const footerMatch = normalized.match(/(-----END PGP [^-----]+-----)/);
        const footer = footerMatch ? footerMatch[1] : "";

        // Extract the content between header and footer
        let content = normalized;
        if (header) content = content.replace(header, "");
        if (footer) content = content.replace(footer, "");

        // Clean up extra spaces and split into reasonable chunks
        content = content.trim().replace(/\s+/g, " ");

        // Try to identify base64-like segments and put them on separate lines
        // This is a heuristic approach that looks for base64-like patterns
        const segments = content.split(" ");
        const formattedSegments: string[] = [];

        let currentLine = "";
        for (const segment of segments) {
            if (segment.trim() === "") continue;

            // If segment is very long (likely base64), put it on its own line
            if (segment.length > 64 && segment.match(/^[A-Za-z0-9+/=]+$/)) {
                if (currentLine) {
                    formattedSegments.push(currentLine.trim());
                    currentLine = "";
                }
                formattedSegments.push(segment);
            } else {
                // Otherwise, add to current line if it won't be too long
                if ((currentLine + " " + segment).length <= 76) {
                    currentLine = currentLine ? currentLine + " " + segment : segment;
                } else {
                    if (currentLine) formattedSegments.push(currentLine.trim());
                    currentLine = segment;
                }
            }
        }

        if (currentLine) formattedSegments.push(currentLine.trim());

        // Combine everything with proper formatting
        let result = header + "\n";
        if (formattedSegments.length > 0) {
            result += "\n"; // Add blank line after header as per PGP standard
            result += formattedSegments.join("\n");
            result += "\n";
        }
        result += footer;

        return result;
    }

    // If it's already formatted, return as is
    return normalized;
}

type OpenPGPOptions = Record<string, unknown>;
type OpenPGPPrivateKey = {
    isDecrypted(): boolean;
};
type OpenPGPPublicKey = {
    getFingerprint(): string;
    getUserIDs(): string[];
};
type OpenPGPClearTextMessage = {
    getText(): string;
};
type OpenPGPSignature = {
    verified: Promise<void>;
    keyID: {
        toHex(): string;
    };
};
type OpenPGPDecryptResult = {
    data: string;
    signatures?: OpenPGPSignature[];
};
type OpenPGPVerifyResult = {
    data: string;
    signatures?: OpenPGPSignature[];
};
type OpenPGP = {
    createCleartextMessage(options: OpenPGPOptions): Promise<unknown>;
    createMessage(options: OpenPGPOptions): Promise<unknown>;
    decrypt(options: OpenPGPOptions): Promise<OpenPGPDecryptResult>;
    decryptKey(options: OpenPGPOptions): Promise<OpenPGPPrivateKey>;
    encrypt(options: OpenPGPOptions): Promise<string>;
    generateKey(options: OpenPGPOptions): Promise<{ privateKey: string; publicKey: string; }>;
    readCleartextMessage(options: OpenPGPOptions): Promise<OpenPGPClearTextMessage>;
    readKey(options: OpenPGPOptions): Promise<OpenPGPPublicKey>;
    readMessage(options: OpenPGPOptions): Promise<unknown>;
    readPrivateKey(options: OpenPGPOptions): Promise<OpenPGPPrivateKey>;
    sign(options: OpenPGPOptions): Promise<string>;
    verify(options: OpenPGPOptions): Promise<OpenPGPVerifyResult>;
};

let openpgp: OpenPGP | null = null;
let openpgpLoaded = false;
let openpgpLoadPromise: Promise<void> | null = null;
const logger = new Logger("VGP");
const PGP_MESSAGE_BEGIN = "-----BEGIN PGP MESSAGE-----";
const PGP_MESSAGE_END = "-----END PGP MESSAGE-----";
const PGP_MESSAGE_REGEX = /-----BEGIN PGP MESSAGE-----[\s\S]+?-----END PGP MESSAGE-----/;

async function loadOpenPGP(): Promise<void> {
    if (openpgpLoaded) return;
    if (openpgpLoadPromise) return openpgpLoadPromise;

    openpgpLoadPromise = import("./openpgp.min.mjs").then((module: unknown) => {
        openpgp = module as OpenPGP;
        openpgpLoaded = true;
        logger.info("OpenPGP.js loaded");
    });

    return openpgpLoadPromise;
}

function requireOpenPGP(): OpenPGP {
    if (!openpgpLoaded || !openpgp) {
        throw new Error("OpenPGP.js not loaded yet. Please wait a moment and try again.");
    }
    return openpgp;
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function normalizePgpMessage(message: string): string {
    const trimmed = message.trim();
    if (trimmed.includes("\n")) return trimmed;

    const start = trimmed.indexOf(PGP_MESSAGE_BEGIN);
    const end = trimmed.indexOf(PGP_MESSAGE_END);
    if (start === -1 || end === -1) return trimmed;

    const compactBody = trimmed
        .slice(start + PGP_MESSAGE_BEGIN.length, end)
        .replace(/\s+/g, "");
    const checksum = compactBody.match(/=[A-Za-z0-9+/]{4}$/)?.[0] ?? "";
    const payload = checksum ? compactBody.slice(0, -checksum.length) : compactBody;
    const body = payload.match(/.{1,64}/g)?.join("\n") ?? payload;

    return `${PGP_MESSAGE_BEGIN}\n\n${body}${checksum ? `\n${checksum}` : ""}\n${PGP_MESSAGE_END}`;
}

function extractPgpMessage(message: string): string {
    return normalizePgpMessage(message.match(PGP_MESSAGE_REGEX)?.[0] ?? message);
}

async function ensureOpenPGP() {
    if (!openpgpLoaded) {
        await loadOpenPGP();
    }
}

// Normalize keys before processing to handle single-line inputs
export function preprocessKey(key: string): string {
    return normalizeSingleLineKey(key);
}

// Key Generation Functionality
async function generateKeyPair(name: string, email: string, passphrase: string, type: "ecc" | "rsa" = "ecc"): Promise<{ publicKey: string; privateKey: string }> {
    await ensureOpenPGP();
    const pgp = requireOpenPGP();

    const keyOptions = type === "ecc" ? {
        type,
        userIDs: [{ name, email }],
        passphrase,
        format: "armored",
        curve: "curve25519",
    } : {
        type,
        userIDs: [{ name, email }],
        passphrase,
        format: "armored",
        rsaBits: 4096,
    };

    const { privateKey, publicKey } = await pgp.generateKey(keyOptions);
    settings.store.pgpPrivateKey = privateKey;
    settings.store.pgpPublicKey = publicKey;
    settings.store.passphrase = passphrase;
    return { publicKey, privateKey };
}

export async function encrypt(message: string, public_key_recipient: string): Promise<string> {
    await ensureOpenPGP();
    const pgp = requireOpenPGP();

    let private_key, public_key;

    try {
        const privateKeyObj = await pgp.readPrivateKey({ armoredKey: formatKey(settings.store.pgpPrivateKey) });
        // Decrypt private key if it requires a passphrase
        if (!privateKeyObj.isDecrypted()) {
            const { passphrase } = settings.store;
            if (!passphrase) {
                throw new Error("Passphrase required for private key but not provided");
            }
            private_key = await pgp.decryptKey({ privateKey: privateKeyObj, passphrase });
        } else {
            private_key = privateKeyObj;
        }
        public_key = await pgp.readKey({ armoredKey: formatKey(settings.store.pgpPublicKey) });
    } catch (e) {
        showToast("Cannot read your private or public key, try setting them again in the plugin settings", Toasts.Type.FAILURE);
        throw e;
    }

    // Preprocess the recipient's key to handle single-line format
    const processedKey = preprocessKey(public_key_recipient);
    let pubKey_r;
    try {
        pubKey_r = await pgp.readKey({ armoredKey: processedKey });
    } catch (e) {
        showToast("The recipient's public key is not valid!", Toasts.Type.FAILURE);
        throw e;
    }

    try {
        const encrypted = await pgp.encrypt({
            message: await pgp.createMessage({ text: message }),
            encryptionKeys: [pubKey_r, public_key],
            signingKeys: [private_key]
        });

        return encrypted;
    } catch (e) {
        if (e instanceof Error) {
            showToast("Error during encryption.\n" + (e as Error).message, Toasts.Type.FAILURE);
        }
        throw e;
    }
}

interface StoredKey {
    publicKey: string;
    fingerprint: string;
    userIDs: string[];
    addedAt: number;
    verified: boolean;
}

class KeyManager {
    private keyCache: Map<string, StoredKey> = new Map();

    constructor() {
        this.loadKeys();
    }

    private loadKeys(): void {
        try {
            const stored = JSON.parse(settings.store.knownPublicKeys || "{}");
            this.keyCache = new Map(Object.entries(stored));
            logger.info(`Loaded ${this.keyCache.size} known public keys`);
        } catch (err) {
            logger.error("Failed to load keys:", err);
            this.keyCache = new Map();
        }
    }

    private saveKeys(): void {
        const obj = Object.fromEntries(this.keyCache);
        settings.store.knownPublicKeys = JSON.stringify(obj);
    }

    async importPublicKeyForUser(userId: string, armoredKey: string): Promise<StoredKey> {
        await ensureOpenPGP();
        const pgp = requireOpenPGP();
        // Preprocess the key to handle single-line format
        const processedKey = preprocessKey(armoredKey);
        const key = await pgp.readKey({ armoredKey: processedKey });
        const storedKey: StoredKey = {
            publicKey: processedKey, // Store the processed key
            fingerprint: key.getFingerprint().toUpperCase(),
            userIDs: key.getUserIDs(),
            addedAt: Date.now(),
            verified: false,
        };
        this.keyCache.set(userId, storedKey);
        this.saveKeys();
        logger.info(`Imported public key for user ${userId}`);
        return storedKey;
    }

    getPublicKeyForUser(userId: string): string | null {
        return this.keyCache.get(userId)?.publicKey || null;
    }

    getAllKeysWithUsers(): Array<{ userId: string; key: StoredKey }> {
        return Array.from(this.keyCache.entries()).map(([userId, key]) => ({ userId, key }));
    }

    removeKeyForUser(userId: string): boolean {
        const had = this.keyCache.delete(userId);
        if (had) this.saveKeys();
        return had;
    }

    verifyKey(userId: string): boolean {
        const stored = this.keyCache.get(userId);
        if (!stored) return false;
        stored.verified = true;
        this.saveKeys();
        return true;
    }
}

const keyManager = new KeyManager();

export const KEYSERVERS = {
    OPENPGP: "https://keys.openpgp.org",
    UBUNTU: "https://keyserver.ubuntu.com",
    MIT: "https://pgp.mit.edu",
} as const;

export type KeyserverName = keyof typeof KEYSERVERS;

async function searchKeyserver(query: string, keyserver: KeyserverName = "OPENPGP"): Promise<{ found: boolean; keys: string[] }> {
    const serverUrl = KEYSERVERS[keyserver];
    try {
        const searchParam = query.includes("@") ? query : (query.startsWith("0x") ? query : `0x${query}`);
        const response = await fetch(`${serverUrl}/pks/lookup?op=get&options=mr&search=${encodeURIComponent(searchParam)}`);
        if (response.ok) {
            const text = await response.text();
            const keys = text.match(/-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/g) || [];
            return { found: keys.length > 0, keys };
        }
        return { found: false, keys: [] };
    } catch {
        return { found: false, keys: [] };
    }
}

async function decryptMessage(message: string, authorId: string): Promise<{ data: string; verified: boolean; }> {
    await ensureOpenPGP();
    const pgp = requireOpenPGP();
    const armoredMessage = extractPgpMessage(message);

    // Check if the message is a signed message that contains an encrypted message inside
    if (armoredMessage.includes("-----BEGIN PGP SIGNED MESSAGE-----")) {
        // This is a signed message, not an encrypted one
        // We need to extract the content and handle it appropriately
        try {
            // Parse the signed message to extract the content
            const signedMsg = await pgp.readCleartextMessage({ cleartextMessage: armoredMessage });
            const content = signedMsg.getText();

            // Check if the content itself contains an encrypted message
            if (content.includes("-----BEGIN PGP MESSAGE-----") && content.includes("-----END PGP MESSAGE-----")) {
                // Extract the encrypted message and try to decrypt it separately
                const encryptedPart = content.match(/-----BEGIN PGP MESSAGE-----[\s\S]*?-----END PGP MESSAGE-----/g);
                if (encryptedPart && encryptedPart.length > 0) {
                    // Recursively call decrypt on the extracted encrypted part
                    return await decryptMessage(encryptedPart[0], authorId);
                }
            }

            // If we get here, it's a signed message without an encrypted part inside
            // So we should verify it instead of trying to decrypt it
            const verificationResult = await verifyMessage(armoredMessage);
            return { data: verificationResult.text, verified: verificationResult.valid };
        } catch (e) {
            showToast("Cannot process signed message: " + formatError(e), Toasts.Type.FAILURE);
            throw e;
        }
    }

    let private_key;
    try {
        const privateKeyObj = await pgp.readPrivateKey({ armoredKey: formatKey(settings.store.pgpPrivateKey) });
        // Decrypt private key if it requires a passphrase
        if (!privateKeyObj.isDecrypted()) {
            const { passphrase } = settings.store;
            if (!passphrase) {
                throw new Error("Passphrase required for private key but not provided");
            }
            private_key = await pgp.decryptKey({ privateKey: privateKeyObj, passphrase });
        } else {
            private_key = privateKeyObj;
        }
    } catch (e) {
        showToast("Cannot read personal private key", Toasts.Type.FAILURE);
        throw e;
    }

    let verificationKeyArmored: string = "";

    // If the author is the current user, use the user's public key for verification
    if (authorId === UserStore.getCurrentUser().id) {
        verificationKeyArmored = formatKey(settings.store.pgpPublicKey);
    } else {
        // First check our key manager for the sender's key
        const keyFromManager = keyManager.getPublicKeyForUser(authorId);
        if (keyFromManager) {
            verificationKeyArmored = keyFromManager;
        } else {
            // Fall back to the legacy DataStore approach
            try {
                const dataStorageKeys = await DataStore.get("gpgPublicKeys");
                if (dataStorageKeys) {
                    const publicKeys = JSON.parse(dataStorageKeys);
                    if (publicKeys[authorId]) {
                        verificationKeyArmored = publicKeys[authorId];
                    }
                }
            } catch (e) {
                showToast("Cannot find the senders signature", Toasts.Type.FAILURE);
                throw e;
            }
        }
    }

    const verificationKeys = verificationKeyArmored ? [await pgp.readKey({ armoredKey: verificationKeyArmored })] : undefined;

    let decrypted;
    try {
        decrypted = await pgp.decrypt({
            message: await pgp.readMessage({ armoredMessage }),
            decryptionKeys: [private_key],
            // Set to false to see the message anyways, but will show the key not verified warning
            expectSigned: false,
            ...(verificationKeys ? { verificationKeys } : {})
        });
    } catch (e) {
        showToast("Cannot decrypt message: check your private key", Toasts.Type.FAILURE);
        throw e;
    }

    // Verify signature
    const { signatures } = decrypted;
    let verified = false;
    if (signatures && signatures.length > 0) {
        try {
            await signatures[0].verified;
            // If verification completes without error, signature is valid
            verified = true;
        } catch (verificationError) {
            logger.warn("Signature verification failed:", verificationError);
            verified = false;
        }
    }

    return { data: typeof decrypted.data === "string" ? decrypted.data : String(decrypted.data), verified };
}

// Message signing and verification functions
async function signMessage(text: string): Promise<string> {
    await ensureOpenPGP();
    const pgp = requireOpenPGP();

    // Check if we have a private key set up
    if (!settings.store.pgpPrivateKey) {
        throw new Error("No private key configured. Please set up your PGP keys in plugin settings.");
    }

    let privateKey;
    try {
        const privateKeyObj = await pgp.readPrivateKey({ armoredKey: formatKey(settings.store.pgpPrivateKey) });
        // Decrypt private key if it requires a passphrase
        if (!privateKeyObj.isDecrypted()) {
            const { passphrase } = settings.store;
            if (!passphrase) {
                throw new Error("Passphrase required for private key but not provided");
            }
            privateKey = await pgp.decryptKey({ privateKey: privateKeyObj, passphrase });
        } else {
            privateKey = privateKeyObj;
        }
    } catch (e) {
        showToast("Cannot read your private key", Toasts.Type.FAILURE);
        throw e;
    }

    const message = await pgp.createCleartextMessage({ text });
    return await pgp.sign({ message, signingKeys: privateKey, format: "armored" });
}

async function verifyMessage(signedMessage: string): Promise<{ valid: boolean; text: string; signedBy?: string }> {
    await ensureOpenPGP();
    const pgp = requireOpenPGP();

    try {
        let message;
        let text;
        let signatures;

        // Determine the type of message and handle accordingly
        if (signedMessage.includes("-----BEGIN PGP SIGNED MESSAGE-----")) {
            // This is a cleartext signed message
            message = await pgp.readCleartextMessage({ cleartextMessage: signedMessage });

            // Prepare verification keys - include our own public key and known contact keys
            const verificationKeys: OpenPGPPublicKey[] = [];
            if (settings.store.pgpPublicKey) {
                verificationKeys.push(await pgp.readKey({ armoredKey: formatKey(settings.store.pgpPublicKey) }));
            }

            // Add all known public keys from key manager
            for (const { key } of keyManager.getAllKeysWithUsers()) {
                try {
                    verificationKeys.push(await pgp.readKey({ armoredKey: key.publicKey }));
                } catch { /* skip invalid keys */ }
            }

            if (verificationKeys.length === 0) {
                return { valid: false, text: message.getText() };
            }

            const result = await pgp.verify({ message, verificationKeys });
            text = result.data;
            signatures = result.signatures;
        } else {
            // This might be a signed and encrypted message
            // We need to parse the message to determine the correct verification approach
            const parsedMessage = await pgp.readMessage({ armoredMessage: signedMessage });

            // Prepare verification keys - include our own public key and known contact keys
            const verificationKeys: OpenPGPPublicKey[] = [];
            if (settings.store.pgpPublicKey) {
                verificationKeys.push(await pgp.readKey({ armoredKey: formatKey(settings.store.pgpPublicKey) }));
            }

            // Add all known public keys from key manager
            for (const { key } of keyManager.getAllKeysWithUsers()) {
                try {
                    verificationKeys.push(await pgp.readKey({ armoredKey: key.publicKey }));
                } catch { /* skip invalid keys */ }
            }

            if (verificationKeys.length === 0) {
                return { valid: false, text: "No verification keys available" };
            }

            // Attempt to verify the message
            const result = await pgp.verify({ message: parsedMessage, verificationKeys });
            text = result.data;
            signatures = result.signatures;
        }

        // Process signatures
        // Check if there are any signatures to verify
        if (!signatures || signatures.length === 0) {
            return { valid: false, text: text };
        }

        for (const sig of signatures) {
            try {
                // Verify the signature
                await sig.verified;
                // If verification doesn't throw, the signature is valid
                return { valid: true, text, signedBy: sig.keyID.toHex() };
            } catch (verificationError) {
                logger.warn("Signature verification failed:", verificationError);
                // Continue to try next signature
            }
        }

        return { valid: false, text };
    } catch (err) {
        return { valid: false, text: "", signedBy: `Error: ${err}` };
    }
}

function formatFingerprint(fp: string): string {
    return fp.match(/.{1,4}/g)?.join(" ") || fp;
}

const settings = definePluginSettings({
    pgpPrivateKey: {
        type: OptionType.STRING,
        description: "Your PGP private key (armored format).",
        tags: ["Privacy", "Utility"],
        default: "",
        hidden: false,
    },
    pgpPublicKey: {
        type: OptionType.STRING,
        description: "Your PGP public key (armored format).",
        default: "",
        hidden: false,
    },
    passphrase: {
        type: OptionType.STRING,
        description: "Passphrase for your private key.",
        default: "",
        hidden: false,
    },
    knownPublicKeys: {
        type: OptionType.STRING,
        description: "JSON map of user IDs to their public keys.",
        default: "{}",
        hidden: false,
    },
    signMessages: {
        type: OptionType.BOOLEAN,
        description: "Sign encrypted messages with your private key.",
        default: true,
    },
    encryptionIndicator: {
        type: OptionType.STRING,
        description: "Prefix for encrypted messages (visual indicator).",
        default: "🔒",
    },
});

export default definePlugin({
    name: "IGP",
    description: "Illegalcord PGP encryption.",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    settings,

    renderChatBarButton: ChatBarIcon,
    decryptMessageIcon: () => <DecryptMessageIcon />,

    GPG_REGEX: PGP_MESSAGE_REGEX,
    renderMessagePopoverButton(message) {
        return this.GPG_REGEX.test(message?.content) ?
            {
                label: "Decrypt Message",
                icon: this.decryptMessageIcon,
                message: message,
                channel: ChannelStore.getChannel(message.channel_id),
                onClick: async () => {
                    const decrypted = await decryptMessage(message.content, message.author.id);
                    buildDecryptModal(decrypted.data, decrypted.verified);
                }
            }
            : null;
    },

    commands: [
        {
            name: "pgp",
            description: "PGP encryption commands.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                { name: "encrypt", description: "Encrypt a message.", type: ApplicationCommandOptionType.SUB_COMMAND, options: [
                    { name: "message", description: "Message to encrypt.", type: ApplicationCommandOptionType.STRING, required: true },
                    { name: "user", description: "Recipient.", type: ApplicationCommandOptionType.USER, required: true }
                ] },
                { name: "decrypt", description: "Decrypt a message.", type: ApplicationCommandOptionType.SUB_COMMAND, options: [
                    { name: "message", description: "PGP message to decrypt.", type: ApplicationCommandOptionType.STRING, required: true }
                ] },
                { name: "sign", description: "Sign a message.", type: ApplicationCommandOptionType.SUB_COMMAND, options: [
                    { name: "message", description: "Message to sign.", type: ApplicationCommandOptionType.STRING, required: true }
                ] },
                { name: "verify", description: "Verify a signed message.", type: ApplicationCommandOptionType.SUB_COMMAND, options: [
                    { name: "message", description: "Signed message to verify.", type: ApplicationCommandOptionType.STRING, required: true }
                ] },
                { name: "howtouse", description: "Show how to use IGP.", type: ApplicationCommandOptionType.SUB_COMMAND },
                { name: "sharekey", description: "Share your public key.", type: ApplicationCommandOptionType.SUB_COMMAND },
                { name: "fingerprint", description: "Show your key fingerprint.", type: ApplicationCommandOptionType.SUB_COMMAND },
                { name: "generate", description: "Generate a new PGP key pair.", type: ApplicationCommandOptionType.SUB_COMMAND, options: [
                    { name: "name", description: "Your name.", type: ApplicationCommandOptionType.STRING, required: true },
                    { name: "email", description: "Your email.", type: ApplicationCommandOptionType.STRING, required: true },
                    { name: "passphrase", description: "Passphrase for private key.", type: ApplicationCommandOptionType.STRING, required: true },
                    { name: "type", description: "Key type.", type: ApplicationCommandOptionType.STRING, choices: [
                        { label: "ECC (recommended)", name: "ECC (recommended)", value: "ecc" },
                        { label: "RSA 4096", name: "RSA 4096", value: "rsa" }
                    ] }
                ] },
                { name: "import", description: "Import a contact's public key.", type: ApplicationCommandOptionType.SUB_COMMAND, options: [
                    { name: "key", description: "Public key.", type: ApplicationCommandOptionType.STRING, required: true },
                    { name: "user", description: "User.", type: ApplicationCommandOptionType.USER, required: true }
                ] },
                { name: "search", description: "Search for a public key.", type: ApplicationCommandOptionType.SUB_COMMAND, options: [
                    { name: "query", description: "Email or key ID to search for.", type: ApplicationCommandOptionType.STRING, required: true }
                ] }
            ],
            async execute(args, ctx) {
                const reply = (content: string) => {
                    sendBotMessage(ctx.channel.id, { content });
                };
                const sub = args[0];
                if (!sub) {
                    reply("Choose a PGP command.");
                    return;
                }

                const getOpt = (n: string) => sub.options?.find(o => o.name === n)?.value;

                try {
                    await ensureOpenPGP();

                    switch (sub.name) {
                        case "howtouse": {
                            reply([
                                "**IGP PGP complete guide**",
                                "",
                                "1. Create your key pair with `/pgp generate`. Use ECC unless you specifically need RSA. Your private key stays in the plugin settings, while your public key is what other people need to message you.",
                                "",
                                "2. Share your public key with `/pgp sharekey`. This command and `/pgp encrypt` are sent to the real chat because other people need to see the key or encrypted message.",
                                "",
                                "3. When someone shares their public key, import it with `/pgp import user:@user key:key`. After that, you can encrypt messages for that person.",
                                "",
                                "4. Message someone with `/pgp encrypt user:@user message:text`. Everyone can see the PGP block in the channel, but only the owner of the matching private key can read the content.",
                                "",
                                "5. To read a message, copy the full block from `-----BEGIN PGP MESSAGE-----` to `-----END PGP MESSAGE-----` and run `/pgp decrypt message:block`. If Discord also copies the lock icon, leave it there. IGP strips it automatically.",
                                "",
                                "6. Use `/pgp fingerprint` to show your key fingerprint and compare it outside Discord. If it matches, you know the imported key is the right one.",
                                "",
                                "7. `/pgp sign` signs text with your private key. `/pgp verify` checks a signature using your public key and the imported contact keys.",
                                "",
                                "8. `/pgp search` tries to find public keys on keyservers. Only import keys you have verified because anyone can publish a key with a similar name.",
                                "",
                                "Note: `decrypt`, `import`, `generate`, `fingerprint`, `sign`, `verify`, `search`, and `howtouse` are local Clyde replies. Other people do not see them."
                            ].join("\n"));
                            return;
                        }

                        case "encrypt": {
                            const userOpt = getOpt("user");
                            const messageOpt = getOpt("message");

                            if (!userOpt || !messageOpt) {
                                reply("❌ Missing required options for encrypt.");
                                return;
                            }

                            const userId = userOpt;
                            const publicKey = keyManager.getPublicKeyForUser(userId);
                            if (!publicKey) {
                                reply("❌ No public key for this user. Use `/pgp import` to add their key.");
                                return;
                            }

                            const encrypted = await encrypt(messageOpt, publicKey);
                            await sendMessage(ctx.channel.id, { content: `${settings.store.encryptionIndicator}\n${encrypted}` });
                            return;
                        }

                        case "decrypt": {
                            const messageOpt = getOpt("message");

                            if (!messageOpt) {
                                reply("❌ Message parameter is required for decrypt.");
                                return;
                            }

                            const result = await decryptMessage(messageOpt, UserStore.getCurrentUser().id);
                            reply(`🔓${result.verified ? " ✅" : ""}\n${result.data}`);
                            return;
                        }

                        case "sign": {
                            if (!settings.store.pgpPrivateKey) {
                                reply("❌ No private key configured. Use `/pgp generate` to create keys or set them in plugin settings.");
                                return;
                            }

                            const messageOpt = getOpt("message");

                            if (!messageOpt) {
                                reply("❌ Message parameter is required for sign.");
                                return;
                            }

                            const signed = await signMessage(messageOpt);
                            reply(`✍️\n\`\`\`\n${signed}\n\`\`\``);
                            return;
                        }

                        case "verify": {
                            const messageOpt = getOpt("message");

                            if (!messageOpt) {
                                reply("❌ Message parameter is required for verify.");
                                return;
                            }

                            const result = await verifyMessage(messageOpt);
                            reply(result.valid ?
                                `✅ Valid signature from ${result.signedBy}\n\n${result.text}` :
                                `❌ Invalid signature\n\n${result.text}`);
                            return;
                        }

                        case "sharekey": {
                            const key = settings.store.pgpPublicKey;
                            if (!key) {
                                reply("❌ No public key configured.");
                                return;
                            }

                            await sendMessage(ctx.channel.id, { content: `📤\n\`\`\`\n${key}\n\`\`\`` });
                            return;
                        }

                        case "fingerprint": {
                            if (!settings.store.pgpPublicKey) {
                                reply("❌ No public key configured.");
                                return;
                            }

                            await ensureOpenPGP();
                            const pgp = requireOpenPGP();
                            const key = await pgp.readKey({ armoredKey: formatKey(settings.store.pgpPublicKey) });
                            const fingerprint = key.getFingerprint().toUpperCase();
                            reply(`🔑 \`${formatFingerprint(fingerprint)}\``);
                            return;
                        }

                        case "generate": {
                            const name = getOpt("name");
                            const email = getOpt("email");
                            const passphrase = getOpt("passphrase");

                            if (!name || !email || !passphrase) {
                                reply("❌ Name, email, and passphrase are required for key generation.");
                                return;
                            }

                            const type = (getOpt("type") || "ecc") as "ecc" | "rsa";

                            try {
                                await generateKeyPair(name, email, passphrase, type);
                                reply(`✅ Generated ${type.toUpperCase()} key pair. Your keys are now saved in plugin settings.`);
                                return;
                            } catch (e) {
                                reply(`❌ Error generating keys: ${formatError(e)}`);
                                return;
                            }
                        }

                        case "import": {
                            const userValue = getOpt("user");
                            const keyValue = getOpt("key");

                            if (!userValue || !keyValue) {
                                reply("❌ Missing required options for import.");
                                return;
                            }

                            const userId = userValue;
                            const key = preprocessKey(keyValue);

                            try {
                                await keyManager.importPublicKeyForUser(userId, key);
                                reply(`✅ Imported public key for <@${userId}>`);
                                return;
                            } catch (e) {
                                reply(`❌ Error importing key: ${formatError(e)}`);
                                return;
                            }
                        }

                        case "search": {
                            const query = getOpt("query");

                            if (!query) {
                                reply("❌ Query parameter is required.");
                                return;
                            }

                            try {
                                const result = await searchKeyserver(query);
                                if (result.found) {
                                    reply(`🌐 Found ${result.keys.length} key(s) for "${query}". Use \`/pgp import\` to add them to your contacts.`);
                                } else {
                                    reply(`🌐 No keys found for "${query}".`);
                                }
                                return;
                            } catch (e) {
                                reply(`❌ Error searching keyserver: ${formatError(e)}`);
                                return;
                            }
                        }
                    }
                } catch (e) {
                    reply(`❌ Error: ${formatError(e)}`);
                }
            }
        }
    ],
});
