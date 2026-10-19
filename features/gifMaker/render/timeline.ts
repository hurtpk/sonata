/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Which moments of the source become frames of the GIF, and for how long
// each one shows: trim, speed, frame rate, frame edits, then reverse or
// boomerang.

import type { EditState } from "../types";
import type { Source } from "./source";

export interface BaseFrame { t: number; delay: number; }
export interface OutFrame { t: number; delay: number; base: number; }
export interface Timeline {
    /** Frames after trim, speed and fps — what the frame editor shows. */
    base: BaseFrame[];
    /** What actually gets played and exported. */
    frames: OutFrame[];
    /** Total length in ms. */
    total: number;
}

const MAX_BASE = 300;
const MAX_OUT = 400;
/** GIFs can't show a frame for less than 20 ms (browsers slow anything shorter right down). */
const MIN_DELAY = 20;

export const defaultFps = (src: Source) => src.kind === "video" ? 15 : 20;

/** Whether anything moves on a still picture, so it needs more than one frame. */
export function isMoving(s: EditState) {
    return s.zoom !== "none" || s.particles !== "none" || s.banner !== "none" || s.filter === "glitch" || s.filter === "vhs"
        || s.texts.some(t => t.anim !== "none" || t.from > 0 || t.to < 1)
        || s.stickers.some(k => k.motion !== "none");
}

export function trimRange(src: Source, s: EditState): [number, number] {
    const d = src.duration;
    if (!d) return [0, 0];
    const start = Math.max(0, Math.min(d - 0.05, s.trimStart || 0));
    const end = s.trimEnd > 0 ? Math.max(start + 0.05, Math.min(d, s.trimEnd)) : d;
    return [start, end];
}

function baseFrames(src: Source, s: EditState): BaseFrame[] {
    const speed = Math.max(0.1, s.speed || 1);

    if (!src.duration) {
        if (!isMoving(s)) return [{ t: 0, delay: 1000 }];
        const fps = s.fps || defaultFps(src);
        const n = Math.max(2, Math.min(MAX_BASE, Math.round(s.stillLength * fps)));
        return Array.from({ length: n }, () => ({ t: 0, delay: 1000 / fps }));
    }

    const [start, end] = trimRange(src, s);

    // An animated GIF at its own timing: keep its frames, just sped up or slowed down.
    if (src.kind === "gif" && !s.fps && src.frameTimes) {
        const times = src.frameTimes;
        const out: BaseFrame[] = [];
        let pending: BaseFrame | null = null;
        for (let i = 0; i < times.length; i++) {
            const t = times[i];
            const next = times[i + 1] ?? src.duration;
            if (next <= start || t >= end) continue;
            const delay = (Math.min(next, end) - Math.max(t, start)) * 1000 / speed;
            // Fast speeds would make frames shorter than a GIF allows, so frames get merged instead.
            if (pending) pending.delay += delay;
            else pending = { t: Math.max(t, start), delay };
            if (pending.delay >= MIN_DELAY) { out.push(pending); pending = null; }
        }
        if (pending) out.push(pending);
        return thin(out);
    }

    const fps = s.fps || defaultFps(src);
    let step = speed / fps;
    let n = Math.max(1, Math.ceil((end - start) / step - 1e-6));
    if (n > MAX_BASE) { n = MAX_BASE; step = (end - start) / n; }
    const delay = (end - start) / n / speed * 1000;
    return Array.from({ length: n }, (_, i) => ({ t: start + i * step, delay: Math.max(MIN_DELAY, delay) }));
}

/** Keeps very long GIFs to a frame count that can still be exported. */
function thin(frames: BaseFrame[]): BaseFrame[] {
    if (frames.length <= MAX_BASE) return frames;
    const k = Math.ceil(frames.length / MAX_BASE);
    const out: BaseFrame[] = [];
    for (let i = 0; i < frames.length; i += k) {
        const group = frames.slice(i, i + k);
        out.push({ t: group[0].t, delay: group.reduce((a, f) => a + f.delay, 0) });
    }
    return out;
}

export function buildTimeline(src: Source, s: EditState): Timeline {
    const base = baseFrames(src, s);
    let frames: OutFrame[] = [];
    base.forEach((f, i) => {
        const edit = s.frameEdits[i];
        if (edit?.drop) return;
        const delay = f.delay * (edit?.hold ?? 1);
        for (let k = 0; k <= (edit?.dup ?? 0); k++) frames.push({ t: f.t, delay, base: i });
    });
    if (!frames.length) frames = [{ ...base[0], base: 0 }];

    if (s.playMode === "reverse") frames.reverse();
    else if (s.playMode === "boomerang" && frames.length > 2) frames = [...frames, ...frames.slice(1, -1).reverse()];

    if (frames.length > MAX_OUT) frames = frames.slice(0, MAX_OUT);
    return { base, frames, total: frames.reduce((a, f) => a + f.delay, 0) };
}

/** Changing any of these rebuilds the frame list, so frame edits stop lining up. */
export const timelineSignature = (s: EditState) => [s.trimStart, s.trimEnd, s.speed, s.fps, s.stillLength, s.slideLength].join("|");
