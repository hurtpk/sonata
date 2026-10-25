/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Show Tracker's network side: AniList (anime) and TVMaze (TV shows), both
// free and public, with no account or key. Done here because Discord's page
// isn't allowed to contact other sites.

import { CspPolicies, ImageSrc } from "@main/csp";
import { IpcMainInvokeEvent } from "electron";

// Posters show in Discord's window.
for (const host of ["s4.anilist.co", "*.anilist.co", "static.tvmaze.com"]) CspPolicies[host] = ImageSrc;

export type Source = "anime" | "tv";
export interface Episode { at?: number; number?: number; season?: number; name?: string; }
export interface Show {
    /** "anime:21" or "tv:82". */
    key: string;
    source: Source;
    id: number;
    title: string;
    image?: string;
    /** Airing, finished, not out yet… */
    status: string;
    where?: string;
    url: string;
    year?: number;
    total?: number;
    next?: Episode;
    last?: Episode;
}
type Fail = { ok: false; error: string; };

const str = (v: unknown, max = 200) => typeof v === "string" ? v.slice(0, max) : undefined;
const https = (v: unknown) => typeof v === "string" && v.startsWith("https://") ? v : undefined;

/* ── AniList (anime) ── */

const MEDIA = "id title { romaji english } coverImage { large } status episodes nextAiringEpisode { airingAt episode } siteUrl seasonYear format studios(isMain: true) { nodes { name } }";
const ANI_STATUS: Record<string, string> = { RELEASING: "Airing", FINISHED: "Finished", NOT_YET_RELEASED: "Not out yet", CANCELLED: "Cancelled", HIATUS: "On a break" };

async function anilist(query: string, variables: object): Promise<{ ok: true; body: any; } | Fail> {
    try {
        const res = await fetch("https://graphql.anilist.co", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ query, variables }) });
        if (res.status === 429) return { ok: false, error: "AniList asked to slow down — trying again later" };
        if (!res.ok) return { ok: false, error: `AniList answered ${res.status}` };
        return { ok: true, body: await res.json() };
    } catch { return { ok: false, error: "Couldn't reach AniList" }; }
}

function anime(m: any): Show {
    const next = m.nextAiringEpisode;
    return {
        key: `anime:${m.id}`, source: "anime", id: m.id,
        title: str(m.title?.english) || str(m.title?.romaji) || "Untitled",
        image: https(m.coverImage?.large), status: ANI_STATUS[m.status] ?? "Unknown",
        where: str(m.studios?.nodes?.[0]?.name, 80), url: https(m.siteUrl) ?? `https://anilist.co/anime/${m.id}`,
        year: m.seasonYear ?? undefined, total: m.episodes ?? undefined,
        next: next ? { at: next.airingAt * 1000, number: next.episode } : undefined,
        last: next?.episode > 1 ? { number: next.episode - 1 } : m.status === "FINISHED" && m.episodes ? { number: m.episodes } : undefined,
    };
}

/* ── TVMaze (TV) ── */

async function tvmaze(path: string): Promise<{ ok: true; body: any; } | Fail> {
    try {
        const res = await fetch(`https://api.tvmaze.com${path}`, { headers: { accept: "application/json" } });
        if (res.status === 404) return { ok: false, error: "not-found" };
        if (res.status === 429) return { ok: false, error: "TVMaze asked to slow down — trying again later" };
        if (!res.ok) return { ok: false, error: `TVMaze answered ${res.status}` };
        return { ok: true, body: await res.json() };
    } catch { return { ok: false, error: "Couldn't reach TVMaze" }; }
}

const ep = (e: any): Episode | undefined => e ? { at: e.airstamp ? Date.parse(e.airstamp) : undefined, number: e.number ?? undefined, season: e.season ?? undefined, name: str(e.name, 120) } : undefined;

function tv(s: any): Show {
    const TV_STATUS: Record<string, string> = { Running: "Airing", Ended: "Finished", "To Be Determined": "Waiting for news", "In Development": "Not out yet" };
    return {
        key: `tv:${s.id}`, source: "tv", id: s.id,
        title: str(s.name) ?? "Untitled", image: https(s.image?.medium?.replace(/^http:/, "https:")),
        status: TV_STATUS[s.status] ?? str(s.status, 40) ?? "Unknown",
        where: str(s.network?.name ?? s.webChannel?.name, 80), url: https(s.url) ?? `https://www.tvmaze.com/shows/${s.id}`,
        year: s.premiered ? Number(String(s.premiered).slice(0, 4)) : undefined,
        next: ep(s._embedded?.nextepisode), last: ep(s._embedded?.previousepisode),
    };
}

/* ── For the window ── */

export async function showsSearch(_: IpcMainInvokeEvent, source: Source, query: string): Promise<{ ok: true; shows: Show[]; } | Fail> {
    const q = String(query ?? "").trim().slice(0, 100);
    if (q.length < 2) return { ok: true, shows: [] };
    if (source === "anime") {
        const r = await anilist(`query ($q: String) { Page(perPage: 10) { media(search: $q, type: ANIME, sort: [SEARCH_MATCH, POPULARITY_DESC]) { ${MEDIA} } } }`, { q });
        if (!r.ok) return r;
        return { ok: true, shows: (r.body?.data?.Page?.media ?? []).map(anime) };
    }
    const r = await tvmaze(`/search/shows?q=${encodeURIComponent(q)}`);
    if (!r.ok) return r.error === "not-found" ? { ok: true, shows: [] } : r;
    return { ok: true, shows: (r.body ?? []).slice(0, 10).map((x: any) => tv(x.show)) };
}

/** The latest on the shows you follow (next and last episode). */
export async function showsRefresh(_: IpcMainInvokeEvent, keys: string[]): Promise<{ ok: true; shows: Show[]; errors: string[]; } | Fail> {
    const list = (Array.isArray(keys) ? keys : []).slice(0, 200);
    const animeIds = list.filter(k => k.startsWith("anime:")).map(k => Number(k.slice(6))).filter(Number.isInteger);
    const tvIds = list.filter(k => k.startsWith("tv:")).map(k => Number(k.slice(3))).filter(Number.isInteger);
    const shows: Show[] = [], errors: string[] = [];
    for (let i = 0; i < animeIds.length; i += 50) {
        const r = await anilist(`query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { ${MEDIA} } } }`, { ids: animeIds.slice(i, i + 50) });
        if (r.ok) shows.push(...(r.body?.data?.Page?.media ?? []).map(anime)); else errors.push(r.error);
    }
    // TVMaze is one show at a time, gently.
    for (const id of tvIds) {
        const r = await tvmaze(`/shows/${id}?embed[]=nextepisode&embed[]=previousepisode`);
        if (r.ok) shows.push(tv(r.body)); else if (r.error !== "not-found") errors.push(r.error);
        await new Promise(res => setTimeout(res, 250));
    }
    return { ok: true, shows, errors: [...new Set(errors)] };
}
