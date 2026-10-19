/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Calligraphic strokes for Sonata's flourishes: a centre line made of cubic
// curves becomes a filled stroke whose width follows a list of stations, so it
// can swell through a curve and taper to a fine point.
// Kept free of Discord so it can be tried out on its own.

export type Pt = [number, number];
/** A cubic Bézier segment: start, control 1, control 2, end. */
export type Seg = [Pt, Pt, Pt, Pt];

export interface SwashSpec {
    segs: Seg[];
    /** [position along the stroke 0–1, width] stations, smoothly blended. */
    widths: [number, number][];
}

function bez(s: Seg, t: number): Pt {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * s[0][0] + b * s[1][0] + c * s[2][0] + d * s[3][0], a * s[0][1] + b * s[1][1] + c * s[2][1] + d * s[3][1]];
}

/** Points evenly spaced along the whole centre line. */
export function sample(segs: Seg[], n: number): Pt[] {
    const dense: Pt[] = [];
    for (const s of segs) for (let i = 0; i <= 300; i++) dense.push(bez(s, i / 300));
    const lens = [0];
    for (let i = 1; i < dense.length; i++) lens.push(lens[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    const total = lens[lens.length - 1];
    const out: Pt[] = [];
    let j = 0;
    for (let k = 0; k < n; k++) {
        const target = (k / (n - 1)) * total;
        while (j < lens.length - 2 && lens[j + 1] < target) j++;
        const span = lens[j + 1] - lens[j] || 1, f = (target - lens[j]) / span;
        out.push([dense[j][0] + (dense[j + 1][0] - dense[j][0]) * f, dense[j][1] + (dense[j + 1][1] - dense[j][1]) * f]);
    }
    return out;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function widthAt(ws: [number, number][], t: number) {
    if (t <= ws[0][0]) return ws[0][1];
    for (let i = 1; i < ws.length; i++) {
        if (t <= ws[i][0]) {
            const [t0, w0] = ws[i - 1], [t1, w1] = ws[i];
            return w0 + (w1 - w0) * smooth((t - t0) / (t1 - t0 || 1));
        }
    }
    return ws[ws.length - 1][1];
}

const f2 = (n: number) => n.toFixed(2);

/** The stroke's outline as one SVG path. */
export function swashPath(s: SwashSpec, n = 400): string {
    const pts = sample(s.segs, n);
    const left: Pt[] = [], right: Pt[] = [];
    for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 2)], b = pts[Math.min(n - 1, i + 2)];
        let nx = -(b[1] - a[1]), ny = b[0] - a[0];
        const len = Math.hypot(nx, ny) || 1;
        nx /= len; ny /= len;
        const w = widthAt(s.widths, i / (n - 1)) / 2;
        left.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
        right.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
    }
    return "M" + left.map(p => `${f2(p[0])} ${f2(p[1])}`).join("L") + "L" + right.reverse().map(p => `${f2(p[0])} ${f2(p[1])}`).join("L") + "Z";
}
