/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawn } from "node:child_process";
import { platform } from "node:os";

import type { IpcMainInvokeEvent } from "electron";

export type InstallSpicetifyResult = { success: true; } | { success: false; error: string; };

const WINDOWS_INSTALL_COMMAND = [
    "$script = iwr -useb https://raw.githubusercontent.com/spicetify/cli/main/install.ps1",
    "$script = $script -replace '(?m)^\\$choice = .*Spicetify Marketplace.*$', ([char]36 + \"choice = 0; Write-Host 'Automatically selected Y for Spicetify Marketplace.'\")",
    "iex $script",
    "Read-Host 'Press Enter to close'"
].join("; ");
const SHELL_INSTALL_COMMAND = "curl -fsSL https://raw.githubusercontent.com/spicetify/cli/main/install.sh | sed 's|read -r choice < /dev/tty|choice=Y|' | sh; printf '\\nPress Enter to close...'; read _";

function launchTerminal(command: string, args: string[]) {
    return new Promise<boolean>(resolve => {
        let settled = false;

        const finish = (success: boolean) => {
            if (settled) return;
            settled = true;
            resolve(success);
        };

        try {
            const child = spawn(command, args, {
                detached: true,
                stdio: "ignore",
                windowsHide: false
            });

            child.once("error", () => finish(false));
            child.once("spawn", () => {
                child.unref();
                finish(true);
            });
        } catch {
            finish(false);
        }
    });
}

export async function installSpicetify(_event: IpcMainInvokeEvent): Promise<InstallSpicetifyResult> {
    const operatingSystem = platform();

    if (operatingSystem === "win32") {
        const success = await launchTerminal("powershell.exe", [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            WINDOWS_INSTALL_COMMAND
        ]);
        return success
            ? { success: true }
            : { success: false, error: "Could not open the Spicetify installer in PowerShell." };
    }

    if (operatingSystem === "darwin") {
        const success = await launchTerminal("osascript", [
            "-e",
            "tell application \"Terminal\" to activate",
            "-e",
            `tell application "Terminal" to do script "${SHELL_INSTALL_COMMAND}"`
        ]);
        return success
            ? { success: true }
            : { success: false, error: "Could not open the Spicetify installer in Terminal." };
    }

    if (operatingSystem === "linux") {
        const terminals: Array<{ command: string; args: string[]; }> = [
            { command: "x-terminal-emulator", args: ["-e", "sh", "-c", SHELL_INSTALL_COMMAND] },
            { command: "gnome-terminal", args: ["--", "sh", "-c", SHELL_INSTALL_COMMAND] },
            { command: "konsole", args: ["-e", "sh", "-c", SHELL_INSTALL_COMMAND] },
            { command: "xterm", args: ["-e", "sh", "-c", SHELL_INSTALL_COMMAND] }
        ];

        for (const terminal of terminals) {
            if (await launchTerminal(terminal.command, terminal.args)) return { success: true };
        }

        return { success: false, error: "Could not find a supported terminal to run the Spicetify installer." };
    }

    return { success: false, error: "Spicetify installation is not supported on this operating system." };
}
