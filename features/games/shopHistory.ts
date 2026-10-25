/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Fortnite shop history, kept by Game Hub itself: each day it sees the shop,
// it notes what was in it. Nothing public lists when an item was last sold,
// so this starts from the first day Game Hub looked and grows from there.

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

import type { ShopItem } from "./native";

export interface Seen { name: string; type?: string; image?: string; rarity?: string; /** Days it was in the shop ("2026-10-20"), oldest first. */ days: string[]; }
interface Saved { since?: string; items: Record<string, Seen>; }

const KEY = "Sonata_fortniteHistory";
let saved: Saved = { items: {} };
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export const loadHistory = () => loaded ??= DataStore.get<Saved>(KEY).then(v => { if (v?.items) saved = v; emit(); }).catch(() => { });
const key = (name: string) => name.trim().toLowerCase();
export const dayOf = (date: string) => /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : new Date().toISOString().slice(0, 10);

/** Notes one day's shop (once per day). */
export async function recordShop(date: string, items: ShopItem[]) {
    await loadHistory();
    const day = dayOf(date);
    let changed = false;
    const next = { ...saved.items };
    for (const i of items) {
        const k = key(i.name);
        if (!k) continue;
        const was = next[k];
        if (was?.days.at(-1) === day) continue;
        next[k] = { name: i.name, type: i.type, image: i.image ?? was?.image, rarity: i.rarity, days: [...(was?.days ?? []), day].slice(-200) };
        changed = true;
    }
    if (!changed) return;
    // Keep it from growing forever: the items seen most recently.
    const entries = Object.entries(next);
    if (entries.length > 5000) entries.sort((a, b) => (b[1].days.at(-1) ?? "").localeCompare(a[1].days.at(-1) ?? "")).splice(5000);
    saved = { since: saved.since && saved.since < day ? saved.since : day, items: Object.fromEntries(entries) };
    emit();
    void DataStore.set(KEY, saved);
}

export function useHistory() {
    const [, bump] = useState(0);
    useEffect(() => { void loadHistory(); const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    return saved;
}

export const historyOf = (name: string): Seen | undefined => saved.items[key(name)];
export const historySince = () => saved.since;

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** "Last here 34 days ago · 5 times" — about the times before today. */
export function historyLine(name: string, today: string): string | null {
    const h = historyOf(name);
    const before = (h?.days ?? []).filter(d => d < dayOf(today));
    if (!before.length) return saved.since && saved.since < dayOf(today) ? "First time since Game Hub started watching" : null;
    const last = before.at(-1)!;
    const ago = daysBetween(last, dayOf(today));
    return `Last here ${ago === 1 ? "yesterday" : `${ago} days ago`} · ${before.length + 1} times`;
}

/** Search the history: when each matching item was last in the shop, and how often. */
export function searchHistory(q: string) {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return Object.values(saved.items).filter(i => i.name.toLowerCase().includes(s)).sort((a, b) => (b.days.at(-1) ?? "").localeCompare(a.days.at(-1) ?? "")).slice(0, 60);
}

/** Average days between visits, once it has come back at least twice. */
export function returnsEvery(h: Seen) {
    if (h.days.length < 3) return null;
    const gaps = h.days.slice(1).map((d, i) => daysBetween(h.days[i], d)).filter(g => g > 1);
    if (!gaps.length) return null;
    return Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
}
