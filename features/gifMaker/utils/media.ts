/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Loading pictures, videos and GIFs from chat (or from your computer) so the
// editor can draw them onto a canvas without it being "tainted".

import { sleep } from "@utils/misc";
import type { PluginNative } from "@utils/types";
import { decompressFrames, parseGIF } from "gifuct-js";

const ALLOWED_MEDIA_HOSTS = new Set([
    "cdn.discordapp.com",
    "images-ext-1.discordapp.net",
    "images-ext-2.discordapp.net",
    "media.discordapp.net",
    "media.tenor.com",
    "tenor.com",
    "media.giphy.com",
    "media0.giphy.com",
    "media1.giphy.com",
    "media2.giphy.com",
    "media3.giphy.com",
    "media4.giphy.com",
]);

// Left exactly as upstream: native helpers are keyed by plugin name
// ("GifMaker"), so this lowercase lookup never finds one and GifMaker always
// uses the normal fetch below. That's how the built-in behaves too, so QOL
// keeps it that way rather than switching on an untested path.
const MediaNative = VencordNative?.pluginHelpers?.gifMaker as PluginNative<typeof import("../native")> | undefined;

const blobUrlMap = new WeakMap<HTMLElement, string>();

function isDiscordCdnUrl(url: string): boolean {
    try {
        return ALLOWED_MEDIA_HOSTS.has(new URL(url).hostname);
    } catch {
        return false;
    }
}

const mediaProxyParser = /^https:\/\/(?:images-ext-\d+|cdn)\.discord(?:app|cdn)\.net\/external\/[^/]+\/(?<protocol>https?)\/(?<rest>.+)$/i;

export function resolveMediaUrl(url: string): string {
    const normalized = url.startsWith("//") ? `https:${url}` : url;
    const match = normalized.match(mediaProxyParser);
    if (match?.groups) {
        const { protocol, rest } = match.groups;
        return `${decodeURIComponent(protocol)}://${decodeURIComponent(rest)}`;
    }
    return normalized;
}

async function getMediaBlobUrl(url: string): Promise<string> {
    if (MediaNative) {
        const { data, type } = await MediaNative.fetchMedia(url);
        if (data) return URL.createObjectURL(new Blob([data], { type }));
    }
    const res = await fetch(url);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
}

export async function fetchBytes(url: string): Promise<Uint8Array> {
    if (url.startsWith("blob:")) return new Uint8Array(await (await fetch(url)).arrayBuffer());
    const resolved = resolveMediaUrl(url);
    if (MediaNative) {
        const { data } = await MediaNative.fetchMedia(resolved);
        return new Uint8Array(data);
    }
    const res = await fetch(resolved);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
}

export function cleanupBlobUrl(el: HTMLElement) {
    const blobUrl = blobUrlMap.get(el);
    if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrlMap.delete(el);
    }
}

export function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Couldn't load that picture"));
        img.crossOrigin = "anonymous";

        const resolved = resolveMediaUrl(url);
        if (isDiscordCdnUrl(resolved)) {
            getMediaBlobUrl(resolved).then(blobUrl => {
                blobUrlMap.set(img, blobUrl);
                img.src = blobUrl;
            }).catch(reject);
        } else {
            img.src = resolved;
        }
    });
}

function createVideoElement(src: string): Promise<HTMLVideoElement> {
    return new Promise((resolve, reject) => {
        const v = document.createElement("video");
        v.preload = "auto";
        v.muted = true;
        v.crossOrigin = "anonymous";

        v.addEventListener("loadeddata", () => {
            const { duration, videoWidth, videoHeight } = v;
            if (!isFinite(duration) || duration <= 0 || !videoWidth || !videoHeight) {
                reject(new Error("That video couldn't be read"));
                return;
            }
            resolve(v);
        }, { once: true });

        v.addEventListener("error", () => {
            reject(new Error("That video couldn't be loaded"));
        }, { once: true });

        v.src = src;
        v.load();
    });
}

export function loadVideo(url: string): Promise<HTMLVideoElement> {
    const resolved = resolveMediaUrl(url);
    if (isDiscordCdnUrl(resolved)) {
        return getMediaBlobUrl(resolved).then(blobUrl =>
            createVideoElement(blobUrl).then(video => {
                blobUrlMap.set(video, blobUrl);
                return video;
            })
        );
    }
    return createVideoElement(resolved);
}

export function seek(video: HTMLVideoElement, t: number): Promise<void> {
    return new Promise(resolve => {
        if (Math.abs(video.currentTime - t) < 0.0005 && !video.seeking) return resolve();
        const done = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => { video.removeEventListener("seeked", done); resolve(); }, 1500);
        video.addEventListener("seeked", done, { once: true });
        video.currentTime = t;
    });
}

export function isGifUrl(url: string): boolean {
    try {
        return new URL(resolveMediaUrl(url)).pathname.toLowerCase().endsWith(".gif");
    } catch {
        return /\.gif([?#]|$)/i.test(url);
    }
}

export interface DecodedGif { width: number; height: number; frames: ImageBitmap[]; delays: number[]; }

/** Every frame of an animated GIF, composited the way a browser would play it. */
export async function decodeGif(bytes: Uint8Array, maxFrames = 400): Promise<DecodedGif> {
    const parsed = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const raw = decompressFrames(parsed, true);
    const { width, height } = parsed.lsd;

    const composite = document.createElement("canvas");
    composite.width = width;
    composite.height = height;
    const ctx = composite.getContext("2d", { willReadFrequently: true })!;
    const patch = document.createElement("canvas");
    const patchCtx = patch.getContext("2d")!;

    const frames: ImageBitmap[] = [];
    const delays: number[] = [];
    let restore: ImageData | null = null;

    for (let i = 0; i < Math.min(raw.length, maxFrames); i++) {
        const frame = raw[i];
        const prev = raw[i - 1];
        if (prev?.disposalType === 2) ctx.clearRect(prev.dims.left, prev.dims.top, prev.dims.width, prev.dims.height);
        else if (prev?.disposalType === 3 && restore) ctx.putImageData(restore, 0, 0);
        if (frame.disposalType === 3) restore = ctx.getImageData(0, 0, width, height);

        patch.width = frame.dims.width;
        patch.height = frame.dims.height;
        patchCtx.putImageData(new ImageData(new Uint8ClampedArray(frame.patch), frame.dims.width, frame.dims.height), 0, 0);
        ctx.drawImage(patch, frame.dims.left, frame.dims.top);

        frames.push(await createImageBitmap(composite));
        // Browsers play tiny delays as 100 ms, so do the same.
        delays.push(frame.delay < 20 ? 100 : frame.delay);
        if (i % 20 === 19) await sleep(0);
    }
    return { width, height, frames, delays };
}
