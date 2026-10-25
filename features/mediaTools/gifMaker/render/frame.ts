/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Draws one frame of the GIF: the picture (rotated, flipped, cropped,
// zoomed, filtered), then overlays, banner, stickers, text and the caption.
// The live preview and the exporter both use this, so what you see is what
// you get.

import type { EditState, Sticker } from "../types";
import { loadImage } from "../utils/media";
import { drawCaption, drawCaptionBackground, Layout, layout } from "./captions";
import { bannerAmount, cssFilter, drawBanner, drawParticles, postFilter, Rect } from "./effects";
import type { Source } from "./source";
import { Box, drawTextLayer } from "./text";

export interface FrameInfo { t: number; index: number; p: number; }
export interface RenderOpts {
    scale?: number;
    /** Crop tab: the whole (rotated) picture, nothing else. */
    cropView?: boolean;
    /** While editing: give boxes for text that isn't showing at this moment too. */
    boxesAlways?: boolean;
    /** Video export: no see-through pixels. */
    opaque?: boolean;
}
export interface RenderResult { layout: Layout; texts: Box[]; stickers: Box[]; }

const TAU = Math.PI * 2;
export const EMOJI_FONT = "\"Segoe UI Emoji\", \"Apple Color Emoji\", \"Noto Color Emoji\", sans-serif";

/** The picture's size once rotated. */
export function rotatedSize(src: Source, s: EditState): [number, number] {
    return s.rotate % 180 ? [src.height, src.width] : [src.width, src.height];
}

/** Width ÷ height of what's left after cropping. */
export function cropAspect(src: Source, s: EditState) {
    const [rw, rh] = rotatedSize(src, s);
    return (s.crop.w * rw) / Math.max(1e-6, s.crop.h * rh);
}

export function zoomAt(s: EditState, p: number) {
    const k = s.zoomStrength;
    switch (s.zoom) {
        case "in": return 1 + k * p;
        case "out": return 1 + k * (1 - p);
        case "punch": {
            if (p < s.zoomAt) return 1;
            const q = Math.min(1, (p - s.zoomAt) / 0.06);
            const c1 = 1.70158, c3 = c1 + 1;
            return 1 + k * 2 * (1 + c3 * (q - 1) ** 3 + c1 * (q - 1) ** 2);
        }
    }
    return 1;
}

function drawPicture(ctx: CanvasRenderingContext2D, img: CanvasImageSource, src: Source, s: EditState, r: Rect, zoom: number, full: boolean) {
    const [rw, rh] = rotatedSize(src, s);
    const crop = full ? { x: 0, y: 0, w: 1, h: 1 } : s.crop;
    const cx = crop.x * rw, cy = crop.y * rh, cw = crop.w * rw, ch = crop.h * rh;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.translate(r.x, r.y);
    ctx.scale(r.w / cw, r.h / ch);
    ctx.translate(-cx, -cy);
    if (zoom !== 1) {
        const px = cx + s.zoomX * cw, py = cy + s.zoomY * ch;
        ctx.translate(px, py);
        ctx.scale(zoom, zoom);
        ctx.translate(-px, -py);
    }
    ctx.translate(rw / 2, rh / 2);
    ctx.rotate(s.rotate * Math.PI / 180);
    ctx.scale(s.flipH ? -1 : 1, s.flipV ? -1 : 1);
    ctx.drawImage(img, -src.width / 2, -src.height / 2, src.width, src.height);
    ctx.restore();
}

// ─── Stickers ───

const stickerImages = new Map<string, HTMLImageElement | "loading" | "failed">();
let onStickerLoaded: (() => void) | null = null;
export const setStickerListener = (fn: (() => void) | null) => { onStickerLoaded = fn; };

function stickerImage(url: string) {
    const hit = stickerImages.get(url);
    if (hit instanceof HTMLImageElement) return hit;
    if (!hit) {
        stickerImages.set(url, "loading");
        loadImage(url).then(img => { stickerImages.set(url, img); onStickerLoaded?.(); }).catch(() => stickerImages.set(url, "failed"));
    }
    return null;
}

/** Where a point is along a path, by distance travelled. */
function alongPath(path: [number, number][], p: number): [number, number] {
    if (path.length < 2) return path[0] ?? [0.5, 0.5];
    const lens = path.slice(1).map((pt, i) => Math.hypot(pt[0] - path[i][0], pt[1] - path[i][1]));
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    let d = p * total;
    for (let i = 0; i < lens.length; i++) {
        if (d <= lens[i] || i === lens.length - 1) {
            const k = lens[i] ? Math.min(1, d / lens[i]) : 0;
            return [path[i][0] + (path[i + 1][0] - path[i][0]) * k, path[i][1] + (path[i + 1][1] - path[i][1]) * k];
        }
        d -= lens[i];
    }
    return path[path.length - 1];
}

export function stickerPlacement(k: Sticker, p: number) {
    let { x, y } = k, rot = 0, scale = 1;
    switch (k.motion) {
        case "bounce": y -= Math.abs(Math.sin(TAU * p)) * k.size * 0.6; break;
        case "spin": rot = TAU * p; break;
        case "pulse": scale = 1 + 0.15 * Math.sin(TAU * p * 2); break;
        case "float": x += Math.sin(TAU * p) * k.size * 0.3; y += Math.sin(TAU * p * 2) * k.size * 0.12; break;
        case "path": if (k.path.length > 1) [x, y] = alongPath(k.path, p); break;
    }
    return { x, y, rot, scale };
}

function drawSticker(ctx: CanvasRenderingContext2D, k: Sticker, r: Rect, p: number): Box {
    const { x, y, rot, scale } = stickerPlacement(k, p);
    const size = k.size * r.w;
    const cx = r.x + x * r.w, cy = r.y + y * r.h;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    if (k.kind === "emoji") {
        ctx.font = `${size}px ${EMOJI_FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(k.value, 0, size * 0.05);
    } else {
        const img = stickerImage(k.value);
        if (img) {
            const s = size / Math.max(img.naturalWidth, img.naturalHeight);
            ctx.drawImage(img, -img.naturalWidth * s / 2, -img.naturalHeight * s / 2, img.naturalWidth * s, img.naturalHeight * s);
        }
    }
    ctx.restore();
    return { id: k.id, x: cx - size / 2, y: cy - size / 2, w: size, h: size };
}

// ─── The frame ───

export function renderFrame(canvas: HTMLCanvasElement, src: Source, s: EditState, f: FrameInfo, opts: RenderOpts = {}): RenderResult {
    const scale = opts.scale ?? 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    if (opts.cropView) {
        const [rw, rh] = rotatedSize(src, s);
        const w = s.width, h = Math.max(1, Math.round(s.width * rh / rw));
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        ctx.clearRect(0, 0, w, h);
        const img = src.frameAt(f.t);
        if (img) drawPicture(ctx, img, src, s, { x: 0, y: 0, w, h }, 1, true);
        return { layout: { cw: w, ch: h, img: { x: 0, y: 0, w, h } }, texts: [], stickers: [] };
    }

    // Measure with the font settings first, so the canvas can be sized.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const l = layout(ctx, s);
    const cw = Math.max(1, Math.round(l.cw * scale)), ch = Math.max(1, Math.round(l.ch * scale));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (opts.opaque) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, cw, ch); }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    drawCaptionBackground(ctx, s, l);

    const r = l.img;
    const img = src.frameAt(f.t);
    const banner = bannerAmount(s, f.p);
    if (img) {
        ctx.save();
        ctx.filter = cssFilter(s, s.banner === "wasted" ? banner * 0.85 : 0);
        drawPicture(ctx, img, src, s, r, zoomAt(s, f.p), false);
        ctx.restore();
    } else {
        ctx.fillStyle = "#111";
        ctx.fillRect(r.x, r.y, r.w, r.h);
    }

    // Pixel filters work in real canvas pixels.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    postFilter(ctx, s, { x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale }, f.p, f.index);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    drawParticles(ctx, s.particles, s.particleDensity, r, f.p);
    drawBanner(ctx, s.banner, r, banner);

    if (s.cropShape === "circle") {
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        const cut = new Path2D();
        cut.rect(r.x, r.y, r.w, r.h);
        cut.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, TAU);
        ctx.fill(cut, "evenodd");
        ctx.restore();
    }

    const stickers = s.stickers.map(k => drawSticker(ctx, k, r, f.p));
    const texts = s.texts.map(t => drawTextLayer(ctx, t, r, f.p, f.index, opts.boxesAlways)).filter(Boolean) as Box[];
    drawCaption(ctx, s, l);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return { layout: l, texts, stickers };
}
