/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { EquicordDevs } from "@utils/constants";
import { useAwaiter } from "@utils/react";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import { Forms, React, Select, Toasts, useState } from "@webpack/common";

import type { GpuInfo, GpuState } from "./native";

const Native = VencordNative.pluginHelpers.GpuBinder as PluginNative<typeof import("./native")> | undefined;

function makeGpuLabel(gpu: GpuInfo) {
    return `${gpu.name} (${gpu.preferenceLabel})`;
}

function getDefaultGpuId(gpus: GpuInfo[]) {
    return gpus.find(gpu => gpu.preference === 2)?.id ?? gpus[0]?.id ?? "";
}

function GpuSelector({ setValue }: { setValue(newValue: string): void; }) {
    const [selectedGpuId, setSelectedGpuId] = useState("");
    const [gpuState, error, pending] = useAwaiter<GpuState>(
        () => Native?.getGpuState() ?? Promise.resolve({ gpus: [], configuredGpuId: "", configuredGpu: null }),
        { fallbackValue: { gpus: [], configuredGpuId: "", configuredGpu: null } },
    );
    const { gpus } = gpuState;
    const options = gpus.map(gpu => ({
        label: makeGpuLabel(gpu),
        value: gpu.id,
    }));
    const localGpuExists = options.some(option => option.value === selectedGpuId);
    const configuredGpuExists = options.some(option => option.value === gpuState.configuredGpuId);
    const storedGpuExists = options.some(option => option.value === settings.store.selectedGpuId);
    const currentGpuId = (localGpuExists && selectedGpuId)
        || (configuredGpuExists && gpuState.configuredGpuId)
        || (storedGpuExists && settings.store.selectedGpuId)
        || getDefaultGpuId(gpus);

    function selectGpu(gpuId: string) {
        setSelectedGpuId(gpuId);
        setValue(gpuId);
    }

    return React.createElement(
        "div",
        null,
        React.createElement(Forms.FormTitle, { tag: "h5" }, "GPU"),
        React.createElement(
            Forms.FormText,
            { style: { marginBottom: 8 } },
            "Pick the detected Windows graphics adapter Discord should be pinned to.",
        ),
        React.createElement(Select, {
            placeholder: pending ? "Detecting GPUs..." : "Select a GPU",
            options,
            maxVisibleItems: 5,
            closeOnSelect: true,
            select: selectGpu,
            isSelected: (value: string) => value === currentGpuId,
            serialize: String,
            isDisabled: pending || Boolean(error) || options.length === 0,
        }),
        React.createElement(
            Forms.FormText,
            { style: { marginTop: 8 } },
            "After switching GPUs, fully close Discord with Alt+F4 or Quit Discord from the tray, then reopen it. Ctrl+R is not enough.",
        ),
        error
            ? React.createElement(Forms.FormText, { style: { color: "var(--text-danger)", marginTop: 8 } }, "Failed to detect GPUs. Check the console for details.")
            : null,
        !pending && !error && options.length === 0
            ? React.createElement(Forms.FormText, { style: { marginTop: 8 } }, "No Windows GPUs were detected.")
            : null,
    );
}

const settings = definePluginSettings({
    selectedGpuId: {
        type: OptionType.COMPONENT,
        default: "",
        component: GpuSelector,
        restartNeeded: true,
        onChange: async newValue => {
            if (!Native) return;

            try {
                const result = await Native.applyGpuPreference(String(newValue));
                if (result.changed) {
                    Toasts.show({
                        message: result.selectedGpu
                            ? `Discord pinned to ${result.selectedGpu.name}. Fully close Discord with Alt+F4 or tray Quit, then reopen it.`
                            : "Discord GPU preference updated. Fully close Discord with Alt+F4 or tray Quit, then reopen it.",
                        type: Toasts.Type.SUCCESS,
                    });
                }
            } catch (err) {
                console.error("[GpuBinder] Failed to update GPU preference:", err);
                Toasts.show({
                    message: "Failed to update Discord GPU preference. Check the console for details.",
                    type: Toasts.Type.FAILURE,
                });
            }
        },
    },
});

export default definePlugin({
    name: "GpuBinder",
    description: "Forces Discord to stay bound to a specific GPU even after updates by managing Windows Registry keys.",
    tags: ["Utility"],
    authors: [EquicordDevs.unclide],

    // Safety check: registry access is only possible on Desktop
    desktopOnly: true,
    settings,

    async start() {
        // Only run on Windows
        if (process.platform !== "win32") return;

        if (!Native) {
            console.warn("[GpuBinder] Native helper not found. Registry sync skipped.");
            return;
        }

        try {
            const legacyPreference = (settings.store as any).gpuPreference;
            const currentGpuId = settings.store.selectedGpuId || legacyPreference || "";
            if (!currentGpuId) return;

            // Apply settings on startup to ensure the new app-1.x.xxxx path is registered
            const result = await Native.applyGpuPreference(currentGpuId);
            if (result.changed) {
                const gpuName = result.selectedGpu?.name ?? result.preference;
                console.log(`[GpuBinder] New Discord version detected. Registry path updated for ${gpuName}.`);
            }
        } catch (err) {
            console.error("[GpuBinder] Startup sync error:", err);
        }
    },
});
