/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import {
    ApplicationCommandInputType,
    ApplicationCommandOptionType,
    sendBotMessage,
} from "@api/Commands";
import * as DataStore from "@api/DataStore";
import {
    addMessagePreSendListener,
    MessageSendListener,
    removeMessagePreSendListener,
} from "@api/MessageEvents";
import { Devs } from "@utils/constants";
import { sleep } from "@utils/misc";
import definePlugin from "@utils/types";
import { Message } from "@vencord/discord-types";
import {
    ChannelActionCreators,
    FluxDispatcher,
    MessageActions,
    RestAPI,
    SnowflakeUtils,
    useEffect,
    UserStore,
    UserUtils,
    useState,
} from "@webpack/common";

import { getCurrentChannel } from "@utils/discord";
import { findLazy } from "@webpack";

const CloudUpload = findLazy(m => m.prototype?.trackUploadFinished);

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

const ChatBarIcon: ChatBarButtonFactory = ({ isMainChat }) => {
    const [enabled, setEnabled] = useState(false);
    const [buttonDisabled, setButtonDisabled] = useState(false);

    useEffect(() => {
        const listener: MessageSendListener = async (_, message) => {
            if (enabled) {
                // Ottieni il gruppo corrente
                const currentGroupId = await DataStore.get("encryptcord_current_group");
                
                if (!currentGroupId) {
                    sendBotMessage(getCurrentChannel()?.id ?? "", {
                        content: "❌ Nessun gruppo crittografato attivo in questo canale!"
                    });
                    message.content = "";
                    return;
                }

                // Critta il messaggio
                const groupPassword = await DataStore.get(`encryptcord_password_${currentGroupId}`);
                if (!groupPassword) {
                    sendBotMessage(getCurrentChannel()?.id ?? "", {
                        content: "❌ Password del gruppo non trovata!"
                    });
                    message.content = "";
                    return;
                }

                const encryptedMessage = await encryptAES(message.content, groupPassword);
                
                // Invia il messaggio crittato come messaggio normale nel canale
                const groupId = getCurrentChannel()?.id ?? "";
                
                // Invia il messaggio crittato
                await RestAPI.post({
                    url: `/channels/${groupId}/messages`,
                    body: {
                        content: `🔒ENCRYPTED:${encryptedMessage}:ENDLOCK`,
                        nonce: SnowflakeUtils.fromTimestamp(Date.now()),
                    },
                });

                // Interrompe l'invio del messaggio originale
                message.content = "";
            }
        };

        addMessagePreSendListener(listener);
        return () => void removeMessagePreSendListener(listener);
    }, [enabled]);

    if (!isMainChat) return null;

    return (
        <ChatBarButton
            tooltip={enabled ? "Disattiva Criptografia" : "Attiva Criptografia"}
            onClick={async () => {
                const currentChannelId = getCurrentChannel()?.id ?? "";
                
                // Controlla se esiste già un gruppo in questo canale
                const existingGroupId = await DataStore.get("encryptcord_current_group");
                
                if (existingGroupId && existingGroupId === currentChannelId) {
                    // Disattiva la criptografia
                    setEnabled(!enabled);
                    sendBotMessage(currentChannelId, {
                        content: enabled ? "🔓 Criptografia disattivata" : "🔐 Criptografia attivata"
                    });
                    return;
                }

                // Crea un nuovo gruppo o unisciti a uno esistente
                setButtonDisabled(true);
                
                // Genera una password casuale per il gruppo
                const groupPassword = Array.from(crypto.getRandomValues(new Uint8Array(32)))
                    .map(b => b.toString(36))
                    .join('');
                
                await DataStore.set(`encryptcord_password_${currentChannelId}`, groupPassword);
                await DataStore.set("encryptcord_current_group", currentChannelId);
                
                setEnabled(true);
                setButtonDisabled(false);
                
                sendBotMessage(currentChannelId, {
                    content: `🔐 Gruppo crittografato creato! ID: ${currentChannelId.substring(0, 8)}...`
                });
            }}
            buttonProps={{
                style: {
                    transition: "transform 0.3s ease-in-out",
                    transform: `rotate(${enabled ? 0 : 15}deg)`,
                },
                disabled: buttonDisabled,
            }}
        >
            <svg width="24" height="24" viewBox="0 0 129 171">
                <path
                    fill="currentColor"
                    d="M128.93 149.231V74.907a21.142 21.142 0 00-6.195-15.1 21.165 21.165 0 00-15.101-6.195h-1.085V40.918A40.604 40.604 0 0042.214 8.065 40.602 40.602 0 0026.28 32.318h15.972a25.164 25.164 0 0128.043-15.94 25.166 25.166 0 0120.691 24.745v12.694H22.184A21.276 21.276 0 00.89 75.111v74.325a21.27 21.27 0 0013.143 19.679 21.273 21.273 0 008.152 1.615h85.388a21.455 21.455 0 0015.083-6.357 21.453 21.453 0 006.213-15.142h.062zm-63.888-15.765a21.296 21.296 0 01-15.058-36.352 21.296 21.296 0 0136.354 15.057 21.151 21.151 0 01-21.296 21.295z"
                />
            </svg>
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "Encryptcord",
    description: "Criptografia AES-256 end-to-end per Discord",
    authors: [Devs.Inbestigator],
    dependencies: ["CommandsAPI"],
    patches: [],
    flux: {
        async MESSAGE_CREATE({ optimistic, type, message, channelId }: IMessageCreate) {
            if (optimistic || type !== "MESSAGE_CREATE") return;
            if (message.state === "SENDING") return;
            // Process messages from self for immediate decryption display
            const isFromCurrentUser = message.author.id === UserStore.getCurrentUser().id;
            if (!message.content) return;

            // Controlla se il messaggio è crittato
            if (message.content.startsWith("🔒ENCRYPTED:") && message.content.endsWith(":ENDLOCK")) {
                try {
                    // Estrae il messaggio crittato
                    const encryptedPart = message.content.substring(11, message.content.length - 8);
                    
                    // Ottieni la password del gruppo
                    const groupPassword = await DataStore.get(`encryptcord_password_${channelId}`);
                    
                    if (groupPassword) {
                        // Decodifica il messaggio
                        const decryptedMessage = await decryptAES(encryptedPart, groupPassword);
                        
                        // Determina se è un messaggio dell'utente corrente
                        const isFromCurrentUser = message.author.id === UserStore.getCurrentUser().id;
                        
                        // Mostra il messaggio decrittato come messaggio ricevuto
                        const decryptedMsg = {
                            ...message,
                            content: `🔐 ${decryptedMessage}`,
                            author: message.author,
                            type: message.type,
                            flags: message.flags,
                        };
                        
                        // Sostituisci il messaggio crittato con quello decrittato
                        await MessageActions.receiveMessage(channelId, decryptedMsg);
                        
                        // Se è un messaggio dell'utente corrente, cancella il messaggio crittato originale
                        if (isFromCurrentUser) {
                            // Cerchiamo di cancellare il messaggio originale crittato
                            setTimeout(() => {
                                try {
                                    MessageActions.deleteMessage(channelId, message.id);
                                } catch (e) {
                                    // Potrebbe fallire se il messaggio è già stato cancellato
                                }
                            }, 100);
                        }
                    } else {
                        // Se non c'è la password, mostra comunque il messaggio originale
                        // ma con una nota che non è stato possibile decrittare
                        const warningMsg = {
                            ...message,
                            content: `🔒 Messaggio crittato da ${message.author.username} (password gruppo non trovata)`,
                            author: message.author,
                            type: message.type,
                            flags: message.flags,
                        };
                        
                        await MessageActions.receiveMessage(channelId, warningMsg);
                    }
                } catch (error) {
                    console.error("Errore decrittazione:", error);
                    
                    // Mostra un messaggio di errore
                    const errorMsg = {
                        ...message,
                        content: `🔒 Errore decrittazione messaggio da ${message.author.username}`,
                        author: message.author,
                        type: message.type,
                        flags: message.flags,
                    };
                    
                    await MessageActions.receiveMessage(channelId, errorMsg);
                }
                
                // Previene la visualizzazione del messaggio crittato originale
                return;
            }
        },
    },
    commands: [
        {
            name: "encryptcord",
            description: "Comandi per Encryptcord",
            options: [
                {
                    name: "info",
                    description: "Mostra informazioni sul gruppo corrente",
                    type: ApplicationCommandOptionType.SUB_COMMAND,
                },
            ],
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (opts, ctx) => {
                if (opts[0].name === "info") {
                    const groupId = ctx.channel.id;
                    DataStore.get(`encryptcord_password_${groupId}`).then(password => {
                        if (password) {
                            sendBotMessage(ctx.channel.id, {
                                content: `🔐 Gruppo crittografato attivo in questo canale!\nID: ${groupId.substring(0, 8)}...\nCondividi questo canale per permettere ad altri di unirsi al gruppo.`
                            });
                        } else {
                            sendBotMessage(ctx.channel.id, {
                                content: "❌ Nessun gruppo crittografato attivo in questo canale"
                            });
                        }
                    });
                }
            },
        },
    ],
    renderChatBarButton: ChatBarIcon,
    async start() {
        console.log("Encryptcord: Plugin caricato correttamente");
    },
    async stop() {
        console.log("Encryptcord: Plugin arrestato");
    },
});