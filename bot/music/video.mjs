/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { videoSource } from "./videoSource.mjs";

const run = promisify(execFile), maximum = 8 * 1024 * 1024;
export function videoCdn(raw) {
    const url = new URL(raw), suffixes = ["tiktokcdn.com", "tiktokcdn-us.com", "tiktokv.com", "cdninstagram.com", "fbcdn.net", "twimg.com", "googlevideo.com"];
    if (url.protocol !== "https:" || url.username || url.password || url.port || !suffixes.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error("The provider did not supply a supported video stream.");
    return url.href;
}
async function readBytes(response, limit) {
    if (!response.ok || !response.body || Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new Error("That video is unavailable or exceeds the download limit (8 MB for videos)."); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > limit) throw new Error("That video exceeds the download limit."); chunks.push(chunk); }
    return Buffer.concat(chunks);
}
async function tiktokVideo(source, transport) {
    let canonical = source;
    for (let i = 0; new URL(canonical).hostname !== "www.tiktok.com" && i < 4; i++) {
        const response = await transport(canonical, { redirect: "manual", signal: AbortSignal.timeout(6000) });
        await response.body?.cancel();
        if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.get("location")) throw new Error("TikTok could not resolve that short link. Try the full video link.");
        canonical = videoSource(new URL(response.headers.get("location"), canonical).href);
    }
    const id = /\/video\/(\d+)/.exec(canonical)?.[1];
    if (!id) throw new Error("TikTok could not resolve that video link.");
    const response = await transport(canonical.replace("www.tiktok.com", "www.tnktok.com"), { redirect: "manual", signal: AbortSignal.timeout(8000) });
    const html = (await readBytes(response, 256 * 1024)).toString("utf8"), meta = new Map();
    for (const tag of html.matchAll(/<meta\s[^>]{1,4096}>/gi)) {
        const attrs = new Map([...tag[0].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(match => [match[1].toLowerCase(), match[2].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">") ]));
        meta.set(attrs.get("property") || attrs.get("name"), attrs.get("content"));
    }
    const url = meta.get("og:video");
    if (url !== `https://offload.tnktok.com/generate/video/${id}.mp4`) throw new Error("TikTok could not provide a downloadable video. It may be private or unavailable.");
    let stats = {}, published;
    try {
        const response = await transport(`https://offload.tnktok.com/api/v1/statuses/${id}`, { redirect: "manual", signal: AbortSignal.timeout(5000) });
        const data = JSON.parse((await readBytes(response, 256 * 1024)).toString("utf8"));
        if (data.id === id) {
            const text = String(data.content || "").replace(/<[^>]*>/g, "");
            for (const [key, emoji] of [["likes", "❤️"], ["comments", "💬"], ["shares", "🔁"]]) {
                const count = new RegExp(`${emoji}\\s*([\\d,.]+[KMB]?)`, "i").exec(text)?.[1];
                if (count) stats[key] = count;
            }
            published = data.created_at;
        }
    } catch { stats = {}; }
    return { url, title: meta.get("og:title"), description: meta.get("og:description"), offload: true, stats, published };
}
export async function downloadVideo(raw, transport = fetch, execute = run) {
    const source = videoSource(raw);
    let info;
    if (new URL(source).hostname.endsWith("tiktok.com")) info = await tiktokVideo(source, transport);
    else try {
        const result = await execute("yt-dlp", ["--ignore-config", "--no-playlist", "--no-warnings", "--skip-download", "--dump-single-json", "--socket-timeout", "8", "--retries", "0", "--js-runtimes", "node", "--format", "b[ext=mp4][height<=720][filesize<8M]/b[ext=mp4][height<=480]", "--", source], { timeout: 30_000, maxBuffer: 2_000_000, windowsHide: true });
        info = JSON.parse(result.stdout);
    } catch { throw new Error("This provider could not supply the video. It may be private, unavailable or restricted on the host."); }
    if (!info.offload && (info.is_live || !Number.isFinite(info.duration) || info.duration <= 0 || info.duration > 180 || info.filesize > maximum || info.ext !== "mp4")) throw new Error("Choose a recorded MP4 video up to three minutes and 8 MB.");
    let url = info.offload ? info.url : videoCdn(info.url), response;
    for (let i = 0; i < 4; i++) {
        response = await transport(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        await response.body?.cancel();
        if (!response.headers.get("location")) throw new Error("The video provider returned an incomplete redirect.");
        url = videoCdn(new URL(response.headers.get("location"), url).href);
    }
    const bytes = await readBytes(response, maximum);
    if (bytes.length < 12 || bytes.subarray(4, 8).toString() !== "ftyp") throw new Error("The provider did not return a playable MP4 video.");
    const directory = await mkdtemp(join(tmpdir(), "sonata-video-")), file = join(directory, "video.mp4");
    try {
        await writeFile(file, bytes);
        const result = await execute("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration:stream=codec_type,codec_name", "-of", "json", file], { timeout: 5000, maxBuffer: 32_000, windowsHide: true });
        const probe = JSON.parse(result.stdout), duration = Number(probe.format?.duration);
        if (!Number.isFinite(duration) || duration <= 0 || duration > 180 || !probe.streams?.some(stream => stream.codec_type === "video" && stream.codec_name === "h264")) throw new Error("Choose a playable H.264 MP4 video up to three minutes and 8 MB.");
    } finally { await rm(directory, { recursive: true, force: true }); }
    const stats = info.stats || Object.fromEntries([["views", info.view_count], ["likes", info.like_count], ["comments", info.comment_count], ["shares", info.repost_count]].filter(([, count]) => Number.isSafeInteger(count) && count >= 0));
    const published = info.published || (Number.isFinite(info.timestamp) ? new Date(info.timestamp * 1000).toISOString() : undefined);
    return { title: String(info.title || "Video").replace(/[\r\n]/g, " ").slice(0, 200), description: String(info.description || "").slice(0, 1400), stats, published, video: bytes.toString("base64") };
}
