/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2024 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { ImageIcon } from "@components/Icons";
import { Alerts } from "@webpack/common";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { Button, Menu, React, showToast, Text, Toasts, UserStore, useState, useEffect, useRef } from "@webpack/common";

// Компонент кнопки в панели
const PanelButton = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");

const DATASTORE_KEY = "CustomStreamTopQ_ImageData";
const DATASTORE_KEY_SLIDESHOW = "CustomStreamTopQ_Slideshow";
const DATASTORE_KEY_INDEX = "CustomStreamTopQ_SlideIndex";
const DATASTORE_KEY_PROFILES = "CustomStreamTopQ_Profiles";
const DATASTORE_KEY_ACTIVE_PROFILE = "CustomStreamTopQ_ActiveProfile";
const MAX_IMAGES = 50;
const MAX_IMAGES_PER_PROFILE = 50;
const MAX_PROFILES = 5;  // Maximum number of profiles allowed
const DEFAULT_PROFILE_ID = "default";

// Структура профиля
interface Profile {
    id: string;
    name: string;
    images: Blob[];
    dataUris: string[];
    currentIndex: number;
}

// Кэш для профилей
let profiles: Map<string, Profile> = new Map();
let activeProfileId: string = DEFAULT_PROFILE_ID;

// Кэш для изображений в памяти (для обратной совместимости)
let cachedImages: Blob[] = [];
let cachedDataUris: string[] = [];
let currentSlideIndex = 0;
let lastSlideChangeTime = 0; // Время последней смены слайда (timestamp)
let isStreamActive = false; // Активен ли стрим сейчас
let manualSlideChange = false; // Флаг ручной смены картинки через модалку
let actualStreamImageUri: string | null = null; // Реальная картинка которая СЕЙЧАС на стриме (обновляется только Discord'ом)

// Получить активный профиль
function getActiveProfile(): Profile {
    let profile = profiles.get(activeProfileId);
    if (!profile) {
        profile = {
            id: DEFAULT_PROFILE_ID,
            name: "Default",
            images: [],
            dataUris: [],
            currentIndex: 0
        };
        profiles.set(DEFAULT_PROFILE_ID, profile);
    }
    return profile;
}

// Синхронизировать кэш с активным профилем
function syncCacheWithActiveProfile() {
    const profile = getActiveProfile();
    cachedImages = profile.images;
    cachedDataUris = profile.dataUris;
    currentSlideIndex = profile.currentIndex;
}

// Слушатели для обновления UI
const imageChangeListeners = new Set<() => void>();

function notifyImageChange() {
    imageChangeListeners.forEach(listener => listener());
}

const settings = definePluginSettings({
    replaceEnabled: {
        type: OptionType.BOOLEAN,
        description: "Use custom preview instead of screen capture",
        default: true
    },
    slideshowEnabled: {
        type: OptionType.BOOLEAN,
        description: "Slideshow mode (switch images automatically when Discord requests update ~5 min)",
        default: false
    },
    slideshowRandom: {
        type: OptionType.BOOLEAN,
        description: "Random slide order",
        default: false
    },
    showInfoBadges: {
        type: OptionType.BOOLEAN,
        description: "Show info badges in modal (count, selected, timer)",
        default: true
    }
});

// Структура данных для хранения
interface StoredImageData {
    type: string;
    data: number[];
}

interface SlideshowData {
    images: StoredImageData[];
}

interface StoredProfile {
    id: string;
    name: string;
    images: StoredImageData[];
    currentIndex: number;
}

interface StoredProfilesData {
    profiles: StoredProfile[];
    activeProfileId: string;
}

// Функции для работы с профилями
async function saveProfilesToDataStore(): Promise<void> {
    const storedProfiles: StoredProfile[] = [];

    for (const [, profile] of profiles) {
        const images: StoredImageData[] = [];
        for (const blob of profile.images) {
            const arrayBuffer = await blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            images.push({
                type: blob.type,
                data: Array.from(uint8Array)
            });
        }
        storedProfiles.push({
            id: profile.id,
            name: profile.name,
            images,
            currentIndex: profile.currentIndex
        });
    }

    await DataStore.set(DATASTORE_KEY_PROFILES, {
        profiles: storedProfiles,
        activeProfileId
    });

    syncCacheWithActiveProfile();
    notifyImageChange();
}

async function loadProfilesFromDataStore(): Promise<void> {
    try {
        const data: StoredProfilesData | undefined = await DataStore.get(DATASTORE_KEY_PROFILES);

        if (data?.profiles?.length) {
            profiles.clear();
            for (const stored of data.profiles) {
                const blobs: Blob[] = [];
                const dataUris: string[] = [];

                for (const img of stored.images) {
                    const uint8Array = new Uint8Array(img.data);
                    const blob = new Blob([uint8Array], { type: img.type });
                    blobs.push(blob);
                    dataUris.push(await blobToDataUrl(blob));
                }

                profiles.set(stored.id, {
                    id: stored.id,
                    name: stored.name,
                    images: blobs,
                    dataUris,
                    currentIndex: stored.currentIndex
                });
            }
            activeProfileId = data.activeProfileId || DEFAULT_PROFILE_ID;
        } else {
            // Миграция со старого формата
            const oldData: SlideshowData | undefined = await DataStore.get(DATASTORE_KEY_SLIDESHOW);
            if (oldData?.images?.length) {
                const blobs: Blob[] = [];
                const dataUris: string[] = [];

                for (const img of oldData.images) {
                    const uint8Array = new Uint8Array(img.data);
                    const blob = new Blob([uint8Array], { type: img.type });
                    blobs.push(blob);
                    dataUris.push(await blobToDataUrl(blob));
                }

                const oldIndex = await loadSlideIndex();
                profiles.set(DEFAULT_PROFILE_ID, {
                    id: DEFAULT_PROFILE_ID,
                    name: "Default",
                    images: blobs,
                    dataUris,
                    currentIndex: oldIndex
                });
                activeProfileId = DEFAULT_PROFILE_ID;

                // Сохраняем в новом формате и удаляем старые данные
                await saveProfilesToDataStore();
                await DataStore.del(DATASTORE_KEY_SLIDESHOW);
                await DataStore.del(DATASTORE_KEY_INDEX);
                await DataStore.del(DATASTORE_KEY);
            } else {
                // Создаём дефолтный профиль
                profiles.set(DEFAULT_PROFILE_ID, {
                    id: DEFAULT_PROFILE_ID,
                    name: "Default",
                    images: [],
                    dataUris: [],
                    currentIndex: 0
                });
                activeProfileId = DEFAULT_PROFILE_ID;
            }
        }

        syncCacheWithActiveProfile();
    } catch (error) {
        console.error("[CustomStreamTopQ] Error loading profiles:", error);
        profiles.set(DEFAULT_PROFILE_ID, {
            id: DEFAULT_PROFILE_ID,
            name: "Default",
            images: [],
            dataUris: [],
            currentIndex: 0
        });
        activeProfileId = DEFAULT_PROFILE_ID;
    }
}

function createProfile(name: string): Profile | null {
    // Check profile limit
    if (profiles.size >= MAX_PROFILES) {
        return null;
    }
    const id = `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const profile: Profile = {
        id,
        name,
        images: [],
        dataUris: [],
        currentIndex: 0
    };
    profiles.set(id, profile);
    return profile;
}

function deleteProfile(profileId: string): boolean {
    const profile = profiles.get(profileId);
    if (!profile) return false;
    if (profile.images.length > 0) return false; // Нельзя удалить профиль с фото
    if (profileId === DEFAULT_PROFILE_ID) return false; // Нельзя удалить дефолтный

    profiles.delete(profileId);
    if (activeProfileId === profileId) {
        activeProfileId = DEFAULT_PROFILE_ID;
        syncCacheWithActiveProfile();
    }
    return true;
}

function renameProfile(profileId: string, newName: string): boolean {
    const profile = profiles.get(profileId);
    if (!profile) return false;
    profile.name = newName;
    return true;
}

function setActiveProfile(profileId: string): boolean {
    if (!profiles.has(profileId)) return false;
    activeProfileId = profileId;
    syncCacheWithActiveProfile();
    notifyImageChange();
    return true;
}

function getProfileList(): Profile[] {
    return Array.from(profiles.values());
}

// Функции для работы с DataStore (обновлённые для работы с профилями)
async function saveSlideIndex(index: number): Promise<void> {
    const profile = getActiveProfile();
    profile.currentIndex = index;
    currentSlideIndex = index;
    await saveProfilesToDataStore();
}

async function loadSlideIndex(): Promise<number> {
    const index = await DataStore.get(DATASTORE_KEY_INDEX);
    return typeof index === "number" ? index : 0;
}

async function saveImagesToDataStore(blobs: Blob[]): Promise<void> {
    const profile = getActiveProfile();
    profile.images = blobs;

    // Обновляем dataUris
    profile.dataUris = [];
    for (const blob of blobs) {
        profile.dataUris.push(await blobToDataUrl(blob));
    }

    syncCacheWithActiveProfile();
    await saveProfilesToDataStore();
}

// loadImagesFromDataStore удалена - теперь используется getActiveProfile().images напрямую

async function deleteAllImages(): Promise<void> {
    const profile = getActiveProfile();
    profile.images = [];
    profile.dataUris = [];
    profile.currentIndex = 0;
    syncCacheWithActiveProfile();
    await saveProfilesToDataStore();
}

async function deleteImageAtIndex(index: number): Promise<void> {
    const profile = getActiveProfile();
    if (index < 0 || index >= profile.images.length) return;

    profile.images.splice(index, 1);
    profile.dataUris.splice(index, 1);

    if (profile.currentIndex >= profile.images.length) {
        profile.currentIndex = 0;
    }

    syncCacheWithActiveProfile();
    await saveProfilesToDataStore();
}

async function moveImage(fromIndex: number, toIndex: number): Promise<void> {
    const profile = getActiveProfile();
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= profile.images.length) return;
    if (toIndex < 0 || toIndex >= profile.images.length) return;

    // Простой swap 
    [profile.images[fromIndex], profile.images[toIndex]] = [profile.images[toIndex], profile.images[fromIndex]];
    [profile.dataUris[fromIndex], profile.dataUris[toIndex]] = [profile.dataUris[toIndex], profile.dataUris[fromIndex]];

    // Корректируем currentIndex если он был на одной из перемещаемых позиций
    if (profile.currentIndex === fromIndex) {
        profile.currentIndex = toIndex;
    } else if (profile.currentIndex === toIndex) {
        profile.currentIndex = fromIndex;
    }

    syncCacheWithActiveProfile();
    await saveProfilesToDataStore();
}

async function addImage(blob: Blob): Promise<void> {
    const profile = getActiveProfile();
    profile.images.push(blob);
    profile.dataUris.push(await blobToDataUrl(blob));
    syncCacheWithActiveProfile();
    await saveProfilesToDataStore();
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// Удалена неиспользуемая функция prepareCachedDataUris

function getImageCount(): number {
    return cachedImages.length;
}

// Конвертация изображения в JPEG и масштабирование до 1280x720
async function processImage(blob: Blob): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);

        img.onload = () => {
            URL.revokeObjectURL(url);

            const targetWidth = 1280;
            const targetHeight = 720;

            // Создаём canvas для конвертации и масштабирования
            const canvas = document.createElement("canvas");
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext("2d")!;

            // Заливаем чёрным фоном (на случай прозрачности)
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, targetWidth, targetHeight);

            // Вычисляем размеры для сохранения пропорций (cover)
            const scale = Math.max(targetWidth / img.width, targetHeight / img.height);
            const scaledWidth = img.width * scale;
            const scaledHeight = img.height * scale;
            const x = (targetWidth - scaledWidth) / 2;
            const y = (targetHeight - scaledHeight) / 2;

            ctx.drawImage(img, x, y, scaledWidth, scaledHeight);

            // Discord использует JPEG для превью стримов
            // Качество 0.7 для уменьшения размера (Discord ограничивает ~100KB)
            canvas.toBlob((newBlob) => {
                if (newBlob) {
                    resolve(newBlob);
                } else {
                    reject(new Error("Failed to convert image"));
                }
            }, "image/jpeg", 0.7);
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Failed to load image"));
        };

        img.src = url;
    });
}

function ImagePickerModal({ rootProps }: { rootProps: any; }) {
    // Сохраняем исходные значения для отката
    const initialSettingsRef = useRef({
        enabled: settings.store.replaceEnabled,
        slideshowEnabled: settings.store.slideshowEnabled,
        slideshowRandom: settings.store.slideshowRandom,
        slideIndex: currentSlideIndex,
        activeProfileId: activeProfileId
    });
    const savedRef = useRef(false);

    const [images, setImages] = useState<string[]>([]);
    const [imageSizes, setImageSizes] = useState<number[]>([]); // Размеры в байтах
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [pendingIndex, setPendingIndex] = useState(currentSlideIndex);
    const [pluginEnabled, setPluginEnabled] = useState(settings.store.replaceEnabled);
    const [slideshowOn, setSlideshowOn] = useState(settings.store.slideshowEnabled);
    const [randomOn, setRandomOn] = useState(settings.store.slideshowRandom);
    const [isDragging, setIsDragging] = useState(false);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [timerSeconds, setTimerSeconds] = useState(0);
    const [streamActive, setStreamActive] = useState(isStreamActive);
    const [previewImage, setPreviewImage] = useState<string | null>(null); // Для полноэкранного просмотра

    // Состояния для профилей
    const [profileList, setProfileList] = useState<Profile[]>(getProfileList());
    const [currentProfileId, setCurrentProfileId] = useState(activeProfileId);
    const [isCreatingProfile, setIsCreatingProfile] = useState(false);
    const [newProfileName, setNewProfileName] = useState("");
    const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
    const [editingProfileName, setEditingProfileName] = useState("");

    // Откат при закрытии без сохранения (ESC, клик вне окна, крестик)
    useEffect(() => {
        return () => {
            if (!savedRef.current) {
                // Откатываем настройки при закрытии без сохранения
                const init = initialSettingsRef.current;
                settings.store.replaceEnabled = init.enabled;
                settings.store.slideshowEnabled = init.slideshowEnabled;
                settings.store.slideshowRandom = init.slideshowRandom;
                currentSlideIndex = init.slideIndex;
                // Откатываем активный профиль
                setActiveProfile(init.activeProfileId);
            }
        };
    }, []);

    const loadImages = async () => {
        setIsLoading(true);
        const profile = profiles.get(currentProfileId) || getActiveProfile();
        const uris: string[] = [];
        const sizes: number[] = [];
        for (const blob of profile.images) {
            try {
                const uri = await blobToDataUrl(blob);
                uris.push(uri);
                sizes.push(blob.size); // Сохраняем размер в байтах
            } catch (e) {
                console.error("[CustomStreamTopQ] Error:", e);
            }
        }
        setImages(uris);
        setPendingIndex(profile.currentIndex);
        setImageSizes(sizes);
        setIsLoading(false);
    };

    useEffect(() => {
        loadImages();
    }, [currentProfileId]);

    // Таймер для обновления времени в модалке
    useEffect(() => {
        const timerInterval = setInterval(() => {
            // Автосброс: если прошло более 7 минут без вызова getCustomThumbnail - стрим остановлен
            if (isStreamActive && lastSlideChangeTime > 0 && (Date.now() - lastSlideChangeTime) > 420000) {
                isStreamActive = false;
            }
            setStreamActive(isStreamActive);
            if (lastSlideChangeTime > 0 && isStreamActive) {
                setTimerSeconds(Math.floor((Date.now() - lastSlideChangeTime) / 1000));
            }
        }, 1000);
        return () => clearInterval(timerInterval);
    }, []);

    // Переключение профиля
    const handleProfileSwitch = async (profileId: string) => {
        setActiveProfile(profileId);
        setCurrentProfileId(profileId);
        const profile = profiles.get(profileId);
        if (profile) {
            setPendingIndex(profile.currentIndex);
        }
    };

    // Создание нового профиля
    const handleCreateProfile = async () => {
        if (!newProfileName.trim()) {
            setError("Enter profile name");
            return;
        }
        if (newProfileName.trim().length > 40) {
            setError("Profile name too long (max 40 characters)");
            return;
        }
        if (profiles.size >= MAX_PROFILES) {
            setError(`Maximum ${MAX_PROFILES} profiles allowed`);
            return;
        }
        const profile = createProfile(newProfileName.trim());
        if (!profile) {
            setError(`Maximum ${MAX_PROFILES} profiles allowed`);
            return;
        }
        await saveProfilesToDataStore();
        setProfileList(getProfileList());
        setNewProfileName("");
        setIsCreatingProfile(false);
        handleProfileSwitch(profile.id);
        showToast(`Profile "${profile.name}" created`, Toasts.Type.SUCCESS);
    };

    // Удаление профиля
    const handleDeleteProfile = async (profileId: string) => {
        const profile = profiles.get(profileId);
        if (!profile) return;

        if (profile.images.length > 0) {
            setError("Delete all images first!");
            return;
        }

        if (profileId === DEFAULT_PROFILE_ID) {
            setError("Cannot delete default profile");
            return;
        }

        Alerts.show({
            title: `Delete profile "${profile.name}"?`,
            body: "This action cannot be undone.",
            confirmText: "Delete",
            cancelText: "Cancel",
            confirmColor: "red",
            onConfirm: async () => {
                deleteProfile(profileId);
                await saveProfilesToDataStore();
                setProfileList(getProfileList());
                if (currentProfileId === profileId) {
                    handleProfileSwitch(DEFAULT_PROFILE_ID);
                }
                showToast("Profile deleted", Toasts.Type.SUCCESS);
            }
        });
    };

    // Переименование профиля
    const handleRenameProfile = async (profileId: string) => {
        if (!editingProfileName.trim()) {
            setEditingProfileId(null);
            return;
        }
        if (editingProfileName.trim().length > 40) {
            setError("Profile name too long (max 40 characters)");
            return;
        }
        renameProfile(profileId, editingProfileName.trim());
        await saveProfilesToDataStore();
        setProfileList(getProfileList());
        setEditingProfileId(null);
        showToast("Profile renamed", Toasts.Type.SUCCESS);
    };

    // Обработка перетаскиваемых файлов
    const handleDroppedFiles = async (files: FileList | File[]) => {
        const profile = profiles.get(currentProfileId) || getActiveProfile();
        const remaining = MAX_IMAGES_PER_PROFILE - profile.images.length;
        if (remaining <= 0) {
            setError(`Limit of ${MAX_IMAGES_PER_PROFILE} images reached!`);
            return;
        }

        setIsLoading(true);
        setError("");

        try {
            let added = 0;
            for (const file of files) {
                if (added >= remaining) {
                    setError(`Added ${added}. Limit of ${MAX_IMAGES} reached!`);
                    break;
                }
                if (!file.type.startsWith("image/") || file.type === "image/gif") {
                    continue;
                }
                if (file.size > 8 * 1024 * 1024) {
                    continue;
                }

                const processedBlob = await processImage(file);
                await addImage(processedBlob);
                added++;
            }

            await loadImages();
            if (added > 0) {
                showToast(`Added: ${added}`, Toasts.Type.SUCCESS);
            }
        } catch {
            setError("File processing error");
        }

        setIsLoading(false);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Показываем полоску только если это файлы извне, а не перетаскивание фото внутри
        if (draggedIndex === null && e.dataTransfer.types.includes("Files")) {
            setIsDragging(true);
        }
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Проверяем что действительно покинули область
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            setIsDragging(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            await handleDroppedFiles(files);
        }
    };

    const handleFileSelect = (multiple: boolean) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,image/jpeg,image/webp";
        input.multiple = multiple;
        input.onchange = async (e: any) => {
            const files = e.target.files;
            if (!files?.length) return;

            // Проверяем лимит для текущего профиля
            const profile = profiles.get(currentProfileId) || getActiveProfile();
            const remaining = MAX_IMAGES_PER_PROFILE - profile.images.length;
            if (remaining <= 0) {
                setError(`Limit of ${MAX_IMAGES_PER_PROFILE} images reached!`);
                return;
            }

            setIsLoading(true);
            setError("");

            try {
                let added = 0;
                for (const file of files) {
                    if (added >= remaining) {
                        setError(`Added ${added}. Limit of ${MAX_IMAGES_PER_PROFILE} reached!`);
                        break;
                    }
                    if (file.type === "image/gif" || file.type.startsWith("video/")) {
                        continue;
                    }
                    if (file.size > 8 * 1024 * 1024) {
                        continue;
                    }

                    const processedBlob = await processImage(file);
                    await addImage(processedBlob);
                    added++;
                }

                await loadImages();
                if (added > 0) {
                    showToast(`Added: ${added}`, Toasts.Type.SUCCESS);
                }
            } catch {
                setError("File processing error");
            }

            setIsLoading(false);
        };
        input.click();
    };

    const handleDelete = async (index: number) => {
        await deleteImageAtIndex(index);
        const profile = profiles.get(currentProfileId) || getActiveProfile();
        if (pendingIndex >= profile.images.length && profile.images.length > 0) {
            setPendingIndex(profile.images.length - 1);
        } else if (profile.images.length === 0) {
            setPendingIndex(0);
        }
        await loadImages();
        setProfileList(getProfileList()); // Обновляем список профилей для отображения количества
        showToast("Deleted", Toasts.Type.MESSAGE);
    };

    const handleClearAll = async () => {
        const profile = profiles.get(currentProfileId);
        if (!profile || profile.images.length === 0) return;

        Alerts.show({
            title: `Delete all images from "${profile.name}"?`,
            body: `Are you sure you want to delete all ${images.length} images? This action cannot be undone.`,
            confirmText: "Delete All",
            cancelText: "Cancel",
            confirmColor: "red",
            onConfirm: async () => {
                await deleteAllImages();
                setImages([]);
                setPendingIndex(0);
                setProfileList(getProfileList()); // Обновляем список профилей
                showToast("All deleted", Toasts.Type.MESSAGE);
            }
        });
    };

    const handleSelectCurrent = (index: number) => {
        setPendingIndex(index);
    };

    const togglePlugin = () => {
        setPluginEnabled(!pluginEnabled);
    };

    const toggleSlideshow = () => {
        setSlideshowOn(!slideshowOn);
    };

    const toggleRandom = () => {
        setRandomOn(!randomOn);
    };

    const handleSave = async () => {
        // Применяем все изменения
        settings.store.replaceEnabled = pluginEnabled;
        settings.store.slideshowEnabled = slideshowOn;
        settings.store.slideshowRandom = randomOn;

        // Проверяем была ли ручная смена картинки
        if (pendingIndex !== currentSlideIndex) {
            manualSlideChange = true; // Помечаем что была ручная смена
            // НЕ сбрасываем таймер при ручной смене!
        }

        currentSlideIndex = pendingIndex;
        await saveSlideIndex(pendingIndex); // Сохраняем индекс в DataStore
        savedRef.current = true; // Помечаем что сохранили
        notifyImageChange(); // Обновляем иконку в панели
        showToast("Settings saved!", Toasts.Type.SUCCESS);
        rootProps.onClose();
    };

    const handleCancel = () => {
        // saved остаётся false, откат произойдёт в useEffect при размонтировании
        rootProps.onClose();
    };

    // Drag & drop для изменения порядка
    const handleImageDragStart = (e: React.DragEvent, index: number) => {
        e.stopPropagation();
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", index.toString());
    };

    const handleImageDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.stopPropagation();
        if (draggedIndex !== null && draggedIndex !== index) {
            setDragOverIndex(index);
        }
    };

    const handleImageDragLeave = (e: React.DragEvent) => {
        e.stopPropagation();
        setDragOverIndex(null);
    };

    const handleImageDrop = async (e: React.DragEvent, toIndex: number) => {
        e.preventDefault();
        e.stopPropagation();

        if (draggedIndex !== null && draggedIndex !== toIndex) {
            // Корректируем pendingIndex при перемещении
            let newPendingIndex = pendingIndex;
            if (pendingIndex === draggedIndex) {
                newPendingIndex = toIndex;
            } else if (draggedIndex < pendingIndex && toIndex >= pendingIndex) {
                newPendingIndex--;
            } else if (draggedIndex > pendingIndex && toIndex <= pendingIndex) {
                newPendingIndex++;
            }

            await moveImage(draggedIndex, toIndex);
            setPendingIndex(newPendingIndex);
            await loadImages();
            showToast(`Moved: #${draggedIndex + 1} → #${toIndex + 1}`, Toasts.Type.SUCCESS);
        }

        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    const handleImageDragEnd = () => {
        setDraggedIndex(null);
        setDragOverIndex(null);
    };

    // Вычисляем следующий индекс
    const getNextIndex = () => {
        if (images.length <= 1 || !slideshowOn) return -1;
        if (randomOn) return -1;
        return (pendingIndex + 1) % images.length;
    };

    const nextIndex = getNextIndex();

    return (
        <ModalRoot {...rootProps} size={ModalSize.LARGE}>
            {/* Полноэкранный просмотр изображения */}
            {previewImage && (
                <div
                    onClick={() => setPreviewImage(null)}
                    style={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: "rgba(0, 0, 0, 0.95)",
                        zIndex: 10000,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "zoom-out",
                        padding: "40px"
                    }}
                >
                    <img
                        src={previewImage}
                        alt="Preview"
                        style={{
                            maxWidth: "100%",
                            maxHeight: "100%",
                            objectFit: "contain",
                            borderRadius: "8px",
                            boxShadow: "0 8px 32px rgba(0,0,0,0.5)"
                        }}
                    />
                    <div style={{
                        position: "absolute",
                        top: "20px",
                        right: "20px",
                        color: "white",
                        fontSize: "14px",
                        opacity: 0.7
                    }}>
                        Click to close
                    </div>
                    <div style={{
                        position: "absolute",
                        bottom: "20px",
                        left: "50%",
                        transform: "translateX(-50%)",
                        color: "white",
                        fontSize: "13px",
                        backgroundColor: "rgba(0,0,0,0.6)",
                        padding: "8px 16px",
                        borderRadius: "8px"
                    }}>
                        📐 1280×720 (16:9) — Stream preview size
                    </div>
                </div>
            )}

            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>
                    Stream Preview
                </Text>
                <ModalCloseButton onClick={handleCancel} />
            </ModalHeader>
            <ModalContent>
                <div
                    style={{ padding: "20px", position: "relative" }}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >

                    {/* Оверлей для drag & drop файлов - только верх до галереи */}
                    {isDragging && draggedIndex === null && (
                        <div
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            style={{
                                position: "absolute",
                                top: "8px",
                                left: "8px",
                                right: "8px",
                                bottom: "400px",
                                backgroundColor: "rgba(88, 101, 242, 0.95)",
                                borderRadius: "12px",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                zIndex: 1000,
                                border: "3px dashed rgba(255,255,255,0.5)",
                                pointerEvents: "auto",
                                backdropFilter: "blur(8px)"
                            }}>
                            <div style={{ fontSize: "48px", marginBottom: "12px" }}>📥</div>
                            <Text variant="heading-lg/bold" style={{ color: "white", marginBottom: "4px" }}>
                                Drop to upload
                            </Text>
                            <Text variant="text-sm/normal" style={{ color: "rgba(255,255,255,0.7)" }}>
                                Supports PNG, JPEG, WebP
                            </Text>
                        </div>
                    )}

                    {/* Главный переключатель */}
                    <div
                        onClick={togglePlugin}
                        style={{
                            padding: "14px 20px",
                            borderRadius: "10px",
                            marginBottom: "16px",
                            cursor: "pointer",
                            backgroundColor: pluginEnabled ? "rgba(59, 165, 92, 0.9)" : "rgba(237, 66, 69, 0.9)",
                            color: "white",
                            fontWeight: "600",
                            fontSize: "14px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "10px",
                            transition: "all 0.2s ease",
                            boxShadow: pluginEnabled
                                ? "0 4px 12px rgba(59, 165, 92, 0.3)"
                                : "0 4px 12px rgba(237, 66, 69, 0.3)"
                        }}
                    >
                        <span style={{ fontSize: "18px" }}>{pluginEnabled ? "✅" : "❌"}</span>
                        {pluginEnabled ? "REPLACEMENT ENABLED" : "REPLACEMENT DISABLED (default Discord)"}
                    </div>

                    {/* === ПРОФИЛИ / ВКЛАДКИ === */}
                    <div style={{
                        marginBottom: "16px",
                        backgroundColor: "var(--background-secondary)",
                        borderRadius: "12px",
                        padding: "16px",
                        border: "1px solid var(--background-modifier-accent)"
                    }}>
                        {/* Заголовок с кнопкой создания */}
                        <div style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginBottom: "14px",
                            paddingBottom: "12px",
                            borderBottom: "1px solid var(--background-modifier-accent)"
                        }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                <span style={{ fontSize: "20px" }}>📁</span>
                                <Text variant="text-md/semibold" style={{ color: "#ffffff" }}>
                                    Profiles
                                </Text>
                                <span style={{
                                    fontSize: "12px",
                                    fontWeight: "600",
                                    color: "#ffffff",
                                    backgroundColor: "var(--brand-experiment)",
                                    padding: "3px 10px",
                                    borderRadius: "12px"
                                }}>
                                    {profileList.length}/{MAX_PROFILES}
                                </span>
                            </div>
                            {!isCreatingProfile && profileList.length < MAX_PROFILES && (
                                <button
                                    onClick={() => setIsCreatingProfile(true)}
                                    style={{
                                        background: "linear-gradient(135deg, #5865F2 0%, #7289da 100%)",
                                        color: "white",
                                        border: "none",
                                        borderRadius: "8px",
                                        padding: "8px 14px",
                                        fontSize: "13px",
                                        fontWeight: "600",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "6px",
                                        transition: "all 0.2s ease",
                                        boxShadow: "0 2px 8px rgba(88, 101, 242, 0.3)"
                                    }}
                                    onMouseEnter={e => {
                                        (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
                                        (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(88, 101, 242, 0.4)";
                                    }}
                                    onMouseLeave={e => {
                                        (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                                        (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(88, 101, 242, 0.3)";
                                    }}
                                >
                                    <span style={{ fontSize: "14px" }}>+</span> New Profile
                                </button>
                            )}
                        </div>

                        {/* Форма создания профиля */}
                        {isCreatingProfile && (
                            <div style={{
                                display: "flex",
                                gap: "10px",
                                marginBottom: "14px",
                                padding: "14px",
                                backgroundColor: "var(--background-tertiary)",
                                borderRadius: "10px",
                                border: "1px solid rgba(88, 101, 242, 0.3)"
                            }}>
                                <input
                                    type="text"
                                    placeholder="Profile name..."
                                    value={newProfileName}
                                    onChange={e => setNewProfileName(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === "Enter") handleCreateProfile();
                                        if (e.key === "Escape") {
                                            setIsCreatingProfile(false);
                                            setNewProfileName("");
                                        }
                                    }}
                                    autoFocus
                                    style={{
                                        flex: 1,
                                        padding: "8px 12px",
                                        borderRadius: "6px",
                                        border: "1px solid var(--background-modifier-accent)",
                                        backgroundColor: "var(--background-secondary)",
                                        color: "#ffffff",
                                        fontSize: "14px",
                                        outline: "none"
                                    }}
                                />
                                <button
                                    onClick={handleCreateProfile}
                                    style={{
                                        backgroundColor: "rgba(59, 165, 92, 0.9)",
                                        color: "white",
                                        border: "none",
                                        borderRadius: "6px",
                                        padding: "8px 14px",
                                        fontSize: "13px",
                                        fontWeight: "600",
                                        cursor: "pointer"
                                    }}
                                >
                                    ✓
                                </button>
                                <button
                                    onClick={() => {
                                        setIsCreatingProfile(false);
                                        setNewProfileName("");
                                    }}
                                    style={{
                                        backgroundColor: "rgba(237, 66, 69, 0.9)",
                                        color: "white",
                                        border: "none",
                                        borderRadius: "6px",
                                        padding: "8px 14px",
                                        fontSize: "13px",
                                        fontWeight: "600",
                                        cursor: "pointer"
                                    }}
                                >
                                    ✕
                                </button>
                            </div>
                        )}

                        {/* Список вкладок профилей */}
                        <div style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "8px"
                        }}>
                            {profileList.map((profile: Profile) => {
                                const isActive = profile.id === currentProfileId;
                                const isEditing = editingProfileId === profile.id;
                                const canDelete = profile.id !== DEFAULT_PROFILE_ID && profile.images.length === 0;

                                return (
                                    <div
                                        key={profile.id}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "6px",
                                            padding: "8px 12px",
                                            borderRadius: "8px",
                                            backgroundColor: isActive 
                                                ? "#5865F2"
                                                : "var(--background-secondary-alt)",
                                            background: isActive 
                                                ? "linear-gradient(135deg, #5865F2 0%, #4752c4 100%)" 
                                                : "var(--background-secondary-alt)",
                                            color: "#ffffff",
                                            cursor: "pointer",
                                            transition: "all 0.2s ease",
                                            border: isActive 
                                                ? "2px solid #5865F2" 
                                                : "1px solid var(--background-modifier-accent)",
                                            boxShadow: isActive 
                                                ? "0 3px 10px rgba(88, 101, 242, 0.4)" 
                                                : "0 1px 4px rgba(0,0,0,0.1)",
                                            minWidth: "100px"
                                        }}
                                        onClick={() => !isEditing && handleProfileSwitch(profile.id)}
                                        onMouseEnter={e => {
                                            if (!isActive) {
                                                (e.currentTarget as HTMLElement).style.borderColor = "#5865F2";
                                                (e.currentTarget as HTMLElement).style.boxShadow = "0 3px 10px rgba(88, 101, 242, 0.25)";
                                                (e.currentTarget as HTMLElement).style.backgroundColor = "var(--background-tertiary)";
                                            }
                                        }}
                                        onMouseLeave={e => {
                                            if (!isActive) {
                                                (e.currentTarget as HTMLElement).style.borderColor = "var(--background-modifier-accent)";
                                                (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.1)";
                                                (e.currentTarget as HTMLElement).style.backgroundColor = "var(--background-secondary-alt)";
                                            }
                                        }}
                                    >
                                        {isEditing ? (
                                            <input
                                                type="text"
                                                value={editingProfileName}
                                                onChange={e => setEditingProfileName(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === "Enter") handleRenameProfile(profile.id);
                                                    if (e.key === "Escape") setEditingProfileId(null);
                                                }}
                                                onBlur={() => handleRenameProfile(profile.id)}
                                                autoFocus
                                                onClick={e => e.stopPropagation()}
                                                style={{
                                                    width: "80px",
                                                    padding: "4px 8px",
                                                    borderRadius: "4px",
                                                    border: "2px solid #5865F2",
                                                    backgroundColor: "var(--background-secondary)",
                                                    color: "#ffffff",
                                                    fontSize: "12px",
                                                    fontWeight: "600",
                                                    outline: "none"
                                                }}
                                            />
                                        ) : (
                                            <>
                                                {/* Иконка галочки для активного */}
                                                {isActive && (
                                                    <span style={{ 
                                                        fontSize: "12px",
                                                        fontWeight: "bold"
                                                    }}>✓</span>
                                                )}
                                                {/* Иконка папки для неактивных */}
                                                {!isActive && (
                                                    <span style={{ fontSize: "12px" }}>📁</span>
                                                )}
                                                <span style={{ 
                                                    fontWeight: "600", 
                                                    fontSize: "12px",
                                                    letterSpacing: "0.2px",
                                                    color: "#ffffff"
                                                }}>
                                                    {profile.name}
                                                </span>
                                                <span style={{
                                                    fontSize: "10px",
                                                    fontWeight: "700",
                                                    backgroundColor: isActive 
                                                        ? "rgba(255,255,255,0.25)" 
                                                        : "var(--brand-experiment)",
                                                    color: "#ffffff",
                                                    padding: "2px 6px",
                                                    borderRadius: "6px",
                                                    minWidth: "20px",
                                                    textAlign: "center"
                                                }}>
                                                    {profile.images.length}
                                                </span>
                                            </>
                                        )}

                                        {/* Кнопки действий для вкладки */}
                                        {isActive && !isEditing && (
                                            <div style={{ 
                                                display: "flex", 
                                                gap: "6px", 
                                                marginLeft: "6px",
                                                paddingLeft: "8px",
                                                borderLeft: "1px solid rgba(255,255,255,0.3)"
                                            }}>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setEditingProfileId(profile.id);
                                                        setEditingProfileName(profile.name);
                                                    }}
                                                    style={{
                                                        backgroundColor: "rgba(255,255,255,0.2)",
                                                        color: "white",
                                                        border: "none",
                                                        borderRadius: "6px",
                                                        width: "28px",
                                                        height: "28px",
                                                        cursor: "pointer",
                                                        fontSize: "13px",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        transition: "all 0.15s ease"
                                                    }}
                                                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.3)"}
                                                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.15)"}
                                                    title="Rename"
                                                >
                                                    ✏️
                                                </button>
                                                {canDelete && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDeleteProfile(profile.id);
                                                        }}
                                                        style={{
                                                            backgroundColor: "rgba(237, 66, 69, 0.9)",
                                                            color: "white",
                                                            border: "none",
                                                            borderRadius: "6px",
                                                            width: "28px",
                                                            height: "28px",
                                                            cursor: "pointer",
                                                            fontSize: "13px",
                                                            display: "flex",
                                                            alignItems: "center",
                                                            justifyContent: "center",
                                                            transition: "all 0.15s ease"
                                                        }}
                                                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(237, 66, 69, 1)"}
                                                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(237, 66, 69, 0.9)"}
                                                        title="Delete profile (only if empty)"
                                                    >
                                                        🗑️
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Подсказка */}
                        <div style={{
                            marginTop: "14px",
                            paddingTop: "12px",
                            borderTop: "1px solid var(--background-modifier-accent)",
                            fontSize: "12px",
                            color: "var(--text-muted)",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px"
                        }}>
                            <span style={{ fontSize: "14px" }}>💡</span>
                            <span>Click profile to select • Empty profiles can be deleted</span>
                        </div>
                    </div>

                    {/* Режимы слайд-шоу */}
                    <div style={{
                        display: "flex",
                        gap: "10px",
                        marginBottom: "16px"
                    }}>
                        <div
                            onClick={toggleSlideshow}
                            style={{
                                flex: 1,
                                padding: "12px 16px",
                                borderRadius: "8px",
                                cursor: "pointer",
                                backgroundColor: slideshowOn ? "rgba(88, 101, 242, 0.9)" : "rgba(79, 84, 92, 0.9)",
                                color: "white",
                                fontWeight: "600",
                                fontSize: "13px",
                                textAlign: "center",
                                transition: "all 0.2s ease",
                                boxShadow: slideshowOn ? "0 4px 12px rgba(88, 101, 242, 0.3)" : "none"
                            }}
                        >
                            🎞️ Slideshow: {slideshowOn ? "ON" : "OFF"}
                        </div>
                        <div
                            onClick={slideshowOn ? toggleRandom : undefined}
                            style={{
                                flex: 1,
                                padding: "12px 16px",
                                borderRadius: "8px",
                                cursor: slideshowOn ? "pointer" : "not-allowed",
                                backgroundColor: slideshowOn && randomOn ? "rgba(88, 101, 242, 0.9)" : "rgba(79, 84, 92, 0.9)",
                                color: "white",
                                fontWeight: "600",
                                fontSize: "13px",
                                textAlign: "center",
                                opacity: slideshowOn ? 1 : 0.5,
                                transition: "all 0.2s ease",
                                boxShadow: slideshowOn && randomOn ? "0 4px 12px rgba(88, 101, 242, 0.3)" : "none"
                            }}
                        >
                            🎲 Random: {randomOn ? "YES" : "NO"}
                        </div>
                    </div>

                    {/* Инфо */}
                    {settings.store.showInfoBadges && (
                        <div style={{
                            padding: "14px 18px",
                            backgroundColor: "var(--background-secondary)",
                            borderRadius: "10px",
                            marginBottom: "16px",
                            display: "flex",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: "12px",
                            border: "1px solid var(--background-modifier-accent)"
                        }}>
                            {/* Profile name */}
                            <div style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                padding: "8px 14px",
                                backgroundColor: "rgba(88, 101, 242, 0.15)",
                                borderRadius: "8px",
                                border: "1px solid rgba(88, 101, 242, 0.3)",
                                boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                            }}>
                                <span style={{ fontSize: "18px" }}>📁</span>
                                <div style={{ display: "flex", flexDirection: "column", lineHeight: "1.2" }}>
                                    <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Profile</span>
                                    <span style={{ fontSize: "14px", fontWeight: "700", color: "#5865F2" }}>
                                        {profiles.get(currentProfileId)?.name || "Default"}
                                    </span>
                                </div>
                            </div>

                            {/* Images count */}
                            <div style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                padding: "8px 14px",
                                backgroundColor: "var(--background-tertiary)",
                                borderRadius: "8px",
                                boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                            }}>
                                <span style={{ fontSize: "18px" }}>📊</span>
                                <div style={{ display: "flex", flexDirection: "column", lineHeight: "1.2" }}>
                                    <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Images</span>
                                    <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                                        <span style={{ fontSize: "20px", fontWeight: "800", color: "#5865F2" }}>{images.length}</span>
                                        <span style={{ fontSize: "14px", fontWeight: "500", color: "var(--text-muted)" }}>/{MAX_IMAGES_PER_PROFILE}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Selected */}
                            {images.length > 0 && (
                                <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    padding: "8px 14px",
                                    backgroundColor: "rgba(88, 101, 242, 0.15)",
                                    borderRadius: "8px",
                                    border: "1px solid rgba(88, 101, 242, 0.3)",
                                    boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                                }}>
                                    <span style={{ fontSize: "18px" }}>📍</span>
                                    <div style={{ display: "flex", flexDirection: "column", lineHeight: "1.2" }}>
                                        <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Selected</span>
                                        <span style={{ fontSize: "16px", fontWeight: "700", color: "#5865F2" }}>#{pendingIndex + 1}</span>
                                    </div>
                                </div>
                            )}

                            {/* Stream status */}
                            {images.length > 1 && slideshowOn && pluginEnabled && (
                                <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    padding: "8px 14px",
                                    backgroundColor: streamActive ? "rgba(59, 165, 92, 0.15)" : "var(--background-tertiary)",
                                    borderRadius: "8px",
                                    border: streamActive ? "1px solid rgba(59, 165, 92, 0.3)" : "none",
                                    boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                                }}>
                                    <span style={{ fontSize: "18px" }}>{streamActive ? "🟢" : "⚫"}</span>
                                    <div style={{ display: "flex", flexDirection: "column", lineHeight: "1.2" }}>
                                        <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Slideshow</span>
                                        <span style={{ fontSize: "14px", fontWeight: "600", color: streamActive ? "#3ba55c" : "var(--text-muted)" }}>
                                            ~5 min
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* Timer */}
                            {images.length > 0 && pluginEnabled && streamActive && lastSlideChangeTime > 0 && (
                                <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    padding: "8px 14px",
                                    backgroundColor: "rgba(88, 101, 242, 0.15)",
                                    borderRadius: "8px",
                                    border: "1px solid rgba(88, 101, 242, 0.3)",
                                    boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
                                }}>
                                    <span style={{ fontSize: "18px" }}>⏱️</span>
                                    <div style={{ display: "flex", flexDirection: "column", lineHeight: "1.2" }}>
                                        <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Timer</span>
                                        <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                                            <span style={{ fontSize: "14px", fontWeight: "700", color: "#5865F2" }}>
                                                {formatTime(timerSeconds)}
                                            </span>
                                            <span style={{ fontSize: "12px", fontWeight: "500", color: "var(--text-muted)" }}>
                                                / ~5 min
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Кнопки */}
                    <div style={{ display: "flex", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
                        <Button
                            onClick={() => handleFileSelect(false)}
                            disabled={isLoading || images.length >= MAX_IMAGES_PER_PROFILE}
                            style={{ padding: "10px 16px" }}
                        >
                            {isLoading ? "⏳..." : "📁 Add Image"}
                        </Button>
                        <Button
                            onClick={() => handleFileSelect(true)}
                            disabled={isLoading || images.length >= MAX_IMAGES_PER_PROFILE}
                            style={{ padding: "10px 16px" }}
                        >
                            📁+ Multiple
                        </Button>
                        <Button
                            color={Button.Colors.RED}
                            onClick={handleClearAll}
                            disabled={images.length === 0}
                            style={{ padding: "10px 16px" }}
                        >
                            🗑️ Delete All
                        </Button>
                    </div>

                    {error && (
                        <div style={{
                            padding: "8px 12px",
                            backgroundColor: "var(--status-danger-background)",
                            borderRadius: "4px",
                            marginBottom: "16px",
                            color: "var(--status-danger)"
                        }}>
                            ❌ {error}
                        </div>
                    )}

                    {images.length > 0 ? (
                        <div style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                            gap: "16px",
                            maxHeight: "400px",
                            overflowY: "auto",
                            padding: "8px",
                            backgroundColor: "var(--background-tertiary)",
                            borderRadius: "8px"
                        }}>
                            {images.map((src: string, index: number) => {
                                const isCurrent = index === pendingIndex;
                                const isNext = index === nextIndex;
                                const isBeingDragged = index === draggedIndex;
                                const isDragTarget = index === dragOverIndex;

                                return (
                                    <div
                                        key={index}
                                        draggable
                                        onClick={() => handleSelectCurrent(index)}
                                        onDragStart={(e) => handleImageDragStart(e, index)}
                                        onDragOver={(e) => handleImageDragOver(e, index)}
                                        onDragLeave={handleImageDragLeave}
                                        onDrop={(e) => handleImageDrop(e, index)}
                                        onDragEnd={handleImageDragEnd}
                                        style={{
                                            position: "relative",
                                            borderRadius: "8px",
                                            overflow: "hidden",
                                            border: isDragTarget
                                                ? "3px solid #faa61a"
                                                : isCurrent
                                                    ? "3px solid #3ba55c"
                                                    : isNext
                                                        ? "3px solid #5865F2"
                                                        : "3px solid transparent",
                                            backgroundColor: "var(--background-secondary)",
                                            boxShadow: isDragTarget
                                                ? "0 4px 20px rgba(250, 166, 26, 0.4)"
                                                : isCurrent
                                                    ? "0 4px 20px rgba(59, 165, 92, 0.4)"
                                                    : isNext
                                                        ? "0 4px 16px rgba(88, 101, 242, 0.3)"
                                                        : "0 2px 8px rgba(0,0,0,0.2)",
                                            cursor: "grab",
                                            opacity: isBeingDragged ? 0.5 : 1,
                                            transition: "all 0.15s ease"
                                        }}
                                        onMouseEnter={e => {
                                            if (!isCurrent && !isBeingDragged) {
                                                (e.currentTarget as HTMLElement).style.transform = "translateY(-4px)";
                                                (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px rgba(0,0,0,0.3)";
                                            }
                                        }}
                                        onMouseLeave={e => {
                                            (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                                            if (!isCurrent && !isNext && !isDragTarget) {
                                                (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";
                                            }
                                        }}
                                    >
                                        {/* Контейнер с соотношением 16:9 */}
                                        <div style={{
                                            position: "relative",
                                            width: "100%",
                                            paddingTop: "56.25%", // 16:9 aspect ratio
                                            backgroundColor: "#000"
                                        }}>
                                            <img
                                                src={src}
                                                alt={`Slide ${index + 1}`}
                                                style={{
                                                    position: "absolute",
                                                    top: 0,
                                                    left: 0,
                                                    width: "100%",
                                                    height: "100%",
                                                    objectFit: "contain",
                                                    display: "block"
                                                }}
                                            />
                                        </div>

                                        {/* Статус бейдж */}
                                        <div style={{
                                            position: "absolute",
                                            top: "8px",
                                            left: "8px",
                                            backgroundColor: isCurrent
                                                ? "#3ba55c"
                                                : isNext
                                                    ? "#5865F2"
                                                    : "rgba(0,0,0,0.75)",
                                            color: "white",
                                            padding: "4px 8px",
                                            borderRadius: "6px",
                                            fontSize: "12px",
                                            fontWeight: "600",
                                            backdropFilter: "blur(4px)",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "4px"
                                        }}>
                                            {isCurrent && "▶"}
                                            {isNext && "→"}
                                            #{index + 1}
                                        </div>

                                        {/* Кнопки действий */}
                                        <div style={{
                                            position: "absolute",
                                            top: "8px",
                                            right: "8px",
                                            display: "flex",
                                            gap: "6px"
                                        }}>
                                            {/* Полноэкранный просмотр */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setPreviewImage(src);
                                                }}
                                                style={{
                                                    backgroundColor: "rgba(0,0,0,0.75)",
                                                    color: "white",
                                                    border: "none",
                                                    borderRadius: "6px",
                                                    width: "28px",
                                                    height: "28px",
                                                    cursor: "pointer",
                                                    fontSize: "14px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    backdropFilter: "blur(4px)",
                                                    transition: "background-color 0.15s"
                                                }}
                                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(88, 101, 242, 0.9)"}
                                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(0,0,0,0.75)"}
                                                title="Просмотр"
                                            >
                                                🔍
                                            </button>
                                            {/* Скачать */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const a = document.createElement("a");
                                                    a.href = src;
                                                    a.download = `stream-preview-${index + 1}.jpg`;
                                                    a.click();
                                                }}
                                                style={{
                                                    backgroundColor: "rgba(0,0,0,0.75)",
                                                    color: "white",
                                                    border: "none",
                                                    borderRadius: "6px",
                                                    width: "28px",
                                                    height: "28px",
                                                    cursor: "pointer",
                                                    fontSize: "14px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    backdropFilter: "blur(4px)",
                                                    transition: "background-color 0.15s"
                                                }}
                                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(88, 101, 242, 0.9)"}
                                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(0,0,0,0.75)"}
                                                title="Download"
                                            >
                                                ⬇
                                            </button>
                                            {/* Удалить */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDelete(index);
                                                }}
                                                style={{
                                                    backgroundColor: "rgba(0,0,0,0.75)",
                                                    color: "white",
                                                    border: "none",
                                                    borderRadius: "6px",
                                                    width: "28px",
                                                    height: "28px",
                                                    cursor: "pointer",
                                                    fontSize: "14px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    backdropFilter: "blur(4px)",
                                                    transition: "background-color 0.15s"
                                                }}
                                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(237, 66, 69, 0.9)"}
                                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(0,0,0,0.75)"}
                                                title="Delete"
                                            >
                                                ✕
                                            </button>
                                        </div>

                                        {/* Индикатор выбора внизу */}
                                        {isCurrent && (
                                            <div style={{
                                                position: "absolute",
                                                bottom: 0,
                                                left: 0,
                                                right: 0,
                                                height: "4px",
                                                backgroundColor: "#3ba55c",
                                                borderRadius: "0 0 5px 5px"
                                            }} />
                                        )}

                                        {/* Размер файла в правом нижнем углу */}
                                        {imageSizes[index] && (
                                            <div style={{
                                                position: "absolute",
                                                bottom: "6px",
                                                right: "8px",
                                                backgroundColor: "rgba(0,0,0,0.8)",
                                                color: "white",
                                                padding: "4px 8px",
                                                borderRadius: "4px",
                                                fontSize: "11px",
                                                fontWeight: "500",
                                                backdropFilter: "blur(4px)",
                                                whiteSpace: "nowrap"
                                            }}>
                                                📦 {formatFileSize(imageSizes[index])}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div style={{
                            padding: "40px",
                            textAlign: "center",
                            backgroundColor: "var(--background-secondary)",
                            borderRadius: "12px",
                            border: "2px dashed var(--background-modifier-accent)"
                        }}>
                            <div style={{ fontSize: "48px", marginBottom: "12px" }}>📷</div>
                            <Text variant="text-lg/semibold" style={{ color: "var(--text-normal)", marginBottom: "8px" }}>
                                No images
                            </Text>
                            <Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>
                                Drag images here or click "Add Image"
                            </Text>
                        </div>
                    )}

                    {/* Подсказка про хранение */}
                    <div style={{
                        marginTop: "16px",
                        padding: "10px 14px",
                        backgroundColor: "var(--background-secondary)",
                        borderRadius: "6px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px"
                    }}>
                        <span style={{ fontSize: "16px" }}>💾</span>
                        <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>
                            Images stored locally • Limit: {MAX_IMAGES_PER_PROFILE} images per profile
                        </Text>
                    </div>
                </div>
            </ModalContent>
            <ModalFooter>
                <div style={{ display: "flex", gap: "12px", width: "100%", justifyContent: "space-between", alignItems: "center" }}>
                    <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>
                        📁 {profiles.get(currentProfileId)?.name || "Default"}: {images.length} / {MAX_IMAGES_PER_PROFILE} images
                    </Text>
                    <div style={{ display: "flex", gap: "10px" }}>
                        <Button
                            onClick={handleCancel}
                            style={{
                                padding: "10px 20px"
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            color={Button.Colors.GREEN}
                            onClick={handleSave}
                            style={{
                                padding: "10px 24px"
                            }}
                        >
                            ✓ Save
                        </Button>
                    </div>
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

function openImagePicker() {
    openModal((props: any) => <ImagePickerModal rootProps={props} />);
}

// Иконка для кнопки панели с бейджем количества
function StreamPreviewIcon({ imageCount, isEnabled, isSlideshowEnabled, isRandom, currentImageUri, streamActive }: {
    imageCount: number;
    isEnabled: boolean;
    isSlideshowEnabled: boolean;
    isRandom: boolean;
    currentImageUri: string | null;
    streamActive: boolean;
}) {
    return (
        <div style={{ position: "relative" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                {/* Рамка монитора - всегда currentColor */}
                <path
                    fill="currentColor"
                    d="M21 3H3C1.9 3 1 3.9 1 5V17C1 18.1 1.9 19 3 19H8V21H16V19H21C22.1 19 23 18.1 23 17V5C23 3.9 22.1 3 21 3ZM21 17H3V5H21V17Z"
                />
                {/* Внутренняя часть - зелёные горы если плагин активен, серые если выключен */}
                <path
                    fill={isEnabled ? "var(--status-positive)" : "currentColor"}
                    d="M12 7C10.34 7 9 8.34 9 10C9 11.66 10.34 13 12 13C13.66 13 15 11.66 15 10C15 8.34 13.66 7 12 7Z"
                />
                <path
                    fill={isEnabled ? "var(--status-positive)" : "currentColor"}
                    d="M18 14L15 11L12 14L9 11L6 14V15H18V14Z"
                />
            </svg>

            {/* Бейдж с количеством - показываем если больше 1 и включён слайдшоу */}
            {imageCount > 1 && isSlideshowEnabled && isEnabled && (
                <div style={{
                    position: "absolute",
                    top: "-4px",
                    right: "-6px",
                    backgroundColor: "var(--status-positive)",
                    color: "white",
                    fontSize: "9px",
                    fontWeight: "bold",
                    borderRadius: "6px",
                    minWidth: "12px",
                    height: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 3px"
                }}>
                    {imageCount}
                </div>
            )}

            {/* Знак случайности 🎲 - показываем если случайный режим */}
            {imageCount > 1 && isSlideshowEnabled && isRandom && isEnabled && (
                <div style={{
                    position: "absolute",
                    bottom: "-4px",
                    right: "-6px",
                    fontSize: "10px",
                    lineHeight: "1"
                }}>
                    🎲
                </div>
            )}
        </div>
    );
}

// Форматирование времени в удобный вид
function formatTime(seconds: number): string {
    if (seconds < 60) return `${seconds} sec`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (secs === 0) return `${mins} min`;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Форматирование размера файла
function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Кнопка в панели аккаунта 
function StreamPreviewPanelButton(props: { nameplate?: any; }) {
    const [imageCount, setImageCount] = useState(0);
    const [isEnabled, setIsEnabled] = useState(settings.store.replaceEnabled);
    const [isSlideshowEnabled, setIsSlideshowEnabled] = useState(settings.store.slideshowEnabled);
    const [isRandom, setIsRandom] = useState(settings.store.slideshowRandom);
    const [currentIndex, setCurrentIndex] = useState(currentSlideIndex);
    const [secondsAgo, setSecondsAgo] = useState(0);
    const [streamActive, setStreamActive] = useState(isStreamActive);
    const [currentImageUri, setCurrentImageUri] = useState<string | null>(null);

    useEffect(() => {
        const updateState = () => {
            setImageCount(getImageCount());
            setIsEnabled(settings.store.replaceEnabled);
            setIsSlideshowEnabled(settings.store.slideshowEnabled);
            setIsRandom(settings.store.slideshowRandom);
            setCurrentIndex(currentSlideIndex);
            setStreamActive(isStreamActive);
            // Обновляем превью РЕАЛЬНОЙ картинки на стриме 
            setCurrentImageUri(actualStreamImageUri);
        };

        updateState();
        imageChangeListeners.add(updateState);

        // Таймер для обновления времени каждую секунду
        const timerInterval = setInterval(() => {
            // Автосброс: если прошло более 7 минут без вызова getCustomThumbnail - стрим остановлен
            if (isStreamActive && lastSlideChangeTime > 0 && (Date.now() - lastSlideChangeTime) > 420000) {
                isStreamActive = false;
            }
            setStreamActive(isStreamActive);
            if (lastSlideChangeTime > 0 && isStreamActive) {
                setSecondsAgo(Math.floor((Date.now() - lastSlideChangeTime) / 1000));
            }
        }, 1000);

        return () => {
            imageChangeListeners.delete(updateState);
            clearInterval(timerInterval);
        };
    }, []);

    const getTooltip = () => {
        if (imageCount === 0) return "Select stream preview";
        if (!isEnabled) return `Stream preview (disabled, ${imageCount} images)`;

        // Интервал ~5 минут (Discord контролирует)
        const intervalSeconds = 5 * 60;

        // Таймер для любого количества фото (включая 1)
        const timeInfo = lastSlideChangeTime > 0 && streamActive
            ? `\n⏱️ ${formatTime(secondsAgo)} ago (~${formatTime(Math.max(0, intervalSeconds - secondsAgo))} until update)`
            : streamActive ? "" : "\n⚫ Stream not active";

        if (imageCount === 1) return `Stream preview (1 image)${timeInfo}`;

        if (isSlideshowEnabled) {
            const slideInfo = `\n📍 Current: #${currentIndex + 1}`;
            if (isRandom) {
                return `Stream preview (${imageCount} images, random)${slideInfo}${timeInfo}`;
            }
            return `Stream preview (${imageCount} images, slideshow)${slideInfo}${timeInfo}`;
        }
        return `Stream preview (${imageCount} images)${timeInfo}`;
    };

    // Кастомный тултип с превью картинки
    const renderTooltip = () => {
        const tooltipText = getTooltip();

        // Показываем превью только если: есть картинка, плагин включен, есть фото И стрим активен
        if (currentImageUri && isEnabled && imageCount > 0 && streamActive) {
            return (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
                    <div style={{
                        width: "160px",
                        height: "90px",
                        borderRadius: "4px",
                        overflow: "hidden",
                        border: "2px solid var(--status-positive)",
                        boxShadow: "0 0 8px rgba(59, 165, 92, 0.5)"
                    }}>
                        <img
                            src={currentImageUri}
                            alt="Preview"
                            style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                                display: "block"
                            }}
                        />
                    </div>
                    <div style={{
                        whiteSpace: "pre-line",
                        textAlign: "center",
                        fontSize: "12px",
                        lineHeight: "1.4"
                    }}>
                        {tooltipText}
                    </div>
                </div>
            );
        }

        return tooltipText;
    };

    return (
        <PanelButton
            tooltipText={renderTooltip()}
            icon={() => <StreamPreviewIcon
                imageCount={imageCount}
                isEnabled={isEnabled}
                isSlideshowEnabled={isSlideshowEnabled}
                isRandom={isRandom}
                currentImageUri={currentImageUri}
                streamActive={streamActive}
            />}
            onClick={openImagePicker}
            plated={props?.nameplate != null}
        />
    );
}

// Патч контекстного меню стрима
interface StreamContextProps {
    stream: {
        ownerId: string;
        guildId: string | null;
        channelId: string;
    };
}

const streamContextMenuPatch: NavContextMenuPatchCallback = (children: any[], { stream }: StreamContextProps) => {
    // Проверяем, что это наш стрим
    const currentUser = UserStore.getCurrentUser();
    if (!currentUser || stream.ownerId !== currentUser.id) return;

    // Находим группу с "Полный экран" и "Открыть в отдельном окне"
    const group = findGroupChildrenByChildId(["fullscreen", "popout"], children);

    if (group) {
        // Добавляем наш пункт после существующих
        group.push(
            <Menu.MenuItem
                id="custom-stream-preview"
                label="🖼️ Custom Preview"
                icon={ImageIcon}
                action={openImagePicker}
            />
        );
    } else {
        // Если группа не найдена, добавляем в конец
        children.push(
            <Menu.MenuSeparator />,
            <Menu.MenuItem
                id="custom-stream-preview"
                label="🖼️ Custom Preview"
                icon={ImageIcon}
                action={openImagePicker}
            />
        );
    }
};

// Функция для получения кастомного превью (вызывается из webpack patch)
// При слайд-шоу каждый вызов (~5 мин) возвращает следующую картинку
function getCustomThumbnail(originalThumbnail: string): string {
    // Помечаем что стрим активен
    isStreamActive = true;

    if (!settings.store.replaceEnabled || cachedDataUris.length === 0) {
        actualStreamImageUri = null; // Нет кастомной картинки
        notifyImageChange();
        return originalThumbnail;
    }

    // Если одна картинка или слайд-шоу выключено — показываем выбранную
    if (cachedDataUris.length === 1 || !settings.store.slideshowEnabled) {
        // Проверяем что индекс валиден
        const idx = currentSlideIndex < cachedDataUris.length ? currentSlideIndex : 0;
        lastSlideChangeTime = Date.now(); // Обновляем время для таймера
        actualStreamImageUri = cachedDataUris[idx]; // Обновляем реальную картинку на стриме
        notifyImageChange();
        return cachedDataUris[idx];
    }

    // Если была ручная смена — показываем выбранную картинку один раз
    if (manualSlideChange) {
        manualSlideChange = false; // Сбрасываем флаг
        lastSlideChangeTime = Date.now(); // Обновляем время для таймера
        actualStreamImageUri = cachedDataUris[currentSlideIndex]; // Обновляем реальную картинку на стриме
        notifyImageChange();
        return cachedDataUris[currentSlideIndex];
    }

    // Слайд-шоу: выбираем следующую картинку
    let nextIndex: number;

    if (settings.store.slideshowRandom) {
        // Случайный выбор (но не та же самая)
        do {
            nextIndex = Math.floor(Math.random() * cachedDataUris.length);
        } while (nextIndex === currentSlideIndex && cachedDataUris.length > 1);
    } else {
        // Последовательный выбор
        nextIndex = (currentSlideIndex + 1) % cachedDataUris.length;
    }

    currentSlideIndex = nextIndex;
    lastSlideChangeTime = Date.now(); // Запоминаем время смены
    actualStreamImageUri = cachedDataUris[currentSlideIndex]; // Обновляем реальную картинку на стриме
    saveSlideIndex(nextIndex); // Сохраняем новый индекс
    notifyImageChange(); // Обновляем UI
    return cachedDataUris[currentSlideIndex];
}

export default definePlugin({
    name: "CustomStreamTopQ",
    description: "Custom stream preview images with profiles & slideshow. GitHub: https://github.com/MrTopQ/customStream-Vencord",
    authors: [
        {
            name: "TopQ",
            id: 523800559791374356n
        }
    ],

    settings,

    // Патчи для перехвата функции обновления превью
    patches: [
        {
            // Патч для добавления кнопки в панель (рядом с микрофоном/наушниками)
            find: "#{intl::ACCOUNT_SPEAKING_WHILE_MUTED}",
            replacement: {
                // Матчим начало массива children после чего угодно, главное чтобы был accountContainerRef дальше
                match: /(children:\[)(.{0,150}?)(accountContainerRef)/,
                replace: "$1$self.StreamPreviewPanelButton(arguments[0]),$2$3"
            }
        },
        {
            // Перехватываем отправку превью в ApplicationStreamPreviewUploadManager
            find: "\"ApplicationStreamPreviewUploadManager\"",
            all: true,
            replacement: [
                {
                    // Паттерн 1: body:{thumbnail:x}
                    match: /body:\{thumbnail:(\i)\}/,
                    replace: "body:{thumbnail:$self.getCustomThumbnail($1)}"
                },
                {
                    // Паттерн 2: {thumbnail:x} без body
                    match: /\{thumbnail:(\i)\}/,
                    replace: "{thumbnail:$self.getCustomThumbnail($1)}"
                }
            ]
        }
    ],

    toolboxActions: {
        "Select stream preview": openImagePicker
    },

    // Кнопка в панели аккаунта
    StreamPreviewPanelButton: ErrorBoundary.wrap(StreamPreviewPanelButton, { noop: true }),

    // Функция для замены thumbnail (вызывается из webpack patch)
    getCustomThumbnail,

    contextMenus: {
        "stream-context": streamContextMenuPatch
    },

    async start() {
        // Загружаем профили при старте (включая миграцию со старого формата)
        await loadProfilesFromDataStore();

        // Синхронизируем кэш с активным профилем
        syncCacheWithActiveProfile();

        // Уведомляем UI об обновлении (для иконки в панели)
        notifyImageChange();

        const profile = getActiveProfile();
        console.log(`[CustomStreamTopQ] Loaded ${profiles.size} profiles, active: "${profile.name}" with ${profile.images.length} images`);
    },

    stop() {
        // Очищаем кэш при выключении
        cachedImages = [];
        cachedDataUris = [];
        currentSlideIndex = 0;
        isStreamActive = false;
        lastSlideChangeTime = 0;
        manualSlideChange = false;
        profiles.clear();
        activeProfileId = DEFAULT_PROFILE_ID;
    }
});
