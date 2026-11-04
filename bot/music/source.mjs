/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mediaInput, musicAttachment } from "./attachments.mjs";

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
    return { title: String(info.title ?? "Track").replace(/[\r\n]/g, " ").slice(0, 180), url, duration: info.duration, audio: audio.href, segmented: info.protocol?.includes("m3u8") === true, resolved: Date.now() };
}

export async function resolveAttachment(raw) {
    const file = musicAttachment(raw);
    const response = await fetch(file.url, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok || Number(response.headers.get("content-length")) !== file.size) throw new Error("This uploaded file is no longer available. Upload it again with play.");
    let info;
    try {
        const output = await run("ffprobe", ["-v", "error", ...mediaInput(file.url), "-show_entries", "format=duration,format_name:stream=codec_type", "-of", "json"], { timeout: 15_000, maxBuffer: 32_768, windowsHide: true });
        info = JSON.parse(output.stdout);
    } catch { throw new Error("This file could not be read as audio. Upload a valid MP3, WAV, MOV, MP4 or OGG file."); }
    const duration = Number(info.format?.duration);
    if (!info.streams?.some(stream => stream.codec_type === "audio") || !info.format?.format_name?.split(",").some(format => ["mp3", "wav", "mov", "mp4", "ogg"].includes(format))) throw new Error("The uploaded file must contain audio in MP3, WAV, MOV, MP4 or OGG format.");
    if (!Number.isFinite(duration) || duration <= 0 || duration > 7200) throw new Error("Choose a recorded file no longer than two hours.");
    return { title: file.filename, url: file.url, audio: file.url, duration, attachment: file, resolved: Date.now() };
}
