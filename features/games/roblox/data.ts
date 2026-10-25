/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Reading Roblox links and asking Roblox about them (kept for a few minutes,
// so scrolling past the same link doesn't ask again).

import { callNative, hasNative, NEEDS_RESTART } from "../../_shared/native";
import type { RbxAssetInfo, RbxHistory, RbxInfo, RbxInventoryDay, RbxItemHistory, RbxLimited, RbxMembership, RbxOutfit, RbxOwnedGame, RbxPlayerHistory, RbxServer, RbxShop } from "./native";

export type { RbxAssetInfo, RbxGame, RbxGroup, RbxHistory, RbxHolding, RbxInfo, RbxInventoryDay, RbxInventoryItem, RbxItem, RbxItemHistory, RbxLimited, RbxMembership, RbxOutfit, RbxOwnedGame, RbxPass, RbxPeak, RbxPlayerHistory, RbxServer, RbxShop, RbxUser, RbxWorn } from "./native";

export type RbxRef = { kind: "user"; id: string; } | { kind: "game"; id: string; } | { kind: "group"; id: string; } | { kind: "item"; id: string; bundle: boolean; };

const PATTERNS: [RegExp, (m: RegExpMatchArray) => RbxRef][] = [
    [/roblox\.com\/(?:[a-z]{2}\/)?users\/(\d+)/i, m => ({ kind: "user", id: m[1] })],
    [/roblox\.com\/(?:[a-z]{2}\/)?games\/(\d+)/i, m => ({ kind: "game", id: m[1] })],
    [/roblox\.com\/(?:[a-z]{2}\/)?(?:groups|communities)\/(\d+)/i, m => ({ kind: "group", id: m[1] })],
    [/roblox\.com\/(?:[a-z]{2}\/)?bundles\/(\d+)/i, m => ({ kind: "item", id: m[1], bundle: true })],
    [/roblox\.com\/(?:[a-z]{2}\/)?(?:catalog|library|marketplace\/asset)\/(\d+)/i, m => ({ kind: "item", id: m[1], bundle: false })],
];

/** Every Roblox link in a message (up to three), in order. */
export function findLinks(text: string): RbxRef[] {
    const out: RbxRef[] = [];
    const seen = new Set<string>();
    for (const raw of text.match(/https?:\/\/(?:www\.|web\.)?roblox\.com\/[^\s<>()]+/gi) ?? []) {
        for (const [re, make] of PATTERNS) {
            const m = raw.match(re);
            if (!m) continue;
            const ref = make(m);
            const key = `${ref.kind}:${ref.id}`;
            if (!seen.has(key)) { seen.add(key); out.push(ref); }
            break;
        }
        if (out.length >= 3) break;
    }
    return out;
}

/** A link, an ID or a username typed into the look-up box. */
export function parseLookup(text: string): RbxRef | null {
    const t = text.trim();
    if (!t) return null;
    const link = findLinks(t.startsWith("http") ? t : `https://www.roblox.com/${t.replace(/^\/+/, "")}`)[0];
    if (link && /roblox\.com|^(users|games|groups|communities|catalog|bundles)\//i.test(t)) return link;
    if (/^\d{1,19}$/.test(t)) return { kind: "user", id: t };
    if (/^@?[A-Za-z0-9_]{3,20}$/.test(t)) return { kind: "user", id: t.replace(/^@/, "") };
    return null;
}

const cache = new Map<string, { at: number; p: Promise<{ ok: boolean; info?: RbxInfo; error?: string; }>; }>();

export function fetchRef(ref: RbxRef, fresh = false) {
    const key = ref.kind === "item" ? `item:${ref.bundle ? "b" : "a"}:${ref.id}` : `${ref.kind}:${ref.id.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && !fresh && Date.now() - hit.at < 5 * 60_000) return hit.p;
    const p: Promise<any> = ref.kind === "user" ? callNative("rbxUser", ref.id) : ref.kind === "game" ? callNative("rbxGame", ref.id) : ref.kind === "group" ? callNative("rbxGroup", ref.id) : callNative("rbxItem", ref.id, ref.bundle);
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), p });
    return p;
}

/* ── Formatting ─────────────────────────────────────────────────────── */

export function short(n: number | null | undefined): string {
    if (n == null) return "–";
    const a = Math.abs(n);
    if (a < 1000) return String(n);
    const [d, s] = a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : [1e3, "K"];
    const v = n / d;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}${s}`;
}

export const date = (s: string) => { const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "–"; };

export function ago(s: string | number | null | undefined): string {
    const t = typeof s === "number" ? s : Date.parse(s ?? "");
    if (!Number.isFinite(t)) return "";
    const d = (Date.now() - t) / 1000;
    if (d < 60) return "just now";
    if (d < 3600) return `${Math.round(d / 60)} min ago`;
    if (d < 86400) return `${Math.round(d / 3600)} h ago`;
    const days = Math.round(d / 86400);
    if (days < 60) return `${days} day${days === 1 ? "" : "s"} ago`;
    if (days < 730) return `${Math.round(days / 30.4)} months ago`;
    return `${Math.round(days / 365)} years ago`;
}

export const PRESENCE = ["Offline", "Online", "In a game", "In Studio"];
export const urlFor = (ref: RbxRef) => ref.kind === "user" ? `https://www.roblox.com/users/${ref.id}/profile` : ref.kind === "game" ? `https://www.roblox.com/games/${ref.id}` : ref.kind === "group" ? `https://www.roblox.com/communities/${ref.id}` : `https://www.roblox.com/${ref.bundle ? "bundles" : "catalog"}/${ref.id}`;

/* ── Servers and outfits ────────────────────────────────────────────── */

const outfits = new Map<string, { at: number; p: Promise<any>; }>();

export function fetchServers(placeId: string, order: "Desc" | "Asc", hideFull: boolean, cursor?: string): Promise<{ ok: true; servers: RbxServer[]; next: string | null; } | { ok: false; error: string; }> {
    return callNative("rbxServers", placeId, order, hideFull, cursor) as Promise<any>;
}

export function fetchOutfit(userId: string, fresh = false): Promise<{ ok: true; outfit: RbxOutfit; } | { ok: false; error: string; }> {
    const hit = outfits.get(userId);
    if (hit && !fresh && Date.now() - hit.at < 10 * 60_000) return hit.p;
    const p = callNative("rbxOutfit", userId) as Promise<any>;
    outfits.set(userId, { at: Date.now(), p });
    return p;
}

/** Opens Roblox into that server (or just the game). Gives back why not, if it couldn't. */
export async function joinServer(placeId: string, serverId?: string): Promise<string | null> {
    if (!hasNative("rbxJoin")) return NEEDS_RESTART;
    return (await callNative("rbxJoin", placeId, serverId)) === true ? null : "Couldn't open Roblox — is it installed?";
}
/** A link anyone can click to land in the same server. */
export const serverLink = (placeId: string, serverId: string) => `https://www.roblox.com/games/start?placeId=${placeId}&gameInstanceId=${serverId}`;

/** Kept for a while, so opening the same card again doesn't ask Roblox again. */
function remembered<T>(map: Map<string, { at: number; p: Promise<T>; }>, key: string, ms: number, fresh: boolean, make: () => Promise<T>) {
    const hit = map.get(key);
    if (hit && !fresh && Date.now() - hit.at < ms) return hit.p;
    const p = make();
    if (map.size > 100) map.delete(map.keys().next().value!);
    map.set(key, { at: Date.now(), p });
    return p;
}

const shops = new Map<string, { at: number; p: Promise<any>; }>();
const owned = new Map<string, { at: number; p: Promise<any>; }>();

/** A game's passes and developer products. */
export const fetchShop = (placeId: string, fresh = false): Promise<{ ok: true; shop: RbxShop; } | { ok: false; error: string; }> =>
    remembered(shops, placeId, 10 * 60_000, fresh, () => callNative("rbxShop", placeId));

/** Every public game a group or player owns, with live numbers. */
export const fetchOwnedGames = (kind: "group" | "user", id: string, fresh = false): Promise<{ ok: true; games: RbxOwnedGame[]; more: boolean; } | { ok: false; error: string; }> =>
    remembered(owned, `${kind}:${id}`, 5 * 60_000, fresh, () => callNative("rbxOwnedGames", kind, id));

const histories = new Map<string, { at: number; p: Promise<any>; }>();

/** Where extra numbers can come from (set from the settings). */
export const sources = {
    rolimons: true,
    /** Your Roblox API key, for downloading newer items (set in the Assets tab). */
    apiKey: "",
    saveApiKey: (_key: string) => { },
};

/** A game's history, peaks and average playtime, from Rolimons. */
export const fetchHistory = (placeId: string, fresh = false): Promise<{ ok: true; history: RbxHistory; } | { ok: false; error: string; }> =>
    remembered(histories, placeId, 10 * 60_000, fresh, () => callNative("rbxHistory", placeId));

const players = new Map<string, { at: number; p: Promise<any>; }>();

/** A player's value, RAP, last seen online and history, from Rolimons. */
const itemHistories = new Map<string, { at: number; p: Promise<any>; }>();
/** A limited's RAP and price over time, from Rolimons (kept 10 minutes). */
export const fetchItemHistory = (itemId: string, fresh = false): Promise<{ ok: true; history: RbxItemHistory | null; } | { ok: false; error: string; }> =>
    remembered(itemHistories, itemId, 10 * 60_000, fresh, () => callNative("rbxItemHistory", itemId));

const inventoryDays = new Map<string, { at: number; p: Promise<any>; }>();
/** What a player owned on the snapshot nearest a time (kept 30 minutes — old days don't change). */
export function fetchInventoryAt(userId: string, time: number, fresh = false): Promise<{ ok: true; day: RbxInventoryDay | null; } | { ok: false; error: string; }> {
    const key = `${userId}:${Math.floor(time / 86400)}`;
    const p = remembered(inventoryDays, key, 30 * 60_000, fresh, () => callNative("rbxInventoryAt", userId, time));
    // A failed day isn't kept, so trying again really asks again.
    void p.then((r: any) => { if (!r?.ok) inventoryDays.delete(key); });
    return p;
}

export const fetchPlayerHistory = (userId: string, fresh = false): Promise<{ ok: true; player: RbxPlayerHistory; } | { ok: false; error: string; }> =>
    remembered(players, userId, 10 * 60_000, fresh, () => callNative("rbxPlayerHistory", userId));

/** An item's details (for the Assets tab). */
export const fetchAssetInfo = (id: string): Promise<{ ok: true; info: RbxAssetInfo; } | { ok: false; error: string; }> => callNative("rbxAssetInfo", id);

/** An item's file — or Roblox's 420 × 420 picture of it. */
export const fetchAssetFile = (id: string, preview = false): Promise<{ ok: true; bytes: Uint8Array; type: string; } | { ok: false; error: string; status?: number; }> => callNative("rbxAssetFile", id, preview, sources.apiKey || undefined);

const memberships = new Map<string, { at: number; p: Promise<any>; }>();

/** The groups someone is in, with their role in each. */
export const fetchUserGroups = (userId: string, fresh = false): Promise<{ ok: true; groups: RbxMembership[]; } | { ok: false; error: string; }> =>
    remembered(memberships, userId, 10 * 60_000, fresh, () => callNative("rbxUserGroups", userId));

/** Every limited's Rolimons value (kept 10 minutes on the network side). */
export const fetchLimiteds = (fresh = false): Promise<{ ok: true; items: RbxLimited[]; at: number; } | { ok: false; error: string; }> => callNative("rbxLimiteds", fresh);

const thumbCache = new Map<string, string>();
/** Pictures for items, each fetched once. */
export async function fetchThumbs(ids: string[]): Promise<Record<string, string>> {
    const need = [...new Set(ids)].filter(i => !thumbCache.has(i));
    if (need.length) {
        const got: any = await callNative("rbxThumbs", need);
        if (got && typeof got === "object" && !("ok" in got)) for (const [k, v] of Object.entries(got)) thumbCache.set(k, v as string);
    }
    return Object.fromEntries(ids.filter(i => thumbCache.has(i)).map(i => [i, thumbCache.get(i)!]));
}

/** Set by the window so cards can open its tabs without importing it. */
export const cardActions = {
    servers: (_placeId: string) => { },
    lookup: (_query: string) => { },
    compare: (_placeId: string) => { },
    assets: (_assetId: string) => { },
};
