/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// TikTok Tracker: who's being watched, and every number seen for them since
// they were added. Saved on this computer only.

import { DataStore } from "@api/index";

export interface Stat { t: number; followers: number; following: number; likes: number; videos: number; }
export interface PostStat { t: number; likes: number; views: number; comments: number; shares: number; saves: number; }
export interface Post { id: string; desc: string; cover: string; created: number; first: PostStat | null; last: PostStat | null; history: PostStat[]; seen: number; gone?: boolean; }
export interface RbStat { t: number; followers: number; following: number; friends: number; }
export interface Roblox {
    input: string;
    id?: number; name?: string; displayName?: string; created?: string; verified?: boolean; banned?: boolean; bio?: string; avatar?: string;
    presence?: number; lastOnline?: string | null;
    first?: RbStat; last?: RbStat; history: RbStat[];
    error?: string;
}

export interface Account {
    username: string;
    addedAt: number;
    tiktokId?: string;
    nickname?: string;
    avatar?: string;
    bio?: string;
    verified?: boolean;
    private?: boolean;
    first?: Stat;
    last?: Stat;
    history: Stat[];
    posts: Record<string, Post>;
    lastCheck?: number;
    lastPostsCheck?: number;
    error?: string;
    roblox?: Roblox;
    note?: string;
    /** Milestones already announced (follower counts). */
    milestones?: number[];
}

const KEY = "Sonata_tiktokTracker";
let accounts: Account[] = [];
let loaded = false;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const emit = () => listeners.forEach(l => l());
export function changed() {
    emit();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void DataStore.set(KEY, accounts), 400);
}

export const onChange = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };
export const getAccounts = () => accounts;
export const getAccount = (u: string) => accounts.find(a => a.username === u);

export async function loadAccounts() {
    if (loaded) return;
    accounts = (await DataStore.get<Account[]>(KEY).catch(() => undefined)) ?? [];
    loaded = true;
    emit();
}

/** "@name", "tiktok.com/@name" or a video link → "name". */
export function parseTikTok(input: string): string | null {
    const s = input.trim();
    const m = s.match(/tiktok\.com\/@([a-z0-9._]{2,24})/i) ?? s.match(/^@?([a-z0-9._]{2,24})$/i);
    return m ? m[1].toLowerCase() : null;
}

export function addAccount(username: string, robloxInput?: string): Account {
    const existing = getAccount(username);
    if (existing) return existing;
    const a: Account = { username, addedAt: Date.now(), history: [], posts: {}, roblox: robloxInput?.trim() ? { input: robloxInput.trim(), history: [] } : undefined };
    accounts = [...accounts, a];
    changed();
    return a;
}

export function removeAccount(username: string) {
    accounts = accounts.filter(a => a.username !== username);
    changed();
}

export function update(username: string, fn: (a: Account) => void) {
    const a = getAccount(username);
    if (!a) return;
    fn(a);
    accounts = accounts.slice();
    changed();
}

/** Keeps every point from the last week, then one a day — so years of tracking stay small. */
export function compact<T extends { t: number; }>(list: T[], max = 500): T[] {
    const week = Date.now() - 7 * 86400_000;
    const out: T[] = [];
    let lastDay = "";
    for (const p of list) {
        if (p.t >= week) { out.push(p); continue; }
        const day = new Date(p.t).toDateString();
        if (day !== lastDay) { out.push(p); lastDay = day; } else out[out.length - 1] = p;
    }
    return out.slice(-max);
}

/** The point closest to (but not after) a time, for "in the last 24 hours" and so on. */
export function at<T extends { t: number; }>(list: T[], time: number): T | null {
    let best: T | null = null;
    for (const p of list) if (p.t <= time) best = p;
    return best ?? list[0] ?? null;
}

export const MILESTONES = [100, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000];

/* ── Formatting ─────────────────────────────────────────────────────── */

export function short(n: number | undefined): string {
    if (n == null || !Number.isFinite(n)) return "–";
    const a = Math.abs(n);
    if (a < 1000) return String(n);
    if (a < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
    if (a < 1_000_000) return `${Math.round(n / 1000)}K`;
    if (a < 10_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export const signed = (n: number) => n > 0 ? `+${short(n)}` : n < 0 ? `−${short(-n)}` : "±0";

export function ago(t: number | undefined): string {
    if (!t) return "never";
    const s = (Date.now() - t) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    const d = Math.round(s / 86400);
    if (d < 60) return `${d} day${d === 1 ? "" : "s"} ago`;
    const m = Math.round(d / 30.4);
    if (m < 24) return `${m} months ago`;
    return `${Math.round(d / 365)} years ago`;
}

export const date = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
export const dateTime = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** When a TikTok was posted, from its ID (the first 32 bits are the time). */
export const postedAt = (id: string) => { try { return Number(BigInt(id) >> 32n) * 1000; } catch { return 0; } };
