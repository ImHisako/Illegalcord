/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, type PluginNative, ReporterTestable } from "@utils/types";
import { ChannelStore, DraftType, FluxDispatcher, SelectedChannelStore, showToast, Toasts, UploadHandler } from "@webpack/common";

const Native = VencordNative?.pluginHelpers?.SecureZipper as PluginNative<typeof import("./native")> | undefined;
const securedFiles = new WeakSet<File>();
const SEVEN_ZIP_MIME = "application/x-7z-compressed";
const SEVEN_ZIP_SIGNATURE = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] as const;
let uploadAddFilesInterceptor: ((event: unknown) => void) | null = null;

interface UploadAddFilesEvent {
    type?: unknown;
    files?: unknown;
    uploads?: unknown;
    items?: unknown;
    draftType?: unknown;
    channelId?: unknown;
    channel?: {
        id?: unknown;
    };
}

const settings = definePluginSettings({
    password: {
        type: OptionType.STRING,
        description: "Password used to encrypt uploaded 7z archives with AES-256.",
        default: "",
        placeholder: "Archive password",
        componentProps: {
            type: "password",
            autoComplete: "new-password"
        },
        isValid(value: string) {
            if (value.length === 0) return "Password cannot be empty.";
            if (/[\r\n]/.test(value)) return "Password cannot contain line breaks.";
            return true;
        }
    }
});

function extractFilesFromValue(value: unknown): File[] {
    if (value instanceof File) return [value];

    if (!Array.isArray(value)) return [];

    return value.flatMap(entry => {
        if (entry instanceof File) return [entry];
        if (!entry || typeof entry !== "object" || !("file" in entry)) return [];
        return entry.file instanceof File ? [entry.file] : [];
    });
}

function getUploadChannel(payload: UploadAddFilesEvent) {
    const channelId = typeof payload.channelId === "string"
        ? payload.channelId
        : typeof payload.channel?.id === "string"
            ? payload.channel.id
            : SelectedChannelStore.getChannelId();

    return ChannelStore.getChannel(channelId);
}

function isSevenZipArchive(data: ArrayBuffer): boolean {
    const bytes = new Uint8Array(data);
    return SEVEN_ZIP_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

async function createArchiveFile(file: File, password: string): Promise<File | null> {
    const result = await Native?.createArchive(file.name || "file", await file.arrayBuffer(), password);

    if (!result?.success || !result.data || !result.fileName) {
        showToast(result?.error ?? `Could not encrypt ${file.name}.`, Toasts.Type.FAILURE);
        return null;
    }

    if (!isSevenZipArchive(result.data)) {
        showToast(`Could not create a valid archive for ${file.name}.`, Toasts.Type.FAILURE);
        return null;
    }

    const archive = new File([result.data], result.fileName, { type: SEVEN_ZIP_MIME });
    securedFiles.add(archive);
    return archive;
}

async function uploadEncryptedFiles(files: File[], payload: UploadAddFilesEvent, password: string): Promise<void> {
    const channel = getUploadChannel(payload);
    if (!channel) {
        showToast("Open a channel before uploading files.", Toasts.Type.FAILURE);
        return;
    }

    showToast(`Creating encrypted 7z archive${files.length === 1 ? "" : "s"}.`, Toasts.Type.MESSAGE);

    const archives: File[] = [];
    for (const file of files) {
        if (securedFiles.has(file)) {
            archives.push(file);
            continue;
        }

        const archive = await createArchiveFile(file, password);
        if (!archive) return;
        archives.push(archive);
    }

    await UploadHandler.promptToUpload(archives, channel, typeof payload.draftType === "number" ? payload.draftType : DraftType.ChannelMessage);
}

function interceptUploadAddFiles(event: unknown): void {
    if (!event || typeof event !== "object" || !("type" in event)) return;

    const payload = event as UploadAddFilesEvent;
    if (payload.type !== "UPLOAD_ATTACHMENT_ADD_FILES") return;

    const files = [
        ...extractFilesFromValue(payload.files),
        ...extractFilesFromValue(payload.uploads),
        ...extractFilesFromValue(payload.items)
    ];
    const uniqueFiles = Array.from(new Set(files));

    if (!uniqueFiles.length || uniqueFiles.every(file => securedFiles.has(file))) return;

    payload.files = [];
    payload.uploads = [];
    payload.items = [];

    const { password } = settings.store;
    if (!password) {
        showToast("Set a SecureZipper password before sending files.", Toasts.Type.FAILURE);
        return;
    }

    if (!Native) {
        showToast("SecureZipper native helper is not available. Restart Discord.", Toasts.Type.FAILURE);
        return;
    }

    void uploadEncryptedFiles(uniqueFiles, payload, password).catch(() => {
        showToast("Could not encrypt the selected files.", Toasts.Type.FAILURE);
    });
}

export default definePlugin({
    name: "SecureZipper",
    description: "Encrypts Discord uploads into 7z archives with AES-256 before sending.",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    tags: ["Privacy", "Utility"],
    reporterTestable: ReporterTestable.None,
    settings,

    start() {
        if (uploadAddFilesInterceptor) return;
        uploadAddFilesInterceptor = event => interceptUploadAddFiles(event);
        FluxDispatcher.addInterceptor(uploadAddFilesInterceptor);
    },

    stop() {
        if (!uploadAddFilesInterceptor) return;

        const index = FluxDispatcher._interceptors.indexOf(uploadAddFilesInterceptor);
        if (index > -1) FluxDispatcher._interceptors.splice(index, 1);
        uploadAddFilesInterceptor = null;
    }
});
