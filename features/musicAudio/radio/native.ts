/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Radio's native side. Discord's page can't play audio from other sites (and
// many stations are plain http), so sound comes through a tiny player server
// that only this computer can reach (127.0.0.1), behind a random key:
//   • radio stations, found in Radio Browser's public directory
//   • your public SoundCloud likes, through yt-dlp (the same one Media
//     Downloader uses) and FFmpeg — copy-protected (DRM) tracks can't play
//   • music files on your computer that you picked
// Nothing is downloaded to keep; files are played from where they are.

import { CspPolicies } from "@main/csp";
import { ChildProcess, spawn } from "child_process";
import { randomBytes } from "crypto";
import { dialog, IpcMainInvokeEvent } from "electron";
import { createReadStream, existsSync, statSync } from "fs";
import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { AddressInfo } from "net";
import { basename, extname } from "path";
import { Readable } from "stream";

import { findFfmpeg, findYtDlp, kill } from "../../mediaDownloader/native";

// Discord's page may play sound (and show station logos) from the player server.
CspPolicies["http://127.0.0.1:*"] = [...new Set([...(CspPolicies["http://127.0.0.1:*"] ?? []), "img-src", "media-src"])];

const UA = "Sonata/2026 (+https://github.com/hurtpk/sonata)";
type Fail = { ok: false; error: string; };

/* ── Radio Browser: the station directory ── */

export interface Station { id: string; name: string; url: string; homepage?: string; logo?: string; country?: string; cc?: string; tags: string[]; codec?: string; bitrate?: number; votes?: number; }

let apiHost: string | null = null;
async function radioHost() {
    if (apiHost) return apiHost;
    try {
        const list: any[] = await (await fetch("https://all.api.radio-browser.info/json/servers", { headers: { "user-agent": UA } })).json();
        const names = [...new Set(list.map(s => s?.name).filter((n: unknown): n is string => typeof n === "string" && /\.api\.radio-browser\.info$/.test(n)))];
        apiHost = names[Math.floor(Math.random() * names.length)] ?? "de1.api.radio-browser.info";
    } catch { apiHost = "de1.api.radio-browser.info"; }
    return apiHost;
}

const str = (v: unknown, max = 200) => typeof v === "string" ? v.slice(0, max) : undefined;
const station = (s: any): Station => ({
    id: str(s.stationuuid, 64)!, name: (str(s.name, 120) ?? "Radio").trim(), url: str(s.url_resolved || s.url, 1000)!,
    homepage: str(s.homepage, 300), logo: /^https?:\/\//.test(s.favicon ?? "") ? str(s.favicon, 500) : undefined,
    country: str(s.country, 60), cc: str(s.countrycode, 2),
    tags: String(s.tags ?? "").split(",").map((t: string) => t.trim()).filter(Boolean).slice(0, 6),
    codec: str(s.codec, 12), bitrate: Number(s.bitrate) || undefined, votes: Number(s.votes) || undefined,
});

/** Stations: the most played, by genre, or by name. Only ones that work with a normal audio player. */
export async function radioStations(_: IpcMainInvokeEvent, by: "top" | "tag" | "name", value = ""): Promise<{ ok: true; stations: Station[]; } | Fail> {
    const v = String(value).trim().slice(0, 80);
    const host = await radioHost();
    const q = "limit=60&hidebroken=true&order=clickcount&reverse=true";
    const path = by === "top" ? "/json/stations/topclick/60?hidebroken=true"
        : by === "tag" ? `/json/stations/search?tag=${encodeURIComponent(v)}&tagExact=false&${q}`
            : `/json/stations/search?name=${encodeURIComponent(v)}&${q}`;
    try {
        const res = await fetch(`https://${host}${path}`, { headers: { "user-agent": UA, accept: "application/json" } });
        if (!res.ok) { apiHost = null; return { ok: false, error: `The station directory answered ${res.status}` }; }
        const list: any[] = await res.json();
        // HLS streams need a different player; the rest play straight away.
        return { ok: true, stations: list.filter(s => !s.hls && /^https?:\/\//.test(s.url_resolved || s.url)).map(station) };
    } catch {
        apiHost = null;
        return { ok: false, error: "Couldn't reach the station directory" };
    }
}

/** Tells the directory a station was played (it uses this to rank popular stations). */
export async function radioClicked(_: IpcMainInvokeEvent, id: string) {
    if (!/^[\w-]{8,64}$/.test(String(id))) return;
    try { await fetch(`https://${await radioHost()}/json/url/${id}`, { headers: { "user-agent": UA } }); } catch { }
}

/* ── SoundCloud, through yt-dlp ── */

export interface ScTrack { url: string; title: string; artist: string; id: string; }

const scUser = (input: string) => {
    const s = String(input ?? "").trim();
    const m = /^(?:https?:\/\/)?(?:www\.|m\.)?soundcloud\.com\/([\w-]{2,64})/i.exec(s) ?? /^@?([\w-]{2,64})$/.exec(s);
    return m?.[1] ?? null;
};

function run(cmd: string, args: string[], ms: number): Promise<{ code: number | null; out: string; err: string; }> {
    return new Promise(resolve => {
        const child = spawn(cmd, args, { windowsHide: true, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
        let out = "", err = "";
        const timer = setTimeout(() => { kill(child); resolve({ code: null, out, err: err || "It took too long." }); }, ms);
        child.stdout.setEncoding("utf8").on("data", d => { out += d; });
        child.stderr.setEncoding("utf8").on("data", d => { err += d; });
        child.on("error", e => { clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
        child.on("close", code => { clearTimeout(timer); resolve({ code, out, err }); });
    });
}

/** What's needed for SoundCloud: yt-dlp and FFmpeg. */
export function radioTools(_: IpcMainInvokeEvent) {
    return { ytdlp: !!findYtDlp(), ffmpeg: !!findFfmpeg() };
}

/** A SoundCloud profile's public likes (tracks only, newest first). */
export async function scLikes(_: IpcMainInvokeEvent, profile: string): Promise<{ ok: true; user: string; tracks: ScTrack[]; } | Fail> {
    const user = scUser(profile);
    if (!user) return { ok: false, error: "That doesn't look like a SoundCloud profile. Paste its link, like soundcloud.com/yourname." };
    const yt = findYtDlp();
    if (!yt) return { ok: false, error: "SoundCloud needs yt-dlp. Install it once with: winget install yt-dlp" };
    const r = await run(yt, ["--flat-playlist", "-J", "--playlist-end", "300", "--", `https://soundcloud.com/${user}/likes`], 120_000);
    if (r.code !== 0) {
        if (/404|not found/i.test(r.err)) return { ok: false, error: `There's no SoundCloud profile called “${user}”.` };
        return { ok: false, error: "Couldn't read those likes. They may be private — only public likes can be listed." };
    }
    try {
        const j = JSON.parse(r.out);
        const tracks: ScTrack[] = (j.entries ?? [])
            .filter((e: any) => typeof e?.url === "string" && !/\/sets\//.test(e.url))
            .map((e: any) => {
                const path = new URL(e.url).pathname.split("/").filter(Boolean);
                return { url: e.url, title: str(e.title, 200) ?? path[1] ?? "Track", artist: path[0] ?? "", id: String(e.id ?? e.url) };
            });
        return { ok: true, user, tracks };
    } catch {
        return { ok: false, error: "yt-dlp gave an answer that couldn't be read." };
    }
}

/* ── The player server ── */

let server: Server | null = null;
let base = "";
const key = randomBytes(18).toString("hex");
/** SoundCloud tracks ready to play: their stream address, found by yt-dlp. */
const scReady = new Map<string, { stream: string; at: number; }>();
/** Files you picked, by id. Only these can be played. */
const files = new Map<string, string>();
const AUDIO = /\.(mp3|m4a|aac|ogg|oga|opus|flac|wav|weba|webm)$/i;
const TYPES: Record<string, string> = { ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".flac": "audio/flac", ".wav": "audio/wav", ".weba": "audio/webm", ".webm": "audio/webm" };
const children = new Set<ChildProcess>();

function send(res: ServerResponse, code: number, text: string) {
    res.writeHead(code, { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*" });
    res.end(text);
}

async function relay(url: string, req: IncomingMessage, res: ServerResponse, onlyImages = false) {
    if (!/^https?:\/\//i.test(url)) return send(res, 400, "bad address");
    const stop = new AbortController();
    req.on("close", () => stop.abort());
    try {
        const r = await fetch(url, { headers: { "user-agent": UA, "icy-metadata": "0" }, signal: stop.signal, redirect: "follow" });
        const type = r.headers.get("content-type") ?? "";
        if (!r.ok || !r.body) return send(res, 502, `The station answered ${r.status}`);
        if (onlyImages && !/^image\//i.test(type)) return send(res, 415, "not a picture");
        if (!onlyImages && /mpegurl|x-scpls|text\/html/i.test(type)) return send(res, 415, "This station uses a kind of stream that can't be played here.");
        res.writeHead(200, { "content-type": type || "audio/mpeg", "cache-control": onlyImages ? "max-age=86400" : "no-store", "access-control-allow-origin": "*" });
        const body = Readable.fromWeb(r.body as any);
        body.on("error", () => res.destroy());
        body.pipe(res);
        res.on("close", () => body.destroy());
    } catch {
        if (!res.headersSent) send(res, 502, "Couldn't reach the station");
        else res.destroy();
    }
}

function soundcloud(id: string, req: IncomingMessage, res: ServerResponse) {
    const ready = scReady.get(id);
    const ff = findFfmpeg();
    if (!ready) return send(res, 404, "not ready");
    if (!ff) return send(res, 503, "SoundCloud needs FFmpeg");
    // SoundCloud sends its audio in small pieces; FFmpeg joins them into one MP3 the page can play.
    const child = spawn(ff, ["-hide_banner", "-loglevel", "error", "-i", ready.stream, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "-f", "mp3", "pipe:1"], { windowsHide: true });
    children.add(child);
    res.writeHead(200, { "content-type": "audio/mpeg", "cache-control": "no-store", "access-control-allow-origin": "*" });
    child.stdout.pipe(res);
    const end = () => { kill(child); children.delete(child); };
    req.on("close", end);
    child.on("close", () => { children.delete(child); res.end(); });
}

function file(id: string, req: IncomingMessage, res: ServerResponse) {
    const path = files.get(id);
    if (!path || !existsSync(path)) return send(res, 404, "That file isn't there any more.");
    const { size } = statSync(path);
    const type = TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
    // Ranges, so you can skip around in the song.
    const m = /bytes=(\d*)-(\d*)/.exec(String(req.headers.range ?? ""));
    if (m) {
        const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
        const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
        if (start >= size || start > end) { res.writeHead(416, { "content-range": `bytes */${size}` }); return res.end(); }
        res.writeHead(206, { "content-type": type, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "access-control-allow-origin": "*" });
        createReadStream(path, { start, end }).pipe(res);
        return;
    }
    res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes", "access-control-allow-origin": "*" });
    createReadStream(path).pipe(res);
}

function ensureServer(): Promise<string> {
    if (server && base) return Promise.resolve(base);
    return new Promise((resolve, reject) => {
        const s = createServer((req, res) => {
            const u = new URL(req.url ?? "/", "http://127.0.0.1");
            const [, k, what, id] = u.pathname.split("/");
            // Only Sonata knows the key, so nothing else on this computer can use the server.
            if (k !== key) return send(res, 403, "no");
            if (what === "radio") return void relay(u.searchParams.get("u") ?? "", req, res);
            if (what === "img") return void relay(u.searchParams.get("u") ?? "", req, res, true);
            if (what === "sc" && id) return soundcloud(id, req, res);
            if (what === "file" && id) return file(id, req, res);
            send(res, 404, "?");
        });
        s.on("error", reject);
        s.listen(0, "127.0.0.1", () => {
            server = s;
            base = `http://127.0.0.1:${(s.address() as AddressInfo).port}/${key}`;
            resolve(base);
        });
    });
}

/** Where to play from: the player server's address (with its key). */
export async function radioBase(_: IpcMainInvokeEvent): Promise<{ ok: true; base: string; } | Fail> {
    try { return { ok: true, base: await ensureServer() }; } catch (e: any) { return { ok: false, error: `The player couldn't start: ${e?.message ?? e}` }; }
}

/** Gets a SoundCloud track ready to play, or says why it can't be (copy-protected, private…). */
export async function scPrepare(_: IpcMainInvokeEvent, url: string): Promise<{ ok: true; id: string; duration?: number; } | Fail> {
    if (!/^https:\/\/(www\.|m\.)?soundcloud\.com\/[\w-]+\/[\w-]+/i.test(String(url))) return { ok: false, error: "That isn't a SoundCloud track." };
    const yt = findYtDlp();
    if (!yt) return { ok: false, error: "SoundCloud needs yt-dlp. Install it once with: winget install yt-dlp" };
    if (!findFfmpeg()) return { ok: false, error: "SoundCloud needs FFmpeg. It usually comes with yt-dlp — reinstall it with: winget install yt-dlp" };
    const r = await run(yt, ["-f", "bestaudio", "--print", "duration", "--print", "urls", "--no-warnings", "--", url], 60_000);
    if (r.code !== 0) {
        if (/drm/i.test(r.err)) return { ok: false, error: "This track is copy-protected (DRM), so it can only be played on SoundCloud." };
        if (/private|404|not found/i.test(r.err)) return { ok: false, error: "This track is private or was removed." };
        return { ok: false, error: "yt-dlp couldn't get this track." };
    }
    const [duration, stream] = r.out.trim().split(/\r?\n/);
    if (!/^https?:\/\//.test(stream ?? "")) return { ok: false, error: "yt-dlp couldn't get this track." };
    const id = randomBytes(8).toString("hex");
    scReady.set(id, { stream, at: Date.now() });
    for (const [k, v] of scReady) if (Date.now() - v.at > 6 * 3_600_000) scReady.delete(k);
    return { ok: true, id, duration: Number(duration) || undefined };
}

/* ── Your files ── */

export interface PickedFile { id: string; path: string; name: string; size: number; }

/** Lets you pick music files from your computer (they stay where they are). */
export async function musicPick(_: IpcMainInvokeEvent): Promise<PickedFile[]> {
    const r = await dialog.showOpenDialog({ title: "Add music to Radio", properties: ["openFile", "multiSelections"], filters: [{ name: "Music", extensions: ["mp3", "m4a", "aac", "ogg", "opus", "flac", "wav", "weba", "webm"] }] });
    if (r.canceled) return [];
    return r.filePaths.filter(p => AUDIO.test(p) && existsSync(p)).map(p => {
        const id = randomBytes(8).toString("hex");
        files.set(id, p);
        return { id, path: p, name: basename(p, extname(p)), size: statSync(p).size };
    });
}

/** Files picked before (saved by Radio): which are still there. Only these can be played. */
export function musicKnown(_: IpcMainInvokeEvent, list: PickedFile[]): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const f of Array.isArray(list) ? list.slice(0, 2000) : []) {
        if (typeof f?.id !== "string" || typeof f.path !== "string" || !AUDIO.test(f.path)) continue;
        const there = existsSync(f.path);
        if (there) files.set(f.id, f.path);
        out[f.id] = there;
    }
    return out;
}

/** Stops anything still playing through FFmpeg (when Radio stops). */
export function radioStopAll(_?: IpcMainInvokeEvent) {
    for (const c of children) kill(c);
    children.clear();
}
