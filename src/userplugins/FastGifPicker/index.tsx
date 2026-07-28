/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Hisako
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { React, useEffect, useMemo, useRef, UserSettingsActionCreators, useState } from "@webpack/common";
import type { ElementType, MutableRefObject, ReactElement, ReactNode, Ref, SyntheticEvent } from "react";

const PREVIEW_CACHE_LIMIT = 500;
const DEFAULT_CONCURRENT_LOADS = 6;
const DEFAULT_BACKGROUND_PRELOADS = 3;
const DEFAULT_BACKGROUND_PRELOAD_LIMIT = 250;
const DEFAULT_RETRY_COUNT = 2;
const LOAD_SLOT_TIMEOUT_MS = 12000;
const BACKGROUND_PRELOAD_TIMEOUT_MS = 12000;
const RETRY_DELAY_MS = 650;
const STATS_REFRESH_MS = 1000;
const SEEN_PREVIEW_LIMIT = 2000;
const TRANSPARENT_IMAGE_SRC = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const RETRY_PARAM = "fast_gif_retry";
const GIF_EXTENSION_RE = /\.gif(?:$|[?#])/i;
const logger = new Logger("FastGifPicker");

type PreviewMode = "webp" | "static" | "hover" | "original";

interface FastGifStats {
    backgroundFailed: number;
    backgroundLoaded: number;
    backgroundQueued: number;
    cacheHits: number;
    hoverLoads: number;
    loadedPreviews: number;
    originalFallbacks: number;
    preloadLimitSkips: number;
    retryAttempts: number;
    seenPreviews: number;
}

interface FastGifStatsSnapshot extends FastGifStats {
    activeBackgroundPreloads: number;
    activeVisibleLoads: number;
    queuedBackgroundPreloads: number;
    queuedVisibleLoads: number;
    readyCacheSize: number;
}

interface GifReactElement extends ReactElement<Record<string, unknown>> {
    ref?: Ref<unknown>;
}

interface GifImageProps extends Record<string, unknown> {
    children?: ReactNode;
    decoding?: string;
    loading?: string;
    onError?: (event: SyntheticEvent<HTMLElement>) => void;
    onLoad?: (event: SyntheticEvent<HTMLElement>) => void;
    onMouseEnter?: (event: SyntheticEvent<HTMLElement>) => void;
    onMouseLeave?: (event: SyntheticEvent<HTMLElement>) => void;
    src?: string;
}

interface GifData {
    src?: unknown;
    url?: unknown;
}

interface LoadQueueEntry {
    active: boolean;
    cancelled: boolean;
    start: () => void;
}

type PreviewLoadListener = (loaded: boolean) => void;

const previewUrlCache = new Map<string, string>();
const loadedPreviewUrls = new Set<string>();
const previewLoadListeners = new Map<string, Set<PreviewLoadListener>>();
const backgroundPreloadQueued = new Set<string>();
const backgroundPreloadQueue: string[] = [];
const backgroundPreloadImages = new Map<HTMLImageElement, ReturnType<typeof setTimeout>>();
const loadQueue: LoadQueueEntry[] = [];
const seenOriginalSrcs = new Set<string>();
const stats: FastGifStats = {
    backgroundFailed: 0,
    backgroundLoaded: 0,
    backgroundQueued: 0,
    cacheHits: 0,
    hoverLoads: 0,
    loadedPreviews: 0,
    originalFallbacks: 0,
    preloadLimitSkips: 0,
    retryAttempts: 0,
    seenPreviews: 0
};
const statItems = [
    { label: "Seen previews", value: "seenPreviews" },
    { label: "Loaded previews", value: "loadedPreviews" },
    { label: "Retries", value: "retryAttempts" },
    { label: "Original fallbacks", value: "originalFallbacks" },
    { label: "Cache hits", value: "cacheHits" },
    { label: "Hover loads", value: "hoverLoads" },
    { label: "Background queued", value: "backgroundQueued" },
    { label: "Background loaded", value: "backgroundLoaded" },
    { label: "Background failed", value: "backgroundFailed" },
    { label: "Preload limit skips", value: "preloadLimitSkips" },
    { label: "Ready cache", value: "readyCacheSize" },
    { label: "Active visible", value: "activeVisibleLoads" },
    { label: "Queued visible", value: "queuedVisibleLoads" },
    { label: "Active preload", value: "activeBackgroundPreloads" },
    { label: "Queued preload", value: "queuedBackgroundPreloads" }
] as const satisfies readonly { label: string; value: keyof FastGifStatsSnapshot; }[];
const GIF_IMAGE_SETTING_KEYS = [
    "preloadAllInBackground",
    "previewMode",
    "rememberLoadedPreviews"
] satisfies ("preloadAllInBackground" | "previewMode" | "rememberLoadedPreviews")[];

let activeLoads = 0;
let activeBackgroundPreloads = 0;
let discordMediaHosts: Set<string> | undefined;
let favoritePreloadTimer: ReturnType<typeof setTimeout> | undefined;

function clearCaches() {
    previewUrlCache.clear();
    loadedPreviewUrls.clear();
    backgroundPreloadQueued.clear();
    backgroundPreloadQueue.length = 0;
    cancelBackgroundPreloads();
}

function bumpStat(stat: keyof FastGifStats, by = 1) {
    stats[stat] += by;
}

function recordSeenPreview(src: string) {
    if (!src || seenOriginalSrcs.has(src)) return;

    seenOriginalSrcs.add(src);
    if (seenOriginalSrcs.size > SEEN_PREVIEW_LIMIT) {
        const oldest = seenOriginalSrcs.values().next().value;
        if (oldest) seenOriginalSrcs.delete(oldest);
    }

    bumpStat("seenPreviews");
}

function resetStats() {
    for (const stat of Object.keys(stats) as (keyof FastGifStats)[]) {
        stats[stat] = 0;
    }

    seenOriginalSrcs.clear();
}

function getStatsSnapshot(): FastGifStatsSnapshot {
    return {
        ...stats,
        activeBackgroundPreloads,
        activeVisibleLoads: activeLoads,
        queuedBackgroundPreloads: backgroundPreloadQueue.length,
        queuedVisibleLoads: loadQueue.length,
        readyCacheSize: loadedPreviewUrls.size
    };
}

const settings = definePluginSettings({
    previewMode: {
        type: OptionType.SELECT,
        description: "Use lighter preview URLs in the GIF picker.",
        options: [
            { label: "Animated WebP", value: "webp", default: true },
            { label: "Still preview", value: "static" },
            { label: "Still until hover", value: "hover" },
            { label: "Original URL", value: "original" }
        ] as const,
        onChange: () => {
            clearCaches();
            scheduleFavoritePreload();
        }
    },
    maxConcurrentLoads: {
        type: OptionType.SLIDER,
        description: "How many GIF previews may load at the same time.",
        markers: [2, 4, 6, 8, 10, 12],
        default: DEFAULT_CONCURRENT_LOADS,
        stickToMarkers: true,
        onChange: () => pumpLoadQueue()
    },
    retryCount: {
        type: OptionType.SLIDER,
        description: "How many times a failed preview should be retried.",
        markers: [0, 1, 2, 3],
        default: DEFAULT_RETRY_COUNT,
        stickToMarkers: true
    },
    preloadAllInBackground: {
        type: OptionType.BOOLEAN,
        description: "Preload every GIF preview the picker knows about in the background.",
        default: false,
        onChange: enabled => {
            if (enabled) return;

            backgroundPreloadQueued.clear();
            backgroundPreloadQueue.length = 0;
            cancelBackgroundPreloads();
        }
    },
    preloadFavoritesOnStart: {
        type: OptionType.BOOLEAN,
        description: "Preload favorite GIF previews in the background when the plugin starts. This can use extra bandwidth.",
        default: false,
        onChange: () => scheduleFavoritePreload()
    },
    backgroundPreloadConcurrency: {
        type: OptionType.SLIDER,
        description: "How many background GIF previews may preload at the same time.",
        markers: [1, 2, 3, 4, 6, 8, 10, 12],
        default: DEFAULT_BACKGROUND_PRELOADS,
        stickToMarkers: true,
        onChange: () => pumpBackgroundPreloads()
    },
    backgroundPreloadLimit: {
        type: OptionType.SLIDER,
        description: "Maximum GIF previews to preload from each background batch. Set to 0 for no limit.",
        markers: [0, 50, 100, 250, 500, 1000],
        default: DEFAULT_BACKGROUND_PRELOAD_LIMIT,
        stickToMarkers: true
    },
    rememberLoadedPreviews: {
        type: OptionType.BOOLEAN,
        description: "Skip the load queue for previews that already loaded once.",
        default: true
    },
    statsPanel: {
        type: OptionType.COMPONENT,
        component: ErrorBoundary.wrap(StatsPanel, { noop: true })
    }
});

export default definePlugin({
    name: "FastGifPicker",
    description: "Makes the GIF picker load lighter previews, retry failures, and avoid starting too many GIFs at once.",
    tags: ["Media", "Utility"],
    authors: [{ name: "irritably", id: 928787166916640838n }],
    settings,

    patches: [
        {
            find: "#{intl::NO_GIF_FAVORITES_HOW_TO_FAVORITE}",
            replacement: [
                {
                    match: /this\.renderGIF\(\)/,
                    replace: "$self.renderOptimizedGif(()=>this.renderGIF())"
                },
                {
                    match: /(,suggestions:)(\i)(,favorites:)(\i),/,
                    replace: "$1$self.preloadGifList($2)$3$self.preloadGifList($4),",
                    noWarn: true
                }
            ]
        }
    ],

    start() {
        scheduleFavoritePreload();
    },

    stop() {
        if (favoritePreloadTimer) {
            clearTimeout(favoritePreloadTimer);
            favoritePreloadTimer = undefined;
        }

        activeLoads = 0;
        clearCaches();
        previewLoadListeners.clear();

        for (const entry of loadQueue) {
            entry.cancelled = true;
        }

        loadQueue.length = 0;
    },

    renderOptimizedGif(renderGif: () => ReactNode) {
        return optimizeNode(renderGif());
    },

    preloadGifList<T extends readonly GifData[] | undefined>(gifs: T): T {
        if (!settings.store.preloadAllInBackground || !Array.isArray(gifs)) return gifs;

        let preloaded = 0;
        const limit = getBackgroundPreloadLimit();

        for (const gif of gifs) {
            const src = getGifSrc(gif);
            if (!src) continue;

            if (limit > 0 && preloaded >= limit) {
                bumpStat("preloadLimitSkips");
                continue;
            }

            if (queueBackgroundPreload(getPreloadSrc(src))) preloaded++;
        }

        return gifs;
    }
});

function StatsPanel() {
    const [open, setOpen] = useState(false);
    const [snapshot, setSnapshot] = useState(getStatsSnapshot);

    useEffect(() => {
        if (!open) return;

        const interval = setInterval(() => setSnapshot(getStatsSnapshot()), STATS_REFRESH_MS);
        return () => clearInterval(interval);
    }, [open]);

    return (
        <Card variant="primary">
            <Flex flexDirection="column" gap="12px">
                <Flex justifyContent="space-between" alignItems="center" gap="12px">
                    <BaseText size="md" weight="semibold">FastGifPicker stats</BaseText>
                    <Flex gap="8px" alignItems="center">
                        {open && (
                            <Button
                                size="small"
                                variant="secondary"
                                onClick={() => {
                                    resetStats();
                                    setSnapshot(getStatsSnapshot());
                                }}
                            >
                                Reset stats
                            </Button>
                        )}
                        <Button
                            size="small"
                            variant="secondary"
                            onClick={() => {
                                setSnapshot(getStatsSnapshot());
                                setOpen(value => !value);
                            }}
                        >
                            {open ? "Hide stats" : "Show stats"}
                        </Button>
                    </Flex>
                </Flex>
                {open && (
                    <Flex flexWrap="wrap" gap="8px">
                        {statItems.map(({ label, value }) => (
                            <div
                                key={value}
                                style={{
                                    background: "var(--background-secondary)",
                                    borderRadius: 8,
                                    minWidth: 132,
                                    padding: "8px 10px"
                                }}
                            >
                                <BaseText size="xs" color="text-muted">{label}</BaseText>
                                <BaseText size="lg" weight="semibold" tabularNumbers>{snapshot[value]}</BaseText>
                            </div>
                        ))}
                    </Flex>
                )}
            </Flex>
        </Card>
    );
}

function optimizeNode(node: ReactNode): ReactNode {
    if (!isReactElement(node)) return node;

    const props = node.props as GifImageProps;
    const { children, src } = props;

    if (typeof src === "string" && shouldOptimizeSrc(src)) {
        return <SafeOptimizedGifImage key={node.key ?? undefined} element={node} />;
    }

    if (children == null) return node;

    if (Array.isArray(children)) {
        let changed = false;
        const nextChildren = children.map(child => {
            const nextChild = optimizeNode(child);
            changed ||= nextChild !== child;
            return nextChild;
        });

        if (!changed) return node;
        return createElement(node, Object.assign({}, props, { children: nextChildren }));
    }

    const nextChild = optimizeNode(children);
    if (nextChild === children) return node;

    return createElement(node, Object.assign({}, props, { children: nextChild }));
}

function OptimizedGifImage({ element }: { element: GifReactElement; }) {
    const props = element.props as GifImageProps;
    const { onError, onLoad, onMouseEnter, onMouseLeave, src } = props;
    const originalSrc = typeof src === "string" ? src : "";
    const imageSettings = settings.use(GIF_IMAGE_SETTING_KEYS);
    const previewMode = imageSettings.previewMode as PreviewMode;
    const hoverMode = previewMode === "hover";
    const [canLoad, setCanLoad] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [hovered, setHovered] = useState(false);
    const [useOriginal, setUseOriginal] = useState(false);
    const releaseRef = useRef<(() => void) | undefined>(undefined);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const effectivePreviewMode = hoverMode && !hovered ? "static" : hoverMode ? "webp" : previewMode;

    const baseSrc = useMemo(
        () => useOriginal ? originalSrc : getPreviewSrc(originalSrc, effectivePreviewMode),
        [originalSrc, useOriginal, effectivePreviewMode]
    );
    const imageSrc = canLoad ? getRetrySrc(baseSrc, attempt) : TRANSPARENT_IMAGE_SRC;

    useEffect(() => {
        if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = undefined;
        }

        recordSeenPreview(originalSrc);
        setAttempt(0);
        setUseOriginal(false);
    }, [originalSrc]);

    useEffect(() => {
        setCanLoad(false);

        if (imageSettings.rememberLoadedPreviews && loadedPreviewUrls.has(baseSrc)) {
            bumpStat("cacheHits");
            setCanLoad(true);
            return;
        }

        let timeout: ReturnType<typeof setTimeout> | undefined;
        const startVisibleLoad = () => {
            releaseLoadSlot(releaseRef);
            releaseRef.current = acquireLoadSlot(() => {
                setCanLoad(true);
                timeout = setTimeout(() => releaseLoadSlot(releaseRef), LOAD_SLOT_TIMEOUT_MS);
            });
        };
        let unsubscribe: (() => void) | undefined;

        if (imageSettings.preloadAllInBackground && !useOriginal && attempt === 0) {
            unsubscribe = subscribePreviewLoad(baseSrc, loaded => {
                if (loaded) {
                    setCanLoad(true);
                    return;
                }

                startVisibleLoad();
            });
            queueBackgroundPreload(baseSrc);
        } else {
            startVisibleLoad();
        }

        return () => {
            unsubscribe?.();
            if (retryTimerRef.current) {
                clearTimeout(retryTimerRef.current);
                retryTimerRef.current = undefined;
            }
            if (timeout) clearTimeout(timeout);
            releaseLoadSlot(releaseRef);
        };
    }, [baseSrc, attempt, useOriginal, imageSettings.preloadAllInBackground, imageSettings.rememberLoadedPreviews]);

    const nextProps = Object.assign({}, props, {
        decoding: props.decoding ?? "async",
        loading: props.loading ?? "lazy",
        onError: (event: SyntheticEvent<HTMLElement>) => {
            if (imageSrc === TRANSPARENT_IMAGE_SRC) return;

            releaseLoadSlot(releaseRef);

            if (attempt < getRetryCount()) {
                bumpStat("retryAttempts");
                if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
                retryTimerRef.current = setTimeout(() => {
                    retryTimerRef.current = undefined;
                    setAttempt(value => value + 1);
                }, RETRY_DELAY_MS);
                return;
            }

            if (!useOriginal && baseSrc !== originalSrc) {
                bumpStat("originalFallbacks");
                setUseOriginal(true);
                setAttempt(0);
                return;
            }

            onError?.(event);
        },
        onLoad: (event: SyntheticEvent<HTMLElement>) => {
            if (imageSrc === TRANSPARENT_IMAGE_SRC) return;

            if (retryTimerRef.current) {
                clearTimeout(retryTimerRef.current);
                retryTimerRef.current = undefined;
            }

            bumpStat("loadedPreviews");
            rememberLoadedUrl(baseSrc);
            releaseLoadSlot(releaseRef);
            onLoad?.(event);
        },
        onMouseEnter: (event: SyntheticEvent<HTMLElement>) => {
            if (hoverMode && !hovered) {
                bumpStat("hoverLoads");
                setHovered(true);
            }

            onMouseEnter?.(event);
        },
        onMouseLeave: (event: SyntheticEvent<HTMLElement>) => {
            if (hoverMode) setHovered(false);
            onMouseLeave?.(event);
        },
        src: imageSrc
    });

    return createElement(element, nextProps);
}

const SafeOptimizedGifImage = ErrorBoundary.wrap(OptimizedGifImage, { noop: true });

function createElement(element: GifReactElement, props: Record<string, unknown>) {
    const nextProps = Object.assign({}, props);

    if (element.key != null) {
        nextProps.key = element.key;
    }

    if (element.ref != null) {
        nextProps.ref = element.ref;
    }

    return React.createElement(element.type as ElementType, nextProps);
}

function isReactElement(node: ReactNode): node is GifReactElement {
    return node != null && typeof node === "object" && "props" in node && "type" in node;
}

function acquireLoadSlot(onReady: () => void) {
    const entry: LoadQueueEntry = {
        active: false,
        cancelled: false,
        start: () => {
            if (entry.cancelled) {
                pumpLoadQueue();
                return;
            }

            entry.active = true;
            activeLoads++;
            onReady();
        }
    };

    if (activeLoads < getMaxConcurrentLoads()) {
        entry.start();
    } else {
        loadQueue.push(entry);
    }

    return () => releaseQueueEntry(entry);
}

function releaseQueueEntry(entry: LoadQueueEntry) {
    if (entry.cancelled) return;

    entry.cancelled = true;

    if (!entry.active) {
        const index = loadQueue.indexOf(entry);
        if (index !== -1) loadQueue.splice(index, 1);
        return;
    }

    entry.active = false;
    activeLoads = Math.max(0, activeLoads - 1);
    pumpLoadQueue();
}

function releaseLoadSlot(releaseRef: MutableRefObject<(() => void) | undefined>) {
    releaseRef.current?.();
    releaseRef.current = undefined;
}

function pumpLoadQueue() {
    while (activeLoads < getMaxConcurrentLoads()) {
        const entry = loadQueue.shift();
        if (!entry) return;
        if (!entry.cancelled) entry.start();
    }
}

function getMaxConcurrentLoads() {
    return settings.store.maxConcurrentLoads ?? DEFAULT_CONCURRENT_LOADS;
}

function getMaxBackgroundPreloads() {
    return settings.store.backgroundPreloadConcurrency ?? DEFAULT_BACKGROUND_PRELOADS;
}

function getBackgroundPreloadLimit() {
    return settings.store.backgroundPreloadLimit ?? DEFAULT_BACKGROUND_PRELOAD_LIMIT;
}

function getRetryCount() {
    return settings.store.retryCount ?? DEFAULT_RETRY_COUNT;
}

function scheduleFavoritePreload() {
    if (favoritePreloadTimer) {
        clearTimeout(favoritePreloadTimer);
        favoritePreloadTimer = undefined;
    }

    if (!settings.store.preloadFavoritesOnStart) return;

    favoritePreloadTimer = setTimeout(() => {
        favoritePreloadTimer = undefined;
        preloadFavoriteGifs();
    }, 1000);
}

function preloadFavoriteGifs() {
    if (!settings.store.preloadFavoritesOnStart) return;

    let preloaded = 0;
    const limit = getBackgroundPreloadLimit();

    for (const src of getFavoriteGifUrls()) {
        if (limit > 0 && preloaded >= limit) {
            bumpStat("preloadLimitSkips");
            continue;
        }

        if (queueBackgroundPreload(getPreloadSrc(src), true)) preloaded++;
    }
}

function getFavoriteGifUrls() {
    try {
        const actions: unknown = UserSettingsActionCreators.FrecencyUserSettingsActionCreators;
        if (!actions || typeof actions !== "object" || !("getCurrentValue" in actions)) return [];

        const { getCurrentValue } = actions as { getCurrentValue?: unknown; };
        if (typeof getCurrentValue !== "function") return [];

        const currentValue: unknown = getCurrentValue();
        if (!currentValue || typeof currentValue !== "object" || !("favoriteGifs" in currentValue)) return [];

        const { favoriteGifs } = currentValue as { favoriteGifs?: unknown; };
        if (!favoriteGifs || typeof favoriteGifs !== "object" || !("gifs" in favoriteGifs)) return [];

        const { gifs } = favoriteGifs as { gifs?: unknown; };
        if (!gifs || typeof gifs !== "object") return [];

        return Object.keys(gifs).filter(shouldOptimizeSrc);
    } catch (err) {
        logger.debug("Failed to read favorite GIFs.", err);
        return [];
    }
}

function rememberLoadedUrl(src: string) {
    if (!settings.store.rememberLoadedPreviews && !settings.store.preloadAllInBackground && !settings.store.preloadFavoritesOnStart) return;

    loadedPreviewUrls.add(src);

    const listeners = previewLoadListeners.get(src);
    if (listeners) {
        previewLoadListeners.delete(src);
        for (const listener of listeners) listener(true);
    }

    if (loadedPreviewUrls.size <= PREVIEW_CACHE_LIMIT) return;

    const oldest = loadedPreviewUrls.values().next().value;
    if (oldest) loadedPreviewUrls.delete(oldest);
}

function subscribePreviewLoad(src: string, listener: PreviewLoadListener) {
    if (loadedPreviewUrls.has(src)) {
        listener(true);
        return () => { };
    }

    const listeners = previewLoadListeners.get(src) ?? new Set();
    listeners.add(listener);
    previewLoadListeners.set(src, listeners);

    return () => {
        listeners.delete(listener);
        if (!listeners.size) previewLoadListeners.delete(src);
    };
}

function queueBackgroundPreload(src: string, force = false) {
    if ((!force && !settings.store.preloadAllInBackground) || loadedPreviewUrls.has(src) || backgroundPreloadQueued.has(src)) return false;

    bumpStat("backgroundQueued");
    backgroundPreloadQueued.add(src);
    backgroundPreloadQueue.push(src);
    pumpBackgroundPreloads();
    return true;
}

function pumpBackgroundPreloads() {
    while (activeBackgroundPreloads < getMaxBackgroundPreloads()) {
        const src = backgroundPreloadQueue.shift();
        if (!src) return;
        preloadImage(src);
    }
}

function preloadImage(src: string) {
    activeBackgroundPreloads++;

    const image = new Image();
    const finish = (loaded: boolean) => {
        const timeout = backgroundPreloadImages.get(image);
        if (timeout === undefined) return;

        clearTimeout(timeout);
        backgroundPreloadImages.delete(image);
        backgroundPreloadQueued.delete(src);
        activeBackgroundPreloads = Math.max(0, activeBackgroundPreloads - 1);

        if (loaded) {
            bumpStat("backgroundLoaded");
            rememberLoadedUrl(src);
        } else {
            bumpStat("backgroundFailed");
            const listeners = previewLoadListeners.get(src);
            if (listeners) {
                previewLoadListeners.delete(src);
                for (const listener of listeners) listener(false);
            }
        }

        pumpBackgroundPreloads();
    };

    image.decoding = "async";
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    backgroundPreloadImages.set(image, setTimeout(() => finish(false), BACKGROUND_PRELOAD_TIMEOUT_MS));
    image.src = src;
}

function cancelBackgroundPreloads() {
    for (const [image, timeout] of backgroundPreloadImages) {
        clearTimeout(timeout);
        image.onload = null;
        image.onerror = null;
        image.src = TRANSPARENT_IMAGE_SRC;
    }

    backgroundPreloadImages.clear();
    activeBackgroundPreloads = 0;
}

function getGifSrc(gif: GifData) {
    const src = typeof gif.src === "string" ? gif.src : typeof gif.url === "string" ? gif.url : undefined;
    return src && shouldOptimizeSrc(src) ? src : undefined;
}

function getPreloadSrc(src: string) {
    const mode = getPreviewMode();
    return getPreviewSrc(src, mode === "hover" ? "static" : mode);
}

function getPreviewSrc(src: string, mode = getPreviewMode()) {
    const cacheKey = `${mode}:${src}`;
    const cached = previewUrlCache.get(cacheKey);
    if (cached) return cached;

    const previewSrc = makePreviewSrc(src, mode);
    previewUrlCache.set(cacheKey, previewSrc);

    if (previewUrlCache.size > PREVIEW_CACHE_LIMIT) {
        const oldest = previewUrlCache.keys().next().value;
        if (oldest) previewUrlCache.delete(oldest);
    }

    return previewSrc;
}

function getPreviewMode(): PreviewMode {
    return (settings.store.previewMode as PreviewMode | undefined) ?? "webp";
}

function makePreviewSrc(src: string, mode: PreviewMode) {
    if (mode === "original") return src;

    try {
        const url = new URL(src);
        const still = mode === "static" || mode === "hover";
        const format = still ? "png" : "webp";

        if (isTenorHost(url.hostname) && url.pathname.toLowerCase().endsWith(".gif")) {
            url.pathname = url.pathname.replace(/\.gif$/i, `.${format}`);
            return url.toString();
        }

        if (!isDiscordMediaHost(url.hostname)) return src;

        url.searchParams.set("format", "webp");
        url.searchParams.set("animated", String(!still));
        return url.toString();
    } catch {
        return src;
    }
}

function getRetrySrc(src: string, attempt: number) {
    if (!attempt) return src;

    try {
        const url = new URL(src);
        url.searchParams.set(RETRY_PARAM, attempt.toString());
        return url.toString();
    } catch {
        return `${src}${src.includes("?") ? "&" : "?"}${RETRY_PARAM}=${attempt}`;
    }
}

function shouldOptimizeSrc(src: string) {
    if (src.startsWith("data:") || src.startsWith("blob:")) return false;

    try {
        const url = new URL(src);
        return url.pathname.toLowerCase().endsWith(".gif");
    } catch {
        return GIF_EXTENSION_RE.test(src);
    }
}

function isTenorHost(hostname: string) {
    return hostname === "tenor.com" || hostname.endsWith(".tenor.com");
}

function isDiscordMediaHost(hostname: string) {
    return getDiscordMediaHosts().has(hostname);
}

function getDiscordMediaHosts() {
    if (discordMediaHosts) return discordMediaHosts;

    const { CDN_HOST, IMAGE_PROXY_ENDPOINTS, MEDIA_PROXY_ENDPOINT } = window.GLOBAL_ENV;

    discordMediaHosts = new Set();
    addEndpointHost(discordMediaHosts, CDN_HOST);

    for (const endpoint of (IMAGE_PROXY_ENDPOINTS ?? "").split(",")) {
        addEndpointHost(discordMediaHosts, endpoint);
    }

    addEndpointHost(discordMediaHosts, MEDIA_PROXY_ENDPOINT);
    return discordMediaHosts;
}

function addEndpointHost(hosts: Set<string>, endpoint: string) {
    if (!endpoint) return;

    try {
        const url = new URL(endpoint.includes("://") ? endpoint : `https://${endpoint.replace(/^\/\//, "")}`);
        hosts.add(url.hostname);
    } catch {
        return;
    }
}
