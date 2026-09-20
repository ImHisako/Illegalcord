/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { getUserSetting } from "@api/UserSettings";
import { Logger } from "@utils/Logger";
import { escapeRegExp } from "@utils/text";

import { registerMicrophoneStream } from "./microphonePrivacy";
import { type BlockCategory, isPermissionAllowed, recordBlock, registerTemporaryClone, registerTemporaryTracks } from "./session";

const logger = new Logger("DiscordHardened");

const DISCORD_HOSTS = [
    "discord.com",
    "discordapp.com",
    "discordapp.net",
    "discord.gg",
    "discord.media",
] as const;

const SAFE_EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:", "steam:", "spotify:"]);

interface PrivacySettings {
    blockTelemetry: boolean;
    blockSentry: boolean;
    blockTracing: boolean;
    blockTypingIndicator: boolean;
    blockFingerprinting: boolean;
    hideElectronUserAgent: boolean;
    spoofChrome: boolean;
    spoofWindows: boolean;
    goofCordFirewall: boolean;
    firewallBlocklist: string;
    firewallBlockedPatterns: string;
    firewallAllowedPatterns: string;
    disableWebGl: boolean;
    allowCamera: boolean;
    allowMicrophone: boolean;
    allowDisplayCapture: boolean;
    blockUnauthorizedLegacyCapture: boolean;
    allowDeviceEnumeration: boolean;
    allowSpeakerSelection: boolean;
    blockNotifications: boolean;
    allowFullscreen: boolean;
    allowBackgroundSync: boolean;
    allowClipboardWrite: boolean;
    allowClipboardRead: boolean;
    blockGeolocation: boolean;
    reduceHardwareFingerprint: boolean;
    reduceGpuFingerprint: boolean;
    reduceClientHints: boolean;
    blockHardwareAccess: boolean;
    blockGifAutoplay: boolean;
    blockGamepadAccess: boolean;
    blockBatteryAccess: boolean;
    stripThirdPartyReferrers: boolean;
    blockUnsafeExternalProtocols: boolean;
    isolateExternalWindows: boolean;
    logBlockedRequests: boolean;
}

interface AudioOutputMediaDevices extends MediaDevices {
    selectAudioOutput?: (options?: { deviceId?: string; }) => Promise<MediaDeviceInfo>;
}

interface SyncManagerLike {
    register(tag: string): Promise<void>;
}

interface SyncManagerWindow {
    SyncManager?: { prototype: SyncManagerLike; };
}

interface UserAgentDataLike {
    brands: Array<{ brand: string; version: string; }>;
    mobile: boolean;
    platform: string;
    getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>>;
    toJSON(): { brands: Array<{ brand: string; version: string; }>; mobile: boolean; platform: string; };
}

interface NavigatorWithUserAgentData extends Navigator {
    userAgentData?: UserAgentDataLike;
}

interface PrivacyNavigator extends Navigator {
    deviceMemory?: number;
    getBattery?: () => Promise<unknown>;
}

interface FirewallRules {
    key: string;
    blocklist: RegExp[];
    blocked: RegExp | null;
    allowed: RegExp | null;
}

const blockedXhrs = new WeakSet<XMLHttpRequest>();
const restorers: Array<() => void> = [];
const protectedApis: Array<{ target: object; property: PropertyKey; check: () => boolean; }> = [];
let firewallRules: FirewallRules | null = null;
let activeSettings: PrivacySettings | undefined;

function patchValue(target: object, property: PropertyKey, value: unknown): void {
    const descriptor = Object.getOwnPropertyDescriptor(target, property);

    try {
        Object.defineProperty(target, property, {
            configurable: true,
            enumerable: descriptor?.enumerable,
            writable: true,
            value,
        });
    } catch (error) {
        logger.warn(`Could not protect ${String(property)}.`, error);
        return;
    }

    restorers.push(() => {
        if (Object.getOwnPropertyDescriptor(target, property)?.value !== value) return;

        if (descriptor) Object.defineProperty(target, property, descriptor);
        else Reflect.deleteProperty(target, property);
    });
    protectedApis.push({ target, property, check: () => Object.getOwnPropertyDescriptor(target, property)?.value === value });
}

function patchGetter(target: object, property: PropertyKey, getter: () => unknown): void {
    const descriptor = Object.getOwnPropertyDescriptor(target, property);

    try {
        Object.defineProperty(target, property, {
            configurable: true,
            enumerable: descriptor?.enumerable,
            get: getter,
        });
    } catch (error) {
        logger.warn(`Could not protect ${String(property)}.`, error);
        return;
    }

    restorers.push(() => {
        if (Object.getOwnPropertyDescriptor(target, property)?.get !== getter) return;

        if (descriptor) Object.defineProperty(target, property, descriptor);
        else Reflect.deleteProperty(target, property);
    });
    protectedApis.push({ target, property, check: () => Object.getOwnPropertyDescriptor(target, property)?.get === getter });
}

export function getRuntimeProtections() {
    const settings = activeSettings;
    const checks: Array<{ name: string; enabled: boolean; target: object | undefined; properties: string[]; }> = [
        { name: "Fetch request filtering", enabled: Boolean(settings && (settings.blockTelemetry || settings.blockSentry || settings.blockTracing || settings.blockTypingIndicator || settings.blockFingerprinting || settings.goofCordFirewall)), target: window, properties: ["fetch"] },
        { name: "Fetch referrer protection", enabled: Boolean(settings?.stripThirdPartyReferrers), target: window, properties: ["fetch"] },
        { name: "Unsafe window blocking", enabled: Boolean(settings?.blockUnsafeExternalProtocols), target: window, properties: ["open"] },
        { name: "External window isolation", enabled: Boolean(settings && (settings.isolateExternalWindows || settings.stripThirdPartyReferrers)), target: window, properties: ["open"] },
        { name: "Camera blocking", enabled: Boolean(settings && !isPermissionAllowed("allowCamera", settings.allowCamera)), target: navigator.mediaDevices, properties: ["getUserMedia"] },
        { name: "Microphone blocking", enabled: Boolean(settings && !isPermissionAllowed("allowMicrophone", settings.allowMicrophone)), target: navigator.mediaDevices, properties: ["getUserMedia"] },
        { name: "Screen capture blocking", enabled: Boolean(settings && !isPermissionAllowed("allowDisplayCapture", settings.allowDisplayCapture)), target: navigator.mediaDevices, properties: ["getDisplayMedia"] },
        { name: "Clipboard reading protection", enabled: Boolean(settings && !isPermissionAllowed("allowClipboardRead", settings.allowClipboardRead)), target: navigator.clipboard, properties: ["read", "readText"] },
        { name: "Media device discovery blocking", enabled: Boolean(settings && !isPermissionAllowed("allowDeviceEnumeration", settings.allowDeviceEnumeration)), target: navigator.mediaDevices, properties: ["enumerateDevices"] },
        { name: "Speaker selection blocking", enabled: Boolean(settings && !isPermissionAllowed("allowSpeakerSelection", settings.allowSpeakerSelection)), target: navigator.mediaDevices, properties: ["selectAudioOutput"] },
        { name: "Geolocation blocking", enabled: Boolean(settings?.blockGeolocation), target: navigator.geolocation, properties: ["getCurrentPosition", "watchPosition"] },
        { name: "Notification permission blocking", enabled: Boolean(settings?.blockNotifications), target: typeof Notification === "undefined" ? undefined : Notification, properties: ["requestPermission", "permission"] },
        { name: "Hardware fingerprint reduction", enabled: Boolean(settings?.reduceHardwareFingerprint), target: typeof Navigator === "undefined" ? undefined : Navigator.prototype, properties: ["hardwareConcurrency", "deviceMemory"] },
        { name: "WebGL identity protection", enabled: Boolean(settings?.reduceGpuFingerprint), target: typeof WebGLRenderingContext === "undefined" ? undefined : WebGLRenderingContext.prototype, properties: ["getExtension", "getSupportedExtensions"] },
    ];
    return checks.map(({ name, enabled, target, properties }) => {
        const available = target ? properties.filter(property => property in target) : [];
        const installed = available.every(property => protectedApis.some(api => api.target === target && api.property === property && api.check()));
        return { name, status: !available.length ? "Unavailable" : !settings || !enabled ? "Disabled" : installed ? "Active" : "Not applied" };
    });
}

function matchesHost(hostname: string, root: string): boolean {
    return hostname === root || hostname.endsWith(`.${root}`);
}

function isDiscordHost(hostname: string): boolean {
    return DISCORD_HOSTS.some(root => matchesHost(hostname, root));
}

function getUrl(input: RequestInfo | URL | string, settings: PrivacySettings): URL | null {
    const rawUrl = input instanceof Request ? input.url : String(input);

    try {
        return new URL(rawUrl, location.href);
    } catch {
        if (settings.logBlockedRequests) logger.warn("Could not parse a request URL.");
        return null;
    }
}

function getLines(value: string): string[] {
    return value.split("\n").map(item => item.trim()).filter(Boolean);
}

function getCombinedRegex(value: string): RegExp | null {
    const patterns = getLines(value);
    return patterns.length ? new RegExp(patterns.map(pattern => `(?:${pattern})`).join("|"), "i") : null;
}

function getFirewallRules(settings: PrivacySettings): FirewallRules | null {
    const key = `${settings.firewallBlocklist}\0${settings.firewallBlockedPatterns}\0${settings.firewallAllowedPatterns}`;
    if (firewallRules?.key === key) return firewallRules;

    try {
        firewallRules = {
            key,
            blocklist: getLines(settings.firewallBlocklist).map(pattern => new RegExp(`^${escapeRegExp(pattern).replaceAll("\\*", ".*")}$`, "i")),
            blocked: getCombinedRegex(settings.firewallBlockedPatterns),
            allowed: getCombinedRegex(settings.firewallAllowedPatterns),
        };
        return firewallRules;
    } catch (error) {
        firewallRules = null;
        logger.warn("Could not compile the GoofCord firewall rules.", error);
        return null;
    }
}

function isBlockedByGoofCord(url: URL, settings: PrivacySettings): boolean {
    if (!settings.goofCordFirewall) return false;

    const rules = getFirewallRules(settings);
    if (!rules) return false;
    if (rules.blocklist.some(pattern => pattern.test(url.href))) return true;
    return Boolean(rules.blocked?.test(url.href) && !rules.allowed?.test(url.href));
}

function getBlockedRequestKind(url: URL | null, settings: PrivacySettings): BlockCategory | null {
    if (!url) return null;

    const { pathname } = url;

    if (isBlockedByGoofCord(url, settings)) return "GoofCord firewall";

    if (isDiscordHost(url.hostname)) {
        if (settings.blockTracing && pathname.endsWith("/tracing")) return "tracing";

        if (!isPluginEnabled("NoTrack") && settings.blockTelemetry && (
            pathname.endsWith("/science") ||
            pathname.endsWith("/track")
        )) return "telemetry";

        if (settings.blockTypingIndicator && pathname.endsWith("/typing")) return "typing indicator";
    }

    if (!isPluginEnabled("NoTrack") && settings.blockSentry && (
        matchesHost(url.hostname, "sentry.io") ||
        (/\/assets\/sentry\..+\.js$/).test(pathname)
    )) return "Sentry";

    if (settings.blockFingerprinting && (
        pathname.startsWith("/cdn-cgi/") ||
        pathname.endsWith("/api.js")
    )) return "fingerprinting";

    return null;
}

function logBlocked(kind: BlockCategory, settings: PrivacySettings): void {
    recordBlock(kind);
    if (settings.logBlockedRequests) logger.info(`Blocked ${kind} request.`);
}

function denied(permission: BlockCategory): Promise<never> {
    recordBlock(permission);
    return Promise.reject(new DOMException(`${permission} is blocked by DiscordHardened.`, "NotAllowedError"));
}

function patchNetwork(settings: PrivacySettings): void {
    const originalFetch = window.fetch;
    const protectedFetch: typeof window.fetch = (input, init) => {
        const url = getUrl(input, settings);
        const kind = getBlockedRequestKind(url, settings);

        if (kind && url) {
            logBlocked(kind, settings);
            return Promise.resolve(new Response(null, { status: 204 }));
        }

        const requestInit = settings.stripThirdPartyReferrers
            ? { ...init, referrer: "", referrerPolicy: "no-referrer" as const }
            : init;
        return originalFetch.call(window, input, requestInit);
    };
    patchValue(window, "fetch", protectedFetch);

    const originalOpen = XMLHttpRequest.prototype.open;
    const protectedOpen = function (this: XMLHttpRequest, method: string, urlLike: string | URL, async = true, username?: string | null, password?: string | null): void {
        blockedXhrs.delete(this);
        const url = getUrl(urlLike, settings);
        const kind = getBlockedRequestKind(url, settings);

        if (kind && url) {
            logBlocked(kind, settings);
            blockedXhrs.add(this);
            originalOpen.call(this, "GET", "data:,", async, username, password);
            return;
        }

        originalOpen.call(this, method, urlLike, async, username, password);
    };
    patchValue(XMLHttpRequest.prototype, "open", protectedOpen);

    const originalSend = XMLHttpRequest.prototype.send;
    const protectedSend = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
        if (blockedXhrs.has(this)) {
            blockedXhrs.delete(this);
            originalSend.call(this, null);
            return;
        }

        originalSend.call(this, body);
    };
    patchValue(XMLHttpRequest.prototype, "send", protectedSend);

    if (typeof navigator.sendBeacon === "function") {
        const originalSendBeacon = navigator.sendBeacon;
        const protectedSendBeacon: Navigator["sendBeacon"] = function (this: Navigator, urlLike, data) {
            const url = getUrl(urlLike, settings);
            const kind = getBlockedRequestKind(url, settings);

            if (kind && url) {
                logBlocked(kind, settings);
                return true;
            }

            return originalSendBeacon.call(this, urlLike, data);
        };
        patchValue(navigator, "sendBeacon", protectedSendBeacon);
    }
}

function hasMandatoryConstraints(constraint: boolean | MediaTrackConstraints | undefined): boolean {
    return typeof constraint === "object" && constraint !== null && "mandatory" in constraint;
}

function patchMedia(settings: PrivacySettings): void {
    if (typeof MediaStream !== "undefined") {
        const originalClone = MediaStream.prototype.clone;
        patchValue(MediaStream.prototype, "clone", function (this: MediaStream) {
            const clone = originalClone.call(this);
            const clonedTracks = clone.getTracks();
            for (const track of this.getTracks()) {
                for (const clonedTrack of clonedTracks) {
                    if (track.kind === clonedTrack.kind) registerTemporaryClone(track, clonedTrack);
                }
            }
            return clone;
        });
    }
    if (typeof MediaStreamTrack !== "undefined") {
        const originalClone = MediaStreamTrack.prototype.clone;
        patchValue(MediaStreamTrack.prototype, "clone", function (this: MediaStreamTrack) {
            const clone = originalClone.call(this);
            registerTemporaryClone(this, clone);
            return clone;
        });
    }
    const { mediaDevices } = navigator;
    if (!mediaDevices) return;

    if (typeof mediaDevices.getUserMedia === "function") {
        const originalGetUserMedia = mediaDevices.getUserMedia;
        const protectedGetUserMedia: MediaDevices["getUserMedia"] = function (this: MediaDevices, constraints) {
            if (settings.blockUnauthorizedLegacyCapture && (
                hasMandatoryConstraints(constraints?.audio) ||
                hasMandatoryConstraints(constraints?.video)
            )) return denied("Legacy media capture");

            if (constraints?.audio && !isPermissionAllowed("allowMicrophone", settings.allowMicrophone)) return denied("Microphone access");
            if (constraints?.video && !isPermissionAllowed("allowCamera", settings.allowCamera)) return denied("Camera access");

            return originalGetUserMedia.call(this, constraints).then(stream => {
                if (stream.getAudioTracks().length && !isPermissionAllowed("allowMicrophone", settings.allowMicrophone) || stream.getVideoTracks().length && !isPermissionAllowed("allowCamera", settings.allowCamera)) {
                    for (const track of stream.getTracks()) track.stop();
                    return denied("Media capture");
                }
                registerTemporaryTracks("allowMicrophone", stream.getAudioTracks(), settings.allowMicrophone);
                registerTemporaryTracks("allowCamera", stream.getVideoTracks(), settings.allowCamera);
                if (stream.getAudioTracks().length) registerMicrophoneStream(stream);
                return stream;
            });
        };
        patchValue(mediaDevices, "getUserMedia", protectedGetUserMedia);
    }

    if (typeof mediaDevices.getDisplayMedia === "function") {
        const originalGetDisplayMedia = mediaDevices.getDisplayMedia;
        const protectedGetDisplayMedia: MediaDevices["getDisplayMedia"] = function (this: MediaDevices, options) {
            if (!isPermissionAllowed("allowDisplayCapture", settings.allowDisplayCapture)) return denied("Display capture");
            return originalGetDisplayMedia.call(this, options).then(stream => {
                if (!isPermissionAllowed("allowDisplayCapture", settings.allowDisplayCapture)) {
                    for (const track of stream.getTracks()) track.stop();
                    return denied("Display capture");
                }
                registerTemporaryTracks("allowDisplayCapture", stream.getTracks(), settings.allowDisplayCapture);
                return stream;
            });
        };
        patchValue(mediaDevices, "getDisplayMedia", protectedGetDisplayMedia);
    }

    if (typeof mediaDevices.enumerateDevices === "function") {
        const originalEnumerateDevices = mediaDevices.enumerateDevices;
        const protectedEnumerateDevices: MediaDevices["enumerateDevices"] = function (this: MediaDevices) {
            if (!isPermissionAllowed("allowDeviceEnumeration", settings.allowDeviceEnumeration)) {
                recordBlock("Device enumeration");
                return Promise.resolve([]);
            }
            return originalEnumerateDevices.call(this).then(devices => isPermissionAllowed("allowDeviceEnumeration", settings.allowDeviceEnumeration) ? devices : []);
        };
        patchValue(mediaDevices, "enumerateDevices", protectedEnumerateDevices);
    }

    const outputDevices = mediaDevices as AudioOutputMediaDevices;
    if (typeof outputDevices.selectAudioOutput === "function") {
        const originalSelectAudioOutput = outputDevices.selectAudioOutput;
        const protectedSelectAudioOutput: NonNullable<AudioOutputMediaDevices["selectAudioOutput"]> = function (this: AudioOutputMediaDevices, options) {
            if (!isPermissionAllowed("allowSpeakerSelection", settings.allowSpeakerSelection)) return denied("Speaker selection");
            return originalSelectAudioOutput.call(this, options).then(device => isPermissionAllowed("allowSpeakerSelection", settings.allowSpeakerSelection) ? device : denied("Speaker selection"));
        };
        patchValue(outputDevices, "selectAudioOutput", protectedSelectAudioOutput);
    }
}

function patchNotifications(settings: PrivacySettings): void {
    if (typeof Notification === "undefined") return;

    const originalRequestPermission = Notification.requestPermission;
    const protectedRequestPermission: typeof Notification.requestPermission = callback => {
        if (!settings.blockNotifications) return originalRequestPermission.call(Notification, callback);

        recordBlock("Notification permission");
        callback?.("denied");
        return Promise.resolve("denied");
    };
    patchValue(Notification, "requestPermission", protectedRequestPermission);

    const permissionDescriptor = Object.getOwnPropertyDescriptor(Notification, "permission");
    const originalPermissionGetter = permissionDescriptor?.get;
    const originalPermission = permissionDescriptor?.value as NotificationPermission | undefined;
    patchGetter(Notification, "permission", () => {
        if (settings.blockNotifications) return "denied";
        return originalPermissionGetter?.call(Notification) as NotificationPermission | undefined ?? originalPermission ?? "default";
    });
}

function patchClipboard(settings: PrivacySettings): void {
    const { clipboard } = navigator;
    if (!clipboard) return;

    if (typeof clipboard.write === "function") {
        const originalWrite = clipboard.write;
        const protectedWrite: Clipboard["write"] = function (this: Clipboard, data) {
            if (!settings.allowClipboardWrite) return denied("Clipboard write access");
            return originalWrite.call(this, data);
        };
        patchValue(clipboard, "write", protectedWrite);
    }

    if (typeof clipboard.writeText === "function") {
        const originalWriteText = clipboard.writeText;
        const protectedWriteText: Clipboard["writeText"] = function (this: Clipboard, data) {
            if (!settings.allowClipboardWrite) return denied("Clipboard write access");
            return originalWriteText.call(this, data);
        };
        patchValue(clipboard, "writeText", protectedWriteText);
    }

    if (typeof clipboard.read === "function") {
        const originalRead = clipboard.read;
        const protectedRead: Clipboard["read"] = function (this: Clipboard) {
            if (!isPermissionAllowed("allowClipboardRead", settings.allowClipboardRead)) return denied("Clipboard read access");
            return originalRead.call(this).then(items => isPermissionAllowed("allowClipboardRead", settings.allowClipboardRead) ? items : denied("Clipboard read access"));
        };
        patchValue(clipboard, "read", protectedRead);
    }

    if (typeof clipboard.readText === "function") {
        const originalReadText = clipboard.readText;
        const protectedReadText: Clipboard["readText"] = function (this: Clipboard) {
            if (!isPermissionAllowed("allowClipboardRead", settings.allowClipboardRead)) return denied("Clipboard read access");
            return originalReadText.call(this).then(text => isPermissionAllowed("allowClipboardRead", settings.allowClipboardRead) ? text : denied("Clipboard read access"));
        };
        patchValue(clipboard, "readText", protectedReadText);
    }
}

function patchGeolocation(settings: PrivacySettings): void {
    const { geolocation } = navigator;
    if (!geolocation) return;

    const permissionDenied = {
        code: 1,
        message: "Geolocation is blocked by DiscordHardened.",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
    } satisfies GeolocationPositionError;
    const originalGetCurrentPosition = geolocation.getCurrentPosition;
    const protectedGetCurrentPosition: Geolocation["getCurrentPosition"] = function (this: Geolocation, success, error, options) {
        if (settings.blockGeolocation) {
            recordBlock("Geolocation");
            error?.(permissionDenied);
            return;
        }
        originalGetCurrentPosition.call(this, success, error, options);
    };
    patchValue(geolocation, "getCurrentPosition", protectedGetCurrentPosition);

    const originalWatchPosition = geolocation.watchPosition;
    const protectedWatchPosition: Geolocation["watchPosition"] = function (this: Geolocation, success, error, options) {
        if (settings.blockGeolocation) {
            recordBlock("Geolocation");
            error?.(permissionDenied);
            return 0;
        }
        return originalWatchPosition.call(this, success, error, options);
    };
    patchValue(geolocation, "watchPosition", protectedWatchPosition);
}

function patchHardwareFingerprint(settings: PrivacySettings): void {
    if (typeof Navigator === "undefined") return;

    const privacyNavigator = navigator as PrivacyNavigator;
    const originalHardwareConcurrency = navigator.hardwareConcurrency;
    const originalDeviceMemory = privacyNavigator.deviceMemory;
    patchGetter(Navigator.prototype, "hardwareConcurrency", () => settings.reduceHardwareFingerprint ? 4 : originalHardwareConcurrency);
    if (originalDeviceMemory !== undefined) patchGetter(Navigator.prototype, "deviceMemory", () => settings.reduceHardwareFingerprint ? 8 : originalDeviceMemory);

    if (typeof navigator.getGamepads === "function") {
        const originalGetGamepads = navigator.getGamepads;
        const protectedGetGamepads: Navigator["getGamepads"] = function (this: Navigator) {
            if (settings.blockGamepadAccess) return [];
            return originalGetGamepads.call(this);
        };
        patchValue(navigator, "getGamepads", protectedGetGamepads);
    }

    if (typeof privacyNavigator.getBattery === "function") {
        const originalGetBattery = privacyNavigator.getBattery;
        const protectedGetBattery: NonNullable<PrivacyNavigator["getBattery"]> = function (this: PrivacyNavigator) {
            if (settings.blockBatteryAccess) return denied("Battery information");
            return originalGetBattery.call(this);
        };
        patchValue(privacyNavigator, "getBattery", protectedGetBattery);
    }

    for (const key of ["usb", "hid", "serial", "bluetooth"]) {
        const api: unknown = Reflect.get(navigator, key);
        if (typeof api !== "object" || api === null) continue;
        for (const method of ["requestDevice", "getDevices", "requestPort", "getPorts", "getAvailability"]) {
            const original: unknown = Reflect.get(api, method);
            if (typeof original !== "function") continue;
            patchValue(api, method, function (this: object, ...args: unknown[]) {
                return settings.blockHardwareAccess ? denied("Hardware access") : Reflect.apply(original, this, args);
            });
        }
    }
}

function patchFullscreen(settings: PrivacySettings): void {
    if (typeof Element === "undefined" || typeof Element.prototype.requestFullscreen !== "function") return;

    const originalRequestFullscreen = Element.prototype.requestFullscreen;
    const protectedRequestFullscreen: Element["requestFullscreen"] = function (this: Element, options) {
        if (!settings.allowFullscreen) return denied("Fullscreen access");
        return originalRequestFullscreen.call(this, options);
    };
    patchValue(Element.prototype, "requestFullscreen", protectedRequestFullscreen);
}

function patchBackgroundSync(settings: PrivacySettings): void {
    const { SyncManager } = window as Window & SyncManagerWindow;
    if (!SyncManager || typeof SyncManager.prototype.register !== "function") return;

    const originalRegister = SyncManager.prototype.register;
    const protectedRegister: SyncManagerLike["register"] = function (this: SyncManagerLike, tag) {
        if (!settings.allowBackgroundSync) return denied("Background synchronization");
        return originalRegister.call(this, tag);
    };
    patchValue(SyncManager.prototype, "register", protectedRegister);
}

function sanitizeAgent(value: string): string {
    return value.replace(/\s(?:Electron|Discord)\/[\w.-]+/gi, "");
}

function createChromeIdentity(originalUserAgent: string, spoofWindows: boolean, settings: PrivacySettings) {
    const chromeVersion = originalUserAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? "120.0.0.0";
    const majorVersion = chromeVersion.split(".")[0];
    const windows = spoofWindows || /Windows/i.test(originalUserAgent);
    const macos = !windows && /Macintosh|Mac OS X/i.test(originalUserAgent);
    const platform = windows ? "Windows" : macos ? "macOS" : "Linux";
    const navigatorPlatform = windows ? "Win32" : macos ? "MacIntel" : "Linux x86_64";
    const platformToken = windows ? "Windows NT 10.0; Win64; x64" : macos ? "Macintosh; Intel Mac OS X 10_15_7" : "X11; Linux x86_64";
    const reducedVersion = `${majorVersion}.0.0.0`;
    const userAgent = `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${reducedVersion} Safari/537.36`;
    const brands = [
        { brand: "Chromium", version: majorVersion },
        { brand: "Google Chrome", version: majorVersion },
        { brand: "Not_A Brand", version: "99" },
    ];
    const fullVersionList = [
        { brand: "Chromium", version: chromeVersion },
        { brand: "Google Chrome", version: chromeVersion },
        { brand: "Not_A Brand", version: "99.0.0.0" },
    ];
    const base = { brands, mobile: false, platform };
    const highEntropy: Record<string, unknown> = {
        architecture: "x86",
        bitness: "64",
        fullVersionList,
        model: "",
        platformVersion: windows ? "10.0.0" : macos ? "10.15.7" : "",
        uaFullVersion: chromeVersion,
        wow64: false,
    };
    const userAgentData: UserAgentDataLike = {
        ...base,
        async getHighEntropyValues(hints) {
            const values: Record<string, unknown> = { ...base };
            if (settings.reduceClientHints) return values;
            for (const hint of hints) if (Object.hasOwn(highEntropy, hint)) values[hint] = highEntropy[hint];
            return values;
        },
        toJSON: () => ({ ...base }),
    };

    return { userAgent, appVersion: userAgent.replace(/^Mozilla\//, ""), navigatorPlatform, userAgentData };
}

function patchUserAgent(settings: PrivacySettings): void {
    if (typeof Navigator === "undefined") return;

    const originalUserAgent = navigator.userAgent;
    const originalAppVersion = navigator.appVersion;
    const originalPlatform = navigator.platform;
    const userAgentNavigator = navigator as NavigatorWithUserAgentData;
    const originalUserAgentData = userAgentNavigator.userAgentData;
    const chromeIdentity = createChromeIdentity(originalUserAgent, settings.spoofWindows, settings);
    if (originalUserAgentData) {
        const originalGetHighEntropyValues = originalUserAgentData.getHighEntropyValues;
        patchValue(originalUserAgentData, "getHighEntropyValues", function (this: UserAgentDataLike, hints: string[]) {
            return settings.reduceClientHints
                ? Promise.resolve({ brands: this.brands, mobile: this.mobile, platform: this.platform })
                : originalGetHighEntropyValues.call(this, hints);
        });
    }
    const sanitizedUserAgent = sanitizeAgent(originalUserAgent);
    const sanitizedAppVersion = sanitizeAgent(originalAppVersion);
    patchGetter(Navigator.prototype, "userAgent", () => settings.spoofChrome ? chromeIdentity.userAgent : settings.hideElectronUserAgent ? sanitizedUserAgent : originalUserAgent);
    patchGetter(Navigator.prototype, "appVersion", () => settings.spoofChrome ? chromeIdentity.appVersion : settings.hideElectronUserAgent ? sanitizedAppVersion : originalAppVersion);
    patchGetter(Navigator.prototype, "platform", () => settings.spoofChrome ? chromeIdentity.navigatorPlatform : originalPlatform);
    patchGetter(Navigator.prototype, "userAgentData", () => settings.spoofChrome ? chromeIdentity.userAgentData : originalUserAgentData);
}

function patchWebGl(settings: PrivacySettings): void {
    if (typeof HTMLCanvasElement === "undefined") return;

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const protectedGetContext = new Proxy(originalGetContext, {
        apply(target, thisArg: HTMLCanvasElement, argumentsList: unknown[]) {
            const contextType = argumentsList[0];
            if (settings.disableWebGl && (contextType === "webgl" || contextType === "webgl2" || contextType === "experimental-webgl")) return null;
            return Reflect.apply(target, thisArg, argumentsList);
        },
    });
    patchValue(HTMLCanvasElement.prototype, "getContext", protectedGetContext);

    const prototypes = [
        typeof WebGLRenderingContext === "undefined" ? null : WebGLRenderingContext.prototype,
        typeof WebGL2RenderingContext === "undefined" ? null : WebGL2RenderingContext.prototype,
    ];
    for (const prototype of prototypes) {
        if (!prototype) continue;
        const { getExtension }: { getExtension(name: string): unknown; } = prototype;
        const { getSupportedExtensions } = prototype;
        patchValue(prototype, "getExtension", function (this: WebGLRenderingContext, name: string) {
            return settings.reduceGpuFingerprint && name.toLowerCase() === "webgl_debug_renderer_info"
                ? null : getExtension.call(this, name);
        });
        patchValue(prototype, "getSupportedExtensions", function (this: WebGLRenderingContext) {
            const extensions = getSupportedExtensions.call(this);
            return settings.reduceGpuFingerprint ? extensions?.filter(name => name !== "WEBGL_debug_renderer_info") ?? null : extensions;
        });
    }

    const { GPUAdapterInfo } = window as Window & { GPUAdapterInfo?: { prototype: object; }; };
    if (GPUAdapterInfo) {
        for (const key of ["vendor", "architecture", "device", "description"]) {
            const original = Object.getOwnPropertyDescriptor(GPUAdapterInfo.prototype, key)?.get;
            if (!original) continue;
            patchGetter(GPUAdapterInfo.prototype, key, function (this: object) {
                return settings.reduceGpuFingerprint ? "" : original.call(this);
            });
        }
    }
}

function isSafeWindowOpenUrl(urlLike: string | URL | undefined, settings: PrivacySettings): boolean {
    if (!urlLike) return true;

    const url = getUrl(urlLike, settings);
    if (!url) return false;
    if (url.href === "about:blank") return true;
    return !url.username && !url.password && SAFE_EXTERNAL_PROTOCOLS.has(url.protocol);
}

function patchWindowOpen(settings: PrivacySettings, openLink: (url: string) => boolean): void {
    const originalWindowOpen = window.open;
    const protectedWindowOpen = function (this: Window, url?: string | URL, target?: string, features?: string): WindowProxy | null {
        if (settings.blockUnsafeExternalProtocols && !isSafeWindowOpenUrl(url, settings)) {
            recordBlock("Unsafe window request");
            if (settings.logBlockedRequests) logger.warn("Blocked a window request with an unsafe protocol.");
            return null;
        }

        if (url) {
            const parsed = getUrl(url, settings);
            if (parsed && parsed.origin !== location.origin
                && !(parsed.pathname === "/popout" && isDiscordHost(parsed.hostname))
                && openLink(parsed.href)) return null;
            if (parsed && parsed.origin !== location.origin && (parsed.protocol === "https:" || parsed.protocol === "http:")) {
                if (settings.isolateExternalWindows || settings.stripThirdPartyReferrers) {
                    const protectedFeatures = settings.stripThirdPartyReferrers ? /^\s*(?:noopener|noreferrer)(?:\s*=|\s*$)/i : /^\s*noopener(?:\s*=|\s*$)/i;
                    features = (features ?? "").split(",").filter(feature => !protectedFeatures.test(feature)).join(",");
                    features += settings.stripThirdPartyReferrers ? ",noopener,noreferrer" : ",noopener";
                }
            }
        }

        return originalWindowOpen.call(this, url, target, features);
    };
    patchValue(window, "open", protectedWindowOpen);
}

export function startHardening(settings: PrivacySettings, openLink: (url: string) => boolean): void {
    if (restorers.length) return;
    activeSettings = settings;

    const gifs = getUserSetting<boolean>("textAndImages", "gifAutoPlay");
    if (gifs) {
        const { getSetting } = gifs;
        const { useSetting } = gifs;
        patchValue(gifs, "getSetting", () => getSetting.call(gifs) && !settings.blockGifAutoplay);
        patchValue(gifs, "useSetting", () => {
            const enabled = useSetting.call(gifs);
            return enabled && !settings.blockGifAutoplay;
        });
    }

    patchNetwork(settings);
    patchMedia(settings);
    patchNotifications(settings);
    patchClipboard(settings);
    patchGeolocation(settings);
    patchHardwareFingerprint(settings);
    patchFullscreen(settings);
    patchBackgroundSync(settings);
    patchUserAgent(settings);
    patchWebGl(settings);
    patchWindowOpen(settings, openLink);
}

export function stopHardening(): void {
    for (const restore of restorers.splice(0).reverse()) {
        try {
            restore();
        } catch (error) {
            logger.warn("Could not restore a protected browser API.", error);
        }
    }

    firewallRules = null;
    protectedApis.length = 0;
    activeSettings = undefined;
}
