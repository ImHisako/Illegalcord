/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { insertTextIntoChatInputBox } from "@utils/discord";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, Modal, openModal, React, Select, SelectedChannelStore, TextArea, useEffect, UserStore } from "@webpack/common";

import { encrypt, keyManager } from "./index";

const localStorageKeysString = "gpgPublicKeys";

interface EncryptModalProps extends RenderModalProps {
    channelId: string;
}

function EncryptModal(props: EncryptModalProps) {
    const channel = ChannelStore.getChannel(props.channelId);
    const [recipientId, setRecipientId] = React.useState(channel.recipients.length === 1 ? channel.recipients[0] : "");
    const [pKey, setPKey] = React.useState("");
    const [message, setMessage] = React.useState("");
    const [error, setError] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [loadingKey, setLoadingKey] = React.useState(false);
    const mounted = React.useRef(true);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    useEffect(() => {
        let cancelled = false;
        setPKey("");
        setError("");
        setLoadingKey(true);
        const loadKey = async () => {
            try {
                let key = keyManager.getPublicKeyForUser(recipientId) ?? "";
                if (!key && recipientId) {
                    const stored = await DataStore.get<string>(localStorageKeysString);
                    const keys: Record<string, unknown> | null = stored ? JSON.parse(stored) : null;
                    const legacyKey = keys?.[recipientId];
                    if (typeof legacyKey === "string") key = legacyKey;
                }
                if (!cancelled) setPKey(key);
            } catch {
                if (!cancelled) setError("Could not load the saved key. Paste the recipient's public key below.");
            } finally {
                if (!cancelled) setLoadingKey(false);
            }
        };
        void loadKey();
        return () => { cancelled = true; };
    }, [recipientId]);

    return (
        <Modal
            {...props}
            title={<Heading tag="h4">PGP/GPG Message</Heading>}
            subtitle="Encrypt locally, then review and send the draft yourself. Only the selected recipient and you can decrypt it."
            notice={error ? { type: "critical", message: error } : undefined}
            actions={[{
                text: "Encrypt draft",
                variant: "primary",
                loading: busy || loadingKey,
                onClick: async () => {
                    if (busy || loadingKey) return;
                    if (!recipientId || !pKey.trim() || !message.trim()) {
                        setError("Choose a recipient and enter a message and a public key.");
                        return;
                    }
                    setBusy(true);
                    setError("");
                    try {
                        const encryptedMessage = await encrypt(message, pKey);
                        if (!mounted.current) return;
                        if (keyManager.getPublicKeyForUser(recipientId) !== pKey) {
                            await keyManager.importPublicKeyForUser(recipientId, pKey);
                        }
                        if (!mounted.current) return;
                        if (SelectedChannelStore.getChannelId() !== props.channelId) {
                            setError("Return to the original conversation before inserting the encrypted draft.");
                            return;
                        }
                        insertTextIntoChatInputBox(encryptedMessage);
                        props.onClose();
                    } catch (error) {
                        setError(error instanceof Error ? error.message : "Could not encrypt the message.");
                    } finally {
                        setBusy(false);
                    }
                }
            }]}
        >
            <Heading tag="h5">Recipient</Heading>
            <Select
                options={channel.recipients.map(id => ({ label: UserStore.getUser(id)?.username ?? id, value: id }))}
                isSelected={value => value === recipientId}
                select={setRecipientId}
                serialize={value => value}
                placeholder="Choose a recipient"
                isDisabled={busy}
            />
            <Paragraph>The public key you use will also be saved for PGP commands. Verify its fingerprint before using a replacement key.</Paragraph>
            <Heading tag="h5">Message</Heading>
            <TextArea
                value={message}
                disabled={busy}
                onChange={setMessage}
            />

            <Heading tag="h5">Recipient public key</Heading>
            <TextArea
                value={pKey}
                disabled={busy || loadingKey}
                onChange={setPKey}
            />
        </Modal>
    );
}

const SafeEncryptModal = ErrorBoundary.wrap(EncryptModal, { noop: true });

export function buildModal(channelId: string) {
    openModal(props => <SafeEncryptModal {...props} channelId={channelId} />);
}
