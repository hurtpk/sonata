/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Which links get "Download video or audio" when you right-click a message.
// yt-dlp knows far more sites than these (any link can be pasted in the
// window); these are the common ones worth offering in the menu.

const SITES: [RegExp, string][] = [
    [/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/, "YouTube"],
    [/(^|\.)music\.youtube\.com$/, "YouTube Music"],
    [/(^|\.)(soundcloud\.com|snd\.sc)$/, "SoundCloud"],
    [/(^|\.)(tiktok\.com)$/, "TikTok"],
    [/(^|\.)(instagram\.com)$/, "Instagram"],
    [/(^|\.)(twitter\.com|x\.com|fxtwitter\.com|vxtwitter\.com|fixupx\.com)$/, "X"],
    [/(^|\.)(reddit\.com|redd\.it|v\.redd\.it)$/, "Reddit"],
    [/(^|\.)(twitch\.tv)$/, "Twitch"],
    [/(^|\.)(vimeo\.com)$/, "Vimeo"],
    [/(^|\.)(bandcamp\.com)$/, "Bandcamp"],
    [/(^|\.)(facebook\.com|fb\.watch)$/, "Facebook"],
    [/(^|\.)(pinterest\.[a-z.]+|pin\.it)$/, "Pinterest"],
    [/(^|\.)(bilibili\.com|b23\.tv)$/, "Bilibili"],
    [/(^|\.)(dailymotion\.com|dai\.ly)$/, "Dailymotion"],
    [/(^|\.)(streamable\.com)$/, "Streamable"],
    [/(^|\.)(kick\.com)$/, "Kick"],
    [/(^|\.)(threads\.net)$/, "Threads"],
    [/(^|\.)(bsky\.app)$/, "Bluesky"],
    [/(^|\.)(tumblr\.com)$/, "Tumblr"],
    [/(^|\.)(mixcloud\.com)$/, "Mixcloud"],
    [/(^|\.)(audiomack\.com)$/, "Audiomack"],
    [/(^|\.)(rumble\.com)$/, "Rumble"],
    [/(^|\.)(medal\.tv)$/, "Medal"],
    [/(^|\.)(imgur\.com)$/, "Imgur"],
    [/(^|\.)(nicovideo\.jp)$/, "Niconico"],
];

const URL_RE = /https?:\/\/[^\s<>()"']+/g;

/** The site a link is on, if it's one of the common ones. */
export function siteOf(url: string) {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return SITES.find(([re]) => re.test(host))?.[1] ?? null;
    } catch { return null; }
}

export const isSpotify = (url: string) => { try { return /(^|\.)spotify\.com$/.test(new URL(url).hostname); } catch { return false; } };

/** The downloadable links in a message: in its text, and in its embeds. */
export function linksIn(message: any): { url: string; site: string; }[] {
    const found = new Set<string>(message?.content?.match(URL_RE) ?? []);
    for (const e of message?.embeds ?? []) for (const u of [e.url, e.video?.url]) if (typeof u === "string") found.add(u);
    return [...found].map(url => ({ url: url.replace(/[.,!?)]+$/, ""), site: siteOf(url) })).filter((l): l is { url: string; site: string; } => !!l.site);
}

/** Links that are (or include) a playlist, album, set or channel — worth asking yt-dlp what's in them. */
export function looksLikePlaylist(url: string) {
    try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase(), path = u.pathname.toLowerCase();
        if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return u.searchParams.has("list") || path.startsWith("/playlist") || /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)(\/(videos|shorts|streams|playlists))?\/?$/.test(path);
        if (/(^|\.)soundcloud\.com$/.test(host)) return path.includes("/sets/") || /^\/[^/]+\/?(tracks|likes)?\/?$/.test(path);
        if (/(^|\.)bandcamp\.com$/.test(host)) return path.startsWith("/album/") || path === "/" || path === "/music";
        if (/(^|\.)vimeo\.com$/.test(host)) return /\/(showcase|album|channels)\//.test(path);
        if (/(^|\.)mixcloud\.com$/.test(host)) return /\/playlists\//.test(path);
        return /playlist|\/album\/|\/sets\//.test(path) || u.searchParams.has("list");
    } catch { return false; }
}

/** The single video in a playlist link like youtube.com/watch?v=…&list=… (null when it's only a playlist). */
export function singleIn(url: string) {
    try {
        const u = new URL(url);
        return u.searchParams.has("v") || /(^|\.)youtu\.be$/.test(u.hostname) ? url : null;
    } catch { return null; }
}
