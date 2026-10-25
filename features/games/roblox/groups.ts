/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Group Tracker: Roblox groups you watch, and their member count over time —
// checked every few hours while Discord is open, with a heads-up for new
// shouts and member milestones. Saved on this computer.

import { DataStore } from "@api/index";
import { showNotification } from "@api/Notifications";

import { callNative } from "../../_shared/native";
import type { RbxGroup } from "./data";

export interface Point { t: number; members: number; }
export interface Watched {
    id: string;
    name: string;
    icon: string;
    addedAt: number;
    history: Point[];
    shout: { body: string; poster: string; updated: string; } | null;
    lastCheck: number;
    error?: string;
}

const KEY = "Sonata_robloxGroups";
const MILESTONES = [100, 500, 1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 5_000_000];
let list: Watched[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const save = () => void DataStore.set(KEY, list);

export const onGroupsChange = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };
export const getGroups = () => list;

export async function loadGroups() {
    if (loaded) return;
    list = (await DataStore.get<Watched[]>(KEY).catch(() => undefined)) ?? [];
    loaded = true;
    emit();
}

/** Keeps every check from the last week, then one a day. */
function compact(points: Point[]) {
    const week = Date.now() - 7 * 86400_000;
    const out: Point[] = [];
    let day = "";
    for (const p of points) {
        if (p.t >= week) { out.push(p); continue; }
        const d = new Date(p.t).toDateString();
        if (d !== day) { out.push(p); day = d; } else out[out.length - 1] = p;
    }
    return out.slice(-400);
}

const fetchGroup = (id: string): Promise<{ ok: boolean; info?: RbxGroup; error?: string; }> => callNative("rbxGroup", id) as Promise<any>;

export async function watchGroup(id: string): Promise<string | null> {
    if (list.some(g => g.id === id)) return "You're already watching that group";
    const r = await fetchGroup(id);
    if (!r.ok || !r.info) return r.error ?? "Couldn't find that group";
    const g = r.info;
    list = [...list, { id, name: g.name, icon: g.icon, addedAt: Date.now(), history: [{ t: Date.now(), members: g.members }], shout: g.shout, lastCheck: Date.now() }];
    save(); emit();
    return null;
}

export function unwatchGroup(id: string) {
    list = list.filter(g => g.id !== id);
    save(); emit();
}

let notify = true;
export const setGroupAlerts = (on: boolean) => { notify = on; };

async function checkOne(w: Watched) {
    const r = await fetchGroup(w.id);
    const now = Date.now();
    list = list.map(x => {
        if (x.id !== w.id) return x;
        if (!r.ok || !r.info) return { ...x, error: r.error, lastCheck: now };
        const g = r.info;
        const before = x.history.at(-1)?.members ?? g.members;
        if (notify) {
            const hit = MILESTONES.filter(m => before < m && g.members >= m).at(-1);
            if (hit) showNotification({ title: `🎉 ${g.name}`, body: `Just passed ${hit.toLocaleString()} members on Roblox!` });
            if (g.shout && g.shout.updated !== x.shout?.updated && x.shout !== undefined) showNotification({ title: `📣 New shout in ${g.name}`, body: `${g.shout.poster}: ${g.shout.body.slice(0, 180)}` });
        }
        return { ...x, name: g.name, icon: g.icon || x.icon, shout: g.shout, history: compact([...x.history, { t: now, members: g.members }]), lastCheck: now, error: undefined };
    });
    save(); emit();
}

let busy = false;
export async function checkGroups(force = false, everyHours = 3) {
    if (busy) return;
    busy = true;
    try {
        for (const w of [...list]) {
            if (!force && Date.now() - w.lastCheck < everyHours * 3600_000) continue;
            await checkOne(w);
            await new Promise(r => setTimeout(r, 1500));
        }
    } finally { busy = false; }
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startGroupChecks(everyHours: () => number) {
    stopGroupChecks();
    timer = setInterval(() => void checkGroups(false, everyHours()), 10 * 60_000);
    setTimeout(() => void checkGroups(false, everyHours()), 20_000);
}
export function stopGroupChecks() { if (timer) clearInterval(timer); timer = null; }
