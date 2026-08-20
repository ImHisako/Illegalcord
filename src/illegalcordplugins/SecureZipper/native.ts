/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawn } from "child_process";
import type { IpcMainInvokeEvent } from "electron";
import { constants as fsConstants } from "fs";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, normalize, sep } from "path";

const MAX_INPUT_BYTES = 1024 * 1024 * 1024;
const MAX_PROCESS_OUTPUT = 64 * 1024;
const PROCESS_TIMEOUT_MS = 5 * 60_000;

let cachedSevenZip: string | null | undefined;

interface ArchiveResult {
    success: boolean;
    fileName?: string;
    data?: ArrayBuffer;
    error?: string;
}

interface ProcessOutput {
    chunks: Buffer[];
    length: number;
}

interface ProcessResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

export async function createArchive(
    _: IpcMainInvokeEvent,
    fileName: unknown,
    data: unknown,
    password: unknown
): Promise<ArchiveResult> {
    try {
        if (typeof fileName !== "string") return { success: false, error: "Invalid file name." };
        if (typeof password !== "string" || password.length === 0) return { success: false, error: "Password is missing." };
        if (/[\r\n]/.test(password)) return { success: false, error: "Password cannot contain line breaks." };
        if (password.length > 4096) return { success: false, error: "Password is too long." };

        const inputBuffer = toBuffer(data);
        if (!inputBuffer) return { success: false, error: "Invalid file data." };
        if (inputBuffer.length > MAX_INPUT_BYTES) return { success: false, error: "File is too large to process safely." };

        const sevenZip = await findSevenZip();
        if (!sevenZip) return { success: false, error: "7-Zip was not found. Install 7-Zip or add 7z to PATH." };

        const inputFileName = sanitizeFileName(fileName);
        if (!inputFileName) return { success: false, error: "Invalid file name." };

        const archiveFileName = getArchiveFileName(inputFileName);
        const tempDir = await mkdtemp(join(tmpdir(), "secure-zipper-"));
        await chmod(tempDir, 0o700).catch(() => undefined);

        try {
            const inputPath = join(tempDir, inputFileName);
            const archivePath = join(tempDir, archiveFileName);
            if (!isInside(tempDir, inputPath) || !isInside(tempDir, archivePath)) {
                return { success: false, error: "Invalid temporary path." };
            }

            await writeFile(inputPath, inputBuffer, { mode: 0o600 });

            const result = await runProcess(
                sevenZip,
                ["a", "-t7z", "-m0=lzma2", "-mx=9", "-mhe=on", "-mmt=on", `-p${password}`, "-y", archiveFileName, inputFileName],
                tempDir
            );

            if (result.code !== 0) {
                return { success: false, error: getSevenZipError(result) };
            }

            const archive = await readFile(archivePath);
            return {
                success: true,
                fileName: archiveFileName,
                data: archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer
            };
        } finally {
            await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        }
    } catch {
        return { success: false, error: "Could not create the archive." };
    }
}

function toBuffer(data: unknown): Buffer | null {
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return null;
}

function sanitizeFileName(fileName: string): string | null {
    const lastSegment = fileName.split(/[\\/]/).pop();
    if (!lastSegment) return null;

    let clean = lastSegment.replace(/[\x00-\x1f<>"/\\|?*:]/g, "_").trim();
    if (!clean || clean === "." || clean === "..") return null;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(clean)) clean = "_" + clean;
    if (clean.startsWith("-")) clean = "_" + clean;
    if (clean.length > 180) clean = clean.slice(0, 180).trim();

    return clean || null;
}

function getArchiveFileName(fileName: string): string {
    const dotIndex = fileName.lastIndexOf(".");
    const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
    const archiveBase = baseName || "archive";
    const archiveName = archiveBase + ".7z";

    return archiveName.toLowerCase() === fileName.toLowerCase()
        ? archiveBase + ".secure.7z"
        : archiveName;
}

function isInside(root: string, target: string): boolean {
    const normalizedRoot = normalize(root + sep);
    return normalize(target).startsWith(normalizedRoot);
}

async function findSevenZip(): Promise<string | null> {
    if (cachedSevenZip !== undefined) return cachedSevenZip;

    for (const candidate of getSevenZipPaths()) {
        if (await exists(candidate)) {
            cachedSevenZip = candidate;
            return candidate;
        }
    }

    for (const command of ["7z", "7zz", "7za"]) {
        const result = await runProcess(command, ["i"], tmpdir());
        if (result.code === 0) {
            cachedSevenZip = command;
            return command;
        }
    }

    cachedSevenZip = null;
    return null;
}

function getSevenZipPaths(): string[] {
    const paths = [
        process.env.SECUREZIPPER_7Z_PATH,
        process.env.ProgramFiles ? join(process.env.ProgramFiles, "7-Zip", "7z.exe") : undefined,
        process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"], "7-Zip", "7z.exe") : undefined,
        process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "7-Zip", "7z.exe") : undefined
    ];

    return paths.filter((path): path is string => typeof path === "string" && path.length > 0);
}

async function exists(filePath: string): Promise<boolean> {
    try {
        await access(filePath, fsConstants.F_OK);
        return true;
    } catch {
        return false;
    }
}

function runProcess(command: string, args: string[], cwd: string, stdin?: string): Promise<ProcessResult> {
    return new Promise(resolve => {
        const stdout: ProcessOutput = { chunks: [], length: 0 };
        const stderr: ProcessOutput = { chunks: [], length: 0 };
        const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        let settled = false;

        const finish = (code: number | null, extraError = "") => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve({
                code,
                stdout: outputToString(stdout),
                stderr: [outputToString(stderr), extraError].filter(Boolean).join("\n")
            });
        };

        const timeout = setTimeout(() => {
            child.kill();
            finish(null, "7-Zip timed out.");
        }, PROCESS_TIMEOUT_MS);

        child.stdout?.on("data", (chunk: Buffer) => appendOutput(stdout, chunk));
        child.stderr?.on("data", (chunk: Buffer) => appendOutput(stderr, chunk));
        child.on("error", error => finish(null, error.message));
        child.on("close", code => finish(code));
        child.stdin?.end(stdin ?? "");
    });
}

function appendOutput(output: ProcessOutput, chunk: Buffer): void {
    if (output.length >= MAX_PROCESS_OUTPUT) return;

    const remaining = MAX_PROCESS_OUTPUT - output.length;
    const slicedChunk = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
    output.chunks.push(slicedChunk);
    output.length += slicedChunk.byteLength;
}

function outputToString(output: ProcessOutput): string {
    return Buffer.concat(output.chunks, output.length).toString("utf8").trim();
}

function getSevenZipError(result: ProcessResult): string {
    const details = result.stderr || result.stdout;
    if (!details) return "7-Zip could not create the archive.";

    const lastLine = details.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1);
    return lastLine ? `7-Zip could not create the archive. ${lastLine}` : "7-Zip could not create the archive.";
}
