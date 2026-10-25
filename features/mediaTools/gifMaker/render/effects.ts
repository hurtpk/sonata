/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Filters, overlays and banners. Everything that moves is a function of
// the GIF's progress (0–1) with whole numbers of cycles, so the last frame
// flows straight back into the first and the GIF loops cleanly.

import type { BannerId, EditState, FilterId, ParticleId } from "../types";

export interface Rect { x: number; y: number; w: number; h: number; }

/** A small seeded random generator, so the same frame always looks the same. */
export function rng(seed: number) {
    let a = seed >>> 0 || 1;
    return () => {
        a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

export const FILTERS: { id: FilterId; name: string; }[] = [
    { id: "none", name: "None" },
    { id: "bw", name: "Black & white" },
    { id: "sepia", name: "Sepia" },
    { id: "vintage", name: "Vintage" },
    { id: "deepfried", name: "Deep-fried" },
    { id: "invert", name: "Invert" },
    { id: "pixelate", name: "Pixelate" },
    { id: "vhs", name: "VHS" },
    { id: "glitch", name: "Glitch" },
];

/** The CSS filter for the picture: the chosen filter's colour part plus the adjustments. */
export function cssFilter(s: EditState, extraGray = 0) {
    const a = s.filterAmount;
    const parts: string[] = [];
    switch (s.filter) {
        case "bw": parts.push(`grayscale(${a})`); break;
        case "sepia": parts.push(`sepia(${a})`); break;
        case "vintage": parts.push(`sepia(${0.45 * a}) contrast(${1 - 0.1 * a}) saturate(${1 - 0.25 * a}) brightness(${1 + 0.05 * a})`); break;
        case "deepfried": parts.push(`saturate(${1 + 2.5 * a}) contrast(${1 + 1.2 * a}) brightness(${1 + 0.1 * a})`); break;
        case "invert": parts.push(`invert(${a})`); break;
        case "vhs": parts.push(`saturate(${1 + 0.3 * a}) contrast(${1 + 0.1 * a})`); break;
    }
    if (s.brightness !== 100) parts.push(`brightness(${s.brightness}%)`);
    if (s.contrast !== 100) parts.push(`contrast(${s.contrast}%)`);
    if (s.saturation !== 100) parts.push(`saturate(${s.saturation}%)`);
    if (s.hue) parts.push(`hue-rotate(${s.hue}deg)`);
    if (s.blur > 0) parts.push(`blur(${s.blur}px)`);
    if (extraGray > 0) parts.push(`grayscale(${extraGray})`);
    return parts.join(" ") || "none";
}

let scratch: HTMLCanvasElement | null = null;
const scratchCanvas = (w: number, h: number) => {
    scratch ??= document.createElement("canvas");
    if (scratch.width !== w) scratch.width = w;
    if (scratch.height !== h) scratch.height = h;
    return scratch;
};

/** Filters that work on the pixels themselves, after the picture is drawn. `r` is in canvas pixels. */
export function postFilter(ctx: CanvasRenderingContext2D, s: EditState, r: Rect, p: number, frame: number) {
    const a = s.filterAmount;
    const x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
    if (w < 2 || h < 2 || a <= 0) return;

    if (s.filter === "pixelate") {
        const block = Math.max(2, Math.round((2 + 14 * a) * w / 400));
        const sw = Math.max(1, Math.round(w / block)), sh = Math.max(1, Math.round(h / block));
        const c = scratchCanvas(sw, sh);
        const sctx = c.getContext("2d")!;
        sctx.imageSmoothingEnabled = true;
        sctx.clearRect(0, 0, sw, sh);
        sctx.drawImage(ctx.canvas, x, y, w, h, 0, 0, sw, sh);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(x, y, w, h);
        ctx.drawImage(c, 0, 0, sw, sh, x, y, w, h);
        ctx.restore();
        return;
    }

    if (s.filter === "vintage") {
        ctx.save();
        ctx.globalCompositeOperation = "soft-light";
        ctx.fillStyle = `rgba(255, 170, 80, ${0.35 * a})`;
        ctx.fillRect(x, y, w, h);
        ctx.globalCompositeOperation = "source-atop";
        const g = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.3, x + w / 2, y + h / 2, Math.hypot(w, h) * 0.6);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(20, 10, 0, ${0.55 * a})`);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        ctx.restore();
        grain(ctx, x, y, w, h, 14 * a, frame);
        return;
    }

    if (s.filter === "deepfried") {
        ctx.save();
        ctx.globalCompositeOperation = "overlay";
        ctx.fillStyle = `rgba(255, 90, 0, ${0.3 * a})`;
        ctx.fillRect(x, y, w, h);
        ctx.restore();
        const img = ctx.getImageData(x, y, w, h);
        const d = img.data;
        const levels = Math.max(3, Math.round(8 - 4 * a));
        const q = 255 / (levels - 1);
        const rand = rng(frame * 977 + 13);
        for (let i = 0; i < d.length; i += 4) {
            const n = (rand() - 0.5) * 60 * a;
            d[i] = Math.round((d[i] + n) / q) * q;
            d[i + 1] = Math.round((d[i + 1] + n) / q) * q;
            d[i + 2] = Math.round((d[i + 2] + n) / q) * q;
        }
        ctx.putImageData(img, x, y);
        return;
    }

    if (s.filter === "vhs") {
        const img = ctx.getImageData(x, y, w, h);
        const src = new Uint8ClampedArray(img.data);
        const d = img.data;
        const shift = Math.max(1, Math.round(w / 160 * a * 1.5));
        const bandY = (p * 2 % 1) * h, bandH = h * 0.07;
        const rand = rng(frame * 31 + 7);
        for (let row = 0; row < h; row++) {
            const inBand = Math.abs(row - bandY) < bandH;
            const jitter = inBand ? Math.round((rand() - 0.5) * w * 0.03 * a) : 0;
            const dark = row % 3 === 0 ? 1 - 0.18 * a : 1;
            for (let col = 0; col < w; col++) {
                const i = (row * w + col) * 4;
                const cr = Math.min(w - 1, Math.max(0, col + shift + jitter));
                const cb = Math.min(w - 1, Math.max(0, col - shift + jitter));
                const cg = Math.min(w - 1, Math.max(0, col + jitter));
                const n = (rand() - 0.5) * 22 * a + (inBand ? 25 * a : 0);
                d[i] = (src[(row * w + cr) * 4] + n) * dark;
                d[i + 1] = (src[(row * w + cg) * 4 + 1] + n) * dark;
                d[i + 2] = (src[(row * w + cb) * 4 + 2] + n) * dark;
            }
        }
        ctx.putImageData(img, x, y);
        return;
    }

    if (s.filter === "glitch") {
        const rand = rng(frame * 7919 + 3);
        if (rand() > 0.55) return; // about half the frames glitch
        const img = ctx.getImageData(x, y, w, h);
        const src = new Uint8ClampedArray(img.data);
        const d = img.data;
        const slices = 2 + Math.floor(rand() * 5);
        for (let k = 0; k < slices; k++) {
            const sy = Math.floor(rand() * h), sh = Math.max(2, Math.floor(rand() * h * 0.12));
            const dx = Math.round((rand() - 0.5) * w * 0.16 * a);
            const split = Math.round(rand() * w * 0.02 * a);
            for (let row = sy; row < Math.min(h, sy + sh); row++) {
                for (let col = 0; col < w; col++) {
                    const i = (row * w + col) * 4;
                    const from = (c: number) => (row * w + Math.min(w - 1, Math.max(0, c))) * 4;
                    d[i] = src[from(col - dx + split)];
                    d[i + 1] = src[from(col - dx) + 1];
                    d[i + 2] = src[from(col - dx - split) + 2];
                }
            }
        }
        ctx.putImageData(img, x, y);
    }
}

function grain(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, amount: number, frame: number) {
    const img = ctx.getImageData(x, y, w, h);
    const d = img.data;
    const rand = rng(frame * 131 + 5);
    for (let i = 0; i < d.length; i += 4) {
        const n = (rand() - 0.5) * amount;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    ctx.putImageData(img, x, y);
}

// ─── Particles ───

export const PARTICLES: { id: ParticleId; name: string; emoji: string; }[] = [
    { id: "none", name: "None", emoji: "∅" },
    { id: "confetti", name: "Confetti", emoji: "🎊" },
    { id: "hearts", name: "Hearts", emoji: "💗" },
    { id: "sparkles", name: "Sparkles", emoji: "✨" },
    { id: "snow", name: "Snow", emoji: "❄️" },
    { id: "rain", name: "Rain", emoji: "🌧️" },
];

const CONFETTI = ["#f43f5e", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#facc15"];
const TAU = Math.PI * 2;

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.3);
    ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
    ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.75, x, y + s);
    ctx.bezierCurveTo(x, y + s * 0.75, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
    ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
    ctx.fill();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
        const r = i % 2 ? s * 0.22 : s;
        const ang = i * Math.PI / 4 - Math.PI / 2;
        ctx.lineTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r);
    }
    ctx.closePath();
    ctx.fill();
}

export function drawParticles(ctx: CanvasRenderingContext2D, kind: ParticleId, density: number, r: Rect, p: number) {
    if (kind === "none") return;
    const base = { confetti: 40, hearts: 14, sparkles: 22, snow: 50, rain: 70 }[kind];
    const n = Math.round(base * density);
    const rand = rng(kind.length * 1000 + 17);
    const unit = r.w / 400;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    for (let i = 0; i < n; i++) {
        const x0 = rand(), phase = rand(), size = 0.6 + rand() * 0.8, sway = rand(), turns = 1 + Math.floor(rand() * 2), laps = 1 + Math.floor(rand() * 2);
        const color = CONFETTI[Math.floor(rand() * CONFETTI.length)];
        switch (kind) {
            case "confetti": {
                const y = ((phase + laps * p) % 1) * (r.h + 40 * unit) - 20 * unit;
                const x = r.x + x0 * r.w + Math.sin(TAU * (p * turns + phase)) * 12 * unit;
                ctx.save();
                ctx.translate(x, r.y + y);
                ctx.rotate(TAU * (p * turns + phase));
                ctx.scale(1, Math.cos(TAU * (p * turns * 2 + sway)));
                ctx.fillStyle = color;
                ctx.fillRect(-4 * unit * size, -2.5 * unit * size, 8 * unit * size, 5 * unit * size);
                ctx.restore();
                break;
            }
            case "hearts": {
                const y = r.h + 30 * unit - ((phase + p) % 1) * (r.h + 60 * unit);
                const x = r.x + x0 * r.w + Math.sin(TAU * (p * turns + phase)) * 14 * unit;
                const t = (phase + p) % 1;
                ctx.globalAlpha = Math.min(1, t * 5, (1 - t) * 3);
                ctx.fillStyle = ["#ff4d8d", "#ff6b9d", "#f43f5e", "#fb7185"][i % 4];
                heart(ctx, x, r.y + y, 22 * unit * size);
                ctx.globalAlpha = 1;
                break;
            }
            case "sparkles": {
                const tw = Math.sin(TAU * (p * turns + phase));
                if (tw <= 0) break;
                ctx.globalAlpha = tw;
                ctx.fillStyle = i % 3 ? "#fff8d6" : "#ffffff";
                ctx.shadowColor = "rgba(255, 240, 180, 0.9)";
                ctx.shadowBlur = 8 * unit;
                star(ctx, r.x + x0 * r.w, r.y + sway * r.h, 9 * unit * size * (0.5 + tw * 0.5));
                ctx.shadowBlur = 0;
                ctx.globalAlpha = 1;
                break;
            }
            case "snow": {
                const y = ((phase + p) % 1) * (r.h + 20 * unit) - 10 * unit;
                const x = r.x + x0 * r.w + Math.sin(TAU * (p * turns + phase)) * 10 * unit;
                ctx.globalAlpha = 0.65 + size * 0.25;
                ctx.fillStyle = "#ffffff";
                ctx.beginPath();
                ctx.arc(x, r.y + y, 2.6 * unit * size, 0, TAU);
                ctx.fill();
                ctx.globalAlpha = 1;
                break;
            }
            case "rain": {
                const fall = laps + 1;
                const y = ((phase + fall * p) % 1) * (r.h + 40 * unit) - 20 * unit;
                const x = r.x + ((x0 + ((phase + fall * p) % 1) * 0.08) % 1) * r.w;
                ctx.strokeStyle = "rgba(200, 220, 255, 0.55)";
                ctx.lineWidth = 1.4 * unit;
                ctx.beginPath();
                ctx.moveTo(x, r.y + y);
                ctx.lineTo(x - 4 * unit, r.y + y + 16 * unit * size);
                ctx.stroke();
                break;
            }
        }
    }
    ctx.restore();
}

// ─── Banners ───

export const BANNERS: { id: BannerId; name: string; }[] = [
    { id: "none", name: "None" },
    { id: "wasted", name: "Wasted" },
    { id: "failed", name: "Mission failed" },
    { id: "died", name: "You died" },
];

export const BANNER_FONTS = ["Bangers", "Oswald", "Cinzel"];

/** How far into its fade-in a banner is (0 = not shown yet). */
export function bannerAmount(s: EditState, p: number) {
    if (s.banner === "none") return 0;
    const fade = s.banner === "died" ? 0.15 : 0.06;
    return Math.max(0, Math.min(1, (p - s.bannerAt) / fade));
}

export function drawBanner(ctx: CanvasRenderingContext2D, kind: BannerId, r: Rect, k: number) {
    if (kind === "none" || k <= 0) return;
    const cy = r.y + r.h / 2;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = k;

    if (kind === "wasted") {
        const bh = r.h * 0.2;
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(r.x, cy - bh / 2, r.w, bh);
        const size = Math.min(r.w * 0.2, bh * 0.95);
        ctx.font = `${size}px "Pricedown", "Bangers", Impact, sans-serif`;
        ctx.lineJoin = "round";
        ctx.lineWidth = size * 0.1;
        ctx.strokeStyle = "#000";
        ctx.strokeText("wasted", r.x + r.w / 2, cy);
        ctx.fillStyle = "#c81414";
        ctx.fillText("wasted", r.x + r.w / 2, cy);
    } else if (kind === "failed") {
        const bh = r.h * 0.28;
        const g = ctx.createLinearGradient(0, cy - bh / 2, 0, cy + bh / 2);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(0.25, "rgba(0,0,0,0.6)");
        g.addColorStop(0.75, "rgba(0,0,0,0.6)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(r.x, cy - bh / 2, r.w, bh);
        const size = Math.min(r.w * 0.11, bh * 0.4);
        ctx.fillStyle = "#f2f2f2";
        ctx.font = `bold ${size}px "Oswald", Impact, sans-serif`;
        ctx.fillText("MISSION FAILED", r.x + r.w / 2, cy - size * 0.25);
        ctx.font = `${size * 0.42}px "Oswald", Arial, sans-serif`;
        ctx.fillStyle = "#d8d8d8";
        ctx.fillText("We'll get 'em next time", r.x + r.w / 2, cy + size * 0.6);
    } else if (kind === "died") {
        const bh = r.h * 0.26;
        const g = ctx.createLinearGradient(0, cy - bh / 2, 0, cy + bh / 2);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(0.3, "rgba(0,0,0,0.8)");
        g.addColorStop(0.7, "rgba(0,0,0,0.8)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(r.x, cy - bh / 2, r.w, bh);
        const size = Math.min(r.w * 0.12, bh * 0.5) * (0.94 + 0.06 * k);
        ctx.font = `${size}px "Cinzel", "Times New Roman", serif`;
        ctx.fillStyle = "#a01818";
        ctx.shadowColor = "rgba(160, 20, 20, 0.6)";
        ctx.shadowBlur = size * 0.3;
        ctx.fillText("YOU DIED", r.x + r.w / 2, cy);
    }
    ctx.restore();
}
