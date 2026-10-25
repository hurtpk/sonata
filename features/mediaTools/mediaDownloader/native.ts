/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Media Downloader's native side: runs yt-dlp — which you installed yourself
// (winget install yt-dlp) — to look links up and download them, and FFmpeg
// (which winget installs with it) for MP3s and joining HD video with its sound.
// Sonata never downloads or updates either program; it only finds them.
//
// Every link goes to yt-dlp as a single argument after "--", with no shell in
// between, so nothing in a link can be read as an option or a command.

import { ChildProcess, spawn } from "child_process";
import { app, dialog, IpcMainInvokeEvent, shell } from "electron";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "fs";
import { readFile } from "fs/promises";
import { basename, dirname, join } from "path";

type Fail = { ok: false; error: string; };

/* ── Finding yt-dlp and FFmpeg ── */

/** Where winget puts things: a "Links" folder, and each package's own folder. */
function wingetPlaces(exe: string, pkg: RegExp) {
    const base = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet");
    const found = [join(base, "Links", exe)];
    try {
        for (const dir of readdirSync(join(base, "Packages"))) {
            if (!pkg.test(dir)) continue;
            const root = join(base, "Packages", dir);
            found.push(join(root, exe));
            // FFmpeg's package keeps it a folder or two down (ffmpeg-<version>/bin).
            try { for (const sub of readdirSync(root)) found.push(join(root, sub, exe), join(root, sub, "bin", exe)); } catch { }
        }
    } catch { }
    return found;
}

function onPath(exe: string) {
    for (const dir of (process.env.PATH ?? "").split(";")) {
        if (!dir) continue;
        const p = join(dir, exe);
        if (existsSync(p)) return p;
    }
    return null;
}

const firstThatExists = (paths: (string | null)[]) => paths.find(p => p && existsSync(p)) ?? null;

export function findYtDlp() {
    if (process.platform !== "win32") return firstThatExists(["/usr/local/bin/yt-dlp", "/opt/homebrew/bin/yt-dlp", "/usr/bin/yt-dlp"]);
    return firstThatExists([onPath("yt-dlp.exe"), ...wingetPlaces("yt-dlp.exe", /^yt-dlp\.yt-dlp_/i)]);
}

export function findFfmpeg() {
    if (process.platform !== "win32") return firstThatExists(["/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/bin/ffmpeg"]);
    return firstThatExists([onPath("ffmpeg.exe"), ...wingetPlaces("ffmpeg.exe", /ffmpeg/i)]);
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; out: string; err: string; }> {
    return new Promise(resolve => {
        const child = spawn(cmd, args, { windowsHide: true, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
        let out = "", err = "";
        const timer = setTimeout(() => { kill(child); resolve({ code: null, out, err: err || "It took too long to answer." }); }, timeoutMs);
        child.stdout.setEncoding("utf8").on("data", d => { out += d; });
        child.stderr.setEncoding("utf8").on("data", d => { err += d; });
        child.on("error", e => { clearTimeout(timer); resolve({ code: -1, out, err: String(e.message) }); });
        child.on("close", code => { clearTimeout(timer); resolve({ code, out, err }); });
    });
}

export function kill(child: ChildProcess) {
    if (!child.pid || child.exitCode != null) return;
    // On Windows, also stop the FFmpeg it may have started.
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else child.kill("SIGTERM");
}

const defaultFolder = () => join(app.getPath("downloads"), "Sonata");

/** The last useful line of what yt-dlp said went wrong, without its "ERROR:" and site tag. */
function reason(err: string) {
    const line = err.split(/\r?\n/).reverse().find(l => /ERROR/.test(l)) ?? err.split(/\r?\n/).filter(Boolean).pop() ?? "";
    const text = line.replace(/^.*?ERROR:\s*/, "").replace(/^\[[^\]]+\]\s*[\w-]+:\s*/, "").trim();
    if (/sign in|login|log in|cookies/i.test(text)) return "This one needs you to be signed in to the site, so it can't be downloaded.";
    if (/private/i.test(text)) return "This post is private.";
    if (/unsupported url/i.test(text)) return "yt-dlp doesn't know how to download from this link.";
    if (/drm/i.test(text)) return "This is copy-protected (DRM), so it can't be downloaded.";
    return text.slice(0, 300) || "yt-dlp couldn't download this.";
}

const okUrl = (url: unknown): url is string => typeof url === "string" && /^https?:\/\/\S+$/i.test(url) && url.length < 2000;
const isSpotify = (url: string) => /^https?:\/\/([a-z0-9-]+\.)*spotify\.com\//i.test(url);

/* ── What's installed ── */

export async function dlCheck(_: IpcMainInvokeEvent) {
    const ytdlp = findYtDlp();
    const ffmpeg = findFfmpeg();
    let version: string | null = null;
    if (ytdlp) {
        const r = await run(ytdlp, ["--version"], 15_000);
        version = r.code === 0 ? r.out.trim() : null;
    }
    return { ytdlp, version, ffmpeg, folder: defaultFolder() };
}

/* ── Looking a link up ── */

export async function dlInfo(_: IpcMainInvokeEvent, url: string) {
    if (!okUrl(url)) return { ok: false, error: "That doesn't look like a link." } satisfies Fail;
    if (isSpotify(url)) return { ok: false, error: "Spotify songs are copy-protected (DRM), so they can't be downloaded." } satisfies Fail;
    const ytdlp = findYtDlp();
    if (!ytdlp) return { ok: false, error: "yt-dlp isn't installed." } satisfies Fail;
    const r = await run(ytdlp, ["-J", "--no-playlist", "--no-warnings", "--skip-download", "--encoding", "utf-8", "--", url], 60_000);
    if (r.code !== 0) return { ok: false, error: reason(r.err) } satisfies Fail;
    try {
        const j = JSON.parse(r.out);
        const formats: any[] = Array.isArray(j.formats) ? j.formats : [];
        const heights = [...new Set(formats.map(f => f.height).filter((h: any) => typeof h === "number" && h > 0))].sort((a, b) => b - a);
        const hasVideo = formats.some(f => f.vcodec && f.vcodec !== "none") || heights.length > 0 || (!formats.length && !!j.height);
        return {
            ok: true as const,
            info: {
                title: String(j.title ?? j.fulltitle ?? "Untitled"),
                uploader: j.uploader ?? j.channel ?? j.creator ?? null,
                duration: typeof j.duration === "number" ? j.duration : null,
                thumbnail: j.thumbnail ?? j.thumbnails?.at?.(-1)?.url ?? null,
                site: j.extractor_key ?? j.extractor ?? null,
                url: j.webpage_url ?? url,
                heights,
                hasVideo,
                isLive: !!j.is_live,
            },
        };
    } catch {
        return { ok: false, error: "Couldn't read what yt-dlp found." } satisfies Fail;
    }
}

/** What's in a playlist (or album, set, channel) — titles and links only, nothing downloaded. Null when the link isn't one. */
export async function dlPlaylist(_: IpcMainInvokeEvent, url: string) {
    if (!okUrl(url)) return { ok: false, error: "That doesn't look like a link." } satisfies Fail;
    if (isSpotify(url)) return { ok: false, error: "Spotify songs are copy-protected (DRM), so they can't be downloaded." } satisfies Fail;
    const ytdlp = findYtDlp();
    if (!ytdlp) return { ok: false, error: "yt-dlp isn't installed." } satisfies Fail;
    const r = await run(ytdlp, ["-J", "--flat-playlist", "--yes-playlist", "--playlist-end", "500", "--no-warnings", "--encoding", "utf-8", "--", url], 120_000);
    if (r.code !== 0) return { ok: false, error: reason(r.err) } satisfies Fail;
    try {
        const j = JSON.parse(r.out);
        if (j._type !== "playlist" || !Array.isArray(j.entries)) return { ok: true as const, list: null };
        const entries = (j.entries as any[]).filter(Boolean).map((e, n) => {
            const link = typeof e.url === "string" && /^https?:\/\//i.test(e.url) ? e.url
                : typeof e.webpage_url === "string" ? e.webpage_url
                    : e.ie_key === "Youtube" && e.id ? `https://www.youtube.com/watch?v=${e.id}` : null;
            return link && okUrl(link) ? {
                key: String(e.id ?? n),
                title: String(e.title ?? `Item ${n + 1}`),
                url: link,
                duration: typeof e.duration === "number" ? e.duration : null,
                thumbnail: e.thumbnails?.at?.(-1)?.url ?? e.thumbnail ?? null,
                uploader: e.uploader ?? e.channel ?? null,
            } : null;
        }).filter(Boolean);
        return {
            ok: true as const,
            list: {
                title: String(j.title ?? "Playlist"),
                uploader: j.uploader ?? j.channel ?? null,
                // "YoutubeTab" is yt-dlp's name for a YouTube playlist or channel.
                site: (j.extractor_key ?? j.extractor ?? null)?.replace(/Tab$/, "") ?? null,
                count: typeof j.playlist_count === "number" ? j.playlist_count : entries.length,
                entries,
            },
        };
    } catch {
        return { ok: false, error: "Couldn't read what yt-dlp found." } satisfies Fail;
    }
}

/* ── Downloading ── */

export interface DlOptions { mode: "video" | "audio"; quality: number; audio: "mp3" | "original"; folder?: string; }
export interface Job { status: "starting" | "downloading" | "processing" | "done" | "error" | "cancelled"; percent: number; speed: string; eta: string; file?: string; size?: number; error?: string; }

const jobs = new Map<string, { job: Job; child: ChildProcess | null; }>();

function argsFor(url: string, o: DlOptions, folder: string, ffmpeg: string | null) {
    const args = [
        "--newline", "--progress", "--no-playlist", "--no-warnings", "--encoding", "utf-8", "--windows-filenames",
        "--progress-template", "download:SONATA %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
        "--print", "before_dl:SONATANAME %(filename)s",
        "--print", "after_move:SONATAFILE %(filepath)s",
        "-P", folder, "-o", "%(title).120B [%(id)s].%(ext)s",
    ];
    if (ffmpeg) args.push("--ffmpeg-location", ffmpeg);
    if (o.mode === "audio") {
        if (ffmpeg && o.audio === "mp3") args.push("-f", "ba/b", "-x", "--audio-format", "mp3", "--audio-quality", "0", "--embed-metadata", "--embed-thumbnail");
        else args.push("-f", "ba[ext=m4a]/ba/b", ...(ffmpeg ? ["--embed-metadata"] : []));
    } else {
        // Prefer H.264 MP4, which plays everywhere (including in Discord), at or under the height picked.
        const sort = [o.quality ? `res:${o.quality}` : "res", "vcodec:h264", "acodec:aac", "ext:mp4:m4a"].join(",");
        args.push("-S", sort);
        if (ffmpeg) args.push("-f", "bv*+ba/b", "--merge-output-format", "mp4", "--embed-metadata");
        else args.push("-f", "b[ext=mp4]/b");
    }
    args.push("--", url);
    return args;
}

export function dlStart(_: IpcMainInvokeEvent, id: string, url: string, o: DlOptions): { ok: true; } | Fail {
    if (!okUrl(url)) return { ok: false, error: "That doesn't look like a link." };
    if (isSpotify(url)) return { ok: false, error: "Spotify songs are copy-protected (DRM), so they can't be downloaded." };
    if (typeof id !== "string" || !/^[\w-]{1,40}$/.test(id) || jobs.has(id)) return { ok: false, error: "Bad download id." };
    const ytdlp = findYtDlp();
    if (!ytdlp) return { ok: false, error: "yt-dlp isn't installed." };
    const folder = typeof o.folder === "string" && o.folder ? o.folder : defaultFolder();
    try { mkdirSync(folder, { recursive: true }); } catch { return { ok: false, error: "Couldn't make the download folder." }; }

    const job: Job = { status: "starting", percent: 0, speed: "", eta: "" };
    const child = spawn(ytdlp, argsFor(url, o, folder, findFfmpeg()), { windowsHide: true, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
    jobs.set(id, { job, child });
    let err = "", buf = "";
    /** The file it's downloading to, without its extension — to tidy up half-downloaded pieces after a cancel. */
    let base = "";

    const blank = (v?: string) => !v || /^(unknown|N\/?A)$/i.test(v);
    const line = (l: string) => {
        // A cancelled download keeps printing for a moment before it stops.
        if (job.status === "cancelled") return;
        if (l.startsWith("SONATANAME ")) {
            base = l.slice(11).trim().replace(/\.[^.\\/]+$/, "");
        } else if (l.startsWith("SONATA ")) {
            const [pct, speed, eta] = l.slice(7).split("|").map(s => s.trim());
            const n = parseFloat(pct);
            if (!isNaN(n)) job.percent = Math.max(job.percent, Math.min(100, n));
            job.speed = blank(speed) ? "" : speed;
            job.eta = blank(eta) ? "" : eta;
            job.status = "downloading";
        } else if (l.startsWith("SONATAFILE ")) {
            job.file = l.slice(11).trim();
        } else if (/^\[(Merger|ExtractAudio|EmbedThumbnail|Metadata|FixupM3u8|VideoConvertor|ThumbnailsConvertor)\]/.test(l)) {
            job.status = "processing";
        }
    };
    child.stdout.setEncoding("utf8").on("data", (d: string) => {
        buf += d;
        const parts = buf.split(/\r?\n/);
        buf = parts.pop() ?? "";
        parts.forEach(line);
    });
    child.stderr.setEncoding("utf8").on("data", (d: string) => { err += d; if (err.length > 20_000) err = err.slice(-10_000); });
    child.on("error", e => { job.status = "error"; job.error = String(e.message); });
    child.on("close", code => {
        if (buf) line(buf);
        const entry = jobs.get(id);
        if (entry) entry.child = null;
        if (job.status === "cancelled") { tidy(base); return; }
        if (code === 0 && job.file) {
            job.status = "done";
            job.percent = 100;
            try { job.size = statSync(job.file).size; } catch { }
        } else {
            job.status = "error";
            job.error = reason(err) || "The download stopped.";
        }
    });
    return { ok: true };
}

/** After a cancel: remove the half-downloaded pieces (".part", ".ytdl", and video or sound waiting to be joined) — never a finished file. */
function tidy(base: string) {
    if (!base) return;
    const dir = dirname(base), name = basename(base);
    // Wait a moment: on Windows the files stay locked until yt-dlp has fully stopped.
    setTimeout(() => {
        try {
            for (const f of readdirSync(dir)) {
                if (!f.startsWith(name)) continue;
                const rest = f.slice(name.length);
                if (/\.part$|\.ytdl$|^\.f\d+\.\w+$|\.temp\.\w+$/i.test(rest)) rmSync(join(dir, f), { force: true });
            }
        } catch { }
    }, 1500);
}

/** Where every download is up to (finished ones are kept until they've been read once). */
export function dlProgress(_: IpcMainInvokeEvent) {
    const out: Record<string, Job> = {};
    for (const [id, { job }] of jobs) {
        out[id] = { ...job };
        if (job.status === "done" || job.status === "error" || job.status === "cancelled") jobs.delete(id);
    }
    return out;
}

export function dlCancel(_: IpcMainInvokeEvent, id: string) {
    const entry = jobs.get(id);
    if (!entry) return false;
    entry.job.status = "cancelled";
    if (entry.child) kill(entry.child);
    return true;
}

/* ── Afterwards ── */

const isFile = (p: unknown): p is string => typeof p === "string" && p.length > 3 && existsSync(p) && statSync(p).isFile();

export function dlReveal(_: IpcMainInvokeEvent, path: string) {
    if (isFile(path)) shell.showItemInFolder(path);
    else if (typeof path === "string" && existsSync(path)) void shell.openPath(path);
}

export async function dlOpen(_: IpcMainInvokeEvent, path: string) {
    if (isFile(path)) await shell.openPath(path);
}

export async function dlPickFolder(_: IpcMainInvokeEvent, current?: string) {
    const r = await dialog.showOpenDialog({ title: "Where should downloads go?", defaultPath: current || defaultFolder(), properties: ["openDirectory", "createDirectory"] });
    return r.canceled ? null : r.filePaths[0] ?? null;
}

/** A finished file's bytes, to attach it to a message (up to 500 MB, Discord's biggest limit). */
export async function dlReadFile(_: IpcMainInvokeEvent, path: string) {
    if (!isFile(path)) return null;
    if (statSync(path).size > 500 * 1048576) return null;
    return new Uint8Array(await readFile(path));
}
