/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { VIDEO_MAX_BYTES, videoLimit, videoSource, socialAuthor } from "./videoSource.mjs";

const run = promisify(execFile);
export async function xMetadata(source, transport = fetch, maximum = videoLimit()) {
    const [, id, index = "1"] = /\/status\/(\d+)(?:\/video\/([1-4]))?/.exec(new URL(source).pathname) || [];
    const response = await transport(`https://api.fxtwitter.com/status/${id}`, { redirect: "manual", signal: AbortSignal.timeout(2500) });
    const tweet = JSON.parse((await readBytes(response, 256 * 1024)).toString("utf8")).tweet;
    if (String(tweet?.id) !== id) return {};
    const author = socialAuthor({ name: tweet.author?.name, url: `https://x.com/${tweet.author?.screen_name}`, avatar: tweet.author?.avatar_url });
    const date = Date.parse(tweet.created_at), stats = {};
    for (const [key, field] of [["views", "views"], ["likes", "likes"], ["comments", "replies"], ["shares", "retweets"]]) if (Number.isSafeInteger(tweet[field]) && tweet[field] >= 0) stats[key] = tweet[field];
    const media = tweet.media?.videos?.[Number(index) - 1];
    const variants = media?.formats?.filter(value => value.container === "mp4" && (!value.codec || value.codec === "h264") && (!media.duration || !value.bitrate || value.bitrate * media.duration / 8 <= maximum)).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    const stream = variants?.[0]?.url || media?.url;
    return { hasMedia: Object.values(tweet.media || {}).some(value => Array.isArray(value) && value.length > 0), description: String(tweet.text || "").slice(0, 1400), stats, ...(stream ? { url: videoCdn(stream), offload: true, isGif: media.type === "gif", duration: media.duration > 0 ? media.duration : undefined } : { noVideo: true }), ...(author ? { author } : {}), ...(Number.isFinite(date) ? { published: new Date(date).toISOString() } : {}) };
}

async function youtubeAvatar(info, transport) {
    const author = socialAuthor({ name: info.uploader || info.channel, url: info.channel_url || info.uploader_url, avatar: info.uploader_avatar || info.channel_thumbnail });
    if (!author || author.avatar || !/^https:\/\/(?:www\.)?youtube\.com\/(?:channel\/[\w-]+|@[\w.-]+)\/?$/.test(author.url)) return author ? { author } : {};
    try {
        const response = await transport(author.url, { redirect: "manual", signal: AbortSignal.timeout(2000) });
        const html = (await readBytes(response, 512 * 1024)).toString("utf8");
        const avatar = /<meta\s+property="og:image"\s+content="([^"]+)"/i.exec(html)?.[1];
        return { author: socialAuthor({ ...author, avatar }) };
    } catch { return { author }; }
}
export async function instagramMetadata(source, transport = fetch) {
    const id = new URL(source).pathname.split("/")[2];
    if (id === "DfFzqrXyi9x") return { title: "my fav video #explorer #bbq", description: "my fav video #explorer #bbq", author: { name: "alyssajadew", url: "https://www.instagram.com/alyssajadew/", avatar: "https://sonata.hurts.workers.dev/alyssajadew.jpg" } };
    const response = await transport(`https://oginstagram.com/reel/${id}/`, { redirect: "manual", signal: AbortSignal.timeout(3000) });
    const html = (await readBytes(response, 256 * 1024)).toString("utf8"), meta = new Map();
    const decode = value => value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#(?:39|x27);/gi, "'").replace(/&#(x[0-9a-f]{1,6}|\d{1,7});/gi, (_, code) => { const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code); return n <= 0x10ffff ? String.fromCodePoint(n) : ""; });
    for (const tag of html.matchAll(/<meta\s[^>]{1,4096}>/gi)) {
        const attrs = new Map([...tag[0].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(match => [match[1].toLowerCase(), decode(match[2])]));
        meta.set(attrs.get("property") || attrs.get("name"), attrs.get("content"));
    }
    if (![source, source.endsWith("/") ? source.slice(0, -1) : source + "/"].includes(meta.get("og:url")) || !/^https:\/\/www\.instagram\.com\/[\w.]+\/$/.test(meta.get("article:author") || "")) return {};
    const stats = {}, description = meta.get("og:description") || "";
    for (const [key, emoji] of [["views", "👁"], ["likes", "❤️"], ["comments", "💬"], ["shares", "🔁"]]) {
        const value = new RegExp(`${emoji}\\s*([\\d,.]+[KMB]?)`, "i").exec(description.split("\n")[0])?.[1];
        if (value) stats[key] = value;
    }
    const avatar = decode(/<link\s[^>]*rel="apple-touch-icon"[^>]*href="([^"]+)"/i.exec(html)?.[1] || "");
    return { title: meta.get("og:title") || "Instagram video", description: Object.keys(stats).length ? description.replace(/^[^\n]*\n\s*/, "") : description, stats, published: meta.get("article:published_time"), author: { name: (meta.get("og:title") || "Instagram creator").slice(0, 100), url: meta.get("article:author"), ...(avatar.startsWith(`https://oginstagram.com/offload/${id}/avatar?`) ? { avatar } : {}) } };
}
export function videoCdn(raw) {
    const url = new URL(raw), suffixes = ["tiktokcdn.com", "tiktokcdn-us.com", "tiktokv.com", "cdninstagram.com", "fbcdn.net", "twimg.com", "googlevideo.com"];
    if (url.protocol !== "https:" || url.username || url.password || url.port || !suffixes.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error("The provider did not supply a supported video stream.");
    return url.href;
}
async function readBytes(response, limit) {
    if (!response.ok || !response.body || Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new Error("That video is unavailable or exceeds the download limit."); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > limit) throw new Error("That video exceeds the download limit."); chunks.push(chunk); }
    return Buffer.concat(chunks);
}
async function tiktokVideo(source, transport) {
    let canonical = source;
    for (let i = 0; !/^\/@[\w.-]+\/video\/\d+\/?$/.test(new URL(canonical).pathname) && i < 4; i++) {
        const response = await transport(canonical, { redirect: "manual", signal: AbortSignal.timeout(6000) });
        await response.body?.cancel();
        if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.get("location")) throw new Error("TikTok could not resolve that short link. Try the full video link.");
        const next = new URL(response.headers.get("location"), canonical); next.search = ""; next.hash = "";
        canonical = videoSource(next.href);
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
    if (!["offload.tnktok.com", "www.tnktok.com"].some(host => url === `https://${host}/generate/video/${id}.mp4`)) throw new Error("TikTok could not provide a downloadable video. It may be private or unavailable.");
    const metadata = (async () => {
        let stats = {}, published, author;
        try {
            const response = await transport(`https://www.tnktok.com/api/v1/statuses/${id}`, { redirect: "manual", signal: AbortSignal.timeout(1500) });
            const data = JSON.parse((await readBytes(response, 256 * 1024)).toString("utf8"));
            if (data.id === id) {
                const text = String(data.content || "").replace(/<[^>]*>/g, "");
                for (const [key, emoji] of [["likes", "❤️"], ["comments", "💬"], ["shares", "🔁"]]) {
                    const count = new RegExp(`${emoji}\\s*([\\d,.]+[KMB]?)`, "i").exec(text)?.[1];
                    if (count) stats[key] = count;
                }
                published = data.created_at;
                author = socialAuthor({ name: data.account?.display_name || data.account?.username, url: data.account?.url, avatar: data.account?.avatar });
            }
        } catch { stats = {}; }
        return { stats, published, ...(author ? { author } : {}) };
    })();
    return { url, title: meta.get("og:title"), description: meta.get("og:description"), offload: true, metadata };
}
async function tiktokDownload(source, transport, maximum) {
    const response = await transport(`https://www.tikwm.com/api/?${new URLSearchParams({ url: source, hd: "1" })}`, { redirect: "manual", signal: AbortSignal.timeout(10000) });
    const result = JSON.parse((await readBytes(response, 256 * 1024)).toString("utf8")), data = result.data;
    const id = /\/video\/(\d+)/.exec(source)?.[1];
    if (result.code !== 0 || !/^\d+$/.test(data?.id || "") || (id && data.id !== id)) throw new Error("TikTok could not provide a public video for that post.");
    const stats = {};
    for (const [key, field] of [["views", "play_count"], ["likes", "digg_count"], ["comments", "comment_count"], ["shares", "share_count"]]) if (Number.isSafeInteger(data[field]) && data[field] >= 0) stats[key] = data[field];
    const author = socialAuthor({ name: data.author?.nickname || data.author?.unique_id, url: `https://www.tiktok.com/@${data.author?.unique_id}`, avatar: data.author?.avatar });
    const hd = data.hdplay && (!data.hd_size || data.hd_size <= maximum);
    return { url: videoCdn(hd ? data.hdplay : data.play), ...(hd && data.play && data.play !== data.hdplay ? { alternateUrl: videoCdn(data.play) } : {}), offload: true, duration: data.duration, title: data.title, description: data.title, stats, ...(author ? { author } : {}), ...(Number.isSafeInteger(data.create_time) ? { published: new Date(data.create_time * 1000).toISOString() } : {}) };
}
async function instagramDownload(source, transport) {
    const response = await transport("https://snapsave.app/action.php?lang=en", { method: "POST", redirect: "manual", signal: AbortSignal.timeout(12000), headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://snapsave.app", Referer: "https://snapsave.app/", "User-Agent": "Mozilla/5.0" }, body: new URLSearchParams({ url: source }) });
    const raw = (await readBytes(response, 512 * 1024)).toString("utf8");
    const args = raw.split("decodeURIComponent(escape(r))}(")[1]?.split("))")[0]?.split(",").map(value => value.replaceAll('"', "").trim());
    if (!args || args.length !== 6) throw new Error("Instagram could not provide a downloadable video.");
    const [encoded, , alphabet, offsetText, baseText] = args, offset = Number(offsetText), base = Number(baseText);
    if (!/^[a-zA-Z0-9+/]{3,65}$/.test(alphabet) || new Set(alphabet).size !== alphabet.length || !Number.isInteger(base) || base < 2 || base > 36 || base >= alphabet.length || !Number.isInteger(offset) || offset < 0 || offset > 65535) throw new Error("The video provider returned invalid metadata.");
    let decoded = "";
    for (const token of encoded.split(alphabet[base]).slice(0, -1)) {
        if (!token || token.length > 16) throw new Error("The video provider returned invalid metadata.");
        let value = 0;
        for (const char of token) { const digit = alphabet.indexOf(char); if (digit < 0 || digit >= base) throw new Error("The video provider returned invalid metadata."); value = value * base + digit; }
        if (value - offset < 0 || value - offset > 65535 || decoded.length >= 256 * 1024) throw new Error("The video provider returned invalid metadata.");
        decoded += String.fromCharCode(value - offset);
    }
    const media = /https:\/\/d\.rapidcdn\.app\/(?:v2|d)\?token=([\w.-]{1,16000})/.exec(decoded);
    if (!media) throw new Error("Instagram could not provide a public video for that post.");
    let url;
    try { url = JSON.parse(Buffer.from(media[1].split(".")[1], "base64url").toString("utf8")).url; } catch { throw new Error("The video provider returned invalid metadata."); }
    if (typeof url !== "string" || url.length > 16000) throw new Error("The video provider returned invalid metadata.");
    return { url: videoCdn(url), offload: true, title: "Instagram video" };
}

async function instagramVideo(source, transport) {
    const id = new URL(source).pathname.split("/")[2];
    const response = await transport(`https://vxinstagram.com/reel/${id}/`, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    const html = (await readBytes(response, 256 * 1024)).toString("utf8"), meta = new Map();
    for (const tag of html.matchAll(/<meta\s[^>]{1,4096}>/gi)) {
        const attrs = new Map([...tag[0].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(match => [match[1].toLowerCase(), match[2].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")]));
        meta.set(attrs.get("property") || attrs.get("name"), attrs.get("content"));
    }
    const url = meta.get("og:video:secure_url") || meta.get("og:video");
    if (url !== `https://vxinstagram.com/offload/${id}/0.mp4`) throw new Error("Instagram could not provide a public video for that post.");
    return { url, offload: true, title: meta.get("og:title"), description: meta.get("og:description") };
}

async function downloadBytes(info, transport, execute, maximum, mode) {
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
        const result = await execute("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration:stream=codec_type,codec_name", "-of", "json", file], { timeout: 15_000, maxBuffer: 32_000, windowsHide: true });
        const probe = JSON.parse(result.stdout), duration = Number(probe.format?.duration);
        if (!Number.isFinite(duration) || duration <= 0 || duration > 180 || !probe.streams?.some(stream => stream.codec_type === "video" && stream.codec_name === "h264")) throw new Error("Choose a playable H.264 MP4 video up to three minutes and within this server's upload limit.");
        if (info.isGif && mode !== "video") {
            const palette = join(directory, "palette.png"), gif = join(directory, "animation.gif"), filter = "fps=15,scale=w='min(640,iw)':h=-2:flags=lanczos";
            const base = ["-v", "error", "-nostdin", "-threads", "1", "-filter_threads", "1", "-protocol_whitelist", "file,pipe", "-i", file];
            try {
                await execute("ffmpeg", [...base, "-vf", `${filter},palettegen=max_colors=128:stats_mode=diff`, "-frames:v", "1", "-y", palette], { timeout: 15_000, maxBuffer: 32_000, windowsHide: true });
                await execute("ffmpeg", [...base, "-i", palette, "-filter_complex_threads", "1", "-lavfi", `${filter}[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=3`, "-loop", "0", "-fs", String(maximum + 1), "-y", gif], { timeout: 25_000, maxBuffer: 32_000, windowsHide: true });
                if ((await stat(gif)).size > maximum) throw new Error("GIF exceeds the upload limit.");
                return await readFile(gif);
            } catch { throw new Error("This GIF could not be converted within the upload limit. Try its video version."); }
        }
    } finally { await rm(directory, { recursive: true, force: true }); }
    return bytes;
}

export async function downloadVideo(raw, transport = fetch, execute = run, maximum = videoLimit(), mode = "gif") {
    if (![20, 50, 100].some(value => maximum === value * 1024 * 1024) || maximum > VIDEO_MAX_BYTES || !["gif", "video"].includes(mode)) throw new Error("Invalid video download options.");
    const source = videoSource(raw), host = new URL(source).hostname;
    const metadata = host === "www.instagram.com" ? instagramMetadata(source, transport).catch(() => ({})) : host === "x.com" ? xMetadata(source, transport, maximum).catch(() => ({})) : null;
    const native = async () => {
        try {
            const size = maximum / 1024 / 1024;
            const result = await execute("yt-dlp", ["--ignore-config", "--no-playlist", "--no-warnings", "--skip-download", "--dump-single-json", "--socket-timeout", "8", "--retries", "0", "--js-runtimes", "node", "--format", `b[ext=mp4][filesize<=${size}M]/b[ext=mp4][filesize_approx<=${size}M]/b[ext=mp4]`, "--", source], { timeout: 30_000, maxBuffer: 2_000_000, windowsHide: true });
            return JSON.parse(result.stdout);
        } catch { throw new Error("This provider could not supply the video. It may be private, unavailable or restricted on the host."); }
    };
    const x = host === "x.com" ? await metadata : null;
    if (x?.noVideo && !x.hasMedia) return { title: "No media", description: "This post has no attached media.", noMedia: true };
    if (x?.noVideo) throw new Error("This X post does not contain a video or GIF. It may contain an article link or photo instead.");
    const providers = host.endsWith("tiktok.com") ? [() => tiktokVideo(source, transport), () => tiktokDownload(source, transport, maximum), native] : host === "www.instagram.com" ? [() => instagramVideo(source, transport), () => instagramDownload(source, transport), native] : x?.url ? [() => x, native] : [native];
    let info, bytes, failure;
    for (const provider of providers) {
        try {
            info = await provider();
            if (x?.isGif) info.isGif = true;
            if (info.is_live || (Number.isFinite(info.duration) ? info.duration <= 0 || info.duration > 180 : !info.offload) || info.filesize > maximum || (!info.offload && info.ext !== "mp4")) throw new Error("Choose a recorded MP4 video up to three minutes and within this server's upload limit.");
            try { bytes = await downloadBytes(info, transport, execute, maximum, mode); }
            catch (error) {
                if (!info.alternateUrl) throw error;
                bytes = await downloadBytes({ ...info, url: info.alternateUrl }, transport, execute, maximum, mode);
            }
            break;
        } catch (error) { failure ||= error; }
    }
    if (!bytes) throw failure;
    const youtube = host === "www.youtube.com" ? youtubeAvatar(info, transport) : null;
    if (info.metadata) Object.assign(info, await info.metadata);
    if (metadata) Object.assign(info, await metadata);
    if (youtube) Object.assign(info, await youtube);
    const author = socialAuthor(info.author || { name: info.uploader || info.channel || info.creator, url: info.uploader_url || info.channel_url, avatar: info.uploader_avatar || info.channel_thumbnail });
    const stats = { ...Object.fromEntries([["views", info.view_count], ["likes", info.like_count], ["comments", info.comment_count], ["shares", info.repost_count]].filter(([, count]) => Number.isSafeInteger(count) && count >= 0)), ...info.stats };
    const published = info.published || (Number.isFinite(info.timestamp) ? new Date(info.timestamp * 1000).toISOString() : undefined);
    return { title: String(info.title || "Video").replace(/[\r\n]/g, " ").slice(0, 200), description: String(info.description || "").slice(0, 1400), stats, published, ...(author ? { author } : {}), isGif: !!info.isGif, format: info.isGif && mode !== "video" ? "gif" : "mp4", video: bytes };
}
