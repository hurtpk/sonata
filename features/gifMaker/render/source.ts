/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What a GIF is made from: a still picture, an animated GIF, a video, or a
// slideshow of several pictures. Every source answers "what does it look
// like at time t?" synchronously, once the frames it needs are decoded, so
// the live preview and the exporter can draw any frame instantly.

import { cleanupBlobUrl, decodeGif, fetchBytes, isGifUrl, loadImage, loadVideo, seek } from "../utils/media";

export interface MediaInput { url: string; isVideo: boolean; isGif?: boolean; }

export interface Source {
    kind: "image" | "gif" | "video" | "slides";
    width: number;
    height: number;
    /** Seconds; 0 for a still picture. */
    duration: number;
    /** Start time of every frame, for GIFs (so "original" timing can be kept). */
    frameTimes?: number[];
    /** Decode the frames for these times (videos only need this). */
    prepare(times: number[], onProgress?: (done: number, total: number) => void): Promise<void>;
    frameAt(t: number): CanvasImageSource | null;
    /** Small pictures of these moments, for the trim strip. */
    thumbs(times: number[], height: number): Promise<string[]>;
    /** Slideshows: seconds per picture and the crossfade. */
    configure?(slideLength: number, crossfade: number): void;
    /** Slideshows: add or remove pictures. */
    slides?: HTMLImageElement[];
    dispose(): void;
}

/** Decoded video frames are kept within this budget (bytes). */
const VIDEO_BUDGET = 320 * 1024 * 1024;
const VIDEO_MAX_SIDE = 800;
const SLIDE_MAX_SIDE = 800;

function snapshot(img: CanvasImageSource | null, w: number, h: number, height: number) {
    const c = document.createElement("canvas");
    c.height = height;
    c.width = Math.max(1, Math.round(height * w / h));
    if (img) c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.7);
}

/** Thumbnails for sources whose frames are always ready. */
function readyThumbs(this: Source, times: number[], height: number) {
    return Promise.resolve(times.map(t => snapshot(this.frameAt(t), this.width, this.height, height)));
}

const fit = (w: number, h: number, max: number) => {
    const s = Math.min(1, max / Math.max(w, h));
    return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))] as const;
};

async function imageSource(url: string): Promise<Source> {
    const img = await loadImage(url);
    const bitmap = await createImageBitmap(img);
    cleanupBlobUrl(img);
    return {
        kind: "image",
        width: bitmap.width,
        height: bitmap.height,
        duration: 0,
        prepare: async () => { },
        frameAt: () => bitmap,
        thumbs: readyThumbs,
        dispose: () => bitmap.close(),
    };
}

async function gifSource(url: string): Promise<Source> {
    const gif = await decodeGif(await fetchBytes(url));
    if (gif.frames.length <= 1) {
        const [frame] = gif.frames;
        return { kind: "image", width: gif.width, height: gif.height, duration: 0, prepare: async () => { }, frameAt: () => frame ?? null, thumbs: readyThumbs, dispose: () => frame?.close() };
    }
    const times: number[] = [];
    let total = 0;
    for (const d of gif.delays) { times.push(total / 1000); total += d; }
    const duration = total / 1000;
    const frameAt = (t: number) => {
        // Binary search for the frame showing at t.
        let lo = 0, hi = times.length - 1;
        const tt = Math.max(0, Math.min(duration, t));
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (times[mid] <= tt + 1e-6) lo = mid; else hi = mid - 1;
        }
        return gif.frames[lo];
    };
    return {
        kind: "gif",
        width: gif.width,
        height: gif.height,
        duration,
        frameTimes: times,
        prepare: async () => { },
        frameAt,
        thumbs: readyThumbs,
        dispose: () => gif.frames.forEach(f => f.close()),
    };
}

async function videoSource(url: string): Promise<Source> {
    const video = await loadVideo(url);
    const { duration } = video;
    let [w, h] = fit(video.videoWidth, video.videoHeight, VIDEO_MAX_SIDE);
    const cache = new Map<number, ImageBitmap>();
    let queue = Promise.resolve();
    let generation = 0;
    const key = (t: number) => Math.round(t * 1000);

    const prepare = (times: number[], onProgress?: (done: number, total: number) => void) => {
        const gen = ++generation;
        // Shrink the decoded size if a long clip would use too much memory.
        const perFrame = VIDEO_BUDGET / Math.max(1, times.length);
        if (w * h * 4 > perFrame) {
            const s = Math.sqrt(perFrame / (w * h * 4));
            [w, h] = [Math.max(16, Math.floor(w * s)), Math.max(16, Math.floor(h * s))];
            cache.forEach(b => b.close());
            cache.clear();
        }
        // Forget frames that aren't needed any more.
        const wanted = new Set(times.map(key));
        for (const [k, b] of cache) if (!wanted.has(k)) { b.close(); cache.delete(k); }

        const missing = [...wanted].filter(k => !cache.has(k)).sort((a, b) => a - b);
        queue = queue.then(async () => {
            let done = wanted.size - missing.length;
            onProgress?.(done, wanted.size);
            for (const k of missing) {
                if (gen !== generation) return;
                await seek(video, Math.min(duration - 0.001, k / 1000));
                try {
                    cache.set(k, await createImageBitmap(video, { resizeWidth: w, resizeHeight: h, resizeQuality: "medium" }));
                } catch { /* a frame the browser couldn't give us; the nearest one is used */ }
                onProgress?.(++done, wanted.size);
            }
        });
        return queue;
    };

    const frameAt = (t: number) => {
        const k = key(t);
        const hit = cache.get(k);
        if (hit) return hit;
        let best: ImageBitmap | null = null, dist = Infinity;
        for (const [ck, b] of cache) {
            const d = Math.abs(ck - k);
            if (d < dist) { dist = d; best = b; }
        }
        return best;
    };

    const thumbs = (times: number[], height: number) => {
        const out: string[] = [];
        const job = queue.then(async () => {
            for (const t of times) {
                await seek(video, Math.min(duration - 0.001, t));
                out.push(snapshot(video, video.videoWidth, video.videoHeight, height));
            }
            return out;
        });
        queue = job.then(() => { });
        return job;
    };

    return {
        kind: "video",
        get width() { return w; },
        get height() { return h; },
        duration,
        prepare,
        frameAt,
        thumbs,
        dispose: () => {
            generation++;
            cache.forEach(b => b.close());
            cache.clear();
            cleanupBlobUrl(video);
            video.removeAttribute("src");
            video.load();
        },
    };
}

/** A slideshow of pictures, each shown for a while with a crossfade between them. */
export async function slidesSource(urls: string[]): Promise<Source> {
    const slides = (await Promise.all(urls.map(u => loadImage(u).catch(() => null)))).filter(Boolean) as HTMLImageElement[];
    if (!slides.length) throw new Error("None of those pictures could be loaded");
    const [w, h] = fit(slides[0].naturalWidth, slides[0].naturalHeight, SLIDE_MAX_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    let length = 1.5, fade = 0.4;

    const cover = (img: HTMLImageElement, alpha: number) => {
        const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
        const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
        ctx.globalAlpha = alpha;
        ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
        ctx.globalAlpha = 1;
    };

    const source: Source = {
        kind: "slides",
        width: w,
        height: h,
        get duration() { return source.slides!.length * length; },
        slides,
        configure(l, f) { length = Math.max(0.2, l); fade = Math.max(0, Math.min(f, length / 2)); },
        prepare: async () => { },
        thumbs: readyThumbs,
        frameAt(t) {
            const list = source.slides!;
            if (!list.length) return null;
            const total = list.length * length;
            const tt = ((t % total) + total) % total;
            const i = Math.min(list.length - 1, Math.floor(tt / length));
            const into = tt - i * length;
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, w, h);
            cover(list[i], 1);
            // Crossfade into the next picture (the last one fades back into the first, so it loops).
            if (fade > 0 && list.length > 1 && into > length - fade) cover(list[(i + 1) % list.length], (into - (length - fade)) / fade);
            return canvas;
        },
        dispose: () => source.slides!.forEach(cleanupBlobUrl),
    };
    return source;
}

export async function loadSource(inputs: MediaInput[]): Promise<Source> {
    const stills = inputs.filter(i => !i.isVideo);
    if (inputs.length > 1 && stills.length > 1) return slidesSource(stills.map(i => i.url));
    const [first] = inputs;
    if (!first) throw new Error("Nothing to make a GIF from");
    if (first.isVideo) return videoSource(first.url);
    if (first.isGif ?? isGifUrl(first.url)) {
        try {
            return await gifSource(first.url);
        } catch { /* not really a GIF — try it as a picture */ }
    }
    return imageSource(first.url);
}
