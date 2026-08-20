/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Resolver } from "dns";

export type DnsFamily = 4 | 6;
export type ResolveProtocol = "automatic" | "doh" | "plain_dns";

export interface MullvadResolveResult {
    success: boolean;
    hostname: string;
    endpoint: string;
    family: DnsFamily;
    addresses: string[];
    protocol: Exclude<ResolveProtocol, "automatic">;
    error?: string;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DNS_HEADER_LENGTH = 12;
const DNS_CLASS_IN = 1;
const DNS_TYPE_A = 1;
const DNS_TYPE_AAAA = 28;
const DNS_FLAGS_RECURSION_DESIRED = 0x0100;
const DNS_POINTER_MASK = 0xc0;
const DNS_RESPONSE_CODE_MASK = 0x000f;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 15000;
const MAX_HOSTNAME_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;
const MAX_PRELOAD_HOSTNAMES = 50;

const MULLVAD_ENDPOINTS = new Set([
    "https://dns.mullvad.net/dns-query",
    "https://adblock.dns.mullvad.net/dns-query",
    "https://base.dns.mullvad.net/dns-query",
    "https://extended.dns.mullvad.net/dns-query",
    "https://family.dns.mullvad.net/dns-query",
    "https://all.dns.mullvad.net/dns-query"
]);

const MULLVAD_DNS_SERVERS: Record<DnsFamily, Set<string>> = {
    4: new Set([
        "194.242.2.2",
        "194.242.2.3",
        "194.242.2.4",
        "194.242.2.5",
        "194.242.2.6",
        "194.242.2.9"
    ]),
    6: new Set([
        "2a07:e340::2",
        "2a07:e340::3",
        "2a07:e340::4",
        "2a07:e340::5",
        "2a07:e340::6",
        "2a07:e340::9"
    ])
};

const resolverCache = new Map<string, Resolver>();

function getErrorMessage(error: unknown) {
    if (!(error instanceof Error)) return String(error);
    if (error.cause instanceof Error) return `${error.message}: ${error.cause.message}`;
    return error.message;
}

function getFallbackString(value: unknown) {
    return typeof value === "string" ? value : "";
}

function getFallbackFamily(value: unknown): DnsFamily {
    return value === 6 ? 6 : 4;
}

function getFallbackProtocol(value: unknown): Exclude<ResolveProtocol, "automatic"> {
    return value === "plain_dns" ? "plain_dns" : "doh";
}

function createFailure(hostname: string, endpoint: string, family: DnsFamily, protocol: Exclude<ResolveProtocol, "automatic">, error: string): MullvadResolveResult {
    return {
        success: false,
        hostname,
        endpoint,
        family,
        addresses: [],
        protocol,
        error
    };
}

function isDnsFamily(value: unknown): value is DnsFamily {
    return value === 4 || value === 6;
}

function isResolveProtocol(value: unknown): value is ResolveProtocol {
    return value === "automatic" || value === "doh" || value === "plain_dns";
}

function normalizeHostname(value: unknown) {
    if (typeof value !== "string") return null;

    const hostname = value.trim().toLowerCase().replace(/\.$/, "");
    if (!hostname || hostname.length > MAX_HOSTNAME_LENGTH) return null;

    const labels = hostname.split(".");
    if (labels.some(label =>
        !label ||
        label.length > MAX_LABEL_LENGTH ||
        label.startsWith("-") ||
        label.endsWith("-") ||
        !/^[a-z0-9-]+$/i.test(label)
    )) return null;

    return hostname;
}

function normalizeEndpoint(value: unknown) {
    if (typeof value !== "string") return null;

    try {
        const endpoint = new URL(value).toString();
        return MULLVAD_ENDPOINTS.has(endpoint) ? endpoint : null;
    } catch {
        return null;
    }
}

function normalizeTimeoutMs(value: unknown) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;

    const timeoutMs = Math.trunc(value);
    if (timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) return null;

    return timeoutMs;
}

function normalizePlainDnsServer(value: unknown, family: DnsFamily) {
    if (typeof value !== "string") return null;

    const server = value.trim();
    if (!server) return "";

    return MULLVAD_DNS_SERVERS[family].has(server) ? server : null;
}

function createTransactionId() {
    return Math.floor(Math.random() * 0x10000);
}

function pushUint16(bytes: number[], value: number) {
    bytes.push((value >> 8) & 0xff, value & 0xff);
}

function getQueryType(family: DnsFamily) {
    return family === 6 ? DNS_TYPE_AAAA : DNS_TYPE_A;
}

function encodeDnsQuery(hostname: string, family: DnsFamily, transactionId: number) {
    const bytes: number[] = [];

    pushUint16(bytes, transactionId);
    pushUint16(bytes, DNS_FLAGS_RECURSION_DESIRED);
    pushUint16(bytes, 1);
    pushUint16(bytes, 0);
    pushUint16(bytes, 0);
    pushUint16(bytes, 0);

    for (const label of hostname.split(".")) {
        const encodedLabel = new TextEncoder().encode(label);
        bytes.push(encodedLabel.length);

        for (const byte of encodedLabel) {
            bytes.push(byte);
        }
    }

    bytes.push(0);
    pushUint16(bytes, getQueryType(family));
    pushUint16(bytes, DNS_CLASS_IN);

    return new Uint8Array(bytes);
}

function readUint16(view: DataView, offset: number) {
    if (offset + 2 > view.byteLength) throw new Error("Invalid DNS response.");
    return view.getUint16(offset);
}

function skipName(message: Uint8Array, offset: number) {
    let currentOffset = offset;

    while (currentOffset < message.length) {
        const length = message[currentOffset];

        if ((length & DNS_POINTER_MASK) === DNS_POINTER_MASK) {
            return currentOffset + 2;
        }

        if (length === 0) {
            return currentOffset + 1;
        }

        currentOffset += length + 1;
    }

    throw new Error("Invalid DNS name.");
}

function formatIPv6(message: Uint8Array, offset: number) {
    const groups: string[] = [];

    for (let index = 0; index < 16; index += 2) {
        groups.push(((message[offset + index] << 8) | message[offset + index + 1]).toString(16));
    }

    return groups.join(":");
}

function parseDnsResponse(message: Uint8Array, family: DnsFamily, transactionId: number) {
    if (message.length < DNS_HEADER_LENGTH) {
        throw new Error("DNS response was too short.");
    }

    const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
    const responseId = readUint16(view, 0);
    const responseCode = readUint16(view, 2) & DNS_RESPONSE_CODE_MASK;

    if (responseId !== transactionId) {
        throw new Error("DNS response ID did not match.");
    }

    if (responseCode !== 0) {
        throw new Error(`DNS returned response code ${responseCode}.`);
    }

    const questionCount = readUint16(view, 4);
    const answerCount = readUint16(view, 6);
    const expectedType = getQueryType(family);
    const addresses: string[] = [];
    let offset = DNS_HEADER_LENGTH;

    for (let index = 0; index < questionCount; index++) {
        offset = skipName(message, offset) + 4;
    }

    for (let index = 0; index < answerCount; index++) {
        offset = skipName(message, offset);

        if (offset + 10 > message.length) {
            throw new Error("DNS answer was incomplete.");
        }

        const recordType = readUint16(view, offset);
        const recordClass = readUint16(view, offset + 2);
        const dataLength = readUint16(view, offset + 8);
        const dataOffset = offset + 10;

        if (dataOffset + dataLength > message.length) {
            throw new Error("DNS answer data was incomplete.");
        }

        if (recordClass === DNS_CLASS_IN && recordType === expectedType) {
            if (family === 4 && dataLength === 4) {
                addresses.push(Array.from(message.slice(dataOffset, dataOffset + dataLength)).join("."));
            }

            if (family === 6 && dataLength === 16) {
                addresses.push(formatIPv6(message, dataOffset));
            }
        }

        offset = dataOffset + dataLength;
    }

    return addresses;
}

function getResolver(server: string) {
    const cachedResolver = resolverCache.get(server);
    if (cachedResolver) return cachedResolver;

    const resolver = new Resolver();
    resolver.setServers([server]);
    resolverCache.set(server, resolver);
    return resolver;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("DNS request timed out.")), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeout != null) clearTimeout(timeout);
    });
}

function resolvePlainDns(hostname: string, server: string, family: DnsFamily) {
    const resolver = getResolver(server);

    return new Promise<string[]>((resolve, reject) => {
        const callback = (error: NodeJS.ErrnoException | null, addresses: string[]) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(addresses);
        };

        if (family === 6) {
            resolver.resolve6(hostname, callback);
            return;
        }

        resolver.resolve4(hostname, callback);
    });
}

async function resolveDoh(hostname: string, endpoint: string, family: DnsFamily, timeoutMs: number): Promise<MullvadResolveResult> {
    const controller = new AbortController();
    const transactionId = createTransactionId();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                Accept: "application/dns-message",
                "Content-Type": "application/dns-message"
            },
            body: encodeDnsQuery(hostname, family, transactionId),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`Mullvad DNS returned ${response.status}.`);
        }

        const addresses = parseDnsResponse(new Uint8Array(await response.arrayBuffer()), family, transactionId);

        return {
            success: addresses.length > 0,
            hostname,
            endpoint,
            family,
            addresses,
            protocol: "doh",
            error: addresses.length > 0 ? undefined : "No addresses returned."
        };
    } catch (error) {
        return {
            success: false,
            hostname,
            endpoint,
            family,
            addresses: [],
            protocol: "doh",
            error: getErrorMessage(error)
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function resolvePlain(hostname: string, endpoint: string, server: string, family: DnsFamily, timeoutMs: number): Promise<MullvadResolveResult> {
    try {
        const addresses = await withTimeout(resolvePlainDns(hostname, server, family), timeoutMs);

        return {
            success: addresses.length > 0,
            hostname,
            endpoint,
            family,
            addresses,
            protocol: "plain_dns",
            error: addresses.length > 0 ? undefined : "No addresses returned."
        };
    } catch (error) {
        return {
            success: false,
            hostname,
            endpoint,
            family,
            addresses: [],
            protocol: "plain_dns",
            error: getErrorMessage(error)
        };
    }
}

export async function resolveDNS(
    _event: Electron.IpcMainInvokeEvent,
    hostname: string,
    endpoint: string,
    family: DnsFamily = 4,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    protocol: ResolveProtocol = "automatic",
    plainDnsServer = ""
) {
    const fallback = {
        hostname: getFallbackString(hostname),
        endpoint: getFallbackString(endpoint),
        family: getFallbackFamily(family),
        protocol: getFallbackProtocol(protocol)
    };
    const normalizedHostname = normalizeHostname(hostname);
    if (!normalizedHostname) return createFailure(fallback.hostname, fallback.endpoint, fallback.family, fallback.protocol, "Invalid hostname.");

    const normalizedEndpoint = normalizeEndpoint(endpoint);
    if (!normalizedEndpoint) return createFailure(normalizedHostname, fallback.endpoint, fallback.family, fallback.protocol, "Invalid Mullvad DNS endpoint.");

    if (!isDnsFamily(family)) return createFailure(normalizedHostname, normalizedEndpoint, fallback.family, fallback.protocol, "Invalid DNS family.");
    if (!isResolveProtocol(protocol)) return createFailure(normalizedHostname, normalizedEndpoint, family, fallback.protocol, "Invalid DNS protocol.");

    const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs);
    if (normalizedTimeoutMs == null) return createFailure(normalizedHostname, normalizedEndpoint, family, getFallbackProtocol(protocol), "Invalid DNS timeout.");

    const normalizedPlainDnsServer = normalizePlainDnsServer(plainDnsServer, family);
    if (normalizedPlainDnsServer == null) return createFailure(normalizedHostname, normalizedEndpoint, family, getFallbackProtocol(protocol), "Invalid Mullvad DNS server.");
    if (protocol === "plain_dns" && !normalizedPlainDnsServer) return createFailure(normalizedHostname, normalizedEndpoint, family, "plain_dns", "No Mullvad DNS server configured.");

    try {
        if (protocol === "plain_dns") {
            return resolvePlain(normalizedHostname, normalizedEndpoint, normalizedPlainDnsServer, family, normalizedTimeoutMs);
        }

        const dohResult = await resolveDoh(normalizedHostname, normalizedEndpoint, family, normalizedTimeoutMs);
        if (dohResult.success || protocol === "doh" || !normalizedPlainDnsServer) return dohResult;

        const plainResult = await resolvePlain(normalizedHostname, normalizedEndpoint, normalizedPlainDnsServer, family, normalizedTimeoutMs);
        if (plainResult.success) return plainResult;

        return {
            ...plainResult,
            error: `${dohResult.error ?? "DoH failed."} Plain DNS fallback failed: ${plainResult.error ?? "No addresses returned."}`
        };
    } catch (error) {
        return createFailure(normalizedHostname, normalizedEndpoint, family, getFallbackProtocol(protocol), getErrorMessage(error));
    }
}

export async function preloadDNS(
    _event: Electron.IpcMainInvokeEvent,
    hostnames: string[],
    endpoint: string,
    family: DnsFamily = 4,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    protocol: ResolveProtocol = "automatic",
    plainDnsServer = ""
) {
    if (!Array.isArray(hostnames)) return {};

    const normalizedHostnames: string[] = [];
    for (const hostname of hostnames.slice(0, MAX_PRELOAD_HOSTNAMES)) {
        const normalizedHostname = normalizeHostname(hostname);
        if (normalizedHostname) normalizedHostnames.push(normalizedHostname);
    }

    const results = await Promise.all(normalizedHostnames.map(async hostname => {
        const result = await resolveDNS(_event, hostname, endpoint, family, timeoutMs, protocol, plainDnsServer);
        return [hostname, result.addresses] as const;
    }));

    return Object.fromEntries(results.filter(([, addresses]) => addresses.length));
}
