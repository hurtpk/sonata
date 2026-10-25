/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Your own extras on logs: a star (kept forever — no cleanup removes it) and
// a note. Kept apart from the logs themselves so they survive re-imports.

import { get, set } from "@api/DataStore";

export interface LogMeta { star?: boolean; note?: string; }

const KEY = "MessageLoggerEnhanced_meta";
let cache: Record<string, LogMeta> | null = null;
let loading: Promise<Record<string, LogMeta>> | null = null;

export async function loadMeta(): Promise<Record<string, LogMeta>> {
    if (cache) return cache;
    loading ??= get(KEY).then(v => (cache = (v && typeof v === "object" ? v : {}) as Record<string, LogMeta>));
    return loading;
}

export async function setMeta(id: string, patch: LogMeta) {
    const all = await loadMeta();
    const next = { ...all[id], ...patch };
    if (!next.star) delete next.star;
    if (!next.note?.trim()) delete next.note;
    if (Object.keys(next).length) all[id] = next; else delete all[id];
    await set(KEY, all);
}

export async function dropMeta(ids: string[]) {
    const all = await loadMeta();
    let changed = false;
    for (const id of ids) if (all[id]) { delete all[id]; changed = true; }
    if (changed) await set(KEY, all);
}

/** Starred logs: never removed by any cleanup. */
export async function starredIds(): Promise<Set<string>> {
    const all = await loadMeta();
    return new Set(Object.keys(all).filter(id => all[id].star));
}

/** Drops starred logs from a list that's about to be cleaned up. */
export async function withoutStarred<T extends { message_id: string; }>(list: T[]): Promise<T[]> {
    if (!list.length) return list;
    const keep = await starredIds();
    return keep.size ? list.filter(r => !keep.has(r.message_id)) : list;
}
