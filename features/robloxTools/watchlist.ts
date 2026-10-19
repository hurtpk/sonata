/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Profile watch: Roblox accounts you keep an eye on. Checked every few hours
// while Discord is open; any change to their username, display name, bio or
// avatar is kept as a timeline (with a heads-up, if you like). Saved on this
// computer.

import { DataStore } from "@api/index";
import { showNotification } from "@api/Notifications";

import { callNative } from "../_shared/native";
import type { RbxUser } from "./data";

export type Field = "name" | "displayName" | "bio" | "avatar" | "banned" | "verified";
export interface Change { t: number; field: Field; from: string; to: string; }
export interface Person {
    id: string;
    name: string;
    displayName: string;
    bio: string;
    avatar: string;
    body: string;
    banned: boolean;
    verified: boolean;
    /** What they're wearing (item IDs) — how a real avatar change is told apart from Roblox redrawing the picture. */
    wearing?: string | null;
    addedAt: number;
    lastCheck: number;
    changes: Change[];
    error?: string;
}

export const FIELD_LABEL: Record<Field, string> = {
    name: "Username", displayName: "Display name", bio: "Bio", avatar: "Avatar", banned: "Account", verified: "Verified badge",
};

const KEY = "Sonata_robloxPeople";
let list: Person[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const save = () => void DataStore.set(KEY, list);

export const onPeopleChange = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };
export const getPeople = () => list;
export const isWatched = (id: string) => list.some(p => p.id === id);

export async function loadPeople() {
    if (loaded) return;
    list = (await DataStore.get<Person[]>(KEY).catch(() => undefined)) ?? [];
    loaded = true;
    emit();
}

const fetchUser = (q: string): Promise<{ ok: boolean; info?: RbxUser; error?: string; }> => callNative("rbxUser", q) as Promise<any>;
const fetchWearing = async (id: string): Promise<string | null> => { const r = await callNative<string | null>("rbxWearing", id); return typeof r === "string" ? r : null; };

/** The avatar picture's address changes when (and only when) the avatar does. */
const avatarSig = (url: string) => url.match(/rbxcdn\.com\/([^/]+)/)?.[1] ?? url;

export async function watchPerson(q: string): Promise<string | null> {
    await loadPeople();
    const r = await fetchUser(q);
    if (!r.ok || !r.info) return r.error ?? "Couldn't find that account";
    const u = r.info;
    if (list.some(p => p.id === u.id)) return `You're already watching ${u.displayName}`;
    const wearing = await fetchWearing(u.id);
    list = [{ id: u.id, name: u.name, displayName: u.displayName, bio: u.bio, avatar: u.avatar, body: u.body, banned: u.banned, verified: u.verified, wearing, addedAt: Date.now(), lastCheck: Date.now(), changes: [] }, ...list];
    save(); emit();
    return null;
}

export function unwatchPerson(id: string) {
    list = list.filter(p => p.id !== id);
    save(); emit();
}

let notify = true;
export const setPeopleAlerts = (on: boolean) => { notify = on; };

function describe(c: Change) {
    switch (c.field) {
        case "name": return `changed their username from @${c.from} to @${c.to}`;
        case "displayName": return `changed their display name from “${c.from}” to “${c.to}”`;
        case "bio": return c.to ? "changed their bio" : "cleared their bio";
        case "avatar": return "changed their avatar";
        case "banned": return c.to === "yes" ? "was banned from Roblox" : "is no longer banned";
        case "verified": return c.to === "yes" ? "got the verified badge" : "lost the verified badge";
    }
}

async function checkOne(p: Person) {
    const [r, wearing] = await Promise.all([fetchUser(p.id), fetchWearing(p.id)]);
    const now = Date.now();
    list = list.map(x => {
        if (x.id !== p.id) return x;
        if (!r.ok || !r.info) return { ...x, error: r.error, lastCheck: now };
        const u = r.info;
        const found: Change[] = [];
        const diff = (field: Field, from: string, to: string) => { if (from !== to) found.push({ t: now, field, from, to }); };
        diff("name", x.name, u.name);
        diff("displayName", x.displayName, u.displayName);
        diff("bio", x.bio, u.bio);
        // By what they're wearing when we know it both times; otherwise by the picture (only when there is one both times —
        // Roblox sometimes hands back none for a moment).
        const changedLook = x.wearing && wearing ? x.wearing !== wearing : !!(x.body && u.body && avatarSig(x.body) !== avatarSig(u.body));
        if (changedLook) found.push({ t: now, field: "avatar", from: x.body, to: u.body || x.body });
        diff("banned", x.banned ? "yes" : "no", u.banned ? "yes" : "no");
        diff("verified", x.verified ? "yes" : "no", u.verified ? "yes" : "no");
        if (notify) for (const c of found) showNotification({ title: `👤 ${u.displayName} (@${u.name})`, body: `${describe(c)} on Roblox.`, icon: u.avatar || undefined });
        return {
            ...x, name: u.name, displayName: u.displayName, bio: u.bio, avatar: u.avatar || x.avatar, body: u.body || x.body, banned: u.banned, verified: u.verified,
            wearing: wearing ?? x.wearing, lastCheck: now, error: undefined, changes: [...found, ...x.changes].slice(0, 200),
        };
    });
    save(); emit();
}

export { describe as describeChange };

let busy = false;
export async function checkPeople(force = false, everyHours = 3) {
    if (busy) return;
    busy = true;
    try {
        for (const p of [...list]) {
            if (!force && Date.now() - p.lastCheck < everyHours * 3600_000) continue;
            await checkOne(p);
            await new Promise(r => setTimeout(r, 1500));
        }
    } finally { busy = false; }
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startPeopleChecks(everyHours: () => number) {
    stopPeopleChecks();
    timer = setInterval(() => void checkPeople(false, everyHours()), 10 * 60_000);
    setTimeout(() => void checkPeople(false, everyHours()), 40_000);
}
export function stopPeopleChecks() { if (timer) clearInterval(timer); timer = null; }
