/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Recolouring a texture: hue, saturation, brightness, contrast, a tint, or
// inverting — see-through parts stay see-through.

export interface Recolor {
    /** −180 to 180 degrees. */
    hue: number;
    /** 0 to 200 (%), 100 = unchanged. */
    saturation: number;
    /** −100 to 100. */
    brightness: number;
    /** −100 to 100. */
    contrast: number;
    /** A colour to paint over it, and how strongly (0–100). */
    tint: string;
    tintAmount: number;
    invert: boolean;
}

export const NO_CHANGE: Recolor = { hue: 0, saturation: 100, brightness: 0, contrast: 0, tint: "#ff3366", tintAmount: 0, invert: false };
export const isUnchanged = (r: Recolor) => r.hue === 0 && r.saturation === 100 && r.brightness === 0 && r.contrast === 0 && (r.tintAmount === 0) && !r.invert;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
}

function hue2rgb(p: number, q: number, t: number) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    if (s === 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

const hex = (h: string): [number, number, number] => {
    const m = h.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [1, 1, 1];
};

/** A recoloured copy of the picture. */
export function recolor(src: ImageData, o: Recolor): ImageData {
    const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
    const d = out.data;
    const dh = o.hue / 360, sat = o.saturation / 100, bri = o.brightness / 100;
    const con = (o.contrast + 100) / 100;
    const [tr, tg, tb] = hex(o.tint), ta = o.tintAmount / 100;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        let r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
        if (o.invert) { r = 1 - r; g = 1 - g; b = 1 - b; }
        if (dh || sat !== 1) {
            let [h, s, l] = rgbToHsl(r, g, b);
            h = (h + dh + 1) % 1;
            s = Math.min(1, s * sat);
            [r, g, b] = hslToRgb(h, s, l);
        }
        if (con !== 1) { r = (r - 0.5) * con + 0.5; g = (g - 0.5) * con + 0.5; b = (b - 0.5) * con + 0.5; }
        if (bri) { r += bri; g += bri; b += bri; }
        if (ta) {
            // Keep the shading, swap the colour: multiply by the tint, then blend.
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            r = r * (1 - ta) + tr * lum * 1.6 * ta; g = g * (1 - ta) + tg * lum * 1.6 * ta; b = b * (1 - ta) + tb * lum * 1.6 * ta;
        }
        d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255;
    }
    return out;
}

export async function decode(bytes: Uint8Array): Promise<ImageData> {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext("2d")!;
    x.drawImage(bmp, 0, 0);
    return x.getImageData(0, 0, c.width, c.height);
}

export async function encodePng(img: ImageData): Promise<Uint8Array> {
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    c.getContext("2d")!.putImageData(img, 0, 0);
    const blob: Blob = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("Couldn't save the picture")), "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
}
