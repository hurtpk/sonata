/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Roblox Tools' network side: Roblox's own public APIs (no login), fetched
// here because Discord's page isn't allowed to contact other sites. Only
// Roblox addresses, and only numbers or a username go in.

import { CspPolicies, ImageSrc } from "@main/csp";
import { IpcMainInvokeEvent, shell } from "electron";
import { gunzipSync } from "zlib";

CspPolicies["*.rbxcdn.com"] = ImageSrc;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

async function json(url: string, body?: unknown): Promise<any> {
    const res = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json", "user-agent": UA }, body: JSON.stringify(body) } : { headers: { "user-agent": UA, accept: "application/json" } });
    if (res.status === 429) throw new Error("Roblox asked for a short break — try again in a minute");
    if (!res.ok) throw new Error(res.status === 404 || res.status === 400 ? "Not found on Roblox" : `Roblox answered ${res.status}`);
    return res.json();
}
const soft = <T,>(p: Promise<T>) => p.catch(() => null);
const thumb = (r: any) => r?.data?.[0]?.imageUrl ?? r?.data?.[0]?.thumbnails?.[0]?.imageUrl ?? "";
const id = (v: unknown) => /^\d{1,19}$/.test(String(v)) ? String(v) : null;

export interface RbxUser { kind: "user"; id: string; name: string; displayName: string; created: string; verified: boolean; banned: boolean; bio: string; avatar: string; body: string; followers: number | null; following: number | null; friends: number | null; presence: number; lastOnline: string | null; names: string[]; }
export interface RbxGame { kind: "game"; placeId: string; universeId: string; name: string; description: string; creator: string; creatorType: string; creatorId: string; playing: number; visits: number; favorites: number; maxPlayers: number; up: number; down: number; created: string; updated: string; genre: string; icon: string; thumb: string; }
export interface RbxGroup { kind: "group"; id: string; name: string; description: string; owner: string | null; members: number; verified: boolean; open: boolean; shout: { body: string; poster: string; updated: string; } | null; icon: string; }
export interface RbxItem { kind: "item"; id: string; bundle: boolean; name: string; description: string; creator: string; price: number | null; type: string; limited: boolean; forSale: boolean; created: string; updated: string; sales: number | null; image: string; }
export type RbxInfo = RbxUser | RbxGame | RbxGroup | RbxItem;
type Out = { ok: true; info: RbxInfo; } | { ok: false; error: string; };

export async function rbxUser(_: IpcMainInvokeEvent | null, input: string): Promise<Out> {
    try {
        let uid = id(input);
        if (!uid) {
            const name = String(input).trim().replace(/^@/, "");
            if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return { ok: false, error: "That isn't a Roblox username" };
            uid = String((await json("https://users.roblox.com/v1/usernames/users", { usernames: [name], excludeBannedUsers: false }))?.data?.[0]?.id ?? "");
            if (!uid) return { ok: false, error: `No Roblox account called “${name}”` };
        }
        const [u, followers, following, friends, head, body, pres, hist] = await Promise.all([
            json(`https://users.roblox.com/v1/users/${uid}`),
            soft(json(`https://friends.roblox.com/v1/users/${uid}/followers/count`)),
            soft(json(`https://friends.roblox.com/v1/users/${uid}/followings/count`)),
            soft(json(`https://friends.roblox.com/v1/users/${uid}/friends/count`)),
            soft(json(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${uid}&size=150x150&format=Png`)),
            soft(json(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${uid}&size=420x420&format=Png`)),
            soft(json("https://presence.roblox.com/v1/presence/users", { userIds: [Number(uid)] })),
            soft(json(`https://users.roblox.com/v1/users/${uid}/username-history?limit=100&sortOrder=Desc`)),
        ]);
        const p = (pres as any)?.userPresences?.[0];
        return {
            ok: true, info: {
                kind: "user", id: uid, name: u.name, displayName: u.displayName ?? u.name, created: u.created ?? "", verified: !!u.hasVerifiedBadge, banned: !!u.isBanned,
                bio: u.description ?? "", avatar: thumb(head), body: thumb(body), followers: (followers as any)?.count ?? null, following: (following as any)?.count ?? null, friends: (friends as any)?.count ?? null,
                presence: p?.userPresenceType ?? 0, lastOnline: p?.lastOnline ?? null, names: ((hist as any)?.data ?? []).map((x: any) => x.name).filter(Boolean),
            },
        };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Roblox" }; }
}

export async function rbxGame(_: IpcMainInvokeEvent | null, placeId: string): Promise<Out> {
    try {
        const pid = id(placeId);
        if (!pid) return { ok: false, error: "That isn't a game link" };
        const universeId = String((await json(`https://apis.roblox.com/universes/v1/places/${pid}/universe`))?.universeId ?? "");
        if (!universeId || universeId === "null") return { ok: false, error: "Not found on Roblox" };
        const [g, votes, icon, th] = await Promise.all([
            json(`https://games.roblox.com/v1/games?universeIds=${universeId}`),
            soft(json(`https://games.roblox.com/v1/games/votes?universeIds=${universeId}`)),
            soft(json(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&size=150x150&format=Png`)),
            soft(json(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${universeId}&size=768x432&format=Png&countPerUniverse=1`)),
        ]);
        const d = g?.data?.[0];
        if (!d) return { ok: false, error: "Not found on Roblox" };
        const v = (votes as any)?.data?.[0];
        return {
            ok: true, info: {
                kind: "game", placeId: String(d.rootPlaceId ?? pid), universeId, name: d.name, description: d.description ?? "", creator: d.creator?.name ?? "", creatorType: d.creator?.type ?? "", creatorId: String(d.creator?.id ?? ""),
                playing: d.playing ?? 0, visits: d.visits ?? 0, favorites: d.favoritedCount ?? 0, maxPlayers: d.maxPlayers ?? 0, up: v?.upVotes ?? 0, down: v?.downVotes ?? 0,
                created: d.created ?? "", updated: d.updated ?? "", genre: d.genre_l1 ?? d.genre ?? "", icon: thumb(icon), thumb: thumb(th),
            },
        };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Roblox" }; }
}

export async function rbxGroup(_: IpcMainInvokeEvent | null, groupId: string): Promise<Out> {
    try {
        const gid = id(groupId);
        if (!gid) return { ok: false, error: "That isn't a group link" };
        const [g, icon] = await Promise.all([json(`https://groups.roblox.com/v1/groups/${gid}`), soft(json(`https://thumbnails.roblox.com/v1/groups/icons?groupIds=${gid}&size=150x150&format=Png`))]);
        return {
            ok: true, info: {
                kind: "group", id: gid, name: g.name, description: g.description ?? "", owner: g.owner?.username ?? null, members: g.memberCount ?? 0, verified: !!g.hasVerifiedBadge, open: !!g.publicEntryAllowed,
                shout: g.shout?.body ? { body: g.shout.body, poster: g.shout.poster?.username ?? "", updated: g.shout.updated ?? "" } : null, icon: thumb(icon),
            },
        };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Roblox" }; }
}

export async function rbxItem(_: IpcMainInvokeEvent | null, itemId: string, bundle: boolean): Promise<Out> {
    try {
        const iid = id(itemId);
        if (!iid) return { ok: false, error: "That isn't an item link" };
        if (bundle) {
            const [b, img] = await Promise.all([json(`https://catalog.roblox.com/v1/bundles/${iid}/details`), soft(json(`https://thumbnails.roblox.com/v1/bundles/thumbnails?bundleIds=${iid}&size=420x420&format=Png`))]);
            return {
                ok: true, info: {
                    kind: "item", id: iid, bundle: true, name: b.name, description: b.description ?? "", creator: b.creator?.name ?? "", price: b.product?.priceInRobux ?? null, type: b.bundleType ?? "Bundle",
                    limited: !!b.collectibleItemDetail, forSale: !!b.product?.isForSale, created: "", updated: "", sales: null, image: thumb(img),
                },
            };
        }
        const [a, img] = await Promise.all([json(`https://economy.roblox.com/v2/assets/${iid}/details`), soft(json(`https://thumbnails.roblox.com/v1/assets?assetIds=${iid}&size=420x420&format=Png`))]);
        return {
            ok: true, info: {
                kind: "item", id: iid, bundle: false, name: a.Name, description: a.Description ?? "", creator: a.Creator?.Name ?? "", price: a.PriceInRobux ?? a.CollectiblesItemDetails?.CollectibleLowestResalePrice ?? null,
                type: a.ProductType ?? "Item", limited: !!(a.IsLimited || a.IsLimitedUnique || a.CollectibleItemId), forSale: !!a.IsForSale, created: a.Created ?? "", updated: a.Updated ?? "", sales: typeof a.Sales === "number" ? a.Sales : null, image: thumb(img),
            },
        };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Roblox" }; }
}

/* ── Servers ── */

export interface RbxServer { id: string; playing: number; max: number; ping: number | null; fps: number | null; faces: string[]; }

/** A page of a game's public servers, most or fewest players first, with a few faces from each. */
export async function rbxServers(_: IpcMainInvokeEvent | null, placeId: string, order: "Desc" | "Asc", hideFull: boolean, cursor?: string): Promise<{ ok: true; servers: RbxServer[]; next: string | null; } | { ok: false; error: string; }> {
    try {
        const pid = id(placeId);
        if (!pid) return { ok: false, error: "That isn't a game link" };
        const c = cursor && /^[\w\-=+/]{1,2000}$/.test(cursor) ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const r = await json(`https://games.roblox.com/v1/games/${pid}/servers/Public?sortOrder=${order === "Asc" ? "Asc" : "Desc"}&limit=100&excludeFullGames=${hideFull}${c}`);
        const list: any[] = r?.data ?? [];
        // Faces: up to 5 per server for the first 30 servers, in one request.
        const want = list.slice(0, 30).flatMap(s => (s.playerTokens ?? []).slice(0, 5).map((t: string) => ({ requestId: `${s.id}:${t}`, token: t, type: "AvatarHeadShot", size: "48x48", format: "png" })));
        const faces = new Map<string, string[]>();
        if (want.length) {
            const t = await soft(json("https://thumbnails.roblox.com/v1/batch", want));
            for (const x of (t as any)?.data ?? []) {
                if (!x?.imageUrl) continue;
                const sid = String(x.requestId).split(":")[0];
                faces.set(sid, [...faces.get(sid) ?? [], x.imageUrl]);
            }
        }
        return {
            ok: true, next: r?.nextPageCursor ?? null,
            servers: list.map(s => ({ id: String(s.id), playing: s.playing ?? 0, max: s.maxPlayers ?? 0, ping: typeof s.ping === "number" ? s.ping : null, fps: typeof s.fps === "number" ? Math.round(s.fps) : null, faces: faces.get(String(s.id)) ?? [] })),
        };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Roblox" }; }
}

/** Opens Roblox straight into a server (or just the game). Only Roblox's own launch link, with checked IDs. */
export async function rbxJoin(_: IpcMainInvokeEvent | null, placeId: string, serverId?: string) {
    const pid = id(placeId);
    if (!pid) return false;
    const sid = serverId && /^[0-9a-f-]{36}$/i.test(serverId) ? `&gameInstanceId=${serverId}` : "";
    try { await shell.openExternal(`roblox://experiences/start?placeId=${pid}${sid}`); return true; } catch { return false; }
}

/* ── Outfits ── */

export interface RbxWorn { id: string; name: string; type: string; image: string; price: number | null; resale: number | null; limited: boolean; forSale: boolean; creator: string; bundle: { id: string; name: string; price: number | null; } | null; }
export interface RbxOutfit { avatarType: string; items: RbxWorn[]; emotes: { id: string; name: string; }[]; }

const BODY = new Set(["Head", "Torso", "LeftArm", "RightArm", "LeftLeg", "RightLeg", "DynamicHead", "MoodAnimation", "Face", "EyebrowAccessory", "EyelashAccessory"]);
const isPart = (type: string) => BODY.has(type) || /Animation$/.test(type);
let csrf = "";

/** Roblox's catalog batch needs a one-off token, handed back on the first try. Nothing about the user is sent. */
async function catalogDetails(ids: string[]): Promise<any[]> {
    const go = () => fetch("https://catalog.roblox.com/v1/catalog/items/details", { method: "POST", headers: { "content-type": "application/json", "user-agent": UA, "x-csrf-token": csrf }, body: JSON.stringify({ items: ids.map(i => ({ itemType: "Asset", id: Number(i) })) }) });
    let res = await go();
    if (res.status === 403 && res.headers.get("x-csrf-token")) { csrf = res.headers.get("x-csrf-token")!; res = await go(); }
    if (!res.ok) throw new Error(`catalog ${res.status}`);
    return (await res.json())?.data ?? [];
}

export async function rbxOutfit(_: IpcMainInvokeEvent | null, userId: string): Promise<{ ok: true; outfit: RbxOutfit; } | { ok: false; error: string; }> {
    try {
        const uid = id(userId);
        if (!uid) return { ok: false, error: "That isn't a Roblox user" };
        const av = await json(`https://avatar.roblox.com/v1/users/${uid}/avatar`);
        const assets: any[] = (av?.assets ?? []).slice(0, 60);
        const ids = assets.map(a => String(a.id));
        const [thumbs, details] = await Promise.all([
            ids.length ? soft(json(`https://thumbnails.roblox.com/v1/assets?assetIds=${ids.join(",")}&size=150x150&format=Png`)) : null,
            ids.length ? catalogDetails(ids).catch(async () => {
                // Fallback: one by one (slower, but needs nothing).
                const out: any[] = [];
                for (const i of ids.slice(0, 25)) {
                    const a = await soft(json(`https://economy.roblox.com/v2/assets/${i}/details`));
                    if (a) out.push({ id: Number(i), price: a.PriceInRobux ?? null, lowestPrice: a.CollectiblesItemDetails?.CollectibleLowestResalePrice ?? null, itemRestrictions: a.IsLimited || a.IsLimitedUnique || a.CollectibleItemId ? ["Limited"] : [], priceStatus: a.IsForSale ? "" : "Off Sale", creatorName: a.Creator?.Name ?? "" });
                }
                return out;
            }) : [],
        ]);
        const img = new Map<string, string>(((thumbs as any)?.data ?? []).map((t: any) => [String(t.targetId), t.imageUrl ?? ""]));
        const det = new Map<string, any>((details as any[]).map((d: any): [string, any] => [String(d.id), d]));
        const items: RbxWorn[] = assets.map(a => {
            const d = det.get(String(a.id)) ?? {};
            const limited = (d.itemRestrictions ?? []).some((r: string) => /Limited|Collectible/.test(r));
            const resale = d.lowestResalePrice || d.lowestPrice || null; // 0 means nobody's reselling
            const offSale = d.priceStatus === "Off Sale" || d.priceStatus === "No Resellers";
            return {
                id: String(a.id), name: a.name ?? d.name ?? "Item", type: a.assetType?.name ?? "", image: img.get(String(a.id)) ?? "", creator: d.creatorName ?? "",
                price: offSale ? null : typeof d.price === "number" ? d.price : d.priceStatus === "Free" ? 0 : null,
                resale: limited && typeof resale === "number" ? resale : null, limited, forSale: !offSale && (typeof d.price === "number" || d.priceStatus === "Free"), bundle: null,
            };
        });
        // Body parts and animations come from bundles (a whole body, an animation pack). Many bundles share
        // parts, so pick the one that best matches everything worn — most of it worn, least of it not.
        const parts = items.filter(i => isPart(i.type) && i.price == null && !i.limited);
        const worn = new Set(ids);
        const found = new Map<string, any>();
        const anims = parts.filter(i => /Animation$/.test(i.type) && i.type !== "MoodAnimation");
        const bodies = parts.filter(i => !anims.includes(i));
        // Roblox hands these out 10 at a time; animations are in many bundles, so page until the animation pack turns up.
        const bundlesOf = async (assetId: string, pages: number, until?: (b: any) => boolean) => {
            let cursor = "";
            for (let i = 0; i < pages; i++) {
                const r = await soft(json(`https://catalog.roblox.com/v1/assets/${assetId}/bundles?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)) as any;
                const list: any[] = r?.data ?? [];
                for (const b of list) found.set(String(b.id), b);
                if (!r?.nextPageCursor || (until && list.some(until))) break;
                cursor = r.nextPageCursor;
            }
        };
        await Promise.all([
            ...bodies.slice(0, 8).map(p => bundlesOf(p.id, 1)),
            anims.length ? bundlesOf(anims[0].id, 6, b => b.bundleType === "AnimationPack") : null,
        ]);
        const score = (b: any, anim: boolean) => {
            const its: any[] = (b.items ?? []).filter((x: any) => x.type === "Asset");
            const hit = its.filter(x => worn.has(String(x.id))).length;
            const kind = anim ? b.bundleType === "AnimationPack" : b.bundleType !== "AnimationPack";
            return (kind ? 1 : 0) + (its.length ? hit / its.length : 0) + hit / 100;
        };
        for (const p of parts) {
            const anim = anims.includes(p);
            const best = [...found.values()].filter(b => (b.items ?? []).some((x: any) => String(x.id) === p.id)).sort((a, b) => score(b, anim) - score(a, anim))[0];
            if (best) p.bundle = { id: String(best.id), name: best.name ?? "Bundle", price: best.product?.isFree ? 0 : best.product?.isForSale ? best.product?.priceInRobux ?? null : null };
        }
        return { ok: true, outfit: { avatarType: av?.playerAvatarType ?? "", items, emotes: (av?.emotes ?? []).filter((e: any) => e?.assetId).map((e: any) => ({ id: String(e.assetId), name: e.assetName ?? "Emote" })) } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Roblox" }; }
}

/* ── Game passes and developer products ── */

export interface RbxPass { id: string; name: string; description: string; price: number | null; forSale: boolean; icon: string; updated: string; }
export interface RbxShop { universeId: string; passes: RbxPass[]; products: RbxPass[]; }

export async function rbxShop(_: IpcMainInvokeEvent | null, placeId: string): Promise<{ ok: true; shop: RbxShop; } | { ok: false; error: string; }> {
    try {
        const pid = id(placeId);
        if (!pid) return { ok: false, error: "That isn't a game link" };
        const universeId = String((await json(`https://apis.roblox.com/universes/v1/places/${pid}/universe`))?.universeId ?? "");
        if (!universeId || universeId === "null") return { ok: false, error: "Not found on Roblox" };

        const passes: any[] = [];
        let token = "";
        for (let i = 0; i < 4; i++) {
            const r = await json(`https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes?passView=Full&pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`);
            passes.push(...r?.gamePasses ?? []);
            token = r?.nextPageToken ?? "";
            if (!token) break;
        }
        const products: any[] = [];
        let cursor = "";
        for (let i = 0; i < 6; i++) {
            const r = await soft(json(`https://apis.roblox.com/developer-products/v2/universes/${universeId}/developerproducts?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)) as any;
            products.push(...r?.developerProducts ?? []);
            cursor = r?.nextPageCursor ?? "";
            if (!cursor) break;
        }

        // Icons, 100 at a time.
        const icons = new Map<string, string>();
        const grab = async (url: string, ids: string[]) => {
            for (let i = 0; i < ids.length; i += 100) {
                const r = await soft(json(`${url}${ids.slice(i, i + 100).join(",")}&size=150x150&format=Png`)) as any;
                for (const t of r?.data ?? []) if (t.imageUrl) icons.set(String(t.targetId), t.imageUrl);
            }
        };
        const iconOf = (p: any) => String(p.DisplayIconImageAssetId || p.IconImageAssetId || "");
        await Promise.all([
            grab("https://thumbnails.roblox.com/v1/game-passes?gamePassIds=", passes.map(p => String(p.id))),
            grab("https://thumbnails.roblox.com/v1/assets?assetIds=", [...new Set(products.map(iconOf).filter(x => x && x !== "0"))]),
        ]);
        return {
            ok: true, shop: {
                universeId,
                passes: passes.map(p => ({ id: String(p.id), name: p.displayName ?? p.name ?? "Pass", description: p.displayDescription ?? "", price: typeof p.price === "number" ? p.price : null, forSale: !!p.isForSale, icon: icons.get(String(p.id)) ?? "", updated: p.updated ?? "" })),
                products: products.map(p => ({ id: String(p.ProductId ?? p.DeveloperProductId), name: p.displayName ?? p.Name ?? "Product", description: p.displayDescription ?? p.Description ?? "", price: typeof p.PriceInRobux === "number" ? p.PriceInRobux : null, forSale: !!p.IsForSale, icon: icons.get(iconOf(p)) ?? "", updated: p.Updated ?? "" })),
            },
        };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Roblox" }; }
}

/* ── Every game a group (or player) owns ── */

export interface RbxOwnedGame { universeId: string; placeId: string; name: string; playing: number; visits: number; favorites: number; updated: string; icon: string; }

export async function rbxOwnedGames(_: IpcMainInvokeEvent | null, kind: "group" | "user", ownerId: string): Promise<{ ok: true; games: RbxOwnedGame[]; more: boolean; } | { ok: false; error: string; }> {
    try {
        const oid = id(ownerId);
        if (!oid) return { ok: false, error: "That isn't a Roblox ID" };
        const base = `https://games.roblox.com/v2/${kind === "user" ? "users" : "groups"}/${oid}/games?accessFilter=Public&limit=50&sortOrder=Desc`;
        const list: any[] = [];
        let cursor = "", more = false;
        for (let i = 0; i < 4; i++) {
            const r = await json(`${base}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
            list.push(...r?.data ?? []);
            cursor = r?.nextPageCursor ?? "";
            if (!cursor) break;
            more = i === 3;
        }
        const live = new Map<string, any>(), icons = new Map<string, string>();
        const ids = list.map(g => String(g.id));
        for (let i = 0; i < ids.length; i += 50) {
            const chunk = ids.slice(i, i + 50).join(",");
            const [g, ic] = await Promise.all([
                soft(json(`https://games.roblox.com/v1/games?universeIds=${chunk}`)),
                soft(json(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${chunk}&size=150x150&format=Png`)),
            ]);
            for (const x of (g as any)?.data ?? []) live.set(String(x.id), x);
            for (const t of (ic as any)?.data ?? []) if (t.imageUrl) icons.set(String(t.targetId), t.imageUrl);
        }
        const games = list.map(g => {
            const l = live.get(String(g.id)) ?? {};
            return { universeId: String(g.id), placeId: String(g.rootPlace?.id ?? l.rootPlaceId ?? ""), name: l.name ?? g.name ?? "Game", playing: l.playing ?? 0, visits: l.visits ?? g.placeVisits ?? 0, favorites: l.favoritedCount ?? 0, updated: l.updated ?? g.updated ?? "", icon: icons.get(String(g.id)) ?? "" };
        }).sort((a, b) => b.playing - a.playing || b.visits - a.visits);
        return { ok: true, games, more };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Roblox" }; }
}

/** What someone's wearing, as a short fingerprint — changes only when their avatar really does. */
export async function rbxWearing(_: IpcMainInvokeEvent | null, userId: string): Promise<string | null> {
    const uid = id(userId);
    if (!uid) return null;
    try {
        const r = await json(`https://avatar.roblox.com/v1/users/${uid}/currently-wearing`);
        return Array.isArray(r?.assetIds) ? [...r.assetIds].map(String).sort().join(",") : null;
    } catch { return null; }
}

/* ── Rolimons: a game's history (players, playtime, visits…) ── */

// Rolimons tracks Roblox games every 10 minutes and puts the whole history in
// each game's page. Fetched only when you open a game, and made smaller here:
// the last day as it is, the last month by the hour, and older by the day.

/** A peak: how many, and when (a time, or Rolimons' own words for it like "3 weeks ago"). */
export interface RbxPeak { n: number; t?: number; when?: string; }
export interface RbxHistory {
    tracked: boolean;
    since: number;
    players: number | null;
    avgPlaytime: number | null;
    peaks: { all: RbxPeak | null; d30: RbxPeak | null; d7: RbxPeak | null; h24: RbxPeak | null; };
    t: number[]; players_: number[]; playtime: number[]; visits: number[]; favorites: number[]; up: number[]; down: number[];
}

function peakSince(t: number[], v: number[], from: number): RbxPeak | null {
    let best: RbxPeak | null = null;
    for (let i = t.length - 1; i >= 0 && t[i] >= from; i--) if (v[i] != null && (!best || v[i] > best.n)) best = { n: v[i], t: t[i] };
    return best;
}

export async function rbxHistory(_: IpcMainInvokeEvent | null, placeId: string): Promise<{ ok: true; history: RbxHistory; } | { ok: false; error: string; }> {
    try {
        const pid = id(placeId);
        if (!pid) return { ok: false, error: "That isn't a game link" };
        const res = await fetch(`https://www.rolimons.com/game/${pid}`, { headers: { "user-agent": UA, accept: "text/html" } });
        const empty: RbxHistory = { tracked: false, since: 0, players: null, avgPlaytime: null, peaks: { all: null, d30: null, d7: null, h24: null }, t: [], players_: [], playtime: [], visits: [], favorites: [], up: [], down: [] };
        if (res.status === 404) return { ok: true, history: empty };
        if (res.status === 429) return { ok: false, error: "Rolimons asked for a short break — try again in a minute" };
        if (!res.ok) return { ok: false, error: `Rolimons answered ${res.status}` };
        const html = await res.text();
        const raw = html.match(/<script id="game_history_json" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
        if (!raw) return { ok: true, history: empty };
        const j = JSON.parse(raw);
        const T: number[] = j.timestamps ?? [];
        if (!T.length) return { ok: true, history: empty };
        const P: number[] = j.players ?? [], A: number[] = j.avg_playtime ?? [], V: number[] = j.visits ?? [], F: number[] = j.favorites ?? [], U: number[] = j.upvotes ?? [], D: number[] = j.downvotes ?? [];

        // Rolimons' own figures from the page, worked out from finer data than the history it shares.
        const boxes = new Map<string, { value: string; sub?: string; }>();
        for (const m of html.matchAll(/game_stat_header stat_light_blue">([^<]+)<\/div><div class="game_stat_data">([^<]+)<\/div>(?:<div class="game_stat_header">([^<]+)<\/div>)?/g))
            boxes.set(m[1].trim(), { value: m[2].trim(), sub: m[3]?.trim() });
        const num = (v?: string) => { const n = Number(String(v ?? "").replace(/[^\d.]/g, "")); return v && Number.isFinite(n) ? n : null; };
        const pagePeak = (label: string): RbxPeak | null => { const b = boxes.get(label); const n = num(b?.value); return n == null ? null : { n, when: b?.sub }; };

        const now = T[T.length - 1];
        const day = 86400;
        // Smaller: buckets of 10 minutes (last day), an hour (last 30 days), a day (older).
        // Players keep the bucket's highest (so peaks show); everything else its last value.
        const out = { t: [] as number[], players_: [] as number[], playtime: [] as number[], visits: [] as number[], favorites: [] as number[], up: [] as number[], down: [] as number[] };
        let key = -1;
        for (let i = 0; i < T.length; i++) {
            const age = now - T[i];
            const size = age <= day ? 600 : age <= 30 * day ? 3600 : day;
            const k = Math.floor(T[i] / size) * size + (size === day ? 0 : size === 3600 ? 1 : 2);
            if (k !== key) {
                key = k;
                out.t.push(T[i]); out.players_.push(P[i] ?? 0); out.playtime.push(A[i] ?? 0); out.visits.push(V[i] ?? 0); out.favorites.push(F[i] ?? 0); out.up.push(U[i] ?? 0); out.down.push(D[i] ?? 0);
            } else {
                const n = out.t.length - 1;
                out.t[n] = T[i]; out.players_[n] = Math.max(out.players_[n], P[i] ?? 0); out.playtime[n] = A[i] ?? out.playtime[n];
                out.visits[n] = V[i] ?? out.visits[n]; out.favorites[n] = F[i] ?? out.favorites[n]; out.up[n] = U[i] ?? out.up[n]; out.down[n] = D[i] ?? out.down[n];
            }
        }
        return {
            ok: true, history: {
                tracked: true, since: T[0], players: P[P.length - 1] ?? null, avgPlaytime: num(boxes.get("Average Playtime")?.value) ?? A[A.length - 1] ?? null,
                peaks: {
                    all: pagePeak("All-Time") ?? peakSince(T, P, 0), d30: pagePeak("Past 30 Days") ?? peakSince(T, P, now - 30 * day),
                    d7: pagePeak("Past 7 Days") ?? peakSince(T, P, now - 7 * day), h24: pagePeak("Past 24 Hours") ?? peakSince(T, P, now - day),
                },
                ...out,
            },
        };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Rolimons" }; }
}

/* ── Live numbers for saved things, in as few requests as possible ── */

/** Players now for games (by universe), online status for people, and members for groups. */
export async function rbxSavedLive(_: IpcMainInvokeEvent | null, universeIds: string[], userIds: string[], groupIds: string[]): Promise<{ games: Record<string, number>; users: Record<string, number>; groups: Record<string, number>; info: Record<string, { playing: number; visits: number; updated: string; }>; }> {
    const ok = (a: unknown) => (Array.isArray(a) ? a : []).map(String).filter(x => /^\d{1,19}$/.test(x)).slice(0, 100);
    const u = ok(universeIds), p = ok(userIds), g = ok(groupIds).slice(0, 30);
    const out = { games: {} as Record<string, number>, users: {} as Record<string, number>, groups: {} as Record<string, number>, info: {} as Record<string, { playing: number; visits: number; updated: string; }> };
    await Promise.all([
        u.length ? soft(json(`https://games.roblox.com/v1/games?universeIds=${u.join(",")}`)).then((r: any) => { for (const x of r?.data ?? []) { out.games[String(x.id)] = x.playing ?? 0; out.info[String(x.id)] = { playing: x.playing ?? 0, visits: x.visits ?? 0, updated: x.updated ?? "" }; } }) : null,
        p.length ? soft(json("https://presence.roblox.com/v1/presence/users", { userIds: p.map(Number) })).then((r: any) => { for (const x of r?.userPresences ?? []) out.users[String(x.userId)] = x.userPresenceType ?? 0; }) : null,
        // Groups have no batch with member counts, so one each (only a few).
        ...g.map(id => soft(json(`https://groups.roblox.com/v1/groups/${id}`)).then((r: any) => { if (typeof r?.memberCount === "number") out.groups[id] = r.memberCount; })),
    ]);
    return out;
}

/* ── Rolimons: a player's value, RAP, last seen and their history ── */

/** The JSON after `var name =` on a Rolimons page, found by matching brackets. */
function pageVar(html: string, name: string): any {
    const m = new RegExp(`var ${name}\\s*=\\s*`).exec(html);
    if (!m) return null;
    const i = m.index + m[0].length;
    const open = html[i];
    if (open !== "{" && open !== "[") return null;
    let depth = 0, inStr = false;
    for (let j = i; j < html.length; j++) {
        const ch = html[j];
        if (inStr) { if (ch === "\\") j++; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true;
        else if (ch === "{" || ch === "[") depth++;
        else if (ch === "}" || ch === "]") { depth--; if (depth === 0) { try { return JSON.parse(html.slice(i, j + 1)); } catch { return null; } } }
    }
    return null;
}

export interface RbxTopItem { id: string; name: string; value: number; rap: number; copies: number; image: string; }
/** An item they own now, and when they got each copy (seconds) — for "what did they have back then". */
export interface RbxHolding { id: string; name: string; value: number; rap: number; image: string; since: number[]; }
export interface RbxPlayerHistory {
    tracked: boolean;
    lastOnline: number | null;
    rank: number | null;
    tradeAds: number;
    value: number | null; rap: number | null; collectibles: number | null;
    peakValue: { n: number; t: number; } | null; peakRap: { n: number; t: number; } | null;
    since: number; lastScan: number;
    t: number[]; values: number[]; raps: number[]; counts: number[];
    top: RbxTopItem[];
    /** Every limited they own (asset ID and how many copies). */
    owned: { id: string; copies: number; }[];
    holdings: RbxHolding[];
}

export async function rbxPlayerHistory(_: IpcMainInvokeEvent | null, userId: string): Promise<{ ok: true; player: RbxPlayerHistory; } | { ok: false; error: string; }> {
    try {
        const uid = id(userId);
        if (!uid) return { ok: false, error: "That isn't a Roblox user" };
        const res = await fetch(`https://www.rolimons.com/player/${uid}`, { headers: { "user-agent": UA, accept: "text/html" } });
        const empty: RbxPlayerHistory = { tracked: false, lastOnline: null, rank: null, tradeAds: 0, value: null, rap: null, collectibles: null, peakValue: null, peakRap: null, since: 0, lastScan: 0, t: [], values: [], raps: [], counts: [], top: [], owned: [], holdings: [] };
        if (res.status === 404) return { ok: true, player: empty };
        if (res.status === 429) return { ok: false, error: "Rolimons asked for a short break — try again in a minute" };
        if (!res.ok) return { ok: false, error: `Rolimons answered ${res.status}` };
        const html = await res.text();
        const d = pageVar(html, "player_details_data");
        if (!d) return { ok: true, player: empty };
        const chart = pageVar(html, "chart_data") ?? {};
        const owned: Record<string, any[]> = pageVar(html, "scanned_player_assets") ?? {};
        const items: Record<string, any[]> = pageVar(html, "item_list") ?? {};

        // Older points live in a second chart; put them first.
        const old = pageVar(html, "old_chart_data") ?? {};
        const firstNew = chart.nominal_scan_time?.[0] ?? Infinity;
        const keep = (old.nominal_scan_time ?? []).map((t: number, i: number) => t < firstNew ? i : -1).filter((i: number) => i >= 0);
        const pick = (o: any, k: string) => keep.map((i: number) => o[k]?.[i] ?? null);
        const T: number[] = [...pick(old, "nominal_scan_time"), ...(chart.nominal_scan_time ?? [])];
        const V: number[] = [...pick(old, "value"), ...(chart.value ?? [])];
        const R: number[] = [...pick(old, "rap"), ...(chart.rap ?? [])];
        const C: number[] = [...pick(old, "num_limiteds"), ...(chart.num_limiteds ?? [])];
        const peak = (arr: number[]) => { let b: { n: number; t: number; } | null = null; for (let i = 0; i < arr.length; i++) if (arr[i] > (b?.n ?? 0)) b = { n: arr[i], t: T[i] }; return b; };

        // Today's worth from what they own now (item fields: name, acronym, rap, value, …, image at 10).
        let value = 0, rap = 0, copies = 0;
        const top: RbxTopItem[] = [];
        const holdings: RbxHolding[] = [];
        for (const [aid, list] of Object.entries(owned)) {
            const it = items[aid];
            const n = Array.isArray(list) ? list.length : 0;
            copies += n;
            if (!it) continue;
            const r = Number(it[2]) || 0, v = Number(it[3] ?? it[2]) || 0;
            rap += r * n; value += v * n;
            const image = typeof it[10] === "string" ? it[10] : "";
            top.push({ id: aid, name: String(it[0] ?? "Item"), value: v, rap: r, copies: n, image });
            // Each copy: [uaid, serial, made, owned since] — times in milliseconds.
            const since = (list as any[]).map(c => Array.isArray(c) ? Number(c[3] ?? c[2]) || 0 : 0).map(ms => Math.floor(ms / 1000));
            holdings.push({ id: aid, name: String(it[0] ?? "Item"), value: v, rap: r, image, since });
        }
        top.sort((a, b) => b.value * b.copies - a.value * a.copies);
        const haveNow = Object.keys(owned).length > 0;
        return {
            ok: true, player: {
                tracked: true,
                lastOnline: d.last_roblox_activity_ts > 0 ? d.last_roblox_activity_ts : null,
                rank: typeof d.rank === "number" ? d.rank : null,
                tradeAds: Number(d.trade_ad_count) || 0,
                value: haveNow ? value : V.length ? V[V.length - 1] : null,
                rap: haveNow ? rap : R.length ? R[R.length - 1] : null,
                collectibles: haveNow ? copies : C.length ? C[C.length - 1] : null,
                peakValue: peak(V), peakRap: peak(R),
                since: T[0] ?? 0, lastScan: T[T.length - 1] ?? 0,
                t: T, values: V, raps: R, counts: C,
                top: top.slice(0, 12),
                owned: Object.entries(owned).map(([aid, list]) => ({ id: aid, copies: Array.isArray(list) ? list.length : 0 })).filter(o => o.copies > 0),
                holdings,
            },
        };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Rolimons" }; }
}

/* ── Assets: an item's details and its files ── */

export interface RbxAssetInfo { id: string; name: string; description: string; typeId: number; creator: string; creatorType: string; created: string; updated: string; price: number | null; forSale: boolean; image: string; }

export async function rbxAssetInfo(_: IpcMainInvokeEvent | null, assetId: string): Promise<{ ok: true; info: RbxAssetInfo; } | { ok: false; error: string; }> {
    try {
        const aid = id(assetId);
        if (!aid) return { ok: false, error: "That isn't an item link" };
        const [a, img] = await Promise.all([json(`https://economy.roblox.com/v2/assets/${aid}/details`), soft(json(`https://thumbnails.roblox.com/v1/assets?assetIds=${aid}&size=420x420&format=Png`))]);
        return {
            ok: true, info: {
                id: aid, name: a.Name ?? "Item", description: a.Description ?? "", typeId: Number(a.AssetTypeId) || 0, creator: a.Creator?.Name ?? "", creatorType: a.Creator?.CreatorType ?? "",
                created: a.Created ?? "", updated: a.Updated ?? "", price: typeof a.PriceInRobux === "number" ? a.PriceInRobux : null, forSale: !!a.IsForSale, image: thumb(img),
            },
        };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Roblox" }; }
}

const MAX_FILE = 60 * 1024 * 1024;

/** An asset's file as Roblox hands it out — or, with `preview`, Roblox's 420 × 420 picture of it. */
/** A Roblox Open Cloud API key, as Roblox makes them (only ever sent to apis.roblox.com). */
const keyOk = (k: unknown) => typeof k === "string" && /^[A-Za-z0-9+/=_.-]{20,4096}$/.test(k.trim());

/** Roblox's official download for developers: needs an API key with the legacy-asset:manage permission. */
async function withApiKey(aid: string, apiKey: string): Promise<{ ok: true; bytes: Uint8Array; type: string; } | { ok: false; error: string; status?: number; }> {
    const res = await fetch(`https://apis.roblox.com/asset-delivery-api/v1/assetId/${aid}`, { headers: { "user-agent": UA, "x-api-key": apiKey.trim(), accept: "application/json" } });
    if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, error: "Roblox didn't accept your API key — check it has the legacy-asset:manage operation (under legacy-assets), isn't limited to another IP address, and hasn't expired" };
    if (res.status === 404) return { ok: false, status: 404, error: "Not found on Roblox (it may have been removed)" };
    if (res.status === 429) return { ok: false, status: 429, error: "Roblox asked for a short break — try again in a minute" };
    if (!res.ok) return { ok: false, status: res.status, error: `Roblox answered ${res.status}` };
    // Roblox answers "OK" even when it won't hand the file over, with the reason inside — so look for it.
    const body: any = await res.json().catch(() => null);
    const loc: unknown = body?.location ?? (Array.isArray(body?.locations) ? body.locations.find((l: any) => typeof l?.location === "string")?.location : undefined);
    if (typeof loc !== "string" || !/^https:\/\/[a-z0-9.-]+\.(rbxcdn|roblox)\.com\//i.test(loc)) {
        const err = Array.isArray(body?.errors) ? body.errors[0] : null;
        if (err?.message) return { ok: false, status: Number(err.code) || undefined, error: `Roblox said: “${String(err.message).slice(0, 200)}”${err.code ? ` (code ${err.code})` : ""}` };
        const fields = body && typeof body === "object" ? Object.keys(body).slice(0, 8).join(", ") : "";
        return { ok: false, error: `Roblox didn't give a download link for this one${fields ? ` (its answer had: ${fields})` : " (its answer was empty)"}` };
    }
    const file = await fetch(loc, { headers: { "user-agent": UA, "accept-encoding": "gzip" } });
    if (!file.ok) return { ok: false, status: file.status, error: `Roblox's file server answered ${file.status}` };
    let bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > MAX_FILE) return { ok: false, error: "That file is too big to fetch here" };
    // Sometimes it comes still packed, without saying so.
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) { try { bytes = new Uint8Array(gunzipSync(bytes)); } catch { } }
    return { ok: true, bytes, type: file.headers.get("content-type") ?? "" };
}

export async function rbxAssetFile(_: IpcMainInvokeEvent | null, assetId: string, preview = false, apiKey?: string): Promise<{ ok: true; bytes: Uint8Array; type: string; } | { ok: false; error: string; status?: number; }> {
    try {
        const aid = id(assetId);
        if (!aid) return { ok: false, error: "That isn't an item ID" };
        let url = `https://assetdelivery.roblox.com/v1/asset/?id=${aid}`;
        if (preview) {
            url = thumb(await json(`https://thumbnails.roblox.com/v1/assets?assetIds=${aid}&size=420x420&format=Png`));
            if (!/^https:\/\/[a-z0-9.-]+\.rbxcdn\.com\//.test(url)) return { ok: false, error: "Roblox has no picture of this" };
        }
        const res = await fetch(url, { headers: { "user-agent": UA } });
        // Newer items need an account: try your API key, if you've added one.
        if ((res.status === 401 || res.status === 403) && !preview && keyOk(apiKey)) return withApiKey(aid, apiKey!);
        if (!res.ok) {
            const why = res.status === 401 || res.status === 403 ? "Roblox only hands this one out to signed-in accounts"
                : res.status === 409 ? "Roblox doesn't let games be downloaded"
                    : res.status === 404 ? "Not found on Roblox (it may have been removed)"
                        : res.status === 429 ? "Roblox asked for a short break — try again in a minute" : `Roblox answered ${res.status}`;
            return { ok: false, error: why, status: res.status };
        }
        const size = Number(res.headers.get("content-length") ?? 0);
        if (size > MAX_FILE) return { ok: false, error: "That file is too big to fetch here" };
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length > MAX_FILE) return { ok: false, error: "That file is too big to fetch here" };
        return { ok: true, bytes, type: res.headers.get("content-type") ?? "" };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Roblox" }; }
}

/* ── The groups someone is in ── */

export interface RbxMembership { id: string; name: string; members: number; verified: boolean; role: string; rank: number; icon: string; primary: boolean; }

export async function rbxUserGroups(_: IpcMainInvokeEvent | null, userId: string): Promise<{ ok: true; groups: RbxMembership[]; } | { ok: false; error: string; }> {
    try {
        const uid = id(userId);
        if (!uid) return { ok: false, error: "That isn't a Roblox user" };
        const [r, primary] = await Promise.all([
            json(`https://groups.roblox.com/v2/users/${uid}/groups/roles?includeLocked=true`),
            soft(json(`https://groups.roblox.com/v1/users/${uid}/groups/primary/role`)),
        ]);
        const list: any[] = r?.data ?? [];
        const ids = list.map(x => String(x.group?.id)).filter(Boolean);
        const icons = new Map<string, string>();
        for (let i = 0; i < ids.length; i += 100) {
            const t = await soft(json(`https://thumbnails.roblox.com/v1/groups/icons?groupIds=${ids.slice(i, i + 100).join(",")}&size=150x150&format=Png`)) as any;
            for (const x of t?.data ?? []) if (x.imageUrl) icons.set(String(x.targetId), x.imageUrl);
        }
        const primaryId = String((primary as any)?.group?.id ?? "");
        return {
            ok: true, groups: list.map(x => ({
                id: String(x.group?.id), name: x.group?.name ?? "Group", members: x.group?.memberCount ?? 0, verified: !!x.group?.hasVerifiedBadge,
                role: x.role?.name ?? "", rank: x.role?.rank ?? 0, icon: icons.get(String(x.group?.id)) ?? "", primary: String(x.group?.id) === primaryId,
            })),
        };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Roblox" }; }
}

/** A picture from Roblox's image servers (for saving an avatar render). */
export async function rbxCdnImage(_: IpcMainInvokeEvent | null, url: string): Promise<Uint8Array | null> {
    if (!/^https:\/\/[a-z0-9-]+\.rbxcdn\.com\//i.test(String(url))) return null;
    try {
        const r = await fetch(url, { headers: { "user-agent": UA } });
        return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    } catch { return null; }
}

/* ── Rolimons: every limited's value, for the trade calculator ── */

export interface RbxLimited { id: string; name: string; acronym: string; rap: number; value: number | null; demand: number; trend: number; projected: boolean; hyped: boolean; rare: boolean; }

let limitedsCache: { at: number; items: RbxLimited[]; } | null = null;

/** Rolimons' public item list (their documented API), kept for 10 minutes. */
export async function rbxLimiteds(_: IpcMainInvokeEvent | null, fresh = false): Promise<{ ok: true; items: RbxLimited[]; at: number; } | { ok: false; error: string; }> {
    if (!fresh && limitedsCache && Date.now() - limitedsCache.at < 10 * 60_000) return { ok: true, ...limitedsCache };
    try {
        const r = await json("https://api.rolimons.com/items/v1/itemdetails");
        if (!r?.success || !r.items) return { ok: false, error: "Rolimons didn't send the item list" };
        const n = (v: unknown) => typeof v === "number" ? v : -1;
        const items: RbxLimited[] = Object.entries(r.items as Record<string, any[]>).map(([id, a]) => ({
            id, name: String(a[0] ?? "Item"), acronym: String(a[1] ?? ""), rap: Math.max(0, n(a[2])), value: n(a[3]) > 0 ? n(a[3]) : null,
            demand: n(a[5]), trend: n(a[6]), projected: n(a[7]) === 1, hyped: n(a[8]) === 1, rare: n(a[9]) === 1,
        }));
        limitedsCache = { at: Date.now(), items };
        return { ok: true, ...limitedsCache };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Rolimons" }; }
}

/* ── What a player owned on a day (Rolimons inventory history) ── */

export interface RbxInventoryItem { id: string; name: string; image: string; rap: number; value: number; copies: number; serials: number[]; }
export interface RbxInventoryDay { at: number; prev: number | null; next: number | null; items: RbxInventoryItem[]; copies: number; }

const pageNum = (html: string, name: string) => {
    const m = new RegExp(`var ${name}\\s*=\\s*(-?\\d+)`).exec(html);
    return m ? Number(m[1]) : null;
};

/** Their limiteds on the snapshot nearest a time (seconds) — including ones they've since traded away. */
export async function rbxInventoryAt(_: IpcMainInvokeEvent | null, userId: string, time: number): Promise<{ ok: true; day: RbxInventoryDay | null; } | { ok: false; error: string; }> {
    try {
        const uid = id(userId);
        if (!uid) return { ok: false, error: "That isn't a Roblox user" };
        // Rolimons keeps one snapshot a day, at midnight UTC.
        const day = Math.floor(Number(time) / 86400) * 86400;
        if (!Number.isFinite(day) || day <= 0) return { ok: false, error: "That isn't a date" };
        const get = () => fetch(`https://www.rolimons.com/history/${uid}?timestamp=${day}`, { headers: { "user-agent": UA, accept: "text/html" } });
        let res = await get();
        // Cloudflare's browser check comes and goes — wait a moment and ask once more.
        if (res.status === 403) { await new Promise(r => setTimeout(r, 2500)); res = await get(); }
        if (res.status === 404) return { ok: true, day: null };
        if (res.status === 429) return { ok: false, error: "Rolimons asked for a short break — try again in a minute" };
        if (!res.ok) return { ok: false, error: res.status === 403 ? "Rolimons is checking browsers right now — try again in a bit" : `Rolimons answered ${res.status}` };
        const html = await res.text();
        const assets: Record<string, any[]> | null = pageVar(html, "player_assets");
        if (!assets) return { ok: true, day: null };
        const list: Record<string, any[]> = pageVar(html, "item_list") ?? {};
        const items: RbxInventoryItem[] = [];
        let copies = 0;
        for (const [aid, copiesList] of Object.entries(assets)) {
            const n = Array.isArray(copiesList) ? copiesList.length : 0;
            if (!n) continue;
            copies += n;
            const it = list[aid] ?? [];
            // Each copy: [uaid, serial number or null, …].
            const serials = copiesList.map(c => Array.isArray(c) ? c[1] : null).filter((x): x is number => typeof x === "number");
            items.push({ id: aid, name: String(it[0] ?? "Item"), image: typeof it[10] === "string" ? it[10] : "", rap: Number(it[2]) || 0, value: Number(it[3] ?? it[2]) || 0, copies: n, serials });
        }
        items.sort((a, b) => b.value * b.copies - a.value * a.copies);
        return { ok: true, day: { at: pageNum(html, "asset_snapshot_timestamp") ?? day, prev: pageNum(html, "previous_snapshot_timestamp"), next: pageNum(html, "next_snapshot_timestamp"), items, copies } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Rolimons" }; }
}

/* ── A limited's price over time (Rolimons) ── */

export interface RbxItemHistory { t: number[]; rap: (number | null)[]; best: (number | null)[]; value: (number | null)[]; }

/** Every `var x = {…}` on a page that looks like a price history: a time list plus a RAP list. */
function findHistory(html: string): any {
    const names = [...html.matchAll(/var ([a-z_]+)\s*=\s*\{/g)].map(m => m[1]);
    for (const name of ["history_data", ...names]) {
        const d = pageVar(html, name);
        if (!d || typeof d !== "object") continue;
        const t = d.timestamp ?? d.nominal_scan_time ?? d.time ?? d.t;
        if (Array.isArray(t) && t.length > 1 && (Array.isArray(d.rap) || Array.isArray(d.value) || Array.isArray(d.best_price))) return { ...d, t };
    }
    return null;
}

export async function rbxItemHistory(_: IpcMainInvokeEvent | null, assetId: string): Promise<{ ok: true; history: RbxItemHistory | null; } | { ok: false; error: string; }> {
    try {
        const aid = id(assetId);
        if (!aid) return { ok: false, error: "That isn't an item" };
        const res = await fetch(`https://www.rolimons.com/item/${aid}`, { headers: { "user-agent": UA, accept: "text/html" } });
        if (res.status === 404) return { ok: true, history: null };
        if (res.status === 429) return { ok: false, error: "Rolimons asked for a short break — try again in a minute" };
        if (!res.ok) return { ok: false, error: res.status === 403 ? "Rolimons is checking browsers right now — try again in a bit" : `Rolimons answered ${res.status}` };
        const d = findHistory(await res.text());
        if (!d) return { ok: true, history: null };
        // Times may be in seconds or milliseconds.
        const t = (d.t as number[]).map(x => x > 1e12 ? Math.floor(x / 1000) : x);
        const arr = (k: string) => Array.isArray(d[k]) ? (d[k] as any[]).map(v => typeof v === "number" && v >= 0 ? v : null) : t.map(() => null);
        return { ok: true, history: { t, rap: arr("rap"), best: arr("best_price"), value: arr("value") } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Rolimons" }; }
}

/** Pictures for a handful of items. */
export async function rbxThumbs(_: IpcMainInvokeEvent | null, assetIds: string[]): Promise<Record<string, string>> {
    const ids = (Array.isArray(assetIds) ? assetIds : []).map(String).filter(x => /^\d{1,19}$/.test(x)).slice(0, 100);
    if (!ids.length) return {};
    const t = await soft(json(`https://thumbnails.roblox.com/v1/assets?assetIds=${ids.join(",")}&size=150x150&format=Png`)) as any;
    const out: Record<string, string> = {};
    for (const x of t?.data ?? []) if (x.imageUrl) out[String(x.targetId)] = x.imageUrl;
    return out;
}

/* ── Is a username free? (Roblox's own sign-up check — nothing to log in to) ── */

export async function rbxNameCheck(_: IpcMainInvokeEvent | null, name: string): Promise<{ ok: true; code: number; message: string; } | { ok: false; error: string; }> {
    try {
        const n = String(name ?? "").slice(0, 40);
        if (!n.trim()) return { ok: false, error: "Type a name" };
        const r = await json(`https://auth.roblox.com/v1/usernames/validate?request.username=${encodeURIComponent(n)}&request.birthday=2000-01-01&request.context=Signup`);
        return { ok: true, code: Number(r?.code ?? -1), message: String(r?.message ?? "") };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Roblox" }; }
}
