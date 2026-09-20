/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const TEMPORARY_PERMISSIONS = {
    allowCamera: "Camera",
    allowMicrophone: "Microphone",
    allowDisplayCapture: "Screen sharing",
    allowClipboardRead: "Clipboard reading",
    allowDeviceEnumeration: "Media device discovery",
    allowSpeakerSelection: "Speaker selection",
} as const;

export type TemporaryPermission = keyof typeof TEMPORARY_PERMISSIONS;
export type BlockCategory = "GoofCord firewall" | "tracing" | "telemetry" | "typing indicator" | "Sentry" | "fingerprinting"
    | "Legacy media capture" | "Microphone access" | "Camera access" | "Media capture" | "Display capture"
    | "Speaker selection" | "Clipboard write access" | "Clipboard read access" | "Hardware access"
    | "Battery information" | "Fullscreen access" | "Background synchronization" | "Unsafe window request" | "Device enumeration"
    | "Notification permission" | "Geolocation";

interface BlockEntry {
    id: number;
    category: BlockCategory;
    time: number;
    count: number;
}

interface TemporaryGrant {
    expiresAt: number;
    timer: ReturnType<typeof setTimeout>;
    tracks: Set<MediaStreamTrack>;
}

const blocks: BlockEntry[] = [];
const grants = new Map<TemporaryPermission, TemporaryGrant>();
let nextBlockId = 0;
let recording = false;
let permissionChanged: (() => void) | undefined;

export function setBlockRecording(enabled: boolean): void {
    recording = enabled;
    if (!enabled) clearBlockLog();
}

export function recordBlock(category: BlockCategory): void {
    if (!recording) return;
    const time = Date.now();
    const last = blocks.at(-1);
    if (last?.category === category && time - last.time < 10_000) {
        last.time = time;
        last.count++;
        return;
    }
    blocks.push({ id: ++nextBlockId, category, time, count: 1 });
    if (blocks.length > 100) blocks.shift();
}

export function getBlockLog(): readonly BlockEntry[] {
    return blocks.map(entry => ({ ...entry }));
}

export function clearBlockLog(): void {
    blocks.length = 0;
}

export function startPermissionSession(onChange: () => void): void {
    permissionChanged = onChange;
}

export function isPermissionAllowed(permission: TemporaryPermission, permanent: boolean): boolean {
    return permanent || (grants.get(permission)?.expiresAt ?? 0) > Date.now();
}

export function grantTemporaryPermission(permission: TemporaryPermission, minutes: number): boolean {
    if (!permissionChanged || ![1, 5, 15].includes(minutes)) return false;
    const previous = grants.get(permission);
    if (previous) clearTimeout(previous.timer);
    const expiresAt = Date.now() + minutes * 60_000;
    const timer = setTimeout(() => revokeTemporaryPermission(permission), minutes * 60_000);
    grants.set(permission, { expiresAt, timer, tracks: previous?.tracks ?? new Set() });
    permissionChanged();
    return true;
}

export function revokeTemporaryPermission(permission: TemporaryPermission): void {
    const grant = grants.get(permission);
    if (!grant) return;
    clearTimeout(grant.timer);
    grants.delete(permission);
    for (const track of grant.tracks) track.stop();
    permissionChanged?.();
}

export function getTemporaryPermissions() {
    return Array.from(grants, ([permission, grant]) => ({ permission, expiresAt: grant.expiresAt }));
}

export function registerTemporaryTracks(permission: TemporaryPermission, tracks: MediaStreamTrack[], permanent: boolean): void {
    if (permanent) return;
    const grant = grants.get(permission);
    if (!grant || grant.expiresAt <= Date.now()) {
        for (const track of tracks) track.stop();
        return;
    }
    for (const track of grant.tracks) {
        if (track.readyState === "ended") grant.tracks.delete(track);
    }
    for (const track of tracks) grant.tracks.add(track);
}

export function registerTemporaryClone(source: MediaStreamTrack, clone: MediaStreamTrack): void {
    for (const grant of grants.values()) {
        if (!grant.tracks.has(source)) continue;
        if (grant.expiresAt <= Date.now()) clone.stop();
        else grant.tracks.add(clone);
    }
}

export function stopPermissionSession(): void {
    for (const permission of grants.keys()) revokeTemporaryPermission(permission);
    permissionChanged = undefined;
    setBlockRecording(false);
}
