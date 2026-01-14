/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { sendBotMessage } from "@api/Commands";
import { addMessagePreSendListener, removeMessagePreSendListener, MessageSendListener } from "@api/MessageEvents";
import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { Devs } from "@utils/constants";
import definePlugin, { IconComponent, OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { FluxDispatcher, MessageActions } from "@webpack/common";

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

// Icone SVG per il bottone
function EncryptionChatIcon() {
    return (
        <svg width="20" height="20" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM8.9 6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2H8.9V6z" />
        </svg>
    );
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

// Bottone nella chatbar
const EncryptionToggleButton: ChatBarButtonFactory = ({ channel, type }) => {
    const { enableEncryption } = settings.use(["enableEncryption"]);

    const validChat = ["normal", "sidebar"].some(x => type.analyticsName === x);

    if (!validChat) return null;

    return (
        <ChatBarButton
            tooltip={enableEncryption ? "Disable Encryption" : "Enable Encryption"}
            onClick={() => {
                const newValue = !enableEncryption;
                settings.store.enableEncryption = newValue;

                // Show confirmation
                sendBotMessage(
                    channel?.id ?? "",
                    {
                        content: `🔐 Encryption ${newValue ? "enabled" : "disabled"}!`
                    }
                );
            }}
        >
            {enableEncryption ? <EncryptionEnabledIcon /> : <EncryptionDisabledIcon />}
        </ChatBarButton>
    );
};

// Plugin settings definition
const settings = definePluginSettings({
    encryptionPassword: {
        type: OptionType.STRING,
        description: "AES-256 encryption password (shared with other users)",
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
    description: "AES-256 end-to-end encryption for Discord. Share the same password with other users to communicate securely.",
    authors: [Devs.Ven],
    settings,
    chatBarButton: {
        icon: EncryptionChatIcon,
        render: EncryptionToggleButton
    },

    flux: {
        async MESSAGE_CREATE({ optimistic, type, message, channelId }: IMessageCreate) {
            if (optimistic || type !== "MESSAGE_CREATE") return;
            if (message.state === "SENDING") return;
            if (!message.content) return;

            // Controlla se il messaggio è crittato
            if (message.content.startsWith("🔒ENCRYPTED:") && message.content.endsWith(":ENDLOCK")) {
                if (settings.store.enableLogging) {
                    console.log("Securecord: Ricevuto messaggio crittato da", message.author.username);
                }

                // Ottieni la password dalle impostazioni
                const password = settings.store.encryptionPassword;

                if (!password) {
                    if (settings.store.enableLogging) {
                        console.log("Securecord: Nessuna password impostata");
                    }
                    return;
                }

                try {
                    // Estrae il messaggio crittato (rimuovendo i caratteri extra)
                    const encryptedPart = message.content.substring(12, message.content.length - 8);

                    if (settings.store.enableLogging) {
                        console.log("Securecord: Parte crittata estratta:", encryptedPart);
                        console.log("Securecord: Lunghezza parte crittata:", encryptedPart.length);
                        console.log("Securecord: Password utilizzata:", password);
                    }

                    // Decodifica il messaggio
                    const decryptedMessage = await decryptAES(encryptedPart, password);

                    if (settings.store.enableLogging) {
                        console.log("Securecord: Messaggio decrittato con successo", decryptedMessage);
                    }

                    // Mostra il messaggio decrittato come messaggio di bot (Clyde)
                    sendBotMessage(channelId, {
                        content: `🔐 **Messaggio decrittato da ${message.author.username}**: ${decryptedMessage}`
                    });

                    if (settings.store.enableLogging) {
                        console.log("Securecord: Inviato messaggio di bot con contenuto decrittato");
                    }
                } catch (error) {
                    console.error("Errore decrittazione:", error);

                    // Mostra un messaggio di errore
                    sendBotMessage(channelId, {
                        content: `🔒 Errore decrittazione messaggio da ${message.author.username}. Dettagli: ${(error as Error).message}`
                    });
                }

                // Previene la visualizzazione del messaggio crittato originale
                return;
            } else {
                // Non loggare messaggi non crittati
                return;
            }
        },
    },

    start() {
        // Aggiungi il listener per crittare i messaggi prima dell'invio
        const listener: MessageSendListener = async (_, message) => {
            if (settings.store.enableEncryption && settings.store.encryptionPassword) {
                // Critta il messaggio solo se non è già crittato
                if (!message.content.startsWith("🔒ENCRYPTED:") && !message.content.endsWith(":ENDLOCK")) {
                    try {
                        const encryptedMessage = await encryptAES(message.content, settings.store.encryptionPassword);
                        // Sostituisci il contenuto del messaggio con quello crittato
                        message.content = `🔒ENCRYPTED:${encryptedMessage}:ENDLOCK`;
                    } catch (error) {
                        console.error("Errore crittazione messaggio:", error);
                        // Se la crittazione fallisce, mostra un messaggio di errore
                        sendBotMessage(message.channel_id ?? "", {
                            content: "❌ Errore crittazione messaggio. Verifica la password."
                        });
                    }
                }
            }
        };

        addMessagePreSendListener(listener);
        // Salviamo il listener per poterlo rimuovere dopo
        (this as any)._listener = listener;

        console.log("Securecord: Plugin caricato correttamente");
    },

    stop() {
        // Rimuovi il listener quando il plugin viene fermato
        if ((this as any)._listener) {
            removeMessagePreSendListener((this as any)._listener);
        }

        console.log("Securecord: Plugin arrestato");
    }
});
