/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The weekly recap: when one of your calls ends, how long it lasted and how
// long you were in it with each person is added to that day's totals. Only
// your own calls, only on this computer (DataStore), and only totals — no
// messages, no timeline. Kept for 10 weeks.

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

import type { Session } from "./tracker";

const KEY = "Sonata_voiceRecap";
const KEEP_DAYS = 70;
/** Calls shorter than this (joined by mistake) don't count. */
const MIN_CALL = 60_000;

export interface Day {
    calls: number;
    ms: number;
    /** Time in a call together, per person. */
    people: Record<string, number>;
    /** Time per voice channel. */
    channels: Record<string, number>;
}

type Days = Record<string, Day>;

let days: Days | null = null;
let loading: Promise<Days> | null = null;
const listeners = new Set<() => void>();

export const dayKey = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function loadRecap() {
    return loading ??= DataStore.get<Days>(KEY).then(v => { days = v ?? {}; listeners.forEach(l => l()); return days; }).catch(() => days = {});
}

/** How long you were in `s` with each person (several visits add up). */
export function togetherTimes(s: Session, end: number) {
    const out: Record<string, number> = {};
    const add = (id: string, from: number | null, to: number) => { out[id] = (out[id] ?? 0) + Math.max(0, to - Math.max(from ?? s.startedAt, s.startedAt)); };
    for (const st of s.stays) add(st.userId, st.joinedAt, st.leftAt);
    for (const p of s.present.values()) add(p.userId, p.joinedAt, end);
    return out;
}

/** Add a finished call to the day it started on. */
export async function recordSession(s: Session, end: number) {
    const length = end - s.startedAt;
    if (length < MIN_CALL) return;
    const all = { ...(await loadRecap()) };
    const k = dayKey(s.startedAt);
    const day: Day = all[k] ? { ...all[k], people: { ...all[k].people }, channels: { ...all[k].channels } } : { calls: 0, ms: 0, people: {}, channels: {} };
    day.calls++;
    day.ms += length;
    day.channels[s.channelId] = (day.channels[s.channelId] ?? 0) + length;
    for (const [id, ms] of Object.entries(togetherTimes(s, end))) if (ms >= 1000) day.people[id] = (day.people[id] ?? 0) + ms;
    all[k] = day;
    const oldest = dayKey(Date.now() - KEEP_DAYS * 86_400_000);
    for (const key of Object.keys(all)) if (key < oldest) delete all[key];
    days = all;
    listeners.forEach(l => l());
    await DataStore.set(KEY, all);
}

export interface Week {
    from: number;
    calls: number;
    ms: number;
    /** Each of the 7 days, oldest first. */
    perDay: { key: string; t: number; ms: number; }[];
    people: [string, number][];
    channels: [string, number][];
}

/** The 7 days ending `weeksAgo` weeks before today (today included when 0). */
export function weekOf(weeksAgo: number, extra?: { day: string; session: Session; }): Week {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const perDay: Week["perDay"] = [];
    const people: Record<string, number> = {}, channels: Record<string, number> = {};
    let calls = 0, ms = 0;
    for (let i = 6; i >= 0; i--) {
        const t = today.getTime() - (i + weeksAgo * 7) * 86_400_000;
        const key = dayKey(t);
        const d = days?.[key];
        let dayMs = d?.ms ?? 0;
        if (d) {
            calls += d.calls;
            for (const [id, v] of Object.entries(d.people)) people[id] = (people[id] ?? 0) + v;
            for (const [id, v] of Object.entries(d.channels)) channels[id] = (channels[id] ?? 0) + v;
        }
        // The call you're in right now counts too, live.
        if (extra && extra.day === key) {
            const now = Date.now(), live = now - extra.session.startedAt;
            calls++;
            dayMs += live;
            channels[extra.session.channelId] = (channels[extra.session.channelId] ?? 0) + live;
            for (const [id, v] of Object.entries(togetherTimes(extra.session, now))) people[id] = (people[id] ?? 0) + v;
        }
        ms += dayMs;
        perDay.push({ key, t, ms: dayMs });
    }
    const sorted = (r: Record<string, number>) => Object.entries(r).sort((a, b) => b[1] - a[1]);
    return { from: perDay[0].t, calls, ms, perDay, people: sorted(people), channels: sorted(channels) };
}

export function useRecap() {
    const [, force] = useState(0);
    useEffect(() => {
        const l = () => force(n => n + 1);
        listeners.add(l);
        void loadRecap();
        return () => { listeners.delete(l); };
    }, []);
    return days != null;
}

export async function clearRecap() {
    days = {};
    listeners.forEach(l => l());
    await DataStore.set(KEY, {});
}
