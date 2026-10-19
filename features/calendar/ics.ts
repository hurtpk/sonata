/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Calendar files (.ics): reading the ones you import (school, work, Google,
// Outlook, Apple) and writing yours out. Handles all-day and timed events and
// the common repeats (daily, weekly on chosen days, monthly, yearly, with an
// end date or a count). Saved on this computer.

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

export interface IcsEvent {
    uid: string;
    title: string;
    start: number;
    end: number | null;
    allDay: boolean;
    location?: string;
    description?: string;
    rule?: { freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"; interval: number; count?: number; until?: number; byDay?: number[]; };
    /** Repeats that were cancelled (start times). */
    except?: number[];
}

export interface ImportedCalendar {
    id: string;
    name: string;
    color: string;
    events: IcsEvent[];
    importedAt: number;
    /** Where it came from, if it was a link (so it can be refreshed). */
    url?: string;
    enabled: boolean;
}

/* ── Reading ────────────────────────────────────────────────────────── */

const unescape = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

/** "20261011", "20261011T093000", "20261011T133000Z" → ms (and whether it's a whole day). */
function parseDate(value: string, params: string): { at: number; allDay: boolean; } | null {
    const v = value.trim();
    const d = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (d || /VALUE=DATE(?!-)/i.test(params)) {
        const m = d ?? v.match(/^(\d{4})(\d{2})(\d{2})/);
        if (!m) return null;
        return { at: new Date(+m[1], +m[2] - 1, +m[3]).getTime(), allDay: true };
    }
    const t = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
    if (!t) return null;
    const [, y, mo, da, h, mi, s = "0", z] = t;
    // Times with a TZID are taken as local time — right for calendars in your own time zone.
    const at = z ? Date.UTC(+y, +mo - 1, +da, +h, +mi, +s) : new Date(+y, +mo - 1, +da, +h, +mi, +s).getTime();
    return { at, allDay: false };
}

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function parseIcs(text: string): { name: string | null; events: IcsEvent[]; } {
    // Lines that continue start with a space or tab.
    const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
    let name: string | null = null;
    const events: IcsEvent[] = [];
    let cur: Partial<IcsEvent> & { raw?: Record<string, string>; } | null = null;
    for (const line of lines) {
        const i = line.indexOf(":");
        if (i < 0) continue;
        const left = line.slice(0, i), value = line.slice(i + 1);
        const [key, ...ps] = left.split(";");
        const params = ps.join(";");
        const K = key.toUpperCase();
        if (K === "X-WR-CALNAME" && !cur) name = unescape(value);
        if (K === "BEGIN" && value.toUpperCase() === "VEVENT") { cur = { except: [] }; continue; }
        if (K === "END" && value.toUpperCase() === "VEVENT") {
            if (cur?.start != null) events.push({ uid: cur.uid ?? `${cur.start}-${cur.title}`, title: cur.title || "(no title)", start: cur.start, end: cur.end ?? null, allDay: !!cur.allDay, location: cur.location, description: cur.description, rule: cur.rule, except: cur.except });
            cur = null;
            continue;
        }
        if (!cur) continue;
        if (K === "UID") cur.uid = value;
        else if (K === "SUMMARY") cur.title = unescape(value);
        else if (K === "LOCATION") cur.location = unescape(value) || undefined;
        else if (K === "DESCRIPTION") cur.description = unescape(value).slice(0, 500) || undefined;
        else if (K === "DTSTART") { const d = parseDate(value, params); if (d) { cur.start = d.at; cur.allDay = d.allDay; } }
        else if (K === "DTEND") { const d = parseDate(value, params); if (d) cur.end = d.at; }
        else if (K === "EXDATE") for (const v of value.split(",")) { const d = parseDate(v, params); if (d) cur.except!.push(d.at); }
        else if (K === "RRULE") {
            const r = Object.fromEntries(value.split(";").map(p => p.split("=")).map(([a, b]) => [a.toUpperCase(), b]));
            if (["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(r.FREQ)) {
                cur.rule = {
                    freq: r.FREQ as "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY", interval: Math.max(1, Number(r.INTERVAL) || 1),
                    count: r.COUNT ? Number(r.COUNT) : undefined,
                    until: r.UNTIL ? parseDate(r.UNTIL, "")?.at : undefined,
                    byDay: r.BYDAY ? r.BYDAY.split(",").map((d: string) => DAYS.indexOf(d.slice(-2))).filter((n: number) => n >= 0) : undefined,
                };
            }
        }
    }
    return { name, events };
}

/** Every time an event happens between two times (repeats worked out). */
export function occurrences(e: IcsEvent, from: number, to: number, max = 400): number[] {
    if (!e.rule) return e.start < to && (e.end ?? e.start) >= from ? [e.start] : [];
    const out: number[] = [];
    const { freq, interval, count, until, byDay } = e.rule;
    const first = new Date(e.start);
    let n = 0;
    const push = (t: number) => { n++; if (t >= from && t < to && !e.except?.includes(t)) out.push(t); };
    for (let step = 0; step < 5000 && out.length < max; step++) {
        const d = new Date(first);
        if (freq === "DAILY") d.setDate(first.getDate() + step * interval);
        else if (freq === "WEEKLY") d.setDate(first.getDate() + step * 7 * interval);
        else if (freq === "MONTHLY") d.setMonth(first.getMonth() + step * interval);
        else d.setFullYear(first.getFullYear() + step * interval);
        const base = d.getTime();
        if (until != null && base > until + 86_399_000) break;
        if (base >= to + 7 * 86_400_000) break;
        if (freq === "WEEKLY" && byDay?.length) {
            // Every chosen weekday in this week.
            const weekStart = new Date(base); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            for (const wd of [...byDay].sort()) {
                const x = new Date(weekStart); x.setDate(weekStart.getDate() + wd); x.setHours(first.getHours(), first.getMinutes(), first.getSeconds(), 0);
                const t = x.getTime();
                if (t < e.start || (until != null && t > until + 86_399_000)) continue;
                if (count != null && n >= count) return out;
                push(t);
            }
        } else {
            if (count != null && n >= count) break;
            push(base);
        }
    }
    return out;
}

/* ── Writing ────────────────────────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, "0");
const utc = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; };
const day = (t: number) => { const d = new Date(t); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; };
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
/** Lines over 75 characters are folded, as calendar apps expect. */
const fold = (line: string) => line.length <= 75 ? line : line.match(/.{1,74}/g)!.join("\r\n ");

export interface ExportItem { uid: string; title: string; at: number; allDay?: boolean; detail?: string; yearly?: boolean; minutes?: number; }

export function writeIcs(items: ExportItem[], name = "Discord (Sonata)"): string {
    const now = utc(Date.now());
    const out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sonata//Calendar//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc(name)}`];
    for (const it of items) {
        out.push("BEGIN:VEVENT", `UID:${it.uid}@sonata`, `DTSTAMP:${now}`, `SUMMARY:${esc(it.title)}`);
        if (it.allDay) out.push(`DTSTART;VALUE=DATE:${day(it.at)}`, `DTEND;VALUE=DATE:${day(it.at + 86_400_000)}`);
        else out.push(`DTSTART:${utc(it.at)}`, `DTEND:${utc(it.at + (it.minutes ?? 30) * 60_000)}`);
        if (it.yearly) out.push("RRULE:FREQ=YEARLY");
        if (it.detail) out.push(`DESCRIPTION:${esc(it.detail)}`);
        out.push("END:VEVENT");
    }
    out.push("END:VCALENDAR");
    return out.map(fold).join("\r\n") + "\r\n";
}

/* ── Imported calendars, saved ──────────────────────────────────────── */

const KEY = "Sonata_calendarImports";
const COLORS = ["#4f8cff", "#3ba55d", "#f0883e", "#a66bff", "#f472b6", "#2dd4bf", "#eab308"];
let calendars: ImportedCalendar[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const save = () => DataStore.set(KEY, calendars).catch(() => { });

export async function loadImports() {
    calendars = (await DataStore.get<ImportedCalendar[]>(KEY).catch(() => undefined)) ?? [];
    emit();
}

export const getImports = () => calendars;

export function addImport(text: string, fallbackName: string, url?: string): ImportedCalendar {
    const { name, events } = parseIcs(text);
    if (!events.length) throw new Error("There are no events in that file");
    const existing = url ? calendars.find(c => c.url === url) : null;
    const cal: ImportedCalendar = existing
        ? { ...existing, events, importedAt: Date.now(), name: existing.name }
        : { id: Date.now().toString(36), name: name || fallbackName, color: COLORS[calendars.length % COLORS.length], events, importedAt: Date.now(), url, enabled: true };
    calendars = existing ? calendars.map(c => c.id === existing.id ? cal : c) : [...calendars, cal];
    save(); emit();
    return cal;
}

export function updateImport(id: string, patch: Partial<ImportedCalendar>) {
    calendars = calendars.map(c => c.id === id ? { ...c, ...patch } : c);
    save(); emit();
}

export function removeImport(id: string) {
    calendars = calendars.filter(c => c.id !== id);
    save(); emit();
}

export function useImports() {
    const [, force] = useState(0);
    useEffect(() => { const l = () => force(n => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
    return calendars;
}
