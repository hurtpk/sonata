/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export function musicSource(raw) {
    const value = String(raw).trim();
    if (!value || value.length > 200 || /[\x00-\x1f]/.test(value)) throw new Error("Use a SoundCloud or YouTube link, or a short track search.");
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.includes("://") && !/^(?:www\.|[\\/.])/.test(value)) return `scsearch1:${value}`;
    let url;
    try { url = new URL(value); } catch { throw new Error("Use a full SoundCloud or YouTube track link."); }
    if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Use a public HTTPS SoundCloud or YouTube track link.");
    if (["soundcloud.com", "www.soundcloud.com"].includes(url.hostname) && /^\/[\w-]+\/[\w-]+\/?$/.test(url.pathname)) return `https://soundcloud.com${url.pathname.replace(/\/$/, "")}`;
    const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : ["youtube.com", "www.youtube.com", "music.youtube.com"].includes(url.hostname) ? url.pathname === "/watch" ? url.searchParams.get("v") : /^\/(?:shorts|live)\/([\w-]{11})$/.exec(url.pathname)?.[1] : null;
    if (!/^[\w-]{11}$/.test(id ?? "")) throw new Error("Use a SoundCloud track or YouTube video link, rather than a playlist or another website.");
    return `https://www.youtube.com/watch?v=${id}`;
}

export async function resolveTrack(raw) {
    const source = musicSource(raw);
    let output;
    try {
        output = await run("yt-dlp", ["--ignore-config", "--cache-dir", "/tmp/yt-dlp", "--no-playlist", "--no-warnings", "--skip-download", "--dump-single-json", "--socket-timeout", "10", "--retries", "1", "--js-runtimes", "node", "--format", "bestaudio/best", "--", source], { timeout: 22_000, maxBuffer: 2_000_000, windowsHide: true });
    } catch { throw new Error(source.startsWith("https://www.youtube.com/") ? "YouTube could not provide this video from the music host. Try a SoundCloud link or a song-name search instead." : "SoundCloud could not provide this track. Try another public track or a more specific search."); }
    let info;
    try { info = JSON.parse(output.stdout); } catch { throw new Error("The track lookup returned an unreadable response."); }
    info = info.entries?.[0] ?? info;
    if (!info || info.is_live || !Number.isFinite(info.duration) || info.duration <= 0 || info.duration > 7200) throw new Error("Choose a recorded track no longer than two hours.");
    let audio;
    try { audio = new URL(info.url); } catch { throw new Error("The provider did not supply an audio stream."); }
    const soundcloud = info.extractor === "soundcloud", id = info.id;
    const allowed = soundcloud ? [".sndcdn.com", ".soundcloud.com", ".soundcloud.cloud"].some(suffix => audio.hostname.endsWith(suffix)) : audio.hostname.endsWith(".googlevideo.com") && /^[\w-]{11}$/.test(id);
    if (audio.protocol !== "https:" || audio.username || audio.password || audio.port || !allowed) throw new Error("The provider did not supply a supported audio stream.");
    const url = soundcloud ? musicSource(info.webpage_url) : `https://www.youtube.com/watch?v=${id}`;
    return { title: String(info.title ?? "Track").replace(/[\r\n]/g, " ").slice(0, 180), url, duration: info.duration, audio: audio.href, resolved: Date.now() };
}
