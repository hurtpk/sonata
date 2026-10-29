/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sonata's accent: one colour, a gradient of two, the colours of today's
// season or holiday, or the colours of whatever's playing on Spotify. Everything else in Sonata is
// shaded from --sn-accent and --sn-accent-2.

import { FluxDispatcher } from "@webpack/common";

export type AccentMode = "solid" | "gradient" | "seasonal" | "album";

export interface GradientPreset { id: string; name: string; a: string; b: string; }

export const GRADIENTS: GradientPreset[] = [
    { id: "aurora", name: "Aurora", a: "#22d3ee", b: "#8b5cf6" },
    { id: "sunset", name: "Sunset", a: "#f97316", b: "#ec4899" },
    { id: "ocean", name: "Ocean", a: "#06b6d4", b: "#3b82f6" },
    { id: "ember", name: "Ember", a: "#ef4444", b: "#f59e0b" },
    { id: "lagoon", name: "Lagoon", a: "#10b981", b: "#06b6d4" },
    { id: "candy", name: "Candy", a: "#f472b6", b: "#a78bfa" },
    { id: "royal", name: "Royal", a: "#6366f1", b: "#c026d3" },
    { id: "spotify", name: "Spotify", a: "#1ed760", b: "#14b8a6" },
    { id: "peach", name: "Peach", a: "#fb923c", b: "#fda4af" },
    { id: "frost", name: "Frost", a: "#7dd3fc", b: "#818cf8" },
];

export const DEFAULT_ACCENT = "#c58d91";
export const validHex = (v: unknown): v is string => typeof v === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
const hexOr = (v: unknown, fallback: string) => validHex(v) ? v.trim() : fallback;

/** The settings that make up the accent. */
export interface AccentSettings {
    sonataAccentMode?: AccentMode;
    aboutAmbientColor?: string;
    sonataGradient?: string;
    sonataGradientA?: string;
    sonataGradientB?: string;
    sonataHolidays?: boolean;
    sonataSouthern?: boolean;
    /** A season or holiday ID to always use, or "current" to follow the date. */
    sonataOccasion?: string;
}

/** The two colours the accent is right now. */
export function accentColors(s: AccentSettings): [string, string] {
    const solid = hexOr(s.aboutAmbientColor, DEFAULT_ACCENT);
    switch (s.sonataAccentMode) {
        case "gradient": {
            if (s.sonataGradient === "custom") return [hexOr(s.sonataGradientA, "#22d3ee"), hexOr(s.sonataGradientB, "#8b5cf6")];
            const g = GRADIENTS.find(x => x.id === s.sonataGradient) ?? GRADIENTS[0];
            return [g.a, g.b];
        }
        case "seasonal": return chosenOccasion(s).colors;
        case "album": return album.colors ?? [solid, solid];
        default: return [solid, solid];
    }
}

// ─── Seasons & holidays ───

export interface Occasion {
    id: string;
    name: string;
    emoji: string;
    colors: [string, string];
    kind: "season" | "holiday";
}

export const SEASONS: Occasion[] = [
    { id: "spring", name: "Spring", emoji: "🌸", colors: ["#f9a8d4", "#86efac"], kind: "season" },
    { id: "summer", name: "Summer", emoji: "☀️", colors: ["#fbbf24", "#22d3ee"], kind: "season" },
    { id: "autumn", name: "Autumn", emoji: "🍂", colors: ["#f59e0b", "#dc2626"], kind: "season" },
    { id: "winter", name: "Winter", emoji: "❄️", colors: ["#7dd3fc", "#c4b5fd"], kind: "season" },
];

export interface Holiday extends Occasion {
    /** The days it covers in a given year (inclusive, local dates). */
    days(year: number): [Date, Date];
}

/** Easter Sunday (the Gregorian "anonymous" algorithm). */
function easter(year: number) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
}

/** Lunar New Year (from a table — the lunar calendar isn't a simple formula). */
function lunarNewYear(year: number) {
    const table: Record<number, [number, number]> = {
        2024: [2, 10], 2025: [1, 29], 2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13], 2030: [2, 3],
        2031: [1, 23], 2032: [2, 11], 2033: [1, 31], 2034: [2, 19], 2035: [2, 8], 2036: [1, 28],
    };
    const [m, d] = table[year] ?? [2, 1];
    return new Date(year, m - 1, d);
}

/** The nth weekday (0 = Sunday) of a month (0 = January). */
function nthWeekday(year: number, month: number, weekday: number, n: number) {
    const first = new Date(year, month, 1).getDay();
    return new Date(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const dayOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const HOLIDAYS: Holiday[] = [
    { id: "newyear", name: "New Year", emoji: "🎆", colors: ["#fbbf24", "#6366f1"], kind: "holiday", days: y => [day(y, 1, 1), day(y, 1, 2)] },
    { id: "lunar", name: "Lunar New Year", emoji: "🏮", colors: ["#ef4444", "#facc15"], kind: "holiday", days: y => { const d = lunarNewYear(y); return [d, addDays(d, 2)]; } },
    { id: "valentines", name: "Valentine's Day", emoji: "💘", colors: ["#fb7185", "#f9a8d4"], kind: "holiday", days: y => [day(y, 2, 10), day(y, 2, 14)] },
    { id: "patricks", name: "St Patrick's Day", emoji: "☘️", colors: ["#22c55e", "#a3e635"], kind: "holiday", days: y => [day(y, 3, 15), day(y, 3, 17)] },
    { id: "easter", name: "Easter", emoji: "🐣", colors: ["#f9a8d4", "#a5f3fc"], kind: "holiday", days: y => { const d = easter(y); return [addDays(d, -2), addDays(d, 1)]; } },
    { id: "earth", name: "Earth Day", emoji: "🌍", colors: ["#22c55e", "#3b82f6"], kind: "holiday", days: y => [day(y, 4, 22), day(y, 4, 22)] },
    { id: "pride", name: "Pride Month", emoji: "🏳️‍🌈", colors: ["#f472b6", "#60a5fa"], kind: "holiday", days: y => [day(y, 6, 1), day(y, 6, 30)] },
    { id: "halloween", name: "Halloween", emoji: "🎃", colors: ["#f97316", "#8b5cf6"], kind: "holiday", days: y => [day(y, 10, 24), day(y, 10, 31)] },
    { id: "thanksgiving", name: "Thanksgiving", emoji: "🦃", colors: ["#d97706", "#b45309"], kind: "holiday", days: y => { const d = nthWeekday(y, 10, 4, 4); return [addDays(d, -1), d]; } },
    { id: "christmas", name: "Christmas", emoji: "🎄", colors: ["#ef4444", "#22c55e"], kind: "holiday", days: y => [day(y, 12, 18), day(y, 12, 26)] },
    { id: "nye", name: "New Year's Eve", emoji: "🥂", colors: ["#fbbf24", "#a78bfa"], kind: "holiday", days: y => [day(y, 12, 30), day(y, 12, 31)] },
];

function seasonOn(date: Date, southern: boolean) {
    // Meteorological seasons: Mar–May spring, Jun–Aug summer, Sep–Nov autumn, Dec–Feb winter.
    let idx = Math.floor(((date.getMonth() + 10) % 12) / 3);
    if (southern) idx = (idx + 2) % 4;
    return SEASONS[idx];
}

/** The holiday on that date, if any. */
export function holidayOn(date: Date): Holiday | undefined {
    const t = dayOnly(date).getTime();
    return HOLIDAYS.find(h => { const [a, b] = h.days(date.getFullYear()); return t >= a.getTime() && t <= b.getTime(); });
}

/** What the accent is on a date: a holiday if one's on (and holidays are wanted), otherwise the season. */
export function occasionOn(date: Date, holidays: boolean, southern: boolean): Occasion & { until: Date; } {
    const h = holidays ? holidayOn(date) : undefined;
    if (h) return { ...h, until: h.days(date.getFullYear())[1] };
    const season = seasonOn(date, southern);
    let end = dayOnly(date);
    while (seasonOn(addDays(end, 1), southern).id === season.id) end = addDays(end, 1);
    return { ...season, until: end };
}

/** The occasion the accent uses: the one you picked, or today's (holiday first, then season). */
export function chosenOccasion(s: AccentSettings, date = new Date()): Occasion & { until?: Date; } {
    const picked = s.sonataOccasion && s.sonataOccasion !== "current"
        ? [...SEASONS, ...HOLIDAYS].find(o => o.id === s.sonataOccasion)
        : undefined;
    return picked ?? occasionOn(date, s.sonataHolidays !== false, !!s.sonataSouthern);
}

/** The next few holidays coming up. */
export function upcomingHolidays(from: Date, count: number) {
    const today = dayOnly(from).getTime();
    const list: { holiday: Holiday; start: Date; }[] = [];
    for (const y of [from.getFullYear(), from.getFullYear() + 1]) {
        for (const h of HOLIDAYS) {
            const [start] = h.days(y);
            if (start.getTime() > today) list.push({ holiday: h, start });
        }
    }
    return list.sort((a, b) => a.start.getTime() - b.start.getTime()).slice(0, count);
}

// ─── Colour maths ───

function hslHex(h: number, s: number, l: number) {
    h = ((h % 360) + 360) % 360;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return "#" + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

function rgbHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
}

/**
 * The two strongest colours in a picture, made vivid enough to be an accent:
 * hues are weighted by how colourful each pixel is, and the second colour has
 * to be a clearly different hue (or it's a shifted version of the first).
 */
export function paletteOf(img: CanvasImageSource): [string, string] | null {
    const c = document.createElement("canvas");
    c.width = c.height = 40;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, 40, 40);
    let data: Uint8ClampedArray;
    try { data = ctx.getImageData(0, 0, 40, 40).data; } catch { return null; }

    const buckets = Array.from({ length: 24 }, () => ({ w: 0, s: 0, l: 0 }));
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const [h, s, l] = rgbHsl(data[i], data[i + 1], data[i + 2]);
        // Greys, near-black and near-white say little about the cover's colour.
        const w = s * (1 - Math.abs(l - 0.5) * 1.6);
        if (w <= 0.05) continue;
        const b = buckets[Math.floor(h / 15) % 24];
        b.w += w; b.s += s * w; b.l += l * w;
    }
    const ranked = buckets.map((b, i) => ({ ...b, hue: i * 15 + 7.5 })).filter(b => b.w > 0).sort((x, y) => y.w - x.w);
    if (!ranked.length) return null;
    const vivid = (b: typeof ranked[number]) => hslHex(b.hue, Math.max(0.55, Math.min(0.95, b.s / b.w)), Math.max(0.5, Math.min(0.66, b.l / b.w)));
    const first = ranked[0];
    const second = ranked.find(b => {
        const d = Math.abs(b.hue - first.hue);
        return Math.min(d, 360 - d) >= 40 && b.w > first.w * 0.12;
    });
    return [vivid(first), second ? vivid(second) : hslHex(first.hue + 40, 0.8, 0.62)];
}

// ─── Album art ───

interface AlbumState { url: string | null; title: string | null; colors: [string, string] | null; }
const album: AlbumState = { url: null, title: null, colors: null };
const listeners = new Set<() => void>();

export const albumState = (): Readonly<AlbumState> => album;
export function onAlbumChange(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

function setAlbum(url: string | null, title: string | null) {
    if (url === album.url) return;
    album.url = url;
    album.title = title;
    if (!url) {
        album.colors = null;
        listeners.forEach(fn => fn());
        return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
        if (album.url !== url) return;
        album.colors = paletteOf(img);
        listeners.forEach(fn => fn());
    };
    img.onerror = () => { if (album.url === url) { album.colors = null; listeners.forEach(fn => fn()); } };
    img.src = url;
}

function onPlayerState(e: any) {
    const track = e?.track;
    const url: string | undefined = track?.album?.image?.url ?? track?.album?.images?.[0]?.url;
    setAlbum(e?.isPlaying !== false && url ? url : null, track ? `${track.name}${track.artists?.length ? ` — ${track.artists.map((a: any) => a.name).join(", ")}` : ""}` : null);
}

/** Follow what's playing on Spotify (while Sonata runs). */
export function startAlbumWatch() {
    FluxDispatcher.subscribe("SPOTIFY_PLAYER_STATE", onPlayerState);
}

export function stopAlbumWatch() {
    FluxDispatcher.unsubscribe("SPOTIFY_PLAYER_STATE", onPlayerState);
}
