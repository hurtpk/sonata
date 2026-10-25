/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// My account: your own Roblox account. Always on the People watch (so you
// hear about any change to it), shown at the top of the sidebar, with your
// followers and friends kept over time. Saved on this computer.

import { DataStore } from "@api/index";

import { callNative } from "../../_shared/native";
import type { RbxUser } from "./data";
import { getPeople, isWatched, loadPeople, watchPerson } from "./watchlist";

export interface MePoint { t: number; followers: number; following: number; friends: number; }
export interface Me {
    id: string;
    name: string;
    displayName: string;
    avatar: string;
    setAt: number;
    lastCheck: number;
    history: MePoint[];
}

const KEY = "Sonata_robloxMe";
let me: Me | null = null;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const save = () => void DataStore.set(KEY, me);

export const onMeChange = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };
export const getMe = () => me;
export const isMe = (id: string) => !!me && me.id === id;

export async function loadMe() {
    if (loaded) return;
    me = (await DataStore.get<Me | null>(KEY).catch(() => null)) ?? null;
    loaded = true;
    emit();
}

const fetchUser = (q: string): Promise<{ ok: boolean; info?: RbxUser; error?: string; }> => callNative("rbxUser", q) as Promise<any>;

/** Keeps every check from the last two weeks, then one a day. */
function compact(points: MePoint[]) {
    const recent = Date.now() - 14 * 86400_000;
    const out: MePoint[] = [];
    let day = "";
    for (const p of points) {
        if (p.t >= recent) { out.push(p); continue; }
        const d = new Date(p.t).toDateString();
        if (d !== day) { out.push(p); day = d; } else out[out.length - 1] = p;
    }
    return out.slice(-500);
}

function record(u: RbxUser) {
    const now = Date.now();
    const point: MePoint = { t: now, followers: u.followers ?? 0, following: u.following ?? 0, friends: u.friends ?? 0 };
    me = {
        id: u.id, name: u.name, displayName: u.displayName, avatar: u.avatar || me?.avatar || "",
        setAt: me?.id === u.id ? me.setAt : now, lastCheck: now,
        history: compact([...(me?.id === u.id ? me.history : []), point]),
    };
}

/** Sets your account (by username, profile link or ID), and starts watching it. */
export async function setMe(q: string): Promise<string | null> {
    const id = q.trim().match(/users\/(\d+)/)?.[1] ?? q.trim().replace(/^@/, "");
    if (!id) return "Type your Roblox username or ID";
    const r = await fetchUser(id);
    if (!r.ok || !r.info) return r.error ?? "Couldn't find that account";
    record(r.info);
    save(); emit();
    await ensureWatched();
    return null;
}

export function clearMe() {
    me = null;
    save(); emit();
}

/** Your account is always on the People watch. */
async function ensureWatched() {
    if (!me) return;
    await loadPeople();
    if (!isWatched(me.id)) await watchPerson(me.id);
}

export async function checkMe(force = false, everyHours = 3) {
    if (!me) return;
    if (!force && Date.now() - me.lastCheck < everyHours * 3600_000) return;
    const r = await fetchUser(me.id);
    if (!r.ok || !r.info) return;
    record(r.info);
    save(); emit();
}

/** How much a number changed over the last `days` days. */
export function change(field: keyof Omit<MePoint, "t">, days: number): number | null {
    if (!me || me.history.length < 2) return null;
    const now = me.history[me.history.length - 1];
    const from = Date.now() - days * 86400_000;
    const then = [...me.history].reverse().find(p => p.t <= from) ?? me.history[0];
    return then === now ? null : now[field] - then[field];
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startMe(everyHours: () => number) {
    stopMe();
    void loadMe().then(ensureWatched);
    timer = setInterval(() => void checkMe(false, everyHours()), 10 * 60_000);
    setTimeout(() => void checkMe(false, everyHours()), 30_000);
}
export function stopMe() { if (timer) clearInterval(timer); timer = null; }

/** For the People list: is this someone you can't stop watching? */
export const lockedInWatch = (id: string) => isMe(id) && getPeople().some(p => p.id === id);
