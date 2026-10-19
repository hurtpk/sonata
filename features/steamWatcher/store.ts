/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Steam Watcher: the games you watch, what's happened to them, and your linked
// Steam profile. Saved on this computer only.

import { DataStore } from "@api/index";
import { useEffect, useReducer } from "@webpack/common";

import type { SteamItem, SteamProfile } from "./native";

export interface Watched {
    appid: number;
    name: string;
    addedAt: number;
    header?: string;
    /** Alert me when it's at or under this (in cents of your Steam currency). */
    target?: number;
    targetHit?: boolean;
    price?: SteamItem["price"];
    free?: boolean;
    release?: SteamItem["release"];
    review?: SteamItem["review"];
    freeWeekend?: SteamItem["freeWeekend"];
    /** Newest announcement seen, so only newer ones are announced. */
    newsAt?: number;
    lastNews?: { gid: string; title: string; date: number; update: boolean; };
    history: { t: number; final: number; }[];
    lastCheck?: number;
    error?: string;
}

export type FeedKind = "sale" | "target" | "update" | "news" | "release" | "date" | "free" | "freeWeekend";

export interface FeedItem {
    id: string;
    t: number;
    appid: number;
    name: string;
    kind: FeedKind;
    title: string;
    body?: string;
    newsGid?: string;
    url?: string;
}

export interface LinkedProfile extends SteamProfile { input: string; checkedAt: number; }

interface Data { games: Watched[]; feed: FeedItem[]; profile?: LinkedProfile; seenAt?: number; }

const KEY = "Sonata_steamWatcher";
const MAX_FEED = 300;
let data: Data = { games: [], feed: [] };
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function loadSteam() {
    return loaded ??= DataStore.get<Data>(KEY).then(d => {
        if (d) data = { games: d.games ?? [], feed: d.feed ?? [], profile: d.profile, seenAt: d.seenAt };
        emit();
    }).catch(() => { });
}

const emit = () => listeners.forEach(l => l());
function changed() {
    emit();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void DataStore.set(KEY, data), 400);
}

export const onSteamChange = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };
export const games = () => data.games;
export const feed = () => data.feed;
export const profile = () => data.profile;
export const game = (appid: number) => data.games.find(g => g.appid === appid);
export const isWatched = (appid: number) => data.games.some(g => g.appid === appid);

export function useSteam() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => { void loadSteam(); return onSteamChange(bump); }, []);
    return data;
}

/** Adds a game (newest first). Returns false if it's already watched. */
export function watch(appid: number, name = "", header?: string) {
    if (isWatched(appid)) return false;
    data.games = [{ appid, name: name || `Game ${appid}`, header, addedAt: Date.now(), history: [] }, ...data.games];
    changed();
    return true;
}

export function unwatch(appid: number) {
    data.games = data.games.filter(g => g.appid !== appid);
    changed();
}

export function updateGame(appid: number, fn: (g: Watched) => void) {
    const g = game(appid);
    if (!g) return;
    fn(g);
    data.games = [...data.games];
    changed();
}

export function addFeed(item: Omit<FeedItem, "id" | "t"> & { t?: number; }) {
    const full: FeedItem = { id: `${item.kind}-${item.appid}-${item.newsGid ?? Date.now()}`, t: item.t ?? Date.now(), ...item };
    if (data.feed.some(f => f.id === full.id)) return null;
    data.feed = [full, ...data.feed].sort((a, b) => b.t - a.t).slice(0, MAX_FEED);
    changed();
    return full;
}

export function clearFeed() {
    data.feed = [];
    changed();
}

/** How many activity items came in since the Activity tab was last opened. */
export const unseen = () => data.feed.filter(f => f.t > (data.seenAt ?? 0)).length;
export function markSeen() {
    data.seenAt = Date.now();
    changed();
}

export function setProfile(p: LinkedProfile | undefined) {
    data.profile = p;
    changed();
}
