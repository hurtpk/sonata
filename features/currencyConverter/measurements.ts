/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Measurements in messages ("5 miles", "6'2\"", "72°F", "180 lbs") shown in
// the other system — metric for you if you use metric, and the other way
// round. Only units that can't be mistaken for something else are picked up
// ("5 m" could be minutes, "20 pounds" could be money, so they're left alone).

import { categoryById, compound, convertUnit, formatNumber, Unit } from "./units";

type Rule = { re: RegExp; cat: string; from: string; };

const N = String.raw`(-?\d+(?:[.,]\d+)?)`;
const W = String.raw`(?![a-z])`;

const RULES: Rule[] = [
    { re: new RegExp(String.raw`${N}\s?(?:km|kms|kilomet(?:er|re)s?)${W}`, "gi"), cat: "length", from: "km" },
    { re: new RegExp(String.raw`${N}\s?(?:miles?|mi)${W}`, "gi"), cat: "length", from: "mi" },
    { re: new RegExp(String.raw`${N}\s?(?:cm|centimet(?:er|re)s?)${W}`, "gi"), cat: "length", from: "cm" },
    { re: new RegExp(String.raw`${N}\s?(?:mm|millimet(?:er|re)s?)${W}`, "gi"), cat: "length", from: "mm" },
    { re: new RegExp(String.raw`${N}\s?(?:met(?:er|re)s?)${W}`, "gi"), cat: "length", from: "m" },
    { re: new RegExp(String.raw`${N}\s?(?:ft|feet|foot)${W}`, "gi"), cat: "length", from: "ft" },
    { re: new RegExp(String.raw`${N}\s?(?:inch(?:es)?)${W}`, "gi"), cat: "length", from: "in" },
    { re: new RegExp(String.raw`${N}\s?(?:yards?|yds?)${W}`, "gi"), cat: "length", from: "yd" },
    { re: new RegExp(String.raw`${N}\s?(?:kg|kgs|kilos?|kilograms?)${W}`, "gi"), cat: "mass", from: "kg" },
    { re: new RegExp(String.raw`${N}\s?(?:grams?)${W}`, "gi"), cat: "mass", from: "g" },
    { re: new RegExp(String.raw`${N}\s?(?:lbs?)${W}`, "gi"), cat: "mass", from: "lb" },
    { re: new RegExp(String.raw`${N}\s?(?:oz|ounces?)${W}`, "gi"), cat: "mass", from: "oz" },
    { re: new RegExp(String.raw`${N}\s?(?:°\s?c|degrees? c(?:elsius)?|celsius)${W}`, "gi"), cat: "temp", from: "c" },
    { re: new RegExp(String.raw`${N}\s?(?:°\s?f|degrees? f(?:ahrenheit)?|fahrenheit)${W}`, "gi"), cat: "temp", from: "f" },
    { re: new RegExp(String.raw`${N}\s?(?:litres?|liters?|l)${W}(?!\/)`, "gi"), cat: "volume", from: "l" },
    { re: new RegExp(String.raw`${N}\s?(?:ml|millilit(?:er|re)s?)${W}`, "gi"), cat: "volume", from: "ml" },
    { re: new RegExp(String.raw`${N}\s?(?:gallons?|gal)${W}`, "gi"), cat: "volume", from: "gal" },
    { re: new RegExp(String.raw`${N}\s?(?:fl\.? ?oz)${W}`, "gi"), cat: "volume", from: "floz" },
    { re: new RegExp(String.raw`${N}\s?(?:km\/h|kmh|kph)${W}`, "gi"), cat: "speed", from: "kmh" },
    { re: new RegExp(String.raw`${N}\s?(?:mph)${W}`, "gi"), cat: "speed", from: "mph" },
];

/** Which unit to show each one in, for the other system. */
const OTHER: Record<string, string> = {
    km: "mi", mi: "km", cm: "in", mm: "in", m: "ft", ft: "m", in: "cm", yd: "m",
    kg: "lb", g: "oz", lb: "kg", oz: "g", c: "f", f: "c",
    l: "gal", ml: "floz", gal: "l", floz: "ml", kmh: "mph", mph: "kmh",
};

const HEIGHT = /\b(\d)\s?(?:'|′|ft)\s?(\d{1,2})\s?(?:"|″|in)?(?![\d.])/g;

export interface Measurement { text: string; out: string; }

export function findMeasurements(content: string, mine: "metric" | "imperial"): Measurement[] {
    const text = content.replace(/```[\s\S]*?```|`[^`]*`|https?:\/\/\S+|<[^>]+>/g, " ");
    const out: Measurement[] = [];
    const taken: [number, number][] = [];
    const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x);

    // Heights like 5'11" first, so the feet aren't read on their own.
    if (mine === "metric") for (const m of text.matchAll(HEIGHT)) {
        const inches = Number(m[1]) * 12 + Number(m[2]);
        if (Number(m[2]) > 11) continue;
        taken.push([m.index!, m.index! + m[0].length]);
        out.push({ text: m[0].trim(), out: `${Math.round(inches * 2.54)} cm` });
    }

    for (const rule of RULES) {
        const cat = categoryById(rule.cat)!;
        const from = cat.units.find(u => u.id === rule.from)!;
        if (!from.system || from.system === mine) continue;
        for (const m of text.matchAll(rule.re)) {
            const a = m.index!, b = a + m[0].length;
            if (!free(a, b)) continue;
            const value = Number(m[1].replace(",", "."));
            if (!Number.isFinite(value)) continue;
            taken.push([a, b]);
            const to = cat.units.find(u => u.id === OTHER[rule.from]) as Unit;
            const v = convertUnit(value, from, to);
            const nice = to.id === "ft" ? compound("length", to, v) : null;
            out.push({ text: m[0].trim(), out: nice ?? `${formatNumber(Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10)} ${to.symbol}` });
        }
    }
    return out.slice(0, 5);
}

/** Your system, from your language setting (US English, and a few others, use imperial). */
export const guessSystem = (): "metric" | "imperial" => /^en-(US|LR)|^my/.test(navigator.language) ? "imperial" : "metric";
