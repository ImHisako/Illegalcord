/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Messages } from "./en";
import { pluralRu } from "./plural";

const images = (count: number) => `${count} ${pluralRu(count, "картинку", "картинки", "картинок")}`;
const counted = (count: number, one: string, other: string) =>
    `${pluralRu(count, one, other, other)} ${count} ${pluralRu(count, "картинка", "картинки", "картинок")}`;

export const ru: Messages = {
    pluginDescription: "Своя картинка вместо превью стрима, с профилями и слайдшоу. GitHub https://github.com/MrTopQ/customStream-Vencord",

    settingLanguage: "Язык плагина. «Авто» берёт язык Discord",
    settingLanguageAuto: "Авто (как в Discord)",
    settingReplace: "Отправлять свою картинку как превью стрима вместо кадра с экрана",
    settingSlideshow: "Менять картинку при каждом обновлении превью (раз в 5 минут)",
    settingRandom: "Случайный порядок без повторов. Картинка не вернётся, пока не покажутся все остальные",
    settingPanelButton: "Кнопка рядом с аватаркой в панели аккаунта. Если она пропала после обновления Discord, сломался патч, обновите плагин с https://github.com/MrTopQ/customStream-Vencord",
    settingHotkey: "Горячая клавиша, которая открывает и закрывает галерею, например Alt+1 или Ctrl+Shift+S",

    contextMenuItem: "Сменить превью стрима",
    toolboxOpen: "Галерея превью стрима",
    panelAria: "Превью стрима",

    modalTitle: "Превью стрима",
    modalSubtitle: "Что видят люди, пока не зашли на ваш стрим",
    done: "Готово",
    storedLocally: "Картинки хранятся только на этом компьютере.",
    storageFailed: "Хранилище не загрузилось, изменения не сохраняются.",
    hotkeyOpens: (key: string) => `${key} открывает это окно.`,
    dropToAdd: (profile: string) => `Отпустите, чтобы добавить в «${profile}»`,
    profileFull: (profile: string, max: number) => `В «${profile}» уже ${max} картинок`,
    onlyImages: "Подходят PNG, JPEG и WebP до 8 МБ или ZIP-архив с ними",
    zipNoImages: "В архиве нет картинок PNG, JPEG или WebP",
    zipReadFailed: "Не удалось открыть архив",
    exportFailed: "Не удалось собрать архив",
    moreActions: "Ещё",
    healthOk: "Всё на месте",
    healthPartial: (broken: number, total: number) => `Не работает ${broken} из ${total}`,
    healthBroken: "Замена превью не работает",
    healthAlert: "После обновления Discord замена не работает, зрители увидят экран. Обновите плагин.",
    healthPart: {
        thumbnail: "Подмена картинки превью",
        upload: "Подмена картинки при отправке",
        frame: "Превью при свёрнутом окне",
        pauseGate: "Превью на паузе стрима",
        settle: "Статус отправки и таймер",
        failure: "Статус ошибок отправки",
        streamDelete: "Конец чужих стримов",
        panel: "Кнопка в панели аккаунта"
    },
    shuffleAll: "Перемешать всё",
    shuffleTitle: (profile: string) => `Перемешать все картинки в «${profile}»?`,
    shuffleBody: "Порядок поменяется случайным образом. Выбранная картинка останется выбранной.",
    shuffleConfirm: "Перемешать",
    shuffled: "Порядок перемешан",
    exportZip: "Скачать архивом",
    importZip: "Загрузить из архива",
    added: (count: number, skipped: number, over: number) => {
        const notes = [skipped && `пропущено ${skipped}`, over && `сверх лимита ${over}`].filter(Boolean).join(", ");
        return `${counted(count, "Добавлена", "Добавлено")}${notes ? ` (${notes})` : ""}`;
    },
    readFailed: "Не удалось прочитать один из файлов",

    howItWorks: "Discord загружает превью, когда вы начинаете стрим, и потом раз в 5 минут. Кто наводит на ваш стрим или открывает голосовой канал, получает последнюю загрузку, но у него она может отставать до 2 минут.",
    notLive: "Не в эфире",
    live: "В эфире",
    livePreviewOff: "В эфире, превью выключено",
    streamPaused: "Стрим на паузе",
    uploadFailed: "Не удалось загрузить",
    offlineReplaceOff: "Замена выключена, зрители увидят кадр с вашего экрана.",
    offlineNoImages: "Добавьте картинку, и она станет превью стрима.",
    offlineFirst: (label: string) => `Как только начнёте стрим, Discord отправит ${label} в первые несколько секунд.`,
    previewOffDetail: "Для этого стрима превью выключено, Discord ничего не отправляет.",
    viewersSee: (label: string) => `Зрители видят ${label}`,
    viewersSeeScreen: "Зрители видят ваш экран",
    pausedDetail: (seen: string | null) => `Окно стрима свёрнуто или скрыто, Discord нечего отправить.${seen ? ` ${seen}.` : ""}`,
    failedNoPreview: (retryIn: string | null, rateLimited: boolean) =>
        `Зрители пока не видят превью${rateLimited ? ", сработал лимит Discord" : ""}. Discord повторит ${retryIn ? `через ${retryIn}` : "с минуты на минуту"}.`,
    retryNote: (retryIn: string | null, rateLimited: boolean) =>
        `${rateLimited ? "Повторная отправка упёрлась в лимит Discord" : "Последняя отправка не прошла"}, следующая попытка ${retryIn ? `через ${retryIn}` : "с минуты на минуту"}.`,
    sending: (label: string | null) => (label ? `Отправка ${label}…` : "Отправка первого превью…"),
    connecting: "Стрим подключается, превью уйдёт сразу после этого.",
    nextUpdate: (inTime: string | null, upcoming: string | null) =>
        `Следующее обновление ${inTime ? `через ${inTime}` : "с минуты на минуту"}${upcoming ? `, дальше ${upcoming}` : ""}.`,
    nextUpdateUnknown: (upcoming: string | null) => `Следующее обновление в течение 5 минут${upcoming ? `, дальше ${upcoming}` : ""}.`,
    sentDetail: (ago: string, next: string) => `Отправлено ${ago} назад. ${next}`,
    deletedImage: "удалённую картинку",
    imageFromProfile: (label: string, profile: string) => `${label} из профиля ${profile}`,

    captionViewersSee: "Зрители видят",
    captionGoesFirst: "Уйдёт первой",
    captionSending: "Отправляется",
    yourScreen: "Ваш экран",
    liveBadge: "В эфире",

    useMyImages: "Свои картинки",
    noteReplaceOn: "Зрители не видят ваш экран",
    noteReplaceOff: "Зрители видят кадр с экрана",
    slideshow: "Слайдшоу",
    noteSlideshowOn: "Новая картинка каждые 5 минут",
    noteSlideshowOff: "Всегда одна и та же картинка",
    order: "Порядок",
    noteShuffle: "Без повторов, пока не покажет все",
    noteInOrder: "Слева направо и снова",
    inOrder: "По порядку",
    shuffle: "Случайно",
    orderAria: "Порядок слайдшоу",

    profilesAria: "Профили",
    profileNamePlaceholder: "Название профиля",
    profileLimit: (max: number) => `Профилей может быть не больше ${max}`,
    newProfile: "Новый профиль",
    doubleClickRename: "Двойной клик переименует, перетаскивание двигает",
    renameProfile: (profile: string) => `Переименовать «${profile}»`,
    deleteProfileButton: (profile: string) => `Удалить «${profile}»`,
    deleteProfileTitle: (profile: string) => `Удалить «${profile}»?`,
    deleteProfileMain: "Основной профиль удалить нельзя",
    deleteProfileNotEmpty: "Чтобы удалить профиль, сначала удалите из него все картинки",
    deleteProfileBody: "Профиль пустой, больше ничего не удалится.",
    delete: "Удалить",
    cancel: "Отмена",

    imageAria: (n: number) => `Картинка ${n}`,
    tagLive: "Эфир",
    tagNext: "Далее",
    tagSending: "Отправка",
    tagSelected: "Выбрана",
    select: "Выбрать",
    deselect: "Снять выбор",
    view: "Открыть",
    download: (size: string) => `Скачать (${size})`,
    selectedCount: (count: number) => counted(count, "Выбрана", "Выбрано"),
    deleteImagesTitle: (count: number) => `Удалить ${images(count)}?`,
    deleteImagesBody: "Они удалятся с этого компьютера, вернуть их не получится.",
    deleteAll: "Удалить все",
    deleteAllTitle: (profile: string) => `Удалить все картинки в «${profile}»?`,
    deleteAllBody: (count: number) => `Картинки этого профиля (всего ${count}) удалятся с компьютера, вернуть их не получится.`,
    countOf: "из",
    hintSendNext: "Клик отправит следующей, перетаскивание меняет порядок",
    hintUse: "Клик выбирает картинку, перетаскивание меняет порядок",
    adding: "Добавление…",
    addImages: "Добавить картинки",
    emptyTitle: "Добавьте первую картинку",
    emptyNote: "PNG, JPEG, WebP или ZIP-архив с ними. Файлы можно перетащить сюда или вставить через Ctrl+V.",

    lightboxAria: (n: number, total: number) => `Картинка ${n} из ${total}`,
    close: "Закрыть",
    previous: "Назад",
    next: "Вперёд"
};
