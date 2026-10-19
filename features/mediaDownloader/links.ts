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
