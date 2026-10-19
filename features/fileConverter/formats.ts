/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What a file is, and what it can be turned into.

export type Kind = "image" | "animated" | "audio" | "video" | "data" | "pdf" | "other";

export interface Target {
    id: string;
    label: string;
    /** File extension of the result. */
    ext: string;
    /** Which converter does it. */
    via: "image" | "ffmpeg" | "data" | "pdf" | "zip";
    note?: string;
}

const EXT: Record<string, Kind> = {
    png: "image", jpg: "image", jpeg: "image", jfif: "image", webp: "image", bmp: "image", ico: "image", avif: "image", svg: "image", heic: "image", heif: "image", tif: "image", tiff: "image",
    gif: "animated", apng: "animated",
    mp3: "audio", wav: "audio", ogg: "audio", oga: "audio", opus: "audio", flac: "audio", m4a: "audio", aac: "audio", wma: "audio", aiff: "audio", aif: "audio", amr: "audio", weba: "audio",
    mp4: "video", m4v: "video", webm: "video", mov: "video", mkv: "video", avi: "video", wmv: "video", flv: "video", "3gp": "video", mpg: "video", mpeg: "video", ts: "video", mts: "video", ogv: "video",
    csv: "data", tsv: "data", json: "data", yaml: "data", yml: "data", txt: "data", md: "data", markdown: "data",
    pdf: "pdf",
};

export const extOf = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
export const baseName = (name: string) => name.replace(/\.[a-z0-9]+$/i, "") || "file";

export function kindOf(file: File): Kind {
    const ext = extOf(file.name);
    if (EXT[ext]) return EXT[ext];
    const t = file.type;
    if (t === "image/gif") return "animated";
    if (t.startsWith("image/")) return "image";
    if (t.startsWith("audio/")) return "audio";
    if (t.startsWith("video/")) return "video";
    if (t === "application/pdf") return "pdf";
    if (t.startsWith("text/") || t === "application/json") return "data";
    return "other";
}

export const isHeic = (file: File) => /\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/.test(file.type);

const IMAGE_OUT: Target[] = [
    { id: "png", label: "PNG", ext: "png", via: "image", note: "Lossless, keeps transparency" },
    { id: "jpg", label: "JPG", ext: "jpg", via: "image", note: "Small photos, no transparency" },
    { id: "webp", label: "WebP", ext: "webp", via: "image", note: "Small, keeps transparency" },
    { id: "gif", label: "GIF", ext: "gif", via: "image", note: "256 colours" },
    { id: "bmp", label: "BMP", ext: "bmp", via: "image", note: "Uncompressed" },
    { id: "ico", label: "ICO", ext: "ico", via: "image", note: "Windows icon (16–256 px)" },
    { id: "pdf", label: "PDF", ext: "pdf", via: "pdf", note: "One page per image" },
];

const ANIMATED_OUT: Target[] = [
    { id: "gif", label: "GIF", ext: "gif", via: "ffmpeg", note: "Animated" },
    { id: "webp-anim", label: "WebP (animated)", ext: "webp", via: "ffmpeg", note: "Much smaller than GIF" },
    { id: "mp4", label: "MP4", ext: "mp4", via: "ffmpeg", note: "As a video — tiny" },
    { id: "webm", label: "WebM", ext: "webm", via: "ffmpeg", note: "As a video" },
    { id: "png", label: "PNG (first frame)", ext: "png", via: "image" },
    { id: "jpg", label: "JPG (first frame)", ext: "jpg", via: "image" },
    { id: "frames", label: "Every frame (ZIP of PNGs)", ext: "zip", via: "ffmpeg" },
];

const AUDIO_OUT: Target[] = [
    { id: "mp3", label: "MP3", ext: "mp3", via: "ffmpeg", note: "Plays everywhere" },
    { id: "wav", label: "WAV", ext: "wav", via: "ffmpeg", note: "Uncompressed" },
    { id: "flac", label: "FLAC", ext: "flac", via: "ffmpeg", note: "Lossless, compressed" },
    { id: "ogg", label: "OGG (Vorbis)", ext: "ogg", via: "ffmpeg" },
    { id: "opus", label: "Opus", ext: "opus", via: "ffmpeg", note: "Best quality for its size" },
    { id: "m4a", label: "M4A (AAC)", ext: "m4a", via: "ffmpeg", note: "Apple devices" },
    { id: "webm-audio", label: "WebM audio", ext: "weba", via: "ffmpeg" },
];

const VIDEO_OUT: Target[] = [
    { id: "mp4", label: "MP4", ext: "mp4", via: "ffmpeg", note: "Plays everywhere (H.264)" },
    { id: "webm", label: "WebM", ext: "webm", via: "ffmpeg", note: "VP9 + Opus" },
    { id: "mov", label: "MOV", ext: "mov", via: "ffmpeg" },
    { id: "mkv", label: "MKV", ext: "mkv", via: "ffmpeg" },
    { id: "avi", label: "AVI", ext: "avi", via: "ffmpeg", note: "For old players" },
    { id: "gif", label: "GIF", ext: "gif", via: "ffmpeg", note: "Animated, no sound" },
    { id: "webp-anim", label: "WebP (animated)", ext: "webp", via: "ffmpeg", note: "No sound" },
    { id: "mp3", label: "MP3 (just the sound)", ext: "mp3", via: "ffmpeg" },
    { id: "opus", label: "Opus (just the sound)", ext: "opus", via: "ffmpeg" },
    { id: "wav", label: "WAV (just the sound)", ext: "wav", via: "ffmpeg" },
    { id: "frame", label: "PNG (one frame)", ext: "png", via: "ffmpeg" },
    { id: "frames", label: "Frames (ZIP of PNGs, 1 per second)", ext: "zip", via: "ffmpeg" },
];

const DATA_OUT: Target[] = [
    { id: "json", label: "JSON", ext: "json", via: "data" },
    { id: "json-min", label: "JSON (minified)", ext: "json", via: "data" },
    { id: "csv", label: "CSV", ext: "csv", via: "data" },
    { id: "tsv", label: "TSV", ext: "tsv", via: "data" },
    { id: "yaml", label: "YAML", ext: "yaml", via: "data" },
    { id: "html", label: "HTML (from Markdown)", ext: "html", via: "data" },
    { id: "txt", label: "Plain text", ext: "txt", via: "data" },
];

const PDF_OUT: Target[] = [
    { id: "pdf-png", label: "PNG (each page)", ext: "png", via: "pdf" },
    { id: "pdf-jpg", label: "JPG (each page)", ext: "jpg", via: "pdf" },
    { id: "pdf-txt", label: "Text", ext: "txt", via: "pdf", note: "The words in it" },
];

const ZIP: Target = { id: "zip", label: "ZIP (all files in one)", ext: "zip", via: "zip" };

export function targetsFor(kind: Kind): Target[] {
    switch (kind) {
        case "image": return IMAGE_OUT;
        case "animated": return ANIMATED_OUT;
        case "audio": return AUDIO_OUT;
        case "video": return VIDEO_OUT;
        case "data": return DATA_OUT;
        case "pdf": return PDF_OUT;
        default: return [];
    }
}

export const zipTarget = ZIP;

// ─── Discord-ready presets ───

export interface Preset {
    id: string;
    label: string;
    blurb: string;
    /** Which kinds of file it works on. */
    kinds: Kind[];
}

export const PRESETS: Preset[] = [
    { id: "sticker", label: "Sticker", blurb: "320 × 320, under 512 KB (PNG, or animated GIF)", kinds: ["image", "animated", "video"] },
    { id: "emoji", label: "Emoji", blurb: "128 × 128, under 256 KB (still or animated)", kinds: ["image", "animated", "video"] },
    { id: "avatar", label: "Avatar", blurb: "Square 512 × 512, cropped to the middle", kinds: ["image", "animated"] },
    { id: "banner", label: "Profile banner", blurb: "680 × 240, cropped to the middle", kinds: ["image", "animated"] },
    { id: "fit10", label: "Fit under 10 MB", blurb: "Shrinks it to just under the free upload limit", kinds: ["image", "animated", "video", "audio"] },
    { id: "voice", label: "Voice-message ready", blurb: "Opus, 48 kHz — what Discord's voice messages use", kinds: ["audio", "video"] },
    { id: "rbx-icon", label: "Roblox game icon", blurb: "512 × 512, cropped to the middle — PNG", kinds: ["image", "animated"] },
    { id: "rbx-thumb", label: "Roblox thumbnail", blurb: "1920 × 1080 (16:9), cropped to fill — PNG", kinds: ["image", "animated"] },
    { id: "rbx-decal", label: "Roblox decal / image", blurb: "Up to 1024 × 1024, see-through kept — PNG", kinds: ["image", "animated"] },
    { id: "rbx-shirt", label: "Roblox shirt / pants", blurb: "The 585 × 559 clothing template size, see-through — PNG", kinds: ["image", "animated"] },
    { id: "rbx-tshirt", label: "Roblox T-shirt", blurb: "512 × 512 square, centred, see-through — PNG", kinds: ["image", "animated"] },
    { id: "loud", label: "Make it louder", blurb: "Evens out the volume to a standard loudness, without distortion", kinds: ["audio", "video"] },
    { id: "nobg", label: "Remove background", blurb: "Plain backgrounds (white, black, green screen) become see-through — PNG", kinds: ["image"] },
];

export const presetsFor = (kind: Kind) => PRESETS.filter(p => p.kinds.includes(kind));

export const MB = 1024 * 1024;

export function sizeText(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < MB) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
    return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
}

export const MIME: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", ico: "image/x-icon", pdf: "application/pdf",
    mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/ogg", m4a: "audio/mp4", weba: "audio/webm",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", avi: "video/x-msvideo",
    json: "application/json", csv: "text/csv", tsv: "text/tab-separated-values", yaml: "application/yaml", html: "text/html", txt: "text/plain", zip: "application/zip",
};
