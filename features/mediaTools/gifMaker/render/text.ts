/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Text you can place anywhere: fill (solid or gradient), outline, shadow,
// timing, and animations.

import { getFontFamilyCss } from "../fonts";
import type { Fill, TextLayer } from "../types";
import { rng } from "./effects";

export interface Box { id: string; x: number; y: number; w: number; h: number; }

export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const out: string[] = [];
    for (const para of text.split("\n")) {
        let line = "";
        for (const word of para.split(" ")) {
            const test = line ? `${line} ${word}` : word;
            if (ctx.measureText(test).width > maxWidth && line) {
                out.push(line);
                line = word;
            } else line = test;
        }
        out.push(line);
    }
    return out;
}

export function fillStyleOf(ctx: CanvasRenderingContext2D, fill: Fill, x: number, y: number, w: number, h: number): string | CanvasGradient {
    if (fill.mode !== "gradient" || fill.colors.length < 2) return fill.color;
    const rad = (fill.angle - 90) * Math.PI / 180;
    const cx = x + w / 2, cy = y + h / 2;
    const len = Math.abs(w * Math.cos(rad)) / 2 + Math.abs(h * Math.sin(rad)) / 2;
    const g = ctx.createLinearGradient(cx - Math.cos(rad) * len, cy - Math.sin(rad) * len, cx + Math.cos(rad) * len, cy + Math.sin(rad) * len);
    fill.colors.forEach((c, i) => g.addColorStop(i / (fill.colors.length - 1), c));
    return g;
}

const easeOutBack = (k: number) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2;
};

/** Draws one text layer inside the picture `r`. Returns its box (for dragging), or null when it isn't showing. */
export function drawTextLayer(ctx: CanvasRenderingContext2D, layer: TextLayer, r: { x: number; y: number; w: number; h: number; }, p: number, frame: number, always = false): Box | null {
    if (!layer.text.trim()) return null;
    const span = Math.max(0.001, layer.to - layer.from);
    const shown = p >= layer.from - 1e-6 && p <= layer.to + 1e-6;
    if (!shown && !always) return null;
    const q = Math.max(0, Math.min(1, (p - layer.from) / span));

    const px = Math.max(6, layer.size * r.w);
    ctx.save();
    ctx.font = `${layer.bold ? "bold " : ""}${px}px ${getFontFamilyCss(layer.font)}`;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const lines = wrapLines(ctx, layer.text, r.w * 0.95);
    const lineH = px * 1.15;
    const widths = lines.map(l => ctx.measureText(l).width);
    const bw = Math.max(...widths), bh = lines.length * lineH;
    const cx = r.x + layer.x * r.w, cy = r.y + layer.y * r.h;
    const box: Box = { id: layer.id, x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
    if (!shown) { ctx.restore(); return box; }

    let scale = 1, alpha = 1, dx = 0, dy = 0;
    if (layer.anim === "pop") {
        const k = Math.min(1, q / 0.18);
        scale = Math.max(0.01, easeOutBack(k));
        alpha = Math.min(1, k * 2);
    } else if (layer.anim === "shake") {
        const rand = rng(frame * 53 + layer.id.length);
        dx = (rand() - 0.5) * px * 0.12;
        dy = (rand() - 0.5) * px * 0.12;
    }
    ctx.translate(cx + dx, cy + dy);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;

    if (layer.shadow) {
        ctx.shadowColor = "rgba(0,0,0,0.65)";
        ctx.shadowBlur = px * 0.18;
        ctx.shadowOffsetY = px * 0.05;
    }
    const outline = layer.outlineWidth > 0 ? layer.outlineWidth * px : 0;
    ctx.lineWidth = outline;
    ctx.strokeStyle = layer.outline;
    const fill = fillStyleOf(ctx, layer.fill, -bw / 2, -bh / 2, bw, bh);

    // Typewriter: how many characters are showing.
    const total = lines.reduce((a, l) => a + [...l].length, 0);
    let budget = layer.anim === "typewriter" ? Math.floor(Math.min(1, q / 0.8) * total + 1e-6) : Infinity;
    const perChar = layer.anim === "wave" || layer.anim === "rainbow" || layer.anim === "typewriter";

    lines.forEach((line, li) => {
        const ly = -bh / 2 + lineH * (li + 0.5);
        if (!perChar) {
            ctx.textAlign = "center";
            if (outline) ctx.strokeText(line, 0, ly);
            ctx.shadowColor = "transparent";
            ctx.fillStyle = fill;
            ctx.fillText(line, 0, ly);
            if (layer.shadow) ctx.shadowColor = "rgba(0,0,0,0.65)";
            return;
        }
        ctx.textAlign = "left";
        let x = -widths[li] / 2;
        [...line].forEach((ch, ci) => {
            if (budget-- <= 0) return;
            const w = ctx.measureText(ch).width;
            const oy = layer.anim === "wave" ? Math.sin(Math.PI * 2 * (p * 2) + (li * 7 + ci) * 0.55) * px * 0.14 : 0;
            if (outline) ctx.strokeText(ch, x, ly + oy);
            ctx.fillStyle = layer.anim === "rainbow" ? `hsl(${((li * 7 + ci) * 28 + p * 360) % 360} 95% 60%)` : fill;
            ctx.fillText(ch, x, ly + oy);
            x += w;
        });
    });
    ctx.restore();
    return box;
}
