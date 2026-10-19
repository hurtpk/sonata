/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Steam Watcher's network side. Only Steam's own public endpoints — the store,
// the news feed and public community profiles — no login, no API key. Done
// here because Discord's page isn't allowed to contact other sites.

import { CspPolicies, ImageAndMediaSrc, ImageSrc } from "@main/csp";
import { IpcMainInvokeEvent } from "electron";

// Lets game covers, Steam avatars, and the pictures and clips in patch notes
// show in Discord's window — plus YouTube thumbnails for trailers in them.
CspPolicies["*.steamstatic.com"] = ImageAndMediaSrc;
CspPolicies["img.youtube.com"] = ImageSrc;
CspPolicies["i.ytimg.com"] = ImageSrc;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const COUNTRY = /^[A-Z]{2}$/;
const ASSETS = "https://shared.akamai.steamstatic.com/store_item_assets/";

type Fail = { ok: false; error: string; };

async function get(url: string, kind: "json" | "text" = "json"): Promise<{ ok: true; body: any; } | Fail> {
    try {
        const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" }, redirect: "follow" });
        if (!res.ok) return { ok: false, error: res.status === 429 ? "Steam asked to slow down — trying again later" : `Steam answered ${res.status}` };
        return { ok: true, body: kind === "json" ? await res.json() : await res.text() };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Steam" };
    }
}

const ids = (list: unknown): number[] => (Array.isArray(list) ? list : []).map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 1e8).slice(0, 50);

export interface SteamItem {
    appid: number;
    name: string;
    found: boolean;
    free: boolean;
    header?: string;
    price: { final: number; initial: number; pct: number; ends?: number; formatted: string; formattedInitial?: string; } | null;
    release: { soon: boolean; date?: number; text?: string; early?: boolean; };
    review?: { label: string; pct: number; count: number; };
    freeWeekend?: { start?: number; end?: number; text?: string; };
}

/** Prices, sales, release info, reviews and cover art for up to 50 games at once. */
export async function steamItems(_: IpcMainInvokeEvent, appids: number[], country: string): Promise<{ ok: true; items: SteamItem[]; } | Fail> {
    const list = ids(appids);
    if (!list.length) return { ok: true, items: [] };
    const cc = COUNTRY.test(country) ? country : "US";
    const input = {
        ids: list.map(appid => ({ appid })),
        context: { language: "english", country_code: cc },
        data_request: { include_all_purchase_options: true, include_release: true, include_assets: true, include_reviews: true },
    };
    const r = await get(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`);
    if (!r.ok) return r;
    const items: SteamItem[] = (r.body?.response?.store_items ?? []).map((it: any): SteamItem => {
        const best = it.best_purchase_option;
        const final = Number(best?.final_price_in_cents ?? NaN);
        const ends = (best?.active_discounts ?? []).map((d: any) => Number(d.discount_end_date) * 1000).filter((n: number) => n > 0);
        const fmt: string | undefined = it.assets?.asset_url_format;
        const header = fmt && it.assets?.header ? ASSETS + fmt.replace("${FILENAME}", it.assets.header) : undefined;
        const rev = it.reviews?.summary_filtered;
        const fw = it.free_weekend;
        return {
            appid: Number(it.appid),
            name: String(it.name ?? ""),
            found: it.success === 1 || !!it.name,
            free: !!it.is_free,
            header,
            price: Number.isFinite(final) ? {
                final,
                initial: Number(best.original_price_in_cents ?? final),
                pct: Number(best.discount_pct ?? 0),
                ends: ends.length ? Math.max(...ends) : undefined,
                formatted: String(best.formatted_final_price ?? ""),
                formattedInitial: best.formatted_original_price ? String(best.formatted_original_price) : undefined,
            } : null,
            release: {
                soon: !!it.release?.is_coming_soon,
                date: it.release?.steam_release_date ? Number(it.release.steam_release_date) * 1000 : undefined,
                text: it.release?.custom_release_date_message ? String(it.release.custom_release_date_message) : undefined,
                early: !!it.release?.is_early_access,
            },
            review: rev?.review_score_label ? { label: String(rev.review_score_label), pct: Number(rev.percent_positive ?? 0), count: Number(rev.review_count ?? 0) } : undefined,
            freeWeekend: fw ? { start: fw.start_time ? Number(fw.start_time) * 1000 : undefined, end: fw.end_time ? Number(fw.end_time) * 1000 : undefined, text: fw.text ? String(fw.text) : undefined } : undefined,
        };
    });
    return { ok: true, items };
}

export interface SteamNews { gid: string; title: string; url: string; date: number; contents: string; feed: string; tags: string[]; }

/** The developer's latest announcements (updates, patch notes, events). */
export async function steamNews(_: IpcMainInvokeEvent, appid: number, count = 5): Promise<{ ok: true; news: SteamNews[]; } | Fail> {
    const [id] = ids([appid]);
    if (!id) return { ok: false, error: "Not a Steam game" };
    const n = Math.min(Math.max(Number(count) || 5, 1), 10);
    const r = await get(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${id}&count=${n}&maxlength=0&feeds=steam_community_announcements`);
    if (!r.ok) return r;
    const news: SteamNews[] = (r.body?.appnews?.newsitems ?? []).map((i: any) => ({
        gid: String(i.gid), title: String(i.title ?? ""), url: String(i.url ?? ""), date: Number(i.date) * 1000,
        contents: String(i.contents ?? "").slice(0, 20000), feed: String(i.feedlabel ?? ""), tags: Array.isArray(i.tags) ? i.tags.map(String) : [],
    }));
    return { ok: true, news };
}

export interface SteamSearchHit { appid: number; name: string; image: string; price?: string; }

/** Finds games on the store by name. */
export async function steamSearch(_: IpcMainInvokeEvent, term: string, country: string): Promise<{ ok: true; hits: SteamSearchHit[]; } | Fail> {
    const q = String(term ?? "").trim().slice(0, 80);
    if (!q) return { ok: true, hits: [] };
    const cc = COUNTRY.test(country) ? country : "US";
    const r = await get(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=english&cc=${cc}`);
    if (!r.ok) return r;
    const money = (cents: number, currency: string) => {
        try { return new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100); } catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
    };
    const hits: SteamSearchHit[] = (r.body?.items ?? []).filter((i: any) => i.type === "app").slice(0, 10).map((i: any) => ({
        appid: Number(i.id), name: String(i.name ?? ""), image: String(i.tiny_image ?? ""),
        price: i.price ? money(Number(i.price.final), String(i.price.currency ?? "USD")) : "Free",
    }));
    return { ok: true, hits };
}

export interface SteamProfile {
    steamid: string; name: string; avatar: string; state: string; stateMessage: string; privacy: string;
    memberSince?: string; location?: string; summary?: string; level?: number; url: string;
    recent: { appid: number; name: string; hours?: string; last?: string; }[];
}

const tag = (xml: string, name: string) => {
    const m = xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`));
    return m ? m[1].trim() : undefined;
};
const text = (html: string) => html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();

/** Someone's public Steam profile, from a link, a 17-digit ID or a custom URL name. */
export async function steamProfile(_: IpcMainInvokeEvent, input: string): Promise<{ ok: true; profile: SteamProfile; } | Fail> {
    const raw = String(input ?? "").trim();
    const id = raw.match(/steamcommunity\.com\/profiles\/(\d{17})/i)?.[1] ?? (/^\d{17}$/.test(raw) ? raw : null);
    const vanity = id ? null : (raw.match(/steamcommunity\.com\/id\/([\w-]{2,32})/i)?.[1] ?? (/^[\w-]{2,32}$/.test(raw) ? raw : null));
    if (!id && !vanity) return { ok: false, error: "Paste your Steam profile link (steamcommunity.com/id/… or /profiles/…)" };
    const base = id ? `https://steamcommunity.com/profiles/${id}` : `https://steamcommunity.com/id/${vanity}`;

    const x = await get(`${base}/?xml=1`, "text");
    if (!x.ok) return x;
    const xml: string = x.body;
    if (/<error>/.test(xml) || !tag(xml, "steamID64")) return { ok: false, error: "No Steam profile found there" };
    const steamid = tag(xml, "steamID64")!;

    const profile: SteamProfile = {
        steamid,
        name: tag(xml, "steamID") ?? "",
        avatar: tag(xml, "avatarFull") ?? tag(xml, "avatarMedium") ?? "",
        state: tag(xml, "onlineState") ?? "offline",
        stateMessage: text(tag(xml, "stateMessage") ?? ""),
        privacy: tag(xml, "privacyState") ?? "private",
        memberSince: tag(xml, "memberSince"),
        location: tag(xml, "location") || undefined,
        summary: tag(xml, "summary") ? text(tag(xml, "summary")!).slice(0, 500) || undefined : undefined,
        url: `https://steamcommunity.com/profiles/${steamid}`,
        recent: [],
    };

    // Level and recently played are only on the profile page itself.
    const h = await get(profile.url, "text");
    if (h.ok) {
        const html: string = h.body;
        const level = html.match(/friendPlayerLevelNum">\s*(\d+)\s*</)?.[1];
        if (level) profile.level = Number(level);
        for (const block of html.split(/class="recent_game"/).slice(1, 6)) {
            const g = block.match(/class="game_name"><a[^>]*href="https:\/\/steamcommunity\.com\/app\/(\d+)"[^>]*>([^<]+)</);
            if (!g) continue;
            const details = block.match(/game_info_details">([\s\S]*?)<\/div>/)?.[1];
            const lines = details ? text(details).split("\n").map(s => s.trim()).filter(Boolean) : [];
            profile.recent.push({ appid: Number(g[1]), name: text(g[2]), hours: lines.find(l => /hrs? on record/i.test(l)), last: lines.find(l => /last played|currently in-game/i.test(l)) });
        }
    }
    return { ok: true, profile };
}

/**
 * A picture from a patch note that the developer hosts on their own site
 * (Discord's window may only load pictures from a few places). Only https,
 * only images, at most 12 MB; handed back as a data: address.
 */
export async function steamNoteImage(_: IpcMainInvokeEvent, url: string): Promise<{ ok: true; data: string; } | Fail> {
    let u: URL;
    try { u = new URL(String(url)); } catch { return { ok: false, error: "Not a picture address" }; }
    if (u.protocol !== "https:") return { ok: false, error: "Not a picture address" };
    try {
        const res = await fetch(u, { headers: { "user-agent": UA, accept: "image/*" }, redirect: "follow" });
        const type = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
        if (!res.ok || !/^image\/(png|jpe?g|gif|webp|avif)$/i.test(type)) return { ok: false, error: `Couldn't load the picture (${res.status})` };
        if (Number(res.headers.get("content-length") ?? 0) > 12 * 1048576) return { ok: false, error: "Picture too big" };
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 12 * 1048576) return { ok: false, error: "Picture too big" };
        return { ok: true, data: `data:${type};base64,${buf.toString("base64")}` };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Couldn't load the picture" };
    }
}

export interface SteamFriend { steamid: string; name: string; state: "in-game" | "online" | "offline"; game?: string; url: string; avatar: string; }

/** Someone's public friends list: who's playing what, who's online. */
export async function steamFriends(_: IpcMainInvokeEvent, steamid: string): Promise<{ ok: true; friends: SteamFriend[]; private: boolean; } | Fail> {
    if (!/^\d{17}$/.test(String(steamid))) return { ok: false, error: "Not a Steam ID" };
    const r = await get(`https://steamcommunity.com/profiles/${steamid}/friends/`, "text");
    if (!r.ok) return r;
    const html: string = r.body;
    const friends: SteamFriend[] = html.split(/(?=<div[^>]*class="selectable friend_block_v2)/).slice(1).map((b): SteamFriend => {
        const state = (b.match(/friend_block_v2 persona ([a-z-]+)/)?.[1] ?? "offline") as SteamFriend["state"];
        const [name, ...rest] = text(b.match(/class="friend_block_content">([\s\S]*?)<\/div>/)?.[1] ?? "").split("\n").map(s => s.trim()).filter(Boolean);
        const id = b.match(/data-steamid="(\d{17})"/)?.[1] ?? "";
        return {
            steamid: id,
            name: name ?? id,
            state: state === "in-game" || state === "online" ? state : "offline",
            game: state === "in-game" ? (b.match(/class="friend_game_link">([^<]+)</)?.[1]?.trim() ?? rest[0]) : undefined,
            url: b.match(/class="selectable_overlay"[^>]*href="(https:\/\/steamcommunity\.com\/[^"]+)"/)?.[1] ?? `https://steamcommunity.com/profiles/${id}`,
            avatar: b.match(/<img src="(https:\/\/[^"]+)"/)?.[1] ?? "",
        };
    }).filter(f => f.steamid);
    return { ok: true, friends, private: !friends.length && /profile_private_info|friends list is private/i.test(html) };
}

export interface SteamDetails {
    appid: number; name: string; about: string; header: string; background?: string; website?: string;
    developers: string[]; publishers: string[]; genres: string[]; release?: string; comingSoon: boolean; free: boolean;
    price?: { final: string; initial?: string; pct: number; };
    metacritic?: { score: number; url: string; };
    screenshots: { thumb: string; full: string; }[];
    movies: { name: string; thumb: string; mp4: string; }[];
    dlc: number[];
    requirements: { minimum: string[]; recommended: string[]; };
    platforms: string[];
    achievements: number;
}

/** "<ul><li><strong>OS:</strong> Windows 10</li>…" → ["OS: Windows 10", …] */
const reqLines = (html: unknown) => typeof html === "string"
    ? text(html.replace(/<li>/gi, "\n").replace(/<\/?(ul|br)[^>]*>/gi, "\n")).split("\n").map(s => s.trim()).filter(s => s && !/^(minimum|recommended):?$/i.test(s))
    : [];

/** Everything on a game's store page: screenshots, trailers, details, requirements and DLC. */
export async function steamAppDetails(_: IpcMainInvokeEvent, appid: number, country: string): Promise<{ ok: true; details: SteamDetails; } | Fail> {
    const [id] = ids([appid]);
    if (!id) return { ok: false, error: "Not a Steam game" };
    const cc = COUNTRY.test(country) ? country : "US";
    const r = await get(`https://store.steampowered.com/api/appdetails?appids=${id}&cc=${cc}&l=english`);
    if (!r.ok) return r;
    const d = r.body?.[id]?.data;
    if (!r.body?.[id]?.success || !d) return { ok: false, error: "Steam has no store page for this game" };
    const p = d.price_overview;
    return {
        ok: true,
        details: {
            appid: id,
            name: String(d.name ?? ""),
            about: text(String(d.short_description ?? "")),
            header: String(d.header_image ?? ""),
            background: d.background_raw ? String(d.background_raw) : undefined,
            website: typeof d.website === "string" && d.website.startsWith("https://") ? d.website : undefined,
            developers: (d.developers ?? []).map(String),
            publishers: (d.publishers ?? []).map(String),
            genres: (d.genres ?? []).map((g: any) => String(g.description)),
            release: d.release_date?.date ? String(d.release_date.date) : undefined,
            comingSoon: !!d.release_date?.coming_soon,
            free: !!d.is_free,
            price: p ? { final: String(p.final_formatted ?? ""), initial: p.discount_percent ? String(p.initial_formatted ?? "") : undefined, pct: Number(p.discount_percent ?? 0) } : undefined,
            metacritic: d.metacritic?.score ? { score: Number(d.metacritic.score), url: String(d.metacritic.url ?? "") } : undefined,
            screenshots: (d.screenshots ?? []).slice(0, 20).map((s: any) => ({ thumb: String(s.path_thumbnail), full: String(s.path_full) })),
            // Steam still keeps a plain MP4 of each trailer (the store page itself streams them).
            movies: (d.movies ?? []).slice(0, 8).map((m: any) => ({ name: String(m.name ?? "Trailer"), thumb: String(m.thumbnail ?? ""), mp4: m.mp4?.max ?? `https://cdn.akamai.steamstatic.com/steam/apps/${Number(m.id)}/movie_max.mp4` })),
            dlc: ids(d.dlc ?? []),
            requirements: { minimum: reqLines(d.pc_requirements?.minimum), recommended: reqLines(d.pc_requirements?.recommended) },
            platforms: Object.entries(d.platforms ?? {}).filter(([, v]) => v).map(([k]) => k === "windows" ? "Windows" : k === "mac" ? "Mac" : k === "linux" ? "Linux / Steam Deck" : k),
            achievements: Number(d.achievements?.total ?? 0),
        },
    };
}

export interface SteamReviewSummary { label: string; positive: number; negative: number; total: number; }

/** How a game's reviews break down (all languages). */
export async function steamReviews(_: IpcMainInvokeEvent, appid: number): Promise<{ ok: true; reviews: SteamReviewSummary; } | Fail> {
    const [id] = ids([appid]);
    if (!id) return { ok: false, error: "Not a Steam game" };
    const r = await get(`https://store.steampowered.com/appreviews/${id}?json=1&language=all&purchase_type=all&num_per_page=0`);
    if (!r.ok) return r;
    const q = r.body?.query_summary;
    if (!q) return { ok: false, error: "No reviews" };
    return { ok: true, reviews: { label: String(q.review_score_desc ?? ""), positive: Number(q.total_positive ?? 0), negative: Number(q.total_negative ?? 0), total: Number(q.total_reviews ?? 0) } };
}

export interface SteamAchievement { key: string; name: string; description: string; icon: string; iconLocked: string; unlocked: boolean; at?: number; hidden: boolean; }

/** Someone's achievements in a game, from their public profile. */
export async function steamAchievements(_: IpcMainInvokeEvent, steamid: string, appid: number): Promise<{ ok: true; list: SteamAchievement[]; } | Fail & { private?: boolean; none?: boolean; }> {
    const [id] = ids([appid]);
    if (!/^\d{17}$/.test(String(steamid)) || !id) return { ok: false, error: "Not a Steam profile or game" };
    const r = await get(`https://steamcommunity.com/profiles/${steamid}/stats/${id}/achievements/?xml=1&l=english`, "text");
    if (!r.ok) return r;
    const { body } = r;

    // The older XML answer.
    if (body.startsWith("<?xml")) {
        if (/<privacyState>(private|friendsonly)</.test(body)) return { ok: false, error: "Your game details are private", private: true };
        if (/<error>/.test(body) && !/<achievement /.test(body)) return { ok: false, error: "No achievements for this game on your profile", none: true };
        const list = [...body.matchAll(/<achievement closed="([01])">([\s\S]*?)<\/achievement>/g)].map(([, closed, x]) => ({
            key: tag(x, "apiname") ?? tag(x, "name") ?? "",
            name: text(tag(x, "name") ?? ""),
            description: text(tag(x, "description") ?? ""),
            icon: tag(x, "iconClosed") ?? "",
            iconLocked: tag(x, "iconOpen") ?? tag(x, "iconClosed") ?? "",
            unlocked: closed === "1",
            at: tag(x, "unlockTimestamp") ? Number(tag(x, "unlockTimestamp")) * 1000 : undefined,
            hidden: false,
        }));
        return list.length ? { ok: true, list } : { ok: false, error: "No achievements for this game on your profile", none: true };
    }

    // The newer page carries the same in its page data.
    const raw = body.match(/<script[^>]*id="valve-ssr-data"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    if (!raw) return { ok: false, error: /profile_private_info|is private/i.test(body) ? "Your game details are private" : "Steam doesn't show achievements for this game", private: /profile_private_info|is private/i.test(body) };
    let data: any;
    try { data = JSON.parse(raw); } catch { return { ok: false, error: "Steam's page changed" }; }
    let queries: any[] = [];
    try { queries = JSON.parse(data?.renderContext?.queryData ?? "{}").queries ?? []; } catch { }
    const found: { defs?: any[]; mine?: Record<string, any>; } = {};
    const walk = (v: any, depth = 0) => {
        if (!v || typeof v !== "object" || depth > 8) return;
        if (Array.isArray(v)) {
            if (!found.defs && v.length && v[0]?.api_name && v[0]?.name != null && v[0]?.internal_key != null) found.defs = v;
            else v.forEach(x => walk(x, depth + 1));
            return;
        }
        if (!found.mine && v.achievements && typeof v.achievements === "object" && !Array.isArray(v.achievements)) {
            const first: any = Object.values(v.achievements)[0];
            if (first && "unlocked" in first) found.mine = v.achievements;
        }
        for (const x of Object.values(v)) walk(x, depth + 1);
    };
    queries.forEach(q => walk(q?.state?.data));
    if (!found.defs?.length) return { ok: false, error: "No achievements for this game on your profile", none: true };
    // The game's achievements show even on a private profile — just not whose are unlocked.
    if (!found.mine) return { ok: false, error: "Your game details are private", private: true };
    const list = found.defs.filter(a => !a.archived).map((a: any) => {
        const m = found.mine?.[String(a.internal_key)];
        return {
            key: String(a.api_name), name: String(a.name ?? ""), description: String(a.description ?? ""),
            icon: String(a.icon_achieved ?? ""), iconLocked: String(a.icon_unachieved ?? a.icon_achieved ?? ""),
            unlocked: !!m?.unlocked, at: m?.unlock_time ? Number(m.unlock_time) * 1000 : undefined, hidden: !!a.hidden,
        };
    });
    return { ok: true, list };
}

/** A public wishlist's games, most wanted first. */
export async function steamWishlist(_: IpcMainInvokeEvent, steamid: string): Promise<{ ok: true; appids: number[]; } | Fail> {
    if (!/^\d{17}$/.test(String(steamid))) return { ok: false, error: "Not a Steam ID" };
    const r = await get(`https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${steamid}`);
    if (!r.ok) return r;
    const items: any[] = r.body?.response?.items ?? [];
    return { ok: true, appids: items.sort((a, b) => (a.priority || 1e9) - (b.priority || 1e9)).map(i => Number(i.appid)).filter(Boolean).slice(0, 200) };
}
