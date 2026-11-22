/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Switch } from "@components/Switch";

import { T } from "../i18n";
import { settings } from "../settings";
import { cl } from "../utils";

function Option({ title, note, checked, disabled, onChange }: {
    title: string;
    note: string;
    checked: boolean;
    disabled?: boolean;
    onChange(value: boolean): void;
}) {
    return (
        <label className={cl("option", { "option-disabled": disabled })}>
            <span className={cl("option-text")}>
                <span className={cl("option-title")}>{title}</span>
                <span className={cl("option-note")}>{note}</span>
            </span>
            <Switch checked={checked} disabled={disabled} onChange={onChange} />
        </label>
    );
}

export function PlaybackControls() {
    const { replaceEnabled, slideshowEnabled, slideshowRandom } = settings.use(["replaceEnabled", "slideshowEnabled", "slideshowRandom", "language"]);
    const orderDisabled = !replaceEnabled || !slideshowEnabled;

    return (
        <div className={cl("options")}>
            <Option
                title={T.useMyImages}
                note={replaceEnabled ? T.noteReplaceOn : T.noteReplaceOff}
                checked={replaceEnabled}
                onChange={value => { settings.store.replaceEnabled = value; }}
            />
            <Option
                title={T.slideshow}
                note={slideshowEnabled ? T.noteSlideshowOn : T.noteSlideshowOff}
                checked={slideshowEnabled}
                disabled={!replaceEnabled}
                onChange={value => { settings.store.slideshowEnabled = value; }}
            />
            <div className={cl("option", { "option-disabled": orderDisabled })}>
                <span className={cl("option-text")}>
                    <span className={cl("option-title")}>{T.order}</span>
                    <span className={cl("option-note")}>{slideshowRandom ? T.noteShuffle : T.noteInOrder}</span>
                </span>
                <div className={cl("segmented")} role="radiogroup" aria-label={T.orderAria}>
                    {([[T.inOrder, false], [T.shuffle, true]] as const).map(([label, value]) => (
                        <button
                            key={label}
                            type="button"
                            role="radio"
                            aria-checked={slideshowRandom === value}
                            disabled={orderDisabled}
                            className={cl("segment", { "segment-active": slideshowRandom === value })}
                            onClick={() => { settings.store.slideshowRandom = value; }}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
