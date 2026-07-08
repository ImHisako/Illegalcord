/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DATA_DIR } from "@main/utils/constants";
import { checkedFetch, fetchBuffer } from "@main/utils/http";
import { app, BrowserWindow, session } from "electron";
import { unzip } from "fflate";
import { constants as fsConstants, mkdirSync, writeFileSync } from "fs";
import { access, mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { isAbsolute, join, resolve } from "path";

export interface NativeResult {
    success: boolean;
    error?: string;
}

const ENGINES = {
    qwant: {
        label: "Qwant",
        url: "https://www.qwant.com/"
    },
    searloc: {
        label: "Searloc",
        url: "https://searloc.org/"
    },
    araa: {
        label: "Araa",
        url: "https://araa.extravi.dev/"
    },
    degoog: {
        label: "Degoog",
        url: "https://degoog.org/"
    },
    heexy: {
        label: "Heexy",
        url: "https://heexy.org/"
    }
} as const;

const DEFAULT_ENGINE = "qwant";
const DEFAULT_FINGERPRINT_MODE = "semiRandom";
const BROWSERLEAKS_URL = "https://browserleaks.com/";
const PRIVATE_PARTITION_PREFIX = "illegalcord-private-search";
const SPOOF_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
const UBLOCK_ORIGIN_RELEASES_API = "https://api.github.com/repos/gorhill/uBlock/releases?per_page=20";
const UBLOCK_ORIGIN_DIR = join(DATA_DIR, "uBlockOriginElite");
const UBLOCK_ORIGIN_VERSION_PATH = join(UBLOCK_ORIGIN_DIR, ".equicord-release");
const PRELOAD_DIR = join(tmpdir(), "illegalcord-private-search-browser");
const PRELOAD_PATH = join(PRELOAD_DIR, "preload.js");
const MULLVAD_DNS = {
    dns: {
        hostname: "dns.mullvad.net",
        doh: "https://dns.mullvad.net/dns-query"
    },
    adblock: {
        hostname: "adblock.dns.mullvad.net",
        doh: "https://adblock.dns.mullvad.net/dns-query"
    },
    base: {
        hostname: "base.dns.mullvad.net",
        doh: "https://base.dns.mullvad.net/dns-query"
    },
    extended: {
        hostname: "extended.dns.mullvad.net",
        doh: "https://extended.dns.mullvad.net/dns-query"
    },
    family: {
        hostname: "family.dns.mullvad.net",
        doh: "https://family.dns.mullvad.net/dns-query"
    },
    all: {
        hostname: "all.dns.mullvad.net",
        doh: "https://all.dns.mullvad.net/dns-query"
    }
} as const;
const TRACKER_HOSTS = [
    "adservice.google.com",
    "analytics.google.com",
    "connect.facebook.net",
    "doubleclick.net",
    "facebook.com",
    "facebook.net",
    "google-analytics.com",
    "googlesyndication.com",
    "googletagmanager.com",
    "hotjar.com",
    "matomo.cloud",
    "newrelic.com",
    "scorecardresearch.com",
    "sentry.io"
] as const;
const POPUP_HOSTS = [
    "adnxs.com",
    "adsterra.com",
    "clickadu.com",
    "onclickads.net",
    "popads.net",
    "popcash.net",
    "propellerads.com",
    "pushy.me",
    "revcontent.com",
    "taboola.com",
    "trafficjunky.net",
    "zedo.com"
] as const;

let win: BrowserWindow | undefined;
let webrtcSwitchApplied = false;
let appliedDnsProfile: MullvadDnsProfile | undefined;
let activeHardenFingerprinting = true;
let activeSpoofBrowserInfo = false;
let activeFingerprintMode: FingerprintMode = DEFAULT_FINGERPRINT_MODE;
let activeBlockTrackers = true;
let activeAntiPopups = true;
let activeDnsProfile: MullvadDnsProfile = "base";
let activeLoadUblockOrigin = true;
let activeUnpackedExtensionPath = "";
let activeHomeUrl: string = ENGINES[DEFAULT_ENGINE].url;
let popupOpenTimes: number[] = [];

type Engine = keyof typeof ENGINES;
type MullvadDnsProfile = keyof typeof MULLVAD_DNS;
type FingerprintMode = "unique" | "semiRandom" | "random";
type ExtensionSession = Electron.Session & {
    extensions?: {
        loadExtension(path: string): Promise<Electron.Extension>;
    };
    loadExtension(path: string): Promise<Electron.Extension>;
};
interface GitHubReleaseAsset {
    browser_download_url: string;
    name: string;
}

interface GitHubRelease {
    assets: GitHubReleaseAsset[];
    draft: boolean;
    tag_name: string;
}

interface UblockOriginAsset {
    assetName: string;
    downloadUrl: string;
    tagName: string;
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function isNavigationAbort(error: unknown) {
    const message = getErrorMessage(error);
    return message.includes("ERR_ABORTED") || message.includes("(-3)");
}

function normalizeEngine(value: unknown): Engine {
    return typeof value === "string" && value in ENGINES
        ? value as Engine
        : DEFAULT_ENGINE;
}

function normalizeDnsProfile(value: unknown): MullvadDnsProfile {
    return typeof value === "string" && value in MULLVAD_DNS
        ? value as MullvadDnsProfile
        : "base";
}

function normalizeFingerprintMode(value: unknown): FingerprintMode {
    return value === "unique" || value === "random" || value === "semiRandom"
        ? value
        : DEFAULT_FINGERPRINT_MODE;
}

function normalizeExtensionPath(value: unknown) {
    if (typeof value !== "string") return "";

    const path = value.trim();
    return path && isAbsolute(path) ? resolve(path) : "";
}

function getHostname(rawUrl: string) {
    try {
        return new URL(rawUrl).hostname;
    } catch {
        return "";
    }
}

function isAllowedUrl(rawUrl: string) {
    try {
        const url = new URL(rawUrl);
        return url.protocol === "https:";
    } catch {
        return false;
    }
}

function matchesHost(hostname: string, root: string) {
    return hostname === root || hostname.endsWith(`.${root}`);
}

function isTrackerUrl(rawUrl: string) {
    const hostname = getHostname(rawUrl);
    return hostname !== "" && TRACKER_HOSTS.some(host => matchesHost(hostname, host));
}

function isPopupHost(rawUrl: string) {
    const hostname = getHostname(rawUrl);
    return hostname !== "" && POPUP_HOSTS.some(host => matchesHost(hostname, host));
}

function hasSuspiciousWindowFeatures(features: string) {
    const normalized = features.toLowerCase();
    if (!normalized) return false;
    if (/\b(?:popup|menubar=no|toolbar=no|location=no|status=no|resizable=no)\b/.test(normalized)) return true;

    const width = normalized.match(/\bwidth=(\d{2,4})\b/);
    const height = normalized.match(/\bheight=(\d{2,4})\b/);
    return Boolean(
        width && Number(width[1]) < 640 ||
        height && Number(height[1]) < 480
    );
}

function isSameOrSubHost(hostname: string, root: string) {
    return hostname === root || hostname.endsWith(`.${root}`) || root.endsWith(`.${hostname}`);
}

function shouldLoadWindowOpen(url: string, currentUrl: string, features: string, disposition: string, antiPopups: boolean) {
    if (!isAllowedUrl(url)) return false;
    if (!antiPopups) return true;
    if (isTrackerUrl(url) || isPopupHost(url) || hasSuspiciousWindowFeatures(features)) return false;

    const now = Date.now();
    popupOpenTimes = popupOpenTimes.filter(time => now - time < 4_000);
    if (popupOpenTimes.length >= 3) return false;

    const targetHost = getHostname(url);
    const currentHost = getHostname(currentUrl);
    const sameSite = Boolean(targetHost && currentHost && isSameOrSubHost(targetHost, currentHost));
    const userLike = disposition === "foreground-tab" || disposition === "background-tab";
    if (!sameSite && !userLike) return false;

    popupOpenTimes.push(now);
    return true;
}

function deleteHeader(headers: Record<string, string>, headerName: string) {
    const key = Object.keys(headers).find(key => key.toLowerCase() === headerName);
    if (key) delete headers[key];
}

function setResponseHeader(headers: Record<string, string[]>, headerName: string, value: string) {
    const key = Object.keys(headers).find(key => key.toLowerCase() === headerName.toLowerCase()) ?? headerName;
    headers[key] = [value];
}

function removeResponseHeader(headers: Record<string, string[]>, headerName: string) {
    const key = Object.keys(headers).find(key => key.toLowerCase() === headerName.toLowerCase());
    if (key) delete headers[key];
}

function focusWindow(browserWindow: BrowserWindow) {
    if (browserWindow.isMinimized()) browserWindow.restore();
    browserWindow.show();
    browserWindow.focus();
}

async function loadPrivateURL(browserWindow: BrowserWindow, url: string) {
    try {
        await browserWindow.loadURL(url);
    } catch (error) {
        if (!isNavigationAbort(error)) throw error;
    }
}

async function isUnpackedExtension(path: string) {
    if (!path) return false;

    try {
        await access(join(path, "manifest.json"), fsConstants.R_OK);
        return true;
    } catch {
        return false;
    }
}

async function extractExtension(data: Buffer, outDir: string) {
    await mkdir(outDir, { recursive: true });

    return new Promise<void>((resolvePromise, rejectPromise) => {
        unzip(data, (error, files) => {
            if (error) {
                rejectPromise(error);
                return;
            }

            Promise.all(Object.keys(files).map(async fileName => {
                if (fileName.startsWith("_metadata/")) return;
                if (fileName.endsWith("/")) {
                    await mkdir(join(outDir, fileName), { recursive: true });
                    return;
                }

                const pathElements = fileName.split("/");
                const name = pathElements.pop();
                if (!name) return;

                const directory = pathElements.join("/");
                const dir = join(outDir, directory);
                if (directory) await mkdir(dir, { recursive: true });

                await writeFile(join(dir, name), files[fileName]);
            }))
                .then(() => resolvePromise())
                .catch(error => {
                    void rm(outDir, { recursive: true, force: true });
                    rejectPromise(error);
                });
        });
    });
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isGitHubReleaseAsset(value: unknown): value is GitHubReleaseAsset {
    return isObject(value)
        && typeof value.name === "string"
        && typeof value.browser_download_url === "string";
}

function isGitHubRelease(value: unknown): value is GitHubRelease {
    return isObject(value)
        && typeof value.tag_name === "string"
        && typeof value.draft === "boolean"
        && Array.isArray(value.assets)
        && value.assets.every(isGitHubReleaseAsset);
}

async function getLatestUblockOriginAsset(): Promise<UblockOriginAsset> {
    const response = await checkedFetch(UBLOCK_ORIGIN_RELEASES_API, {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": `Electron ${process.versions.electron} ~ Equicord`
        }
    });
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error("Invalid uBlock Origin release response.");

    for (const release of data) {
        if (!isGitHubRelease(release) || release.draft) continue;

        const asset = release.assets.find(asset => /\.chromium\.zip$/i.test(asset.name));
        if (asset) {
            return {
                assetName: asset.name,
                downloadUrl: asset.browser_download_url,
                tagName: release.tag_name
            };
        }
    }

    throw new Error("Could not find a Chromium uBlock Origin release.");
}

async function readInstalledUblockOriginVersion() {
    try {
        return (await readFile(UBLOCK_ORIGIN_VERSION_PATH, "utf8")).trim();
    } catch {
        return "";
    }
}

async function getUblockOriginPath() {
    let release: UblockOriginAsset;
    try {
        release = await getLatestUblockOriginAsset();
    } catch (error) {
        if (await isUnpackedExtension(UBLOCK_ORIGIN_DIR)) return UBLOCK_ORIGIN_DIR;
        throw error;
    }

    const version = `${release.tagName}:${release.assetName}`;
    if (await isUnpackedExtension(UBLOCK_ORIGIN_DIR) && await readInstalledUblockOriginVersion() === version) return UBLOCK_ORIGIN_DIR;

    const data = await fetchBuffer(release.downloadUrl, {
        headers: {
            "User-Agent": `Electron ${process.versions.electron} ~ Equicord`
        }
    });

    await rm(UBLOCK_ORIGIN_DIR, { recursive: true, force: true });
    await extractExtension(data, UBLOCK_ORIGIN_DIR);
    await writeFile(UBLOCK_ORIGIN_VERSION_PATH, `${version}\n`);
    return UBLOCK_ORIGIN_DIR;
}

async function loadExtension(ses: Electron.Session, path: string) {
    const extensionSession = ses as ExtensionSession;
    if (extensionSession.extensions) {
        await extensionSession.extensions.loadExtension(path);
        return;
    }

    await extensionSession.loadExtension(path);
}

async function loadPrivateExtensions(ses: Electron.Session, loadUblockOrigin: boolean, unpackedExtensionPath: string) {
    if (loadUblockOrigin) {
        try {
            await loadExtension(ses, await getUblockOriginPath());
        } catch (_error) {
            void _error;
        }
    }

    if (await isUnpackedExtension(unpackedExtensionPath)) {
        try {
            await loadExtension(ses, unpackedExtensionPath);
        } catch (_error) {
            void _error;
        }
    }
}

function applyChromiumSwitches(dnsProfile: MullvadDnsProfile, hardenFingerprinting: boolean) {
    if (hardenFingerprinting && !webrtcSwitchApplied) {
        webrtcSwitchApplied = true;
        app.commandLine.appendSwitch("disable-webrtc");
        app.commandLine.appendSwitch("force-webrtc-ip-handling-policy", "disable_non_proxied_udp");
    }

    if (appliedDnsProfile === dnsProfile) return;
    appliedDnsProfile = dnsProfile;

    app.configureHostResolver({
        secureDnsMode: "secure",
        secureDnsServers: [MULLVAD_DNS[dnsProfile].doh]
    });
}

function getPrivacyScript(hardenFingerprinting: boolean, spoofBrowserInfo: boolean, fingerprintMode: FingerprintMode, antiPopups: boolean) {
    const fingerprintSeed = fingerprintMode === "unique" ? 0 : Math.floor(Math.random() * 2_147_483_647);

    return `
        (() => {
            const shouldHardenFingerprinting = ${hardenFingerprinting ? "true" : "false"};
            const shouldSpoofBrowserInfo = ${spoofBrowserInfo ? "true" : "false"};
            const shouldBlockPopups = ${antiPopups ? "true" : "false"};
            const fingerprintMode = ${JSON.stringify(fingerprintMode)};
            const nativeFingerprintSeed = ${fingerprintSeed};
            const hardenedWindows = new WeakSet();
            const spoofedWindows = new WeakSet();
            const popupGuardedWindows = new WeakSet();
            const popupHosts = new Set(${JSON.stringify([...TRACKER_HOSTS, ...POPUP_HOSTS])});
            const spoofLocale = "en-US";
            const spoofLanguages = Object.freeze(["en-US", "en"]);
            const spoofTimeZone = "UTC";
            const spoofUserAgent = ${JSON.stringify(SPOOF_USER_AGENT)};
            const baseScreen = Object.freeze({
                width: 1920,
                height: 1080,
                availWidth: 1920,
                availHeight: 1040,
                colorDepth: 24,
                pixelDepth: 24
            });
            const screenProfiles = Object.freeze([
                { width: 1366, height: 768, availWidth: 1366, availHeight: 728, colorDepth: 24, pixelDepth: 24 },
                { width: 1440, height: 900, availWidth: 1440, availHeight: 860, colorDepth: 24, pixelDepth: 24 },
                { width: 1536, height: 864, availWidth: 1536, availHeight: 824, colorDepth: 24, pixelDepth: 24 },
                { width: 1600, height: 900, availWidth: 1600, availHeight: 860, colorDepth: 24, pixelDepth: 24 },
                baseScreen
            ]);
            const webglProfiles = Object.freeze([
                {
                    vendor: "Google Inc. (Intel)",
                    renderer: "ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"
                },
                {
                    vendor: "Google Inc. (AMD)",
                    renderer: "ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"
                },
                {
                    vendor: "Google Inc. (NVIDIA)",
                    renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)"
                }
            ]);
            const getBrands = () => [
                { brand: "Not/A)Brand", version: "99" },
                { brand: "Chromium", version: "148" }
            ];
            const getFullVersionList = () => [
                { brand: "Not/A)Brand", version: "99.0.0.0" },
                { brand: "Chromium", version: "148.0.7778.218" }
            ];
            const getClientHintValue = key => ({
                architecture: "x86",
                bitness: "64",
                brands: getBrands(),
                formFactors: ["Desktop"],
                fullVersionList: getFullVersionList(),
                mobile: false,
                model: "",
                platform: "Windows",
                platformVersion: "19.0.0",
                uaFullVersion: "148.0.7778.218",
                wow64: false
            })[key];
            const getSpeechVoices = () => [
                {
                    default: true,
                    lang: "en-US",
                    localService: true,
                    name: "Microsoft David - English (United States)",
                    voiceURI: "Microsoft David - English (United States)"
                },
                {
                    default: false,
                    lang: "en-US",
                    localService: true,
                    name: "Microsoft Zira - English (United States)",
                    voiceURI: "Microsoft Zira - English (United States)"
                }
            ];
            const days = Object.freeze(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
            const months = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
            const defineGetter = (target, key, value) => {
                try {
                    Object.defineProperty(target, key, {
                        configurable: true,
                        get: () => value
                    });
                } catch (_error) {
                    void _error;
                }
            };
            const defineDynamicGetter = (target, key, get) => {
                try {
                    Object.defineProperty(target, key, {
                        configurable: true,
                        get
                    });
                } catch (_error) {
                    void _error;
                }
            };
            const defineValue = (target, key, value) => {
                try {
                    Object.defineProperty(target, key, {
                        configurable: true,
                        value
                    });
                } catch (_error) {
                    void _error;
                }
            };
            const disableKeys = (target, keys) => {
                if (!target) return;

                for (const key of keys) {
                    try {
                        delete target[key];
                    } catch (_error) {
                        void _error;
                    }

                    defineValue(target, key, undefined);
                }
            };
            const isUniqueFingerprint = fingerprintMode === "unique";
            const fingerprintSeed = fingerprintMode === "random"
                ? Math.floor(Math.random() * 2147483647)
                : nativeFingerprintSeed;
            const fingerprintHash = salt => {
                let hash = fingerprintSeed || 2166136261;
                const text = String(salt);
                for (let index = 0; index < text.length; index++) {
                    hash ^= text.charCodeAt(index);
                    hash = Math.imul(hash, 16777619);
                }

                return hash >>> 0;
            };
            const fingerprintPick = (salt, values, fallback) => {
                if (isUniqueFingerprint) return fallback;
                return values[fingerprintHash(salt) % values.length];
            };
            const fingerprintJitter = (salt, min, max) => {
                if (isUniqueFingerprint) return 0;
                return min + fingerprintHash(salt) % (max - min + 1);
            };
            const spoofScreen = Object.freeze(fingerprintPick("screen", screenProfiles, baseScreen));
            const spoofHardwareConcurrency = fingerprintPick("hardwareConcurrency", [2, 4, 6, 8], 4);
            const spoofDeviceMemory = fingerprintPick("deviceMemory", [4, 8], 8);
            const spoofWebglProfile = fingerprintPick("webglProfile", webglProfiles, webglProfiles[0]);
            const clampByte = value => Math.max(0, Math.min(255, value));
            const cloneCanvasImageData = imageData => {
                const data = imageData.data;
                for (let index = 0; index < data.length; index += 4) {
                    const pixel = index / 4;
                    const noise = isUniqueFingerprint ? pixel % 3 - 1 : fingerprintJitter("canvas:" + pixel, -2, 2);
                    data[index] = clampByte(data[index] + noise);
                    data[index + 1] = clampByte(data[index + 1] - noise);
                    data[index + 2] = clampByte(data[index + 2] + (isUniqueFingerprint ? pixel % 2 ? 1 : -1 : fingerprintJitter("canvas:b:" + pixel, -2, 2)));
                }

                return imageData;
            };
            const roundedMetric = value => typeof value === "number" && Number.isFinite(value)
                ? Math.round(value * 2) / 2
                : value;
            const roundedLayoutMetric = value => typeof value === "number" && Number.isFinite(value)
                ? Math.round(value / 4) * 4
                : value;
            const pad = value => String(value).padStart(2, "0");
            const getValidDate = value => {
                const date = new Date(Number(value));
                return Number.isFinite(date.getTime()) ? date : null;
            };
            const utcDateString = value => {
                const date = getValidDate(value);
                if (!date) return "Invalid Date";

                return days[date.getUTCDay()] + " " + months[date.getUTCMonth()] + " " + pad(date.getUTCDate()) + " " + date.getUTCFullYear();
            };
            const utcTimeString = value => {
                const date = getValidDate(value);
                if (!date) return "Invalid Date";

                return pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes()) + ":" + pad(date.getUTCSeconds()) + " GMT+0000 (Coordinated Universal Time)";
            };
            const utcString = value => {
                const date = getValidDate(value);
                if (!date) return "Invalid Date";

                return utcDateString(date) + " " + utcTimeString(date);
            };
            const withTimeZone = options => Object.assign({}, typeof options === "object" && options ? options : undefined, { timeZone: spoofTimeZone });
            const createUserAgentData = targetWindow => {
                const userAgentData = {};
                defineDynamicGetter(userAgentData, "brands", getBrands);
                defineGetter(userAgentData, "mobile", false);
                defineGetter(userAgentData, "platform", "Windows");
                defineValue(userAgentData, "getHighEntropyValues", hints => {
                    const values = {
                        brands: getBrands(),
                        mobile: false,
                        platform: "Windows"
                    };

                    if (Array.isArray(hints)) {
                        for (const hint of hints) {
                            const value = getClientHintValue(hint);
                            if (value !== undefined) values[hint] = value;
                        }
                    }

                    return targetWindow.Promise.resolve(values);
                });
                defineValue(userAgentData, "toJSON", () => ({
                    brands: getBrands(),
                    mobile: false,
                    platform: "Windows"
                }));

                return Object.freeze(userAgentData);
            };
            const patchSpeechSynthesis = targetWindow => {
                if (!targetWindow.speechSynthesis) return;

                const getVoices = () => getSpeechVoices();
                defineValue(targetWindow.speechSynthesis, "getVoices", getVoices);

                const speechSynthesisPrototype = targetWindow.SpeechSynthesis?.prototype;
                if (speechSynthesisPrototype) defineValue(speechSynthesisPrototype, "getVoices", getVoices);
            };
            const patchCanvas = targetWindow => {
                const canvasPrototype = targetWindow.HTMLCanvasElement?.prototype;
                const contextPrototype = targetWindow.CanvasRenderingContext2D?.prototype;
                const originalGetImageData = contextPrototype?.getImageData;
                const originalPutImageData = contextPrototype?.putImageData;

                if (contextPrototype && typeof originalGetImageData === "function") {
                    defineValue(contextPrototype, "getImageData", function (...args) {
                        return cloneCanvasImageData(originalGetImageData.apply(this, args));
                    });
                }

                if (contextPrototype && typeof contextPrototype.measureText === "function") {
                    const originalMeasureText = contextPrototype.measureText;
                    defineValue(contextPrototype, "measureText", function (text) {
                        const metrics = originalMeasureText.call(this, text);
                        return new Proxy(metrics, {
                            get(target, key) {
                                return roundedMetric(Reflect.get(target, key, target));
                            }
                        });
                    });
                }

                if (!canvasPrototype) return;

                const makeNoisedCanvas = canvas => {
                    if (!canvas.width || !canvas.height || typeof originalGetImageData !== "function" || typeof originalPutImageData !== "function") return canvas;

                    try {
                        const clone = targetWindow.document.createElement("canvas");
                        clone.width = canvas.width;
                        clone.height = canvas.height;
                        const context = clone.getContext("2d");
                        if (!context) return canvas;

                        context.drawImage(canvas, 0, 0);
                        const imageData = originalGetImageData.call(context, 0, 0, clone.width, clone.height);
                        cloneCanvasImageData(imageData);
                        originalPutImageData.call(context, imageData, 0, 0);
                        return clone;
                    } catch (_error) {
                        void _error;
                        return canvas;
                    }
                };

                if (typeof canvasPrototype.toDataURL === "function") {
                    const originalToDataURL = canvasPrototype.toDataURL;
                    defineValue(canvasPrototype, "toDataURL", function (...args) {
                        return originalToDataURL.apply(makeNoisedCanvas(this), args);
                    });
                }

                if (typeof canvasPrototype.toBlob === "function") {
                    const originalToBlob = canvasPrototype.toBlob;
                    defineValue(canvasPrototype, "toBlob", function (callback, ...args) {
                        return originalToBlob.call(makeNoisedCanvas(this), callback, ...args);
                    });
                }
            };
            const patchWebGLContext = contextConstructor => {
                if (isUniqueFingerprint) return;

                const prototype = contextConstructor?.prototype;
                if (!prototype) return;

                if (typeof prototype.getParameter === "function") {
                    const originalGetParameter = prototype.getParameter;
                    defineValue(prototype, "getParameter", function (parameter) {
                        switch (Number(parameter)) {
                            case 37445:
                            case 7936:
                                return spoofWebglProfile.vendor;
                            case 37446:
                            case 7937:
                                return spoofWebglProfile.renderer;
                            case 3379:
                            case 34024:
                                return 16384;
                            case 3386:
                                return new targetWindow.Int32Array([16384, 16384]);
                            default:
                                return originalGetParameter.call(this, parameter);
                        }
                    });
                }

                if (typeof prototype.getExtension === "function") {
                    const originalGetExtension = prototype.getExtension;
                    defineValue(prototype, "getExtension", function (name) {
                        if (String(name).toLowerCase() === "webgl_debug_renderer_info") {
                            return {
                                UNMASKED_RENDERER_WEBGL: 37446,
                                UNMASKED_VENDOR_WEBGL: 37445
                            };
                        }

                        return originalGetExtension.call(this, name);
                    });
                }

                if (typeof prototype.readPixels === "function") {
                    const originalReadPixels = prototype.readPixels;
                    defineValue(prototype, "readPixels", function (...args) {
                        const result = originalReadPixels.apply(this, args);
                        const pixels = args[6];
                        if (pixels?.length) {
                            for (let index = 0; index < pixels.length; index += 4) {
                                const noise = fingerprintJitter("webgl:" + index, -1, 1);
                                pixels[index] = clampByte(pixels[index] + noise);
                                pixels[index + 1] = clampByte(pixels[index + 1] - noise);
                                pixels[index + 2] = clampByte(pixels[index + 2] + noise);
                            }
                        }

                        return result;
                    });
                }
            };
            const patchWebGL = targetWindow => {
                patchWebGLContext(targetWindow.WebGLRenderingContext);
                patchWebGLContext(targetWindow.WebGL2RenderingContext);
            };
            const patchFontMetrics = targetWindow => {
                const elementPrototype = targetWindow.Element?.prototype;
                const htmlPrototype = targetWindow.HTMLElement?.prototype;

                if (elementPrototype && typeof elementPrototype.getBoundingClientRect === "function") {
                    const originalGetBoundingClientRect = elementPrototype.getBoundingClientRect;
                    defineValue(elementPrototype, "getBoundingClientRect", function () {
                        const rect = originalGetBoundingClientRect.call(this);
                        const x = roundedMetric(rect.x);
                        const y = roundedMetric(rect.y);
                        const width = roundedLayoutMetric(rect.width);
                        const height = roundedLayoutMetric(rect.height);

                        if (typeof targetWindow.DOMRect === "function") return new targetWindow.DOMRect(x, y, width, height);

                        return Object.assign({}, rect, {
                            bottom: y + height,
                            height,
                            left: x,
                            right: x + width,
                            top: y,
                            width,
                            x,
                            y
                        });
                    });
                }

                if (htmlPrototype) {
                    for (const key of ["offsetWidth", "offsetHeight"]) {
                        const descriptor = Object.getOwnPropertyDescriptor(htmlPrototype, key);
                        if (descriptor?.get) {
                            defineDynamicGetter(htmlPrototype, key, function () {
                                return roundedLayoutMetric(descriptor.get.call(this));
                            });
                        }
                    }
                }

                const fontFaceSet = targetWindow.document?.fonts;
                if (fontFaceSet && typeof fontFaceSet.check === "function") {
                    defineValue(fontFaceSet, "check", font => /(?:serif|sans-serif|monospace|system-ui)/i.test(String(font)));
                }

                const fontFaceSetPrototype = targetWindow.FontFaceSet?.prototype;
                if (fontFaceSetPrototype && typeof fontFaceSetPrototype.check === "function") {
                    defineValue(fontFaceSetPrototype, "check", font => /(?:serif|sans-serif|monospace|system-ui)/i.test(String(font)));
                }
            };
            const patchBatteryNetworkAndBluetooth = targetWindow => {
                const navigatorPrototype = targetWindow.Navigator?.prototype;
                disableKeys(navigatorPrototype, ["getBattery", "connection", "mozConnection", "webkitConnection", "bluetooth"]);
                disableKeys(targetWindow.navigator, ["getBattery", "connection", "mozConnection", "webkitConnection", "bluetooth"]);
                disableKeys(targetWindow, ["BatteryManager", "Bluetooth", "BluetoothDevice", "BluetoothRemoteGATTServer"]);
            };
            const patchWebAudio = targetWindow => {
                const analyserPrototype = targetWindow.AnalyserNode?.prototype;
                if (analyserPrototype) {
                    for (const key of ["getByteFrequencyData", "getByteTimeDomainData"]) {
                        if (typeof analyserPrototype[key] === "function") {
                            defineValue(analyserPrototype, key, function (array) {
                                if (!array?.length) return;
                                for (let index = 0; index < array.length; index++) {
                                    array[index] = key === "getByteTimeDomainData" ? 128 : index % 4;
                                }
                            });
                        }
                    }

                    for (const key of ["getFloatFrequencyData", "getFloatTimeDomainData"]) {
                        if (typeof analyserPrototype[key] === "function") {
                            defineValue(analyserPrototype, key, function (array) {
                                if (!array?.length) return;
                                for (let index = 0; index < array.length; index++) {
                                    array[index] = key === "getFloatTimeDomainData" ? 0 : -100;
                                }
                            });
                        }
                    }
                }

                disableKeys(targetWindow, ["AudioContext", "OfflineAudioContext", "webkitAudioContext", "webkitOfflineAudioContext"]);
            };
            const patchAntiPopups = targetWindow => {
                if (!targetWindow || popupGuardedWindows.has(targetWindow)) return;
                popupGuardedWindows.add(targetWindow);

                let lastGesture = 0;
                let gestureOpens = 0;
                const rememberGesture = event => {
                    if (!event?.isTrusted) return;
                    lastGesture = Date.now();
                    gestureOpens = 0;
                };
                const hasRecentGesture = () => {
                    const activation = targetWindow.navigator?.userActivation;
                    return Date.now() - lastGesture < 1_250 || activation?.isActive === true;
                };
                const getPopupUrl = rawUrl => {
                    try {
                        return new URL(String(rawUrl || ""), targetWindow.location.href);
                    } catch (_error) {
                        void _error;
                        return null;
                    }
                };
                const popupHostBlocked = url => {
                    const hostname = url.hostname;
                    for (const host of popupHosts) {
                        if (hostname === host || hostname.endsWith("." + host)) return true;
                    }

                    return false;
                };
                const hasPopupFeatures = features => {
                    const normalized = String(features || "").toLowerCase();
                    if (!normalized) return false;
                    if (/\\b(?:popup|menubar=no|toolbar=no|location=no|status=no|resizable=no)\\b/.test(normalized)) return true;

                    const width = normalized.match(/\\bwidth=(\\d{2,4})\\b/);
                    const height = normalized.match(/\\bheight=(\\d{2,4})\\b/);
                    return Boolean(
                        width && Number(width[1]) < 640 ||
                        height && Number(height[1]) < 480
                    );
                };
                const shouldBlockPopup = (rawUrl, _target, features) => {
                    const url = getPopupUrl(rawUrl);
                    if (!url || url.protocol !== "https:") return true;
                    if (popupHostBlocked(url) || hasPopupFeatures(features)) return true;
                    if (!hasRecentGesture()) return true;
                    if (gestureOpens >= 1 && url.hostname !== targetWindow.location.hostname) return true;

                    gestureOpens++;
                    return false;
                };
                const originalOpen = targetWindow.open;
                if (typeof originalOpen === "function") {
                    defineValue(targetWindow, "open", function (url = "", target = "", features = "") {
                        if (shouldBlockPopup(url, target, features)) return null;
                        return originalOpen.call(this, url, target, features);
                    });
                }

                const anchorPrototype = targetWindow.HTMLAnchorElement?.prototype;
                if (anchorPrototype && typeof anchorPrototype.click === "function") {
                    const originalClick = anchorPrototype.click;
                    defineValue(anchorPrototype, "click", function () {
                        const target = String(this.target || "").toLowerCase();
                        if (target && target !== "_self" && shouldBlockPopup(this.href, target, "")) return;
                        return originalClick.call(this);
                    });
                }

                for (const eventName of ["pointerdown", "keydown", "touchstart"]) {
                    targetWindow.addEventListener(eventName, rememberGesture, true);
                }

                targetWindow.addEventListener("click", event => {
                    if (event.isTrusted) rememberGesture(event);

                    const target = event.target;
                    const anchor = target?.closest?.("a[href]");
                    if (!anchor) return;

                    const anchorTarget = String(anchor.target || "").toLowerCase();
                    if (!anchorTarget || anchorTarget === "_self") return;
                    if (!shouldBlockPopup(anchor.href, anchorTarget, "")) return;

                    event.preventDefault();
                    event.stopImmediatePropagation();
                }, true);
                defineValue(targetWindow, "showModalDialog", undefined);
            };
            const applyHardening = targetWindow => {
                if (!targetWindow || hardenedWindows.has(targetWindow)) return;
                hardenedWindows.add(targetWindow);

                const navigatorPrototype = targetWindow.Navigator?.prototype;
                if (navigatorPrototype) {
                    defineGetter(navigatorPrototype, "webdriver", false);
                    defineValue(navigatorPrototype, "getUserMedia", undefined);
                    defineValue(navigatorPrototype, "webkitGetUserMedia", undefined);
                    defineValue(navigatorPrototype, "mozGetUserMedia", undefined);
                }

                try {
                    const mediaDevices = targetWindow.navigator?.mediaDevices;
                    if (mediaDevices) {
                        if (typeof mediaDevices.enumerateDevices === "function") {
                            defineValue(mediaDevices, "enumerateDevices", () => Promise.resolve([]));
                        }

                        if (typeof mediaDevices.getUserMedia === "function") {
                            defineValue(mediaDevices, "getUserMedia", () => Promise.reject(new DOMException("Permission denied.", "NotAllowedError")));
                        }

                        if (typeof mediaDevices.getDisplayMedia === "function") {
                            defineValue(mediaDevices, "getDisplayMedia", () => Promise.reject(new DOMException("Permission denied.", "NotAllowedError")));
                        }
                    }
                } catch (_error) {
                    void _error;
                }

                for (const key of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel"]) {
                    try {
                        delete targetWindow[key];
                    } catch (_error) {
                        void _error;
                    }

                    defineValue(targetWindow, key, undefined);
                }

                if ("Notification" in targetWindow) {
                    try {
                        defineValue(targetWindow.Notification, "requestPermission", callback => {
                            callback?.("denied");
                            return Promise.resolve("denied");
                        });
                        defineGetter(targetWindow.Notification, "permission", "denied");
                    } catch (_error) {
                        void _error;
                    }
                }
            };
            const applySpoofing = targetWindow => {
                if (!targetWindow || spoofedWindows.has(targetWindow)) return;
                spoofedWindows.add(targetWindow);

                const documentPrototype = targetWindow.Document?.prototype;
                if (documentPrototype) defineGetter(documentPrototype, "referrer", "");

                const navigatorPrototype = targetWindow.Navigator?.prototype;
                if (navigatorPrototype) {
                    defineGetter(navigatorPrototype, "appVersion", spoofUserAgent.replace(/^Mozilla\\//, ""));
                    defineGetter(navigatorPrototype, "language", spoofLocale);
                    defineGetter(navigatorPrototype, "languages", spoofLanguages);
                    defineGetter(navigatorPrototype, "platform", "Win32");
                    defineGetter(navigatorPrototype, "userAgent", spoofUserAgent);
                    defineGetter(navigatorPrototype, "userAgentData", createUserAgentData(targetWindow));
                    defineGetter(navigatorPrototype, "hardwareConcurrency", spoofHardwareConcurrency);
                    defineGetter(navigatorPrototype, "deviceMemory", spoofDeviceMemory);
                    defineGetter(navigatorPrototype, "vendor", "Google Inc.");
                }

                if (targetWindow.navigator) {
                    defineGetter(targetWindow.navigator, "appVersion", spoofUserAgent.replace(/^Mozilla\\//, ""));
                    defineGetter(targetWindow.navigator, "language", spoofLocale);
                    defineGetter(targetWindow.navigator, "languages", spoofLanguages);
                    defineGetter(targetWindow.navigator, "platform", "Win32");
                    defineGetter(targetWindow.navigator, "userAgent", spoofUserAgent);
                    defineGetter(targetWindow.navigator, "userAgentData", createUserAgentData(targetWindow));
                    defineGetter(targetWindow.navigator, "hardwareConcurrency", spoofHardwareConcurrency);
                    defineGetter(targetWindow.navigator, "deviceMemory", spoofDeviceMemory);
                    defineGetter(targetWindow.navigator, "vendor", "Google Inc.");
                }

                const screenPrototype = targetWindow.Screen?.prototype;
                if (screenPrototype) {
                    for (const key of Object.keys(spoofScreen)) {
                        defineGetter(screenPrototype, key, spoofScreen[key]);
                    }
                }

                if (targetWindow.screen) {
                    for (const key of Object.keys(spoofScreen)) {
                        defineGetter(targetWindow.screen, key, spoofScreen[key]);
                    }
                }

                const DateConstructor = targetWindow.Date;
                if (DateConstructor?.prototype) {
                    const datePrototype = DateConstructor.prototype;
                    const OriginalDate = DateConstructor;
                    const originalToLocaleString = datePrototype.toLocaleString;
                    const originalToLocaleDateString = datePrototype.toLocaleDateString;
                    const originalToLocaleTimeString = datePrototype.toLocaleTimeString;

                    defineValue(datePrototype, "getTimezoneOffset", function () {
                        return 0;
                    });
                    defineValue(datePrototype, "toString", function () {
                        return utcString(this);
                    });
                    defineValue(datePrototype, "toDateString", function () {
                        return utcDateString(this);
                    });
                    defineValue(datePrototype, "toTimeString", function () {
                        return utcTimeString(this);
                    });
                    defineValue(datePrototype, "toLocaleString", function (_locales, options) {
                        return originalToLocaleString.call(this, spoofLocale, withTimeZone(options));
                    });
                    defineValue(datePrototype, "toLocaleDateString", function (_locales, options) {
                        return originalToLocaleDateString.call(this, spoofLocale, withTimeZone(options));
                    });
                    defineValue(datePrototype, "toLocaleTimeString", function (_locales, options) {
                        return originalToLocaleTimeString.call(this, spoofLocale, withTimeZone(options));
                    });

                    const SpoofedDate = function (...args) {
                        if (this instanceof SpoofedDate) {
                            return args.length ? new OriginalDate(...args) : new OriginalDate();
                        }

                        return utcString(new OriginalDate());
                    };

                    try {
                        Object.setPrototypeOf(SpoofedDate, OriginalDate);
                        SpoofedDate.prototype = OriginalDate.prototype;
                        defineValue(SpoofedDate, "now", () => OriginalDate.now());
                        defineValue(SpoofedDate, "parse", OriginalDate.parse.bind(OriginalDate));
                        defineValue(SpoofedDate, "UTC", OriginalDate.UTC.bind(OriginalDate));
                        defineValue(datePrototype, "constructor", SpoofedDate);
                        defineValue(targetWindow, "Date", SpoofedDate);
                    } catch (_error) {
                        void _error;
                    }
                }

                const dateTimeFormat = targetWindow.Intl?.DateTimeFormat;
                if (dateTimeFormat?.prototype) {
                    const OriginalDateTimeFormat = dateTimeFormat;
                    const originalResolvedOptions = OriginalDateTimeFormat.prototype.resolvedOptions;
                    const SpoofedDateTimeFormat = function (_locales, options) {
                        return new OriginalDateTimeFormat(spoofLocale, withTimeZone(options));
                    };

                    try {
                        Object.setPrototypeOf(SpoofedDateTimeFormat, OriginalDateTimeFormat);
                        SpoofedDateTimeFormat.prototype = OriginalDateTimeFormat.prototype;
                        defineValue(SpoofedDateTimeFormat, "supportedLocalesOf", (locales, options) => OriginalDateTimeFormat.supportedLocalesOf(locales, options));
                        defineValue(targetWindow.Intl, "DateTimeFormat", SpoofedDateTimeFormat);
                    } catch (_error) {
                        void _error;
                    }

                    defineValue(OriginalDateTimeFormat.prototype, "resolvedOptions", function () {
                        const options = originalResolvedOptions.call(this);
                        return Object.assign({}, options, {
                            locale: spoofLocale,
                            calendar: "gregory",
                            numberingSystem: "latn",
                            timeZone: spoofTimeZone,
                            hourCycle: "h12"
                        });
                    });
                }

                patchSpeechSynthesis(targetWindow);
                patchCanvas(targetWindow);
                patchWebGL(targetWindow);
                patchFontMetrics(targetWindow);
                patchBatteryNetworkAndBluetooth(targetWindow);
                patchWebAudio(targetWindow);
            };
            const applyAll = targetWindow => {
                try {
                    if (shouldBlockPopups) patchAntiPopups(targetWindow);
                    if (shouldHardenFingerprinting) applyHardening(targetWindow);
                    if (shouldSpoofBrowserInfo) applySpoofing(targetWindow);
                } catch (_error) {
                    void _error;
                }
            };
            const patchFrameGetter = targetWindow => {
                const iframePrototype = targetWindow.HTMLIFrameElement?.prototype;
                const descriptor = iframePrototype && Object.getOwnPropertyDescriptor(iframePrototype, "contentWindow");
                if (!descriptor?.get) return;

                try {
                    Object.defineProperty(iframePrototype, "contentWindow", {
                        configurable: true,
                        get() {
                            const frameWindow = descriptor.get.call(this);
                            applyAll(frameWindow);
                            return frameWindow;
                        }
                    });
                } catch (_error) {
                    void _error;
                }
            };
            const patchExistingFrames = targetWindow => {
                try {
                    for (let index = 0; index < targetWindow.frames.length; index++) {
                        applyAll(targetWindow.frames[index]);
                    }
                } catch (_error) {
                    void _error;
                }
            };

            applyAll(window);
            patchFrameGetter(window);
            setTimeout(() => patchExistingFrames(window), 0);
        })();
    `;
}

function getPreloadScript(hardenFingerprinting: boolean, spoofBrowserInfo: boolean, fingerprintMode: FingerprintMode, antiPopups: boolean) {
    const source = JSON.stringify(getPrivacyScript(hardenFingerprinting, spoofBrowserInfo, fingerprintMode, antiPopups));

    return `
        (() => {
            const source = ${source};
            try {
                const { webFrame } = require("electron");
                void webFrame.executeJavaScript(source, true).catch(() => undefined);
            } catch (_error) {
                const inject = () => {
                    try {
                        const script = document.createElement("script");
                        script.textContent = source;
                        (document.documentElement || document.head || document.body).append(script);
                        script.remove();
                    } catch (_innerError) {
                        void _innerError;
                    }
                };

                if (document.documentElement) inject();
                else document.addEventListener("readystatechange", inject, { once: true });
                void _error;
            }
        })();
    `;
}

function writePreloadScript(hardenFingerprinting: boolean, spoofBrowserInfo: boolean, fingerprintMode: FingerprintMode, antiPopups: boolean) {
    mkdirSync(PRELOAD_DIR, { recursive: true });
    writeFileSync(PRELOAD_PATH, getPreloadScript(hardenFingerprinting, spoofBrowserInfo, fingerprintMode, antiPopups), "utf8");
    return PRELOAD_PATH;
}

function getNavigationScript(homeUrl: string) {
    const serializedHomeUrl = JSON.stringify(homeUrl);

    return `
        (() => {
            const id = "illegalcord-private-search-nav";
            document.getElementById(id)?.remove();

            const root = document.createElement("div");
            root.id = id;
            root.style.cssText = [
                "position:fixed",
                "top:10px",
                "left:50%",
                "transform:translateX(-50%)",
                "z-index:2147483647",
                "display:flex",
                "gap:4px",
                "padding:5px",
                "border-radius:999px",
                "background:rgba(17,19,24,.88)",
                "border:1px solid rgba(255,255,255,.14)",
                "box-shadow:0 8px 28px rgba(0,0,0,.35)",
                "backdrop-filter:blur(12px)",
                "font:12px system-ui,sans-serif"
            ].join(";");

            const makeButton = (label, title, action) => {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = label;
                button.title = title;
                button.style.cssText = [
                    "min-width:34px",
                    "height:28px",
                    "padding:0 10px",
                    "border:0",
                    "border-radius:999px",
                    "background:rgba(255,255,255,.1)",
                    "color:#fff",
                    "font:600 12px system-ui,sans-serif",
                    "cursor:pointer"
                ].join(";");
                button.addEventListener("mouseenter", () => { button.style.background = "rgba(255,255,255,.18)"; });
                button.addEventListener("mouseleave", () => { button.style.background = "rgba(255,255,255,.1)"; });
                button.addEventListener("click", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    action();
                });
                return button;
            };

            root.append(
                makeButton("<", "Back", () => history.back()),
                makeButton("Home", "Home", () => location.assign(${serializedHomeUrl})),
                makeButton(">", "Forward", () => history.forward())
            );

            document.documentElement.append(root);
        })();
    `;
}

function configureSession(hardenFingerprinting: boolean, spoofBrowserInfo: boolean, blockTrackers: boolean, getTopLevelHost: () => string) {
    const ses = session.fromPartition(`${PRIVATE_PARTITION_PREFIX}-${Date.now()}`, { cache: false });

    ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

    ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
        if (!isAllowedUrl(details.url) || (blockTrackers && isTrackerUrl(details.url))) {
            callback({ cancel: true });
            return;
        }

        callback({});
    });

    ses.webRequest.onBeforeSendHeaders({ urls: ["<all_urls>"] }, (details, callback) => {
        const headers = { ...details.requestHeaders };

        if (hardenFingerprinting) {
            headers.DNT = "1";
            headers["Sec-GPC"] = "1";
            deleteHeader(headers, "referer");

            const requestHost = getHostname(details.url);
            const topLevelHost = getTopLevelHost();
            if (requestHost && topLevelHost && requestHost !== topLevelHost) deleteHeader(headers, "cookie");
        }

        if (spoofBrowserInfo) {
            headers["Sec-CH-UA"] = "\"Not/A)Brand\";v=\"99\", \"Chromium\";v=\"148\"";
            headers["Sec-CH-UA-Arch"] = "\"x86\"";
            headers["Sec-CH-UA-Bitness"] = "\"64\"";
            headers["Sec-CH-UA-Form-Factors"] = "\"Desktop\"";
            headers["Sec-CH-UA-Full-Version"] = "\"148.0.7778.218\"";
            headers["Sec-CH-UA-Full-Version-List"] = "\"Not/A)Brand\";v=\"99.0.0.0\", \"Chromium\";v=\"148.0.7778.218\"";
            headers["Sec-CH-UA-Mobile"] = "?0";
            headers["Sec-CH-UA-Model"] = "\"\"";
            headers["Sec-CH-UA-Platform"] = "\"Windows\"";
            headers["Sec-CH-UA-Platform-Version"] = "\"19.0.0\"";
            headers["Sec-CH-UA-WoW64"] = "?0";
            headers["User-Agent"] = SPOOF_USER_AGENT;
        }

        callback({ requestHeaders: headers });
    });

    ses.webRequest.onHeadersReceived({ urls: ["<all_urls>"] }, (details, callback) => {
        const headers = { ...(details.responseHeaders ?? {}) };

        if (hardenFingerprinting) {
            setResponseHeader(headers, "Referrer-Policy", "no-referrer");
            setResponseHeader(headers, "Permissions-Policy", "battery=(), camera=(), microphone=(), display-capture=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), speaker-selection=(), interest-cohort=(), browsing-topics=()");

            const responseHost = getHostname(details.url);
            const topLevelHost = getTopLevelHost();
            if (responseHost && topLevelHost && responseHost !== topLevelHost) removeResponseHeader(headers, "set-cookie");
        }

        callback({ responseHeaders: headers });
    });

    return ses;
}

function injectPageScripts(browserWindow: BrowserWindow, getHomeUrl: () => string) {
    browserWindow.webContents.on("dom-ready", () => {
        void browserWindow.webContents.executeJavaScript(getNavigationScript(getHomeUrl()), true).catch(() => undefined);
    });
}

async function openPrivateWindow(rawUrl: string, title: string, hardenFingerprinting: unknown, spoofBrowserInfo: unknown, rawFingerprintMode: unknown, blockTrackers: unknown, antiPopups: unknown, rawDnsProfile: unknown, rawLoadUblockOrigin: unknown, rawUnpackedExtensionPath: unknown, rawHomeUrl = rawUrl): Promise<NativeResult> {
    if (!isAllowedUrl(rawUrl)) return { success: false, error: "Invalid search URL." };

    const homeUrl = isAllowedUrl(rawHomeUrl) ? rawHomeUrl : rawUrl;
    const shouldHardenFingerprinting = hardenFingerprinting === true;
    const shouldSpoofBrowserInfo = spoofBrowserInfo === true;
    const fingerprintMode = normalizeFingerprintMode(rawFingerprintMode);
    const shouldBlockTrackers = blockTrackers === true;
    const shouldBlockPopups = antiPopups !== false;
    const dnsProfile = normalizeDnsProfile(rawDnsProfile);
    const shouldLoadUblockOrigin = rawLoadUblockOrigin !== false;
    const unpackedExtensionPath = normalizeExtensionPath(rawUnpackedExtensionPath);

    if (win && !win.isDestroyed()) {
        if (activeHardenFingerprinting !== shouldHardenFingerprinting || activeSpoofBrowserInfo !== shouldSpoofBrowserInfo || activeFingerprintMode !== fingerprintMode || activeBlockTrackers !== shouldBlockTrackers || activeAntiPopups !== shouldBlockPopups || activeDnsProfile !== dnsProfile || activeLoadUblockOrigin !== shouldLoadUblockOrigin || activeUnpackedExtensionPath !== unpackedExtensionPath) {
            const oldWindow = win;
            win = undefined;
            oldWindow.close();
        } else {
            activeHomeUrl = homeUrl;
            focusWindow(win);
            await loadPrivateURL(win, rawUrl);
            return { success: true };
        }
    }

    applyChromiumSwitches(dnsProfile, shouldHardenFingerprinting);

    if (win && !win.isDestroyed()) {
        activeHomeUrl = homeUrl;
        focusWindow(win);
        await loadPrivateURL(win, rawUrl);
        return { success: true };
    }

    let browserWindow: BrowserWindow | undefined;
    let topLevelHost = getHostname(rawUrl);

    try {
        const ses = configureSession(shouldHardenFingerprinting, shouldSpoofBrowserInfo, shouldBlockTrackers, () => topLevelHost);
        const preload = writePreloadScript(shouldHardenFingerprinting, shouldSpoofBrowserInfo, fingerprintMode, shouldBlockPopups);
        const disableBlinkFeatures = [
            shouldHardenFingerprinting ? "WebRTC" : "",
            shouldSpoofBrowserInfo ? "BatteryStatus,NetworkInformation,WebBluetooth" : ""
        ].filter(Boolean).join(",");
        ses.setPreloads([preload]);
        await ses.clearStorageData();
        await ses.clearCache();
        await loadPrivateExtensions(ses, shouldLoadUblockOrigin, unpackedExtensionPath);
        browserWindow = new BrowserWindow({
            width: 1180,
            height: 760,
            minWidth: 760,
            minHeight: 480,
            title,
            autoHideMenuBar: true,
            backgroundColor: "#111318",
            darkTheme: true,
            show: false,
            webPreferences: {
                allowRunningInsecureContent: false,
                contextIsolation: true,
                enableWebSQL: false,
                nodeIntegration: false,
                preload,
                plugins: false,
                sandbox: true,
                session: ses,
                spellcheck: false,
                webSecurity: true,
                webgl: true,
                disableBlinkFeatures: disableBlinkFeatures || undefined
            }
        });

        if (shouldSpoofBrowserInfo) browserWindow.webContents.setUserAgent(SPOOF_USER_AGENT);

        win = browserWindow;
        activeHardenFingerprinting = shouldHardenFingerprinting;
        activeSpoofBrowserInfo = shouldSpoofBrowserInfo;
        activeFingerprintMode = fingerprintMode;
        activeBlockTrackers = shouldBlockTrackers;
        activeAntiPopups = shouldBlockPopups;
        activeDnsProfile = dnsProfile;
        activeLoadUblockOrigin = shouldLoadUblockOrigin;
        activeUnpackedExtensionPath = unpackedExtensionPath;
        activeHomeUrl = homeUrl;
        const privateWindow = browserWindow;
        injectPageScripts(privateWindow, () => activeHomeUrl);

        privateWindow.once("ready-to-show", () => focusWindow(privateWindow));
        privateWindow.once("closed", () => {
            if (win === privateWindow) win = undefined;
            void ses.clearStorageData();
            void ses.clearCache();
        });

        privateWindow.webContents.on("will-navigate", (event, url) => {
            if (!isAllowedUrl(url)) event.preventDefault();
        });

        privateWindow.webContents.on("did-navigate", (_event, url) => {
            topLevelHost = getHostname(url) || topLevelHost;
        });

        privateWindow.webContents.setWindowOpenHandler(details => {
            if (shouldLoadWindowOpen(details.url, privateWindow.webContents.getURL(), details.features ?? "", details.disposition, shouldBlockPopups)) {
                void loadPrivateURL(privateWindow, details.url);
            }

            return { action: "deny" };
        });

        privateWindow.webContents.on("page-title-updated", (event, pageTitle) => {
            const cleanTitle = pageTitle.trim();
            privateWindow.setTitle(cleanTitle ? `${cleanTitle} - ${title}` : title);
            event.preventDefault();
        });

        await loadPrivateURL(privateWindow, rawUrl);
        focusWindow(privateWindow);
        return { success: true };
    } catch (error) {
        if (browserWindow && !browserWindow.isDestroyed()) browserWindow.close();
        if (win === browserWindow) win = undefined;
        return { success: false, error: getErrorMessage(error) };
    }
}

export async function openSearchEngine(
    _event: Electron.IpcMainInvokeEvent,
    rawEngine: unknown,
    hardenFingerprinting: unknown,
    spoofBrowserInfo: unknown,
    fingerprintMode: unknown,
    blockTrackers: unknown,
    antiPopups: unknown,
    rawDnsProfile: unknown,
    loadUblockOrigin: unknown,
    unpackedExtensionPath: unknown
): Promise<NativeResult> {
    const engine = ENGINES[normalizeEngine(rawEngine)];
    return openPrivateWindow(engine.url, `${engine.label} Private Search`, hardenFingerprinting, spoofBrowserInfo, fingerprintMode, blockTrackers, antiPopups, rawDnsProfile, loadUblockOrigin, unpackedExtensionPath);
}

export async function openBrowserLeaks(
    _event: Electron.IpcMainInvokeEvent,
    rawEngine: unknown,
    hardenFingerprinting: unknown,
    spoofBrowserInfo: unknown,
    fingerprintMode: unknown,
    blockTrackers: unknown,
    antiPopups: unknown,
    rawDnsProfile: unknown,
    loadUblockOrigin: unknown,
    unpackedExtensionPath: unknown
): Promise<NativeResult> {
    const engine = ENGINES[normalizeEngine(rawEngine)];
    return openPrivateWindow(BROWSERLEAKS_URL, "BrowserLeaks Privacy Test", hardenFingerprinting, spoofBrowserInfo, fingerprintMode, blockTrackers, antiPopups, rawDnsProfile, loadUblockOrigin, unpackedExtensionPath, engine.url);
}
