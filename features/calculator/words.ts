/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Numbers as words and Roman numerals (used by the Calculator and the Converter).

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", "thousand", "million", "billion", "trillion", "quadrillion", "quintillion"];

function under1000(n: number): string {
    const out: string[] = [];
    if (n >= 100) { out.push(`${ONES[Math.floor(n / 100)]} hundred`); n %= 100; }
    if (n >= 20) out.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ""));
    else if (n > 0 || !out.length) out.push(ONES[n]);
    return out.join(" ");
}

/** 1234.5 → "one thousand two hundred thirty-four point five". */
export function numberToWords(value: number): string {
    if (!Number.isFinite(value)) return "—";
    if (Math.abs(value) >= 1e21) return "too big to say";
    const neg = value < 0;
    const [intPart, frac = ""] = Math.abs(value).toFixed(Number.isInteger(value) ? 0 : Math.min(6, (String(value).split(".")[1] ?? "").length)).split(".");
    let n = BigInt(intPart);
    const groups: string[] = [];
    if (n === 0n) groups.push("zero");
    for (let i = 0; n > 0n; i++, n /= 1000n) {
        const g = Number(n % 1000n);
        if (g) groups.unshift(`${under1000(g)}${SCALES[i] ? ` ${SCALES[i]}` : ""}`);
    }
    let words = groups.join(" ");
    const f = frac.replace(/0+$/, "");
    if (f) words += ` point ${[...f].map(d => ONES[Number(d)]).join(" ")}`;
    return neg ? `minus ${words}` : words;
}

const ROMAN: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];

/** 1–3999 → "MCMXCIX" (null outside that). */
export function toRoman(n: number): string | null {
    if (!Number.isInteger(n) || n < 1 || n > 3999) return null;
    let out = "";
    for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
    return out;
}

/** "MCMXCIX" → 1999 (null if it isn't a proper Roman numeral). */
export function fromRoman(s: string): number | null {
    const t = s.trim().toUpperCase();
    if (!/^[MDCLXVI]+$/.test(t)) return null;
    let n = 0;
    for (let i = 0; i < t.length; i++) {
        const v = ROMAN.find(r => r[1] === t[i])![0], next = ROMAN.find(r => r[1] === t[i + 1])?.[0] ?? 0;
        n += v < next ? -v : v;
    }
    return toRoman(n) === t ? n : null;
}
