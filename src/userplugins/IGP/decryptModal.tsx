/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { RenderModalProps } from "@vencord/discord-types";
import { Forms, Modal, openModal, TextArea } from "@webpack/common";

function DecryptModal(props: RenderModalProps & { message: string; verified: boolean; }) {
    return (
        <Modal
            {...props}
            size="lg"
            title={<Forms.FormTitle tag="h4">Decrypted Message</Forms.FormTitle>}
            subtitle={
                <div style={{ color: props.verified ? "green" : "red", fontWeight: "bold", marginTop: "8px" }}>
                    {props.verified ? "Signature verified" : "Signature not verified"}
                </div>
            }
        >
            {/* Text area to mantain message formatting and \n */}
            <TextArea
                value={props.message}
                disabled={true}
                rows={Math.max(5, props.message.split("\n").length + 1)}
                onChange={() => props.message}
            />
        </Modal>
    );
}

export function buildDecryptModal(decryptedMessage: string, verified: boolean) {
    openModal(props => <DecryptModal {...props} message={decryptedMessage} verified={verified} />);
}
