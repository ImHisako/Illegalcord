/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./runtimeActivity.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { ClockIcon } from "@components/Icons";
import { classNameFactory } from "@utils/css";
import { Popout, React, SettingsRouter, useEffect, useRef, useState } from "@webpack/common";

import { getKamidereRuntimeTasks, type KamidereRuntimeTask, subscribeKamidereRuntimeActivity } from "./runtimeActivity";

const cl = classNameFactory("vc-kamidere-runtime-");
const mountedButtons = new Set<symbol>();
const buttonListeners = new Set<() => void>();
const taskRoutes: Record<KamidereRuntimeTask["toolId"], string> = {
    "send-trail-purge": "kamidere_send_trail_panel",
    "mutual-scanner": "kamidere_mutual_scanner_panel",
    "manual-cache-warmup": "kamidere_mutual_scanner_panel"
};
const taskStatus = {
    running: "Running",
    completed: "Completed",
    cancelled: "Cancelled",
    failed: "Failed"
};

function subscribeButtons(listener: () => void) {
    buttonListeners.add(listener);
    return () => { buttonListeners.delete(listener); };
}

function RuntimeActivityButton() {
    const [id] = useState(() => Symbol());
    const target = useRef<HTMLDivElement>(null);
    const isOwner = React.useSyncExternalStore(subscribeButtons, () => mountedButtons.values().next().value === id);
    const tasks = React.useSyncExternalStore(subscribeKamidereRuntimeActivity, getKamidereRuntimeTasks);

    useEffect(() => {
        mountedButtons.add(id);
        buttonListeners.forEach(listener => listener());
        return () => {
            mountedButtons.delete(id);
            buttonListeners.forEach(listener => listener());
        };
    }, [id]);

    if (!isOwner) return null;

    return (
        <Popout
            position="bottom"
            align="right"
            targetElementRef={target}
            renderPopout={({ closePopout }) => (
                <section className={cl("panel")} aria-label="Kamidere activity">
                    <BaseText tag="h3" size="md" weight="semibold">Kamidere activity</BaseText>
                    {tasks.length === 0 && <BaseText size="sm" color="text-muted">No tools are running.</BaseText>}
                    {tasks.map(task => (
                        <div key={task.id} className={cl("task")}>
                            <BaseText size="sm" weight="semibold">{task.name}</BaseText>
                            <BaseText size="sm" color="text-muted">{taskStatus[task.status]}</BaseText>
                            {task.subtitle && <BaseText size="sm">{task.subtitle}</BaseText>}
                            {task.detail && <BaseText size="sm" color="text-muted">{task.detail}</BaseText>}
                            {task.progressTotal != null && task.progressTotal > 0 && task.progressCurrent != null && (
                                <progress className={cl("progress")} aria-label={task.name} max={task.progressTotal} value={task.progressCurrent} />
                            )}
                            <Button variant="secondary" size="small" onClick={() => {
                                closePopout();
                                SettingsRouter.openUserSettings(taskRoutes[task.toolId]);
                            }}>
                                Open tool
                            </Button>
                        </div>
                    ))}
                </section>
            )}
        >
            {({ onClick, "aria-expanded": selected }) => (
                <HeaderBarButton
                    ref={target}
                    icon={ClockIcon}
                    tooltip={tasks.find(task => task.status === "running")?.name ?? "Kamidere activity"}
                    selected={selected}
                    onClick={onClick}
                />
            )}
        </Popout>
    );
}

export default ErrorBoundary.wrap(RuntimeActivityButton, { noop: true });
