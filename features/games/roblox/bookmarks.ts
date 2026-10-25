/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Saved: games, profiles, groups and items you bookmarked, shown down the
// left of the Roblox Tools window. Saved on this computer.

import { DataStore } from "@api/index";

import { callNative } from "../../_shared/native";
import type { RbxInfo, RbxRef } from "./data";
import { getMe } from "./me";

export type SavedKind = "game" | "user" | "group" | "item";
export interface Saved {
    kind: SavedKind;
    /** Place ID for games, user / group / item ID otherwise. */
    id: string;
    name: string;
    sub: string;
    icon: string;
    /** Games: the universe, for live player counts. */
    universeId?: string;
    bundle?: boolean;
    addedAt: number;
}

const KEY = "Sonata_robloxSaved";
let list: Saved[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const save = () => void DataStore.set(KEY, list);

export const onSavedChange = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };
export const getSaved = () => list;
export const isSaved = (kind: SavedKind, id: string) => list.some(s => s.kind === kind && s.id === id);

export async function loadSaved() {
    if (loaded) return;
    list = (await DataStore.get<Saved[]>(KEY).catch(() => undefined)) ?? [];
    loaded = true;
    emit();
}

/** What to keep about something you save, from its card. */
export function savedFrom(info: RbxInfo): Saved {
    const at = Date.now();
    switch (info.kind) {
        case "game": return { kind: "game", id: info.placeId, name: info.name, sub: `by ${info.creator}`, icon: info.icon, universeId: info.universeId, addedAt: at };
        case "user": return { kind: "user", id: info.id, name: info.displayName, sub: `@${info.name}`, icon: info.avatar, addedAt: at };
        case "group": return { kind: "group", id: info.id, name: info.name, sub: `${info.members.toLocaleString()} members`, icon: info.icon, addedAt: at };
        case "item": return { kind: "item", id: info.id, name: info.name, sub: info.type, icon: info.image, bundle: info.bundle, addedAt: at };
    }
}

export async function toggleSaved(info: RbxInfo) {
    await loadSaved();
    const s = savedFrom(info);
    if (isSaved(s.kind, s.id)) list = list.filter(x => !(x.kind === s.kind && x.id === s.id));
    else list = [s, ...list];
    save(); emit();
}

/** Keeps a saved entry's name and picture up to date when its card is opened. */
export function refreshSaved(info: RbxInfo) {
    const s = savedFrom(info);
    const i = list.findIndex(x => x.kind === s.kind && x.id === s.id);
    if (i < 0) return;
    const old = list[i];
    if (old.name === s.name && old.icon === s.icon && old.sub === s.sub) return;
    list = list.map((x, j) => j === i ? { ...s, addedAt: old.addedAt } : x);
    save(); emit();
}

export function removeSaved(kind: SavedKind, id: string) {
    list = list.filter(x => !(x.kind === kind && x.id === id));
    save(); emit();
}

export const refOf = (s: Saved): RbxRef => s.kind === "item" ? { kind: "item", id: s.id, bundle: !!s.bundle } : { kind: s.kind, id: s.id };

/* Live numbers: players for games, online status for people, members for groups. */

export interface Live { games: Record<string, number>; users: Record<string, number>; groups: Record<string, number>; at: number; }
let live: Live | null = null;
let asking: Promise<void> | null = null;

export const getLive = () => live;

export function refreshLive(force = false) {
    if (asking) return asking;
    if (!force && live && Date.now() - live.at < 60_000) return Promise.resolve();
    const games = list.filter(s => s.kind === "game" && s.universeId).map(s => s.universeId!);
    const mine = getMe()?.id;
    const users = [...new Set([...(mine ? [mine] : []), ...list.filter(s => s.kind === "user").map(s => s.id)])];
    const groups = list.filter(s => s.kind === "group").map(s => s.id);
    if (!games.length && !users.length && !groups.length) return Promise.resolve();
    asking = (async () => {
        const r: any = await callNative("rbxSavedLive", games, users, groups);
        if (r && !("ok" in r && r.ok === false)) { live = { games: r.games ?? {}, users: r.users ?? {}, groups: r.groups ?? {}, at: Date.now() }; emit(); }
    })().finally(() => { asking = null; });
    return asking;
}
