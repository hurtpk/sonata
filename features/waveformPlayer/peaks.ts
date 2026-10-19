/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The waveform of an audio file: its loudest points in small slices, per
// channel. Worked out once per file and kept for the session.

export interface Peaks { channels: Float32Array[]; duration: number; }

const BUCKETS = 1000;
/** Bigger files keep Discord's normal look (a flat placeholder) rather than decoding megabytes of audio. */
export const MAX_BYTES = 60 * 1024 * 1024;

const cache = new Map<string, Promise<Peaks | null>>();
let ctx: AudioContext | null = null;

async function compute(url: string): Promise<Peaks | null> {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    ctx ??= new AudioContext();
    const audio = await ctx.decodeAudioData(buf);
    const n = Math.min(audio.numberOfChannels, 2);
    const channels: Float32Array[] = [];
    for (let c = 0; c < n; c++) {
        const data = audio.getChannelData(c);
        const out = new Float32Array(BUCKETS);
        const per = data.length / BUCKETS;
        for (let b = 0; b < BUCKETS; b++) {
            let max = 0;
            const start = Math.floor(b * per), end = Math.min(data.length, Math.floor((b + 1) * per));
            // Sampling every few points is plenty for a picture and keeps long files quick.
            const step = Math.max(1, Math.floor((end - start) / 400));
            for (let i = start; i < end; i += step) { const v = Math.abs(data[i]); if (v > max) max = v; }
            out[b] = max;
        }
        channels.push(out);
    }
    // Scale so quiet recordings still show a shape.
    const top = Math.max(0.05, ...channels.map(ch => ch.reduce((m, v) => Math.max(m, v), 0)));
    channels.forEach(ch => { for (let i = 0; i < ch.length; i++) ch[i] /= top; });
    return { channels, duration: audio.duration };
}

export function getPeaks(url: string): Promise<Peaks | null> {
    let p = cache.get(url);
    if (!p) {
        p = compute(url).catch(() => null);
        cache.set(url, p);
    }
    return p;
}

/** Whether the two channels really differ (so showing them separately means something). */
export function isStereo(p: Peaks) {
    if (p.channels.length < 2) return false;
    const [l, r] = p.channels;
    let diff = 0, sum = 0;
    for (let i = 0; i < l.length; i++) { diff += Math.abs(l[i] - r[i]); sum += l[i] + r[i]; }
    return sum > 0 && diff / sum > 0.04;
}
