/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

export interface Entry { expr: string; result: string; value: number; t: number; }

const KEY = "Opticord_calcHistory";
const LIMIT = 100;

let entries: Entry[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export async function loadHistory() {
    entries = (await DataStore.get<Entry[]>(KEY).catch(() => undefined)) ?? [];
    loaded = true;
    emit();
}

const save = () => DataStore.set(KEY, entries).catch(() => { });

export const getHistory = () => entries;

/** Newest first; repeating the exact same calculation just moves it to the top. */
export function addEntry(e: Entry) {
    entries = [e, ...entries.filter(x => !(x.expr === e.expr && x.result === e.result))].slice(0, LIMIT);
    save(); emit();
}

export function removeEntry(t: number) { entries = entries.filter(e => e.t !== t); save(); emit(); }
export function clearHistory() { entries = []; save(); emit(); }

export function useHistory() {
    const [, force] = useState(0);
    useEffect(() => {
        if (!loaded) loadHistory();
        const l = () => force(n => n + 1);
        listeners.add(l);
        return () => { listeners.delete(l); };
    }, []);
    return entries;
}
