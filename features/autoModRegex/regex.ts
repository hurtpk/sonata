/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Turns a word list into Discord AutoMod regex patterns (Rust flavour):
// look-alike symbols, Cyrillic look-alikes, spacing, stretched letters.
// Discord allows 10 patterns per rule and 260 characters per pattern.

export const MAX_LEN = 260;
export const PER_RULE = 10;

export interface Opts {
    leet: boolean;
    homoglyphs: boolean;
    separators: boolean;
    stretch: boolean;
    wordStart: boolean;
    ignoreCase: boolean;
    vowelSwap: boolean;
}

const LEET: Record<string, string> = {
    a: "4@", b: "8", c: "(", e: "3", g: "9", i: "1!|l", l: "1|i",
    o: "0", s: "5$z", t: "7+", z: "2s",
};

const HOMOGLYPH: Record<string, string> = {
    a: "\u0430", c: "\u0441", e: "\u0435", i: "\u0456",
    o: "\u043e", p: "\u0440", x: "\u0445", y: "\u0443",
};

const escapeClass = (c: string) => c.replace(/[\\\]\[^-]/g, "\\$&");
const escapeLiteral = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Any one character in place of a vowel (fxggot). Only for longer terms, where it can't match half the dictionary.
const VOWEL_SWAP_MIN = 5;

function build(word: string, o: Opts, anywhere: boolean): string {
    const sep = o.separators ? "[\\W_]*" : "";
    const swap = o.vowelSwap && word.replace(/[^a-z]/gi, "").length >= VOWEL_SWAP_MIN;
    const parts = [...word.toLowerCase().replace(/\s+/g, "")].map(ch => {
        if (!/[a-z]/.test(ch)) return escapeLiteral(ch);
        if (swap && "aeiou".includes(ch)) return "\\S";

        const set = new Set<string>([ch]);
        if (o.leet) for (const c of LEET[ch] ?? "") set.add(c);
        if (o.homoglyphs && HOMOGLYPH[ch]) set.add(HOMOGLYPH[ch]);

        const atom = set.size > 1 ? `[${[...set].map(escapeClass).join("")}]` : ch;
        return o.stretch ? `${atom}+` : atom;
    });
    return (o.ignoreCase ? "(?i)" : "") + (o.wordStart && !anywhere ? "\\b" : "") + parts.join(sep);
}

function isValid(p: string) {
    try { new RegExp(p.replace(/^\(\?i\)/, "")); return p.length > 0; } catch { return false; }
}

// The most aggressive pattern first; back off until it fits in 260 characters.
function best(word: string, o: Opts, anywhere: boolean): string | null {
    const tiers: Opts[] = [
        o,
        { ...o, vowelSwap: false },
        { ...o, homoglyphs: false, vowelSwap: false },
        { ...o, homoglyphs: false, leet: false, vowelSwap: false },
        { ...o, homoglyphs: false, leet: false, stretch: false, vowelSwap: false },
        { ...o, homoglyphs: false, leet: false, stretch: false, separators: false, vowelSwap: false },
    ];
    for (const t of tiers) {
        const p = build(word, t, anywhere);
        if (p.length <= MAX_LEN && isValid(p)) return p;
    }
    return null;
}

export interface Generated { rules: string[][]; skipped: number[]; short: number; total: number; }

export function generate(input: string, o: Opts): Generated {
    const seen = new Set<string>();
    const patterns: string[] = [];
    const skipped: number[] = [];
    let short = 0;

    input.split(/\r?\n/).forEach((raw, idx) => {
        let word = raw.trim();
        if (!word || word.startsWith("#")) return;

        // A * in front means "anywhere inside a word" (lolxxxx, xxxxlol): no word-start check for this term.
        const anywhere = word.startsWith("*");
        if (anywhere) word = word.replace(/^\*+/, "").trim();
        if (!word) return;

        const key = (anywhere ? "*" : "") + word.toLowerCase().replace(/\s+/g, "");
        if (seen.has(key)) return;
        seen.add(key);

        if (key.replace(/[^a-z]/g, "").length < 4) short++;

        const p = best(word, o, anywhere);
        if (p) patterns.push(p);
        else skipped.push(idx + 1);
    });

    const rules: string[][] = [];
    for (let i = 0; i < patterns.length; i += PER_RULE) rules.push(patterns.slice(i, i + PER_RULE));
    return { rules, skipped, short, total: patterns.length };
}
