/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import type { Channel, Message } from "@vencord/discord-types";
import { ChannelStore, showToast, Toasts } from "@webpack/common";

import { settings } from "./settings";

const STORAGE_KEY = "SecureBookmarks_bookmarks_v1";
const ENCRYPTION_ITERATIONS = 600_000;
const EMPTY_STORE: BookmarkStore = { version: 1, records: [] };
const IMAGE_FILE_EXTENSION = /\.(?:apng|avif|bmp|gif|jpe?g|png|svg|webp)$/i;

export type BookmarkDuration = "forever" | "30m" | "1h" | "2h" | "1d" | "1w";

export interface BookmarkDurationOption {
    label: string;
    value: BookmarkDuration;
    milliseconds: number | null;
}

interface BookmarkPayload {
    messageId: string;
    channelId: string;
    guildId: string | null;
    authorId: string;
    authorName: string;
    channelName: string;
    content: string;
    attachmentNames: string[];
    images?: BookmarkImage[];
    embedCount: number;
    link: string;
    messageTimestamp: number;
    savedAt: number;
}

export interface BookmarkImage {
    url: string;
    proxyUrl: string;
    filename: string;
    width?: number;
    height?: number;
    spoiler?: boolean;
}

interface EncryptedPayload {
    iv: string;
    data: string;
}

interface StoredBookmarkRecord {
    id: string;
    savedAt: number;
    expiresAt: number | null;
    payload?: BookmarkPayload;
    encrypted?: EncryptedPayload;
}

interface BookmarkStore {
    version: 1;
    salt?: string;
    records: StoredBookmarkRecord[];
}

export interface VisibleBookmark extends BookmarkPayload {
    id: string;
    expiresAt: number | null;
}

export interface BookmarkProtectionState {
    hasEncrypted: boolean;
    hasPlain: boolean;
    total: number;
}

export const DURATIONS: BookmarkDurationOption[] = [
    { label: "Forever", value: "forever", milliseconds: null },
    { label: "30 minutes", value: "30m", milliseconds: 30 * 60 * 1000 },
    { label: "1 hour", value: "1h", milliseconds: 60 * 60 * 1000 },
    { label: "2 hours", value: "2h", milliseconds: 2 * 60 * 60 * 1000 },
    { label: "1 day", value: "1d", milliseconds: 24 * 60 * 60 * 1000 },
    { label: "1 week", value: "1w", milliseconds: 7 * 24 * 60 * 60 * 1000 }
];

function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function randomBase64(byteLength: number): string {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return bytesToBase64(bytes);
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
}

async function deriveEncryptionKey(password: string, salt: string): Promise<CryptoKey> {
    const baseKey = await crypto.subtle.importKey(
        "raw",
        bytesToArrayBuffer(new TextEncoder().encode(password)),
        "PBKDF2",
        false,
        ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: bytesToArrayBuffer(base64ToBytes(salt)),
            iterations: ENCRYPTION_ITERATIONS,
            hash: "SHA-256"
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

async function encryptPayload(payload: BookmarkPayload, key: CryptoKey): Promise<EncryptedPayload> {
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);

    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: bytesToArrayBuffer(iv) },
        key,
        bytesToArrayBuffer(new TextEncoder().encode(JSON.stringify(payload)))
    );

    return {
        iv: bytesToBase64(iv),
        data: bytesToBase64(new Uint8Array(encrypted))
    };
}

async function decryptPayload(payload: EncryptedPayload, key: CryptoKey): Promise<BookmarkPayload> {
    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytesToArrayBuffer(base64ToBytes(payload.iv)) },
        key,
        bytesToArrayBuffer(base64ToBytes(payload.data))
    );

    return JSON.parse(new TextDecoder().decode(decrypted)) as BookmarkPayload;
}

async function loadStore(): Promise<BookmarkStore> {
    const stored = await DataStore.get<BookmarkStore>(STORAGE_KEY);
    if (!stored || stored.version !== 1 || !Array.isArray(stored.records)) return EMPTY_STORE;
    return stored;
}

async function saveStore(store: BookmarkStore): Promise<void> {
    await DataStore.set(STORAGE_KEY, store);
}

async function encryptPlainRecords(store: BookmarkStore, password: string): Promise<BookmarkStore> {
    if (!password || !store.records.some(record => record.payload)) return store;

    const salt = store.salt ?? randomBase64(16);
    const key = await deriveEncryptionKey(password, salt);
    const records: StoredBookmarkRecord[] = [];

    for (const record of store.records) {
        if (!record.payload) {
            records.push(record);
            continue;
        }

        records.push({
            id: record.id,
            savedAt: record.savedAt,
            expiresAt: record.expiresAt,
            encrypted: await encryptPayload(record.payload, key)
        });
    }

    const next = { version: 1, salt, records } satisfies BookmarkStore;
    await saveStore(next);
    return next;
}

function buildMessageLink(message: Message, channel: Channel): string {
    return `${window.location.origin}/channels/${channel.guild_id ?? "@me"}/${channel.id}/${message.id}`;
}

function isImageAttachment(filename: string, contentType?: string): boolean {
    return contentType?.startsWith("image/") || IMAGE_FILE_EXTENSION.test(filename);
}

function getBookmarkImages(message: Message): BookmarkImage[] {
    const images: BookmarkImage[] = message.attachments
        .filter(attachment => isImageAttachment(attachment.filename, attachment.content_type))
        .map(attachment => ({
            url: attachment.url,
            proxyUrl: attachment.proxy_url || attachment.url,
            filename: attachment.title || attachment.filename,
            width: attachment.width,
            height: attachment.height,
            spoiler: attachment.spoiler
        }));

    for (const embed of message.embeds) {
        for (const image of [embed.image, embed.thumbnail, ...(embed.images ?? [])]) {
            if (!image?.url) continue;

            images.push({
                url: image.url,
                proxyUrl: image.proxyURL || image.url,
                filename: embed.rawTitle || embed.url || "Embed image",
                width: image.width,
                height: image.height,
                spoiler: false
            });
        }
    }

    return images.filter((image, index) =>
        images.findIndex(otherImage => otherImage.url === image.url) === index
    );
}

function buildPayload(message: Message, channel: Channel): BookmarkPayload {
    return {
        messageId: message.id,
        channelId: channel.id,
        guildId: channel.guild_id ?? null,
        authorId: message.author.id,
        authorName: message.author.globalName ?? message.author.username,
        channelName: channel.name || "Direct message",
        content: message.content,
        attachmentNames: message.attachments.map(attachment => attachment.filename),
        images: getBookmarkImages(message),
        embedCount: message.embeds.length,
        link: buildMessageLink(message, channel),
        messageTimestamp: message.timestamp.getTime(),
        savedAt: Date.now()
    };
}

export async function cleanupExpiredBookmarks(): Promise<BookmarkStore> {
    const store = await loadStore();
    const now = Date.now();
    const records = store.records.filter(record => record.expiresAt === null || record.expiresAt > now);
    if (records.length !== store.records.length) {
        const next = { ...store, records };
        await saveStore(next);
        return next;
    }
    return store;
}

export async function getBookmarkProtectionState(): Promise<BookmarkProtectionState> {
    const store = await cleanupExpiredBookmarks();

    return {
        hasEncrypted: store.records.some(record => Boolean(record.encrypted)),
        hasPlain: store.records.some(record => Boolean(record.payload)),
        total: store.records.length
    };
}

export async function saveMessageBookmark(message: Message, duration: BookmarkDurationOption): Promise<void> {
    const channel = ChannelStore.getChannel(message.channel_id);
    if (!channel) {
        showToast("Open the channel before saving this bookmark.", Toasts.Type.FAILURE);
        return;
    }

    let store = await cleanupExpiredBookmarks();
    const payload = buildPayload(message, channel);
    const recordBase = {
        id: crypto.randomUUID(),
        savedAt: payload.savedAt,
        expiresAt: duration.milliseconds === null ? null : payload.savedAt + duration.milliseconds
    };

    let record: StoredBookmarkRecord;
    if (settings.plain.usePassword) {
        const { password } = settings.plain;
        if (!password) {
            showToast("Set a SecureBookmarks password before saving.", Toasts.Type.FAILURE);
            return;
        }

        store = await encryptPlainRecords(store, password);
        const salt = store.salt ?? randomBase64(16);
        const key = await deriveEncryptionKey(password, salt);
        record = { ...recordBase, encrypted: await encryptPayload(payload, key) };
        await saveStore({ version: 1, salt, records: [record, ...store.records] });
    } else {
        record = { ...recordBase, payload };
        await saveStore({ ...store, records: [record, ...store.records] });
    }

    showToast(`Bookmark saved${duration.milliseconds === null ? "." : ` for ${duration.label.toLowerCase()}.`}`, Toasts.Type.SUCCESS);
}

export async function getVisibleBookmarks(password: string): Promise<VisibleBookmark[]> {
    let store = await cleanupExpiredBookmarks();
    if (settings.plain.usePassword) store = await encryptPlainRecords(store, password);

    const key = password && store.salt
        ? await deriveEncryptionKey(password, store.salt)
        : null;
    const bookmarks: VisibleBookmark[] = [];

    for (const record of store.records) {
        const payload = record.payload ?? (record.encrypted && key ? await decryptPayload(record.encrypted, key) : null);
        if (!payload) continue;
        bookmarks.push({ ...payload, id: record.id, expiresAt: record.expiresAt });
    }

    return bookmarks;
}

export async function removeBookmark(id: string): Promise<void> {
    const store = await loadStore();
    await saveStore({ ...store, records: store.records.filter(record => record.id !== id) });
}

export async function clearBookmarks(): Promise<void> {
    const store = await loadStore();
    await saveStore({ ...store, records: [] });
}

export async function prepareBookmarks(): Promise<void> {
    const store = await cleanupExpiredBookmarks();
    if (settings.plain.usePassword && settings.plain.password) {
        await encryptPlainRecords(store, settings.plain.password);
    }
}
