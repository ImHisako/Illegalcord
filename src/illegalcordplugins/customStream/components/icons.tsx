/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ReactNode } from "react";

interface IconProps {
    size?: number;
    className?: string;
}

function Svg({ size = 16, className, children }: IconProps & { children: ReactNode; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
            {children}
        </svg>
    );
}

export const ExpandIcon = (props: IconProps) => (
    <Svg {...props}>
        <path d="M4 4h6v2H7.41l3.3 3.29-1.42 1.42L6 7.41V10H4V4Zm16 16h-6v-2h2.59l-3.3-3.29 1.42-1.42L18 16.59V14h2v6Z" />
    </Svg>
);

export const DownloadIcon = (props: IconProps) => (
    <Svg {...props}>
        <path d="M11 3h2v9.59l3.3-3.3 1.4 1.42L12 16.4l-5.7-5.7 1.4-1.4 3.3 3.29V3Zm-7 15h2v2h12v-2h2v4H4v-4Z" />
    </Svg>
);

export const TrashIcon = (props: IconProps) => (
    <Svg {...props}>
        <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h1.5v-8H10Zm2.5 0v8H14v-8h-1.5Z" />
    </Svg>
);

export const CheckIcon = (props: IconProps) => (
    <Svg {...props}>
        <path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7 9.5 16.2Z" />
    </Svg>
);

export const PlusIcon = (props: IconProps) => (
    <Svg {...props}>
        <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
    </Svg>
);

export const CloseIcon = (props: IconProps) => (
    <Svg {...props}>
        <path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z" />
    </Svg>
);

export const ChevronIcon = ({ direction, ...props }: IconProps & { direction: "left" | "right"; }) => (
    <Svg {...props}>
        <path d={direction === "left" ? "M15.4 5 8.4 12l7 7 1.4-1.4L11.2 12l5.6-5.6L15.4 5Z" : "m8.6 5 7 7-7 7-1.4-1.4 5.6-5.6-5.6-5.6L8.6 5Z"} />
    </Svg>
);

export const MoreIcon = (props: IconProps) => (
    <Svg {...props}>
        <path d="M6 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
    </Svg>
);

export const ScreenIcon = (props: IconProps) => (
    <Svg {...props}>
        <path d="M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v9h16V6H4Z" />
    </Svg>
);
