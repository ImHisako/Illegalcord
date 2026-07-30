/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { DATA_DIR } from "@main/utils/constants";
import { ensureSafePath } from "@main/utils/ensureSafePath";
import { dialog, IpcMainInvokeEvent, shell } from "electron";

import { getSettings, saveSettings } from "./settings";
export * from "./export";
export * from "./import";

import { blockedExts } from "../list";
import { LoggedAttachment } from "../types";
import { DEFAULT_ATTACHMENT_FILE_EXTENSIONS, LOGS_DATA_FILENAME } from "../utils/constants";
import { ensureDirectoryExists, getAttachmentIdFromFilename, sleep } from "./utils";

export { getSettings };
export function messageLoggerEnhancedUniqueIdThingyIdkMan() { }

const nativeSavedImages = new Map<string, string>();
export const getNativeSavedImages = () => nativeSavedImages;

let logsDir: string;
let imageCacheDir: string;

const ALLOWED_ATTACHMENT_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const DISCORD_ATTACHMENT_ID_RE = /^\d{1,32}$/;
const SAFE_EXTENSION_RE = /^[a-z0-9]{1,10}$/;
const MAX_CACHED_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const MAX_ATTACHMENT_REDIRECTS = 3;

const getImageCacheDir = async () => imageCacheDir ?? await getDefaultNativeImageDir();
const getLogsDir = async () => logsDir ?? await getDefaultNativeDataDir();

function parseAttachmentUrl(value: unknown): URL | null {
    if (typeof value !== "string") return null;

    try {
        const url = new URL(value);
        return url.protocol === "https:"
            && ALLOWED_ATTACHMENT_HOSTS.has(url.hostname)
            && url.pathname.startsWith("/attachments/")
            ? url
            : null;
    } catch {
        return null;
    }
}

async function fetchAttachment(url: URL, redirects = 0): Promise<Response> {
    const response = await fetch(url, { redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get("location");
    const redirectUrl = location ? parseAttachmentUrl(new URL(location, url).toString()) : null;
    if (!redirectUrl || redirects >= MAX_ATTACHMENT_REDIRECTS)
        throw new Error("Attachment redirected to an invalid URL.");

    return fetchAttachment(redirectUrl, redirects + 1);
}

async function readLimitedAttachment(response: Response): Promise<Buffer> {
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_CACHED_ATTACHMENT_BYTES)
        throw new Error("Attachment is too large to cache.");

    if (!response.body) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength > MAX_CACHED_ATTACHMENT_BYTES)
            throw new Error("Attachment is too large to cache.");
        return buffer;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        totalBytes += value.byteLength;
        if (totalBytes > MAX_CACHED_ATTACHMENT_BYTES) {
            await reader.cancel();
            throw new Error("Attachment is too large to cache.");
        }

        chunks.push(value);
    }

    return Buffer.concat(chunks, totalBytes);
}

export async function initDirs() {
    const { logsDir: ld, imageCacheDir: icd } = await getSettings();

    logsDir = ld || await getDefaultNativeDataDir();
    imageCacheDir = icd || await getDefaultNativeImageDir();
}
initDirs();

export async function init(_event: IpcMainInvokeEvent) {
    const imageDir = await getImageCacheDir();

    await ensureDirectoryExists(imageDir);
    const files = await readdir(imageDir);
    for (const filename of files) {
        const attachmentId = getAttachmentIdFromFilename(filename);
        nativeSavedImages.set(attachmentId, path.join(imageDir, filename));
    }
}

export async function getImageNative(_event: IpcMainInvokeEvent, attachmentId: string): Promise<Uint8Array | Buffer | null> {
    const imagePath = nativeSavedImages.get(attachmentId);
    if (!imagePath) return null;

    try {
        return await readFile(imagePath);
    } catch (error: any) {
        console.error(error);
        return null;
    }
}

export async function writeImageNative(_event: IpcMainInvokeEvent, filename: string, content: Uint8Array) {
    if (
        typeof filename !== "string" ||
        filename.length === 0 ||
        filename.length > 255 ||
        path.basename(filename) !== filename ||
        !(content instanceof Uint8Array) ||
        content.byteLength === 0 ||
        content.byteLength > MAX_CACHED_ATTACHMENT_BYTES
    ) return;

    const imageDir = await getImageCacheDir();
    const attachmentId = getAttachmentIdFromFilename(filename);

    const existingImage = nativeSavedImages.get(attachmentId);
    if (existingImage) return;

    const imagePath = ensureSafePath(imageDir, filename);
    if (!imagePath) return;

    await ensureDirectoryExists(imageDir);
    await writeFile(imagePath, content);

    nativeSavedImages.set(attachmentId, imagePath);
}

export async function deleteFileNative(_event: IpcMainInvokeEvent, attachmentId: string) {
    const imagePath = nativeSavedImages.get(attachmentId);
    if (!imagePath) return;

    await unlink(imagePath);
}

export async function writeLogs(_event: IpcMainInvokeEvent, contents: string) {
    const logsDir = await getLogsDir();

    await ensureDirectoryExists(logsDir);
    await writeFile(path.join(logsDir, LOGS_DATA_FILENAME), contents);
}

export async function getDefaultNativeImageDir(): Promise<string> {
    return path.join(await getDefaultNativeDataDir(), "savedImages");
}

export async function getDefaultNativeDataDir(): Promise<string> {
    return path.join(DATA_DIR, "MessageLoggerData");
}

export async function getDefaultAttachmentFileExtensions(): Promise<string> {
    return DEFAULT_ATTACHMENT_FILE_EXTENSIONS;
}

export async function chooseDir(event: IpcMainInvokeEvent, logKey: "logsDir" | "imageCacheDir") {
    if (logKey !== "logsDir" && logKey !== "imageCacheDir")
        throw new Error("Invalid logger directory setting.");

    const settings = await getSettings();
    const defaultPath = settings[logKey] || await getDefaultNativeDataDir();

    const res = await dialog.showOpenDialog({ properties: ["openDirectory"], defaultPath: defaultPath });
    const dir = res.filePaths[0];

    if (!dir) throw Error("Invalid Directory");

    settings[logKey] = dir;

    await saveSettings(settings);

    switch (logKey) {
        case "logsDir": logsDir = dir; break;
        case "imageCacheDir": imageCacheDir = dir; break;
    }

    if (logKey === "imageCacheDir")
        await init(event);

    return dir;
}

export async function showItemInFolder(_event: IpcMainInvokeEvent) {
    shell.showItemInFolder(await getImageCacheDir());
}

export async function chooseFile(_event: IpcMainInvokeEvent, title: string, filters: Electron.FileFilter[], defaultPath?: string) {
    const res = await dialog.showOpenDialog({ title, filters, properties: ["openFile"], defaultPath });
    const [path] = res.filePaths;

    if (!path) throw Error("Invalid file");

    return await readFile(path, "utf-8");
}

export async function downloadAttachment(_event: IpcMainInvokeEvent, attachment: LoggedAttachment, attempts = 0, useOldUrl = false): Promise<{ error: string | null; path: string | null; }> {
    try {
        if (!attachment?.id || !DISCORD_ATTACHMENT_ID_RE.test(attachment.id))
            return { error: "Invalid Attachment", path: null };

        const requestedUrl = parseAttachmentUrl(useOldUrl ? attachment.oldUrl : attachment.url);
        if (!requestedUrl) return { error: "Invalid Attachment URL", path: null };

        const settings = await getSettings();
        const allowedExtensionsStr = settings.attachmentFileExtensions?.trim() || "";
        if (allowedExtensionsStr === "" || allowedExtensionsStr.toLowerCase() === "none") {
            return { error: "All attachment downloads are currently blocked by settings configurations.", path: null };
        }

        const allowedList = allowedExtensionsStr.split(",").map((ext: string) => ext.trim().toLowerCase());
        const cleanExt = attachment.fileExtension?.replace(/^\./, "").toLowerCase();

        if (!cleanExt || !SAFE_EXTENSION_RE.test(cleanExt) || !allowedList.includes(cleanExt)) {
            return { error: `File type .${cleanExt} is blocked by settings configurations.`, path: null };
        }

        const existingImage = nativeSavedImages.get(attachment.id);
        if (existingImage)
            return {
                error: null,
                path: existingImage
            };

        const res = await fetchAttachment(requestedUrl);

        if (res.status !== 200) {
            if (res.status === 404 || res.status === 403 || res.status === 415)
                useOldUrl = true;

            attempts++;
            if (attempts > 3) {
                return {
                    error: `Failed to get attachment ${attachment.id} for caching. too many attempts, error code ${res.status}`,
                    path: null,
                };
            }

            await sleep(1000);
            return downloadAttachment(_event, attachment, attempts, useOldUrl);
        }

        const content = await readLimitedAttachment(res);
        const imageCacheDir = await getImageCacheDir();
        await ensureDirectoryExists(imageCacheDir);

        const finalPath = ensureSafePath(imageCacheDir, `${attachment.id}.${cleanExt}`);
        if (!finalPath) return { error: "Invalid attachment cache path", path: null };

        await writeFile(finalPath, content);

        nativeSavedImages.set(attachment.id, finalPath);

        return {
            error: null,
            path: finalPath
        };

    } catch (error: any) {
        console.error(error);
        return { error: error.message, path: null };
    }
}

export async function updateAllowedExtensions(_event: IpcMainInvokeEvent, cleanExtensionsString: string | undefined) {
    const settings = await getSettings();
    const incomingRaw = cleanExtensionsString?.trim() || "";

    if (incomingRaw === "") {
        settings.attachmentFileExtensions = "none";
        await saveSettings(settings);
        return;
    }

    const validatedExtensions = incomingRaw
        .split(",")
        .map(ext => ext.trim().toLowerCase())
        .filter(ext => SAFE_EXTENSION_RE.test(ext) && !blockedExts.includes(ext));

    if (validatedExtensions.length === 0) {
        settings.attachmentFileExtensions = "none";
    } else {
        settings.attachmentFileExtensions = validatedExtensions.join(",");
    }

    await saveSettings(settings);
}
