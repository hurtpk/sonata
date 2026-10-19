/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Caption styles. Some add a bar or a frame around the picture (so they
// decide the canvas size); the rest are drawn on top of it. The speech
// bubble shape is based on
// https://github.com/TheLazySquid/BetterDiscordPlugins/blob/main/plugins/GifCaptioner/src/render/speechbubble.ts

import { getCanvasFont } from "../fonts";
import type { CaptionMode, EditState } from "../types";
import type { Rect } from "./effects";
import { wrapLines } from "./text";

export const CAPTION_STYLES: { id: CaptionMode; name: string; blurb: string; }[] = [
    { id: "none", name: "None", blurb: "No caption" },
    { id: "caption", name: "Caption", blurb: "White bar on top, black text" },
    { id: "meme", name: "Classic meme", blurb: "Big white text with a black outline, top and bottom" },
    { id: "subtitle", name: "Subtitle", blurb: "Film-style subtitle along the bottom" },
    { id: "bottombar", name: "Bottom bar", blurb: "Black bar under the picture, white text" },
    { id: "wth", name: "Black frame", blurb: "Picture on black, italic serif text below" },
    { id: "speechbubble", name: "Speech bubble", blurb: "A white bubble from the top, pointing where you click" },
    { id: "cutout", name: "Cut-out bubble", blurb: "The bubble is cut out of the picture, so the chat shows through" },
];

/** Fonts the caption styles use by default — loaded when the style is picked. */
export const MEME_FONT = "Anton";
export const SERIF_FONT = "Playfair Display";

export interface Layout { cw: number; ch: number; img: Rect; }

const PAD = 10;

function textBlock(ctx: CanvasRenderingContext2D, text: string, size: number, font: string, maxWidth: number) {
    ctx.font = font.includes("px") ? font : getCanvasFont(size, font);
    const lines = text ? wrapLines(ctx, text, maxWidth) : [];
    return { lines, lineH: size * 1.2, height: lines.length * size * 1.2 };
}

const wthFont = (size: number, s: EditState) => `italic ${size}px "${s.fontFamily !== "Arial" ? s.fontFamily : SERIF_FONT}", "Times New Roman", serif`;

/** Canvas size and where the picture goes, for the caption style. */
export function layout(ctx: CanvasRenderingContext2D, s: EditState): Layout {
    const w = s.width, h = s.height;
    switch (s.captionMode) {
        case "caption": {
            if (!s.captionText) break;
            const { height } = textBlock(ctx, s.captionText, s.captionSize, s.fontFamily, w - PAD * 2);
            const bar = Math.ceil(height + PAD * 2);
            return { cw: w, ch: h + bar, img: { x: 0, y: bar, w, h } };
        }
        case "bottombar": {
            if (!s.captionText) break;
            const { height } = textBlock(ctx, s.captionText, s.captionSize, s.fontFamily, w - PAD * 2);
            const bar = Math.ceil(height + PAD * 2);
            return { cw: w, ch: h + bar, img: { x: 0, y: 0, w, h } };
        }
        case "wth": {
            const border = Math.round(w * 0.08);
            const title = textBlock(ctx, s.captionText, s.captionSize, wthFont(s.captionSize, s), w);
            const sub = textBlock(ctx, s.captionBottom, s.captionSize * 0.5, `${s.captionSize * 0.5}px Arial, sans-serif`, w);
            const below = Math.ceil(title.height + sub.height + (title.lines.length || sub.lines.length ? border * 0.8 : 0));
            return { cw: w + border * 2, ch: h + border * 2 + below, img: { x: border, y: border, w, h } };
        }
    }
    return { cw: w, ch: h, img: { x: 0, y: 0, w, h } };
}

function centered(ctx: CanvasRenderingContext2D, lines: string[], cx: number, top: number, lineH: number, stroke = 0) {
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    lines.forEach((line, i) => {
        if (stroke) ctx.strokeText(line, cx, top + i * lineH);
        ctx.fillText(line, cx, top + i * lineH);
    });
}

type Point = [number, number];

function bezierPoint(t: number, start: Point, control: Point, end: Point): Point {
    return [
        (1 - t) * (1 - t) * start[0] + 2 * (1 - t) * t * control[0] + t * t * end[0],
        (1 - t) * (1 - t) * start[1] + 2 * (1 - t) * t * control[1] + t * t * end[1],
    ];
}

function moveAway(point: Point, from: Point, distance: number): Point {
    const dx = point[0] - from[0], dy = point[1] - from[1];
    const length = Math.hypot(dx, dy);
    if (!length) return point;
    return [point[0] + dx * distance / length, point[1] + dy * distance / length];
}

/** The bubble from the top of the picture, as a path (and its outline). */
function bubble(r: Rect, s: EditState) {
    const start: Point = [r.x, r.y + r.h * 0.1];
    const control: Point = [r.x + r.w * 0.5, r.y + r.h * 0.2];
    const end: Point = [r.x + r.w, r.y + r.h * 0.1];
    const tip: Point = [r.x + s.bubbleTipX * r.w, r.y + s.bubbleTipY * r.h];
    const base1 = bezierPoint(s.bubbleTipBase, start, control, end);
    const base2 = bezierPoint(Math.min(1, s.bubbleTipBase + 0.2), start, control, end);

    const fill = new Path2D();
    fill.moveTo(r.x, r.y);
    fill.lineTo(...start);
    fill.quadraticCurveTo(...control, ...end);
    fill.lineTo(r.x + r.w, r.y);
    fill.closePath();
    const tipFill = new Path2D();
    tipFill.moveTo(...moveAway(base1, tip, 5));
    tipFill.lineTo(...tip);
    tipFill.lineTo(...moveAway(base2, tip, 5));
    tipFill.closePath();

    const outline = new Path2D();
    outline.moveTo(...start);
    outline.quadraticCurveTo(...control, ...end);
    const tipLine = new Path2D();
    tipLine.moveTo(...base1);
    tipLine.lineTo(...tip);
    tipLine.lineTo(...base2);
    return { fill, tipFill, outline, tipLine };
}

/** Bars and frames go under the picture… */
export function drawCaptionBackground(ctx: CanvasRenderingContext2D, s: EditState, l: Layout) {
    if (s.captionMode === "caption" && s.captionText) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, l.cw, l.img.y);
    } else if (s.captionMode === "bottombar" && s.captionText) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, l.img.y + l.img.h, l.cw, l.ch - l.img.h);
    } else if (s.captionMode === "wth") {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, l.cw, l.ch);
    }
}

/** …and the text and bubbles go on top. */
export function drawCaption(ctx: CanvasRenderingContext2D, s: EditState, l: Layout) {
    const r = l.img;
    ctx.save();
    ctx.lineJoin = "round";
    switch (s.captionMode) {
        case "caption": {
            if (!s.captionText) break;
            const b = textBlock(ctx, s.captionText, s.captionSize, s.fontFamily, r.w - PAD * 2);
            ctx.fillStyle = "#000";
            centered(ctx, b.lines, l.cw / 2, (r.y - b.height) / 2, b.lineH);
            break;
        }
        case "bottombar": {
            if (!s.captionText) break;
            const b = textBlock(ctx, s.captionText, s.captionSize, s.fontFamily, r.w - PAD * 2);
            ctx.fillStyle = "#fff";
            centered(ctx, b.lines, l.cw / 2, r.y + r.h + (l.ch - r.h - b.height) / 2, b.lineH);
            break;
        }
        case "meme": {
            const font = `${s.captionSize}px "${s.fontFamily !== "Arial" ? s.fontFamily : MEME_FONT}", Impact, sans-serif`;
            ctx.strokeStyle = "#000";
            ctx.lineWidth = Math.max(2, s.captionSize * 0.12);
            ctx.fillStyle = "#fff";
            const top = textBlock(ctx, s.captionText.toUpperCase(), s.captionSize, font, r.w - PAD * 2);
            centered(ctx, top.lines, r.x + r.w / 2, r.y + PAD, top.lineH, 1);
            const bottom = textBlock(ctx, s.captionBottom.toUpperCase(), s.captionSize, font, r.w - PAD * 2);
            centered(ctx, bottom.lines, r.x + r.w / 2, r.y + r.h - PAD - bottom.height, bottom.lineH, 1);
            break;
        }
        case "subtitle": {
            if (!s.captionText) break;
            const size = s.captionSize * 0.7;
            const b = textBlock(ctx, s.captionText, size, s.fontFamily, r.w * 0.9);
            ctx.strokeStyle = "rgba(0,0,0,0.9)";
            ctx.lineWidth = Math.max(2, size * 0.16);
            ctx.shadowColor = "rgba(0,0,0,0.6)";
            ctx.shadowBlur = size * 0.2;
            ctx.fillStyle = "#fff";
            centered(ctx, b.lines, r.x + r.w / 2, r.y + r.h - r.h * 0.06 - b.height, b.lineH, 1);
            break;
        }
        case "wth": {
            const border = r.x;
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = Math.max(1.5, r.w / 260);
            ctx.strokeRect(r.x - ctx.lineWidth * 2, r.y - ctx.lineWidth * 2, r.w + ctx.lineWidth * 4, r.h + ctx.lineWidth * 4);
            const title = textBlock(ctx, s.captionText, s.captionSize, wthFont(s.captionSize, s), r.w);
            ctx.fillStyle = "#fff";
            const top = r.y + r.h + border * 0.5;
            centered(ctx, title.lines, l.cw / 2, top, title.lineH);
            const sub = textBlock(ctx, s.captionBottom, s.captionSize * 0.5, `${s.captionSize * 0.5}px Arial, sans-serif`, r.w);
            ctx.fillStyle = "#d4d4d4";
            centered(ctx, sub.lines, l.cw / 2, top + title.height + border * 0.15, sub.lineH);
            break;
        }
        case "speechbubble": {
            const b = bubble(r, s);
            ctx.fillStyle = "#fff";
            ctx.fill(b.fill);
            ctx.fill(b.tipFill);
            ctx.strokeStyle = "#000";
            ctx.lineWidth = 2;
            ctx.stroke(b.outline);
            ctx.stroke(b.tipLine);
            break;
        }
        case "cutout": {
            // The same bubble, but cut out — those pixels become see-through.
            const b = bubble(r, s);
            ctx.globalCompositeOperation = "destination-out";
            ctx.fillStyle = "#000";
            ctx.fill(b.fill);
            ctx.fill(b.tipFill);
            ctx.lineWidth = 2;
            ctx.strokeStyle = "#000";
            ctx.stroke(b.tipLine);
            break;
        }
    }
    ctx.restore();
}
