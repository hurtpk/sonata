/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type CaptionMode = "none" | "caption" | "meme" | "subtitle" | "bottombar" | "wth" | "speechbubble" | "cutout";
export type PlayMode = "normal" | "reverse" | "boomerang";
export type FilterId = "none" | "bw" | "sepia" | "vintage" | "deepfried" | "invert" | "pixelate" | "vhs" | "glitch";
export type ZoomMode = "none" | "in" | "out" | "punch";
export type CropShape = "free" | "1:1" | "16:9" | "9:16" | "4:3" | "circle";
export type ParticleId = "none" | "confetti" | "hearts" | "sparkles" | "snow" | "rain";
export type BannerId = "none" | "wasted" | "failed" | "died";
export type TextAnim = "none" | "typewriter" | "pop" | "shake" | "wave" | "rainbow";
export type StickerMotion = "none" | "bounce" | "spin" | "pulse" | "float" | "path";
export type OutputFormat = "gif" | "webp" | "video";

export interface Fill {
    mode: "solid" | "gradient";
    color: string;
    colors: string[];
    angle: number;
}

export interface TextLayer {
    id: string;
    text: string;
    /** Centre of the text, 0–1 across the picture. */
    x: number;
    y: number;
    /** Font size as a share of the picture's width, so it scales with the size. */
    size: number;
    font: string;
    fill: Fill;
    outline: string;
    outlineWidth: number;
    shadow: boolean;
    bold: boolean;
    /** Shown from/to, 0–1 along the GIF. */
    from: number;
    to: number;
    anim: TextAnim;
}

export interface Sticker {
    id: string;
    kind: "emoji" | "image";
    /** The emoji itself, or an image URL. */
    value: string;
    x: number;
    y: number;
    /** Size as a share of the picture's width. */
    size: number;
    motion: StickerMotion;
    path: [number, number][];
}

export interface Crop { x: number; y: number; w: number; h: number; }

/** One frame's edit in the frame editor (by its place on the trimmed timeline). */
export interface FrameEdit { drop?: boolean; hold?: number; dup?: number; }

/** Everything about an edit — undo, presets and "re-edit" all store this. */
export interface EditState {
    width: number;
    height: number;
    lockAspect: boolean;

    // Time
    trimStart: number;
    trimEnd: number;
    speed: number;
    fps: number;
    playMode: PlayMode;
    frameEdits: Record<number, FrameEdit>;
    /** For still pictures: how long the GIF lasts when something moves. */
    stillLength: number;
    /** For slideshows: seconds per picture, and the crossfade. */
    slideLength: number;
    crossfade: number;

    // Framing
    crop: Crop;
    cropShape: CropShape;
    rotate: 0 | 90 | 180 | 270;
    flipH: boolean;
    flipV: boolean;
    zoom: ZoomMode;
    zoomStrength: number;
    zoomX: number;
    zoomY: number;
    zoomAt: number;

    // Captions
    captionMode: CaptionMode;
    captionText: string;
    captionBottom: string;
    captionSize: number;
    fontFamily: string;
    bubbleTipX: number;
    bubbleTipY: number;
    bubbleTipBase: number;

    texts: TextLayer[];
    stickers: Sticker[];

    // Effects
    filter: FilterId;
    filterAmount: number;
    brightness: number;
    contrast: number;
    saturation: number;
    hue: number;
    blur: number;
    particles: ParticleId;
    particleDensity: number;
    banner: BannerId;
    bannerAt: number;

    // Output
    format: OutputFormat;
    colors: number;
    sizeTarget: number;
    favourite: boolean;
}

export const DEFAULT_FILL: Fill = { mode: "solid", color: "#ffffff", colors: ["#22d3ee", "#8b5cf6"], angle: 90 };

export const DEFAULT_STATE: EditState = {
    width: 256,
    height: 256,
    lockAspect: true,

    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    fps: 0,
    playMode: "normal",
    frameEdits: {},
    stillLength: 2,
    slideLength: 1.5,
    crossfade: 0.4,

    crop: { x: 0, y: 0, w: 1, h: 1 },
    cropShape: "free",
    rotate: 0,
    flipH: false,
    flipV: false,
    zoom: "none",
    zoomStrength: 0.3,
    zoomX: 0.5,
    zoomY: 0.5,
    zoomAt: 0.5,

    captionMode: "none",
    captionText: "",
    captionBottom: "",
    captionSize: 40,
    fontFamily: "Arial",
    bubbleTipX: 0.3,
    bubbleTipY: 0.3,
    bubbleTipBase: 0.1,

    texts: [],
    stickers: [],

    filter: "none",
    filterAmount: 1,
    brightness: 100,
    contrast: 100,
    saturation: 100,
    hue: 0,
    blur: 0,
    particles: "none",
    particleDensity: 1,
    banner: "none",
    bannerAt: 0.5,

    format: "gif",
    colors: 256,
    sizeTarget: 0,
    favourite: false,
};

/** The parts of an edit that make up a "style" — what a preset saves (not the trim or crop of one video). */
export const STYLE_KEYS: (keyof EditState)[] = [
    "speed", "fps", "playMode", "zoom", "zoomStrength", "captionMode", "captionSize", "fontFamily", "bubbleTipBase",
    "filter", "filterAmount", "brightness", "contrast", "saturation", "hue", "blur", "particles", "particleDensity", "banner", "bannerAt",
    "format", "colors", "sizeTarget", "texts", "stickers",
];

export interface GoogleFontAxis {
    tag: string;
    min: number;
    max: number;
}

export interface GoogleFontVariant {
    axes: GoogleFontAxis[];
}

export interface GoogleFontMetadata {
    family: string;
    displayName: string;
    authors: string[];
    category?: number;
    popularity?: number;
    variants: GoogleFontVariant[];
}
