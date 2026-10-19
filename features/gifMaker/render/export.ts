/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Turning the frames into a file: GIF (with see-through pixels when
// needed), animated WebP, or a video. With a size target it keeps
// re-encoding — fewer colours, then fewer frames, then smaller — until the
// file fits.

import { sleep } from "@utils/misc";
import { applyPalette, GIFEncoder, quantize } from "gifenc";

import type { EditState } from "../types";
import { renderFrame } from "./frame";
import type { Source } from "./source";
import type { OutFrame, Timeline } from "./timeline";

export interface Encoded {
    blob: Blob;
    width: number;
    height: number;
    frames: number;
    ext: string;
    /** What had to change to fit the size target, in words. */
    shrunk?: string;
}

export interface Cancel { cancelled: boolean; }

interface Plan { scale: number; colors: number; skip: number; quality: number; }

export const SIZE_TARGETS: { value: number; label: string; }[] = [
    { value: 0, label: "Any size" },
    { value: 10 * 1024 * 1024, label: "Under 10 MB (Discord's limit)" },
    { value: 500 * 1024, label: "Under 500 KB (sticker)" },
    { value: 256 * 1024, label: "Under 256 KB (emoji)" },
];

export const formatBytes = (n: number) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/** Drops every other frame (or more), keeping the timing. */
function skipFrames(frames: OutFrame[], skip: number): OutFrame[] {
    if (skip <= 1) return frames;
    const out: OutFrame[] = [];
    for (let i = 0; i < frames.length; i += skip) {
        const group = frames.slice(i, i + skip);
        out.push({ ...group[0], delay: group.reduce((a, f) => a + f.delay, 0) });
    }
    return out;
}

function progressOf(frames: OutFrame[]) {
    const total = frames.reduce((a, f) => a + f.delay, 0) || 1;
    let at = 0;
    return frames.map(f => { const p = at / total; at += f.delay; return p; });
}

async function encodeGif(src: Source, s: EditState, frames: OutFrame[], plan: Plan, cancel: Cancel, onProgress?: (k: number) => void): Promise<Encoded | null> {
    const canvas = document.createElement("canvas");
    const ps = progressOf(frames);
    const draw = (i: number) => {
        renderFrame(canvas, src, s, { t: frames[i].t, index: frames[i].base, p: ps[i] }, { scale: plan.scale });
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };

    // Pass 1: a palette from a sample of frames (and whether anything is see-through).
    const step = Math.max(1, Math.floor(frames.length / 24));
    const samples: Uint8ClampedArray[] = [];
    let alpha = false;
    for (let i = 0; i < frames.length; i += step) {
        const d = draw(i);
        if (!alpha) for (let j = 3; j < d.length; j += 16) if (d[j] < 128) { alpha = true; break; }
        samples.push(d);
        if (cancel.cancelled) return null;
    }
    const joined = new Uint8ClampedArray(samples.reduce((a, d) => a + d.length, 0));
    let off = 0;
    for (const d of samples) { joined.set(d, off); off += d.length; }
    const format = alpha ? "rgba4444" : "rgb565";
    const palette = quantize(joined, plan.colors, alpha ? { format, oneBitAlpha: true } : { format });
    const transparentIndex = alpha ? palette.findIndex(c => c[3] === 0) : -1;

    // Pass 2: every frame.
    const gif = GIFEncoder();
    for (let i = 0; i < frames.length; i++) {
        const d = draw(i);
        gif.writeFrame(applyPalette(d, palette, format), canvas.width, canvas.height, {
            palette: i === 0 ? palette : undefined,
            delay: Math.max(20, Math.round(frames[i].delay)),
            transparent: transparentIndex >= 0,
            transparentIndex: Math.max(0, transparentIndex),
            // See-through GIFs must clear each frame, or old frames show through.
            dispose: transparentIndex >= 0 ? 2 : -1,
        });
        onProgress?.((i + 1) / frames.length);
        if (i % 6 === 5) { await sleep(0); if (cancel.cancelled) return null; }
    }
    gif.finish();
    const bytes = gif.bytesView();
    return { blob: new Blob([bytes.slice()], { type: "image/gif" }), width: canvas.width, height: canvas.height, frames: frames.length, ext: "gif" };
}

// ─── Animated WebP ───
// Chrome can only make still WebPs, so each frame is made as one and they're
// stitched into an animated file by hand (RIFF: VP8X + ANIM + one ANMF per frame).

const u24 = (n: number) => [n & 255, n >> 8 & 255, n >> 16 & 255];
const u32 = (n: number) => [n & 255, n >> 8 & 255, n >> 16 & 255, n >>> 24 & 255];
const fourcc = (s: string) => [...s].map(c => c.charCodeAt(0));

function chunk(id: string, payload: Uint8Array | number[]) {
    const body = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
    const out = new Uint8Array(8 + body.length + (body.length & 1));
    out.set(fourcc(id), 0);
    out.set(u32(body.length), 4);
    out.set(body, 8);
    return out;
}

/** The ALPH + VP8/VP8L chunks of a still WebP. */
function frameChunks(webp: Uint8Array) {
    const parts: Uint8Array[] = [];
    let alpha = false;
    let off = 12;
    while (off + 8 <= webp.length) {
        const id = String.fromCharCode(...webp.subarray(off, off + 4));
        const size = webp[off + 4] | webp[off + 5] << 8 | webp[off + 6] << 16 | webp[off + 7] << 24;
        const end = off + 8 + size + (size & 1);
        if (id === "ALPH" || id === "VP8 " || id === "VP8L") parts.push(webp.subarray(off, end));
        if (id === "ALPH") alpha = true;
        if (id === "VP8L" && webp[off + 8 + 4] & 0x10) alpha = true;
        off = end;
    }
    return { parts, alpha };
}

const concat = (arrays: Uint8Array[]) => {
    const out = new Uint8Array(arrays.reduce((a, b) => a + b.length, 0));
    let o = 0;
    for (const a of arrays) { out.set(a, o); o += a.length; }
    return out;
};

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
    new Promise<Blob>((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error("Couldn't encode a frame")), type, quality));

async function encodeWebp(src: Source, s: EditState, frames: OutFrame[], plan: Plan, cancel: Cancel, onProgress?: (k: number) => void): Promise<Encoded | null> {
    const canvas = document.createElement("canvas");
    const ps = progressOf(frames);
    const anmf: Uint8Array[] = [];
    let anyAlpha = false;
    for (let i = 0; i < frames.length; i++) {
        renderFrame(canvas, src, s, { t: frames[i].t, index: frames[i].base, p: ps[i] }, { scale: plan.scale });
        const still = new Uint8Array(await (await toBlob(canvas, "image/webp", plan.quality)).arrayBuffer());
        const { parts, alpha } = frameChunks(still);
        anyAlpha ||= alpha;
        const header = [...u24(0), ...u24(0), ...u24(canvas.width - 1), ...u24(canvas.height - 1), ...u24(Math.round(frames[i].delay)), 0b10];
        anmf.push(chunk("ANMF", concat([Uint8Array.from(header), ...parts])));
        onProgress?.((i + 1) / frames.length);
        if (cancel.cancelled) return null;
    }
    const vp8x = chunk("VP8X", [0x02 | (anyAlpha ? 0x10 : 0), 0, 0, 0, ...u24(canvas.width - 1), ...u24(canvas.height - 1)]);
    const anim = chunk("ANIM", [0, 0, 0, 0, 0, 0]);
    const body = concat([Uint8Array.from(fourcc("WEBP")), vp8x, anim, ...anmf]);
    const file = concat([Uint8Array.from([...fourcc("RIFF"), ...u32(body.length)]), body]);
    return { blob: new Blob([file], { type: "image/webp" }), width: canvas.width, height: canvas.height, frames: frames.length, ext: "webp" };
}

// ─── Video ───

export const videoType = () => ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find(t => MediaRecorder.isTypeSupported(t)) ?? "video/webm";

async function encodeVideo(src: Source, s: EditState, frames: OutFrame[], plan: Plan, target: number, cancel: Cancel, onProgress?: (k: number) => void): Promise<Encoded | null> {
    const work = document.createElement("canvas");
    const ps = progressOf(frames);
    renderFrame(work, src, s, { t: frames[0].t, index: frames[0].base, p: 0 }, { scale: plan.scale, opaque: true });
    // Video encoders need even sizes, so frames are copied onto an even canvas.
    const canvas = document.createElement("canvas");
    canvas.width = work.width + (work.width & 1);
    canvas.height = work.height + (work.height & 1);
    const out = canvas.getContext("2d")!;
    const type = videoType();
    const total = frames.reduce((a, f) => a + f.delay, 0);
    // Very short clips are played a few times so the video isn't over in a blink.
    const loops = Math.max(1, Math.min(4, Math.ceil(2000 / Math.max(1, total))));
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    const bits = target ? Math.max(150_000, target * 8 / (total * loops / 1000) * 0.85) : 6_000_000 * plan.scale;
    const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: Math.round(bits) });
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>(res => recorder.onstop = () => res());
    recorder.start();
    let done = 0;
    for (let loop = 0; loop < loops; loop++) {
        for (let i = 0; i < frames.length; i++) {
            if (cancel.cancelled) { recorder.stop(); track.stop(); return null; }
            const started = performance.now();
            renderFrame(work, src, s, { t: frames[i].t, index: frames[i].base, p: ps[i] }, { scale: plan.scale, opaque: true });
            out.fillStyle = "#000";
            out.fillRect(0, 0, canvas.width, canvas.height);
            out.drawImage(work, 0, 0);
            track.requestFrame();
            onProgress?.(++done / (frames.length * loops));
            await sleep(Math.max(0, frames[i].delay - (performance.now() - started)));
        }
    }
    recorder.stop();
    await stopped;
    track.stop();
    const mime = type.split(";")[0];
    return { blob: new Blob(chunks, { type: mime }), width: canvas.width, height: canvas.height, frames: frames.length, ext: mime === "video/mp4" ? "mp4" : "webm" };
}

/** Encodes the edit, shrinking it until it fits the size target. */
export async function encode(src: Source, s: EditState, timeline: Timeline, cancel: Cancel, onProgress?: (k: number, note?: string) => void): Promise<Encoded | null> {
    const target = s.sizeTarget;
    const plan: Plan = { scale: 1, colors: s.colors, skip: 1, quality: 0.85 };
    const steps: string[] = [];
    let last: Encoded | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
        const frames = skipFrames(timeline.frames, plan.skip);
        const note = attempt ? "Making it smaller…" : undefined;
        const report = (k: number) => onProgress?.(k, note);
        const out = s.format === "webp" ? await encodeWebp(src, s, frames, plan, cancel, report)
            : s.format === "video" ? await encodeVideo(src, s, frames, plan, target, cancel, report)
                : await encodeGif(src, s, frames, plan, cancel, report);
        if (!out) return null;
        last = out;
        const said = () => [...steps, plan.scale < 1 ? `${Math.round(plan.scale * 100)}% size` : ""].filter(Boolean).join(", ");
        if (!target || out.blob.size <= target || s.format === "video" && attempt >= 2) {
            const shrunk = said();
            return shrunk ? { ...out, shrunk } : out;
        }
        // Gentlest first: when it's nearly there, fewer colours (or lower quality); when it's far off,
        // half the frames (which roughly halves it) before making it smaller; and shrink in steps.
        const ratio = target / out.blob.size;
        if (ratio >= 0.7 && s.format === "webp" && plan.quality > 0.45) { plan.quality -= 0.15; if (!steps.includes("lower quality")) steps.push("lower quality"); continue; }
        if (ratio >= 0.7 && s.format === "gif" && plan.colors > 64) { plan.colors /= 2; steps.splice(0, steps.length, ...steps.filter(x => !x.endsWith("colours")), `${plan.colors} colours`); continue; }
        if (plan.skip < 2 && frames.length > 24) { plan.skip = 2; steps.push("half the frames"); continue; }
        plan.scale *= Math.min(0.95, Math.max(0.5, Math.sqrt(ratio) * 0.95));
    }
    return last && { ...last, shrunk: "couldn't get it small enough" };
}
