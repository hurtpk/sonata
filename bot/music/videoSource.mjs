/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const invalid = message => { throw new Error(message); };

export function videoSource(raw) {
    let url;
    try { url = new URL(raw); } catch { invalid("Use a public TikTok, Instagram, X or YouTube video link."); }
    if (url.protocol !== "https:" || url.username || url.password || url.port || raw.length > 500) invalid("Use a public HTTPS video link.");
    const host = url.hostname.replace(/^www\./, ""), path = url.pathname;
    if (host === "tiktok.com" && /^\/@[\w.-]+\/video\/\d+\/?$/.test(path)) return `https://www.tiktok.com${path}`;
    if (["vm.tiktok.com", "vt.tiktok.com"].includes(host) && /^\/[\w-]+\/?$/.test(path)) return `https://${host}${path}`;
    if (host === "instagram.com" && /^\/(?:reel|p)\/[\w-]+\/?$/.test(path)) return `https://www.instagram.com${path}`;
    if (["twitter.com", "x.com"].includes(host) && /^\/[\w]+\/status\/\d+\/?$/.test(path)) return `https://x.com${path}`;
    const id = host === "youtu.be" ? path.slice(1) : ["youtube.com", "m.youtube.com"].includes(host) ? path === "/watch" ? url.searchParams.get("v") : /^\/shorts\/([\w-]{11})\/?$/.exec(path)?.[1] : null;
    if (/^[\w-]{11}$/.test(id || "")) return `https://www.youtube.com/watch?v=${id}`;
    invalid("Choose a public video post from TikTok, Instagram, X or YouTube.");
}
