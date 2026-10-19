/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A whole theme from a picture: its main colour (darkened) becomes the
// background, its most vivid colours the two accents, and the text is tinted
// to match. Bright, airy pictures make a light theme.

import { contrast, hexOf, mixHex } from "./theme";

export interface PictureColours { bg: string; text: string; muted: string; accent: string; accent2: string; light: boolean; }

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
}

function hsl(h: number, s: number, l: number) {
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return hexOf(f(0) * 255, f(8) * 255, f(4) * 255);
}

const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** The colours in a picture, as a theme. Works on any decoded <img> or bitmap. */
export function coloursFrom(img: CanvasImageSource & { width: number; height: number; }): PictureColours {
    const W = 80, H = Math.max(1, Math.round(80 * img.height / Math.max(1, img.width)));
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data;

    // Group similar colours (4 bits a channel), keeping a running average of each group.
    const groups = new Map<number, { n: number; r: number; g: number; b: number; }>();
    let lightSum = 0, count = 0;
    for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 128) continue;
        const r = px[i], gg = px[i + 1], b = px[i + 2];
        const key = (r >> 4) << 8 | (gg >> 4) << 4 | (b >> 4);
        const e = groups.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
        e.n++; e.r += r; e.g += gg; e.b += b;
        groups.set(key, e);
        lightSum += (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255;
        count++;
    }
    const list = [...groups.values()].map(e => {
        const r = e.r / e.n, gg = e.g / e.n, b = e.b / e.n;
        const [h, s, l] = rgbToHsl(r, gg, b);
        return { n: e.n, h, s, l };
    }).sort((x, y) => y.n - x.n);
    if (!list.length) return { bg: "#15131c", text: "#ece9f2", muted: "#9a95a8", accent: "#8b7bff", accent2: "#ff7ab6", light: false };

    const light = count > 0 && lightSum / count > 0.68;
    // The picture's main colour sets the mood; colourless pictures get a neutral, faintly tinted background.
    const main = list.find(e => e.s > 0.12) ?? list[0];
    const tint = Math.min(0.32, main.s * 0.55);

    // Accents: vivid, not too dark or washed out, and common enough to matter.
    const score = (e: typeof list[number]) => Math.sqrt(e.n) * e.s * (1 - Math.abs(e.l - 0.58) * 1.6);
    const vivid = list.filter(e => e.s > 0.28 && e.l > 0.25 && e.l < 0.85).sort((x, y) => score(y) - score(x));
    const first = vivid[0] ?? { ...main, s: Math.max(0.6, main.s), l: 0.6 };
    const second = vivid.find(e => hueGap(e.h, first.h) > 28) ?? { ...first, h: (first.h + 40) % 360 };
    const acc = (e: { h: number; s: number; l: number; }) => {
        let c = hsl(e.h, Math.min(0.95, Math.max(0.55, e.s)), light ? Math.min(0.5, Math.max(0.38, e.l)) : Math.min(0.68, Math.max(0.55, e.l)));
        // Buttons have white text on the accent: darken it just enough to stay readable.
        for (let i = 0; i < 12 && contrast("#ffffff", c) < 3; i++) c = mixHex(c, "#000000", 0.08);
        return c;
    };

    return light
        ? { bg: hsl(main.h, tint * 0.8, 0.955), text: hsl(main.h, 0.18, 0.13), muted: hsl(main.h, 0.1, 0.4), accent: acc(first), accent2: acc(second), light }
        : { bg: hsl(main.h, tint, 0.085), text: hsl(main.h, 0.14, 0.93), muted: hsl(main.h, 0.1, 0.64), accent: acc(first), accent2: acc(second), light };
}
