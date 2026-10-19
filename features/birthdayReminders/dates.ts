/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Birthday date maths, kept free of Discord so it can be tested on its own.

export interface Birthday {
    userId: string;
    /** 1–12 */
    month: number;
    /** 1–31 */
    day: number;
    /** Optional, for "turning N". */
    year?: number | null;
    /** Name / avatar remembered in case the user isn't cached. */
    name: string;
    avatar?: string | null;
    /** Their colour for the glow, edge and ring (otherwise their month's). */
    color?: string | null;
    /** Year the "today" reminder was shown. */
    notifiedYear?: number;
    /** Year the "tomorrow" reminder was shown (the birthday's year). */
    eveNotifiedYear?: number;
}

/** A colour for each month (cards, glows and the month strip). */
export const MONTH_COLORS = ["#5b8cff", "#ff6fae", "#3ddc84", "#ffb020", "#57d9a3", "#ffd84d", "#ff5c6c", "#ff8a3d", "#c26bff", "#f47b20", "#c69c6d", "#2dd4bf"];
/** Their own colour, or their month's. */
export const colorOf = (b: Pick<Birthday, "month" | "color">) => b.color || MONTH_COLORS[b.month - 1];

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function daysInMonth(month: number, year = 2024) {
    return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** The birthday's date in a given year (Feb 29 → Feb 28 in non-leap years). */
export function dateInYear(b: Pick<Birthday, "month" | "day">, year: number) {
    const day = b.month === 2 && b.day === 29 && !isLeap(year) ? 28 : b.day;
    return new Date(year, b.month - 1, day);
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Next occurrence on or after today (today counts). */
export function nextOccurrence(b: Pick<Birthday, "month" | "day">, now = new Date()) {
    const today = startOfDay(now);
    const thisYear = dateInYear(b, today.getFullYear());
    return thisYear >= today ? thisYear : dateInYear(b, today.getFullYear() + 1);
}

export function daysUntil(b: Pick<Birthday, "month" | "day">, now = new Date()) {
    const ms = nextOccurrence(b, now).getTime() - startOfDay(now).getTime();
    return Math.round(ms / 86_400_000);
}

/** Age they turn on their next birthday, if the year is known. */
export function turning(b: Birthday, now = new Date()) {
    if (!b.year) return null;
    return nextOccurrence(b, now).getFullYear() - b.year;
}

export const formatDate = (b: Pick<Birthday, "month" | "day">) => `${MONTHS[b.month - 1]} ${b.day}`;

export function relativeDay(days: number) {
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days < 7) return `In ${days} days`;
    if (days < 60) return `In ${Math.round(days / 7)} week${Math.round(days / 7) === 1 ? "" : "s"}`;
    return `In ${Math.round(days / 30)} months`;
}

/**
 * Which reminders are due now. "Today" reminders fire from `hour` onwards
 * (or right away if Discord is opened later in the day); "tomorrow" ones
 * the day before, same hour. Each fires once per year.
 */
export function dueReminders(list: Birthday[], now: Date, hour: number, dayBefore: boolean) {
    const today: Birthday[] = [];
    const tomorrow: Birthday[] = [];
    if (now.getHours() < hour) return { today, tomorrow };
    for (const b of list) {
        const days = daysUntil(b, now);
        const year = nextOccurrence(b, now).getFullYear();
        if (days === 0 && b.notifiedYear !== year) today.push(b);
        else if (days === 1 && dayBefore && b.eveNotifiedYear !== year) tomorrow.push(b);
    }
    return { today, tomorrow };
}

export function sortByUpcoming(list: Birthday[], now = new Date()) {
    return [...list].sort((a, b) => daysUntil(a, now) - daysUntil(b, now) || a.name.localeCompare(b.name));
}
