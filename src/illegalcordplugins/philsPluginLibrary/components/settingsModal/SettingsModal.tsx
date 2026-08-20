/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { Flex } from "@components/Flex";
import type { ModalSize, RenderModalProps } from "@vencord/discord-types";
import { Modal } from "@webpack/common";
import type { JSX, ReactNode } from "react";

import { ContributorAuthorSummary } from "../../../philsPluginLibrary/components/ContributorAuthorSummary";
import { Author, Contributor } from "../../../philsPluginLibrary/types";

export interface SettingsModalProps extends RenderModalProps {
    title?: string;
    size?: ModalSize;
    onClose: () => void;
    onDone?: () => void;
    children?: ReactNode;
    footerContent?: JSX.Element;
    closeButtonName?: string;
    author?: Author,
    contributors?: Contributor[];
}

export const SettingsModal = (props: SettingsModalProps) => {
    const { author, children, closeButtonName, contributors, footerContent, onDone, size = "md", title, ...modalProps } = props;
    const hasFooterInput = !!footerContent || !!author || !!contributors?.length;

    return (
        <Modal
            {...modalProps}
            size={size}
            title={title ?? ""}
            actionBarInput={hasFooterInput
                ? (
                    <Flex style={{ alignItems: "center", gap: "1em" }}>
                        {(author || contributors && contributors.length > 0) &&

                            <Flex style={{ justifyContent: "flex-start", alignItems: "center" }}>
                                <ContributorAuthorSummary
                                    author={author}
                                    contributors={contributors} />
                            </Flex>
                        }
                        {footerContent}
                    </Flex>
                )
                : undefined}
            actions={[{
                text: closeButtonName ?? "Done",
                variant: "primary",
                onClick: onDone ?? props.onClose
            }]}
        >
            <div style={{ marginBottom: "1em", display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: "1em" }}>
                {children}
            </div>
        </Modal>
    );
};
