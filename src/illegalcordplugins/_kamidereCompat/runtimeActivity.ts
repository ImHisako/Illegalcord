/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type KamidereRuntimeTaskStatus = "running" | "completed" | "cancelled" | "failed";
export const SEND_TRAIL_PURGE_TASK_ID = "kamidere-send-trail:purge";

export interface KamidereRuntimeTask {
    id: string;
    toolId: "send-trail-purge" | "mutual-scanner" | "manual-cache-warmup";
    name: string;
    status: KamidereRuntimeTaskStatus;
    subtitle?: string;
    detail?: string;
    progressCurrent?: number;
    progressTotal?: number | null;
    startedAt: number;
    updatedAt: number;
}

const taskMap = new Map<string, KamidereRuntimeTask>();
const listeners = new Set<() => void>();
let tasks: KamidereRuntimeTask[] = [];

function publishTasks() {
    tasks = Array.from(taskMap.values()).sort((left, right) => left.startedAt - right.startedAt);
    listeners.forEach(listener => listener());
}

export function subscribeKamidereRuntimeActivity(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function getKamidereRuntimeTasks() {
    return tasks;
}

export function getKamidereRuntimeTask(id: string) {
    return taskMap.get(id);
}

export function upsertKamidereRuntimeTask(task: Omit<KamidereRuntimeTask, "updatedAt"> & { updatedAt?: number; }) {
    taskMap.set(task.id, {
        ...task,
        updatedAt: task.updatedAt ?? Date.now(),
    });
    publishTasks();
}

export function removeKamidereRuntimeTask(taskId: string, startedAt?: number) {
    if (startedAt !== undefined && taskMap.get(taskId)?.startedAt !== startedAt) return;
    if (taskMap.delete(taskId)) publishTasks();
}
