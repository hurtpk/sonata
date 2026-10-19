/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Your wallet lives only on this computer — in Discord's local storage, not
// Sonata's settings — so Share My Setup, backups and settings sync never
// carry your addresses anywhere.

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

import { Entry, KindId, kindOf, tidy } from "./kinds";

const KEY = "Sonata_wallet";
let entries: Entry[] = [];
let loaded = false;
const listeners = new Set<() => void>();

export async function loadWallet() {
    entries = (await DataStore.get<Entry[]>(KEY).catch(() => undefined)) ?? [];
    loaded = true;
    listeners.forEach(l => l());
}

const save = () => { void DataStore.set(KEY, entries); listeners.forEach(l => l()); };

export const allEntries = () => entries;
export const firstOf = (kind: KindId) => entries.find(e => e.kind === kind);
/** Every crypto address you've saved. */
export const savedAddresses = () => entries.filter(e => kindOf(e.kind).crypto).map(e => tidy(e));

export function putEntry(e: Entry) {
    const i = entries.findIndex(x => x.id === e.id);
    entries = i < 0 ? [...entries, e] : entries.map(x => x.id === e.id ? e : x);
    save();
}

export function removeEntry(id: string) {
    entries = entries.filter(e => e.id !== id);
    save();
}

export function moveEntry(id: string, by: number) {
    const i = entries.findIndex(e => e.id === id), j = i + by;
    if (i < 0 || j < 0 || j >= entries.length) return;
    const list = entries.slice();
    [list[i], list[j]] = [list[j], list[i]];
    entries = list;
    save();
}

export function useWallet() {
    const [, bump] = useState(0);
    useEffect(() => {
        const l = () => bump(n => n + 1);
        listeners.add(l);
        if (!loaded) void loadWallet();
        return () => void listeners.delete(l);
    }, []);
    return { entries, loaded };
}

/** What you last copied from the wallet, to catch a clipboard that changes it. */
export const lastCopy = { text: "", at: 0 };

/** QR pictures with your name and the logo on them (set from the Wallet's settings). */
export const qrPrefs = { card: false, name: "", set: (_card: boolean) => { } };
