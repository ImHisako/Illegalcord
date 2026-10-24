/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import BannersEverywhere from "@equicordplugins/bannersEverywhere";
import StaffDetector from "@illegalcordplugins/StaffDetector";
import CallTimer from "@plugins/callTimer";
import type { ReactNode } from "react";

interface VisualProps {
    render(): ReactNode;
    fallback?: ReactNode;
}

export function installVisualPrivacy(isInterfaceHidden: () => boolean, useInterfaceHidden: () => boolean) {
    const Visual = ErrorBoundary.wrap(function Visual({ render, fallback = null }: VisualProps) {
        return useInterfaceHidden() ? fallback : render();
    }, { noop: true });
    const { renderVoiceName } = StaffDetector;
    const { renderTimer, renderConnectionTimer } = CallTimer;
    const { memberListBannerHook, nameplate } = BannersEverywhere;

    StaffDetector.renderVoiceName = (props, children) => <Visual fallback={children} render={() => renderVoiceName.call(StaffDetector, props, children)} />;
    CallTimer.renderTimer = userId => <Visual render={() => renderTimer.call(CallTimer, userId)} />;
    CallTimer.renderConnectionTimer = props => <Visual render={() => renderConnectionTimer.call(CallTimer, props)} />;
    BannersEverywhere.memberListBannerHook = (user, plate) => <Visual render={() => memberListBannerHook.call(BannersEverywhere, user, plate)} />;
    BannersEverywhere.nameplate = plate => isInterfaceHidden() ? plate : nameplate.call(BannersEverywhere, plate);

    return () => {
        StaffDetector.renderVoiceName = renderVoiceName;
        CallTimer.renderTimer = renderTimer;
        CallTimer.renderConnectionTimer = renderConnectionTimer;
        BannersEverywhere.memberListBannerHook = memberListBannerHook;
        BannersEverywhere.nameplate = nameplate;
    };
}
