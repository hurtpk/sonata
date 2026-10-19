/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

import type { Birthday } from "./dates";

const KEY = "Opticord_birthdays";

let birthdays: Record<string, Birthday> = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export async function loadBirthdays() {
    birthdays = (await DataStore.get<Record<string, Birthday>>(KEY).catch(() => undefined)) ?? {};
    emit();
}

const save = () => DataStore.set(KEY, birthdays).catch(() => { });

export const allBirthdays = () => Object.values(birthdays);
export const getBirthday = (userId: string) => birthdays[userId];

export function setBirthday(b: Birthday) {
    const prev = birthdays[b.userId];
    // Changing the date re-arms this year's reminders.
    const sameDate = prev && prev.month === b.month && prev.day === b.day;
    birthdays = { ...birthdays, [b.userId]: { ...b, notifiedYear: sameDate ? prev.notifiedYear : undefined, eveNotifiedYear: sameDate ? prev.eveNotifiedYear : undefined } };
    save(); emit();
}

export function patchBirthday(userId: string, patch: Partial<Birthday>) {
    if (!birthdays[userId]) return;
    birthdays = { ...birthdays, [userId]: { ...birthdays[userId], ...patch } };
    save(); emit();
}

export function removeBirthday(userId: string) {
    const { [userId]: _, ...rest } = birthdays;
    birthdays = rest;
    save(); emit();
}

export function useBirthdays() {
    const [, force] = useState(0);
    useEffect(() => {
        const l = () => force(n => n + 1);
        listeners.add(l);
        return () => { listeners.delete(l); };
    }, []);
    return allBirthdays();
}
