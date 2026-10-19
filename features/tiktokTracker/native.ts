/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// TikTok Tracker's network side. Reads TikTok's public pages (the same ones a
// browser shows anyone, no login) and Roblox's public API. Done here because
// Discord's page isn't allowed to contact other sites. Only these hosts, and
// only a TikTok username / video ID or a Roblox ID / username go in.

import { CspPolicies, ImageSrc } from "@main/csp";
import { IpcMainInvokeEvent } from "electron";

// Lets TikTok avatars and covers, and Roblox headshots, show in Discord's window.
for (const host of ["*.tiktokcdn.com", "*.tiktokcdn-us.com", "*.tiktokcdn-eu.com", "*.ibyteimg.com", "*.byteimg.com", "*.rbxcdn.com"]) CspPolicies[host] = ImageSrc;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const USER = /^[a-z0-9._]{2,24}$/i;
const VIDEO = /^\d{15,21}$/;

type Fail = { ok: false; error: string; kind: "notfound" | "private" | "blocked" | "network" | "bad"; };

async function page(url: string): Promise<{ ok: true; html: string; } | Fail> {
    try {
        const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
        if (res.status === 404) return { ok: false, kind: "notfound", error: "Not found" };
        if (!res.ok) return { ok: false, kind: res.status === 429 || res.status === 403 ? "blocked" : "network", error: `TikTok answered ${res.status}` };
        return { ok: true, html: await res.text() };
    } catch (e) {
        return { ok: false, kind: "network", error: e instanceof Error ? e.message : "Couldn't connect" };
    }
}

function rehydration(html: string, scope: string): any | null {
    const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    try { return JSON.parse(m[1])?.__DEFAULT_SCOPE__?.[scope] ?? null; } catch { return null; }
}

const num = (...v: any[]) => { for (const x of v) { const n = Number(x); if (x != null && Number.isFinite(n)) return n; } return 0; };

export interface TikTokProfile {
    id: string; username: string; nickname: string; avatar: string; bio: string; verified: boolean; private: boolean;
    followers: number; following: number; likes: number; videos: number;
}

export async function tiktokProfile(_: IpcMainInvokeEvent, username: string): Promise<{ ok: true; profile: TikTokProfile; } | Fail> {
    if (!USER.test(username)) return { ok: false, kind: "bad", error: "That isn't a TikTok username" };
    const p = await page(`https://www.tiktok.com/@${username}?lang=en`);
    if (!p.ok) return p;
    const d = rehydration(p.html, "webapp.user-detail");
    // No data at all usually means TikTok showed a "verify you're human" page instead.
    if (!d) return { ok: false, kind: "blocked", error: "TikTok didn't send the profile (it may want a check) — trying again later" };
    if (d.statusCode === 10202 || d.statusCode === 10221 || !d.userInfo?.user) return { ok: false, kind: "notfound", error: "No TikTok account with that name (or it was banned)" };
    const u = d.userInfo.user, s = d.userInfo.statsV2 ?? {}, s1 = d.userInfo.stats ?? {};
    return {
        ok: true,
        profile: {
            id: String(u.id ?? ""), username: String(u.uniqueId ?? username).toLowerCase(), nickname: u.nickname ?? username,
            avatar: u.avatarMedium ?? u.avatarThumb ?? u.avatarLarger ?? "", bio: u.signature ?? "", verified: !!u.verified, private: !!u.privateAccount,
            followers: num(s.followerCount, s1.followerCount), following: num(s.followingCount, s1.followingCount),
            likes: num(s.heartCount, s.heart, s1.heartCount, s1.heart), videos: num(s.videoCount, s1.videoCount),
        },
    };
}

export interface TikTokPostRef { id: string; desc: string; cover: string; }

/** Their latest posts, from TikTok's public profile embed. */
export async function tiktokRecent(_: IpcMainInvokeEvent, username: string): Promise<{ ok: true; posts: TikTokPostRef[]; } | Fail> {
    if (!USER.test(username)) return { ok: false, kind: "bad", error: "That isn't a TikTok username" };
    const p = await page(`https://www.tiktok.com/embed/@${username}`);
    if (!p.ok) return p;
    const m = p.html.match(/<script id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return { ok: false, kind: "blocked", error: "TikTok didn't send their posts" };
    let list: any[] | null = null;
    try {
        const walk = (o: any, depth = 0): void => {
            if (list || !o || typeof o !== "object" || depth > 12) return;
            if (Array.isArray(o.videoList)) { list = o.videoList; return; }
            for (const v of Object.values(o)) walk(v, depth + 1);
        };
        walk(JSON.parse(m[1]));
    } catch { }
    if (!list) return { ok: true, posts: [] };
    return { ok: true, posts: (list as any[]).filter(v => VIDEO.test(String(v?.id))).map(v => ({ id: String(v.id), desc: String(v.desc ?? ""), cover: v.coverUrl ?? v.originCoverUrl ?? "" })) };
}

export interface TikTokPost { id: string; desc: string; cover: string; created: number; likes: number; views: number; comments: number; shares: number; saves: number; }

export async function tiktokVideo(_: IpcMainInvokeEvent, username: string, id: string): Promise<{ ok: true; post: TikTokPost; } | Fail> {
    if (!USER.test(username) || !VIDEO.test(id)) return { ok: false, kind: "bad", error: "Bad video" };
    const p = await page(`https://www.tiktok.com/@${username}/video/${id}?lang=en`);
    if (!p.ok) return p;
    const d = rehydration(p.html, "webapp.video-detail");
    if (!d) return { ok: false, kind: "blocked", error: "TikTok didn't send the video" };
    const it = d.itemInfo?.itemStruct;
    if (d.statusCode !== 0 || !it) return { ok: false, kind: "notfound", error: "This post was removed or made private" };
    const s = it.statsV2 ?? {}, s1 = it.stats ?? {};
    return {
        ok: true,
        post: {
            id, desc: it.desc ?? "", cover: it.video?.cover ?? it.video?.originCover ?? "", created: num(it.createTime) * 1000,
            likes: num(s.diggCount, s1.diggCount), views: num(s.playCount, s1.playCount), comments: num(s.commentCount, s1.commentCount),
            shares: num(s.shareCount, s1.shareCount), saves: num(s.collectCount, s1.collectCount),
        },
    };
}

/* ── Roblox (official public API) ───────────────────────────────────── */

export interface RobloxUser {
    id: number; name: string; displayName: string; created: string; verified: boolean; banned: boolean; bio: string;
    followers: number; following: number; friends: number; avatar: string;
    /** 0 offline, 1 online, 2 in a game, 3 in Studio. */
    presence: number; lastOnline: string | null;
}

async function json(url: string, body?: unknown): Promise<any> {
    const res = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json", "user-agent": UA }, body: JSON.stringify(body) } : { headers: { "user-agent": UA } });
    if (!res.ok) throw new Error(`Roblox answered ${res.status}`);
    return res.json();
}

export async function robloxUser(_: IpcMainInvokeEvent, input: string): Promise<{ ok: true; user: RobloxUser; } | { ok: false; error: string; }> {
    try {
        const text = String(input ?? "").trim();
        let id = Number(text.match(/roblox\.com\/users\/(\d+)/i)?.[1] ?? (/^\d{1,15}$/.test(text) ? text : NaN));
        if (!Number.isFinite(id)) {
            const name = text.replace(/^@/, "");
            if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return { ok: false, error: "Paste their Roblox profile link or username" };
            const r = await json("https://users.roblox.com/v1/usernames/users", { usernames: [name], excludeBannedUsers: false });
            id = r?.data?.[0]?.id;
            if (!id) return { ok: false, error: "No Roblox account with that name" };
        }
        const [u, followers, following, friends, thumb, pres] = await Promise.all([
            json(`https://users.roblox.com/v1/users/${id}`),
            json(`https://friends.roblox.com/v1/users/${id}/followers/count`).catch(() => null),
            json(`https://friends.roblox.com/v1/users/${id}/followings/count`).catch(() => null),
            json(`https://friends.roblox.com/v1/users/${id}/friends/count`).catch(() => null),
            json(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${id}&size=150x150&format=Png&isCircular=false`).catch(() => null),
            json("https://presence.roblox.com/v1/presence/users", { userIds: [id] }).catch(() => null),
        ]);
        const p = pres?.userPresences?.[0];
        return {
            ok: true,
            user: {
                id, name: u.name, displayName: u.displayName ?? u.name, created: u.created ?? "", verified: !!u.hasVerifiedBadge, banned: !!u.isBanned, bio: u.description ?? "",
                followers: num(followers?.count), following: num(following?.count), friends: num(friends?.count),
                avatar: thumb?.data?.[0]?.imageUrl ?? "", presence: num(p?.userPresenceType), lastOnline: p?.lastOnline ?? null,
            },
        };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Roblox" };
    }
}
