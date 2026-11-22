/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { T } from "../i18n";
import { describeAir } from "../status";
import { cl, useNow } from "../utils";
import { useHealth } from "./Health";
import { ScreenIcon } from "./icons";
import { AirView, Thumb, useAirView } from "./shared";

function AirText({ view }: { view: AirView; }) {
    const now = useNow(view.live);
    const status = describeAir({ ...view, now }, T);

    return (
        <div aria-live="polite">
            <div className={cl("air-headline", `tone-${status.tone}`)}>
                <span className={cl("air-dot")} />
                {status.headline}
            </div>
            <div className={cl("air-detail")}>{status.detail}</div>
        </div>
    );
}

export function AirCard() {
    const view = useAirView();
    const health = useHealth();
    const sent = view.live && view.uploader.sentAt > 0;
    const caption = sent ? T.captionViewersSee : view.live && view.pendingImage ? T.captionSending : T.captionGoesFirst;

    return (
        <section className={cl("air")}>
            <figure className={cl("air-preview")}>
                {view.shownImage
                    ? <Thumb image={view.shownImage} />
                    : <div className={cl("air-screen")}><ScreenIcon size={28} /><span>{T.yourScreen}</span></div>}
                {view.live && <span className={cl("live-badge")}>{T.liveBadge}</span>}
                <figcaption className={cl("air-caption")}>{caption}</figcaption>
            </figure>

            <div className={cl("air-body")}>
                {health.swapBroken && view.replaceEnabled && <div className={cl("air-alert")}>{T.healthAlert}</div>}
                <AirText view={view} />
                <p className={cl("air-help")}>{T.howItWorks}</p>
            </div>
        </section>
    );
}
