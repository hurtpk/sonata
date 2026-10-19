/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The calendar's own reminders: a note and a time, with a notification when it comes round.

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

export interface Reminder {
    id: string;
    title: string;
    at: number;
    done?: boolean;
}

const KEY = "Opticord_calendarReminders";

let reminders: Reminder[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const save = () => DataStore.set(KEY, reminders).catch(() => { });

export async function loadReminders() {
    reminders = (await DataStore.get<Reminder[]>(KEY).catch(() => undefined)) ?? [];
    emit();
}

export const getReminders = () => reminders;

export function addReminder(title: string, at: number) {
    reminders = [...reminders, { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title, at }];
    save(); emit();
}

export function removeReminder(id: string) {
    reminders = reminders.filter(r => r.id !== id);
    save(); emit();
}

/** Reminders whose time has come, marked done so they only fire once. */
export function takeDue(now = Date.now()) {
    const due = reminders.filter(r => !r.done && r.at <= now);
    if (due.length) {
        reminders = reminders.map(r => due.includes(r) ? { ...r, done: true } : r);
        save(); emit();
    }
    return due;
}

export function useReminders() {
    const [, force] = useState(0);
    useEffect(() => {
        const l = () => force(n => n + 1);
        listeners.add(l);
        return () => { listeners.delete(l); };
    }, []);
    return reminders;
}
