/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Checking the accounts: one at a time, with a pause between every page, so
// it looks like someone browsing — and if TikTok pushes back, it waits a
// while before trying again.

import { showToast } from "@webpack/common";

import { Account, compact, getAccount, getAccounts, MILESTONES, postedAt, short, update } from "./store";

const native = () => VencordNative.pluginHelpers.Sonata as any;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const pause = () => sleep(2500 + Math.random() * 3000);

export const opts = { minutes: 60, posts: true, postsCount: 12, postsEveryHours: 3, milestones: true };

export interface Progress { running: boolean; current?: string; done: number; total: number; blockedUntil: number; lastRun: number; }
export const progress: Progress = { running: false, done: 0, total: 0, blockedUntil: 0, lastRun: 0 };
const progressListeners = new Set<() => void>();
export const onProgress = (l: () => void) => { progressListeners.add(l); return () => void progressListeners.delete(l); };
const tell = () => progressListeners.forEach(l => l());

let stopFlag = false;

async function checkProfile(a: Account): Promise<"ok" | "blocked" | "error"> {
    const r = await native().tiktokProfile(a.username);
    if (!r.ok) {
        update(a.username, x => { x.error = r.error; x.lastCheck = Date.now(); });
        return r.kind === "blocked" ? "blocked" : "error";
    }
    const p = r.profile;
    const now = Date.now();
    update(a.username, x => {
        x.error = undefined;
        x.tiktokId = p.id; x.nickname = p.nickname; x.avatar = p.avatar; x.bio = p.bio; x.verified = p.verified; x.private = p.private;
        const stat = { t: now, followers: p.followers, following: p.following, likes: p.likes, videos: p.videos };
        x.first ??= stat;
        const prev = x.last;
        x.last = stat;
        // A new point when something changed, or at least once an hour.
        const lastPoint = x.history.at(-1);
        if (!lastPoint || now - lastPoint.t > 3600_000 || lastPoint.followers !== stat.followers || lastPoint.likes !== stat.likes || lastPoint.videos !== stat.videos) x.history = compact([...x.history, stat]);
        else x.history[x.history.length - 1] = stat;
        x.lastCheck = now;
        if (opts.milestones && prev) {
            const hit = MILESTONES.filter(m => prev.followers < m && stat.followers >= m && !(x.milestones ?? []).includes(m));
            if (hit.length) {
                x.milestones = [...(x.milestones ?? []), ...hit];
                showToast(`🎉 ${x.nickname ?? x.username} just passed ${short(hit.at(-1)!)} followers on TikTok!`, "success");
            }
        }
    });
    return "ok";
}

async function checkPosts(a: Account): Promise<"ok" | "blocked"> {
    const r = await native().tiktokRecent(a.username);
    if (!r.ok) return r.kind === "blocked" ? "blocked" : "ok";
    const now = Date.now();
    update(a.username, x => {
        for (const ref of r.posts) {
            const old = x.posts[ref.id];
            x.posts[ref.id] = old ? { ...old, desc: ref.desc || old.desc, cover: ref.cover || old.cover, seen: now } : { id: ref.id, desc: ref.desc, cover: ref.cover, created: postedAt(ref.id), first: null, last: null, history: [], seen: now };
        }
        // Only the newest 60 posts are kept.
        const keep = Object.values(x.posts).sort((p, q) => q.created - p.created).slice(0, 60);
        x.posts = Object.fromEntries(keep.map(p => [p.id, p]));
    });
    const newest = Object.values(getAccount(a.username)?.posts ?? {}).sort((p, q) => q.created - p.created).slice(0, opts.postsCount);
    for (const post of newest) {
        if (stopFlag) break;
        await pause();
        const v = await native().tiktokVideo(a.username, post.id);
        if (!v.ok) {
            if (v.kind === "blocked") return "blocked";
            if (v.kind === "notfound") update(a.username, x => { if (x.posts[post.id]) x.posts[post.id].gone = true; });
            continue;
        }
        const s = { t: Date.now(), likes: v.post.likes, views: v.post.views, comments: v.post.comments, shares: v.post.shares, saves: v.post.saves };
        update(a.username, x => {
            const p = x.posts[post.id];
            if (!p) return;
            p.desc = v.post.desc || p.desc; p.cover = v.post.cover || p.cover; p.created = v.post.created || p.created; p.gone = false;
            p.first ??= s; p.last = s;
            p.history = compact([...p.history, s], 120);
        });
    }
    update(a.username, x => { x.lastPostsCheck = Date.now(); });
    return "ok";
}

async function checkRoblox(a: Account) {
    if (!a.roblox?.input) return;
    const r = await native().robloxUser(a.roblox.input);
    update(a.username, x => {
        if (!x.roblox) return;
        if (!r.ok) { x.roblox.error = r.error; return; }
        const u = r.user, now = Date.now();
        const stat = { t: now, followers: u.followers, following: u.following, friends: u.friends };
        Object.assign(x.roblox, { id: u.id, name: u.name, displayName: u.displayName, created: u.created, verified: u.verified, banned: u.banned, bio: u.bio, avatar: u.avatar, presence: u.presence, lastOnline: u.lastOnline, error: undefined });
        x.roblox.first ??= stat;
        x.roblox.last = stat;
        x.roblox.history = compact([...(x.roblox.history ?? []), stat]);
    });
}

/** Checks one account now (and its posts and Roblox, when asked or when it's time). */
export async function checkOne(username: string, { posts }: { posts?: boolean; } = {}): Promise<"ok" | "blocked" | "error"> {
    const a = getAccount(username);
    if (!a) return "error";
    const p = await checkProfile(a);
    if (p === "blocked") return p;
    await checkRoblox(a);
    const due = !a.lastPostsCheck || Date.now() - a.lastPostsCheck > opts.postsEveryHours * 3600_000;
    if (p === "ok" && !a.private && (posts ?? (opts.posts && due))) {
        await pause();
        if (await checkPosts(getAccount(username)!) === "blocked") return "blocked";
    }
    return p;
}

export async function checkAll(force = false) {
    if (progress.running) return;
    if (!force && Date.now() < progress.blockedUntil) return;
    const list = getAccounts().map(a => a.username);
    if (!list.length) return;
    stopFlag = false;
    Object.assign(progress, { running: true, done: 0, total: list.length, current: undefined });
    tell();
    try {
        for (const u of list) {
            if (stopFlag) break;
            progress.current = u; tell();
            const r = await checkOne(u);
            progress.done++; tell();
            if (r === "blocked") {
                // TikTok wants a break: leave the rest for later.
                progress.blockedUntil = Date.now() + 30 * 60_000;
                break;
            }
            await pause();
        }
    } finally {
        Object.assign(progress, { running: false, current: undefined, lastRun: Date.now() });
        tell();
    }
}

export const stopChecking = () => { stopFlag = true; };

let timer: ReturnType<typeof setInterval> | null = null;

export function startSchedule() {
    stopSchedule();
    const tick = () => {
        const oldest = Math.min(...getAccounts().map(a => a.lastCheck ?? 0));
        if (getAccounts().length && Date.now() - oldest >= opts.minutes * 60_000) void checkAll();
    };
    timer = setInterval(tick, 60_000);
    setTimeout(tick, 15_000);
}

export function stopSchedule() {
    if (timer) clearInterval(timer);
    timer = null;
    stopFlag = true;
}

/** Just the Roblox side (after its link was changed). */
export async function refreshRoblox(username: string) {
    const a = getAccount(username);
    if (a) await checkRoblox(a);
}

/** Just the posts, now. */
export async function refreshPosts(username: string) {
    const a = getAccount(username);
    if (a && !a.private) await checkPosts(a);
}
