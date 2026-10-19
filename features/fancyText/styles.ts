/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Unicode text styles, kept free of Discord so they can be tested on their own.

export interface TextStyle {
    id: string;
    name: string;
    convert(text: string): string;
}

const A = 65, Z = 90, a = 97, z = 122, ZERO = 48, NINE = 57;

/** Letters (and optionally digits) shifted into a Unicode block, with the odd letters that live elsewhere. */
function block(upper: number, lower: number | null, digits: number | null, exceptions: Record<string, number> = {}) {
    return (text: string) => Array.from(text, ch => {
        if (ch in exceptions) return String.fromCodePoint(exceptions[ch]);
        const c = ch.codePointAt(0)!;
        if (c >= A && c <= Z) return String.fromCodePoint(upper + c - A);
        if (c >= a && c <= z) return lower == null ? String.fromCodePoint(upper + c - a) : String.fromCodePoint(lower + c - a);
        if (digits != null && c >= ZERO && c <= NINE) return String.fromCodePoint(digits + c - ZERO);
        return ch;
    }).join("");
}

function charMap(map: Record<string, string>) {
    return (text: string) => Array.from(text, ch => map[ch] ?? ch).join("");
}

function zip(from: string, to: string) {
    const f = Array.from(from), t = Array.from(to);
    return Object.fromEntries(f.map((ch, i) => [ch, t[i]]));
}

const SMALL_CAPS = zip("abcdefghijklmnopqrstuvwxyz", "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ");

const UPSIDE_DOWN: Record<string, string> = {
    ...zip("abcdefghijklmnopqrstuvwxyz", "ɐqɔpǝɟƃɥᴉɾʞlɯuodbɹsʇnʌʍxʎz"),
    ...zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "∀ᗺƆᗡƎℲ⅁HIſʞ˥WNOԀΌᴚS⊥∩ΛMX⅄Z"),
    ...zip("0123456789", "0ƖᄅƐㄣϛ9ㄥ86"),
    ...zip(".,'\"!?()[]{}<>_&;", "˙',„¡¿)(][}{><‾⅋؛"),
};

const CIRCLED_DIGITS = ["⓪", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];
const NEGATIVE_DIGITS = ["⓿", "❶", "❷", "❸", "❹", "❺", "❻", "❼", "❽", "❾"];

const withDigits = (convert: (t: string) => string, digits: string[]) =>
    (text: string) => convert(text).replace(/[0-9]/g, d => digits[Number(d)]);

/** Adds a combining mark after every character (not after spaces or line breaks). */
const combining = (mark: string) => (text: string) => Array.from(text, ch => /\s/.test(ch) ? ch : ch + mark).join("");

export const STYLES: TextStyle[] = [
    { id: "bold", name: "Bold", convert: block(0x1D5D4, 0x1D5EE, 0x1D7EC) },
    { id: "italic", name: "Italic", convert: block(0x1D608, 0x1D622, null) },
    { id: "boldItalic", name: "Bold italic", convert: block(0x1D63C, 0x1D656, null) },
    { id: "serifBold", name: "Serif bold", convert: block(0x1D400, 0x1D41A, 0x1D7CE) },
    { id: "serifItalic", name: "Serif italic", convert: block(0x1D434, 0x1D44E, null, { h: 0x210E }) },
    {
        id: "script", name: "Script", convert: block(0x1D49C, 0x1D4B6, null, {
            B: 0x212C, E: 0x2130, F: 0x2131, H: 0x210B, I: 0x2110, L: 0x2112, M: 0x2133, R: 0x211B, e: 0x212F, g: 0x210A, o: 0x2134,
        })
    },
    { id: "boldScript", name: "Bold script", convert: block(0x1D4D0, 0x1D4EA, null) },
    { id: "fraktur", name: "Gothic", convert: block(0x1D504, 0x1D51E, null, { C: 0x212D, H: 0x210C, I: 0x2111, R: 0x211C, Z: 0x2128 }) },
    { id: "boldFraktur", name: "Bold gothic", convert: block(0x1D56C, 0x1D586, null) },
    { id: "doubleStruck", name: "Outline", convert: block(0x1D538, 0x1D552, 0x1D7D8, { C: 0x2102, H: 0x210D, N: 0x2115, P: 0x2119, Q: 0x211A, R: 0x211D, Z: 0x2124 }) },
    { id: "monospace", name: "Monospace", convert: block(0x1D670, 0x1D68A, 0x1D7F6) },
    { id: "smallCaps", name: "Small caps", convert: text => charMap(SMALL_CAPS)(text.toLowerCase()) },
    { id: "bubbles", name: "Bubbles", convert: withDigits(block(0x24B6, 0x24D0, null), CIRCLED_DIGITS) },
    { id: "darkBubbles", name: "Dark bubbles", convert: withDigits(block(0x1F150, null, null), NEGATIVE_DIGITS) },
    { id: "squares", name: "Squares", convert: block(0x1F130, null, null) },
    {
        id: "wide", name: "Wide", convert: text => Array.from(text, ch => {
            const c = ch.codePointAt(0)!;
            if (c === 32) return "　";
            return c > 32 && c < 127 ? String.fromCodePoint(c + 0xFEE0) : ch;
        }).join("")
    },
    { id: "upsideDown", name: "Upside down", convert: text => Array.from(charMap(UPSIDE_DOWN)(text)).reverse().join("") },
    { id: "strike", name: "Strikethrough", convert: combining("̶") },
    { id: "underline", name: "Underline", convert: combining("̲") },
    { id: "spaced", name: "S p a c e d", convert: text => Array.from(text).join(" ") },
];

/* ── Your own styles: a letter style plus extras ── */

export interface CustomStyle {
    id: string;
    name: string;
    /** One of STYLES' ids, or "plain" for the letters as typed. */
    base: string;
    /** Put between letters (e.g. " ", "♡", "·"). */
    between?: string;
    underline?: boolean;
    strike?: boolean;
    before?: string;
    after?: string;
}

/** Turns your own style into a converter. */
export function customConvert(c: CustomStyle) {
    const base = STYLES.find(s => s.id === c.base)?.convert ?? ((t: string) => t);
    return (text: string) => {
        let out = base(text);
        if (c.between) out = Array.from(out).map((ch, i, all) => i < all.length - 1 && !/\s/.test(ch) && !/\s/.test(all[i + 1]) ? ch + c.between : ch).join("");
        if (c.underline) out = combining("̲")(out);
        if (c.strike) out = combining("̶")(out);
        return `${c.before ?? ""}${out}${c.after ?? ""}`;
    };
}

/** Letter styles you can build on (the ones that only add marks or spacing are extras instead). */
export const BASES = STYLES.filter(s => !["strike", "underline", "spaced"].includes(s.id));

/** Ready-made wraps to start from. */
export const WRAPS: [string, string][] = [["꧁", "꧂"], ["★ ", " ★"], ["『", "』"], ["✧･ﾟ ", " ﾟ･✧"], ["▄︻デ ", " ══━一"], ["♡ ", " ♡"], ["【", "】"], ["⋆｡˚ ", " ˚｡⋆"]];
