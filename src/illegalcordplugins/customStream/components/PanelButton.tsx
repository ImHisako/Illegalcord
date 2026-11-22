/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findComponentByCodeLazy } from "@webpack";
import { ApplicationStreamingStore, useStateFromStores } from "@webpack/common";

import { T } from "../i18n";
import { airChanged, getUploader } from "../onAir";
import { settings } from "../settings";
import { describeAir } from "../status";
import { cl, useEmitter, useNow } from "../utils";
import { useHealth } from "./Health";
import { Thumb, useAirView } from "./shared";

const DiscordPanelButton = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");

function PanelIcon() {
    useEmitter(airChanged);
    const { replaceEnabled } = settings.use(["replaceEnabled"]);
    const live = useStateFromStores([ApplicationStreamingStore], () => ApplicationStreamingStore.getCurrentUserActiveStream() != null);
    const onAir = live && getUploader().sentAt > 0;
    const swapBroken = useHealth().swapBroken && replaceEnabled;

    return (
        <span className={cl("panel-icon", { "panel-icon-off": !replaceEnabled })}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                <path
                    fill="currentColor"
                    d="M21 3H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5v2h8v-2h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 14H3V5h18v12Z"
                />
                <path
                    className={cl("panel-icon-picture")}
                    d="M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm6 7-3-3-3 3-3-3-3 3v1h12v-1Z"
                />
            </svg>
            {swapBroken
                ? <span className={cl("panel-icon-alert")} />
                : onAir && <span className={cl("panel-icon-live")} />}
        </span>
    );
}

function PanelTooltip() {
    const view = useAirView();
    const now = useNow(view.live);
    const status = describeAir({ ...view, now }, T);

    return (
        <div className={cl("tip")}>
            {view.shownImage && <Thumb image={view.shownImage} className={cl("tip-image")} />}
            <div className={cl("tip-headline", `tone-${status.tone}`)}>{status.headline}</div>
            <div className={cl("tip-detail")}>{status.detail}</div>
        </div>
    );
}

export function StreamPreviewPanelButton({ nameplate, onOpen }: { nameplate?: unknown; onOpen(): void; }) {
    const { showPanelButton } = settings.use(["showPanelButton"]);
    if (!showPanelButton) return null;

    return (
        <DiscordPanelButton
            tooltipText={<PanelTooltip />}
            aria-label={T.panelAria}
            icon={PanelIcon}
            onClick={onOpen}
            plated={nameplate != null}
        />
    );
}
