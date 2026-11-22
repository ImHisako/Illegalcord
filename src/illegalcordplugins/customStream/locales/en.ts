/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { pluralEn } from "./plural";

const images = (count: number) => `${count} ${pluralEn(count, "image", "images")}`;

export const en = {
    pluginDescription: "Replace your stream preview with your own images, with profiles and a slideshow. GitHub https://github.com/MrTopQ/customStream-Vencord",

    settingLanguage: "Language of the plugin. Auto follows the language of Discord",
    settingLanguageAuto: "Auto (follow Discord)",
    settingReplace: "Send your own image as the stream preview instead of a frame of your screen",
    settingSlideshow: "Switch to the next image every time Discord updates the preview (every 5 minutes)",
    settingRandom: "Random order without repeats. No image comes back until all of them were shown",
    settingPanelButton: "Show the button next to your avatar in the account panel. If it vanished after a Discord update, the patch broke, update the plugin from https://github.com/MrTopQ/customStream-Vencord",
    settingHotkey: "Hotkey that opens and closes the gallery, e.g. Alt+1 or Ctrl+Shift+S",

    contextMenuItem: "Change Stream Preview",
    toolboxOpen: "Stream preview gallery",
    panelAria: "Stream preview",

    modalTitle: "Stream preview",
    modalSubtitle: "What people see before they join your stream",
    done: "Done",
    storedLocally: "Images are stored on this PC only.",
    storageFailed: "Storage failed to load, changes are not saved.",
    hotkeyOpens: (key: string) => `${key} opens this window.`,
    dropToAdd: (profile: string) => `Drop to add to ${profile}`,
    profileFull: (profile: string, max: number) => `"${profile}" already has ${max} images`,
    onlyImages: "Only PNG, JPEG and WebP files up to 8 MB or a ZIP with them can be added",
    zipNoImages: "The archive has no PNG, JPEG or WebP images",
    zipReadFailed: "Could not open the archive",
    exportFailed: "Could not build the archive",
    moreActions: "More",
    healthOk: "Everything works",
    healthPartial: (broken: number, total: number) => `${broken} of ${total} parts broken`,
    healthBroken: "Preview swap is broken",
    healthAlert: "A Discord update broke the image swap, so viewers will see your screen. Update the plugin.",
    healthPart: {
        thumbnail: "Swapping the preview image",
        upload: "Swapping the uploaded image",
        frame: "Previews while the window is minimized",
        pauseGate: "Previews while the stream is paused",
        settle: "Sent status and timer",
        failure: "Failed upload status",
        streamDelete: "Other streams ending",
        panel: "Button in the account panel"
    },
    shuffleAll: "Shuffle all",
    shuffleTitle: (profile: string) => `Shuffle all images in "${profile}"?`,
    shuffleBody: "The order changes at random. The selected image stays selected.",
    shuffleConfirm: "Shuffle",
    shuffled: "Order shuffled",
    exportZip: "Download as ZIP",
    importZip: "Add from ZIP",
    added: (count: number, skipped: number, over: number) => {
        const notes = [skipped && `${skipped} skipped`, over && `${over} over the limit`].filter(Boolean).join(", ");
        return `Added ${images(count)}${notes ? ` (${notes})` : ""}`;
    },
    readFailed: "Could not read one of the files",

    howItWorks: "Discord uploads the preview when you go live and then every 5 minutes. Anyone who hovers over your stream or opens your voice channel gets the latest upload, though their copy can be up to 2 minutes old.",
    notLive: "Not live",
    live: "Live",
    livePreviewOff: "Live, preview off",
    streamPaused: "Stream paused",
    uploadFailed: "Upload failed",
    offlineReplaceOff: "Replacement is off, so viewers will see a frame of your screen.",
    offlineNoImages: "Add an image and it becomes your stream preview.",
    offlineFirst: (label: string) => `When you go live, Discord sends ${label} in the first few seconds.`,
    previewOffDetail: "Stream previews are turned off for this stream, so Discord sends nothing.",
    viewersSee: (label: string) => `Viewers see ${label}`,
    viewersSeeScreen: "Viewers see your screen",
    pausedDetail: (seen: string | null) => `The streamed window is minimized or hidden, so Discord has no frame to send.${seen ? ` ${seen}.` : ""}`,
    failedNoPreview: (retryIn: string | null, rateLimited: boolean) =>
        `Viewers see no preview yet${rateLimited ? ", Discord's rate limit kicked in" : ""}. Discord retries ${retryIn ? `in ${retryIn}` : "any moment now"}.`,
    retryNote: (retryIn: string | null, rateLimited: boolean) =>
        `${rateLimited ? "A repeat upload hit Discord's rate limit" : "The last upload failed"}, next try ${retryIn ? `in ${retryIn}` : "any moment now"}.`,
    sending: (label: string | null) => (label ? `Sending ${label}…` : "Sending the first preview…"),
    connecting: "The stream is connecting, the preview goes out right after.",
    nextUpdate: (inTime: string | null, upcoming: string | null) =>
        `Next update ${inTime ? `in ${inTime}` : "any moment now"}${upcoming ? `, ${upcoming} goes next` : ""}.`,
    nextUpdateUnknown: (upcoming: string | null) => `Next update within 5 minutes${upcoming ? `, ${upcoming} goes next` : ""}.`,
    sentDetail: (ago: string, next: string) => `Sent ${ago} ago. ${next}`,
    deletedImage: "an image you deleted",
    imageFromProfile: (label: string, profile: string) => `${label} from ${profile}`,

    captionViewersSee: "Viewers see",
    captionGoesFirst: "Goes out first",
    captionSending: "Sending now",
    yourScreen: "Your screen",
    liveBadge: "Live",

    useMyImages: "Use my images",
    noteReplaceOn: "Viewers never see your screen",
    noteReplaceOff: "Viewers see a frame of your screen",
    slideshow: "Slideshow",
    noteSlideshowOn: "A new image every 5 minutes",
    noteSlideshowOff: "The same image every time",
    order: "Order",
    noteShuffle: "No repeats until all are shown",
    noteInOrder: "Left to right, then again",
    inOrder: "In order",
    shuffle: "Random",
    orderAria: "Slideshow order",

    profilesAria: "Profiles",
    profileNamePlaceholder: "Profile name",
    profileLimit: (max: number) => `You can have up to ${max} profiles`,
    newProfile: "New profile",
    doubleClickRename: "Double-click to rename, drag to move",
    renameProfile: (profile: string) => `Rename "${profile}"`,
    deleteProfileButton: (profile: string) => `Delete "${profile}"`,
    deleteProfileTitle: (profile: string) => `Delete "${profile}"?`,
    deleteProfileMain: "The main profile can't be deleted",
    deleteProfileNotEmpty: "To delete this profile, remove all its images first",
    deleteProfileBody: "The profile is empty, nothing else is removed.",
    delete: "Delete",
    cancel: "Cancel",

    imageAria: (n: number) => `Image ${n}`,
    tagLive: "Live",
    tagNext: "Next",
    tagSending: "Sending",
    tagSelected: "Selected",
    select: "Select",
    deselect: "Deselect",
    view: "View",
    download: (size: string) => `Download (${size})`,
    selectedCount: (count: number) => `${count} selected`,
    deleteImagesTitle: (count: number) => `Delete ${images(count)}?`,
    deleteImagesBody: "They are removed from this PC and cannot be restored.",
    deleteAll: "Delete all",
    deleteAllTitle: (profile: string) => `Delete all images in "${profile}"?`,
    deleteAllBody: (count: number) => `${images(count)} will be removed from this PC and cannot be restored.`,
    countOf: "of",
    hintSendNext: "Click to send next, drag to reorder",
    hintUse: "Click to use it, drag to reorder",
    adding: "Adding…",
    addImages: "Add images",
    emptyTitle: "Add your first image",
    emptyNote: "PNG, JPEG, WebP or a ZIP with them. You can also drop files here or paste with Ctrl+V.",

    lightboxAria: (n: number, total: number) => `Image ${n} of ${total}`,
    close: "Close",
    previous: "Previous",
    next: "Next"
};

export type Messages = typeof en;
