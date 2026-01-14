/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { sendBotMessage, ApplicationCommandInputType, ApplicationCommandOptionType, findOption } from "@api/Commands";
import { addMessagePreSendListener, removeMessagePreSendListener, MessageSendListener } from "@api/MessageEvents";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";  

interface IMessageCreate {
    type: "MESSAGE_CREATE";
    optimistic: boolean;
    isPushNotification: boolean;
    channelId: string;
    message: Message;
}

// Funzioni di crittografia AES-256
const encryptAES = async (text: string, password: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    
    // Deriva la chiave usando PBKDF2
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
    );
    
    const key = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: 100000,
            hash: "SHA-256"
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt"]
    );
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        key,
        data
    );
    
    // Combina salt, IV e dati crittografati
    const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    result.set(salt, 0);
    result.set(iv, salt.length);
    result.set(new Uint8Array(encrypted), salt.length + iv.length);
    
    return btoa(String.fromCharCode(...result));
};

const decryptAES = async (encrypted: string, password: string): Promise<string> => {
    try {
        const data = new Uint8Array(atob(encrypted).split('').map(c => c.charCodeAt(0)));
        const salt = data.slice(0, 16);
        const iv = data.slice(16, 28);
        const encryptedData = data.slice(28);
        
        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            "raw",
            encoder.encode(password),
            { name: "PBKDF2" },
            false,
            ["deriveKey"]
        );
        
        const key = await crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: salt,
                iterations: 100000,
                hash: "SHA-256"
            },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            false,
            ["decrypt"]
        );
        
        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            key,
            encryptedData
        );
        
        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    } catch (error) {
        console.error("Decrypt error:", error);
        throw new Error("Decryption failed");
    }
};



// Plugin settings definition
const settings = definePluginSettings({
    encryptionPassword: {
        type: OptionType.STRING,
        description: "Password for AES-256 encryption (shared with other users)",
        default: "",
        placeholder: "Enter shared password..."
    },
    enableEncryption: {
        type: OptionType.BOOLEAN,
        description: "Enable/disable message encryption",
        default: false
    },
    enableLogging: {
        type: OptionType.BOOLEAN,
        description: "Enable/disable console logs (for debugging)",
        default: true
    }
});

export default definePlugin({
    name: "Encryptcord",
    description: "End-to-end AES-256 encryption for Discord. Share the same password with other users to communicate securely.",
    authors: [Devs.irritably],
    settings,
    

    
    flux: {
        async MESSAGE_CREATE({ optimistic, type, message, channelId }: IMessageCreate) {
            if (optimistic || type !== "MESSAGE_CREATE") return;
            if (message.state === "SENDING") return;
            if (!message.content) return;

            // Check if message is encrypted
            if (message.content.startsWith("🔒ENCRYPTED:") && message.content.endsWith(":ENDLOCK")) {
                if (settings.store.enableLogging) {
                    console.log("Encryptcord: Received encrypted message from", message.author.username);
                }
                            
                // Get password from settings
                const password = settings.store.encryptionPassword;
                            
                if (!password) {
                    if (settings.store.enableLogging) {
                        console.log("Encryptcord: No password set");
                    }
                    return;
                }
                
                try {
                    // Extract encrypted message (removing extra characters)
                    const encryptedPart = message.content.substring(12, message.content.length - 8);
                                
                    if (settings.store.enableLogging) {
                        console.log("Encryptcord: Extracted encrypted part:", encryptedPart);
                        console.log("Encryptcord: Encrypted part length:", encryptedPart.length);
                        console.log("Encryptcord: Password used:", password);
                    }
                                
                    // Decode the message
                    const decryptedMessage = await decryptAES(encryptedPart, password);
                                
                    if (settings.store.enableLogging) {
                        console.log("Encryptcord: Message decrypted successfully", decryptedMessage);
                    }
                                
                    // Show decrypted message as bot message (Clyde)
                    sendBotMessage(channelId, {
                        content: `🔐 **Decrypted message from ${message.author.username}**: ${decryptedMessage}`
                    });
                                
                    if (settings.store.enableLogging) {
                        console.log("Encryptcord: Sent bot message with decrypted content");
                    }
                } catch (error) {
                    console.error("Decryption error:", error);
                    
                    // Show error message
                    sendBotMessage(channelId, {
                        content: `🔒 Decryption error for message from ${message.author.username}. Details: ${(error as Error).message}`
                    });
                }
                
                // Prevent display of original encrypted message
                return;
            } else {
                // Don't log non-encrypted messages
                return;
            }
        },
    },

    start() {
        // Add listener to encrypt messages before sending
        const listener: MessageSendListener = async (_, message) => {
            if (settings.store.enableEncryption && settings.store.encryptionPassword) {
                // Encrypt message only if not already encrypted
                if (!message.content.startsWith("🔒ENCRYPTED:") && !message.content.endsWith(":ENDLOCK")) {
                    try {
                        const encryptedMessage = await encryptAES(message.content, settings.store.encryptionPassword);
                        // Replace message content with encrypted version
                        message.content = `🔒ENCRYPTED:${encryptedMessage}:ENDLOCK`;
                    } catch (error) {
                        console.error("Message encryption error:", error);
                        // If encryption fails, show error message
                        sendBotMessage(message.channel_id ?? "", {
                            content: "❌ Message encryption error. Check password."
                        });
                    }
                }
            }
        };

        addMessagePreSendListener(listener);
        // Save listener to remove it later
        (this as any)._listener = listener;
        
        console.log("Encryptcord: Plugin loaded successfully");
    },

    stop() {
        // Remove listener when plugin is stopped
        if ((this as any)._listener) {
            removeMessagePreSendListener((this as any)._listener);
        }
        
        console.log("Encryptcord: Plugin stopped");
    },

    commands: [
        {
            name: "securecord",
            description: "Manage Encryptcord encryption settings",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "action",
                    description: "Enable or disable encryption",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                    choices: [
                        { name: "Enable", value: "enable" },
                        { name: "Disable", value: "disable" }
                    ]
                }
            ],
            execute: async (args, ctx) => {
                const action = findOption(args, "action", "");
                
                if (action === "enable") {
                    settings.store.enableEncryption = true;
                    sendBotMessage(ctx.channel.id, {
                        content: "🔐 Encryptcord encryption **enabled**!"
                    });
                } else if (action === "disable") {
                    settings.store.enableEncryption = false;
                    sendBotMessage(ctx.channel.id, {
                        content: "🔓 Encryptcord encryption **disabled**!"
                    });
                } else {
                    sendBotMessage(ctx.channel.id, {
                        content: "❌ Invalid action. Use 'enable' or 'disable'."
                    });
                }
            }
        }
    ]
});
