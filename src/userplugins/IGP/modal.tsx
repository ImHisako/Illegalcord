/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { insertTextIntoChatInputBox } from "@utils/discord";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, Forms, Modal, openModal, React, SelectedChannelStore, showToast, TextArea, Toasts, useEffect } from "@webpack/common";

import { encrypt } from "./index";

const localStorageKeysString = "gpgPublicKeys";

function EncryptModal(props: RenderModalProps) {
    // If the user already entered the public key for the recipient he doesn't have to insert it again...
    let recipientId;
    try {
        recipientId = ChannelStore.getChannel(SelectedChannelStore.getChannelId()).recipients[0];
    } catch (e) {
        showToast("Cannot find the recipient id of the message", Toasts.Type.FAILURE);
        throw e;
    }
    const [pKey, setPKey] = React.useState("");
    const [message, setMessage] = React.useState("");
    const [publicKeyDictChange, setPublicKeyDictChange] = React.useState(false);
    const [publicKeys, setPublicKeys] = React.useState({});

    // Execute this code only one time
    useEffect(() => {
        DataStore.get(localStorageKeysString).then(dataStorageKeys => {
            if (dataStorageKeys != null) {
                const parsedKeys = JSON.parse(dataStorageKeys);
                const updatedKeys = { ...publicKeys, ...parsedKeys };
                setPublicKeys(updatedKeys);

                const recipientKey = updatedKeys[recipientId];
                setPKey(recipientKey);
            }
        });
    }, []);

    return (
        <Modal
            {...props}
            title={<Forms.FormTitle tag="h4">PGP/GPG Message</Forms.FormTitle>}
            actions={[{
                text: "Send",
                variant: "primary",
                onClick: () => {
                    try {
                        void encrypt(message, pKey).then(encryptedMessage => {
                            if (publicKeyDictChange) {
                                DataStore.set(localStorageKeysString, JSON.stringify(publicKeys));
                            }

                            insertTextIntoChatInputBox(encryptedMessage);
                            props.onClose();
                        });
                    } catch {
                        props.onClose();
                    }
                }
            }]}
        >
            <Forms.FormTitle tag="h5">Message</Forms.FormTitle>
            <TextArea
                onChange={(e: string) => {
                    setMessage(e);
                }}
            />

            <Forms.FormTitle tag="h5">Recipient public key</Forms.FormTitle>
            <TextArea
                value={pKey}
                onChange={(e: string) => {
                    setPublicKeys({ ...publicKeys, [recipientId]: e });
                    setPublicKeyDictChange(true);
                    setPKey(e);
                }}
            />
        </Modal>
    );
}

export function buildModal() {
    openModal(props => <EncryptModal {...props} />);
}
