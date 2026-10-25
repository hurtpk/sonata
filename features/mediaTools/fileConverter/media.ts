/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Audio, video and animated images, through ffmpeg.wasm — the same ffmpeg
// Equicord's own Clip Upload uses, run in a worker on this computer. It's
// fetched (about 31 MB, from jsDelivr) the first time it's needed, then the
// browser keeps it; it's shut down again after a minute and a half of
// nothing to do, so it doesn't sit in memory.

import type { FFmpeg } from "@ffmpeg/ffmpeg";
import constJs from "file://../../../../../../node_modules/@ffmpeg/ffmpeg/dist/esm/const.js";
import errorsJs from "file://../../../../../../node_modules/@ffmpeg/ffmpeg/dist/esm/errors.js";
import workerJs from "file://../../../../../../node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js";

import { extOf } from "./formats";

const CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";
const IDLE_MS = 90_000;

/** ffmpeg's worker, its two helper files folded in (a worker made from a blob can't import its neighbours). */
const WORKER_SOURCE = [constJs, errorsJs, workerJs].map(s => s.replace(/^import [^;]+;\s*$/gm, "").replace(/^export\s+/gm, "")).join("\n");

let ff: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
let idle: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;
const log: string[] = [];

export type Status = (text: string, progress?: number) => void;

async function load(status: Status): Promise<FFmpeg> {
    if (ff?.loaded) return ff;
    loading ??= (async () => {
        status("Getting the converter ready — about 31 MB the first time, then it's instant…");
        const { FFmpeg } = await import("@ffmpeg/ffmpeg");
        const instance = new FFmpeg();
        const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
        try {
            await instance.load({ coreURL: `${CORE}/ffmpeg-core.js`, wasmURL: `${CORE}/ffmpeg-core.wasm`, classWorkerURL: url });
            instance.on("log", ({ message }) => { log.push(message); if (log.length > 400) log.splice(0, 200); });
            ff = instance;
            return instance;
        } catch (e) {
            instance.terminate();
            throw new Error(`Couldn't start the converter: ${e instanceof Error ? e.message : e}`);
        } finally {
            URL.revokeObjectURL(url);
            loading = null;
        }
    })();
    return loading;
}

function stopSoon() {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => { ff?.terminate(); ff = null; idle = null; }, IDLE_MS);
}

export function shutdown() {
    if (idle) clearTimeout(idle);
    idle = null;
    ff?.terminate();
    ff = null;
}

export interface Output { name: string; data: Uint8Array; }

/**
 * Runs ffmpeg on one input. `args` uses "{in}" for the input file and ends
 * with the output name(s); outputs matching `collect` (a prefix) are all
 * returned (for frame sequences).
 */
export function runFfmpeg(input: Blob, inputName: string, build: (inName: string, id: number) => { args: string[]; outputs?: string[]; collect?: string; }, status: Status, duration?: number): Promise<Output[]> {
    const job = queue.then(async () => {
        if (idle) clearTimeout(idle);
        const f = await load(status);
        const id = ++counter;
        const inName = `in_${id}.${extOf(inputName) || "bin"}`;
        await f.writeFile(inName, new Uint8Array(await input.arrayBuffer()));
        const { args, outputs = [], collect } = build(inName, id);
        const onProgress = ({ progress, time }: { progress: number; time: number; }) => {
            // ffmpeg's own progress is unreliable for some inputs; work it out from the time when we know the length.
            const p = duration ? Math.min(1, time / 1e6 / duration) : progress;
            if (p >= 0 && p <= 1) status("Converting…", p);
        };
        f.on("progress", onProgress);
        log.length = 0;
        status("Converting…", 0);
        try {
            const code = await f.exec(args);
            const names = collect ? (await f.listDir("/")).filter(n => !n.isDir && n.name.startsWith(collect)).map(n => n.name).sort() : outputs;
            const out: Output[] = [];
            for (const name of names) {
                try {
                    const data = await f.readFile(name);
                    if (data instanceof Uint8Array && data.byteLength) out.push({ name, data });
                } catch { }
                await f.deleteFile(name).catch(() => { });
            }
            if (!out.length) throw new Error(code ? explain(log) : "The converter didn't produce anything");
            return out;
        } finally {
            f.off("progress", onProgress);
            await f.deleteFile(inName).catch(() => { });
            stopSoon();
        }
    });
    queue = job.catch(() => { });
    return job;
}

/**
 * A whole job with ffmpeg — several files, several runs (the Video Editor uses
 * this). Waits its turn like every other conversion; `run` gets ffmpeg itself,
 * why the last run failed, and the log so far (handing it over clears it). Files it writes should be deleted
 * by `run`. Stopping it early: `shutdown()`.
 */
export function withFfmpeg<T>(run: (f: FFmpeg, why: () => string, takeLog: () => string[]) => Promise<T>, status: Status): Promise<T> {
    const job = queue.then(async () => {
        if (idle) clearTimeout(idle);
        const f = await load(status);
        log.length = 0;
        try {
            return await run(f, () => explain(log), () => log.splice(0));
        } finally {
            stopSoon();
        }
    });
    queue = job.catch(() => { });
    return job;
}

/** ffmpeg's last useful complaint, in fewer words. */
function explain(lines: string[]) {
    const bad = [...lines].reverse().find(l => /error|invalid|not supported|unknown|could not|no such|does not contain/i.test(l) && !/^\s*configuration/i.test(l));
    if (!bad) return "The converter couldn't handle this file";
    if (/does not contain any stream|Output file .* does not contain/i.test(bad)) return "There's nothing of that kind in this file (e.g. a video without sound)";
    if (/Invalid data found/i.test(bad)) return "This file looks damaged, or isn't what its name says";
    return bad.trim().slice(0, 200);
}

/** How long a file plays, in seconds (null if it doesn't say). */
export function probeDuration(input: Blob, inputName: string, status: Status): Promise<number | null> {
    const job = queue.then(async () => {
        if (idle) clearTimeout(idle);
        const f = await load(status);
        const name = `probe_${++counter}.${extOf(inputName) || "bin"}`;
        await f.writeFile(name, new Uint8Array(await input.arrayBuffer()));
        log.length = 0;
        try {
            // ffmpeg prints "Duration: 00:01:23.45" while reading the file; asking for no output makes it stop there.
            await f.exec(["-hide_banner", "-i", name, "-t", "0", "-f", "null", "-"]).catch(() => { });
            const m = log.find(l => /Duration: \d/.test(l))?.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
            return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
        } finally {
            await f.deleteFile(name).catch(() => { });
            stopSoon();
        }
    });
    queue = job.catch(() => { });
    return job.catch(() => null);
}

// ─── What to ask ffmpeg for ───

export interface MediaOptions {
    /** "high" | "medium" | "small". */
    quality: "high" | "medium" | "small";
    /** Largest width in pixels (0 = keep). */
    maxWidth: number;
    /** Seconds; 0 = from the start / to the end. */
    start: number;
    end: number;
    /** Frames a second for GIF / animated WebP. */
    fps: number;
    mute: boolean;
}

export const DEFAULT_MEDIA: MediaOptions = { quality: "medium", maxWidth: 0, start: 0, end: 0, fps: 15, mute: false };

const even = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
const widthFilter = (w: number) => w ? `scale='min(${w},iw)':-2` : "";
const chain = (...f: string[]) => f.filter(Boolean).join(",");

function trim(o: MediaOptions) {
    const a: string[] = [];
    if (o.start > 0) a.push("-ss", String(o.start));
    if (o.end > 0 && o.end > o.start) a.push("-t", String(o.end - o.start));
    return a;
}

const CRF = { high: 19, medium: 23, small: 29 };
const VP9 = { high: 28, medium: 33, small: 40 };
const AUDIO_K = { high: 256, medium: 160, small: 96 };

/** ffmpeg arguments for converting to `target`, after "-i in". */
export function argsFor(target: string, o: MediaOptions, outName: string): string[] {
    const v = chain(widthFilter(o.maxWidth), even);
    const a = o.mute ? ["-an"] : [];
    const gifW = o.maxWidth || 480;
    switch (target) {
        case "mp3": return ["-vn", "-c:a", "libmp3lame", "-q:a", o.quality === "high" ? "0" : o.quality === "medium" ? "2" : "5", outName];
        case "wav": return ["-vn", "-c:a", "pcm_s16le", outName];
        case "flac": return ["-vn", "-c:a", "flac", outName];
        case "ogg": return ["-vn", "-c:a", "libvorbis", "-q:a", o.quality === "high" ? "8" : o.quality === "medium" ? "5" : "2", outName];
        case "opus": return ["-vn", "-c:a", "libopus", "-b:a", `${AUDIO_K[o.quality] * 0.6 | 0}k`, outName];
        case "m4a": return ["-vn", "-c:a", "aac", "-b:a", `${AUDIO_K[o.quality]}k`, outName];
        case "webm-audio": return ["-vn", "-c:a", "libopus", "-b:a", `${AUDIO_K[o.quality] * 0.6 | 0}k`, "-f", "webm", outName];
        case "mp4": case "mov": case "mkv":
            return ["-vf", v, "-c:v", "libx264", "-preset", "veryfast", "-crf", String(CRF[o.quality]), "-pix_fmt", "yuv420p", ...(o.mute ? a : ["-c:a", "aac", "-b:a", `${AUDIO_K[o.quality]}k`]), ...(target === "mp4" ? ["-movflags", "+faststart"] : []), outName];
        case "webm":
            return ["-vf", v, "-c:v", "libvpx-vp9", "-crf", String(VP9[o.quality]), "-b:v", "0", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", ...(o.mute ? a : ["-c:a", "libopus", "-b:a", `${AUDIO_K[o.quality] * 0.6 | 0}k`]), outName];
        case "avi": return ["-vf", v, "-c:v", "mpeg4", "-q:v", o.quality === "high" ? "2" : o.quality === "medium" ? "4" : "8", ...(o.mute ? a : ["-c:a", "libmp3lame", "-q:a", "4"]), outName];
        case "gif":
            return ["-vf", `fps=${o.fps},scale='min(${gifW},iw)':-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff${o.quality === "small" ? ":max_colors=128" : ""}[p];[b][p]paletteuse=dither=${o.quality === "small" ? "bayer:bayer_scale=4" : "sierra2_4a"}`, "-loop", "0", outName];
        case "webp-anim":
            return ["-vf", `fps=${o.fps},scale='min(${o.maxWidth || 512},iw)':-1`, "-c:v", "libwebp", "-lossless", "0", "-q:v", o.quality === "high" ? "85" : o.quality === "medium" ? "70" : "50", "-loop", "0", "-an", outName];
        case "frame": return ["-frames:v", "1", outName];
        default: throw new Error(`Can't make ${target} files`);
    }
}

/** A full ffmpeg conversion of one file. */
export async function convertMedia(file: File, target: string, ext: string, o: MediaOptions, status: Status, duration?: number | null): Promise<Uint8Array> {
    const [out] = await runFfmpeg(file, file.name, (n, id) => {
        const name = `out_${id}.${ext}`;
        return { args: ["-hide_banner", ...trim(o), "-i", n, ...argsFor(target, o, name)], outputs: [name] };
    }, status, (duration ?? 0) > 0 ? Math.max(0.1, (o.end || duration!) - o.start) : undefined);
    return out.data;
}

/** Every frame (animated images) or one a second (videos), as PNGs. */
export async function extractFrames(file: File, everyFrame: boolean, o: MediaOptions, status: Status): Promise<{ name: string; data: Uint8Array; }[]> {
    return runFfmpeg(file, file.name, (n, id) => ({
        args: ["-hide_banner", ...trim(o), "-i", n, "-vf", chain(everyFrame ? "" : "fps=1", widthFilter(o.maxWidth)) || "null", ...(everyFrame ? ["-vsync", "0"] : []), `frame_${id}_%04d.png`],
        collect: `frame_${id}_`,
    }), status);
}

/** Squeezes a video or sound under a size, from its length. */
export async function fitUnder(file: File, kind: "video" | "audio" | "animated", maxBytes: number, status: Status): Promise<{ data: Uint8Array; ext: string; }> {
    const duration = await probeDuration(file, file.name, status);
    if (kind === "animated") {
        // A GIF made smaller step by step: fewer frames a second, then smaller.
        for (const [w, fps] of [[480, 15], [400, 12], [320, 12], [256, 10], [200, 10], [160, 8]] as const) {
            const data = await convertMedia(file, "gif", "gif", { ...DEFAULT_MEDIA, maxWidth: w, fps, quality: w < 300 ? "small" : "medium" }, status, duration);
            if (data.byteLength <= maxBytes) return { data, ext: "gif" };
        }
        throw new Error("Couldn't get it small enough — try making it shorter first");
    }
    if (!duration) throw new Error("Couldn't tell how long it is, so can't aim for a size");
    // Aim a little under, then check: file headers and the encoder's rounding can push it over.
    for (let attempt = 0, aim = 0.93; attempt < 4; attempt++, aim *= 0.85) {
        const totalKbps = maxBytes * 8 / 1000 / duration * aim;
        const data = kind === "audio" ? await fitAudio(file, totalKbps, status, duration) : await fitVideo(file, totalKbps, duration, status);
        if (data.byteLength <= maxBytes) return { data, ext: kind === "audio" ? "mp3" : "mp4" };
        status("A little too big — trying again smaller…");
    }
    throw new Error("Couldn't get it small enough — try trimming it first");
}

async function fitAudio(file: File, totalKbps: number, status: Status, duration: number) {
    const k = Math.max(8, Math.min(320, Math.floor(totalKbps)));
    const [out] = await runFfmpeg(file, file.name, (n, id) => ({ args: ["-hide_banner", "-i", n, "-vn", "-c:a", "libmp3lame", "-b:a", `${k}k`, `fit_${id}.mp3`], outputs: [`fit_${id}.mp3`] }), status, duration);
    return out.data;
}

async function fitVideo(file: File, totalKbps: number, duration: number, status: Status) {
    const audioK = totalKbps > 600 ? 128 : totalKbps > 250 ? 64 : 32;
    const videoK = Math.floor(totalKbps - audioK);
    if (videoK < 60) throw new Error(`It's too long to fit (${Math.round(duration)} s) — try trimming it first`);
    // Lower bitrates look better smaller.
    const width = videoK > 2500 ? 1920 : videoK > 1200 ? 1280 : videoK > 600 ? 854 : videoK > 300 ? 640 : 426;
    const [out] = await runFfmpeg(file, file.name, (n, id) => ({
        args: ["-hide_banner", "-i", n, "-vf", chain(widthFilter(width), even), "-c:v", "libx264", "-preset", "veryfast", "-b:v", `${videoK}k`, "-maxrate", `${Math.round(videoK * 1.15)}k`, "-bufsize", `${videoK * 2}k`,
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", `${audioK}k`, "-movflags", "+faststart", `fit_${id}.mp4`],
        outputs: [`fit_${id}.mp4`],
    }), status, duration);
    return out.data;
}

/** Moving pictures for stickers, emoji, avatars and banners: a GIF of an exact size, under a byte limit. */
export async function animatedFor(file: File, w: number, h: number, mode: "cover" | "contain", maxBytes: number, status: Status): Promise<Uint8Array> {
    const size = mode === "cover"
        ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
        : `scale=${w}:${h}:force_original_aspect_ratio=decrease`;
    for (const [fps, colors] of [[15, 256], [12, 192], [10, 128], [8, 96], [6, 64]] as const) {
        const [out] = await runFfmpeg(file, file.name, (n, id) => ({
            args: ["-hide_banner", "-t", "15", "-i", n, "-vf", `fps=${fps},${size}:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:reserve_transparent=1:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`, "-loop", "0", `anim_${id}.gif`],
            outputs: [`anim_${id}.gif`],
        }), status);
        if (!maxBytes || out.data.byteLength <= maxBytes) return out.data;
    }
    throw new Error("Couldn't get it small enough — try a shorter clip");
}

/** Voice-message ready: Opus at 48 kHz, mono. */
export async function voiceReady(file: File, status: Status): Promise<Uint8Array> {
    const [out] = await runFfmpeg(file, file.name, (n, id) => ({ args: ["-hide_banner", "-i", n, "-vn", "-c:a", "libopus", "-b:a", "64k", "-ar", "48000", "-ac", "1", `voice_${id}.ogg`], outputs: [`voice_${id}.ogg`] }), status);
    return out.data;
}

/** Images Chromium can't open itself (like TIFF), turned into PNG by ffmpeg. */
export async function imageToPng(file: File, status: Status): Promise<Blob> {
    const [out] = await runFfmpeg(file, file.name, (n, id) => ({ args: ["-hide_banner", "-i", n, "-frames:v", "1", `img_${id}.png`], outputs: [`img_${id}.png`] }), status);
    return new Blob([out.data as BlobPart], { type: "image/png" });
}

/**
 * Evens out how loud it is: to about −14 LUFS, the level most music and video
 * apps use, without clipping. For video only the sound is re-done; the picture
 * is copied as it is.
 */
export async function louder(file: File, kind: "audio" | "video", status: Status): Promise<{ data: Uint8Array; ext: string; }> {
    const duration = await probeDuration(file, file.name, status);
    const inExt = extOf(file.name);
    const filter = ["-af", "loudnorm=I=-14:TP=-1.0:LRA=11"];
    let ext: string, codec: string[];
    if (kind === "video") {
        ext = inExt === "webm" ? "webm" : inExt === "mkv" ? "mkv" : "mp4";
        codec = ["-c:v", "copy", ...(ext === "webm" ? ["-c:a", "libopus", "-b:a", "160k"] : ["-c:a", "aac", "-b:a", "192k"])];
    } else {
        ext = ["wav", "flac", "ogg", "opus", "m4a"].includes(inExt) ? (inExt === "opus" ? "ogg" : inExt) : "mp3";
        codec = ext === "wav" ? ["-c:a", "pcm_s16le"] : ext === "flac" ? ["-c:a", "flac"] : ext === "ogg" ? ["-c:a", "libopus", "-b:a", "160k"] : ext === "m4a" ? ["-c:a", "aac", "-b:a", "192k"] : ["-c:a", "libmp3lame", "-b:a", "192k"];
    }
    const [out] = await runFfmpeg(file, file.name, (n, id) => ({ args: ["-hide_banner", "-i", n, ...filter, ...codec, "-ar", "48000", `loud_${id}.${ext}`], outputs: [`loud_${id}.${ext}`] }), status, duration ?? undefined);
    return { data: out.data, ext };
}
