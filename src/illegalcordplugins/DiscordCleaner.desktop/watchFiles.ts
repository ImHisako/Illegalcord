/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { lstat, realpath, watch } from "fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "path";

type EntryType = "file" | "directory";

interface WatchOptions {
    recursive?: boolean;
    matches: (name: string) => boolean;
    onEntry: (file: string, name: string, type: EntryType) => void | Promise<void>;
}

export async function watchFiles(directory: string, signal: AbortSignal, { recursive, matches, onEntry }: WatchOptions): Promise<void> {
    try {
        if (relative(directory, await realpath(directory)) || signal.aborted) return;
        for await (const { eventType, filename } of watch(directory, { signal, persistent: false, recursive })) {
            if (eventType !== "rename" || !filename) continue;
            const path = resolve(directory, filename);
            const name = relative(directory, path);
            if (!name || isAbsolute(name) || name === ".." || name.startsWith(`..${sep}`) || (!recursive && name.includes(sep)) || !matches(name)) continue;
            try {
                const parent = dirname(path);
                if (relative(parent, await realpath(parent))) continue;
                const entry = await lstat(path);
                if (signal.aborted) return;
                if (entry.isFile()) await onEntry(path, name, "file");
                else if (entry.isDirectory()) await onEntry(path, name, "directory");
            } catch {
                continue;
            }
        }
    } catch {
        return;
    }
}
