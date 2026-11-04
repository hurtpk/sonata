/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const invalid = message => { throw new Error(message); };
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const videoLimit = guild => (guild?.premium_tier >= 3 ? 100 : guild?.premium_tier === 2 ? 50 : 20) * 1024 * 1024;

export function socialAuthor(value) {
    if (typeof value?.name !== "string" || !value.name.trim() || value.name.length > 100 || typeof value.url !== "string" || value.url.length > 500 || !/^https:\/\/(?:www\.)?(?:instagram\.com\/[\w.]+\/?|tiktok\.com\/@[\w.-]+\/?|(?:x|twitter)\.com\/[\w]+\/?|youtube\.com\/(?:channel\/[\w-]+|@[\w.-]+)\/?)$/.test(value.url || "")) return null;
    const author = { name: value.name, url: value.url };
    if (typeof value.avatar === "string" && value.avatar.length <= 1800) try {
        const url = new URL(value.avatar), hosts = ["cdninstagram.com", "fbcdn.net", "tiktokcdn.com", "tiktokcdn-us.com", "ibytedtos.com", "tiktokv.com", "ggpht.com", "googleusercontent.com"];
        if (url.protocol === "https:" && !url.username && !url.password && !url.port && (hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) || (url.hostname === "pbs.twimg.com" && url.pathname.startsWith("/profile_images/")) || (["offload.tnktok.com", "www.tnktok.com"].includes(url.hostname) && /^\/generate\/pfp\/\d+$/.test(url.pathname)) || (url.hostname === "sonata.hurts.workers.dev" && url.pathname === "/alyssajadew.jpg" && !url.search) || (url.hostname === "oginstagram.com" && /^\/offload\/[\w-]+\/avatar$/.test(url.pathname)))) author.avatar = url.href;
    } catch { return author; }
    return author;
}

export function videoSource(raw) {
    let url;
    try { url = new URL(raw); } catch { invalid("Use a public TikTok, Instagram, X or YouTube video link."); }
    if (url.protocol !== "https:" || url.username || url.password || url.port || raw.length > 500) invalid("Use a public HTTPS video link.");
    const host = url.hostname.replace(/^www\./, ""), path = url.pathname;
    if (host === "tiktok.com" && /^\/@[\w.-]+\/video\/\d+\/?$/.test(path)) return `https://www.tiktok.com${path}`;
    if (host === "tiktok.com" && /^\/t\/[\w-]+\/?$/.test(path)) return `https://www.tiktok.com${path}`;
    if (["vm.tiktok.com", "vt.tiktok.com"].includes(host) && /^\/[\w-]+\/?$/.test(path)) return `https://${host}${path}`;
    if (host === "instagram.com" && /^\/(?:reel|p)\/[\w-]+\/?$/.test(path)) return `https://www.instagram.com${path}`;
    if (["twitter.com", "x.com", "mobile.twitter.com", "m.twitter.com"].includes(host) && /^\/(?:[\w]+|i\/web)\/status\/\d+(?:\/video\/[1-4])?\/?$/.test(path)) return `https://x.com${path}`;
    const id = host === "youtu.be" ? path.slice(1) : ["youtube.com", "m.youtube.com"].includes(host) ? path === "/watch" ? url.searchParams.get("v") : /^\/shorts\/([\w-]{11})\/?$/.exec(path)?.[1] : null;
    if (/^[\w-]{11}$/.test(id || "")) return `https://www.youtube.com/watch?v=${id}`;
    invalid("Choose a public video post from TikTok, Instagram, X or YouTube.");
}
