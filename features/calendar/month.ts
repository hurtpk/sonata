/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Month grid and date helpers, kept free of Discord so they can be tested on their own.

export type Kind = "birthday" | "scheduled" | "event" | "reminder" | "imported" | "package" | "episode";

export interface CalendarItem {
    id: string;
    kind: Kind;
    /** When it happens (birthdays: midnight). */
    at: number;
    title: string;
    detail?: string;
    /** Birthdays have no time of day. */
    allDay?: boolean;
    /** Kind-specific data for the item's buttons. */
    ref?: any;
}

/** "2026-10-06" — the local day an instant falls on. */
export function dayKey(d: Date | number) {
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

export const sameDay = (a: Date | number, b: Date | number) => dayKey(a) === dayKey(b);

/** The 6 weeks shown for a month, starting on Monday (1) or Sunday (0). */
export function monthGrid(year: number, month: number, weekStart: 0 | 1): Date[] {
    const first = new Date(year, month, 1);
    const offset = (first.getDay() - weekStart + 7) % 7;
    return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - offset + i));
}

export function weekdayNames(weekStart: 0 | 1, locale?: string) {
    // Jan 4 2026 is a Sunday.
    return Array.from({ length: 7 }, (_, i) => new Date(2026, 0, 4 + ((i + weekStart) % 7)).toLocaleDateString(locale, { weekday: "short" }));
}

/** Repeating things (daily / weekly scheduled messages) laid out between two instants. */
export function repeatsBetween(first: number, stepMs: number, from: number, to: number, max = 62): number[] {
    if (stepMs <= 0) return first >= from && first < to ? [first] : [];
    const out: number[] = [];
    let t = first;
    if (t < from) t += Math.ceil((from - t) / stepMs) * stepMs;
    for (; t < to && out.length < max; t += stepMs) out.push(t);
    return out;
}

/** Group items by day, earliest first (all-day items before timed ones). */
export function byDay(items: CalendarItem[]) {
    const map = new Map<string, CalendarItem[]>();
    for (const it of [...items].sort((a, b) => Number(!!b.allDay) - Number(!!a.allDay) || a.at - b.at)) {
        const k = dayKey(it.at);
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(it);
    }
    return map;
}
