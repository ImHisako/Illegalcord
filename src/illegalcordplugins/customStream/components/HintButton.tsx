/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Tooltip } from "@webpack/common";
import type { MouseEvent, ReactNode } from "react";

import { cl } from "../utils";

export function HintButton({ hint, className, disabled, onClick, children }: {
    hint: string;
    className?: string;
    disabled?: boolean;
    onClick?(event: MouseEvent<HTMLButtonElement>): void;
    children: ReactNode;
}) {
    return (
        <Tooltip text={hint}>
            {({ onMouseEnter, onMouseLeave }) => (
                <button
                    type="button"
                    className={className ?? cl("icon-button")}
                    aria-label={hint}
                    aria-disabled={disabled || undefined}
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                    onClick={event => {
                        event.stopPropagation();
                        if (!disabled) onClick?.(event);
                    }}
                >
                    {children}
                </button>
            )}
        </Tooltip>
    );
}
