/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Still images: decoded by Chromium itself (PNG, JPG, WebP, GIF, BMP, ICO,
// AVIF, SVG), iPhone HEIC photos by heic2any (loaded only when one comes
// along), and written as PNG / JPG / WebP / GIF / BMP / ICO.

import { applyPalette, GIFEncoder, quantize } from "gifenc";

import { isHeic } from "./formats";

export interface Fit {
    /** Longest side, or exact size with "cover" (crop to fill) / "contain" (fit inside). */
    maxSide?: number;
    width?: number;
    height?: number;
    mode?: "cover" | "contain";
}

/** Any still image file → a canvas at its own size. */
export async function decodeImage(file: Blob & { name?: string; }): Promise<HTMLCanvasElement> {
    let blob: Blob = file;
    if (file instanceof File && isHeic(file)) {
        const { default: heic2any } = await import("heic2any");
        const out = await heic2any({ blob: file, toType: "image/png" });
        blob = Array.isArray(out) ? out[0] : out;
    }
    if (blob.type === "image/svg+xml" || (file as File).name?.toLowerCase().endsWith(".svg")) return decodeSvg(blob);
    let bmp: ImageBitmap;
    try {
        bmp = await createImageBitmap(blob);
    } catch {
        throw new Error("This image can't be opened here — it may be damaged, or a kind Discord can't read (try a video/ffmpeg format).");
    }
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    bmp.close();
    return c;
}

async function decodeSvg(blob: Blob): Promise<HTMLCanvasElement> {
    const url = URL.createObjectURL(blob);
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        // SVGs without a size get a sensible one.
        const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024, k = Math.max(1, 1024 / Math.max(w, h));
        const c = document.createElement("canvas");
        c.width = Math.round(w * k);
        c.height = Math.round(h * k);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        return c;
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** Resized / cropped copy (or the same canvas if nothing changes). */
export function fit(src: HTMLCanvasElement, f: Fit): HTMLCanvasElement {
    let w = src.width, h = src.height, sx = 0, sy = 0, sw = w, sh = h;
    if (f.width && f.height) {
        const k = f.mode === "contain" ? Math.min(f.width / w, f.height / h) : Math.max(f.width / w, f.height / h);
        if (f.mode === "contain") { w = Math.round(w * k); h = Math.round(h * k); }
        else {
            // Crop the middle to the target's shape.
            sw = f.width / k; sh = f.height / k; sx = (src.width - sw) / 2; sy = (src.height - sh) / 2;
            w = f.width; h = f.height;
        }
    } else if (f.maxSide && Math.max(w, h) > f.maxSide) {
        const k = f.maxSide / Math.max(w, h);
        w = Math.round(w * k); h = Math.round(h * k);
    }
    if (w === src.width && h === src.height && !sx && !sy) return src;
    const c = document.createElement("canvas");
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    const x = c.getContext("2d")!;
    x.imageSmoothingQuality = "high";
    x.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
}

/** The picture fitted inside an exact-size, see-through canvas (centred, never stretched). */
export function onCanvas(src: HTMLCanvasElement, width: number, height: number, upscale = true): HTMLCanvasElement {
    const k = Math.min(width / src.width, height / src.height, upscale ? Infinity : 1);
    const w = Math.round(src.width * k), h = Math.round(src.height * k);
    const c = document.createElement("canvas");
    c.width = width; c.height = height;
    const x = c.getContext("2d")!;
    x.imageSmoothingQuality = "high";
    x.drawImage(src, Math.round((width - w) / 2), Math.round((height - h) / 2), w, h);
    return c;
}

const toBlob = (c: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob>((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("Couldn't write the image")), type, quality));

/** Writes a canvas in a format. Quality is 0–1 (JPG / WebP). */
export async function encodeImage(c: HTMLCanvasElement, format: string, quality = 0.9): Promise<Blob> {
    switch (format) {
        case "png": return toBlob(c, "image/png");
        case "webp": return toBlob(c, "image/webp", quality);
        case "jpg": {
            // JPG has no transparency: put it on white.
            const flat = document.createElement("canvas");
            flat.width = c.width;
            flat.height = c.height;
            const x = flat.getContext("2d")!;
            x.fillStyle = "#fff";
            x.fillRect(0, 0, c.width, c.height);
            x.drawImage(c, 0, 0);
            return toBlob(flat, "image/jpeg", quality);
        }
        case "gif": return new Blob([gifOf(c) as BlobPart], { type: "image/gif" });
        case "bmp": return new Blob([bmpOf(c)], { type: "image/bmp" });
        case "ico": return icoOf(c);
        default: throw new Error(`Can't write ${format} images`);
    }
}

function gifOf(c: HTMLCanvasElement) {
    const { data } = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
    const palette = quantize(data, 256, { format: "rgba4444", oneBitAlpha: true });
    const index = applyPalette(data, palette, "rgba4444");
    const transparentIndex = palette.findIndex(p => p[3] === 0);
    const gif = GIFEncoder();
    gif.writeFrame(index, c.width, c.height, { palette, transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex) });
    gif.finish();
    return gif.bytes();
}

/** 32-bit BMP (keeps transparency where programs support it). */
function bmpOf(c: HTMLCanvasElement) {
    const { width: w, height: h } = c;
    const { data } = c.getContext("2d")!.getImageData(0, 0, w, h);
    const headers = 14 + 108, size = headers + w * h * 4;
    const buf = new ArrayBuffer(size), v = new DataView(buf);
    v.setUint16(0, 0x4d42, true); v.setUint32(2, size, true); v.setUint32(10, headers, true);
    v.setUint32(14, 108, true); v.setInt32(18, w, true); v.setInt32(22, -h, true); // top-down rows
    v.setUint16(26, 1, true); v.setUint16(28, 32, true); v.setUint32(30, 3, true); v.setUint32(34, w * h * 4, true);
    v.setUint32(38, 2835, true); v.setUint32(42, 2835, true);
    // Channel masks (BGRA) and the sRGB colour space.
    v.setUint32(54, 0x00ff0000, true); v.setUint32(58, 0x0000ff00, true); v.setUint32(62, 0x000000ff, true); v.setUint32(66, 0xff000000, true);
    v.setUint32(70, 0x73524742, true);
    const px = new Uint8Array(buf, headers);
    for (let i = 0; i < w * h; i++) {
        px[i * 4] = data[i * 4 + 2]; px[i * 4 + 1] = data[i * 4 + 1]; px[i * 4 + 2] = data[i * 4]; px[i * 4 + 3] = data[i * 4 + 3];
    }
    return buf;
}

/** A Windows icon with every standard size up to the picture's own (each stored as PNG). */
async function icoOf(c: HTMLCanvasElement): Promise<Blob> {
    const sizes = [16, 24, 32, 48, 64, 128, 256].filter(s => s <= Math.max(c.width, c.height)) as number[];
    if (!sizes.length) sizes.push(16);
    const pngs = await Promise.all(sizes.map(async s => new Uint8Array(await (await encodeImage(fit(c, { width: s, height: s, mode: "contain" }), "png")).arrayBuffer())));
    const head = new DataView(new ArrayBuffer(6 + 16 * pngs.length));
    head.setUint16(2, 1, true);
    head.setUint16(4, pngs.length, true);
    let offset = 6 + 16 * pngs.length;
    sizes.forEach((s, i) => {
        const o = 6 + 16 * i;
        head.setUint8(o, s >= 256 ? 0 : s); head.setUint8(o + 1, s >= 256 ? 0 : s);
        head.setUint16(o + 4, 1, true); head.setUint16(o + 6, 32, true);
        head.setUint32(o + 8, pngs[i].byteLength, true); head.setUint32(o + 12, offset, true);
        offset += pngs[i].byteLength;
    });
    return new Blob([head.buffer, ...pngs as BlobPart[]], { type: "image/x-icon" });
}

/** Encodes at lower and lower quality / size until it fits under `maxBytes`. */
export async function encodeUnder(c: HTMLCanvasElement, format: "webp" | "jpg" | "png", maxBytes: number): Promise<Blob> {
    let canvas = c;
    for (let attempt = 0; attempt < 12; attempt++) {
        for (const q of format === "png" ? [1] : [0.92, 0.82, 0.72, 0.6, 0.45]) {
            const b = await encodeImage(canvas, format, q);
            if (b.size <= maxBytes) return b;
        }
        // Still too big: shrink by a fifth and try again.
        canvas = fit(canvas, { maxSide: Math.max(16, Math.round(Math.max(canvas.width, canvas.height) * 0.8)) });
    }
    throw new Error("Couldn't get it small enough");
}

/* ── Removing a plain background ───────────────────────────────────── */

export interface BgOptions {
    /** "auto" picks the colour around the picture's edges. */
    color: "auto" | "white" | "black" | "green" | "blue";
    /** How different a pixel can be and still count as background (0–100). */
    tolerance: number;
    /** Soft edges instead of a hard cut-out (0–100). */
    soften: number;
    /** Only remove background that touches the edges, so the same colour inside the subject stays. */
    edgesOnly: boolean;
}

export const DEFAULT_BG: BgOptions = { color: "auto", tolerance: 30, soften: 30, edgesOnly: true };

const PRESET_BG: Record<Exclude<BgOptions["color"], "auto">, [number, number, number]> = { white: [255, 255, 255], black: [0, 0, 0], green: [0, 177, 64], blue: [0, 71, 187] };

/** The most common colour around the edges (what a plain background usually is). */
function edgeColour(d: Uint8ClampedArray, w: number, h: number): [number, number, number] {
    const bins = new Map<number, { n: number; r: number; g: number; b: number; }>();
    const take = (x: number, y: number) => {
        const i = (y * w + x) * 4;
        if (d[i + 3] < 128) return;
        const key = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4);
        const e = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
        e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2];
        bins.set(key, e);
    };
    const step = Math.max(1, Math.floor(Math.max(w, h) / 400));
    for (let x = 0; x < w; x += step) { take(x, 0); take(x, h - 1); }
    for (let y = 0; y < h; y += step) { take(0, y); take(w - 1, y); }
    const best = [...bins.values()].sort((a, b) => b.n - a.n)[0];
    return best ? [best.r / best.n, best.g / best.n, best.b / best.n] : [255, 255, 255];
}

/** Makes a plain-coloured background see-through (white, black, a green screen…). */
export function removeBackground(src: HTMLCanvasElement, o: BgOptions): HTMLCanvasElement {
    const w = src.width, h = src.height;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(src, 0, 0);
    const img = g.getImageData(0, 0, w, h), d = img.data;
    const [br, bg, bb] = o.color === "auto" ? edgeColour(d, w, h) : PRESET_BG[o.color];
    // Distance in colour, roughly matching how different colours look.
    const dist = (i: number) => { const dr = d[i] - br, dg = d[i + 1] - bg, db = d[i + 2] - bb; return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / 3; };
    const cut = o.tolerance * 1.2, soft = 4 + o.soften;
    const alphaFor = (i: number) => { const x = dist(i); return x <= cut ? 0 : x >= cut + soft ? 1 : (x - cut) / soft; };

    if (o.edgesOnly) {
        // Spread in from the edges through background-ish pixels only.
        const seen = new Uint8Array(w * h);
        const stack: number[] = [];
        const push = (p: number) => { if (!seen[p] && alphaFor(p * 4) < 1) { seen[p] = 1; stack.push(p); } };
        for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
        for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
        while (stack.length) {
            const p = stack.pop()!;
            const x = p % w, y = (p / w) | 0;
            if (x > 0) push(p - 1);
            if (x < w - 1) push(p + 1);
            if (y > 0) push(p - w);
            if (y < h - 1) push(p + w);
        }
        for (let p = 0; p < w * h; p++) if (seen[p]) d[p * 4 + 3] = Math.round(d[p * 4 + 3] * alphaFor(p * 4));
    } else {
        for (let p = 0; p < w * h; p++) d[p * 4 + 3] = Math.round(d[p * 4 + 3] * alphaFor(p * 4));
    }

    // Take the background's tint off the soft edges (green-screen "spill").
    for (let p = 0; p < w * h; p++) {
        const i = p * 4, a = d[i + 3] / 255;
        if (a <= 0 || a >= 1) continue;
        for (let ch = 0; ch < 3; ch++) d[i + ch] = Math.max(0, Math.min(255, Math.round((d[i + ch] - [br, bg, bb][ch] * (1 - a)) / Math.max(a, 0.2))));
    }
    g.putImageData(img, 0, 0);
    return c;
}
