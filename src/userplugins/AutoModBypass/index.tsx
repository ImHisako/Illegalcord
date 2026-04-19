/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const TEXT_STYLES = {
    fraktur: {
        a: "𝔞", b: "𝔟", c: "𝔠", d: "𝔡", e: "𝔢", f: "𝔣", g: "𝔤", h: "𝔥", i: "𝔦", j: "𝔧", k: "𝔨", l: "𝔩", m: "𝔪", n: "𝔫", o: "𝔬", p: "𝔭", q: "𝔮", r: "𝔯", s: "𝔰", t: "𝔱", u: "𝔲", v: "𝔳", w: "𝔴", x: "𝔵", y: "𝔶", z: "𝔷",
        A: "𝔄", B: "𝔅", C: "ℭ", D: "𝔇", E: "𝔈", F: "𝔉", G: "𝔊", H: "ℌ", I: "ℑ", J: "𝔍", K: "𝔎", L: "𝔏", M: "𝔐", N: "𝔑", O: "𝔒", P: "𝔓", Q: "𝔔", R: "ℜ", S: "𝔖", T: "𝔗", U: "𝔘", V: "𝔙", W: "𝔚", X: "𝔛", Y: "𝔜", Z: "ℤ",
    },
    zalgo: {
        a: "̴̺̏̉̈́ă̵̦̼͆̊͊̽", b: "̴̺̏̉̈́b̵̦̼̆͆̊͊̽", c: "̴̺̏̉̈́c̵̦̼̆͆̊͊̽", d: "̴̺̏̉̈́d̵̦̼̆͆̊͊̽", e: "̴̺̏̉̈́ĕ̵̦̼͆̊͊̽", f: "̴̺̏̉̈́f̵̦̼̆͆̊͊̽", g: "̴̺̏̉̈́ğ̵̦̼͆̊͊̽", h: "̴̺̏̉̈́h̵̦̼̆͆̊͊̽", i: "̴̺̏̉̈́ĭ̵̦̼͆̊͊̽", j: "̴̺̏̉̈́j̵̦̼̆͆̊͊̽", k: "̴̺̏̉̈́k̵̦̼̆͆̊͊̽", l: "̴̺̏̉̈́l̵̦̼̆͆̊͊̽", m: "̴̺̏̉̈́m̵̦̼̆͆̊͊̽", n: "̴̺̏̉̈́n̵̦̼̆͆̊͊̽", o: "̴̺̏̉̈́ŏ̵̦̼͆̊͊̽", p: "̴̺̏̉̈́p̵̦̼̆͆̊͊̽", q: "̴̺̏̉̈́q̵̦̼̆͆̊͊̽", r: "̴̺̏̉̈́r̵̦̼̆͆̊͊̽", s: "̴̺̏̉̈́ș̵̼̆͆̊͊̽", t: "̴̺̏̉̈́ț̵̼̆͆̊͊̽", u: "̴̺̏̉̈́ŭ̵̦̼͆̊͊̽", v: "̴̺̏̉̈́v̵̦̼̆͆̊͊̽", w: "̴̺̏̉̈́w̵̦̼̆͆̊͊̽", x: "̴̺̏̉̈́x̵̦̼̆͆̊͊̽", y: "̴̺̏̉̈́y̵̦̼̆͆̊͊̽", z: "̴̺̏̉̈́z̵̦̼̆͆̊͊̽",
        A: "̴̺̏̉̈́Ă̵̦̼͆̊͊̽", B: "̴̺̏̉̈́B̵̦̼̆͆̊͊̽", C: "̴̺̏̉̈́C̵̦̼̆͆̊͊̽", D: "̴̺̏̉̈́D̵̦̼̆͆̊͊̽", E: "̴̺̏̉̈́Ĕ̵̦̼͆̊͊̽", F: "̴̺̏̉̈́F̵̦̼̆͆̊͊̽", G: "̴̺̏̉̈́Ğ̵̦̼͆̊͊̽", H: "̴̺̏̉̈́H̵̦̼̆͆̊͊̽", I: "̴̺̏̉̈́Ĭ̵̦̼͆̊͊̽", J: "̴̺̏̉̈́J̵̦̼̆͆̊͊̽", K: "̴̺̏̉̈́K̵̦̼̆͆̊͊̽", L: "̴̺̏̉̈́L̵̦̼̆͆̊͊̽", M: "̴̺̏̉̈́M̵̦̼̆͆̊͊̽", N: "̴̺̏̉̈́N̵̦̼̆͆̊͊̽", O: "̴̺̏̉̈́Ŏ̵̦̼͆̊͊̽", P: "̴̺̏̉̈́P̵̦̼̆͆̊͊̽", Q: "̴̺̏̉̈́Q̵̦̼̆͆̊͊̽", R: "̴̺̏̉̈́R̵̦̼̆͆̊͊̽", S: "̴̺̏̉̈́Ș̵̼̆͆̊͊̽", T: "̴̺̏̉̈́Ț̵̼̆͆̊͊̽", U: "̴̺̏̉̈́Ŭ̵̦̼͆̊͊̽", V: "̴̺̏̉̈́V̵̦̼̆͆̊͊̽", W: "̴̺̏̉̈́W̵̦̼̆͆̊͊̽", X: "̴̺̏̉̈́X̵̦̼̆͆̊͊̽", Y: "̴̺̏̉̈́Y̵̦̼̆͆̊͊̽", Z: "̴̺̏̉̈́Z̵̦̼̆͆̊͊̽",
    },
    squared: {
        a: "🅰", b: "🅱", c: "🅲", d: "🅳", e: "🅴", f: "🅵", g: "🅶", h: "🅷", i: "🅸", j: "🅹", k: "🅺", l: "🅻", m: "🅼", n: "🅽", o: "🅾", p: "🅿", q: "🆀", r: "🆁", s: "🆂", t: "🆃", u: "🆄", v: "🆅", w: "🆆", x: "🆇", y: "🆈", z: "🆉",
        A: "🅰", B: "🅱", C: "🅲", D: "🅳", E: "🅴", F: "🅵", G: "🅶", H: "🅷", I: "🅸", J: "🅹", K: "🅺", L: "🅻", M: "🅼", N: "🅽", O: "🅾", P: "🅿", Q: "🆀", R: "🆁", S: "🆂", T: "🆃", U: "🆄", V: "🆅", W: "🆆", X: "🆇", Y: "🆈", Z: "🆉",
    },
    circled: {
        a: "ⓐ", b: "ⓑ", c: "ⓒ", d: "ⓓ", e: "ⓔ", f: "ⓕ", g: "ⓖ", h: "ⓗ", i: "ⓘ", j: "ⓙ", k: "ⓚ", l: "ⓛ", m: "ⓜ", n: "ⓝ", o: "ⓞ", p: "ⓟ", q: "ⓠ", r: "ⓡ", s: "ⓢ", t: "ⓣ", u: "ⓤ", v: "ⓥ", w: "ⓦ", x: "ⓧ", y: "ⓨ", z: "ⓩ",
        A: "Ⓐ", B: "Ⓑ", C: "Ⓒ", D: "Ⓓ", E: "Ⓔ", F: "Ⓕ", G: "Ⓖ", H: "Ⓗ", I: "Ⓘ", J: "Ⓙ", K: "Ⓚ", L: "Ⓛ", M: "Ⓜ", N: "Ⓝ", O: "Ⓞ", P: "Ⓟ", Q: "Ⓠ", R: "Ⓡ", S: "Ⓢ", T: "Ⓣ", U: "Ⓤ", V: "Ⓥ", W: "Ⓦ", X: "Ⓧ", Y: "Ⓨ", Z: "Ⓩ",
    },
    boldItalic: {
        a: "𝙖", b: "𝙗", c: "𝙘", d: "𝙙", e: "𝙚", f: "𝙛", g: "𝙜", h: "𝙝", i: "𝙞", j: "𝙟", k: "𝙠", l: "𝙡", m: "𝙢", n: "𝙣", o: "𝙤", p: "𝙥", q: "𝙦", r: "𝙧", s: "𝙨", t: "𝙩", u: "𝙪", v: "𝙫", w: "𝙬", x: "𝙭", y: "𝙮", z: "𝙯",
        A: "𝘼", B: "𝘽", C: "𝘾", D: "𝘿", E: "𝙀", F: "𝙁", G: "𝙂", H: "𝙃", I: "𝙄", J: "𝙅", K: "𝙆", L: "𝙇", M: "𝙈", N: "𝙉", O: "𝙊", P: "𝙋", Q: "𝙌", R: "𝙍", S: "𝙎", T: "𝙏", U: "𝙐", V: "𝙑", W: "𝙒", X: "𝙓", Y: "𝙔", Z: "𝙕",
    },
    custom1: {
        Q: "Q", W: "Щ", E: "Σ", R: "Я", T: "Ƭ", Y: "Y", U: "Ц", I: "I", O: "Ө", P: "P", L: "ᄂ", K: "K", J: "J", H: "Ή", G: "G", F: "F", D: "Ƨ", S: "Λ", A: "A", Z: "Z", X: "X", C: "ᄃ", V: "V", B: "B", N: "П", M: "M",
        q: "q", w: "w", e: "e", r: "r", t: "t", y: "y", u: "u", i: "i", o: "o", p: "p", l: "l", k: "k", j: "j", h: "h", g: "g", f: "f", d: "d", s: "s", a: "a", z: "z", x: "x", c: "c", v: "v", b: "b", n: "n", m: "m",
    },
    custom2: {
        Q: "Q", W: "₩", E: "Ɇ", R: "Ɽ", T: "₮", Y: "Ɏ", U: "Ʉ", I: "ł", O: "Ø", P: "₱", L: "Ⱡ", K: "₭", J: "J", H: "Ⱨ", G: "₲", F: "₣", D: "Đ", S: "₴", A: "₳", Z: "Ⱬ", X: "Ӿ", C: "₵", V: "V", B: "฿", N: "₦", M: "₥",
        q: "q", w: "w", e: "e", r: "r", t: "t", y: "y", u: "u", i: "i", o: "o", p: "p", l: "l", k: "k", j: "j", h: "h", g: "g", f: "f", d: "d", s: "s", a: "a", z: "z", x: "x", c: "c", v: "v", b: "b", n: "n", m: "m",
    },
    custom3: {
        Q: "Ɋ", W: "山", E: "乇", R: "尺", T: "ㄒ", Y: "ㄚ", U: "ㄩ", I: "丨", O: "卩", P: "卩", L: "ㄥ", K: "Ҝ", J: "ﾌ", H: "卄", G: "Ꮆ", F: "千", D: "ᗪ", S: "丂", A: "卂", Z: "乙", X: "乂", C: "匚", V: "ᐯ", B: "乃", N: "几", M: "爪",
        q: "q", w: "w", e: "e", r: "r", t: "t", y: "y", u: "u", i: "i", o: "o", p: "p", l: "l", k: "k", j: "j", h: "h", g: "g", f: "f", d: "d", s: "s", a: "a", z: "z", x: "x", c: "c", v: "v", b: "b", n: "n", m: "m",
    },
    fullWidth: {
        a: "ａ", b: "ｂ", c: "ｃ", d: "ｄ", e: "ｅ", f: "ｆ", g: "ｇ", h: "ｈ", i: "ｉ", j: "ｊ", k: "ｋ", l: "ｌ", m: "ｍ", n: "ｎ", o: "ｏ", p: "ｐ", q: "ｑ", r: "ｒ", s: "ｓ", t: "ｔ", u: "ｕ", v: "ｖ", w: "ｗ", x: "ｘ", y: "ｙ", z: "ｚ",
        A: "Ａ", B: "Ｂ", C: "Ｃ", D: "Ｄ", E: "Ｅ", F: "Ｆ", G: "Ｇ", H: "Ｈ", I: "Ｉ", J: "Ｊ", K: "Ｋ", L: "Ｌ", M: "Ｍ", N: "Ｎ", O: "Ｏ", P: "Ｐ", Q: "Ｑ", R: "Ｒ", S: "Ｓ", T: "Ｔ", U: "Ｕ", V: "Ｖ", W: "Ｗ", X: "Ｘ", Y: "Ｙ", Z: "Ｚ",
    },
    strikethrough: {
        a: "a̶", b: "b̶", c: "c̶", d: "d̶", e: "e̶", f: "f̶", g: "g̶", h: "h̶", i: "i̶", j: "j̶", k: "k̶", l: "l̶", m: "m̶", n: "n̶", o: "o̶", p: "p̶", q: "q̶", r: "r̶", s: "s̶", t: "t̶", u: "u̶", v: "v̶", w: "w̶", x: "x̶", y: "y̶", z: "z̶",
        A: "A̶", B: "B̶", C: "C̶", D: "D̶", E: "E̶", F: "F̶", G: "G̶", H: "H̶", I: "I̶", J: "J̶", K: "K̶", L: "L̶", M: "M̶", N: "N̶", O: "O̶", P: "P̶", Q: "Q̶", R: "R̶", S: "S̶", T: "T̶", U: "U̶", V: "V̶", W: "W̶", X: "X̶", Y: "Y̶", Z: "Z̶",
    },
    invisibleSeparator: {
        a: "a⁠", b: "b⁠", c: "c⁠", d: "d⁠", e: "e⁠", f: "f⁠", g: "g⁠", h: "h⁠", i: "i⁠", j: "j⁠", k: "k⁠", l: "l⁠", m: "m⁠", n: "n⁠", o: "o⁠", p: "p⁠", q: "q⁠", r: "r⁠", s: "s⁠", t: "t⁠", u: "u⁠", v: "v⁠", w: "w⁠", x: "x⁠", y: "y⁠", z: "z⁠",
        A: "A⁠", B: "B⁠", C: "C⁠", D: "D⁠", E: "E⁠", F: "F⁠", G: "G⁠", H: "H⁠", I: "I⁠", J: "J⁠", K: "K⁠", L: "L⁠", M: "M⁠", N: "N⁠", O: "O⁠", P: "P⁠", Q: "Q⁠", R: "R⁠", S: "S⁠", T: "T⁠", U: "U⁠", V: "V⁠", W: "W⁠", X: "X⁠", Y: "Y⁠", Z: "Z⁠",
    },
    undetected: {
        q: "q⁠", w: "w⁠", е: "е⁠", r: "r⁠", т: "т⁠", у: "у⁠", ц: "ц⁠", і: "і⁠", о: "о⁠", р: "р⁠", l: "l⁠", к: "к⁠", ј: "ј⁠", н: "н⁠", g: "g⁠", f: "f⁠", d: "d⁠", ѕ: "ѕ⁠", а: "а⁠", ᴢ: "ᴢ⁠", х: "х⁠", с: "с⁠", v: "v⁠", Ь: "Ь⁠", п: "п⁠", м: "м⁠",
    },
};

export type TextStyle = keyof typeof TEXT_STYLES;

const settings = definePluginSettings({
    textStyle: {
        type: OptionType.SELECT,
        description: "Choose which text style to use",
        default: "fraktur" as TextStyle,
        options: [
            { label: "Fraktur (Gothic)", value: "fraktur", default: true },
            { label: "Zalgo (Cursed)", value: "zalgo" },
            { label: "Squared", value: "squared" },
            { label: "Circled", value: "circled" },
            { label: "Bold Italic", value: "boldItalic" },
            { label: "Custom Style 1", value: "custom1" },
            { label: "Custom Style 2", value: "custom2" },
            { label: "Custom Style 3", value: "custom3" },
            { label: "Full Width", value: "fullWidth" },
            { label: "Strikethrough", value: "strikethrough" },
            { label: "Invisible Separator", value: "invisibleSeparator" },
            { label: "Undetected (Anti-Cheat)", value: "undetected" },
        ],
    },
});

function transformText(text: string, style: TextStyle): string {
    const map = TEXT_STYLES[style];
    return text.split("").map(char => map[char] ?? char).join("");
}

export default definePlugin({
    name: "AutoModBypass",
    description: "Transforms your messages into various text styles (Fraktur, Zalgo, Squared, etc.) for automod bypass & Fun",
    authors: [{ name: "Irritably", id: 928787166916640838n }],
    tags: ["Chat", "Fun"],
    enabledByDefault: false,
    settings,

    onBeforeMessageSend(_channelId, messageObj) {
        if (!messageObj.content) return;

        messageObj.content = transformText(messageObj.content, settings.store.textStyle as TextStyle);
    },
});
