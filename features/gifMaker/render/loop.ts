/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Loop finder: looks for two moments in the clip that look almost the same
// (and are moving the same way), so trimming between them makes a GIF whose
// end flows invisibly back into its start.

import type { Source } from "./source";

const W = 32, H = 18;

export async function findLoop(src: Source, start: number, end: number, onProgress?: (k: number) => void): Promise<[number, number] | null> {
    const length = end - start;
    if (length < 1) return null;
    const step = Math.max(1 / 15, length / 200);
    const times: number[] = [];
    for (let t = start; t < end; t += step) times.push(t);
    await src.prepare(times, (d, n) => onProgress?.(d / n * 0.7));

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const thumbs = times.map(t => {
        const img = src.frameAt(t);
        ctx.clearRect(0, 0, W, H);
        if (img) ctx.drawImage(img, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        const g = new Float32Array(W * H);
        for (let i = 0; i < g.length; i++) g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
        return g;
    });
    const diff = (a: Float32Array, b: Float32Array) => {
        let s = 0;
        for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
        return s / a.length;
    };

    const minGap = Math.max(2, Math.round(0.8 / step));
    const maxGap = Math.round(Math.min(6, length) / step);
    let best: [number, number] | null = null, bestScore = Infinity;
    for (let i = 0; i < thumbs.length; i++) {
        for (let j = i + minGap; j < Math.min(thumbs.length, i + maxGap + 1); j++) {
            // The frames should match, and so should the ones just after (same motion).
            let score = diff(thumbs[i], thumbs[j]);
            if (thumbs[i + 1] && thumbs[j + 1]) score = score * 0.7 + diff(thumbs[i + 1], thumbs[j + 1]) * 0.3;
            // A tiny nudge towards longer loops when they're about as good.
            score -= (j - i) * step * 0.15;
            if (score < bestScore) { bestScore = score; best = [times[i], times[j]]; }
        }
        if (i % 20 === 0) onProgress?.(0.7 + i / thumbs.length * 0.3);
    }
    return best;
}
