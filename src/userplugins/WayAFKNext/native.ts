/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DATA_DIR } from "@main/utils/constants";
import { ChildProcessWithoutNullStreams, execSync, spawn } from "child_process";
import crypto from "crypto";
import { IpcMainInvokeEvent, WebContents } from "electron";
import fs, { chmodSync } from "fs";
import net from "net";
import os from "os";
import path from "path";
import readline from "readline";

// why is nodejs bad?
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

let debug = false;

export function setDebug(_: IpcMainInvokeEvent, _debug: boolean) {
    debug = _debug;
}

const platform = os.platform();

if (platform !== "linux") {
    throw new Error("Unsupported platform");
}

function getArch(): string {
    const arch = os.arch();

    switch (arch) {
        case "x64":
            return "x86_64";
        case "arm64":
            return "aarch64";
        default:
            throw new Error("Unsupported architecture");
    }
}

const arch = getArch();

const downloadPrebuilt = true;
const url = `https://github.com/MuffinTastic/wayafknext-monitor/releases/download/v0.3.0/wayafknext-monitor.${arch}`;
const shas = {
    "aarch64": "72f7400d0549cb760019fbd8ecf8086efca1841a01e9446f4c888e201914865a",
    "x86_64": "f414550d9cf4771760921ee678468fd15523560a27c4fc2d8d0ee36be61be11f",
};

const tmpDir = path.join(DATA_DIR, "wayafknext");
const procName = path.basename(url);
const sockName = "wayafknext.sock";
const procPath = path.join(tmpDir, procName);
const sockPath = path.join(tmpDir, sockName);

async function downloadToBuffer(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download: ${res.status} ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

function verifySha(buffer: Buffer, arch: string): boolean {
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    return hash === shas[arch];
}

export async function downloadAndVerify(_: IpcMainInvokeEvent) {
    if (downloadPrebuilt) {
        if (fs.existsSync(procPath)) {
            const existing = fs.readFileSync(procPath);
            if (verifySha(existing, arch)) {
                console.log("[WayAFKNext] Using prebuilt binary");
                return;
            }
        }

        console.log("[WayAFKNext] Downloading binary:", url);
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const buffer = await downloadToBuffer(url);

        if (!verifySha(buffer, arch)) {
            throw new Error("Binary hash didn't match, aborting");
        }

        await fs.promises.writeFile(procPath, buffer);

        chmodSync(procPath, 0o755);

        console.log("[WayAFKNext] Downloaded binary!");
    } else {
        if (fs.existsSync(procPath)) {
            console.log("[WayAFKNext] Using local binary");
            return;
        }

        throw new Error("No local binary found");
    }
}

let webFrame: WebContents;
let proc: ChildProcessWithoutNullStreams | null = null;
let procRL;
let procErrRL;
let sock: net.Socket | null = null;
let sockRL;

// HACK HACK HACK
// why are monitors getting left behind? i don't know. kill them!
function killZombieMonitors() {
    try {
        console.log("[WayAFKNext] Searching for zombie monitors");
        const ps = execSync("ps -eo pid,cmd").toString();
        const lines = ps.split("\n");
        lines.forEach(line => {
            if (line.includes(procName)) {
                const cols = line.trim().split(/\s+/);
                const pid = Number(cols[0]);

                if (pid && !isNaN(pid)) {
                    process.kill(pid, "SIGTERM");
                    console.log("[WayAFKNext] Killed:", pid, line);
                }
            }
        });
    } catch (err) {
        console.error("[WayAFKNext] Error killing zombie monitors:", err);
    }
}

export async function startMonitor(e: IpcMainInvokeEvent) {
    if (proc) return;

    killZombieMonitors();

    console.log("[WayAFKNext] Starting monitor");

    webFrame = e.sender;

    proc = spawn(procPath, [], {
        detached: false,
        stdio: "pipe"
    });

    proc.stdout.setEncoding("utf-8");

    procRL = readline.createInterface({
        input: proc.stdout,
        crlfDelay: Infinity
    });

    procRL.on("line", data => {
        if (debug) console.log("[WayAFKNext] stdout", data);
        const text = data.trim();
        sendEvent({ Info: text });
    });

    proc.stderr.setEncoding("utf-8");

    procErrRL = readline.createInterface({
        input: proc.stderr,
        crlfDelay: Infinity
    });

    procErrRL.on("line", data => {
        console.log("[WayAFKNext] stderr", data);
        const text = data.trim();
        sendEvent({ Error: text });
    });

    proc.on("close", code => {
        sendEvent({ Exited: code });
        if (sock) {
            sock.end();
            sock = null;
            sockRL = null;
        }
        proc = null;
        procRL = null;
        procErrRL = null;
    });


    // plenty of time for it to open the socket
    await delay(25);


    sock = net.createConnection(sockPath, () => {
        console.log("[WayAFKNext] Connected to socket");
        sendEvent({ Connected: null });
    });

    sockRL = readline.createInterface({
        input: sock,
        crlfDelay: Infinity
    });

    sockRL.on("line", data => {
        const text = data.trim();
        sendEvent(text);
    });

    sock.on("error", err => {
        sendEvent({ Error: err.toString() });
    });

    sock.on("end", () => {
        sock = null;
        sockRL = null;
        _killMonitor();
    });
}

function sendEvent(event: any) {
    if (typeof event !== "string") {
        event = JSON.stringify(event);
    }
    else {
        try {
            JSON.parse(event);
        } catch (error) {
            console.error("[WayAFKNext] Invalid event JSON:", event);
            console.error("[WayAFKNext]", error);
            return;
        }
    }

    const exec = `Vencord.Plugins.plugins.WayAFKNext.handleEvent(${event});`;
    if (debug) console.log("[WayAFKNext] exec", exec);
    webFrame.executeJavaScript(
        exec
    );
}

function writeCommand(cmd: any) {
    if (sock) {
        sock.write(JSON.stringify(cmd) + "\n");
    }
}

export async function startWatch(_: IpcMainInvokeEvent, statusTimeout: number, notifsTimeout) {
    const cmd = {
        StartWatch: { status_mins: statusTimeout, notifs_mins: notifsTimeout }
    };

    writeCommand(cmd);
}

export async function stopWatch() {
    const cmd = {
        StopWatch: null
    };

    writeCommand(cmd);
}

async function _killMonitor() {
    let killedSock = false;

    if (sock) {
        const cmd = {
            Quit: null
        };

        sock.write(JSON.stringify(cmd));
        sock.end();
        sock = null;
        sockRL = null;
        killedSock = true;
    }

    if (proc) {
        if (killedSock)
            await delay(50);

        proc.kill();
        proc = null;
        procRL = null;
        procErrRL = null;
    }
}

export async function killMonitor(_: IpcMainInvokeEvent) {
    _killMonitor();
}
export async function monitorIsRunning(_: IpcMainInvokeEvent): Promise<boolean> {
    return proc !== null;
}

process.on("exit", _killMonitor);
process.on("SIGINT", _killMonitor);
process.on("SIGTERM", _killMonitor);
process.on("SIGQUIT", _killMonitor);
