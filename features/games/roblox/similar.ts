/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// How alike two items are: their 3D shapes (after sizing both the same, so a
// rescaled copy still matches) and their textures (a small fingerprint of
// each picture, so a recompressed or slightly edited copy still matches).

import type { RobloxMesh } from "./mesh";

export const sameBytes = (a?: Uint8Array, b?: Uint8Array) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

/** Every corner of the mesh, moved to the middle and sized to fit a 1×1×1 box (a few thousand of them at most). */
function normalised(m: RobloxMesh, most = 5000) {
    const p = m.positions;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[i + k]); max[k] = Math.max(max[k], p[i + k]); }
    const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
    const n = p.length / 3, step = Math.max(1, Math.floor(n / most));
    const pts: number[] = [];
    for (let v = 0; v < n; v += step) for (let k = 0; k < 3; k++) pts.push((p[v * 3 + k] - (min[k] + max[k]) / 2) / size);
    return { pts, dims: [0, 1, 2].map(k => (max[k] - min[k]) / size) };
}

/** A lookup of points by grid cell, for finding near neighbours fast. */
function bucket(pts: number[], cell: number) {
    const map = new Map<string, number[]>();
    for (let i = 0; i < pts.length; i += 3) {
        const key = `${Math.floor(pts[i] / cell)},${Math.floor(pts[i + 1] / cell)},${Math.floor(pts[i + 2] / cell)}`;
        (map.get(key) ?? map.set(key, []).get(key)!).push(i);
    }
    return map;
}

/** How many of A's corners have one of B's within `tol` of them. */
function covered(a: number[], b: number[], tol: number) {
    const grid = bucket(b, tol);
    let hit = 0;
    for (let i = 0; i < a.length; i += 3) {
        const cx = Math.floor(a[i] / tol), cy = Math.floor(a[i + 1] / tol), cz = Math.floor(a[i + 2] / tol);
        let found = false;
        for (let dx = -1; dx <= 1 && !found; dx++) for (let dy = -1; dy <= 1 && !found; dy++) for (let dz = -1; dz <= 1 && !found; dz++) {
            for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
                if (Math.hypot(a[i] - b[j], a[i + 1] - b[j + 1], a[i + 2] - b[j + 2]) <= tol) { found = true; break; }
            }
        }
        if (found) hit++;
    }
    return hit / Math.max(1, a.length / 3);
}

export interface ShapeMatch { score: number; trisA: number; trisB: number; vertsA: number; vertsB: number; proportions: number; }

/** 0–100: how much of the two shapes lines up — each corner of one near a corner of the other (within 2% of their size). */
export function compareShapes(a: RobloxMesh, b: RobloxMesh): ShapeMatch {
    const A = normalised(a), B = normalised(b);
    const tol = 0.02;
    const score = (covered(A.pts, B.pts, tol) + covered(B.pts, A.pts, tol)) / 2;
    const prop = 1 - Math.min(1, A.dims.reduce((s, d, k) => s + Math.abs(d - B.dims[k]), 0) / 1.5);
    return {
        score: Math.round(score * 100),
        trisA: a.faces.length / 3, trisB: b.faces.length / 3, vertsA: a.positions.length / 3, vertsB: b.positions.length / 3,
        proportions: Math.round(prop * 100),
    };
}

export interface Fingerprint { bits: Uint8Array; color: [number, number, number]; width: number; height: number; }

/** A 256-bit picture fingerprint (which way brightness changes across a 17×16 copy), plus its average colour. */
export async function fingerprint(bytes: Uint8Array): Promise<Fingerprint | null> {
    try {
        const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
        const c = document.createElement("canvas");
        c.width = 17; c.height = 16;
        const x = c.getContext("2d", { willReadFrequently: true })!;
        x.fillStyle = "#808080"; x.fillRect(0, 0, 17, 16);
        x.drawImage(bmp, 0, 0, 17, 16);
        const d = x.getImageData(0, 0, 17, 16).data;
        const lum = (i: number) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        const bits = new Uint8Array(256);
        let r = 0, g = 0, b = 0;
        for (let y = 0; y < 16; y++) for (let k = 0; k < 16; k++) {
            const i = (y * 17 + k) * 4;
            bits[y * 16 + k] = lum(i) > lum(i + 4) ? 1 : 0;
        }
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        const n = d.length / 4;
        return { bits, color: [r / n, g / n, b / n], width: bmp.width, height: bmp.height };
    } catch { return null; }
}

/** 0–100: how alike two pictures look (pattern mostly, colour a little). */
export function compareFingerprints(a: Fingerprint, b: Fingerprint) {
    let same = 0;
    for (let i = 0; i < 256; i++) if (a.bits[i] === b.bits[i]) same++;
    const pattern = same / 256;
    const colour = 1 - Math.min(1, Math.hypot(a.color[0] - b.color[0], a.color[1] - b.color[1], a.color[2] - b.color[2]) / 255);
    // Two random pictures still agree on about half the bits, so stretch 50–100% to 0–100%.
    const p = Math.max(0, (pattern - 0.5) / 0.5);
    return { score: Math.round((p * 0.8 + colour * 0.2) * 100), pattern: Math.round(p * 100), colour: Math.round(colour * 100) };
}
