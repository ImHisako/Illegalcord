/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { MessageOptions, MessageSendListener } from "@api/MessageEvents";
import { definePluginSettings } from "@api/Settings";
import { escapeRegExp } from "@utils/text";
import definePlugin, { OptionType } from "@utils/types";
import { MessageStore } from "@webpack/common";

interface ReplacementRule {
    pattern: RegExp;
    replacement: string;
}

interface ProtectedText {
    text: string;
    values: string[];
}

const PROTECTED_PATTERN = /```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s<]+|www\.[^\s<]+|<a?:\w+:\d+>|<[@#&]!?[0-9]+>|@everyone|@here/g;
const PROTECTED_RESTORE_PATTERN = /__OPSEC_PROTECTED_(\d+)__/g;
const WORD_PATTERN = /[A-Za-z]{5,16}/g;
const WORD_BOUNDARY = "A-Za-zÀ-ÿ0-9_";

const englishReplacements = buildRules({
    im: "I'm",
    ive: "I've",
    youre: "you're",
    youve: "you've",
    youd: "you'd",
    youll: "you'll",
    hes: "he's",
    hed: "he'd",
    shes: "she's",
    theyre: "they're",
    theyve: "they've",
    theyd: "they'd",
    theyll: "they'll",
    weve: "we've",
    wed: "we'd",
    cant: "can't",
    wont: "won't",
    dont: "don't",
    doesnt: "doesn't",
    didnt: "didn't",
    isnt: "isn't",
    arent: "aren't",
    wasnt: "wasn't",
    werent: "weren't",
    havent: "haven't",
    hasnt: "hasn't",
    hadnt: "hadn't",
    shouldnt: "shouldn't",
    wouldnt: "wouldn't",
    couldnt: "couldn't",
    theres: "there's",
    thats: "that's",
    whats: "what's",
    whos: "who's",
    wheres: "where's",
    lets: "let's",
});

const englishSpellings = buildRules({
    teh: "the",
    recieve: "receive",
    recieveing: "receiving",
    seperate: "separate",
    occured: "occurred",
    occuring: "occurring",
    definately: "definitely",
    definatly: "definitely",
    enviroment: "environment",
    goverment: "government",
    neccessary: "necessary",
    succesful: "successful",
    succesfully: "successfully",
    accomodate: "accommodate",
    accomodation: "accommodation",
    acheive: "achieve",
    acheived: "achieved",
    acheiving: "achieving",
    begining: "beginning",
    beggining: "beginning",
    calender: "calendar",
    grammer: "grammar",
    happend: "happened",
    immediatly: "immediately",
    intresting: "interesting",
    noticable: "noticeable",
    persistant: "persistent",
    possable: "possible",
    posible: "possible",
    probly: "probably",
    realy: "really",
    tommorow: "tomorrow",
    tomorow: "tomorrow",
    truely: "truly",
    usefull: "useful",
    writting: "writing",
    liek: "like",
    trynig: "trying",
    tryign: "trying",
});

const slangReplacements = buildRules({
    idk: "I don't know",
    imo: "in my opinion",
    imho: "in my humble opinion",
    tbh: "to be honest",
    ngl: "not gonna lie",
    btw: "by the way",
    asap: "as soon as possible",
    fyi: "for your information",
    hmu: "hit me up",
    pls: "please",
    plz: "please",
    wanna: "want to",
    gonna: "going to",
    gotta: "got to",
    dunno: "don't know",
    lemme: "let me",
    gimme: "give me",
    tryna: "trying to",
    cuz: "because",
    coz: "because",
    rly: "really",
});

const italianReplacements = buildRules({
    "accellerare": "accelerare",
    "accellerato": "accelerato",
    "accellerata": "accelerata",
    "affinche": "affinché",
    "affinchè": "affinché",
    "anke": "anche",
    "anziche": "anziché",
    "anzichè": "anziché",
    "aereoporto": "aeroporto",
    "areoporto": "aeroporto",
    "apparte": "a parte",
    "apposto": "a posto",
    "aposto": "a posto",
    "avvolte": "a volte",
    "benche": "benché",
    "benchè": "benché",
    "c e": "c'è",
    "cè": "c'è",
    "ce lho": "ce l'ho",
    "celho": "ce l'ho",
    "cerano": "c'erano",
    "cioe": "cioè",
    "cioé": "cioè",
    "citta": "città",
    "cmq": "comunque",
    "com e": "com'è",
    "comè": "com'è",
    "conoscienza": "conoscenza",
    "cos e": "cos'è",
    "cosè": "cos'è",
    "cosi": "così",
    "cosí": "così",
    "d accordo": "d'accordo",
    "daccordo": "d'accordo",
    "dacordo": "d'accordo",
    "davero": "davvero",
    "d'avvero": "davvero",
    "dov e": "dov'è",
    "dovè": "dov'è",
    "dopodiche": "dopodiché",
    "dopodichè": "dopodiché",
    "e'": "è",
    "efficente": "efficiente",
    "efficenza": "efficienza",
    "fà": "fa",
    "finche": "finché",
    "finchè": "finché",
    "frose": "forse",
    "gia": "già",
    "giá": "già",
    "giovedi": "giovedì",
    "grz": "grazie",
    "igene": "igiene",
    "igenica": "igienica",
    "igenico": "igienico",
    "incoscente": "incosciente",
    "infondo": "in fondo",
    "ingegniere": "ingegnere",
    "inizziare": "iniziare",
    "ke": "che",
    "l ha": "l'ha",
    "l hai": "l'hai",
    "l hanno": "l'hanno",
    "l avevo": "l'avevo",
    "l ho": "l'ho",
    "laggiu": "laggiù",
    "laggiú": "laggiù",
    "lassu": "lassù",
    "lassú": "lassù",
    "lunedi": "lunedì",
    "macche": "macché",
    "macchè": "macché",
    "martedi": "martedì",
    "mercoledi": "mercoledì",
    "neanchè": "neanche",
    "neanchio": "neanch'io",
    "nesuna": "nessuna",
    "nesuno": "nessuno",
    "ninte": "niente",
    "nn": "non",
    "nonche": "nonché",
    "nonchè": "nonché",
    "perche": "perché",
    "perchè": "perché",
    "percio": "perciò",
    "perciò": "perciò",
    "perfavore": "per favore",
    "peró": "però",
    "pero": "però",
    "perpiacere": "per piacere",
    "piu": "più",
    "piú": "più",
    "poiche": "poiché",
    "poichè": "poiché",
    "pò": "po'",
    "pressoche": "pressoché",
    "pressochè": "pressoché",
    "probabilimente": "probabilmente",
    "propio": "proprio",
    "propro": "proprio",
    "puo": "può",
    "puó": "può",
    "pultroppo": "purtroppo",
    "qalke": "qualche",
    "qnd": "quando",
    "qndo": "quando",
    "qndi": "quindi",
    "qst": "questo",
    "qsta": "questa",
    "qste": "queste",
    "qsti": "questi",
    "qual e": "qual è",
    "qual'è": "qual è",
    "qualè": "qual è",
    "qualke": "qualche",
    "qualcun'altro": "qualcun altro",
    "quà": "qua",
    "qundo": "quando",
    "qundi": "quindi",
    "raggione": "ragione",
    "scenza": "scienza",
    "scentifico": "scientifico",
    "scentifica": "scientifica",
    "setimana": "settimana",
    "sicche": "sicché",
    "sicchè": "sicché",
    "sicuramenta": "sicuramente",
    "sò": "so",
    "sopratutto": "soprattutto",
    "stò": "sto",
    "sufficente": "sufficiente",
    "sufficenza": "sufficienza",
    "tuta": "tutta",
    "tuto": "tutto",
    "tuti": "tutti",
    "un altra": "un'altra",
    "un'altro": "un altro",
    "unaltro": "un altro",
    "vabene": "va bene",
    "venerdi": "venerdì",
    "xche": "perché",
    "xchè": "perché",
    "xke": "perché",
    "xké": "perché",
    "xo": "però",
    "xò": "però",
});

const punctuationRules: ReplacementRule[] = [
    { pattern: /\.{3,}/g, replacement: "..." },
    { pattern: /!!+/g, replacement: "!" },
    { pattern: /\?\?+/g, replacement: "?" },
    { pattern: /,,+/g, replacement: "," },
    { pattern: /\s+([.!?,;:])/g, replacement: "$1" },
    { pattern: /([([{])\s+/g, replacement: "$1" },
    { pattern: /\s+([)\]}])/g, replacement: "$1" },
];

const settings = definePluginSettings({
    enable: {
        type: OptionType.BOOLEAN,
        description: "Enable OpSec autocorrect.",
        default: true,
    },
    enableEnglish: {
        type: OptionType.BOOLEAN,
        description: "Enable English corrections.",
        default: true,
    },
    enableItalian: {
        type: OptionType.BOOLEAN,
        description: "Enable Italian corrections.",
        default: true,
    },
    fixItalianAccents: {
        type: OptionType.BOOLEAN,
        description: "Fix common missing Italian accents.",
        default: true,
    },
    fixContractions: {
        type: OptionType.BOOLEAN,
        description: "Fix missing apostrophes in contractions.",
        default: true,
    },
    fixSpelling: {
        type: OptionType.BOOLEAN,
        description: "Fix common spelling mistakes.",
        default: true,
    },
    expandSlang: {
        type: OptionType.BOOLEAN,
        description: "Expand common chat slang.",
        default: false,
    },
    fixSpaces: {
        type: OptionType.BOOLEAN,
        description: "Normalize extra spaces.",
        default: true,
    },
    fixPunctuation: {
        type: OptionType.BOOLEAN,
        description: "Normalize repeated punctuation.",
        default: true,
    },
    fixCapitalization: {
        type: OptionType.BOOLEAN,
        description: "Capitalize sentence starts.",
        default: true,
    },
    addPeriod: {
        type: OptionType.BOOLEAN,
        description: "Add a period to plain sentence endings.",
        default: false,
    },
    contextualCorrection: {
        type: OptionType.BOOLEAN,
        description: "Use replied messages for cautious typo correction.",
        default: false,
    },
    customReplacements: {
        type: OptionType.STRING,
        description: "Custom replacements, one word=replacement per line.",
        default: "",
        multiline: true,
    },
});

let cachedCustomSource = "";
let cachedCustomRules: ReplacementRule[] = [];

function buildRules(words: Record<string, string>): ReplacementRule[] {
    const rules: ReplacementRule[] = [];

    for (const [word, replacement] of Object.entries(words)) {
        rules.push({
            pattern: new RegExp(`(?<![${WORD_BOUNDARY}])${escapeRegExp(word)}(?![${WORD_BOUNDARY}])`, "gi"),
            replacement,
        });
    }

    return rules;
}

function preserveCase(match: string, replacement: string) {
    const letters = match.match(/[A-Za-zÀ-ÿ]/g);
    if (letters?.length && letters.every((letter: string) => letter === letter.toUpperCase())) return replacement.toUpperCase();
    if (match[0] === match[0]?.toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
    return replacement;
}

function applyRules(text: string, rules: ReplacementRule[]) {
    let result = text;

    for (const { pattern, replacement } of rules) {
        result = result.replace(pattern, (match: string) => preserveCase(match, replacement));
    }

    return result;
}

function getCustomRules() {
    const source = settings.store.customReplacements.trim();
    if (source === cachedCustomSource) return cachedCustomRules;

    cachedCustomSource = source;
    cachedCustomRules = [];

    for (const line of source.split(/\r?\n/)) {
        const separator = line.indexOf("=");
        if (separator < 1) continue;

        const word = line.slice(0, separator).trim();
        const replacement = line.slice(separator + 1).trim();
        if (!word || !replacement) continue;

        cachedCustomRules.push({
            pattern: new RegExp(`(?<![${WORD_BOUNDARY}])${escapeRegExp(word)}(?![${WORD_BOUNDARY}])`, "gi"),
            replacement,
        });
    }

    return cachedCustomRules;
}

function protectText(text: string): ProtectedText {
    const values: string[] = [];

    return {
        text: text.replace(PROTECTED_PATTERN, (match: string) => {
            values.push(match);
            return `__OPSEC_PROTECTED_${values.length - 1}__`;
        }),
        values,
    };
}

function restoreText(text: string, values: string[]) {
    return text.replace(PROTECTED_RESTORE_PATTERN, (match: string, index: string) => values[Number(index)] ?? match);
}

function looksItalian(text: string) {
    return /[àèéìòù]/i.test(text)
        || /\b(ciao|grazie|prego|perché|perche|come|dove|quando|questo|questa|sono|sei|abbiamo|avete|hanno|non|che|gli|della|nella|quindi)\b/i.test(text);
}

function isAllCaps(text: string) {
    const letters = text.match(/[A-Za-zÀ-ÿ]/g);
    return Boolean(letters && letters.length >= 8 && letters.every((letter: string) => letter === letter.toUpperCase()));
}

function normalizeSpaces(text: string) {
    return text
        .replace(/[ \t]{2,}/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n[ \t]+/g, "\n")
        .trim();
}

function normalizePunctuation(text: string) {
    return applyRules(text, punctuationRules);
}

function fixCapitalization(text: string, fixStandaloneI: boolean) {
    const result = text
        .replace(/^(\s*)([a-zàèéìòù])/i, (match: string, prefix: string, letter: string) => prefix + letter.toUpperCase())
        .replace(/([.!?]\s+)([a-zàèéìòù])/gi, (match: string, prefix: string, letter: string) => prefix + letter.toUpperCase());

    return fixStandaloneI ? result.replace(/\bi\b/g, "I") : result;
}

function addPeriodIfNeeded(text: string) {
    return text.split("\n").map((line: string) => {
        const trimmed = line.trimEnd();
        if (!trimmed || !/[A-Za-zÀ-ÿ0-9]$/.test(trimmed)) return line;
        return `${trimmed}.`;
    }).join("\n");
}

function levenshteinDistance(first: string, second: string) {
    let previous = Array.from({ length: second.length + 1 }, (_: unknown, index: number) => index);

    for (let i = 1; i <= first.length; i++) {
        const current = [i];

        for (let j = 1; j <= second.length; j++) {
            current[j] = first[i - 1] === second[j - 1]
                ? previous[j - 1]
                : Math.min(previous[j - 1], previous[j], current[j - 1]) + 1;
        }

        previous = current;
    }

    return previous[second.length];
}

function getReplyVocabulary(options: MessageOptions) {
    const reference = options.replyOptions?.messageReference;
    if (!reference) return [];

    const repliedMessage = MessageStore.getMessage(reference.channel_id, reference.message_id);
    return Array.from(new Set(repliedMessage?.content.toLowerCase().match(WORD_PATTERN) ?? []));
}

function applyContextCorrections(text: string, options: MessageOptions) {
    if (!settings.store.contextualCorrection) return text;

    const vocabulary = getReplyVocabulary(options);
    if (!vocabulary.length) return text;

    return text.replace(WORD_PATTERN, (word: string) => {
        const lowerWord = word.toLowerCase();
        let correction: string | undefined;

        for (const candidate of vocabulary) {
            if (candidate === lowerWord || candidate[0] !== lowerWord[0]) continue;
            if (levenshteinDistance(lowerWord, candidate) === 1) {
                correction = candidate;
                break;
            }
        }

        return correction ? preserveCase(word, correction) : word;
    });
}

function shouldProcess(content: string) {
    return Boolean(content.trim()) && !content.trimStart().startsWith("/");
}

function processMessage(content: string, options: MessageOptions) {
    if (!settings.store.enable || !shouldProcess(content)) return content;

    const { text: protectedContent, values } = protectText(content);
    const isItalian = settings.store.enableItalian && looksItalian(protectedContent);
    let text = protectedContent;

    if (isAllCaps(text)) text = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    if (settings.store.fixSpaces) text = normalizeSpaces(text);
    if (settings.store.fixPunctuation) text = normalizePunctuation(text);
    if (settings.store.enableItalian && settings.store.fixItalianAccents !== false) text = applyRules(text, italianReplacements);
    if (settings.store.enableEnglish && !isItalian) {
        if (settings.store.fixContractions) text = applyRules(text, englishReplacements);
        if (settings.store.fixSpelling) text = applyRules(text, englishSpellings);
        if (settings.store.expandSlang) text = applyRules(text, slangReplacements);
    }

    text = applyRules(text, getCustomRules());
    text = applyContextCorrections(text, options);
    if (settings.store.fixCapitalization) text = fixCapitalization(text, !isItalian);
    if (settings.store.addPeriod) text = addPeriodIfNeeded(text);

    return restoreText(text, values);
}

const onBeforeMessageSend: MessageSendListener = (_, message, options) => {
    message.content = processMessage(message.content, options);
};

export default definePlugin({
    name: "OpSec",
    description: "Safely autocorrects outgoing messages without touching links, mentions, or code.",
    dependencies: ["MessageEventsAPI"],
    tags: ["Chat", "Utility"],
    authors: [
        { name: "Solace", id: 1472732509241479218n },
        { name: "irritably", id: 928787166916640838n }
    ],
    settings,
    onBeforeMessageSend,
});
