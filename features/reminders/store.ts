/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Reminders: what's set, when it's due, and the clock that rings them.
// Saved on this computer only. A reminder that came due while Discord was
// closed rings as soon as Discord opens again.

import { DataStore } from "@api/index";

export type ColorId = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "gray";
export type Repeat = "none" | "daily" | "weekdays" | "weekly" | "monthly";

export interface Reminder {
    id: string;
    text: string;
    /** When it's due (ms). */
    at: number;
    color: ColorId;
    repeat: Repeat;
    /** The message it's about, if any. */
    link?: { channelId: string; messageId: string; guildId?: string | null; author?: string; };
    created: number;
}

/** What each colour looks and sounds like when it rings. */
export const COLORS: Record<ColorId, { name: string; hex: string; feel: string; sound: "urgent" | "chime" | "soft" | "none"; stays: boolean; }> = {
    red: { name: "Red", hex: "#f23f43", feel: "Urgent — rings twice and stays until you deal with it", sound: "urgent", stays: true },
    orange: { name: "Orange", hex: "#f0883e", feel: "Important — a chime, stays until dismissed", sound: "chime", stays: true },
    yellow: { name: "Yellow", hex: "#f0c03e", feel: "Heads-up — a chime, stays until dismissed", sound: "chime", stays: true },
    green: { name: "Green", hex: "#3ba55d", feel: "Easy-going — a soft chime", sound: "soft", stays: true },
    blue: { name: "Blue", hex: "#4f8cff", feel: "Normal — a soft chime", sound: "soft", stays: true },
    purple: { name: "Purple", hex: "#a66bff", feel: "Personal — a soft chime", sound: "soft", stays: true },
    pink: { name: "Pink", hex: "#f472b6", feel: "Fun stuff — a soft chime", sound: "soft", stays: true },
    gray: { name: "Gray", hex: "#8b93a7", feel: "Quiet — no sound, slides away after 20 seconds", sound: "none", stays: false },
};

export const COLOR_IDS = Object.keys(COLORS) as ColorId[];

export const REPEATS: { id: Repeat; name: string; }[] = [
    { id: "none", name: "Once" }, { id: "daily", name: "Every day" }, { id: "weekdays", name: "Weekdays" },
    { id: "weekly", name: "Every week" }, { id: "monthly", name: "Every month" },
];

const KEY = "Sonata_reminders";
let list: Reminder[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const changed = () => { listeners.forEach(l => l()); void DataStore.set(KEY, list); };

export const onRemindersChange = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };
export const getReminders = () => list;

export async function loadReminders() {
    if (loaded) return;
    list = (await DataStore.get<Reminder[]>(KEY).catch(() => undefined)) ?? [];
    loaded = true;
    listeners.forEach(l => l());
}

export const newId = () => Math.random().toString(36).slice(2, 10);

export function addReminder(r: Omit<Reminder, "id" | "created">) {
    const full: Reminder = { ...r, id: newId(), created: Date.now() };
    list = [...list, full];
    changed();
    return full;
}

export function updateReminder(id: string, patch: Partial<Reminder>) {
    list = list.map(r => r.id === id ? { ...r, ...patch } : r);
    changed();
}

export function removeReminder(id: string) {
    list = list.filter(r => r.id !== id);
    changed();
}

/** The next time a repeating reminder is due, after `from`. */
export function nextOccurrence(r: Reminder, from = Date.now()): number | null {
    if (r.repeat === "none") return null;
    const d = new Date(r.at);
    do {
        if (r.repeat === "daily") d.setDate(d.getDate() + 1);
        else if (r.repeat === "weekly") d.setDate(d.getDate() + 7);
        else if (r.repeat === "monthly") d.setMonth(d.getMonth() + 1);
        else if (r.repeat === "weekdays") { do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); }
    } while (d.getTime() <= from);
    return d.getTime();
}

/** Marks a reminder done: a repeating one moves on to its next time, a one-off is removed. */
export function completeReminder(id: string) {
    const r = list.find(x => x.id === id);
    if (!r) return;
    const next = nextOccurrence(r);
    if (next) updateReminder(id, { at: next });
    else removeReminder(id);
}

export function snoozeReminder(id: string, until: number) {
    updateReminder(id, { at: until });
}

// ─── Times ───

const at = (d: Date, h: number, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };

/** Quick choices for "when". */
export function quickTimes(now = new Date()) {
    const in_ = (min: number) => now.getTime() + min * 60_000;
    const tonight = at(now, 20);
    const tomorrow9 = at(new Date(now.getTime() + 86_400_000), 9);
    const out = [
        { label: "In 10 minutes", at: in_(10) },
        { label: "In 30 minutes", at: in_(30) },
        { label: "In 1 hour", at: in_(60) },
        { label: "In 3 hours", at: in_(180) },
    ];
    if (tonight.getTime() > now.getTime() + 30 * 60_000) out.push({ label: "Tonight at 8", at: tonight.getTime() });
    out.push({ label: "Tomorrow at 9", at: tomorrow9.getTime() });
    const monday = at(now, 9);
    monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
    out.push({ label: "Monday at 9", at: monday.getTime() });
    return out;
}

/** "in 5 min", "today at 14:30", "tomorrow at 9:00", "Fri 3 Oct at 9:00". */
export function whenText(t: number, now = Date.now()) {
    const diff = t - now;
    const time = new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (diff < 0) {
        const ago = -diff;
        if (ago < 60_000) return "just now";
        if (ago < 3_600_000) return `${Math.round(ago / 60_000)} min ago`;
        return `${new Date(t).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} at ${time}`;
    }
    if (diff < 60_000) return "in under a minute";
    if (diff < 3_600_000) return `in ${Math.round(diff / 60_000)} min`;
    const day = (x: number) => new Date(x).toDateString();
    if (day(t) === day(now)) return `today at ${time}`;
    if (day(t) === day(now + 86_400_000)) return `tomorrow at ${time}`;
    return `${new Date(t).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} at ${time}`;
}

/** For <input type="datetime-local">. */
export function toLocalInput(t: number) {
    const d = new Date(t), p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
