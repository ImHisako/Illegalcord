/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ReactDOM, useEffect, useMemo } from "@webpack/common";

import { formatSize } from "../format";
import { T } from "../i18n";
import { StoredImage } from "../library";
import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from "../media";
import { cl } from "../utils";
import { ChevronIcon, CloseIcon } from "./icons";

export function Lightbox({ images, index, onChange, onClose }: {
    images: readonly StoredImage[];
    index: number;
    onChange(index: number): void;
    onClose(): void;
}) {
    const image = images[index];
    const url = useMemo(() => (image ? URL.createObjectURL(image.blob) : null), [image]);
    useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

    useEffect(() => {
        if (!image) onClose();
    }, [image]);

    useEffect(() => {
        const step = (delta: number) => onChange((index + delta + images.length) % images.length);

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape" && event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

            event.preventDefault();
            event.stopImmediatePropagation();

            if (event.key === "Escape") onClose();
            else step(event.key === "ArrowRight" ? 1 : -1);
        };

        window.addEventListener("keydown", onKeyDown, { capture: true });
        return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
    }, [index, images.length]);

    if (!image || !url) return null;

    const browse = images.length > 1;

    return ReactDOM.createPortal(
        <div className={cl("lightbox")} onClick={onClose} role="dialog" aria-label={T.lightboxAria(index + 1, images.length)}>
            <img className={cl("lightbox-image")} src={url} alt="" onClick={e => e.stopPropagation()} />

            <div className={cl("lightbox-bar")} onClick={e => e.stopPropagation()}>
                <span>{index + 1} / {images.length}</span>
                <span className={cl("lightbox-meta")}>{PREVIEW_WIDTH}×{PREVIEW_HEIGHT} · {formatSize(image.blob.size)}</span>
            </div>

            <button type="button" className={cl("lightbox-close")} aria-label={T.close} onClick={onClose}>
                <CloseIcon size={20} />
            </button>

            {browse && (
                <>
                    <button
                        type="button"
                        className={cl("lightbox-nav", "lightbox-prev")}
                        aria-label={T.previous}
                        onClick={e => { e.stopPropagation(); onChange((index - 1 + images.length) % images.length); }}
                    >
                        <ChevronIcon direction="left" size={24} />
                    </button>
                    <button
                        type="button"
                        className={cl("lightbox-nav", "lightbox-next")}
                        aria-label={T.next}
                        onClick={e => { e.stopPropagation(); onChange((index + 1) % images.length); }}
                    >
                        <ChevronIcon direction="right" size={24} />
                    </button>
                </>
            )}
        </div>,
        document.body
    );
}
