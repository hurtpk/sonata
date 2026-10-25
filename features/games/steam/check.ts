/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Checking the watchlist: every game's price and release in one request per
// 50 games, then each game's announcements, a second apart. Compares with
// what was seen last time and pops up anything new. The first check after
// adding a game only records — it never announces what was already true.

import { showNotification } from "@api/Notifications";

import type { SteamItem, SteamNews } from "./native";
import { addFeed, FeedItem, game, games, updateGame, Watched } from "./store";

const native = () => VencordNative.pluginHelpers.Sonata as any;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const opts = {
    hours: 3,
    country: "US",
    sales: true,
    updates: "updates" as "updates" | "all" | "off",
    releases: true,
    free: true,
    onOpen: (_tab?: string) => { },
    /** Re-reads the settings before each check. */
    sync: () => { },
};

export const status = { running: false, lastRun: 0, nextRun: 0, error: "" };
const statusListeners = new Set<() => void>();
export const onStatus = (l: () => void) => { statusListeners.add(l); return () => void statusListeners.delete(l); };
const tell = () => statusListeners.forEach(l => l());

const UPDATE = /\b(update|patch|hotfix|changelog|release notes|v?\d+\.\d+(\.\d+)?)\b/i;
const FREE_WEEKEND = /free (weekend|to play this|play)|play (it )?for free|free-to-play weekend/i;

export const isUpdate = (n: { title: string; tags?: string[]; }) => (n.tags ?? []).includes("patchnotes") || UPDATE.test(n.title);
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fullDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function announce(item: FeedItem | null, image?: string) {
    if (!item) return;
    const want = item.kind === "sale" || item.kind === "target" ? opts.sales
        : item.kind === "update" ? opts.updates !== "off"
            : item.kind === "news" ? opts.updates === "all"
                : item.kind === "release" || item.kind === "date" ? opts.releases
                    : opts.free;
    if (!want) return;
    showNotification({ title: item.title, body: item.body ?? item.name, image, color: "#66c0f4", onClick: () => opts.onOpen(item.kind === "update" || item.kind === "news" ? `news:${item.appid}:${item.newsGid}` : "activity") });
}

/** What changed between the last check and this one. */
function compare(g: Watched, it: SteamItem) {
    const first = g.lastCheck == null;
    const was = { price: g.price, free: g.free, release: g.release, freeWeekend: g.freeWeekend };
    const now = Date.now();

    updateGame(g.appid, x => {
        x.name = it.name || x.name;
        x.header = it.header ?? x.header;
        x.price = it.price;
        x.free = it.free;
        x.release = it.release;
        x.review = it.review;
        x.freeWeekend = it.freeWeekend;
        x.lastCheck = now;
        x.error = undefined;
        if (it.price && x.history.at(-1)?.final !== it.price.final) x.history = [...x.history, { t: now, final: it.price.final }].slice(-200);
    });
    if (first) {
        // Already under the target when it was added: say so once, quietly.
        if (g.target != null && it.price && it.price.final <= g.target) updateGame(g.appid, x => { x.targetHit = true; });
        return;
    }

    const name = it.name || g.name;
    const p = it.price;

    // Free to keep (100% off, or a paid game that became free).
    if ((p && p.pct === 100 && (was.price?.pct ?? 0) < 100) || (it.free && was.free === false && (was.price?.final ?? 0) > 0)) {
        announce(addFeed({ appid: g.appid, name, kind: "free", title: `🎁 ${name} is free to keep`, body: p?.ends ? `Grab it before ${day(p.ends)} — it's yours forever once claimed.` : "Grab it now — it's yours forever once claimed." }), it.header);
    } else if (p && p.pct > 0 && p.pct > (was.price?.pct ?? 0)) {
        announce(addFeed({ appid: g.appid, name, kind: "sale", title: `🏷️ ${name} is ${p.pct}% off`, body: `${p.formatted}${p.formattedInitial ? ` (was ${p.formattedInitial})` : ""}${p.ends ? ` · ends ${day(p.ends)}` : ""}` }), it.header);
    }

    // At or under your target price.
    const latest = game(g.appid);
    if (latest?.target != null && p) {
        if (p.final <= latest.target && !latest.targetHit) {
            updateGame(g.appid, x => { x.targetHit = true; });
            announce(addFeed({ appid: g.appid, name, kind: "target", title: `🎯 ${name} hit your price`, body: `Now ${p.formatted}${p.formattedInitial ? ` (was ${p.formattedInitial})` : ""}${p.ends ? ` · until ${day(p.ends)}` : ""}` }), it.header);
        } else if (p.final > latest.target && latest.targetHit) updateGame(g.appid, x => { x.targetHit = false; });
    }

    // Free weekend started.
    if (it.freeWeekend && !was.freeWeekend) {
        announce(addFeed({ appid: g.appid, name, kind: "freeWeekend", title: `🎮 ${name} is free to play right now`, body: it.freeWeekend.end ? `Free until ${day(it.freeWeekend.end)}${it.freeWeekend.text ? ` — ${it.freeWeekend.text}` : ""}` : it.freeWeekend.text ?? "A free weekend — play it without buying." }), it.header);
    }

    // Out now, or the date moved.
    if (was.release?.soon && !it.release.soon) {
        announce(addFeed({ appid: g.appid, name, kind: "release", title: `🚀 ${name} is out now`, body: p ? `${p.formatted}${p.pct ? ` · ${p.pct}% off for launch` : ""}` : it.free ? "Free to play" : "Available on Steam" }), it.header);
    } else if (was.release?.soon && it.release.soon) {
        const before = was.release.date ? fullDay(was.release.date) : was.release.text;
        const after = it.release.date ? fullDay(it.release.date) : it.release.text;
        if (before && after && before !== after) announce(addFeed({ appid: g.appid, name, kind: "date", title: `📅 ${name} has a new release date`, body: `${before} → ${after}` }), it.header);
    }
}

async function checkNews(g: Watched) {
    const r = await native().steamNews(g.appid, 5);
    if (!r?.ok) return;
    const list: SteamNews[] = r.news;
    if (!list.length) return;
    const newest = Math.max(...list.map(n => n.date));
    const since = g.newsAt;
    const top = list.reduce((a, b) => (b.date > a.date ? b : a));
    updateGame(g.appid, x => {
        x.newsAt = Math.max(newest, x.newsAt ?? 0);
        x.lastNews = { gid: top.gid, title: top.title, date: top.date, update: isUpdate(top) };
    });
    if (since == null) return;
    for (const n of list.filter(n => n.date > since).sort((a, b) => a.date - b.date)) {
        const update = isUpdate(n);
        if (FREE_WEEKEND.test(n.title)) {
            announce(addFeed({ t: n.date, appid: g.appid, name: g.name, kind: "freeWeekend", title: `🎮 ${g.name}: ${n.title}`, body: "Tap to read the announcement", newsGid: n.gid, url: n.url }), g.header);
            continue;
        }
        announce(addFeed({ t: n.date, appid: g.appid, name: g.name, kind: update ? "update" : "news", title: `${update ? "🛠️" : "📰"} ${g.name}: ${n.title}`, body: update ? "New update — tap to read the patch notes" : "New announcement — tap to read it", newsGid: n.gid, url: n.url }), g.header);
    }
}

/** Checks some games now (all of them when left out). */
export async function checkGames(appids?: number[]) {
    const list = (appids ? appids.map(game).filter(Boolean) as Watched[] : games());
    if (!list.length) return;
    for (let i = 0; i < list.length; i += 50) {
        const chunk = list.slice(i, i + 50);
        const r = await native().steamItems(chunk.map(g => g.appid), opts.country);
        if (!r?.ok) { status.error = r?.error ?? "Couldn't reach Steam"; tell(); return; }
        for (const g of chunk) {
            const it = (r.items as SteamItem[]).find(x => x.appid === g.appid);
            if (it) compare(g, it);
            else updateGame(g.appid, x => { x.error = "Steam didn't return this game (removed or not sold in your region)"; x.lastCheck = Date.now(); });
        }
        if (i + 50 < list.length) await sleep(1500);
    }
    for (const g of list) {
        const fresh = game(g.appid);
        if (!fresh) continue;
        await checkNews(fresh);
        await sleep(1000);
    }
}

let timer: ReturnType<typeof setTimeout> | null = null;

export async function runCheck() {
    if (status.running) return;
    opts.sync();
    status.running = true; status.error = ""; tell();
    try { await checkGames(); } catch (e) { status.error = e instanceof Error ? e.message : String(e); }
    status.running = false;
    status.lastRun = Date.now();
    schedule(opts.hours * 3600_000);
    tell();
}

function schedule(ms: number) {
    if (timer) clearTimeout(timer);
    status.nextRun = Date.now() + ms;
    timer = setTimeout(() => void runCheck(), ms);
}

export function startChecks() { schedule(60_000); tell(); }
export function stopChecks() { if (timer) clearTimeout(timer); timer = null; status.nextRun = 0; }
