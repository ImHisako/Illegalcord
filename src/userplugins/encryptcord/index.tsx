/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { sendBotMessage } from "@api/Commands";
import { addMessagePreSendListener, removeMessagePreSendListener, MessageSendListener } from "@api/MessageEvents";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
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

// Definizione delle impostazioni del plugin
const settings = definePluginSettings({
    encryptionPassword: {
        type: OptionType.STRING,
        description: "Password per la crittografia AES-256 (condivisa con gli altri utenti)",
        default: "",
        placeholder: "Inserisci la password condivisa..."
    },
    enableEncryption: {
        type: OptionType.BOOLEAN,
        description: "Attiva/disattiva la crittografia dei messaggi",
        default: false
    }
});

export default definePlugin({
    name: "Encryptcord",
    description: "Crittografia AES-256 end-to-end per Discord. Condividi la stessa password con gli altri utenti per comunicare in modo sicuro.",
    authors: [Devs.Inbestigator],
    settings,
    
    flux: {
        async MESSAGE_CREATE({ optimistic, type, message, channelId }: IMessageCreate) {
            if (optimistic || type !== "MESSAGE_CREATE") return;
            if (message.state === "SENDING") return;
            if (!message.content) return;

            console.log("Encryptcord: Ricevuto messaggio", message.content.substring(0, 50));
            
            // Controlla se il messaggio è crittato
            if (message.content.startsWith("🔒ENCRYPTED:") && message.content.endsWith(":ENDLOCK")) {
                console.log("Encryptcord: Trovato messaggio crittato da", message.author.username);
                
                // Ottieni la password dalle impostazioni
                const password = settings.store.encryptionPassword;
                
                if (!password) {
                    console.log("Encryptcord: Nessuna password impostata");
                    // Se non c'è password, mostra un messaggio informativo
                    const warningMsg = {
                        ...message,
                        content: `🔒 Messaggio crittato da ${message.author.username} (password non impostata)`,
                        author: message.author,
                        type: message.type,
                        flags: message.flags,
                    };
                    
                    await MessageActions.receiveMessage(channelId, warningMsg);
                    return;
                }

                try {
                    // Estrae il messaggio crittato
                    const encryptedPart = message.content.substring(11, message.content.length - 8);
                    
                    console.log("Encryptcord: Tentativo di decrittazione...");
                    
                    // Decodifica il messaggio
                    const decryptedMessage = await decryptAES(encryptedPart, password);
                    
                    console.log("Encryptcord: Messaggio decrittato con successo", decryptedMessage);
                    
                    // Mostra il messaggio decrittato come messaggio di bot (Clyde)
                    sendBotMessage(channelId, {
                        content: `🔐 **Messaggio decrittato da ${message.author.username}**: ${decryptedMessage}`
                    });
                    
                    console.log("Encryptcord: Inviato messaggio di bot con contenuto decrittato");
                } catch (error) {
                    console.error("Errore decrittazione:", error);
                    
                    // Mostra un messaggio di errore
                    sendBotMessage(channelId, {
                        content: `🔒 Errore decrittazione messaggio da ${message.author.username}`
                    });
                }
                
                // Previene la visualizzazione del messaggio crittato originale
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
        
        console.log("Encryptcord: Plugin caricato correttamente");
    },

    stop() {
        // Rimuovi il listener quando il plugin viene fermato
        if ((this as any)._listener) {
            removeMessagePreSendListener((this as any)._listener);
        }
        
        console.log("Encryptcord: Plugin arrestato");
    }
});