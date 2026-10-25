/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Captions are drawn as see-through pictures the size of the video, then laid
// over it at their times. The preview shows the very same drawing, so what you
// see is what you get — any font Discord has, emoji included.

import type { TextItem } from "./project";

const FONT = "\"gg sans\", \"Noto Sans\", \"Segoe UI\", system-ui, sans-serif";

export function drawCaption(ctx: CanvasRenderingContext2D, t: TextItem, W: number, H: number) {
    const px = Math.max(8, t.size * H);
    const lines = (t.text || " ").split("\n");
    const lh = px * 1.18;
    ctx.save();
    ctx.font = `${t.bold ? 800 : 600} ${px}px ${FONT}`;
    const align = t.align ?? "center";
    ctx.textAlign = align;
    ctx.globalAlpha = t.opacity ?? 1;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const cx = t.x * W;
    const top = t.y * H - (lines.length - 1) * lh / 2;
    lines.forEach((line, i) => {
        const y = top + i * lh;
        if (t.style === "box") {
            const w = ctx.measureText(line).width, pad = px * 0.32;
            ctx.fillStyle = "rgba(0,0,0,0.62)";
            const left = align === "left" ? cx : align === "right" ? cx - w : cx - w / 2;
            const x0 = left - pad, y0 = y - lh / 2, bw = w + pad * 2, bh = lh, r = px * 0.22;
            ctx.beginPath();
            ctx.roundRect(x0, y0, bw, bh, r);
            ctx.fill();
        } else if (t.style === "shadow") {
            ctx.shadowColor = "rgba(0,0,0,0.85)";
            ctx.shadowBlur = px * 0.25;
            ctx.shadowOffsetY = px * 0.06;
        } else {
            ctx.strokeStyle = "#000";
            ctx.lineWidth = px * 0.16;
            ctx.strokeText(line, cx, y);
        }
        ctx.fillStyle = t.color;
        ctx.fillText(line, cx, y);
        ctx.shadowColor = "transparent";
    });
    ctx.restore();
}

function canvasFor(t: TextItem, W: number, H: number) {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    drawCaption(c.getContext("2d")!, t, W, H);
    return c;
}

/** The caption as a PNG the size of the video, for ffmpeg. */
export async function captionPng(t: TextItem, W: number, H: number): Promise<Uint8Array> {
    const blob = await new Promise<Blob | null>(res => canvasFor(t, W, H).toBlob(res, "image/png"));
    if (!blob) throw new Error("Couldn't draw a caption");
    return new Uint8Array(await blob.arrayBuffer());
}

/** The caption as a picture for the preview. */
export const captionUrl = (t: TextItem, W: number, H: number) => canvasFor(t, W, H).toDataURL("image/png");
