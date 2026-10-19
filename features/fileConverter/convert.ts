/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// One conversion: a file plus a target (or a Discord preset) → result files.

import { zipSync } from "fflate";

import { convertData } from "./data";
import { baseName, Kind, kindOf, MB, MIME } from "./formats";
import { BgOptions, decodeImage, DEFAULT_BG, encodeImage, encodeUnder, fit, onCanvas, removeBackground } from "./image";
import { animatedFor, convertMedia, extractFrames, fitUnder, imageToPng, louder, MediaOptions, probeDuration, Status, voiceReady } from "./media";
import { imagesToPdf, pdfToImages, pdfToText } from "./pdf";

export interface Result { name: string; blob: Blob; }

export interface ImageOptions { quality: number; maxSide: number; }

const named = (name: string, data: BlobPart | Uint8Array, ext: string): Result => ({ name: `${name}.${ext}`, blob: new Blob([data as BlobPart], { type: MIME[ext] ?? "application/octet-stream" }) });

/** A still image, opened however it needs to be (HEIC, TIFF and other unusual ones included). */
async function openImage(file: File, status: Status) {
    try {
        return await decodeImage(file);
    } catch (e) {
        // Chromium can't read it (TIFF and friends): ffmpeg can.
        status("Opening it with the full converter…");
        try { return await decodeImage(await imageToPng(file, status)); } catch { throw e; }
    }
}

const zip = (name: string, files: { name: string; data: Uint8Array; }[]): Result =>
    named(name, zipSync(Object.fromEntries(files.map(f => [f.name, f.data])), { level: 0 }), "zip");

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

export async function convert(file: File, target: string, ext: string, img: ImageOptions, media: MediaOptions, status: Status): Promise<Result[]> {
    const kind = kindOf(file), name = baseName(file.name);

    // Data and PDFs.
    if (kind === "data") return [named(name, await convertData(file, target), ext)];
    if (target === "pdf-txt") { status("Reading the text…"); return [named(name, await pdfToText(file), "txt")]; }
    if (target === "pdf-png" || target === "pdf-jpg") {
        status("Opening the PDF…");
        const pages = await pdfToImages(file, target === "pdf-png" ? "png" : "jpg", (n, total) => status(`Page ${n} of ${total}…`, n / total));
        if (pages.length === 1) return [named(name, pages[0], ext)];
        return [zip(`${name} (pages)`, await Promise.all(pages.map(async (p, i) => ({ name: `${name} - page ${i + 1}.${ext}`, data: await bytes(p) }))))];
    }

    // Still images (and first frames of animated ones).
    if (kind === "image" || (kind === "animated" && (target === "png" || target === "jpg"))) {
        status("Converting…");
        const c = fit(await openImage(file, status), { maxSide: img.maxSide || undefined });
        if (target === "pdf") return [named(name, await imagesToPdf([c]), "pdf")];
        return [named(name, await encodeImage(c, target, img.quality), ext)];
    }

    // Everything else is ffmpeg's.
    if (target === "frames") {
        const frames = await extractFrames(file, kind === "animated", media, status);
        return [zip(`${name} (frames)`, frames.map((f, i) => ({ name: `${name} - ${String(i + 1).padStart(4, "0")}.png`, data: f.data })))];
    }
    const duration = kind === "video" || kind === "audio" ? await probeDuration(file, file.name, status) : null;
    if (target === "frame") {
        const at = media.start || (duration ? Math.min(1, duration / 2) : 0);
        return [named(name, await convertMedia(file, "frame", "png", { ...media, start: at, end: 0 }, status), "png")];
    }
    return [named(name, await convertMedia(file, target, ext, media, status, duration), ext)];
}

/** Several images → one PDF. */
export async function imagesIntoPdf(files: File[], img: ImageOptions, status: Status): Promise<Result> {
    const pages: HTMLCanvasElement[] = [];
    for (const [i, f] of files.entries()) {
        status(`Adding page ${i + 1} of ${files.length}…`, i / files.length);
        pages.push(fit(await openImage(f, status), { maxSide: img.maxSide || 2480 }));
    }
    return named(files.length === 1 ? baseName(files[0].name) : "Images", await imagesToPdf(pages), "pdf");
}

/** Several files → one ZIP, as they are. */
export async function zipFiles(files: File[]): Promise<Result> {
    return zip(files.length === 1 ? baseName(files[0].name) : "Files", await Promise.all(files.map(async f => ({ name: f.name, data: await bytes(f) }))));
}

/** Makes a picture, GIF, video or sound file smaller than maxBytes (as close to it as it can). */
export async function shrinkToFit(file: File, maxBytes: number, status: Status): Promise<Result> {
    const kind: Kind = kindOf(file), name = baseName(file.name);
    if (file.size <= maxBytes) return { name: file.name, blob: file };
    if (kind === "image") {
        status("Shrinking…");
        const c = await openImage(file, status);
        return named(name, await encodeUnder(c, "webp", maxBytes), "webp");
    }
    if (kind === "video" || kind === "audio" || kind === "animated") {
        const r = await fitUnder(file, kind, maxBytes, status);
        return named(name, r.data, r.ext);
    }
    throw new Error("This kind of file can't be shrunk — try zipping it");
}

/** Many results as one ZIP. */
export async function zipResults(results: Result[], name = "Converted"): Promise<Result> {
    const used = new Set<string>();
    const unique = (n: string) => { let out = n, i = 2; while (used.has(out.toLowerCase())) out = n.replace(/(\.[^.]+)?$/, ` (${i++})$1`); used.add(out.toLowerCase()); return out; };
    return zip(name, await Promise.all(results.map(async r => ({ name: unique(r.name), data: await bytes(r.blob) }))));
}

// ─── Discord presets ───

const STICKER_MAX = 512 * 1024, EMOJI_MAX = 256 * 1024;

export async function applyPreset(file: File, preset: string, status: Status, extra: { bg?: BgOptions; } = {}): Promise<Result[]> {
    const kind: Kind = kindOf(file), name = baseName(file.name);
    const moving = kind === "animated" || kind === "video";
    switch (preset) {
        case "sticker": case "emoji": {
            const side = preset === "sticker" ? 320 : 128, max = preset === "sticker" ? STICKER_MAX : EMOJI_MAX;
            if (moving) return [named(`${name} (${preset})`, await animatedFor(file, side, side, "contain", max, status), "gif")];
            status("Converting…");
            const c = fit(await openImage(file, status), { width: side, height: side, mode: "contain" });
            return [named(`${name} (${preset})`, await encodeUnder(c, "png", max), "png")];
        }
        case "avatar": case "banner": {
            const [w, h] = preset === "avatar" ? [512, 512] : [680, 240];
            if (moving) return [named(`${name} (${preset})`, await animatedFor(file, w, h, "cover", 10 * MB, status), "gif")];
            status("Converting…");
            const c = fit(await openImage(file, status), { width: w, height: h, mode: "cover" });
            return [named(`${name} (${preset})`, await encodeImage(c, "png"), "png")];
        }
        case "fit10": return [await shrinkToFit(file, 10 * MB - 64 * 1024, status)];
        case "voice": return [named(`${name} (voice)`, await voiceReady(file, status), "ogg")];
        // Roblox sizes: always PNG, so see-through parts stay see-through.
        case "rbx-icon": case "rbx-thumb": case "rbx-decal": case "rbx-shirt": case "rbx-tshirt": {
            status("Making it Roblox-ready…");
            const src = await openImage(file, status);
            const c = preset === "rbx-icon" ? fit(src, { width: 512, height: 512, mode: "cover" })
                : preset === "rbx-thumb" ? fit(src, { width: 1920, height: 1080, mode: "cover" })
                    : preset === "rbx-decal" ? fit(src, { maxSide: 1024 })
                        : preset === "rbx-shirt" ? onCanvas(src, 585, 559)
                            : onCanvas(src, 512, 512);
            const label = { "rbx-icon": "game icon", "rbx-thumb": "thumbnail", "rbx-decal": "decal", "rbx-shirt": "clothing", "rbx-tshirt": "t-shirt" }[preset];
            return [named(`${name} (Roblox ${label})`, await encodeImage(c, "png"), "png")];
        }
        case "loud": {
            if (kind !== "audio" && kind !== "video") throw new Error("Only sound and video files can be made louder");
            const r = await louder(file, kind, status);
            return [named(`${name} (louder)`, r.data, r.ext)];
        }
        case "nobg": {
            status("Removing the background…");
            const c = removeBackground(await openImage(file, status), extra.bg ?? DEFAULT_BG);
            return [named(`${name} (no background)`, await encodeImage(c, "png"), "png")];
        }
        default: throw new Error("Unknown preset");
    }
}
