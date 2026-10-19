/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Converter's two kinds that aren't units: times in other time zones,
// and numbers in other number systems.

import { fromRoman, numberToWords, toRoman } from "../calculator/words";

// ─── Time zones ───

const ZONES: Record<string, string> = {
    utc: "UTC", gmt: "Europe/London", z: "UTC",
    est: "America/New_York", edt: "America/New_York", et: "America/New_York", eastern: "America/New_York", "new york": "America/New_York", nyc: "America/New_York", toronto: "America/Toronto",
    cst: "America/Chicago", cdt: "America/Chicago", ct: "America/Chicago", central: "America/Chicago", chicago: "America/Chicago", texas: "America/Chicago",
    mst: "America/Denver", mdt: "America/Denver", mt: "America/Denver", mountain: "America/Denver", denver: "America/Denver", arizona: "America/Phoenix",
    pst: "America/Los_Angeles", pdt: "America/Los_Angeles", pt: "America/Los_Angeles", pacific: "America/Los_Angeles", la: "America/Los_Angeles", "los angeles": "America/Los_Angeles", california: "America/Los_Angeles", vancouver: "America/Vancouver",
    akst: "America/Anchorage", alaska: "America/Anchorage", hst: "Pacific/Honolulu", hawaii: "Pacific/Honolulu",
    bst: "Europe/London", uk: "Europe/London", london: "Europe/London", ireland: "Europe/Dublin", dublin: "Europe/Dublin", lisbon: "Europe/Lisbon", portugal: "Europe/Lisbon",
    cet: "Europe/Paris", cest: "Europe/Paris", paris: "Europe/Paris", france: "Europe/Paris", berlin: "Europe/Berlin", germany: "Europe/Berlin", madrid: "Europe/Madrid", spain: "Europe/Madrid", rome: "Europe/Rome", italy: "Europe/Rome",
    amsterdam: "Europe/Amsterdam", netherlands: "Europe/Amsterdam", stockholm: "Europe/Stockholm", sweden: "Europe/Stockholm", warsaw: "Europe/Warsaw", poland: "Europe/Warsaw",
    eet: "Europe/Athens", eest: "Europe/Athens", athens: "Europe/Athens", greece: "Europe/Athens", kyiv: "Europe/Kyiv", ukraine: "Europe/Kyiv", istanbul: "Europe/Istanbul", turkey: "Europe/Istanbul",
    msk: "Europe/Moscow", moscow: "Europe/Moscow", russia: "Europe/Moscow",
    gst: "Asia/Dubai", dubai: "Asia/Dubai", uae: "Asia/Dubai", ist: "Asia/Kolkata", india: "Asia/Kolkata", pkt: "Asia/Karachi", pakistan: "Asia/Karachi",
    ict: "Asia/Bangkok", bangkok: "Asia/Bangkok", thailand: "Asia/Bangkok", vietnam: "Asia/Ho_Chi_Minh", wib: "Asia/Jakarta", jakarta: "Asia/Jakarta",
    sgt: "Asia/Singapore", singapore: "Asia/Singapore", hkt: "Asia/Hong_Kong", "hong kong": "Asia/Hong_Kong", china: "Asia/Shanghai", beijing: "Asia/Shanghai", shanghai: "Asia/Shanghai", pht: "Asia/Manila", philippines: "Asia/Manila", manila: "Asia/Manila",
    jst: "Asia/Tokyo", japan: "Asia/Tokyo", tokyo: "Asia/Tokyo", kst: "Asia/Seoul", korea: "Asia/Seoul", seoul: "Asia/Seoul",
    awst: "Australia/Perth", perth: "Australia/Perth", acst: "Australia/Adelaide", adelaide: "Australia/Adelaide", aest: "Australia/Sydney", aedt: "Australia/Sydney", sydney: "Australia/Sydney", melbourne: "Australia/Melbourne", brisbane: "Australia/Brisbane",
    nzst: "Pacific/Auckland", nzdt: "Pacific/Auckland", "new zealand": "Pacific/Auckland", auckland: "Pacific/Auckland",
    brt: "America/Sao_Paulo", brazil: "America/Sao_Paulo", "sao paulo": "America/Sao_Paulo", art: "America/Argentina/Buenos_Aires", argentina: "America/Argentina/Buenos_Aires", mexico: "America/Mexico_City", "mexico city": "America/Mexico_City",
    sast: "Africa/Johannesburg", "south africa": "Africa/Johannesburg", cat: "Africa/Maputo", eat: "Africa/Nairobi", nairobi: "Africa/Nairobi", wat: "Africa/Lagos", lagos: "Africa/Lagos", nigeria: "Africa/Lagos", egypt: "Africa/Cairo", cairo: "Africa/Cairo",
    local: "", me: "", "my time": "",
};

export const SHOW_ZONES = ["UTC", "America/Los_Angeles", "America/New_York", "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Moscow", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];

export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** How far a zone is ahead of UTC at a moment, in ms. */
function offset(zone: string, t: number) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(t).filter(x => x.type !== "literal").map(x => [x.type, Number(x.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}

const validZone = (z: string) => { try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch { return false; } };

export interface ZoneTime { instant: number; zone: string; label: string; }

/** "3pm EST", "15:30 tokyo", "9:45 am", "noon in London", "now". */
export function parseZoneTime(input: string): ZoneTime | null {
    const s = input.trim().toLowerCase();
    if (!s) return null;
    if (s === "now") return { instant: Date.now(), zone: localZone(), label: "now" };
    const m = s.match(/^(noon|midnight|(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?)\s*(?:in\s+|at\s+)?([a-z][a-z /_]*)?$/);
    if (!m) return null;
    let h: number, min = 0;
    if (m[1] === "noon") h = 12;
    else if (m[1] === "midnight") h = 0;
    else {
        h = Number(m[2]); min = Number(m[3] ?? 0);
        const ap = m[4]?.[0];
        if (h > 23 || min > 59 || (ap && h > 12)) return null;
        if (ap === "p" && h < 12) h += 12;
        if (ap === "a" && h === 12) h = 0;
        // A bare "7" isn't clearly a time.
        if (!m[3] && !ap) return null;
    }
    const word = (m[5] ?? "").trim();
    let zone = word ? ZONES[word] : "";
    if (zone === undefined) {
        // Also "Europe/Paris" style names.
        const iana = word.split("/").map(w => w.replace(/(^|_)\w/g, c => c.toUpperCase())).join("/");
        if (!validZone(iana)) return null;
        zone = iana;
    }
    zone ||= localZone();
    // That wall-clock time today in that zone → the actual moment.
    const now = new Date(Date.now() + offset(zone, Date.now()));
    const guess = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, min);
    let instant = guess - offset(zone, guess);
    instant = guess - offset(zone, instant);
    return { instant, zone, label: `${input.trim()}` };
}

/** "3:00 PM, Tue" in a zone, with how many days apart it is from `ref`. */
export function timeIn(zone: string, t: number, refZone: string) {
    const time = new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(t);
    const day = (z: string) => new Intl.DateTimeFormat("en-CA", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
    const diff = Math.round((Date.parse(day(zone)) - Date.parse(day(refZone))) / 86_400_000);
    const weekday = new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: "short" }).format(t);
    const off = offset(zone, t) / 3_600_000;
    return { time, weekday, dayDiff: diff, offset: `UTC${off >= 0 ? "+" : "−"}${Math.floor(Math.abs(off))}${Math.abs(off) % 1 ? `:${String(Math.round(Math.abs(off) % 1 * 60)).padStart(2, "0")}` : ""}` };
}

export const zoneName = (zone: string) => zone === "UTC" ? "UTC" : zone.split("/").pop()!.replace(/_/g, " ");

// ─── Number systems ───

export interface NumberViews { value: bigint | null; decimal: string; hex: string; binary: string; octal: string; roman: string | null; words: string; }

/** "255", "0xff", "0b1010", "0o17", "#ff8800" (as a number), "XIV". */
export function parseNumberSystem(input: string): NumberViews | null {
    const s = input.trim().replace(/[\s_]/g, "");
    if (!s) return null;
    let n: bigint | null = null;
    const neg = s.startsWith("-"), body = (neg ? s.slice(1) : s).toLowerCase();
    try {
        if (/^(0x[0-9a-f]+|0b[01]+|0o[0-7]+)$/.test(body)) n = BigInt(body) * (neg ? -1n : 1n);
        else if (/^-?\d+$/.test(s)) n = BigInt(s);
        else if (/^[mdclxvi]+$/i.test(s)) { const r = fromRoman(s); n = r == null ? null : BigInt(r); }
    } catch { n = null; }
    if (n == null) return null;
    const abs = n < 0n ? -n : n, sign = n < 0n ? "-" : "";
    const num = Number(n);
    return {
        value: n,
        decimal: n.toLocaleString(),
        hex: `${sign}0x${abs.toString(16).toUpperCase()}`,
        binary: `${sign}0b${abs.toString(2).replace(/\B(?=(\d{4})+(?!\d))/g, " ")}`,
        octal: `${sign}0o${abs.toString(8)}`,
        roman: toRoman(num),
        words: Math.abs(num) < 1e21 ? numberToWords(num) : "too big to say",
    };
}
