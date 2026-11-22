/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, TextButton } from "@components/Button";
import { LazyComponent } from "@utils/lazyReact";
import { Alerts, ContextMenuApi, Menu, React, showToast, useCallback, useRef, useState } from "@webpack/common";
import type { DragEvent, MouseEvent } from "react";

import { imagesToZip, safeFileName } from "../archive";
import { formatSize } from "../format";
import { T } from "../i18n";
import { MAX_IMAGES_PER_PROFILE, moveImage, Profile, removeImages, shuffleImages, StoredImage } from "../library";
import { downloadBlob } from "../media";
import { airChanged, chooseImage, getPendingImage, getSentImage, getUpcomingIndex, getUploader } from "../onAir";
import { settings } from "../settings";
import { cl, logger, useEmitter } from "../utils";
import { HintButton } from "./HintButton";
import { CheckIcon, DownloadIcon, ExpandIcon, MoreIcon, PlusIcon, TrashIcon } from "./icons";
import { Thumb } from "./shared";

const DRAG_TYPE = "application/x-vc-cs-image";

interface Modifiers {
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
}

interface TileHandlers {
    click(modifiers: Modifiers, index: number): void;
    toggle(index: number): void;
    view(index: number): void;
    download(index: number): void;
    remove(index: number): void;
    dragStart(event: DragEvent, index: number): void;
    dragOver(event: DragEvent, index: number): void;
    drop(event: DragEvent, index: number): void;
    dragEnd(): void;
}

interface TileProps {
    image: StoredImage;
    index: number;
    isNext: boolean;
    nextTag: string;
    isLive: boolean;
    isSending: boolean;
    isSelected: boolean;
    isDropTarget: boolean;
    isDragged: boolean;
    handlers: TileHandlers;
}

function TileView({ image, index, isNext, nextTag, isLive, isSending, isSelected, isDropTarget, isDragged, handlers }: TileProps) {
    const tag = isLive ? T.tagLive : isSending ? T.tagSending : isNext ? nextTag : null;

    return (
        <div
            className={cl("tile", {
                "tile-next": isNext,
                "tile-live": isLive,
                "tile-selected": isSelected,
                "tile-drop": isDropTarget,
                "tile-dragged": isDragged
            })}
            draggable
            role="button"
            tabIndex={0}
            aria-pressed={isNext}
            aria-label={T.imageAria(index + 1)}
            onClick={e => handlers.click(e, index)}
            onKeyDown={e => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handlers.click(e, index);
                }
            }}
            onDragStart={e => handlers.dragStart(e, index)}
            onDragOver={e => handlers.dragOver(e, index)}
            onDrop={e => handlers.drop(e, index)}
            onDragEnd={handlers.dragEnd}
        >
            <Thumb image={image} />

            <span className={cl("tile-number")}>{index + 1}</span>
            {tag && <span className={cl("tile-tag", isLive ? "tile-tag-live" : isSending ? "tile-tag-sending" : "tile-tag-next")}>{tag}</span>}

            <button
                type="button"
                className={cl("tile-check")}
                aria-label={isSelected ? T.deselect : T.select}
                aria-pressed={isSelected}
                onClick={e => {
                    e.stopPropagation();
                    handlers.toggle(index);
                }}
            >
                <CheckIcon size={14} />
            </button>

            <div className={cl("tile-actions")}>
                <HintButton hint={T.view} className="" onClick={() => handlers.view(index)}>
                    <ExpandIcon size={16} />
                </HintButton>
                <HintButton hint={T.download(formatSize(image.blob.size))} className="" onClick={() => handlers.download(index)}>
                    <DownloadIcon size={16} />
                </HintButton>
                <HintButton hint={T.delete} className={cl("tile-delete")} onClick={() => handlers.remove(index)}>
                    <TrashIcon size={16} />
                </HintButton>
            </div>
        </div>
    );
}

const Tile = LazyComponent(() => React.memo(TileView));

export function Library({ profile, busy, onAdd, onAddArchive, onView }: {
    profile: Profile;
    busy: boolean;
    onAdd(): void;
    onAddArchive(): void;
    onView(index: number): void;
}) {
    useEmitter(airChanged);
    const { slideshowEnabled } = settings.use(["slideshowEnabled", "slideshowRandom", "replaceEnabled", "language"]);

    const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
    const [drag, setDrag] = useState<{ from: number; over: number | null; } | null>(null);
    const anchorRef = useRef(0);
    const dragFrom = useRef<number | null>(null);

    const live = getUploader().sentAt > 0 ? getSentImage()?.id ?? null : null;
    const sending = getPendingImage()?.id ?? null;
    const upcoming = getUpcomingIndex(profile);
    const { images } = profile;

    const latest = useRef({ images, selected, onView });
    latest.current = { images, selected, onView };

    const [handlers] = useState<TileHandlers>(() => {
        const toggle = (index: number) => {
            const id = latest.current.images[index]?.id;
            if (!id) return;
            anchorRef.current = index;
            setSelected(prev => {
                const next = new Set(prev);
                if (!next.delete(id)) next.add(id);
                return next;
            });
        };

        return {
            toggle,
            click(modifiers, index) {
                const { images, selected } = latest.current;
                if (!images[index]) return;

                if (modifiers.shiftKey) {
                    const start = Math.min(anchorRef.current, index);
                    const end = Math.max(anchorRef.current, index);
                    setSelected(prev => new Set([...prev, ...images.slice(start, end + 1).map(image => image.id)]));
                    return;
                }

                if (modifiers.ctrlKey || modifiers.metaKey || selected.size > 0) {
                    toggle(index);
                    return;
                }

                anchorRef.current = index;
                chooseImage(index);
            },
            view(index) {
                latest.current.onView(index);
            },
            download(index) {
                const image = latest.current.images[index];
                if (image) downloadBlob(image.blob, `stream-preview-${index + 1}.jpg`);
            },
            remove(index) {
                const image = latest.current.images[index];
                if (image) void removeImages(profile.id, new Set([image.id]));
            },
            dragStart(event, index) {
                event.stopPropagation();
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(index + 1));
                event.dataTransfer.setData(DRAG_TYPE, String(index));
                dragFrom.current = index;
                setDrag({ from: index, over: null });
            },
            dragOver(event, index) {
                if (dragFrom.current === null) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                setDrag(prev => (prev && prev.over !== index ? { ...prev, over: index } : prev ?? { from: dragFrom.current!, over: index }));
            },
            drop(event, index) {
                const from = dragFrom.current;
                if (from === null) return;
                event.preventDefault();
                event.stopPropagation();
                dragFrom.current = null;
                setDrag(null);
                void moveImage(profile.id, from, index);
            },
            dragEnd() {
                dragFrom.current = null;
                setDrag(null);
            }
        };
    });

    const clearSelection = useCallback(() => setSelected(new Set()), []);
    const selectedCount = images.filter(image => selected.has(image.id)).length;

    const deleteSelected = () => {
        const ids = new Set(images.filter(image => selected.has(image.id)).map(image => image.id));
        Alerts.show({
            title: T.deleteImagesTitle(ids.size),
            body: T.deleteImagesBody,
            confirmText: T.delete,
            cancelText: T.cancel,
            confirmColor: "red",
            onConfirm: async () => {
                await removeImages(profile.id, ids);
                clearSelection();
            }
        });
    };

    const deleteAll = () => Alerts.show({
        title: T.deleteAllTitle(profile.name),
        body: T.deleteAllBody(images.length),
        confirmText: T.deleteAll,
        cancelText: T.cancel,
        confirmColor: "red",
        onConfirm: async () => {
            await removeImages(profile.id, new Set(images.map(image => image.id)));
            clearSelection();
        }
    });

    const full = images.length >= MAX_IMAGES_PER_PROFILE;

    const confirmShuffle = () => Alerts.show({
        title: T.shuffleTitle(profile.name),
        body: T.shuffleBody,
        confirmText: T.shuffleConfirm,
        cancelText: T.cancel,
        onConfirm: async () => {
            await shuffleImages(profile.id);
            showToast({ text: T.shuffled, variant: "success" });
        }
    });

    const exportZip = async () => {
        try {
            const archive = await imagesToZip(images);
            downloadBlob(archive, `${safeFileName(profile.name)}.zip`);
        } catch (error) {
            logger.error("Could not build the archive", error);
            showToast({ text: T.exportFailed, variant: "critical" });
        }
    };

    const openMore = (event: MouseEvent<HTMLButtonElement>) => ContextMenuApi.openContextMenu(event, () => (
        <Menu.Menu navId="vc-cs-more" onClose={ContextMenuApi.closeContextMenu} aria-label={T.moreActions}>
            <Menu.MenuItem id="vc-cs-shuffle" label={T.shuffleAll} disabled={images.length < 2} action={confirmShuffle} />
            <Menu.MenuItem id="vc-cs-export" label={T.exportZip} disabled={images.length === 0} action={() => void exportZip()} />
            <Menu.MenuItem id="vc-cs-import" label={T.importZip} disabled={busy || full} action={onAddArchive} />
            <Menu.MenuSeparator />
            <Menu.MenuItem id="vc-cs-delete-all" label={T.deleteAll} color="danger" disabled={images.length === 0} action={deleteAll} />
        </Menu.Menu>
    ));

    return (
        <section className={cl("library")}>
            <div className={cl("toolbar")}>
                {selectedCount > 0 ? (
                    <>
                        <span className={cl("toolbar-label")}>{T.selectedCount(selectedCount)}</span>
                        <div className={cl("toolbar-actions")}>
                            <TextButton variant="secondary" onClick={clearSelection}>{T.cancel}</TextButton>
                            <Button variant="dangerPrimary" size="small" onClick={deleteSelected}>{T.delete}</Button>
                        </div>
                    </>
                ) : (
                    <>
                        <span className={cl("toolbar-label")}>
                            <strong>{images.length}</strong> {T.countOf} {MAX_IMAGES_PER_PROFILE}
                            {images.length > 1 && <span className={cl("toolbar-hint")}>{slideshowEnabled ? T.hintSendNext : T.hintUse}</span>}
                        </span>
                        <div className={cl("toolbar-actions")}>
                            <HintButton hint={T.moreActions} onClick={openMore}>
                                <MoreIcon size={18} />
                            </HintButton>
                            <Button size="small" disabled={busy || full} onClick={onAdd}>
                                <PlusIcon size={16} />
                                {busy ? T.adding : T.addImages}
                            </Button>
                        </div>
                    </>
                )}
            </div>

            {images.length > 0 ? (
                <div className={cl("grid", { "grid-selecting": selectedCount > 0 })}>
                    {images.map((image, index) => (
                        <Tile
                            key={image.id}
                            image={image}
                            index={index}
                            isNext={index === upcoming && image.id !== live && image.id !== sending}
                            nextTag={slideshowEnabled && images.length > 1 ? T.tagNext : T.tagSelected}
                            isLive={image.id === live}
                            isSending={image.id === sending && image.id !== live}
                            isSelected={selected.has(image.id)}
                            isDropTarget={drag?.over === index && drag.from !== index}
                            isDragged={drag?.from === index}
                            handlers={handlers}
                        />
                    ))}
                </div>
            ) : (
                <button type="button" className={cl("empty")} onClick={onAdd} disabled={busy}>
                    <PlusIcon size={24} />
                    <span className={cl("empty-title")}>{T.emptyTitle}</span>
                    <span className={cl("empty-note")}>{T.emptyNote}</span>
                </button>
            )}
        </section>
    );
}
