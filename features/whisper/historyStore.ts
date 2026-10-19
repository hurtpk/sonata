/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Whispers you've opened: what they said, who from, where and when — so you
// can find one again. Only on this computer; clear it any time.

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

export interface Seen {
    messageId: string;
    channelId: string;
    guildId?: string | null;
    author: string;
    text: string;
    /** How it was locked: "Anyone with Sonata", a password's name, or "Just you & Sam". */
    lock: string;
    at: number;
    expiresAt?: number;
}

const KEY = "Sonata_whisperHistory";
const MAX = 300;
let list: Seen[] = [];
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

const load = () => loaded ??= DataStore.get<Seen[]>(KEY).then(v => { list = v ?? []; emit(); }).catch(() => { });

export function useHistory() {
    const [, bump] = useState(0);
    useEffect(() => { void load(); const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    return list;
}

export async function remember(s: Seen) {
    await load();
    const key = `${s.messageId}:${s.text}`;
    if (list.some(x => `${x.messageId}:${x.text}` === key)) return;
    list = [{ ...s, text: s.text.slice(0, 1000) }, ...list].slice(0, MAX);
    emit();
    await DataStore.set(KEY, list);
}

export async function forget(messageId: string) {
    list = list.filter(x => x.messageId !== messageId);
    emit();
    await DataStore.set(KEY, list);
}

export async function clearHistory() {
    list = [];
    emit();
    await DataStore.set(KEY, []);
}
