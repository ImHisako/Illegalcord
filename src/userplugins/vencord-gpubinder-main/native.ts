/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile as childExecFile } from "child_process";
import type { IpcMainInvokeEvent } from "electron";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { promisify } from "util";

const execFile = promisify(childExecFile);

const REG_PATH = "HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences";

export interface GpuInfo {
    id: string;
    specificAdapter: string;
    name: string;
    vendor: string;
    driverVersion: string;
    dedicatedMemoryBytes: number;
    preference: GpuPreference;
    preferenceLabel: string;
}

type GpuPreference = 0 | 1 | 2;

interface RawGpuInfo {
    Name?: string;
    PNPDeviceID?: string;
    AdapterCompatibility?: string;
    DriverVersion?: string;
    AdapterRAM?: number;
}

interface AppliedGpuPreference {
    changed: boolean;
    selectedGpu: GpuInfo | null;
    preference: GpuPreference;
}

export interface GpuState {
    gpus: GpuInfo[];
    configuredGpuId: string;
    configuredGpu: GpuInfo | null;
}

function getPreferenceLabel(preference: GpuPreference) {
    switch (preference) {
        case 2:
            return "High performance";
        case 1:
            return "Power saving";
        default:
            return "System default";
    }
}

function inferGpuPreference(name: string, vendor: string): GpuPreference {
    const haystack = `${name} ${vendor}`.toLowerCase();

    if (/\b(radeon\(tm\) graphics|radeon graphics|radeon \d{3,4}m)\b/.test(haystack)) {
        return 1;
    }

    if (/\b(nvidia|geforce|quadro|rtx|gtx|tesla|radeon rx|radeon pro|firepro|intel\(r\) arc|intel arc)\b/.test(haystack)) {
        return 2;
    }

    if (/\b(intel|uhd graphics|iris xe|hd graphics|vega|integrated)\b/.test(haystack)) {
        return 1;
    }

    return 2;
}

function getSpecificAdapterId(pnpDeviceId: string) {
    const match = /VEN_([^&]+)&DEV_([^&]+)&SUBSYS_([^&]+)/i.exec(pnpDeviceId);
    if (!match) return "";

    return `${match[1]}&${match[2]}&${match[3]}`.toUpperCase();
}

function parseSpecificAdapter(value: string) {
    return /SpecificAdapter=([^;]+)/i.exec(value)?.[1]?.toUpperCase() ?? "";
}

function normalizeGpu(rawGpu: RawGpuInfo, index: number): GpuInfo | null {
    const name = rawGpu.Name?.trim();
    if (!name) return null;

    const vendor = rawGpu.AdapterCompatibility?.trim() || "Unknown vendor";
    const pnpDeviceId = rawGpu.PNPDeviceID?.trim() || "";
    const specificAdapter = getSpecificAdapterId(pnpDeviceId);
    const id = pnpDeviceId || specificAdapter || `${vendor}:${name}:${index}`;
    const preference = inferGpuPreference(name, vendor);

    return {
        id,
        specificAdapter,
        name,
        vendor,
        driverVersion: rawGpu.DriverVersion?.trim() || "Unknown driver",
        dedicatedMemoryBytes: Math.max(0, Number(rawGpu.AdapterRAM) || 0),
        preference,
        preferenceLabel: getPreferenceLabel(preference),
    };
}

function parsePowerShellJson<T>(stdout: string, fallback: T): T {
    const output = stdout.trim();
    if (!output) return fallback;

    return JSON.parse(output) as T;
}

async function runPowerShell(script: string, args: string[] = []) {
    const encodedArgs = args.map(arg => `"${Buffer.from(arg, "utf8").toString("base64")}"`).join(", ");
    const callArgs = args.map((_, index) => `([string]$__GpuBinderArgs[${index}])`).join(" ");
    const encodedCommand = Buffer.from(`
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$__GpuBinderEncodedArgs = @(${encodedArgs})
$__GpuBinderArgs = foreach ($__GpuBinderArg in $__GpuBinderEncodedArgs) {
    [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($__GpuBinderArg))
}

& {
${script}
} ${callArgs}
`, "utf16le").toString("base64");

    return execFile("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodedCommand,
    ], { windowsHide: true, maxBuffer: 1024 * 1024 });
}

async function getRegistryPreference(discordPath: string): Promise<string> {
    const { stdout } = await runPowerShell(`
param([string] $Path, [string] $Name)
if (Test-Path $Path) {
    try {
        Get-ItemPropertyValue -Path $Path -Name $Name -ErrorAction Stop
    } catch {
        Write-Output ""
    }
}
`, [REG_PATH, discordPath]);

    return stdout.trim();
}

async function setRegistryPreference(discordPath: string, preference: GpuPreference) {
    await runPowerShell(`
param([string] $Path, [string] $Name, [string] $Value)
if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
}
Set-ItemProperty -Path $Path -Name $Name -Value $Value -Type String -Force
`, [REG_PATH, discordPath, `GpuPreference=${preference};`]);
}

async function setSpecificAdapterPreference(discordPath: string, specificAdapter: string) {
    await runPowerShell(`
param([string] $Path, [string] $Name, [string] $Adapter)
if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
}
Set-ItemProperty -Path $Path -Name $Name -Value "SpecificAdapter=$Adapter;GpuPreference=1073741824;" -Type String -Force
`, [REG_PATH, discordPath, specificAdapter]);
}

async function cleanupStaleDiscordEntries(discordPath: string) {
    await runPowerShell(`
param([string] $Path, [string] $CurrentPath)
if (-not (Test-Path $Path)) {
    return
}

$props = Get-ItemProperty -Path $Path
$props.PSObject.Properties |
    Where-Object {
        $_.Name -like '*Discord.exe*' -and
        $_.Name -ne $CurrentPath -and
        -not (Test-Path -LiteralPath $_.Name)
    } |
    ForEach-Object {
        Remove-ItemProperty -Path $Path -Name $_.Name -ErrorAction SilentlyContinue
    }
`, [REG_PATH, discordPath]);
}

function getDiscordGpuTargetPaths() {
    const appDir = dirname(process.execPath);
    const discordRoot = dirname(appDir);
    const targets = [
        process.execPath,
        join(discordRoot, "Update.exe"),
        join(appDir, "modules", "discord_utils-1", "discord_utils", "DiscordSystemHelper.exe"),
    ];

    return targets.filter((target, index) => targets.indexOf(target) === index && existsSync(target));
}

async function getBestExistingDiscordPreference(discordPath: string): Promise<string> {
    const currentValue = await getRegistryPreference(discordPath);
    if (parseSpecificAdapter(currentValue)) return currentValue;

    const { stdout } = await runPowerShell(`
param([string] $Path, [string] $CurrentPath)
if (-not (Test-Path $Path)) {
    return
}

$props = Get-ItemProperty -Path $Path
$props.PSObject.Properties |
    Where-Object {
        $_.Name -like '*Discord*' -and
        $_.Value -is [string] -and
        $_.Value -match 'SpecificAdapter='
    } |
    Sort-Object @{
        Expression = {
            if ($_.Name -eq $CurrentPath) { 0 }
            elseif ($_.Name -like '*Update.exe') { 1 }
            elseif ($_.Name -like '*DiscordSystemHelper.exe') { 2 }
            else { 3 }
        }
    } |
    Select-Object -First 1 -ExpandProperty Value
`, [REG_PATH, discordPath]);

    return stdout.trim();
}

async function enumerateGpus(): Promise<GpuInfo[]> {
    if (process.platform !== "win32") return [];

    try {
        const { stdout } = await runPowerShell(`
$gpus = Get-CimInstance Win32_VideoController |
    Select-Object Name, PNPDeviceID, AdapterCompatibility, DriverVersion, AdapterRAM

if ($null -eq $gpus) {
    @() | ConvertTo-Json -Compress
} else {
    @($gpus) | ConvertTo-Json -Compress
}
`);
        const rawGpus = parsePowerShellJson<RawGpuInfo[]>(stdout, []);

        return rawGpus
            .map(normalizeGpu)
            .filter(Boolean) as GpuInfo[];
    } catch (error) {
        console.error("[GpuBinder Native] Failed to enumerate GPUs:", error);
        return [];
    }
}

async function resolveSelectedGpu(selectedGpuId: string): Promise<GpuInfo | null> {
    const gpus = await enumerateGpus();

    if (selectedGpuId) {
        const selectedGpu = gpus.find(gpu => gpu.id === selectedGpuId);
        if (selectedGpu) return selectedGpu;
    }

    return gpus.find(gpu => gpu.preference === 2) ?? gpus[0] ?? null;
}

function findGpuBySpecificAdapter(gpus: GpuInfo[], specificAdapter: string) {
    return gpus.find(gpu => gpu.specificAdapter === specificAdapter) ?? null;
}

/**
 * Manages Windows Graphics Settings (DirectX) for Discord.
 * Automatically binds the current Discord executable to the preferred GPU
 * and cleans up stale registry entries from previous versions.
 */
export async function getGpus(_event: IpcMainInvokeEvent): Promise<GpuInfo[]> {
    return enumerateGpus();
}

export async function getGpuState(_event: IpcMainInvokeEvent): Promise<GpuState> {
    const gpus = await enumerateGpus();

    if (process.platform !== "win32") {
        return { gpus, configuredGpuId: "", configuredGpu: null };
    }

    try {
        const currentValue = await getBestExistingDiscordPreference(process.execPath);
        const configuredGpu = findGpuBySpecificAdapter(gpus, parseSpecificAdapter(currentValue));

        return {
            gpus,
            configuredGpuId: configuredGpu?.id ?? "",
            configuredGpu,
        };
    } catch (error) {
        console.error("[GpuBinder Native] Failed to read configured GPU:", error);
        return { gpus, configuredGpuId: "", configuredGpu: null };
    }
}

export async function applyGpuPreference(_event: IpcMainInvokeEvent, selectedGpuId: string | number): Promise<AppliedGpuPreference> {
    // Only Windows supports this registry-based GPU binding
    if (process.platform !== "win32") {
        return { changed: false, selectedGpu: null, preference: 0 };
    }

    // Current Discord executable path (changes with every update)
    const discordPath = process.execPath;
    const targetPaths = getDiscordGpuTargetPaths();

    try {
        const selectedGpu = typeof selectedGpuId === "number"
            ? null
            : await resolveSelectedGpu(selectedGpuId);
        const preference = typeof selectedGpuId === "number"
            ? Math.max(0, Math.min(2, selectedGpuId)) as GpuPreference
            : selectedGpu?.preference ?? 2;
        const gpuValue = selectedGpu?.specificAdapter
            ? `SpecificAdapter=${selectedGpu.specificAdapter};GpuPreference=1073741824;`
            : `GpuPreference=${preference};`;

        let changed = false;

        for (const targetPath of targetPaths) {
            // 1. Check if this executable already has the correct preference set
            const currentValue = await getRegistryPreference(targetPath);

            // 2. Apply or update settings if they don't match the desired preference
            if (currentValue !== gpuValue) {
                if (selectedGpu?.specificAdapter) {
                    await setSpecificAdapterPreference(targetPath, selectedGpu.specificAdapter);
                    console.log(`[GpuBinder Native] Applied ${selectedGpu.name} specific adapter preference to ${targetPath}.`);
                } else {
                    await setRegistryPreference(targetPath, preference);
                    console.log(`[GpuBinder Native] Applied ${getPreferenceLabel(preference)} GPU preference to ${targetPath}.`);
                }
                changed = true;
            }
        }

        // 3. Stale Entries Cleanup
        // This removes old registry properties containing 'Discord.exe' that point to
        // non-existent previous version folders (e.g., app-1.0.9001), keeping the registry clean.
        await cleanupStaleDiscordEntries(discordPath);

        return { changed, selectedGpu, preference };
    } catch (error) {
        console.error("[GpuBinder Native] Registry operation failed:", error);
        throw error;
    }
}
