/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createCipheriv, randomBytes } from "crypto";
import type { IpcMainInvokeEvent } from "electron";

type NativeResult<T> = ({ success: true; } & T) | { success: false; error: string; };

interface UploadSession {
    apiKey: string;
    controller: AbortController;
    dropId: string;
    etags: Array<string | undefined>;
    fileId: string;
    fileIv: Buffer;
    fileSize: number;
    key: Buffer;
    s3UploadId: string;
    uploadUrls: string[];
}

const API_BASE = "https://anon.li/api/v1";
const SHARE_BASE = "https://anon.li/d";
const FILENAME_IV_INDEX = 0xFFFFFFFF;
const CHUNK_SIZE = 50 * 1024 * 1024;
const MAX_FILE_SIZE = 250 * 1024 * 1024 * 1024;
const MAX_DOWNLOADS = 1_000_000;
const MAX_JSON_SIZE = 16 * 1024 * 1024;
const API_TIMEOUT = 30_000;
const UPLOAD_TIMEOUT = 10 * 60_000;
const sessions = new Map<string, UploadSession>();

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function getRecord(record: Record<string, unknown>, key: string) {
    const value = record[key];

    return isRecord(value) ? value : undefined;
}

function getString(record: Record<string, unknown> | undefined, key: string) {
    const value = record?.[key];

    return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toBuffer(value: unknown) {
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (ArrayBuffer.isView(value)) return Buffer.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));

    return undefined;
}

function deriveChunkIv(baseIv: Buffer, chunkIndex: number) {
    const iv = Buffer.alloc(12);

    baseIv.copy(iv, 0, 0, 8);
    iv.writeUInt32BE(chunkIndex, 8);

    return iv;
}

function encryptBuffer(key: Buffer, iv: Buffer, data: Buffer) {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);

    return Buffer.concat([encrypted, cipher.getAuthTag()]);
}

function encryptText(key: Buffer, iv: Buffer, text: string) {
    return encryptBuffer(key, iv, Buffer.from(text, "utf8")).toString("base64url");
}

function getResponseData(response: unknown) {
    if (!isRecord(response)) return undefined;

    return getRecord(response, "data") ?? response;
}

function getDropId(response: unknown) {
    const data = getResponseData(response);

    return getString(data, "drop_id") ?? getString(data, "dropId") ?? getString(data, "id");
}

function getApiError(response: unknown) {
    if (!isRecord(response)) return undefined;

    const error = getRecord(response, "error");
    const data = getRecord(response, "data");

    return getString(error, "message")
        ?? getString(response, "error")
        ?? getString(response, "message")
        ?? getString(data, "error")
        ?? getString(data, "message");
}

function getSafeUploadUrl(value: unknown) {
    if (typeof value !== "string") return undefined;

    try {
        const url = new URL(value);

        if (url.protocol !== "https:" || url.username || url.password || !url.hostname.endsWith(".r2.cloudflarestorage.com")) return undefined;

        return url.toString();
    } catch {
        return undefined;
    }
}

function getUploadDetails(response: unknown, chunkCount: number) {
    const data = getResponseData(response);
    if (!data) return undefined;

    const fileId = getString(data, "fileId") ?? getString(data, "id");
    const s3UploadId = getString(data, "s3UploadId");
    const uploadUrls = getRecord(data, "uploadUrls");
    if (!fileId || !s3UploadId || !uploadUrls || Object.keys(uploadUrls).length !== chunkCount) return undefined;

    const urls: string[] = [];
    for (let partNumber = 1; partNumber <= chunkCount; partNumber++) {
        const url = getSafeUploadUrl(uploadUrls[String(partNumber)]);
        if (!url) return undefined;
        urls.push(url);
    }

    return { fileId, s3UploadId, uploadUrls: urls };
}

async function readJson(response: Response) {
    const contentLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_JSON_SIZE) throw new Error("Anon.li returned a response that was too large.");

    const reader = response.body?.getReader();
    if (!reader) return {};

    const chunks: Uint8Array[] = [];
    let size = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        size += value.byteLength;
        if (size > MAX_JSON_SIZE) {
            await reader.cancel();
            throw new Error("Anon.li returned a response that was too large.");
        }
        chunks.push(value);
    }

    const text = Buffer.concat(chunks).toString("utf8");
    if (!text) return {};

    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new Error("Anon.li returned an invalid response.");
    }
}

async function requestJson(url: string, apiKey: string, body: Record<string, unknown>, method = "POST") {
    const response = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(API_TIMEOUT)
    });
    const json = await readJson(response);

    if (!response.ok) {
        throw new Error(getApiError(json) ?? `Anon.li request failed with HTTP ${response.status}.`);
    }

    return json;
}

async function cleanupUpload(apiKey: string, dropId: string, fileId?: string, s3UploadId?: string) {
    if (fileId && s3UploadId) {
        await requestJson(
            `${API_BASE}/drop/${encodeURIComponent(dropId)}/file/${encodeURIComponent(fileId)}`,
            apiKey,
            { s3UploadId },
            "DELETE"
        );
        return;
    }

    await requestJson(`${API_BASE}/drop/${encodeURIComponent(dropId)}`, apiKey, {}, "DELETE");
}

export async function beginUpload(
    _event: IpcMainInvokeEvent,
    apiKey: unknown,
    fileName: unknown,
    mimeType: unknown,
    fileSize: unknown,
    expiryDays: unknown,
    maxDownloads: unknown
): Promise<NativeResult<{ uploadId: string; chunkCount: number; chunkSize: number; }>> {
    const normalizedApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
    const normalizedFileName = typeof fileName === "string" ? fileName.trim() : "";
    const normalizedMimeType = typeof mimeType === "string" && mimeType.trim() ? mimeType.trim() : "application/octet-stream";
    const normalizedFileSize = getNumber(fileSize);
    const normalizedExpiry = clamp(Math.round(getNumber(expiryDays) ?? 3), 1, 30);
    const normalizedMaxDownloads = clamp(Math.round(getNumber(maxDownloads) ?? 0), 0, MAX_DOWNLOADS);

    if (!normalizedApiKey || normalizedApiKey.length > 256 || !normalizedApiKey.startsWith("ak_")) {
        return { success: false, error: "Anon.li API key is invalid." };
    }
    if (!normalizedFileName) return { success: false, error: "File name is invalid." };
    if (normalizedMimeType.length > 200 || !/^[\w-]+\/[\w+.-]+$/.test(normalizedMimeType)) {
        return { success: false, error: "File type is invalid." };
    }
    if (normalizedFileSize === undefined || !Number.isSafeInteger(normalizedFileSize) || normalizedFileSize < 1 || normalizedFileSize > MAX_FILE_SIZE) {
        return { success: false, error: "File size must be between 1 byte and 250 GiB." };
    }

    let dropId: string | undefined;
    let fileId: string | undefined;
    let s3UploadId: string | undefined;

    try {
        const key = randomBytes(32);
        const dropIv = randomBytes(12);
        const fileIv = randomBytes(12);
        const chunkSize = Math.min(normalizedFileSize, CHUNK_SIZE);
        const chunkCount = Math.ceil(normalizedFileSize / chunkSize);
        const encryptedSize = normalizedFileSize + chunkCount * 16;
        const encryptedName = encryptText(key, deriveChunkIv(fileIv, FILENAME_IV_INDEX), normalizedFileName);
        const encryptedTitle = encryptText(key, deriveChunkIv(dropIv, FILENAME_IV_INDEX), normalizedFileName);
        if (encryptedName.length > 2048) return { success: false, error: "File name is too long." };

        const createBody: Record<string, unknown> = {
            iv: dropIv.toString("base64url"),
            fileCount: 1,
            expiry: normalizedExpiry
        };

        if (encryptedTitle.length <= 1024) createBody.encryptedTitle = encryptedTitle;
        if (normalizedMaxDownloads > 0) createBody.maxDownloads = normalizedMaxDownloads;

        const drop = await requestJson(`${API_BASE}/drop`, normalizedApiKey, createBody);
        dropId = getDropId(drop);
        if (!dropId) throw new Error("Anon.li did not return a drop id.");

        const file = await requestJson(
            `${API_BASE}/drop/${encodeURIComponent(dropId)}/file`,
            normalizedApiKey,
            {
                size: encryptedSize,
                encryptedName,
                iv: fileIv.toString("base64url"),
                mimeType: normalizedMimeType,
                chunkCount,
                chunkSize
            }
        );
        const upload = getUploadDetails(file, chunkCount);
        if (!upload) throw new Error("Anon.li returned an invalid file upload response.");

        fileId = upload.fileId;
        s3UploadId = upload.s3UploadId;

        const uploadId = randomBytes(16).toString("base64url");
        sessions.set(uploadId, {
            apiKey: normalizedApiKey,
            controller: new AbortController(),
            dropId,
            etags: Array.from({ length: chunkCount }),
            fileId,
            fileIv,
            fileSize: normalizedFileSize,
            key,
            s3UploadId,
            uploadUrls: upload.uploadUrls
        });

        return { success: true, uploadId, chunkCount, chunkSize };
    } catch (error) {
        if (dropId) await cleanupUpload(normalizedApiKey, dropId, fileId, s3UploadId).catch(() => undefined);

        return { success: false, error: error instanceof Error ? error.message : "Anon.li upload failed." };
    }
}

export async function uploadChunk(
    _event: IpcMainInvokeEvent,
    uploadId: unknown,
    chunkIndex: unknown,
    data: unknown
): Promise<{ success: true; } | { success: false; error: string; }> {
    if (typeof uploadId !== "string" || typeof chunkIndex !== "number" || !Number.isSafeInteger(chunkIndex)) {
        return { success: false, error: "Upload session is invalid." };
    }

    const session = sessions.get(uploadId);
    if (!session || chunkIndex < 0 || chunkIndex >= session.uploadUrls.length) {
        return { success: false, error: "Upload session is no longer available." };
    }

    const chunk = toBuffer(data);
    const chunkSize = Math.min(CHUNK_SIZE, session.fileSize - chunkIndex * CHUNK_SIZE);
    if (!chunk || chunk.length !== chunkSize) return { success: false, error: "Upload chunk is invalid." };

    try {
        const encrypted = encryptBuffer(session.key, deriveChunkIv(session.fileIv, chunkIndex), chunk);
        const response = await fetch(session.uploadUrls[chunkIndex], {
            method: "PUT",
            body: encrypted,
            redirect: "error",
            signal: AbortSignal.any([session.controller.signal, AbortSignal.timeout(UPLOAD_TIMEOUT)])
        });
        const etag = response.headers.get("ETag");

        if (!response.ok) return { success: false, error: `Storage upload failed with HTTP ${response.status}.` };
        if (!etag) return { success: false, error: "Storage upload did not return an ETag." };

        session.etags[chunkIndex] = etag;
        return { success: true };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Storage upload failed." };
    }
}

export async function finishUpload(
    _event: IpcMainInvokeEvent,
    uploadId: unknown
): Promise<NativeResult<{ url: string; }>> {
    if (typeof uploadId !== "string") return { success: false, error: "Upload session is invalid." };

    const session = sessions.get(uploadId);
    if (!session || session.etags.some(etag => !etag)) return { success: false, error: "Upload is incomplete." };

    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await requestJson(
                `${API_BASE}/drop/${encodeURIComponent(session.dropId)}?action=finish`,
                session.apiKey,
                {
                    files: [{
                        fileId: session.fileId,
                        chunks: session.etags.map((etag, chunkIndex) => ({ chunkIndex, etag }))
                    }]
                },
                "PATCH"
            );

            sessions.delete(uploadId);
            return { success: true, url: `${SHARE_BASE}/${session.dropId}#${session.key.toString("base64url")}` };
        } catch (error) {
            lastError = error;
        }
    }

    return { success: false, error: lastError instanceof Error ? lastError.message : "Anon.li could not finalize the upload." };
}

export async function abortUpload(_event: IpcMainInvokeEvent, uploadId: unknown): Promise<void> {
    if (typeof uploadId !== "string") return;

    const session = sessions.get(uploadId);
    if (!session) return;

    sessions.delete(uploadId);
    session.controller.abort();
    await cleanupUpload(session.apiKey, session.dropId, session.fileId, session.s3UploadId).catch(() => undefined);
}
