/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Draws a screenshot onto a styled canvas. Uses only the browser canvas API,
// so it can be tried out on a plain test page.
//
// The screenshot goes through three steps: colour adjustments and marks
// (blur, pixelate, black out, boxes, spotlight, arrows, text) on the full
// picture, then the crop, then rotating / flipping. The result is framed with
// the background, shadow, window bar, border and caption.

export interface Gradient { id: string; name: string; colors: string[]; }

export const GRADIENTS: Gradient[] = [
    { id: "blurple", name: "Blurple", colors: ["#5865f2", "#a78bfa"] },
    { id: "sunset", name: "Sunset", colors: ["#ff9a8b", "#ff6a88", "#ff99ac"] },
    { id: "ocean", name: "Ocean", colors: ["#2193b0", "#6dd5ed"] },
    { id: "grape", name: "Grape", colors: ["#8e2de2", "#4a00e0"] },
    { id: "mint", name: "Mint", colors: ["#43e97b", "#38f9d7"] },
    { id: "peach", name: "Peach", colors: ["#f6d365", "#fda085"] },
    { id: "candy", name: "Candy", colors: ["#fbc2eb", "#a6c1ee"] },
    { id: "night", name: "Night", colors: ["#0f2027", "#203a43", "#2c5364"] },
    { id: "aurora", name: "Aurora", colors: ["#00c6ff", "#0072ff", "#7f00ff"] },
    { id: "fire", name: "Fire", colors: ["#f12711", "#f5af19"] },
    { id: "forest", name: "Forest", colors: ["#134e5e", "#71b280"] },
    { id: "graphite", name: "Graphite", colors: ["#232526", "#414345"] },
];

export type Background =
    | { kind: "gradient"; id: string; }
    | { kind: "blur"; }
    | { kind: "solid"; color: string; }
    | { kind: "none"; };

export type WindowBar = "none" | "mac" | "windows";

export type Look = "none" | "mono" | "noir" | "sepia" | "vivid" | "faded" | "cool" | "warm" | "invert";

export const LOOKS: { id: Look; name: string; filter: string; }[] = [
    { id: "none", name: "Original", filter: "" },
    { id: "mono", name: "Mono", filter: "grayscale(1)" },
    { id: "noir", name: "Noir", filter: "grayscale(1) contrast(1.35) brightness(0.9)" },
    { id: "sepia", name: "Sepia", filter: "sepia(0.85)" },
    { id: "vivid", name: "Vivid", filter: "saturate(1.5) contrast(1.1)" },
    { id: "faded", name: "Faded", filter: "saturate(0.7) contrast(0.85) brightness(1.08)" },
    { id: "cool", name: "Cool", filter: "hue-rotate(-12deg) saturate(1.1)" },
    { id: "warm", name: "Warm", filter: "sepia(0.25) saturate(1.2)" },
    { id: "invert", name: "Invert", filter: "invert(1) hue-rotate(180deg)" },
];

// ─── Photo filters (in the style of Instagram's) ───
// Each is a colour recipe: a CSS filter, then colour washes blended on top.

interface Layer { mode: GlobalCompositeOperation; alpha: number; color?: string; linear?: string[]; radial?: string[]; /** Linear gradients: corner to corner instead of top to bottom. */ diagonal?: boolean; }
export interface PhotoFilter { id: string; name: string; css: string; layers?: Layer[]; /** Text the filter can show across the middle, like its Instagram story version. */ label?: string; }

export const FILTER_GROUPS: { name: string; filters: PhotoFilter[]; }[] = [
    {
        name: "Cities",
        filters: [
            {
                id: "rio", name: "Rio de Janeiro", label: "Rio De Janeiro", css: "contrast(0.9) brightness(0.96) saturate(0.85)", layers: [
                    // Its colours: purple in the top-left corner, through magenta-pink, to orange in the bottom-right.
                    // First every colour takes on the gradient's hue (light and dark stay)…
                    { linear: ["#6b3fa3", "#b0397d", "#e8703a"], diagonal: true, mode: "color", alpha: 0.8 },
                    // …then it's blended in softly for depth…
                    { linear: ["#6b3fa3", "#b0397d", "#e8703a"], diagonal: true, mode: "soft-light", alpha: 0.55 },
                    // …and a light haze lifts the shadows into the same colours.
                    { linear: ["#6b3fa3", "#b0397d", "#e8703a"], diagonal: true, mode: "screen", alpha: 0.1 },
                ],
            },
            { id: "paris", name: "Paris", css: "brightness(1.08) contrast(0.92) saturate(0.85)", layers: [{ color: "#f6c6d0", mode: "soft-light", alpha: 0.45 }] },
            { id: "losangeles", name: "Los Angeles", css: "brightness(1.1) saturate(1.25) contrast(1.05)", layers: [{ linear: ["#ffb36b", "#ff7aa2"], mode: "soft-light", alpha: 0.4 }] },
            { id: "oslo", name: "Oslo", css: "saturate(0.7) contrast(1.05) brightness(1.05)", layers: [{ color: "#9ec6e6", mode: "soft-light", alpha: 0.5 }] },
            { id: "lagos", name: "Lagos", css: "saturate(1.35) contrast(1.1) sepia(0.15)", layers: [{ color: "#ff8a3d", mode: "soft-light", alpha: 0.35 }] },
            { id: "melbourne", name: "Melbourne", css: "contrast(0.9) brightness(1.05) sepia(0.18) saturate(1.05)", layers: [{ color: "#e7b98f", mode: "soft-light", alpha: 0.35 }] },
            { id: "jakarta", name: "Jakarta", css: "saturate(1.5) contrast(1.12) brightness(1.02)" },
            { id: "abudhabi", name: "Abu Dhabi", css: "brightness(1.06) sepia(0.25) saturate(1.2)", layers: [{ color: "#f5c25a", mode: "soft-light", alpha: 0.4 }] },
            { id: "buenosaires", name: "Buenos Aires", css: "brightness(1.12) contrast(0.9) saturate(1.1)", layers: [{ color: "#ffe0a8", mode: "soft-light", alpha: 0.45 }] },
            { id: "newyork", name: "New York", css: "grayscale(0.35) contrast(1.25) brightness(0.95)", layers: [{ color: "#6b8bb0", mode: "soft-light", alpha: 0.3 }] },
            { id: "jaipur", name: "Jaipur", css: "saturate(1.3) contrast(1.05) hue-rotate(-6deg)", layers: [{ color: "#ff5e8a", mode: "soft-light", alpha: 0.3 }] },
            { id: "cairo", name: "Cairo", css: "sepia(0.35) contrast(1.05) brightness(1.04) saturate(1.1)", layers: [{ color: "#d9a066", mode: "soft-light", alpha: 0.35 }] },
            { id: "tokyo", name: "Tokyo", css: "contrast(1.1) saturate(1.15) brightness(1.02)", layers: [{ linear: ["#6b5bff", "#ff6fb5"], mode: "soft-light", alpha: 0.35 }] },
        ],
    },
    {
        name: "Classics",
        filters: [
            { id: "clarendon", name: "Clarendon", css: "contrast(1.2) saturate(1.35)", layers: [{ color: "#7fbbe3", mode: "overlay", alpha: 0.2 }] },
            { id: "gingham", name: "Gingham", css: "brightness(1.05) hue-rotate(-10deg)", layers: [{ color: "#e6e6fa", mode: "soft-light", alpha: 1 }] },
            { id: "juno", name: "Juno", css: "contrast(1.15) saturate(1.4) brightness(1.05)", layers: [{ color: "#ffd27a", mode: "soft-light", alpha: 0.25 }] },
            { id: "lark", name: "Lark", css: "contrast(0.9) saturate(1.1) brightness(1.08)", layers: [{ color: "#22253f", mode: "color-dodge", alpha: 1 }, { color: "rgba(242,242,242,0.8)", mode: "darken", alpha: 1 }] },
            { id: "ludwig", name: "Ludwig", css: "contrast(1.05) saturate(1.1) brightness(1.05)", layers: [{ radial: ["rgba(255,255,255,0)", "rgba(0,0,0,0.35)"], mode: "multiply", alpha: 1 }] },
            { id: "valencia", name: "Valencia", css: "contrast(1.08) brightness(1.08) sepia(0.08)", layers: [{ color: "#3a0339", mode: "exclusion", alpha: 0.5 }] },
            { id: "nashville", name: "Nashville", css: "sepia(0.2) contrast(1.2) brightness(1.05) saturate(1.2)", layers: [{ color: "rgba(247,176,153,0.56)", mode: "darken", alpha: 1 }, { color: "rgba(0,70,150,0.4)", mode: "lighten", alpha: 1 }] },
            { id: "amaro", name: "Amaro", css: "hue-rotate(-10deg) contrast(0.9) brightness(1.1) saturate(1.5)" },
            { id: "rise", name: "Rise", css: "brightness(1.05) sepia(0.2) contrast(0.9) saturate(0.9)", layers: [{ radial: ["rgba(236,205,169,0.15)", "rgba(50,30,7,0.4)"], mode: "multiply", alpha: 1 }, { radial: ["rgba(232,197,152,0.8)", "rgba(0,0,0,0)"], mode: "overlay", alpha: 0.6 }] },
            { id: "hudson", name: "Hudson", css: "brightness(1.2) contrast(0.9) saturate(1.1)", layers: [{ radial: ["#a6b1ff", "#342134"], mode: "multiply", alpha: 0.5 }] },
            { id: "lofi", name: "Lo-Fi", css: "saturate(1.1) contrast(1.5)", layers: [{ radial: ["rgba(0,0,0,0)", "#222"], mode: "multiply", alpha: 0.6 }] },
            { id: "xpro2", name: "X-Pro II", css: "sepia(0.3)", layers: [{ radial: ["#e6e7e0", "rgba(43,42,161,0.6)"], mode: "color-burn", alpha: 0.45 }] },
            { id: "mayfair", name: "Mayfair", css: "contrast(1.1) saturate(1.1)", layers: [{ radial: ["rgba(255,255,255,0.8)", "rgba(255,200,200,0.6)", "#111"], mode: "overlay", alpha: 0.4 }] },
            { id: "aden", name: "Aden", css: "hue-rotate(-20deg) contrast(0.9) saturate(0.85) brightness(1.2)", layers: [{ linear: ["rgba(66,10,14,0.2)", "rgba(0,0,0,0)"], mode: "darken", alpha: 1 }] },
            { id: "perpetua", name: "Perpetua", css: "", layers: [{ linear: ["#005b9a", "#e6c13d"], mode: "soft-light", alpha: 0.5 }] },
            { id: "slumber", name: "Slumber", css: "saturate(0.66) brightness(1.05)", layers: [{ color: "rgba(69,41,12,0.4)", mode: "lighten", alpha: 1 }, { color: "rgba(125,105,24,0.5)", mode: "soft-light", alpha: 1 }] },
            { id: "willow", name: "Willow", css: "grayscale(0.5) contrast(0.95) brightness(0.9)", layers: [{ color: "#d8cdcb", mode: "color", alpha: 1 }] },
            { id: "inkwell", name: "Inkwell", css: "sepia(0.3) contrast(1.1) brightness(1.1) grayscale(1)" },
        ],
    },
];

export const ALL_FILTERS = FILTER_GROUPS.flatMap(g => g.filters);

/** The picture with a photo filter on it, mixed with the original by `strength` (0–100). */
function applyPhotoFilter(img: Source, id: string, strength: number): HTMLCanvasElement | Source {
    const f = ALL_FILTERS.find(x => x.id === id);
    if (!f || strength <= 0) return img;
    const w = img.width, h = img.height;
    const filtered = makeCanvas(w, h);
    const fctx = filtered.getContext("2d")!;
    fctx.filter = f.css || "none";
    fctx.drawImage(img, 0, 0);
    fctx.filter = "none";
    for (const l of f.layers ?? []) {
        fctx.save();
        fctx.globalCompositeOperation = l.mode;
        fctx.globalAlpha = l.alpha;
        if (l.linear) {
            const g = l.diagonal ? fctx.createLinearGradient(0, 0, w, h) : fctx.createLinearGradient(0, 0, 0, h);
            l.linear.forEach((c, i) => g.addColorStop(i / (l.linear!.length - 1), c));
            fctx.fillStyle = g;
        } else if (l.radial) {
            const g = fctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
            l.radial.forEach((c, i) => g.addColorStop(i / (l.radial!.length - 1), c));
            fctx.fillStyle = g;
        } else fctx.fillStyle = l.color ?? "transparent";
        fctx.fillRect(0, 0, w, h);
        fctx.restore();
    }
    // Keep see-through parts see-through.
    fctx.globalCompositeOperation = "destination-in";
    fctx.drawImage(img, 0, 0);

    if (strength >= 100) return filtered;
    const mixed = makeCanvas(w, h);
    const mctx = mixed.getContext("2d")!;
    mctx.drawImage(img, 0, 0);
    mctx.globalAlpha = strength / 100;
    mctx.drawImage(filtered, 0, 0);
    return mixed;
}

/** Small previews of every filter on this picture, for the filter picker. */
export function filterThumbs(img: Source, size = 64): Record<string, string> {
    const thumb = makeCanvas(size, size);
    const s = Math.max(size / img.width, size / img.height);
    thumb.getContext("2d")!.drawImage(img, (size - img.width * s) / 2, (size - img.height * s) / 2, img.width * s, img.height * s);
    const out: Record<string, string> = { none: thumb.toDataURL("image/jpeg", 0.8) };
    for (const f of ALL_FILTERS) {
        const c = applyPhotoFilter(thumb, f.id, 100) as HTMLCanvasElement;
        out[f.id] = c.toDataURL("image/jpeg", 0.8);
    }
    return out;
}

export type Aspect = "auto" | "1:1" | "4:3" | "16:9" | "9:16";

export interface StyleOptions {
    background: Background;
    /** Space around the screenshot, as a % of its average side. */
    padding: number;
    /** Corner rounding in px (at the screenshot's own size). */
    radius: number;
    /** Shadow strength 0–100. */
    shadow: number;
    windowBar: WindowBar;
    title: string;
    /** Dark or light window bar. */
    barTheme: "dark" | "light";
    /** Outline around the screenshot, 0–20. */
    border: number;
    borderColor: string;
    /** Shape of the whole picture; the background fills the extra room. */
    aspect: Aspect;
    /** Make the finished picture exactly the size of the screenshot you started with. */
    keepSize: boolean;
    /** A line of text under the screenshot. */
    caption: string;
    captionColor: string;

    // Colour adjustments, each -100–100 unless noted (0 = unchanged).
    /** A photo filter's id, or "none". */
    photoFilter: string;
    /** 0–100. */
    filterStrength: number;
    /** Show the filter's name across the picture (for filters that have one). */
    filterLabel: boolean;
    look: Look;
    brightness: number;
    contrast: number;
    saturation: number;
    /** -180–180 degrees. */
    hue: number;
    /** + warmer (orange), - cooler (blue). */
    warmth: number;
    tint: string;
    /** 0–100. */
    tintAmount: number;
    /** 0–100. */
    vignette: number;
    /** 0–100. */
    grain: number;
    /** Soft focus over the whole screenshot, 0–20. */
    soften: number;
}

export const DEFAULT_ADJUSTMENTS = {
    photoFilter: "none",
    filterStrength: 100,
    filterLabel: true,
    look: "none" as Look,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    hue: 0,
    warmth: 0,
    tint: "#5865f2",
    tintAmount: 0,
    vignette: 0,
    grain: 0,
    soften: 0,
};

export const DEFAULT_OPTIONS: StyleOptions = {
    background: { kind: "gradient", id: "blurple" },
    padding: 8,
    radius: 14,
    shadow: 55,
    windowBar: "none",
    title: "",
    barTheme: "dark",
    border: 0,
    borderColor: "#ffffff",
    aspect: "auto",
    keepSize: false,
    caption: "",
    captionColor: "#ffffff",
    ...DEFAULT_ADJUSTMENTS,
};

// ─── Edits made to this one screenshot (not remembered between screenshots) ───

export type Tool = "crop" | "draw" | "blur" | "pixelate" | "redact" | "box" | "circle" | "spotlight" | "arrow" | "text" | "sticker";
export type Brush = "pen" | "marker" | "neon" | "blur";
export type TextStyle = "outline" | "shadow" | "pill" | "plain";

/** Fonts for the text tool (all come with Windows / most systems). */
export const TEXT_FONTS: { id: string; name: string; css: string; weight: number; }[] = [
    { id: "default", name: "Discord", css: FONT_STACK(), weight: 700 },
    { id: "impact", name: "Impact", css: "Impact, \"Arial Black\", sans-serif", weight: 400 },
    { id: "comic", name: "Comic", css: "\"Comic Sans MS\", \"Comic Neue\", cursive", weight: 700 },
    { id: "serif", name: "Serif", css: "Georgia, \"Times New Roman\", serif", weight: 700 },
    { id: "mono", name: "Mono", css: "Consolas, \"Courier New\", monospace", weight: 700 },
    { id: "hand", name: "Handwriting", css: "\"Segoe Script\", \"Bradley Hand\", \"Brush Script MT\", cursive", weight: 400 },
];

function FONT_STACK() { return '"gg sans","Noto Sans","Segoe UI",sans-serif'; }
export type MarkTool = Exclude<Tool, "crop">;

export interface Rect { x: number; y: number; w: number; h: number; }

/** Something drawn on the screenshot, in the original picture's pixels. */
export interface Mark {
    tool: MarkTool; x1: number; y1: number; x2: number; y2: number; color: string; text?: string;
    /** Drawing: the stroke's points, its thickness (1–20) and brush. */
    points?: [number, number][]; size?: number; brush?: Brush;
    /** Text: font (an id from TEXT_FONTS) and look. Sticker: the emoji is in `text`. */
    font?: string; textStyle?: TextStyle;
}

export interface ImageEdits {
    /** In the original picture's pixels. */
    crop: Rect | null;
    /** Clockwise. */
    rotate: 0 | 90 | 180 | 270;
    flipH: boolean;
    flipV: boolean;
    marks: Mark[];
}

export const NO_EDITS: ImageEdits = { crop: null, rotate: 0, flipH: false, flipV: false, marks: [] };

type Source = CanvasImageSource & { width: number; height: number; };

const MAX_SIDE = 8192;
const FONT = '"gg sans","Noto Sans","Segoe UI",sans-serif';

function makeCanvas(w: number, h: number) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rr);
}

const norm = (m: { x1: number; y1: number; x2: number; y2: number; }): Rect =>
    ({ x: Math.min(m.x1, m.x2), y: Math.min(m.y1, m.y2), w: Math.abs(m.x2 - m.x1), h: Math.abs(m.y2 - m.y1) });

let noise: HTMLCanvasElement | null = null;
/** A tile of film grain, made once. */
function grainTile() {
    if (noise) return noise;
    noise = makeCanvas(160, 160);
    const ctx = noise.getContext("2d")!;
    const data = ctx.createImageData(160, 160);
    for (let i = 0; i < data.data.length; i += 4) {
        const v = Math.random() * 255;
        data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
        data.data[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    return noise;
}

/** Colour adjustments over the whole screenshot. */
function adjust(img: Source, o: StyleOptions): HTMLCanvasElement {
    const w = img.width, h = img.height;
    const c = makeCanvas(w, h);
    const ctx = c.getContext("2d")!;
    const base = o.photoFilter && o.photoFilter !== "none" ? applyPhotoFilter(img, o.photoFilter, o.filterStrength ?? 100) : img;
    const filter = [
        LOOKS.find(l => l.id === o.look)?.filter,
        o.brightness && `brightness(${1 + o.brightness / 100})`,
        o.contrast && `contrast(${1 + o.contrast / 100})`,
        o.saturation && `saturate(${1 + o.saturation / 100})`,
        o.hue && `hue-rotate(${o.hue}deg)`,
        o.soften && `blur(${(o.soften * Math.max(w, h) / 2400).toFixed(2)}px)`,
    ].filter(Boolean).join(" ");
    ctx.filter = filter || "none";
    ctx.drawImage(base, 0, 0);
    ctx.filter = "none";

    const wash = (color: string | CanvasPattern | CanvasGradient, alpha: number, mode: GlobalCompositeOperation) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.globalCompositeOperation = mode;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
    };
    if (o.warmth) wash(o.warmth > 0 ? "#ff8a00" : "#0090ff", Math.abs(o.warmth) / 100 * 0.4, "soft-light");
    if (o.tintAmount) wash(o.tint, o.tintAmount / 100, "color");
    if (o.grain) wash(ctx.createPattern(grainTile(), "repeat")!, o.grain / 100 * 0.45, "overlay");
    if (o.vignette) {
        const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(0,0,0,${(o.vignette / 100 * 0.8).toFixed(3)})`);
        wash(g, 1, "source-over");
    }
    // The filter's name across the middle, thin and white, like the story filter shows it.
    const label = o.filterLabel && ALL_FILTERS.find(f => f.id === o.photoFilter)?.label;
    if (label) {
        ctx.save();
        const size = Math.max(12, Math.min(w, h * 2) * 0.075);
        ctx.font = `300 ${size.toFixed(0)}px "Helvetica Neue", "Segoe UI Light", "Segoe UI", Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.shadowColor = "rgba(0,0,0,0.25)";
        ctx.shadowBlur = size * 0.15;
        ctx.fillText(label, w / 2, h / 2, w * 0.9);
        ctx.restore();
    }

    // The washes would colour see-through parts of the picture too; cut them back out.
    if (o.warmth || o.tintAmount || o.grain || o.vignette || label) {
        ctx.save();
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(img, 0, 0);
        ctx.restore();
    }
    return c;
}

function drawMark(c: HTMLCanvasElement, m: Mark) {
    const ctx = c.getContext("2d")!;
    const unit = Math.max(c.width, c.height) / 100;
    const r = norm(m);
    ctx.save();
    switch (m.tool) {
        case "blur": {
            const snap = makeCanvas(c.width, c.height);
            snap.getContext("2d")!.drawImage(c, 0, 0);
            ctx.beginPath();
            ctx.rect(r.x, r.y, r.w, r.h);
            ctx.clip();
            ctx.filter = `blur(${Math.max(6, unit * 1.4).toFixed(1)}px)`;
            // Twice, so nothing underneath can be read.
            ctx.drawImage(snap, 0, 0);
            ctx.drawImage(snap, 0, 0);
            break;
        }
        case "pixelate": {
            const block = Math.max(4, unit * 1.2);
            const tiny = makeCanvas(Math.ceil(r.w / block), Math.ceil(r.h / block));
            tiny.getContext("2d")!.drawImage(c, r.x, r.y, r.w, r.h, 0, 0, tiny.width, tiny.height);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, r.x, r.y, r.w, r.h);
            break;
        }
        case "redact":
            ctx.fillStyle = m.color;
            roundedRect(ctx, r.x, r.y, r.w, r.h, unit * 0.3);
            ctx.fill();
            break;
        case "draw": {
            const pts = m.points ?? [];
            if (pts.length < 1) break;
            const width = Math.max(1, (m.size ?? 4) * unit * 0.25);
            if (m.brush === "blur") {
                // The picture blurred, kept only where the brush went.
                const blurred = makeCanvas(c.width, c.height);
                const bctx = blurred.getContext("2d")!;
                bctx.filter = `blur(${Math.max(6, unit * 1.4).toFixed(1)}px)`;
                bctx.drawImage(c, 0, 0);
                bctx.drawImage(c, 0, 0);
                bctx.filter = "none";
                bctx.globalCompositeOperation = "destination-in";
                bctx.lineCap = "round";
                bctx.lineJoin = "round";
                bctx.lineWidth = width * 4;
                bctx.strokeStyle = "#000";
                bctx.beginPath();
                bctx.moveTo(pts[0][0], pts[0][1]);
                for (const p of pts.length > 1 ? pts.slice(1) : [[pts[0][0] + 0.01, pts[0][1]] as [number, number]]) bctx.lineTo(p[0], p[1]);
                bctx.stroke();
                ctx.drawImage(blurred, 0, 0);
                break;
            }
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.strokeStyle = m.color;
            ctx.lineWidth = m.brush === "marker" ? width * 2.4 : width;
            if (m.brush === "marker") { ctx.globalAlpha = 0.4; ctx.lineCap = "butt"; }
            if (m.brush === "neon") { ctx.shadowColor = m.color; ctx.shadowBlur = width * 3; }
            const path = () => {
                ctx.beginPath();
                ctx.moveTo(pts[0][0], pts[0][1]);
                if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
                // Smooth the line through the midpoints between points.
                for (let i = 1; i < pts.length - 1; i++) ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
                if (pts.length > 1) ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
                ctx.stroke();
            };
            path();
            if (m.brush === "neon") {
                // A white-hot core on top of the coloured glow.
                ctx.shadowBlur = width;
                ctx.strokeStyle = "rgba(255,255,255,0.85)";
                ctx.lineWidth = width * 0.4;
                path();
            }
            break;
        }
        case "circle":
            ctx.shadowColor = "rgba(0,0,0,0.35)";
            ctx.shadowBlur = unit * 0.6;
            ctx.strokeStyle = m.color;
            ctx.lineWidth = Math.max(2, unit * 0.45);
            ctx.beginPath();
            ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(1, r.w / 2), Math.max(1, r.h / 2), 0, 0, Math.PI * 2);
            ctx.stroke();
            break;
        case "spotlight":
            ctx.fillStyle = "rgba(0,0,0,0.6)";
            ctx.beginPath();
            ctx.rect(0, 0, c.width, c.height);
            ctx.roundRect(r.x, r.y, r.w, r.h, unit * 0.6);
            ctx.fill("evenodd");
            break;
        case "box":
            ctx.shadowColor = "rgba(0,0,0,0.35)";
            ctx.shadowBlur = unit * 0.6;
            ctx.strokeStyle = m.color;
            ctx.lineWidth = Math.max(2, unit * 0.45);
            roundedRect(ctx, r.x, r.y, r.w, r.h, unit * 0.6);
            ctx.stroke();
            break;
        case "arrow": {
            const len = Math.hypot(m.x2 - m.x1, m.y2 - m.y1);
            if (len < 1) break;
            const a = Math.atan2(m.y2 - m.y1, m.x2 - m.x1);
            const head = Math.min(len * 0.6, Math.max(10, unit * 3));
            const lw = Math.max(2, unit * 0.5);
            ctx.shadowColor = "rgba(0,0,0,0.35)";
            ctx.shadowBlur = unit * 0.6;
            ctx.strokeStyle = ctx.fillStyle = m.color;
            ctx.lineWidth = lw;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(m.x1, m.y1);
            ctx.lineTo(m.x2 - Math.cos(a) * head * 0.8, m.y2 - Math.sin(a) * head * 0.8);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(m.x2, m.y2);
            ctx.lineTo(m.x2 - Math.cos(a - 0.45) * head, m.y2 - Math.sin(a - 0.45) * head);
            ctx.lineTo(m.x2 - Math.cos(a + 0.45) * head, m.y2 - Math.sin(a + 0.45) * head);
            ctx.closePath();
            ctx.fill();
            break;
        }
        case "text": {
            if (!m.text?.trim()) break;
            const font = TEXT_FONTS.find(f => f.id === m.font) ?? TEXT_FONTS[0];
            const px = Math.max(12, unit * 0.8 * (m.size ?? 4));
            ctx.font = `${font.weight} ${px.toFixed(0)}px ${font.css}`;
            ctx.textBaseline = "middle";
            ctx.lineJoin = "round";
            const style = m.textStyle ?? "outline";
            if (style === "pill") {
                // Text on a rounded label, like an Instagram story caption.
                const tw = ctx.measureText(m.text).width;
                const padX = px * 0.45, padY = px * 0.28;
                ctx.fillStyle = m.color;
                roundedRect(ctx, m.x1 - padX, m.y1 - px / 2 - padY, tw + padX * 2, px + padY * 2, px * 0.35);
                ctx.fill();
                // Dark text on light labels, white on dark ones.
                const [r, g, b] = (m.color.match(/[0-9a-f]{2}/gi) ?? ["ff", "ff", "ff"]).map(h => parseInt(h, 16));
                ctx.fillStyle = r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#111" : "#fff";
                ctx.fillText(m.text, m.x1, m.y1);
                break;
            }
            if (style === "outline") {
                ctx.lineWidth = Math.max(2, px * 0.17);
                ctx.strokeStyle = "rgba(0,0,0,0.65)";
                ctx.strokeText(m.text, m.x1, m.y1);
            } else if (style === "shadow") {
                ctx.shadowColor = "rgba(0,0,0,0.6)";
                ctx.shadowBlur = px * 0.25;
                ctx.shadowOffsetY = px * 0.06;
            }
            ctx.fillStyle = m.color;
            ctx.fillText(m.text, m.x1, m.y1);
            break;
        }
        case "sticker": {
            if (!m.text) break;
            const px = Math.max(16, unit * 1.6 * (m.size ?? 4));
            ctx.font = `${px.toFixed(0)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.shadowColor = "rgba(0,0,0,0.3)";
            ctx.shadowBlur = px * 0.08;
            ctx.fillText(m.text, m.x1, m.y1);
            break;
        }
    }
    ctx.restore();
}

/** The screenshot with adjustments, marks, crop and rotation applied. */
export function prepareImage(img: Source, o: StyleOptions, e: ImageEdits = NO_EDITS): HTMLCanvasElement {
    let c = adjust(img, o);
    for (const m of e.marks) drawMark(c, m);

    if (e.crop) {
        const x = Math.max(0, Math.round(e.crop.x)), y = Math.max(0, Math.round(e.crop.y));
        const w = Math.min(c.width - x, Math.round(e.crop.w)), h = Math.min(c.height - y, Math.round(e.crop.h));
        if (w > 1 && h > 1) {
            const cropped = makeCanvas(w, h);
            cropped.getContext("2d")!.drawImage(c, x, y, w, h, 0, 0, w, h);
            c = cropped;
        }
    }

    if (e.rotate || e.flipH || e.flipV) {
        const side = e.rotate % 180 !== 0;
        const turned = makeCanvas(side ? c.height : c.width, side ? c.width : c.height);
        const ctx = turned.getContext("2d")!;
        ctx.translate(turned.width / 2, turned.height / 2);
        ctx.rotate(e.rotate * Math.PI / 180);
        ctx.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1);
        ctx.drawImage(c, -c.width / 2, -c.height / 2);
        c = turned;
    }
    return c;
}

/** Where a point on the prepared (cropped, turned) screenshot is on the original picture. */
export function toOriginalPoint(u: number, v: number, e: ImageEdits, origW: number, origH: number): [number, number] {
    const cw = e.crop ? e.crop.w : origW, ch = e.crop ? e.crop.h : origH;
    let x: number, y: number;
    switch (e.rotate) {
        case 90: x = v; y = ch - u; break;
        case 180: x = cw - u; y = ch - v; break;
        case 270: x = cw - v; y = u; break;
        default: x = u; y = v;
    }
    if (e.flipH) x = cw - x;
    if (e.flipV) y = ch - y;
    return [x + (e.crop?.x ?? 0), y + (e.crop?.y ?? 0)];
}

function paintBackground(ctx: CanvasRenderingContext2D, img: Source, bg: Background, w: number, h: number) {
    if (bg.kind === "none") return;
    if (bg.kind === "solid") {
        ctx.fillStyle = bg.color;
        ctx.fillRect(0, 0, w, h);
        return;
    }
    if (bg.kind === "blur") {
        // The screenshot itself, enlarged to cover, heavily blurred and darkened a touch.
        const scale = Math.max(w / img.width, h / img.height) * 1.15;
        const dw = img.width * scale, dh = img.height * scale;
        ctx.save();
        ctx.filter = `blur(${Math.round(Math.max(w, h) / 28)}px) saturate(1.3)`;
        ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
        ctx.restore();
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(0, 0, w, h);
        return;
    }
    const g = GRADIENTS.find(x => x.id === bg.id) ?? GRADIENTS[0];
    const grad = ctx.createLinearGradient(0, 0, w, h);
    g.colors.forEach((c, i) => grad.addColorStop(i / Math.max(1, g.colors.length - 1), c));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
}

function paintBar(ctx: CanvasRenderingContext2D, o: StyleOptions, x: number, y: number, w: number, barH: number, unit: number, radius: number) {
    // Big rounded corners would cut into the buttons, so they move inwards.
    const inset = Math.max(0, radius - unit * 0.6) * 0.6;
    const dark = o.barTheme === "dark";
    ctx.fillStyle = dark ? "#1e1f22" : "#f2f3f5";
    ctx.fillRect(x, y, w, barH);
    ctx.fillStyle = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)";
    ctx.fillRect(x, y + barH - Math.max(1, unit * 0.08), w, Math.max(1, unit * 0.08));

    const mid = y + barH / 2;
    if (o.windowBar === "mac") {
        ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(x + inset + unit * (1.1 + i * 0.95), mid, unit * 0.32, 0, Math.PI * 2);
            ctx.fill();
        });
    } else {
        // Minimise, maximise, close — drawn as thin strokes on the right.
        ctx.strokeStyle = dark ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.65)";
        ctx.lineWidth = Math.max(1, unit * 0.07);
        const s = unit * 0.3, gap = unit * 1.45;
        const cx = (i: number) => x + w - inset - unit * 0.95 - i * gap;
        ctx.beginPath(); ctx.moveTo(cx(2) - s, mid); ctx.lineTo(cx(2) + s, mid); ctx.stroke();
        ctx.strokeRect(cx(1) - s, mid - s, s * 2, s * 2);
        ctx.beginPath(); ctx.moveTo(cx(0) - s, mid - s); ctx.lineTo(cx(0) + s, mid + s); ctx.moveTo(cx(0) + s, mid - s); ctx.lineTo(cx(0) - s, mid + s); ctx.stroke();
    }

    if (o.title.trim()) {
        ctx.fillStyle = dark ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.7)";
        ctx.font = `600 ${Math.round(unit * 0.5)}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(o.title.trim(), x + w / 2, mid, w - unit * 8);
    }
}

const RATIOS: Record<Aspect, number | null> = { "auto": null, "1:1": 1, "4:3": 4 / 3, "16:9": 16 / 9, "9:16": 9 / 16 };

export interface Styled {
    canvas: HTMLCanvasElement;
    /** Where the screenshot (below any window bar) sits on the canvas, in canvas pixels. */
    image: Rect;
    /** Size of the prepared screenshot. */
    work: { w: number; h: number; };
}

/** The styled picture, plus where the screenshot landed on it. Big pictures are kept under the browser's canvas limit. */
export function renderStyledLayout(original: Source, o: StyleOptions, e: ImageEdits = NO_EDITS): Styled {
    const img = prepareImage(original, o, e);
    const iw = img.width, ih = img.height;
    // Bar height, dots and caption scale with the screenshot so they look the same on any size.
    const unit = Math.max(10, Math.min(iw, ih, 2400) / 36);
    const barH = o.windowBar === "none" ? 0 : Math.round(unit * 1.6);
    // The caption is sized by the picture, so it stays readable on small crops.
    const captionFont = Math.round(Math.max(unit * 1.1, Math.max(iw, ih) / 22));
    const captionH = o.caption.trim() ? Math.round(captionFont * 2.3) : 0;
    const pad = o.background.kind === "none" && o.shadow === 0 ? 0 : Math.round((iw + ih + barH) / 2 * o.padding / 100);
    // A shadow needs some room even without padding, or it's cut off.
    const shadowRoom = o.shadow > 0 ? Math.round(unit * 0.9 * o.shadow / 50) : 0;
    const margin = Math.max(pad, shadowRoom);

    // The content, then grown to the chosen shape (the original's, when keeping its size).
    const cw = iw + margin * 2, ch = ih + barH + captionH + margin * 2;
    const ratio = o.keepSize ? original.width / original.height : RATIOS[o.aspect];
    let w = cw, h = ch;
    if (ratio) {
        if (cw / ch < ratio) w = ch * ratio; else h = cw / ratio;
    }
    const scale = Math.min(o.keepSize ? original.width / w : 1, MAX_SIDE / Math.max(w, h));
    const canvas = makeCanvas(w * scale, h * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(canvas.width / w, canvas.height / h);

    paintBackground(ctx, img, o.background, w, h);

    const x = (w - cw) / 2 + margin, y = (h - ch) / 2 + margin, bw = iw, bh = ih + barH;
    const r = o.radius * Math.max(1, Math.min(iw, ih) / 900);

    if (o.shadow > 0) {
        ctx.save();
        ctx.shadowColor = `rgba(0,0,0,${0.25 + o.shadow / 250})`;
        ctx.shadowBlur = unit * 1.6 * o.shadow / 50;
        ctx.shadowOffsetY = unit * 0.45 * o.shadow / 50;
        ctx.fillStyle = "#000";
        roundedRect(ctx, x, y, bw, bh, r);
        ctx.fill();
        ctx.restore();
    }

    ctx.save();
    roundedRect(ctx, x, y, bw, bh, r);
    ctx.clip();
    if (barH) paintBar(ctx, o, x, y, bw, barH, unit, r);
    ctx.drawImage(img, x, y + barH, iw, ih);
    if (o.border > 0) {
        // Drawn on the edge and clipped, so only the inside half shows.
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = o.borderColor;
        ctx.lineWidth = o.border * unit * 0.08 * 2;
        roundedRect(ctx, x, y, bw, bh, r);
        ctx.stroke();
    }
    ctx.restore();

    if (captionH) {
        ctx.save();
        ctx.font = `600 ${captionFont}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.35)";
        ctx.shadowBlur = unit * 0.5;
        ctx.fillStyle = o.captionColor;
        ctx.fillText(o.caption.trim(), x + bw / 2, y + bh + captionH * 0.58, Math.max(bw, w - unit * 2));
        ctx.restore();
    }

    const k = canvas.width / w;
    return { canvas, image: { x: x * k, y: (y + barH) * k, w: iw * k, h: ih * k }, work: { w: iw, h: ih } };
}

export function renderStyled(img: Source, o: StyleOptions, e: ImageEdits = NO_EDITS): HTMLCanvasElement {
    return renderStyledLayout(img, o, e).canvas;
}

export function canvasToFile(canvas: HTMLCanvasElement, name = "screenshot.png"): Promise<File> {
    return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(new File([b], name, { type: "image/png" })) : reject(new Error("Couldn't make the image")), "image/png"));
}

export function loadImage(file: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That isn't an image Discord can open")); };
        img.src = url;
    });
}
