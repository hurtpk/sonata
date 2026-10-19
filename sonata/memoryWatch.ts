/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What Discord's window memory is made of, and how it changes over time —
// so a leak shows up as a line going up, and the breakdown says whether it's
// JavaScript (code holding on to things), pictures, canvases or the page.

import { getMemory } from "./cache";

export interface Breakdown {
    /** JavaScript memory in use (MB). */
    js: number;
    /** How much JavaScript memory Discord has reserved (MB). */
    jsReserved: number;
    images: number;
    /** Rough memory for the pictures on screen, decoded (MB). */
    imageMb: number;
    gifs: number;
    canvases: number;
    canvasMb: number;
    videos: number;
    elements: number;
}

export interface Sample { at: number; window: number; js: number; }

const MB = 1024 * 1024;
const samples: Sample[] = [];
let timer: ReturnType<typeof setInterval> | undefined;

export function breakdown(): Breakdown {
    const mem = (performance as any).memory;
    let imageBytes = 0, gifs = 0;
    const imgs = document.images;
    for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i];
        imageBytes += (img.naturalWidth || 0) * (img.naturalHeight || 0) * 4;
        if (/\.gif|\.webp\?.*animated|animated=true|\/a_/i.test(img.currentSrc || img.src)) gifs++;
    }
    let canvasBytes = 0;
    const canvases = document.getElementsByTagName("canvas");
    for (let i = 0; i < canvases.length; i++) canvasBytes += canvases[i].width * canvases[i].height * 4;
    return {
        js: Math.round((mem?.usedJSHeapSize ?? 0) / MB),
        jsReserved: Math.round((mem?.totalJSHeapSize ?? 0) / MB),
        images: imgs.length,
        imageMb: Math.round(imageBytes / MB),
        gifs,
        canvases: canvases.length,
        canvasMb: Math.round(canvasBytes / MB),
        videos: document.getElementsByTagName("video").length,
        elements: document.getElementsByTagName("*").length,
    };
}

async function sample() {
    const m = await getMemory().catch(() => null);
    const win = m?.parts.find(p => p.kind === "Window")?.mb ?? 0;
    const js = Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / MB);
    samples.push({ at: Date.now(), window: win, js });
    if (samples.length > 240) samples.shift();
}

/** One reading a minute, kept for the last 4 hours. Cheap: two numbers each time. */
export function startMemoryWatch() {
    void sample();
    timer = setInterval(() => void sample(), 60_000);
}

export const stopMemoryWatch = () => clearInterval(timer);
export const memorySamples = () => samples;

/** How fast window memory has grown, in MB per hour, over the time measured (null until there's enough). */
export function growthPerHour(): number | null {
    if (samples.length < 6) return null;
    const first = samples[0], last = samples[samples.length - 1];
    const hours = (last.at - first.at) / 3_600_000;
    return hours > 0 ? Math.round((last.window - first.window) / hours) : null;
}
