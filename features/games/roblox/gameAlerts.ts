/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Game alerts for the games you saved: when one updates, or passes a
// player-count or visits milestone. One request for all of them every 10
// minutes. The first look only notes where each game stands, so turning it
// on doesn't flood you; mute any game with its bell in the Saved sidebar.

import { DataStore } from "@api/index";
import { showNotification } from "@api/Notifications";

import { callNative } from "../../_shared/native";
import { getSaved, onSavedChange, Saved } from "./bookmarks";

interface Seen { updated: string; /** The highest player milestone told about (0 = none). */ players: number; visits: number; }
interface State { seen: Record<string, Seen>; muted: string[]; }

const KEY = "Sonata_robloxGameAlerts";
const PLAYERS = [100, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
const VISITS = [1e6, 1e7, 5e7, 1e8, 5e8, 1e9, 5e9, 1e10];

let state: State = { seen: {}, muted: [] };
let loaded = false;
let on = { updates: true, players: true, visits: true };
const listeners = new Set<() => void>();

export const setGameAlerts = (o: typeof on) => { on = o; };
export const onAlertsChange = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };
export const isMuted = (universeId: string) => state.muted.includes(universeId);

async function load() {
    if (loaded) return;
    state = { seen: {}, muted: [], ...(await DataStore.get<State>(KEY)) };
    loaded = true;
}
const save = () => void DataStore.set(KEY, state);

export async function toggleMuted(universeId: string) {
    await load();
    state.muted = isMuted(universeId) ? state.muted.filter(x => x !== universeId) : [...state.muted, universeId];
    save();
    listeners.forEach(l => l());
}

const short = (n: number) => n >= 1e9 ? `${+(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : String(n);
const reached = (list: number[], n: number) => list.filter(m => n >= m).at(-1) ?? 0;

function tell(s: Saved, title: string, body: string) {
    showNotification({
        title, body, icon: s.icon || undefined,
        onClick: () => VencordNative.native.openExternal(`https://www.roblox.com/games/${s.id}`),
    });
}

/** Compares the latest numbers with what was last seen, and tells you what changed. */
export async function checkGames() {
    await load();
    const games = getSaved().filter(s => s.kind === "game" && s.universeId);
    if (!games.length) return;
    const r: any = await callNative("rbxSavedLive", games.map(g => g.universeId!), [], []);
    const info: Record<string, { playing: number; visits: number; updated: string; }> | undefined = r?.info;
    // Before a full restart the network side is the old one (no info yet): nothing to do.
    if (!info) return;
    for (const g of games) {
        const now = info[g.universeId!];
        if (!now) continue;
        const was = state.seen[g.universeId!];
        const muted = isMuted(g.universeId!);
        const players = reached(PLAYERS, now.playing), visits = reached(VISITS, now.visits);
        if (was && !muted) {
            if (on.updates && now.updated && was.updated && now.updated !== was.updated && Date.parse(now.updated) > Date.parse(was.updated))
                tell(g, `🛠️ ${g.name} just updated`, `Updated ${new Date(now.updated).toLocaleString()} · ${short(now.playing)} playing`);
            if (on.players && players > was.players)
                tell(g, `🎉 ${g.name} hit ${short(players)} players`, `${now.playing.toLocaleString()} people are playing right now.`);
            if (on.visits && visits > was.visits)
                tell(g, `🏆 ${g.name} passed ${short(visits)} visits`, `${now.visits.toLocaleString()} visits in total.`);
        }
        // A player milestone can be told about again once it's dropped well below it.
        const keepPlayers = was && now.playing >= (was.players || 0) / 2 ? Math.max(was.players, players) : players;
        state.seen[g.universeId!] = { updated: now.updated || was?.updated || "", players: keepPlayers, visits: Math.max(was?.visits ?? 0, visits) };
    }
    save();
}

let timer: ReturnType<typeof setInterval> | null = null;
let unsub: (() => void) | null = null;
export function startGameAlerts() {
    stopGameAlerts();
    void load().then(() => listeners.forEach(l => l()));
    timer = setInterval(() => void checkGames().catch(() => { }), 10 * 60_000);
    setTimeout(() => void checkGames().catch(() => { }), 60_000);
    // A newly saved game gets its starting point straight away (only when the list of games changes —
    // the same signal also fires when live numbers refresh).
    let ids = "";
    unsub = onSavedChange(() => {
        const next = getSaved().filter(x => x.kind === "game" && x.universeId).map(x => x.universeId).sort().join(",");
        if (next === ids) return;
        const first = !ids;
        ids = next;
        if (!first) void checkGames().catch(() => { });
    });
}
export function stopGameAlerts() {
    if (timer) clearInterval(timer);
    timer = null;
    unsub?.();
    unsub = null;
}
