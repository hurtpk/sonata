/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Game Hub's network side: only public endpoints that need no account or key.
// Epic's free-games list, fortnite-api.com's item shop, Xbox Game Pass's own
// lists and Microsoft's store catalogue, mcsrvstat.us and Mojang for Minecraft,
// and CheapShark for prices across stores. Done here because Discord's page
// isn't allowed to contact other sites.

import { CspPolicies, ImageSrc } from "@main/csp";
import { IpcMainInvokeEvent } from "electron";

// Covers, item pictures, skins and store icons show in Discord's window.
for (const host of ["cdn1.epicgames.com", "cdn2.unrealengine.com", "fortnite-api.com", "*.fortnite-api.com", "store-images.s-microsoft.com", "mc-heads.net", "www.cheapshark.com", "images.gog-statics.com", "*.gog-statics.com"])
    CspPolicies[host] = ImageSrc;

// CheapShark asks apps to say who they are.
const UA = "Sonata/2026 (+https://github.com/hurtpk/sonata)";
type Fail = { ok: false; error: string; };

async function get(url: string, who: string): Promise<{ ok: true; body: any; } | Fail> {
    try {
        const res = await fetch(url, { headers: { "user-agent": UA, "accept": "application/json" } });
        if (res.status === 404) return { ok: false, error: "not-found" };
        if (!res.ok) return { ok: false, error: res.status === 429 ? `${who} asked to slow down — trying again later` : `${who} answered ${res.status}` };
        return { ok: true, body: await res.json() };
    } catch {
        return { ok: false, error: `Couldn't reach ${who}` };
    }
}

const COUNTRY = /^[A-Z]{2}$/;
const str = (v: unknown, max = 300) => typeof v === "string" ? v.slice(0, max) : "";

/* ── Epic Games Store: free games ── */

export interface EpicGame { id: string; title: string; url: string; image?: string; seller?: string; price?: string; start: number; end: number; now: boolean; }

export async function gamesEpicFree(_: IpcMainInvokeEvent, country: string): Promise<{ ok: true; games: EpicGame[]; } | Fail> {
    const cc = COUNTRY.test(country) ? country : "US";
    const r = await get(`https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=${cc}&allowCountries=${cc}`, "Epic");
    if (!r.ok) return r;
    const games: EpicGame[] = [];
    for (const e of r.body?.data?.Catalog?.searchStore?.elements ?? []) {
        const offer = (list: any) => (list?.[0]?.promotionalOffers ?? []).find((o: any) => o?.discountSetting?.discountPercentage === 0);
        const now = offer(e?.promotions?.promotionalOffers), next = offer(e?.promotions?.upcomingPromotionalOffers);
        const o = now ?? next;
        if (!o) continue;
        const slug = e.productSlug || e.catalogNs?.mappings?.[0]?.pageSlug || e.offerMappings?.[0]?.pageSlug;
        const img = (e.keyImages ?? []).find((k: any) => k.type === "OfferImageWide") ?? (e.keyImages ?? []).find((k: any) => k.type === "DieselStoreFrontWide") ?? (e.keyImages ?? []).find((k: any) => k.type === "Thumbnail");
        games.push({
            id: str(e.id, 64),
            title: str(e.title, 160),
            url: slug ? `https://store.epicgames.com/en-US/p/${encodeURIComponent(String(slug).replace(/\/home$/, ""))}` : "https://store.epicgames.com/en-US/free-games",
            image: typeof img?.url === "string" && img.url.startsWith("https://") ? img.url : undefined,
            seller: str(e.seller?.name, 100) || undefined,
            price: str(e.price?.totalPrice?.fmtPrice?.originalPrice, 20) || undefined,
            start: Date.parse(o.startDate) || 0,
            end: Date.parse(o.endDate) || 0,
            now: !!now,
        });
    }
    return { ok: true, games };
}

/* ── Fortnite: today's item shop ── */

export interface ShopItem { id: string; name: string; type: string; rarity: string; price: number; regular: number; image?: string; section: string; outDate?: number; }

export async function gamesFortniteShop(_: IpcMainInvokeEvent): Promise<{ ok: true; date: string; items: ShopItem[]; } | Fail> {
    const r = await get("https://fortnite-api.com/v2/shop", "Fortnite's shop");
    if (!r.ok) return r;
    const items: ShopItem[] = [];
    for (const e of r.body?.data?.entries ?? []) {
        const first = e.brItems?.[0] ?? e.tracks?.[0] ?? e.cars?.[0] ?? e.instruments?.[0] ?? e.legoKits?.[0];
        const name = str(e.bundle?.name, 120) || str(first?.name, 120) || str(first?.title, 120);
        if (!name) continue;
        const image = e.newDisplayAsset?.renderImages?.[0]?.image ?? e.bundle?.image ?? first?.images?.featured ?? first?.images?.icon ?? first?.albumArt ?? first?.images?.large;
        items.push({
            id: str(e.offerId, 120) || name,
            name,
            type: e.bundle ? "Bundle" : str(first?.type?.displayValue, 40) || (e.tracks ? "Jam Track" : e.cars ? "Car" : "Item"),
            rarity: str(first?.rarity?.value, 30).toLowerCase(),
            price: Number(e.finalPrice) || 0,
            regular: Number(e.regularPrice) || 0,
            image: typeof image === "string" && image.startsWith("https://") ? image : undefined,
            section: str(e.layout?.name, 60) || "Shop",
            outDate: Date.parse(e.outDate) || undefined,
        });
    }
    return { ok: true, date: str(r.body?.data?.date, 40), items };
}

/* ── Xbox Game Pass ── */

const PASS_LISTS = { added: "f13cf6b4-57e6-4459-89df-6aec18cf0538", coming: "095bda36-f5cd-43f2-9ee1-0a72f371fb96", leaving: "393f05bf-e596-4ef6-9487-6d4fa0eab987" } as const;
export type PassList = keyof typeof PASS_LISTS;
export interface PassGame { id: string; title: string; publisher?: string; image?: string; url: string; }

export async function gamesGamePass(_: IpcMainInvokeEvent, list: PassList, country: string): Promise<{ ok: true; games: PassGame[]; } | Fail> {
    const sigl = PASS_LISTS[list];
    if (!sigl) return { ok: false, error: "Unknown list" };
    const cc = COUNTRY.test(country) ? country : "US";
    const r = await get(`https://catalog.gamepass.com/sigls/v2?id=${sigl}&language=en-us&market=${cc}`, "Game Pass");
    if (!r.ok) return r;
    const ids = (Array.isArray(r.body) ? r.body : []).map((x: any) => x?.id).filter((id: unknown): id is string => typeof id === "string" && /^[A-Z0-9]{12}$/.test(id)).slice(0, 60);
    const games: PassGame[] = [];
    for (let i = 0; i < ids.length; i += 20) {
        const d = await get(`https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${ids.slice(i, i + 20).join(",")}&market=${cc}&languages=en-us`, "Microsoft's store");
        if (!d.ok) return d;
        for (const p of d.body?.Products ?? []) {
            const l = p?.LocalizedProperties?.[0];
            const img = (l?.Images ?? []).find((x: any) => x.ImagePurpose === "Poster") ?? (l?.Images ?? []).find((x: any) => x.ImagePurpose === "BoxArt");
            const uri = typeof img?.Uri === "string" ? (img.Uri.startsWith("//") ? `https:${img.Uri}` : img.Uri) : undefined;
            games.push({
                id: str(p.ProductId, 20),
                title: str(l?.ProductTitle, 160),
                publisher: str(l?.PublisherName, 100) || undefined,
                image: uri?.startsWith("https://") ? uri : undefined,
                url: `https://www.xbox.com/en-US/games/store/x/${str(p.ProductId, 20)}`,
            });
        }
    }
    // In the list's own order.
    const at = new Map(ids.map((id: string, i: number) => [id, i]));
    games.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
    return { ok: true, games };
}

/* ── Minecraft ── */

export interface McServer { host: string; online: boolean; players: number; max: number; names: string[]; version?: string; motd?: string; icon?: string; }

const HOST = /^[a-z0-9.-]{1,253}(:\d{1,5})?$/i;

/** The checker sends server messages with HTML codes like &amp; in them. */
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'", apos: "'" };
const unescapeHtml = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, e: string) => ENTITIES[e]);

export async function gamesMcServer(_: IpcMainInvokeEvent, host: string): Promise<{ ok: true; server: McServer; } | Fail> {
    const h = String(host ?? "").trim();
    if (!HOST.test(h)) return { ok: false, error: "That doesn't look like a server address" };
    const r = await get(`https://api.mcsrvstat.us/3/${encodeURIComponent(h)}`, "the server checker");
    if (!r.ok) return r;
    const b = r.body ?? {};
    return {
        ok: true,
        server: {
            host: h,
            online: !!b.online,
            players: Number(b.players?.online) || 0,
            max: Number(b.players?.max) || 0,
            names: (b.players?.list ?? []).map((p: any) => str(p?.name, 32)).filter(Boolean).slice(0, 40),
            version: str(b.version, 80) || undefined,
            motd: unescapeHtml((b.motd?.clean ?? []).map((l: unknown) => str(l, 120)).join("\n")).trim() || undefined,
            // A small PNG the server sends about itself.
            icon: typeof b.icon === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(b.icon) && b.icon.length < 40_000 ? b.icon : undefined,
        },
    };
}

export async function gamesMcPlayer(_: IpcMainInvokeEvent, name: string): Promise<{ ok: true; id: string; name: string; } | Fail> {
    const n = String(name ?? "").trim();
    if (!/^[A-Za-z0-9_]{1,16}$/.test(n)) return { ok: false, error: "Minecraft names are 1–16 letters, numbers or _" };
    const r = await get(`https://api.mojang.com/users/profiles/minecraft/${n}`, "Mojang");
    if (!r.ok) return r.error === "not-found" ? { ok: false, error: "No Minecraft player has that name" } : r;
    return { ok: true, id: str(r.body?.id, 40), name: str(r.body?.name, 16) };
}

/* ── Prices across stores (CheapShark) ── */

export interface DealGame { id: string; title: string; cheapest: number; thumb?: string; }
export interface StoreDeal { store: string; price: number; retail: number; savings: number; dealId: string; }
export interface DealStore { id: string; name: string; icon?: string; active: boolean; }

const CS = "https://www.cheapshark.com/api/1.0";
const csImg = (path: unknown) => typeof path === "string" ? (path.startsWith("https://") ? path : path.startsWith("/") ? `https://www.cheapshark.com${path}` : undefined) : undefined;

export async function gamesDealSearch(_: IpcMainInvokeEvent, title: string): Promise<{ ok: true; games: DealGame[]; } | Fail> {
    const t = String(title ?? "").trim().slice(0, 80);
    if (!t) return { ok: true, games: [] };
    const r = await get(`${CS}/games?title=${encodeURIComponent(t)}&limit=24`, "CheapShark");
    if (!r.ok) return r;
    return { ok: true, games: (Array.isArray(r.body) ? r.body : []).map((g: any) => ({ id: str(g.gameID, 20), title: str(g.external, 160), cheapest: Number(g.cheapest) || 0, thumb: csImg(g.thumb) })) };
}

export async function gamesDealGame(_: IpcMainInvokeEvent, id: string): Promise<{ ok: true; title: string; thumb?: string; lowest?: { price: number; date: number; }; deals: StoreDeal[]; } | Fail> {
    if (!/^\d{1,10}$/.test(String(id))) return { ok: false, error: "Unknown game" };
    const r = await get(`${CS}/games?id=${id}`, "CheapShark");
    if (!r.ok) return r;
    const b = r.body ?? {};
    return {
        ok: true,
        title: str(b.info?.title, 160),
        thumb: csImg(b.info?.thumb),
        lowest: b.cheapestPriceEver ? { price: Number(b.cheapestPriceEver.price) || 0, date: (Number(b.cheapestPriceEver.date) || 0) * 1000 } : undefined,
        deals: (b.deals ?? []).map((d: any) => ({ store: str(d.storeID, 6), price: Number(d.price) || 0, retail: Number(d.retailPrice) || 0, savings: Math.round(Number(d.savings) || 0), dealId: str(d.dealID, 200) })).sort((x: StoreDeal, y: StoreDeal) => x.price - y.price),
    };
}

export async function gamesDealTop(_: IpcMainInvokeEvent): Promise<{ ok: true; deals: (StoreDeal & { title: string; thumb?: string; gameId: string; rating: number; })[]; } | Fail> {
    const r = await get(`${CS}/deals?pageSize=40&sortBy=Deal%20Rating&onSale=1`, "CheapShark");
    if (!r.ok) return r;
    return {
        ok: true,
        deals: (Array.isArray(r.body) ? r.body : []).map((d: any) => ({
            title: str(d.title, 160), thumb: csImg(d.thumb), gameId: str(d.gameID, 20), rating: Number(d.dealRating) || 0,
            store: str(d.storeID, 6), price: Number(d.salePrice) || 0, retail: Number(d.normalPrice) || 0, savings: Math.round(Number(d.savings) || 0), dealId: str(d.dealID, 200),
        })),
    };
}

export async function gamesDealStores(_: IpcMainInvokeEvent): Promise<{ ok: true; stores: DealStore[]; } | Fail> {
    const r = await get(`${CS}/stores`, "CheapShark");
    if (!r.ok) return r;
    return { ok: true, stores: (Array.isArray(r.body) ? r.body : []).map((s: any) => ({ id: str(s.storeID, 6), name: str(s.storeName, 60), icon: csImg(s.images?.icon), active: !!s.isActive })) };
}
