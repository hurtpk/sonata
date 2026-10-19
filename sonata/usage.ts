/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// When you last used each Sonata feature — opening its window (from anywhere)
// or pressing its chat bar button — so Insights can suggest switching off
// heavy ones you don't use. Only the time is kept, on this computer.

import { DataStore } from "@api/index";

const KEY = "Sonata_featureUse";
interface Use { since: number; last: Record<string, number>; }
let use: Use = { since: Date.now(), last: {} };
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export async function loadUsage() {
    if (loaded) return;
    const got = await DataStore.get<Use>(KEY).catch(() => undefined);
    if (got?.since) use = { since: got.since, last: got.last ?? {} };
    else void DataStore.set(KEY, use);
    loaded = true;
}

export function noteUse(key: string) {
    use.last[key] = Date.now();
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; void DataStore.set(KEY, use); }, 5000);
}

export const lastUsed = (key: string): number | null => use.last[key] ?? null;
/** When Sonata started noting what you use. */
export const trackingSince = () => use.since;
