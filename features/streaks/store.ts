/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Which days you and each DM friend messaged, kept on this computer, and the
// streaks worked out from them. Days are your local calendar days.

import { DataStore } from "@api/index";
import { RestAPI, UserStore } from "@webpack/common";

const KEY = "Sonata_streaks_v1";
const KEEP_DAYS = 800;

interface Entry { me: number[]; them: number[]; }

let data: Record<string, Entry> = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
let version = 0;

export const onStreaksChange = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };
export const streaksVersion = () => version;

function changed() {
    version++;
    listeners.forEach(l => l());
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void DataStore.set(KEY, data), 1500);
}

export async function loadStreaks() {
    data = (await DataStore.get(KEY)) ?? {};
    version++;
    listeners.forEach(l => l());
}

/** Day number of a timestamp, in your time zone. */
export const dayOf = (ts: number) => Math.floor((ts - new Date(ts).getTimezoneOffset() * 60000) / 86400000);
export const today = () => dayOf(Date.now());

function insert(list: number[], day: number) {
    if (list.includes(day)) return false;
    list.push(day);
    list.sort((a, b) => a - b);
    while (list.length > KEEP_DAYS) list.shift();
    return true;
}

/** Note that someone messaged on that day. Returns whether anything new was learnt. */
export function recordDay(channelId: string, mine: boolean, ts: number, notify = true) {
    if (!Number.isFinite(ts)) return false;
    const e = data[channelId] ??= { me: [], them: [] };
    const added = insert(mine ? e.me : e.them, dayOf(ts));
    if (added && notify) changed();
    return added;
}

export function recordMessages(channelId: string, messages: any[]) {
    const me = UserStore.getCurrentUser()?.id;
    let any = false;
    for (const m of messages) {
        if (!m?.author?.id || !m.timestamp) continue;
        any = recordDay(channelId, m.author.id === me, Date.parse(m.timestamp), false) || any;
    }
    if (any) changed();
    return any;
}

export type Rule = "both" | "either";

export interface Streak {
    count: number;
    best: number;
    /** Today already counts. */
    doneToday: boolean;
    meToday: boolean;
    themToday: boolean;
}

export function streakOf(channelId: string, rule: Rule): Streak {
    const e = data[channelId];
    const t = today();
    if (!e) return { count: 0, best: 0, doneToday: false, meToday: false, themToday: false };
    const me = new Set(e.me), them = new Set(e.them);
    const days = rule === "both" ? new Set(e.me.filter(d => them.has(d))) : new Set([...e.me, ...e.them]);
    const doneToday = days.has(t);
    let count = 0;
    // A streak survives until the end of today even if today isn't done yet.
    for (let d = doneToday ? t : t - 1; days.has(d); d--) count++;
    let best = 0, run = 0, prev = NaN;
    for (const d of [...days].sort((a, b) => a - b)) {
        run = d === prev + 1 ? run + 1 : 1;
        best = Math.max(best, run);
        prev = d;
    }
    return { count, best, doneToday, meToday: me.has(t), themToday: them.has(t) };
}

export const knownChannels = () => Object.keys(data);

export function forget(channelId: string) {
    delete data[channelId];
    changed();
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Read back through a DM's history until the streak is found to break (or a
 * limit), to pick up streaks from before Sonata was watching.
 */
export async function scanHistory(channelId: string, rule: Rule, onPage?: (pages: number) => void, maxPages = 30) {
    let before: string | undefined;
    for (let page = 1; page <= maxPages; page++) {
        const res = await RestAPI.get({ url: `/channels/${channelId}/messages`, query: { limit: 100, ...(before ? { before } : {}) }, retries: 2 } as any).catch(() => null);
        const msgs: any[] = res?.body ?? [];
        if (!msgs.length) return;
        recordMessages(channelId, msgs);
        onPage?.(page);
        const oldest = msgs[msgs.length - 1];
        before = oldest.id;
        // Gone back past where the streak breaks: nothing older can change it.
        const { count } = streakOf(channelId, rule);
        if (dayOf(Date.parse(oldest.timestamp)) < today() - count - 1) return;
        if (msgs.length < 100) return;
        await sleep(900);
    }
}
