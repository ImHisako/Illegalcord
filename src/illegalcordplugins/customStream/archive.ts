/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { unzipSync, zipSync } from "fflate";

import type { StoredImage } from "./library";

const IMAGE_TYPES: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp"
};

export const MAX_ARCHIVE_SIZE = 300 * 1024 * 1024;

export function isArchive(file: File): boolean {
    return /\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}

function extensionOf(name: string): string {
    return name.split(".").pop()?.toLowerCase() ?? "";
}

export function safeFileName(name: string): string {
    const cleaned = name.replace(/[\\/:*?"<>|]+/g, " ").trim();
    return cleaned || "stream-preview";
}

export async function imagesToZip(images: readonly StoredImage[]): Promise<Blob> {
    const width = Math.max(3, String(images.length).length);
    const files: Record<string, Uint8Array> = {};

    for (const [i, image] of images.entries()) {
        files[`${String(i + 1).padStart(width, "0")}.jpg`] = new Uint8Array(await image.blob.arrayBuffer());
    }

    return new Blob([zipSync(files, { level: 0 })], { type: "application/zip" });
}

export async function imagesFromZip(archive: Blob): Promise<File[]> {
    const entries = unzipSync(new Uint8Array(await archive.arrayBuffer()), {
        filter: entry => !entry.name.startsWith("__MACOSX/") && extensionOf(entry.name) in IMAGE_TYPES
    });

    return Object.keys(entries)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
        .map(name => new File([entries[name]], name.split("/").pop() ?? name, { type: IMAGE_TYPES[extensionOf(name)] }));
}
