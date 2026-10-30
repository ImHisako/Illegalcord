/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Heading } from "@components/Heading";
import { copyWithToast } from "@utils/discord";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, TextArea } from "@webpack/common";

function DecryptModal(props: RenderModalProps & { message: string; verified: boolean; }) {
    return (
        <Modal
            {...props}
            size="lg"
            title={<Heading tag="h4">Decrypted Message</Heading>}
            actions={[{ text: "Copy message", variant: "primary", onClick: () => void copyWithToast(props.message) }]}
            subtitle={
                <div style={{ color: props.verified ? "green" : "red", fontWeight: "bold", marginTop: "8px" }}>
                    {props.verified ? "Signature verified" : "Signature not verified"}
                </div>
            }
        >
            {/* Text area to mantain message formatting and \n */}
            <TextArea
                value={props.message}
                readOnly={true}
                rows={Math.min(15, Math.max(5, props.message.split("\n").length + 1))}
                onChange={() => props.message}
            />
        </Modal>
    );
}

const SafeDecryptModal = ErrorBoundary.wrap(DecryptModal, { noop: true });

export function buildDecryptModal(decryptedMessage: string, verified: boolean) {
    openModal(props => <SafeDecryptModal {...props} message={decryptedMessage} verified={verified} />);
}
