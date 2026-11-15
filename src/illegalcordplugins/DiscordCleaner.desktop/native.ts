/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isTrustedSender } from "@illegalcordplugins/DiscordHardened/nativeSecurity";
import { RendererSettings } from "@main/settings";
import { app, type IpcMainInvokeEvent, type Session, session } from "electron";
import { lstat, readdir, realpath, unlink } from "fs/promises";
import throttle from "lodash/throttle";
import { basename, dirname, join, relative, resolve, sep } from "path";

import { frequencies, ON_CREATION } from "./schedule";
import { watchFiles } from "./watchFiles";

const LOG_FILE = /\.log(?:\.\d+)?(?:\.gz)?$|^discord-(?:last-)?webrtc_\d+$/i;
const TEMP_FILE = /\.(?:tmp|temp)$/i;
const CRASH_DUMP = /\.(?:dmp|mdmp)$/i;
const ONE_DAY = 24 * 60 * 60 * 1000;
const CACHE_FOLDERS = ["Cache", "Code Cache", "GPUCache", "ShaderCache", "GrShaderCache", "DawnGraphiteCache", "DawnWebGPUCache", "GPUPersistentCache", "Service Worker"];
const CACHE_METADATA = /^(?:index(?:-dir)?|the-real-index|temp-index|data_\d+|current|lock|log(?:\.old)?|manifest-\d+)$/i;

let cleaning = false;
let scheduleKey = "";
let stopSchedule: (() => void) | undefined;

interface FileCleanup {
    removed: number;
    failed: number;
}

interface CleanupTargets {
    cache: boolean;
    logs: boolean;
    temporary: boolean;
}

type CleanupResult = { success: true; files: FileCleanup; failedCaches: string[]; } | { success: false; error: string; };

function isMissing(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function getLogDirectories(profile: string): Promise<string[]> {
    const directories = [join(profile, "logs")];
    if (process.platform === "darwin") {
        const home = await realpath(app.getPath("home"));
        directories.push(join(home, "Library", "Logs", basename(app.getName())));
    }
    return directories;
}

function getTemporaryDirectories(profile: string): string[] {
    return [profile, join(profile, "tmp"), join(profile, "temp")];
}

async function cleanFiles(directory: string, name: RegExp, result: FileCleanup, signal?: AbortSignal, olderThan?: number): Promise<void> {
    try {
        if (relative(directory, await realpath(directory))) {
            result.failed++;
            return;
        }
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (signal?.aborted) return;
            if (!entry.isFile() || !name.test(entry.name)) continue;
            const file = join(directory, entry.name);
            try {
                if (olderThan !== undefined && (await lstat(file)).mtimeMs >= olderThan) continue;
                if (signal?.aborted) return;
                await unlink(file);
                result.removed++;
            } catch (error) {
                if (!isMissing(error)) result.failed++;
            }
        }
    } catch (error) {
        if (!isMissing(error)) result.failed++;
    }
}

export async function clean(event: IpcMainInvokeEvent, cache: unknown, logs: unknown, temporary: unknown): Promise<CleanupResult> {
    if (!isTrustedSender(event)) return { success: false, error: "Open DiscordCleaner from the Discord client." };
    if (typeof cache !== "boolean" || typeof logs !== "boolean" || typeof temporary !== "boolean" || !(cache || logs || temporary))
        return { success: false, error: "Select what to clean first." };
    return cleanTargets(event.sender.session, { cache, logs, temporary });
}

async function cleanTargets(session: Session, { cache, logs, temporary }: CleanupTargets, signal?: AbortSignal, instant = false): Promise<CleanupResult> {
    if (cleaning) return { success: false, error: "Cleanup is already running." };

    cleaning = true;
    const files: FileCleanup = { removed: 0, failed: 0 };
    const failedCaches: string[] = [];
    try {
        if (cache) {
            const tasks = {
                "HTTP cache": async () => session.clearCache(),
                "code cache": async () => session.clearCodeCaches({}),
                "shader and site caches": async () => session.clearStorageData({ storages: ["shadercache", "cachestorage"] }),
            };
            await Promise.all(Object.entries(tasks).map(async ([name, clear]) => {
                try {
                    await clear();
                } catch {
                    failedCaches.push(name);
                }
            }));
        }

        if ((logs || temporary) && !signal?.aborted) {
            try {
                const userData = resolve(app.getPath("userData"));
                const profile = await realpath(userData);
                if (dirname(profile) === profile) return { success: false, error: "Could not identify the Discord data folder." };
                if (logs) {
                    for (const directory of await getLogDirectories(profile)) {
                        await cleanFiles(directory, LOG_FILE, files, signal);
                    }
                }
                if (temporary) {
                    const cutoff = Date.now() - ONE_DAY;
                    for (const directory of getTemporaryDirectories(profile)) {
                        await cleanFiles(directory, TEMP_FILE, files, signal, instant ? undefined : cutoff);
                    }
                    const dumpPath = resolve(app.getPath("crashDumps"));
                    const dumpRoots = new Set<string>();
                    if (dumpPath.startsWith(userData + sep)) {
                        dumpRoots.add(join(profile, relative(userData, dumpPath)));
                    }
                    if (process.platform === "linux") dumpRoots.add(join(profile, "Crash Reports"));
                    for (const dumps of dumpRoots) {
                        for (const directory of [dumps, join(dumps, "reports"), join(dumps, "completed")]) {
                            await cleanFiles(directory, CRASH_DUMP, files, signal, cutoff);
                        }
                    }
                }
            } catch {
                files.failed++;
            }
        }
        return { success: true, files, failedCaches };
    } finally {
        cleaning = false;
    }
}

async function watchTargets(ses: Session, targets: CleanupTargets, signal: AbortSignal, refreshWatchers: () => void, clearCache: () => void): Promise<void> {
    try {
        const profile = await realpath(app.getPath("userData"));
        if (dirname(profile) === profile || signal.aborted) return;
        const storagePath = targets.cache ? ses.getStoragePath() ?? app.getPath("sessionData") : null;
        const storage = storagePath ? await realpath(storagePath).catch(() => null) : null;
        const files = [
            ...(targets.logs ? (await getLogDirectories(profile)).map(directory => ({ directory, pattern: LOG_FILE })) : []),
            ...(targets.temporary ? getTemporaryDirectories(profile).map(directory => ({ directory, pattern: TEMP_FILE })) : []),
        ];
        const parents = new Map<string, Set<string>>();
        for (const directory of [...files.map(file => file.directory), ...(storage ? CACHE_FOLDERS.map(folder => join(storage, folder)) : [])]) {
            if (directory === profile) continue;
            const parent = dirname(directory);
            const names = parents.get(parent) ?? new Set<string>();
            names.add(basename(directory));
            parents.set(parent, names);
        }
        await Promise.all([
            ...Array.from(parents, ([directory, names]) => watchFiles(directory, signal, {
                matches: name => names.has(name),
                onEntry: (_file, _name, type) => { if (type === "directory") refreshWatchers(); },
            })),
            ...files.map(({ directory, pattern }) => watchFiles(directory, signal, {
                matches: name => pattern.test(name),
                onEntry: (file, _name, type) => { if (type === "file") return unlink(file); },
            })),
            ...(storage ? CACHE_FOLDERS.map(folder => watchFiles(join(storage, folder), signal, {
                recursive: true,
                matches: name => (folder !== "Service Worker" || name.startsWith(`CacheStorage${sep}`)) && !CACHE_METADATA.test(basename(name)),
                onEntry: (_file, _name, type) => { if (type === "file" && !cleaning) clearCache(); },
            })) : []),
        ]);
    } catch {
        return;
    }
}

function updateSchedule(): void {
    const config = RendererSettings.plain.plugins?.DiscordCleaner;
    const frequency: unknown = config?.frequency;
    const valid = config?.enabled === true && typeof frequency === "number" && frequencies.some(option => option.value === frequency) && frequency !== 0;
    const targets: CleanupTargets = {
        cache: config?.cache !== false,
        logs: config?.logs !== false,
        temporary: config?.temporary !== false,
    };
    const scheduled = valid && (targets.cache || targets.logs || targets.temporary);
    const key = scheduled ? `${frequency}:${targets.cache}:${targets.logs}:${targets.temporary}` : "";
    if (key === scheduleKey) return;
    scheduleKey = key;
    stopSchedule?.();
    stopSchedule = undefined;
    if (!scheduled) return;

    const controller = new AbortController();
    const instant = frequency === ON_CREATION;
    const clearCache = throttle(() => {
        if (!controller.signal.aborted && !cleaning) {
            void cleanTargets(session.defaultSession, { cache: true, logs: false, temporary: false }, controller.signal);
        }
    }, 250, { leading: false });
    let watchers: AbortController | undefined;
    function refreshWatchers() {
        if (!instant || controller.signal.aborted) return;
        watchers?.abort();
        watchers = new AbortController();
        void watchTargets(session.defaultSession, targets, watchers.signal, refreshWatchers, clearCache);
    }
    refreshWatchers();
    const timer = setInterval(() => {
        refreshWatchers();
        return cleanTargets(session.defaultSession, targets, controller.signal, instant);
    }, (instant ? 1 : frequency) * 60_000);
    stopSchedule = () => {
        clearInterval(timer);
        clearCache.cancel();
        controller.abort();
        watchers?.abort();
    };
}

void app.whenReady().then(() => {
    RendererSettings.addGlobalChangeListener(updateSchedule);
    updateSchedule();
    app.once("will-quit", () => {
        RendererSettings.removeGlobalChangeListener(updateSchedule);
        stopSchedule?.();
    });
});
