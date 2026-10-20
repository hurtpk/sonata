/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What Games keeps on this computer (DataStore): your Minecraft servers, the
// Fortnite items you're waiting for, the games whose prices you're watching,
// and what it has already told you about. Plus the background checks that
// send a notification when something you care about happens.

import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { OptionType } from "@utils/types";
import { useEffect, useState } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import type { DealStore, EpicGame, McServer, PassGame, ShopItem } from "./native";

export const native = () => VencordNative.pluginHelpers.Sonata as any;

export const settings = defineFeatureSettings("games", {
    epicAlerts: { type: OptionType.BOOLEAN, description: "Tell me when Epic gives away new free games", default: true },
    shopAlerts: { type: OptionType.BOOLEAN, description: "Tell me when a Fortnite item I'm waiting for is in the shop", default: true },
    priceAlerts: { type: OptionType.BOOLEAN, description: "Tell me when a game I'm watching drops to my price", default: true },
    serverAlerts: { type: OptionType.BOOLEAN, description: "Tell me when a Minecraft server I saved goes offline or comes back", default: false },
    passAlerts: { type: OptionType.BOOLEAN, description: "Tell me when games are coming to or leaving Game Pass", default: false },
    country: { type: OptionType.STRING, description: "Country for prices and store lists (two letters, like US or GB)", default: "US" },
});

export interface PriceWatch { id: string; title: string; thumb?: string; target: number; last?: number; told?: number; }
export interface SavedServer { host: string; name?: string; online?: boolean; players?: number; checked?: number; icon?: string; }

interface Saved {
    servers: SavedServer[];
    /** Fortnite item names you're waiting for (lower case). */
    wishlist: string[];
    prices: PriceWatch[];
    /** Already told about: Epic giveaways, shop items today, Game Pass games. */
    seenEpic: string[];
    seenShop: string[];
    seenPass: string[];
}

const KEY = "Sonata_games";
let state: Saved = { servers: [], wishlist: [], prices: [], seenEpic: [], seenShop: [], seenPass: [] };
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const save = () => void DataStore.set(KEY, state);
const put = (patch: Partial<Saved>) => { state = { ...state, ...patch }; emit(); save(); };

export const loadGames = () => loaded ??= DataStore.get<Saved>(KEY).then(v => { if (v) state = { ...state, ...v }; emit(); }).catch(() => { });
export const games = () => state;

export function useGames() {
    const [, bump] = useState(0);
    useEffect(() => { void loadGames(); const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    return state;
}

export const country = () => /^[A-Za-z]{2}$/.test(settings.store.country ?? "") ? settings.store.country!.toUpperCase() : "US";

/* ── Minecraft servers ── */

export function addServer(host: string) {
    const h = host.trim().toLowerCase();
    if (!h || state.servers.some(s => s.host === h)) return;
    put({ servers: [...state.servers, { host: h }] });
}
export const removeServer = (host: string) => put({ servers: state.servers.filter(s => s.host !== host) });
export const renameServer = (host: string, name: string) => put({ servers: state.servers.map(s => s.host === host ? { ...s, name: name.trim() || undefined } : s) });

export async function checkServer(host: string): Promise<McServer | string> {
    const r = await native().gamesMcServer(host).catch(() => null);
    if (!r?.ok) return r?.error ?? "Couldn't check";
    const s: McServer = r.server;
    const before = state.servers.find(x => x.host === host);
    if (before) {
        if (settings.store.serverAlerts && before.online !== undefined && before.online !== s.online)
            showNotification({ title: `${before.name ?? host} is ${s.online ? "back online" : "offline"}`, body: s.online ? `${s.players} of ${s.max} playing` : "The Minecraft server isn't answering", icon: s.icon });
        put({ servers: state.servers.map(x => x.host === host ? { ...x, online: s.online, players: s.players, checked: Date.now(), icon: s.icon ?? x.icon } : x) });
    }
    return s;
}

/* ── Fortnite wishlist ── */

const norm = (name: string) => name.trim().toLowerCase();
export const isWished = (name: string) => state.wishlist.includes(norm(name));
export function setWished(name: string, on: boolean) {
    const n = norm(name);
    put({ wishlist: on ? [...new Set([...state.wishlist, n])] : state.wishlist.filter(x => x !== n) });
}

/* ── Price watches ── */

export function watchPrice(w: Omit<PriceWatch, "told">) {
    put({ prices: [...state.prices.filter(p => p.id !== w.id), w] });
}
export const unwatchPrice = (id: string) => put({ prices: state.prices.filter(p => p.id !== id) });
export const isWatchingPrice = (id: string) => state.prices.some(p => p.id === id);

/* ── Shared caches for the window (so switching tabs doesn't refetch) ── */

export const cache: { epic?: EpicGame[]; shop?: { date: string; items: ShopItem[]; }; pass: Partial<Record<"added" | "coming" | "leaving", PassGame[]>>; stores?: Record<string, DealStore>; } = { pass: {} };

export async function dealStores() {
    if (cache.stores) return cache.stores;
    const r = await native().gamesDealStores().catch(() => null);
    if (r?.ok) cache.stores = Object.fromEntries((r.stores as DealStore[]).map(s => [s.id, s]));
    return cache.stores ?? {};
}

/* ── Background checks ── */

const HOUR = 3_600_000;
let timers: ReturnType<typeof setTimeout>[] = [];

async function checkEpic() {
    if (!settings.store.epicAlerts) return;
    const r = await native().gamesEpicFree(country()).catch(() => null);
    if (!r?.ok) return;
    cache.epic = r.games;
    const now = (r.games as EpicGame[]).filter(g => g.now);
    const fresh = now.filter(g => !state.seenEpic.includes(`${g.id}:${g.start}`));
    // The very first check only remembers what's already free.
    if (state.seenEpic.length && fresh.length)
        showNotification({ title: fresh.length === 1 ? `Free on Epic: ${fresh[0].title}` : `${fresh.length} free games on Epic`, body: fresh.map(g => g.title).join(", ") + ` — free until ${new Date(fresh[0].end).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}`, image: fresh[0].image });
    put({ seenEpic: [...new Set([...state.seenEpic, ...now.map(g => `${g.id}:${g.start}`)])].slice(-60) });
}

async function checkShop() {
    if (!settings.store.shopAlerts || !state.wishlist.length) return;
    const r = await native().gamesFortniteShop().catch(() => null);
    if (!r?.ok) return;
    cache.shop = { date: r.date, items: r.items };
    const hits = (r.items as ShopItem[]).filter(i => state.wishlist.includes(norm(i.name)) && !state.seenShop.includes(`${r.date}:${norm(i.name)}`));
    if (hits.length)
        showNotification({ title: hits.length === 1 ? `${hits[0].name} is in the Fortnite shop` : `${hits.length} items you want are in the Fortnite shop`, body: hits.map(i => `${i.name} — ${i.price} V-Bucks`).join(", "), image: hits[0].image });
    put({ seenShop: [...new Set([...state.seenShop.filter(s => s.startsWith(r.date)), ...hits.map(i => `${r.date}:${norm(i.name)}`)])] });
}

async function checkPrices() {
    if (!settings.store.priceAlerts || !state.prices.length) return;
    for (const w of state.prices) {
        const r = await native().gamesDealGame(w.id).catch(() => null);
        if (!r?.ok || !r.deals.length) continue;
        const best = r.deals[0];
        const stores = await dealStores();
        // Once per price: told again only if it drops further.
        if (best.price <= w.target && (w.told == null || best.price < w.told))
            showNotification({ title: `${w.title} is $${best.price.toFixed(2)}`, body: `On ${stores[best.store]?.name ?? "a store"} — your price was $${w.target.toFixed(2)} (${best.savings}% off)`, image: w.thumb });
        put({ prices: state.prices.map(p => p.id === w.id ? { ...p, last: best.price, told: best.price <= w.target ? Math.min(best.price, p.told ?? Infinity) : undefined } : p) });
        await new Promise(r => setTimeout(r, 1500));
    }
}

async function checkPass() {
    if (!settings.store.passAlerts) return;
    const coming = await native().gamesGamePass("coming", country()).catch(() => null);
    const leaving = await native().gamesGamePass("leaving", country()).catch(() => null);
    const items = [...(coming?.ok ? coming.games.map((g: PassGame) => ({ g, why: "coming" })) : []), ...(leaving?.ok ? leaving.games.map((g: PassGame) => ({ g, why: "leaving" })) : [])];
    if (!items.length) return;
    const fresh = items.filter(x => !state.seenPass.includes(`${x.why}:${x.g.id}`));
    if (state.seenPass.length && fresh.length) {
        const c = fresh.filter(x => x.why === "coming").map(x => x.g.title), l = fresh.filter(x => x.why === "leaving").map(x => x.g.title);
        showNotification({ title: "Game Pass", body: [c.length && `Coming: ${c.join(", ")}`, l.length && `Leaving soon: ${l.join(", ")}`].filter(Boolean).join(" · "), image: fresh[0].g.image });
    }
    put({ seenPass: items.map(x => `${x.why}:${x.g.id}`) });
}

async function checkServers() {
    if (!settings.store.serverAlerts) return;
    for (const s of state.servers) { await checkServer(s.host); await new Promise(r => setTimeout(r, 1000)); }
}

function every(ms: number, fn: () => Promise<void>, first = 90_000) {
    const run = () => { void fn().catch(() => { }); timers.push(setTimeout(run, ms)); };
    timers.push(setTimeout(run, first));
}

export function startChecks() {
    void loadGames();
    every(4 * HOUR, checkEpic);
    every(2 * HOUR, checkShop, 120_000);
    every(6 * HOUR, checkPrices, 150_000);
    every(12 * HOUR, checkPass, 180_000);
    every(5 * 60_000, checkServers, 60_000);
}

export function stopChecks() {
    timers.forEach(clearTimeout);
    timers = [];
}
