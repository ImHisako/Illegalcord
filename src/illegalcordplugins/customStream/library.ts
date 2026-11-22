/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";

import { dropThumbs, thumbKey } from "./thumbs";
import { createEmitter, logger } from "./utils";

export const MAX_PROFILES = 6;
export const MAX_IMAGES_PER_PROFILE = 80;
export const MAX_PROFILE_NAME = 40;
export const DEFAULT_PROFILE_ID = "default";

const KEY_PREFIX = "CustomStreamTopQ_";
const LIBRARY_KEY = `${KEY_PREFIX}Library`;
const imageKey = (id: string) => `${KEY_PREFIX}Image_${id}`;

const LEGACY_KEYS = {
    profilesV2: `${KEY_PREFIX}ProfilesV2`,
    indices: `${KEY_PREFIX}SlideIndices`,
    activeProfile: `${KEY_PREFIX}ActiveProfile`,
    profilesV1: `${KEY_PREFIX}Profiles`,
    slideshow: `${KEY_PREFIX}Slideshow`,
    slideIndex: `${KEY_PREFIX}SlideIndex`,
    imageData: `${KEY_PREFIX}ImageData`
};

export interface StoredImage {
    readonly id: string;
    readonly blob: Blob;
}

export interface Profile {
    readonly id: string;
    readonly name: string;
    readonly images: readonly StoredImage[];
    readonly currentIndex: number;
}

interface LibraryMeta {
    version: 3;
    activeId: string;
    profiles: {
        id: string;
        name: string;
        imageIds: string[];
        currentIndex: number;
    }[];
}

interface LegacyProfile {
    id: string;
    name: string;
    blobs: Blob[];
    currentIndex: number;
}

interface LegacyByteImage {
    type: string;
    data: number[];
}

export const libraryChanged = createEmitter();

let profiles: readonly Profile[] = [];
let activeId = DEFAULT_PROFILE_ID;
let storageReady = false;

const newId = () => crypto.randomUUID();

function emptyProfile(id: string, name: string): Profile {
    return { id, name, images: [], currentIndex: 0 };
}

function clampIndex(index: number, length: number): number {
    if (length === 0 || !Number.isInteger(index) || index < 0) return 0;
    return Math.min(index, length - 1);
}

function withDefaultProfile(list: readonly Profile[]): readonly Profile[] {
    if (list.some(p => p.id === DEFAULT_PROFILE_ID)) return list;
    return [emptyProfile(DEFAULT_PROFILE_ID, "Default"), ...list];
}

export function getProfiles(): readonly Profile[] {
    return profiles;
}

export function getActiveProfile(): Profile {
    return profiles.find(p => p.id === activeId) ?? profiles[0] ?? emptyProfile(DEFAULT_PROFILE_ID, "Default");
}

export function findImage(imageId: string): { profile: Profile; index: number; } | null {
    for (const profile of profiles) {
        const index = profile.images.findIndex(image => image.id === imageId);
        if (index !== -1) return { profile, index };
    }
    return null;
}

function toMeta(): LibraryMeta {
    return {
        version: 3,
        activeId,
        profiles: profiles.map(p => ({
            id: p.id,
            name: p.name,
            imageIds: p.images.map(image => image.id),
            currentIndex: p.currentIndex
        }))
    };
}

let metaWrite: Promise<void> = Promise.resolve();
let metaWriteQueued = false;

function saveMeta(): Promise<void> {
    if (!storageReady || metaWriteQueued) return metaWrite;
    metaWriteQueued = true;

    metaWrite = metaWrite.then(async () => {
        metaWriteQueued = false;
        try {
            await DataStore.set(LIBRARY_KEY, toMeta());
        } catch (error) {
            logger.error("Failed to save the library", error);
        }
    });
    return metaWrite;
}

function commit(next: readonly Profile[], nextActiveId = activeId): Promise<void> {
    profiles = next;
    activeId = next.some(p => p.id === nextActiveId) ? nextActiveId : DEFAULT_PROFILE_ID;
    libraryChanged.emit();
    return saveMeta();
}

function updateProfile(profileId: string, update: (profile: Profile) => Profile): readonly Profile[] {
    return profiles.map(p => (p.id === profileId ? update(p) : p));
}

export function setActiveProfile(profileId: string): Promise<void> {
    if (profileId === activeId || !profiles.some(p => p.id === profileId)) return Promise.resolve();
    return commit(profiles, profileId);
}

export function createProfile(name: string): Profile | null {
    if (profiles.length >= MAX_PROFILES) return null;
    const profile = emptyProfile(newId(), name);
    void commit([...profiles, profile], profile.id);
    return profile;
}

export function renameProfile(profileId: string, name: string): Promise<void> {
    return commit(updateProfile(profileId, p => ({ ...p, name })));
}

export function deleteProfile(profileId: string): boolean {
    const profile = profiles.find(p => p.id === profileId);
    if (!profile || profile.id === DEFAULT_PROFILE_ID || profile.images.length > 0) return false;

    void commit(profiles.filter(p => p.id !== profileId), activeId === profileId ? DEFAULT_PROFILE_ID : activeId);
    return true;
}

export function setCurrentIndex(profileId: string, index: number): Promise<void> {
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return Promise.resolve();

    const clamped = clampIndex(index, profile.images.length);
    if (clamped === profile.currentIndex) return Promise.resolve();
    return commit(updateProfile(profileId, p => ({ ...p, currentIndex: clamped })));
}

export async function addImages(profileId: string, blobs: Blob[]): Promise<number> {
    const profile = profiles.find(p => p.id === profileId);
    if (!profile || !storageReady) return 0;

    const room = MAX_IMAGES_PER_PROFILE - profile.images.length;
    const added = blobs.slice(0, Math.max(0, room)).map(blob => ({ id: newId(), blob }));
    if (added.length === 0) return 0;

    await DataStore.setMany(added.map(image => [imageKey(image.id), image.blob]));

    const fresh = profiles.find(p => p.id === profileId);
    if (!fresh) {
        await DataStore.delMany(added.map(image => imageKey(image.id)));
        return 0;
    }

    await commit(updateProfile(profileId, p => ({ ...p, images: [...p.images, ...added].slice(0, MAX_IMAGES_PER_PROFILE) })));
    return added.length;
}

export async function removeImages(profileId: string, imageIds: ReadonlySet<string>): Promise<void> {
    const profile = profiles.find(p => p.id === profileId);
    if (!profile || !storageReady) return;

    const removed = profile.images.filter(image => imageIds.has(image.id));
    if (removed.length === 0) return;

    const current = profile.images[profile.currentIndex];
    const images = profile.images.filter(image => !imageIds.has(image.id));
    const keptCurrent = current ? images.indexOf(current) : -1;
    const removedBefore = profile.images.slice(0, profile.currentIndex).filter(image => imageIds.has(image.id)).length;
    const currentIndex = clampIndex(keptCurrent !== -1 ? keptCurrent : profile.currentIndex - removedBefore, images.length);

    await commit(updateProfile(profileId, p => ({ ...p, images, currentIndex })));
    dropThumbs(removed.map(image => image.id));

    try {
        await DataStore.delMany(removed.flatMap(image => [imageKey(image.id), thumbKey(image.id)]));
    } catch (error) {
        logger.error("Failed to delete image data", error);
    }
}

export function moveImage(profileId: string, from: number, to: number): Promise<void> {
    const profile = profiles.find(p => p.id === profileId);
    if (!profile || from === to) return Promise.resolve();
    if (from < 0 || to < 0 || from >= profile.images.length || to >= profile.images.length) return Promise.resolve();

    const images = [...profile.images];
    const [moved] = images.splice(from, 1);
    images.splice(to, 0, moved);

    const current = profile.images[profile.currentIndex];
    const currentIndex = current ? images.indexOf(current) : 0;
    return commit(updateProfile(profileId, p => ({ ...p, images, currentIndex })));
}

export function shuffleImages(profileId: string, random: () => number = Math.random): Promise<void> {
    const profile = profiles.find(p => p.id === profileId);
    if (!profile || profile.images.length < 2) return Promise.resolve();

    const images = [...profile.images];
    for (let i = images.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [images[i], images[j]] = [images[j], images[i]];
    }

    const current = profile.images[profile.currentIndex];
    const currentIndex = current ? images.indexOf(current) : 0;
    return commit(updateProfile(profileId, p => ({ ...p, images, currentIndex })));
}

export function moveProfile(from: number, to: number): Promise<void> {
    if (from === to || from < 0 || to < 0 || from >= profiles.length || to >= profiles.length) return Promise.resolve();

    const next = [...profiles];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return commit(next);
}

function bytesToBlob(image: LegacyByteImage): Blob {
    return new Blob([new Uint8Array(image.data)], { type: image.type });
}

async function readLegacy(): Promise<{ profiles: LegacyProfile[]; activeId: string; } | null> {
    const v2 = await DataStore.get<{ profiles?: { id: string; name: string; images: Blob[]; }[]; }>(LEGACY_KEYS.profilesV2);
    if (v2?.profiles?.length) {
        const indices = await DataStore.get<Record<string, number>>(LEGACY_KEYS.indices) ?? {};
        const active = await DataStore.get<string>(LEGACY_KEYS.activeProfile);
        return {
            profiles: v2.profiles.map(p => ({
                id: p.id,
                name: p.name,
                blobs: p.images.filter(blob => blob instanceof Blob),
                currentIndex: indices[p.id] ?? 0
            })),
            activeId: active ?? DEFAULT_PROFILE_ID
        };
    }

    const v1 = await DataStore.get<{ profiles?: { id: string; name: string; images: LegacyByteImage[]; currentIndex: number; }[]; activeProfileId?: string; }>(LEGACY_KEYS.profilesV1);
    if (v1?.profiles?.length) {
        return {
            profiles: v1.profiles.map(p => ({
                id: p.id,
                name: p.name,
                blobs: p.images.map(bytesToBlob),
                currentIndex: p.currentIndex
            })),
            activeId: v1.activeProfileId ?? DEFAULT_PROFILE_ID
        };
    }

    const v0 = await DataStore.get<{ images?: LegacyByteImage[]; }>(LEGACY_KEYS.slideshow);
    if (v0?.images?.length) {
        const index = await DataStore.get<number>(LEGACY_KEYS.slideIndex);
        return {
            profiles: [{
                id: DEFAULT_PROFILE_ID,
                name: "Default",
                blobs: v0.images.map(bytesToBlob),
                currentIndex: typeof index === "number" ? index : 0
            }],
            activeId: DEFAULT_PROFILE_ID
        };
    }

    return null;
}

async function migrateLegacy(): Promise<boolean> {
    const legacy = await readLegacy();
    if (!legacy) return false;

    const migrated: Profile[] = legacy.profiles.slice(0, MAX_PROFILES).map(p => {
        const images = p.blobs.slice(0, MAX_IMAGES_PER_PROFILE).map(blob => ({ id: newId(), blob }));
        return { id: p.id, name: p.name, images, currentIndex: clampIndex(p.currentIndex, images.length) };
    });

    await DataStore.setMany(migrated.flatMap(p => p.images.map(image => [imageKey(image.id), image.blob] as [string, Blob])));
    profiles = withDefaultProfile(migrated);
    activeId = profiles.some(p => p.id === legacy.activeId) ? legacy.activeId : DEFAULT_PROFILE_ID;
    await DataStore.set(LIBRARY_KEY, toMeta());

    logger.info(`Copied ${migrated.reduce((sum, p) => sum + p.images.length, 0)} images to the new storage`);
    return true;
}

export async function loadLibrary(): Promise<void> {
    try {
        const meta = await DataStore.get<LibraryMeta>(LIBRARY_KEY);

        if (meta?.version === 3) {
            const ids = meta.profiles.flatMap(p => p.imageIds);
            const blobs = await DataStore.getMany<Blob | undefined>(ids.map(imageKey));
            const byId = new Map(ids.map((id, i) => [id, blobs[i]]));

            profiles = withDefaultProfile(meta.profiles.map(p => {
                const images = p.imageIds
                    .map(id => ({ id, blob: byId.get(id) }))
                    .filter((image): image is StoredImage => image.blob instanceof Blob);
                return { id: p.id, name: p.name, images, currentIndex: clampIndex(p.currentIndex, images.length) };
            }));
            activeId = profiles.some(p => p.id === meta.activeId) ? meta.activeId : DEFAULT_PROFILE_ID;

            if (blobs.every(blob => blob instanceof Blob)) {
                DataStore.delMany(Object.values(LEGACY_KEYS)).catch(error => logger.error("Failed to remove the old storage", error));
            }
        } else if (!await migrateLegacy()) {
            profiles = [emptyProfile(DEFAULT_PROFILE_ID, "Default")];
            activeId = DEFAULT_PROFILE_ID;
        }
        storageReady = true;
    } catch (error) {
        logger.error("Failed to load the library, changes will not be saved until Discord restarts", error);
        profiles = [emptyProfile(DEFAULT_PROFILE_ID, "Default")];
        activeId = DEFAULT_PROFILE_ID;
    }

    libraryChanged.emit();
}

export function isStorageReady(): boolean {
    return storageReady;
}

export function unloadLibrary() {
    profiles = [];
    activeId = DEFAULT_PROFILE_ID;
    storageReady = false;
}
