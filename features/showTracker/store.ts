/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The shows you follow (DataStore), kept up to date in the background, with a
// pop-up when a new episode comes out.

import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { OptionType } from "@utils/types";
import { useEffect, useState } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import type { Show, Source } from "./native";

export const settings = defineFeatureSettings("showTracker", {
    alerts: { type: OptionType.BOOLEAN, description: "Tell me when a new episode of a show I follow comes out", default: true },
});

export interface Followed extends Show { added: number; checked?: number; /** Episodes already told about ("anime:21#1181"). */ told?: string[]; }

const KEY = "Sonata_shows";
let shows: Followed[] = [];
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const save = () => void DataStore.set(KEY, shows);
const put = (next: Followed[]) => { shows = next; emit(); save(); };

export const loadShows = () => loaded ??= DataStore.get<Followed[]>(KEY).then(v => { if (Array.isArray(v)) shows = v; emit(); }).catch(() => { });
export const followed = () => shows;
export const isFollowing = (key: string) => shows.some(s => s.key === key);

export function useShows() {
    const [, bump] = useState(0);
    useEffect(() => { void loadShows(); const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    return shows;
}

const native = () => VencordNative.pluginHelpers.Sonata as any;

export async function search(source: Source, q: string): Promise<Show[] | string> {
    const r = await native().showsSearch(source, q).catch(() => null);
    return r?.ok ? r.shows : r?.error ?? "Couldn't search";
}

export function follow(s: Show) {
    if (isFollowing(s.key)) return;
    put([...shows, { ...s, added: Date.now() }]);
    void refresh([s.key]);
}
export const unfollow = (key: string) => put(shows.filter(s => s.key !== key));

/** "S2 · E5" for TV, "Episode 1181" for anime. */
export const episodeLabel = (s: Pick<Show, "source">, e?: { number?: number; season?: number; }) =>
    !e?.number ? "" : s.source === "tv" && e.season ? `S${e.season} · E${e.number}` : `Episode ${e.number}`;

let refreshing = false;
/** Fresh details from AniList and TVMaze (all of them, or just these). */
export async function refresh(keys = shows.map(s => s.key)) {
    if (!keys.length || refreshing) return;
    refreshing = true;
    try {
        const r = await native().showsRefresh(keys).catch(() => null);
        if (!r?.ok) return;
        const fresh = new Map<string, Show>(r.shows.map((s: Show) => [s.key, s]));
        put(shows.map(s => fresh.has(s.key) ? { ...s, ...fresh.get(s.key)!, added: s.added, told: s.told, checked: Date.now() } : s));
    } finally { refreshing = false; }
}

/** New episodes that have come out since they were last looked at: a pop-up each (once). */
function tellAboutNew() {
    const now = Date.now();
    let changed = false;
    const next = shows.map(s => {
        if (!s.next?.at || s.next.at > now) return s;
        const id = `${s.key}#${s.next.season ?? ""}:${s.next.number ?? ""}`;
        if (s.told?.includes(id)) return s;
        changed = true;
        // Only for episodes that came out in the last day (not ones missed while Discord was closed for a week).
        if (settings.store.alerts && now - s.next.at < 24 * 3_600_000)
            showNotification({ title: `New episode: ${s.title}`, body: `${episodeLabel(s, s.next)}${s.next.name ? ` · ${s.next.name}` : ""} is out${s.where ? ` on ${s.where}` : ""}.`, image: s.image, onClick: () => opener?.() });
        return { ...s, told: [...(s.told ?? []), id].slice(-30) };
    });
    if (changed) { put(next); void refresh(next.filter(s => s.next?.at && s.next.at <= now).map(s => s.key)); }
}

let opener: (() => void) | null = null;
export const setOpener = (fn: () => void) => { opener = fn; };

const HOUR = 3_600_000;
let timers: ReturnType<typeof setTimeout>[] = [];
export function startChecks() {
    stopChecks();
    void loadShows();
    timers.push(setTimeout(() => void refresh(), 45_000));
    timers.push(setInterval(() => void refresh(), 6 * HOUR) as any);
    timers.push(setInterval(tellAboutNew, 2 * 60_000) as any);
}
export function stopChecks() {
    for (const t of timers) clearTimeout(t);
    timers = [];
}

/* ── Times ── */

export function untilText(t: number) {
    const ms = t - Date.now();
    if (ms <= 0) return "out now";
    const m = Math.round(ms / 60000);
    if (m < 60) return `in ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `in ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? "tomorrow" : `in ${d} days`;
}
export const whenText = (t: number) => new Date(t).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
