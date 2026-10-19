/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RendererSettings } from "@main/settings";
import type { IpcMainInvokeEvent, Session, WebContents } from "electron";

import { isDiscordAppUrl, isTrustedSender } from "./nativeSecurity";
import { TEMPORARY_PERMISSIONS, type TemporaryPermission } from "./session";

type CheckHandler = NonNullable<Parameters<Session["setPermissionCheckHandler"]>[0]>;
type RequestHandler = NonNullable<Parameters<Session["setPermissionRequestHandler"]>[0]>;
type DeviceHandler = NonNullable<Parameters<Session["setDevicePermissionHandler"]>[0]>;

const grants = new Map<number, { permissions: Map<TemporaryPermission, number>; sender: WebContents; destroyed: () => void; }>();

export function clearTemporaryPermissions(senderId: number): void {
    const grant = grants.get(senderId);
    if (grant) grant.sender.removeListener("destroyed", grant.destroyed);
    grants.delete(senderId);
}

export function setTemporaryPermissions(event: IpcMainInvokeEvent, value: unknown): boolean {
    if (!isTrustedSender(event) || !Array.isArray(value) || value.length > 6) return false;
    const permissions = new Map<TemporaryPermission, number>();
    const now = Date.now();
    for (const entry of value) {
        if (typeof entry !== "object" || entry === null
            || !("permission" in entry) || typeof entry.permission !== "string" || !Object.hasOwn(TEMPORARY_PERMISSIONS, entry.permission)
            || !("expiresAt" in entry) || typeof entry.expiresAt !== "number" || !Number.isFinite(entry.expiresAt)
            || entry.expiresAt > now + 15 * 60_000) return false;
        if (entry.expiresAt > now) permissions.set(entry.permission as TemporaryPermission, entry.expiresAt);
    }
    clearTemporaryPermissions(event.sender.id);
    if (permissions.size) {
        const destroyed = () => clearTemporaryPermissions(event.sender.id);
        grants.set(event.sender.id, { permissions, sender: event.sender, destroyed });
        event.sender.once("destroyed", destroyed);
    }
    return true;
}

function allowed(contents: WebContents | null, permission: string, origin: string, mainFrame: boolean, mediaTypes: readonly string[] = []): boolean {
    const settings = RendererSettings.store.plugins?.DiscordHardened;
    if (settings?.enabled === false || settings?.electronPermissionControls === false) return true;
    if (!contents || contents.isDestroyed() || !mainFrame || !isDiscordAppUrl(contents.getURL()) || !isDiscordAppUrl(origin)
        || new URL(origin).origin !== new URL(contents.getURL()).origin) return false;

    const permits = (key: TemporaryPermission, permanent: boolean) => permanent || (grants.get(contents.id)?.permissions.get(key) ?? 0) > Date.now();
    switch (permission) {
        case "media":
            return (mediaTypes.length ? mediaTypes : ["audio", "video"]).every(type =>
                type === "audio" ? permits("allowMicrophone", settings?.allowMicrophone !== false)
                    : type === "video" && permits("allowCamera", settings?.allowCamera !== false));
        case "display-capture": return permits("allowDisplayCapture", settings?.allowDisplayCapture !== false);
        case "clipboard-read":
        case "deprecated-sync-clipboard-read": return permits("allowClipboardRead", settings?.allowClipboardRead === true);
        case "speaker-selection": return permits("allowSpeakerSelection", settings?.allowSpeakerSelection === true);
        case "clipboard-sanitized-write": return settings?.allowClipboardWrite !== false;
        case "notifications": return settings?.blockNotifications === false;
        case "geolocation": return settings?.blockGeolocation === false;
        case "fullscreen": return settings?.allowFullscreen !== false;
        case "background-sync": return settings?.allowBackgroundSync === true;
        case "hid":
        case "serial":
        case "usb": return settings?.blockHardwareAccess === false;
        case "openExternal": return true;
        default: return false;
    }
}

export function installPermissionControls(ses: Session): (() => void) | undefined {
    const settings = RendererSettings.store.plugins?.DiscordHardened;
    if (settings?.enabled === false || settings?.electronPermissionControls === false) return;
    const setCheck = ses.setPermissionCheckHandler;
    const setRequest = ses.setPermissionRequestHandler;
    const setDevice = ses.setDevicePermissionHandler;
    let hostCheck: CheckHandler | null = null;
    let hostRequest: RequestHandler | null = null;
    let hostDevice: DeviceHandler | null = null;

    const check: CheckHandler = (contents, permission, origin, details) =>
        allowed(contents, permission, origin, details.isMainFrame, details.mediaType && details.mediaType !== "unknown" ? [details.mediaType] : [])
        && (hostCheck?.(contents, permission, origin, details) ?? true);
    const request: RequestHandler = (contents, permission, callback, details) => {
        const mediaTypes = "mediaTypes" in details ? details.mediaTypes : [];
        if (!allowed(contents, permission, details.requestingUrl, details.isMainFrame, mediaTypes)) {
            callback(false);
            return;
        }
        if (hostRequest) hostRequest(contents, permission, granted => {
            callback(granted && allowed(contents, permission, details.requestingUrl, details.isMainFrame, mediaTypes));
        }, details);
        else callback(true);
    };
    const device: DeviceHandler = details => {
        const settings = RendererSettings.store.plugins?.DiscordHardened;
        if (settings?.enabled !== false && settings?.electronPermissionControls !== false
            && (settings?.blockHardwareAccess !== false || !isDiscordAppUrl(details.origin))) return false;
        return hostDevice?.(details) ?? (settings?.blockHardwareAccess === false && isDiscordAppUrl(details.origin));
    };

    const protectedCheck: Session["setPermissionCheckHandler"] = handler => {
        hostCheck = handler;
        setCheck.call(ses, check);
    };
    const protectedRequest: Session["setPermissionRequestHandler"] = handler => {
        hostRequest = handler;
        setRequest.call(ses, request);
    };
    const protectedDevice: Session["setDevicePermissionHandler"] = handler => {
        hostDevice = handler;
        setDevice.call(ses, device);
    };
    ses.setPermissionCheckHandler = protectedCheck;
    ses.setPermissionRequestHandler = protectedRequest;
    ses.setDevicePermissionHandler = protectedDevice;
    setCheck.call(ses, check);
    setRequest.call(ses, request);
    setDevice.call(ses, device);

    return () => {
        if (ses.setPermissionCheckHandler === protectedCheck) {
            ses.setPermissionCheckHandler = setCheck;
            setCheck.call(ses, hostCheck);
        }
        if (ses.setPermissionRequestHandler === protectedRequest) {
            ses.setPermissionRequestHandler = setRequest;
            setRequest.call(ses, hostRequest);
        }
        if (ses.setDevicePermissionHandler === protectedDevice) {
            ses.setDevicePermissionHandler = setDevice;
            setDevice.call(ses, hostDevice);
        }
    };
}
