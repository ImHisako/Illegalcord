/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import { React } from "@webpack/common";

import type { PresenceLabConfig, PresenceLabData, PresenceLabOperator, PresenceLabSession, PresenceLabTarget } from "./types";

const STORAGE_PREFIX = "kamidere-presence-lab:";
const logger = new Logger("PresenceLab");
const listeners = new Set<() => void>();
const cache = new Map<string, PresenceLabData>();

const DEFAULT_CONFIG: PresenceLabConfig = {
    entryDelaySeconds: 18,
    jitterMinSeconds: 6,
    jitterMaxSeconds: 22,
    dwellMinutes: 8,
    neutralProfile: false,
};

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function getStorageKey(userId: string) {
    return `${STORAGE_PREFIX}${userId}`;
}

function cloneConfig(config?: Partial<PresenceLabConfig>): PresenceLabConfig {
    return {
        entryDelaySeconds: config?.entryDelaySeconds ?? DEFAULT_CONFIG.entryDelaySeconds,
        jitterMinSeconds: config?.jitterMinSeconds ?? DEFAULT_CONFIG.jitterMinSeconds,
        jitterMaxSeconds: config?.jitterMaxSeconds ?? DEFAULT_CONFIG.jitterMaxSeconds,
        dwellMinutes: config?.dwellMinutes ?? DEFAULT_CONFIG.dwellMinutes,
        neutralProfile: config?.neutralProfile ?? DEFAULT_CONFIG.neutralProfile,
    };
}

function normalizeList<T extends { addedAt?: number; }>(items?: T[]) {
    return [...(items ?? [])].sort((left, right) => (right.addedAt ?? 0) - (left.addedAt ?? 0));
}

function normalizeSessionList(items?: PresenceLabSession[]) {
    return [...(items ?? [])].sort((left, right) => right.startedAt - left.startedAt);
}

function normalizeData(data?: Partial<PresenceLabData> | null): PresenceLabData {
    return {
        config: cloneConfig(data?.config),
        operators: normalizeList<PresenceLabOperator>(data?.operators),
        targets: normalizeList<PresenceLabTarget>(data?.targets),
        sessions: normalizeSessionList(data?.sessions),
    };
}

const EMPTY_DATA = normalizeData();

function publishData(userId: string, data: PresenceLabData) {
    cache.set(userId, data);
    listeners.forEach(listener => listener());
}

export async function getPresenceLabData(userId: string | null) {
    if (!userId) return normalizeData();
    const previous = cache.get(userId);
    const data = await DataStore.get<PresenceLabData>(getStorageKey(userId));
    const current = cache.get(userId);
    if (current && current !== previous) return current;

    const normalized = normalizeData(data);
    publishData(userId, normalized);
    return normalized;
}

export async function updatePresenceLabData(
    userId: string | null,
    updater: (current: PresenceLabData) => PresenceLabData,
) {
    if (!userId) return normalizeData();
    let nextData = EMPTY_DATA;

    await DataStore.update(getStorageKey(userId), (existing: PresenceLabData | undefined) => {
        nextData = normalizeData(updater(normalizeData(existing)));
        return nextData;
    });

    publishData(userId, nextData);
    return nextData;
}

export async function clearPresenceLabData(userId: string | null) {
    const next = normalizeData();
    if (!userId) return next;

    await DataStore.set(getStorageKey(userId), next);
    publishData(userId, next);
    return next;
}

export async function addPresenceLabOperator(userId: string | null, operator: PresenceLabOperator) {
    return updatePresenceLabData(userId, current => {
        const operators = current.operators.filter(existing => existing.id !== operator.id && existing.discordUserId !== operator.discordUserId);
        operators.unshift(operator);
        return { ...current, operators };
    });
}

export async function removePresenceLabOperator(userId: string | null, operatorId: string) {
    return updatePresenceLabData(userId, current => ({
        ...current,
        operators: current.operators.filter(operator => operator.id !== operatorId),
        sessions: current.sessions.filter(session => session.operatorId !== operatorId),
    }));
}

export async function addPresenceLabTarget(userId: string | null, target: PresenceLabTarget) {
    return updatePresenceLabData(userId, current => {
        const targets = current.targets.filter(existing => existing.id !== target.id && existing.discordUserId !== target.discordUserId);
        targets.unshift(target);
        return { ...current, targets };
    });
}

export async function removePresenceLabTarget(userId: string | null, targetId: string) {
    return updatePresenceLabData(userId, current => ({
        ...current,
        targets: current.targets.filter(target => target.id !== targetId),
        sessions: current.sessions.filter(session => session.targetId !== targetId),
    }));
}

export async function updatePresenceLabTargetState(
    userId: string | null,
    targetId: string,
    patch: Partial<PresenceLabTarget>,
) {
    return updatePresenceLabData(userId, current => ({
        ...current,
        targets: current.targets.map(target =>
            target.id === targetId
                ? { ...target, ...patch }
                : target,
        ),
    }));
}

export async function addPresenceLabSession(userId: string | null, session: PresenceLabSession) {
    return updatePresenceLabData(userId, current => {
        return {
            ...current,
            operators: current.operators.map(operator =>
                operator.id === session.operatorId
                    ? { ...operator, lastUsedAt: session.startedAt }
                    : operator,
            ),
            targets: current.targets.map(target =>
                target.id === session.targetId
                    ? { ...target, lastSeenAt: session.startedAt }
                    : target,
            ),
            sessions: [session, ...current.sessions],
        };
    });
}

export async function removePresenceLabSession(userId: string | null, sessionId: string) {
    return updatePresenceLabData(userId, current => ({
        ...current,
        sessions: current.sessions.filter(session => session.id !== sessionId),
    }));
}

export async function updatePresenceLabConfig(userId: string | null, patch: Partial<PresenceLabConfig>) {
    return updatePresenceLabData(userId, current => ({
        ...current,
        config: cloneConfig({ ...current.config, ...patch }),
    }));
}

export function usePresenceLabData(userId: string | null) {
    const data = React.useSyncExternalStore(subscribe, () => userId ? cache.get(userId) : undefined);

    React.useEffect(() => {
        if (userId) void getPresenceLabData(userId).catch(error => logger.error("Could not load Presence Lab data.", error));
    }, [userId]);

    return [data ?? EMPTY_DATA, !!userId && data === undefined] as const;
}
