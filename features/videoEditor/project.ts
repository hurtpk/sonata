/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Video Editor's project, and everything worked out from it — with no
// Discord or browser in here, so it can be tested on its own.
//
// Times: a clip's "source" time is a moment in its own file. The "edit"
// timeline is what you see in the editor: every clip's kept parts, one after
// another. Mutes, captions and blurs live on the edit timeline. Speed and
// looping happen last, so they never move those.

export type Range = [number, number];

export interface Clip {
    id: string;
    name: string;
    file: Blob;
    /** Object URL for the preview. */
    url: string;
    /** Seconds, as the browser reported it. */
    duration: number;
    width: number;
    height: number;
    /** The parts of the clip that are kept, in its own time, in order. */
    keep: Range[];
}

export interface TextItem {
    id: string;
    text: string;
    start: number;
    end: number;
    /** Centre of the text, 0–1 across and down the picture. */
    x: number;
    y: number;
    /** Letter height as a share of the picture's height. */
    size: number;
    color: string;
    style: "outline" | "box" | "shadow";
    bold: boolean;
    /** Text lines line up on x as their middle (default), left edge or right edge. */
    align?: "left" | "center" | "right";
    /** 0–1 */
    opacity?: number;
}

/** A picture, GIF or video laid over the video. */
export interface Overlay {
    id: string;
    name: string;
    file: Blob;
    url: string;
    kind: "image" | "gif" | "video";
    /** width ÷ height */
    aspect: number;
    /** Seconds (videos only). */
    duration: number;
    /** Top-left corner, 0–1; width as a share of the picture's width. */
    x: number; y: number; w: number;
    start: number;
    end: number;
    /** 0–1 */
    opacity: number;
    /** A video overlay's own sound goes in too. */
    sound: boolean;
}

/** Your name or tag in a corner, the whole way through. */
export interface Watermark { text: string; corner: "tl" | "tr" | "bl" | "br"; size: number; opacity: number; }

export type Look = "none" | "bw" | "vintage" | "warm" | "cool" | "vivid";
export type SoundPreset = "none" | "bass" | "voice" | "loud" | "radio" | "echo" | "muffled";
/** The finished video's shape. "source" = the first clip's. */
export type Frame = "source" | "16:9" | "9:16" | "1:1" | "4:5";

export const FRAME_RATIO: Record<Exclude<Frame, "source">, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5 };

export interface BlurItem {
    id: string;
    /** Top-left corner and size, 0–1 of the picture. */
    x: number; y: number; w: number; h: number;
    start: number;
    end: number;
    /** 4–40 */
    strength: number;
}

export interface Music {
    name: string;
    file: Blob;
    url: string;
    duration: number;
    /** 0–1 */
    volume: number;
    /** Where in the song to start, seconds. */
    offset: number;
}

export type SizeChoice = "best" | "smaller" | number; // a number = fit under that many MB

export interface Project {
    clips: Clip[];
    /** Fade through black where one clip meets the next. */
    joinFade: boolean;
    muteAll: boolean;
    /** Silent parts, edit time. */
    muted: Range[];
    texts: TextItem[];
    blurs: BlurItem[];
    /** 0.25–4 */
    speed: number;
    /** How many times it plays, 1–10. */
    loops: number;
    /** Fade from / to black, seconds (0 = off). */
    fadeIn: number;
    fadeOut: number;
    /** The video's own sound, 0–3 (1 = as it is). */
    volume: number;
    /** Even out loud and quiet parts. */
    normalize: boolean;
    audioFadeIn: number;
    audioFadeOut: number;
    music: Music | null;
    /** The short side's largest size, like 720 for 720p (0 = keep). */
    maxHeight: number;
    size: SizeChoice;
    /** -0.5 – 0.5 */
    brightness: number;
    /** 0.5 – 2 */
    contrast: number;
    /** 0 – 3 */
    saturation: number;
    look: Look;
    overlays: Overlay[];
    watermark: Watermark | null;
    /** A beep over the muted parts, instead of silence. */
    beep: boolean;
    soundPreset: SoundPreset;
    frame: Frame;
    /** What fills the space when a clip doesn't match the shape. */
    fill: "black" | "blur";
}

export const JOIN_FADE = 0.4;

export function emptyProject(): Project {
    return {
        clips: [], joinFade: false, muteAll: false, muted: [], texts: [], blurs: [], speed: 1, loops: 1, fadeIn: 0, fadeOut: 0, volume: 1, normalize: false, audioFadeIn: 0, audioFadeOut: 0, music: null, maxHeight: 0, size: "best",
        brightness: 0, contrast: 1, saturation: 1, look: "none", overlays: [], watermark: null, beep: false, soundPreset: "none", frame: "source", fill: "black",
    };
}

/* ── The edit timeline ── */

export interface Piece { clip: number; from: number; to: number; /** where it starts on the edit timeline */ at: number; }

export function pieces(p: Project): Piece[] {
    const out: Piece[] = [];
    let at = 0;
    p.clips.forEach((c, clip) => {
        for (const [from, to] of c.keep) {
            if (to - from < 0.01) continue;
            out.push({ clip, from, to, at });
            at += to - from;
        }
    });
    return out;
}

export const totalLength = (p: Project) => pieces(p).reduce((n, x) => n + (x.to - x.from), 0);

/** How long the finished video is: after speed and loops. */
export const outputLength = (p: Project) => totalLength(p) / p.speed * p.loops;

/** Which clip, and where in it, an edit-timeline moment is. */
export function locate(p: Project, t: number): { piece: Piece; index: number; source: number; } | null {
    const list = pieces(p);
    if (!list.length) return null;
    for (let i = 0; i < list.length; i++) {
        const x = list[i], len = x.to - x.from;
        if (t < x.at + len || i === list.length - 1) {
            const into = Math.max(0, Math.min(len, t - x.at));
            return { piece: x, index: i, source: x.from + into };
        }
    }
    return null;
}

/** Where each clip begins and ends on the edit timeline. */
export function clipSpans(p: Project): Range[] {
    const spans: Range[] = [];
    let at = 0;
    for (const c of p.clips) {
        const len = c.keep.reduce((n, [a, b]) => n + Math.max(0, b - a), 0);
        spans.push([at, at + len]);
        at += len;
    }
    return spans;
}

/* ── Editing ── */

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** A moment's new place once [a, b] has been taken out (moments inside it land on a). */
const shift = (t: number, a: number, b: number) => t <= a ? t : t >= b ? t - (b - a) : a;

function removeFromRanges(ranges: Range[], a: number, b: number): Range[] {
    return ranges.map(([s, e]) => [shift(s, a, b), shift(e, a, b)] as Range).filter(([s, e]) => e - s > 0.05);
}
function removeFromItems<T extends { start: number; end: number; }>(items: T[], a: number, b: number): T[] {
    return items.map(i => ({ ...i, start: shift(i.start, a, b), end: shift(i.end, a, b) })).filter(i => i.end - i.start > 0.05);
}

/** Takes [a, b] (edit time) out of the video — clips and everything placed on the timeline. */
export function cutOut(p: Project, a: number, b: number): Project {
    [a, b] = [Math.max(0, Math.min(a, b)), Math.min(totalLength(p), Math.max(a, b))];
    if (b - a < 0.01) return p;
    const list = pieces(p);
    const clips = p.clips.map((c, ci) => {
        const keep: Range[] = [];
        for (const x of list.filter(x => x.clip === ci)) {
            const len = x.to - x.from;
            const s = Math.max(0, a - x.at), e = Math.min(len, b - x.at);
            if (e <= 0 || s >= len) { keep.push([x.from, x.to]); continue; }
            if (s > 0.01) keep.push([x.from, x.from + s]);
            if (e < len - 0.01) keep.push([x.from + e, x.to]);
        }
        // Pieces from parts already removed (none) — and an untouched clip keeps its list.
        return { ...c, keep };
    }).filter(c => c.keep.length);
    return {
        ...p, clips,
        muted: removeFromRanges(p.muted, a, b),
        texts: removeFromItems(p.texts, a, b),
        blurs: removeFromItems(p.blurs, a, b),
        overlays: removeFromItems(p.overlays, a, b),
    };
}

/** Keeps only [a, b]. */
export function keepOnly(p: Project, a: number, b: number): Project {
    const total = totalLength(p);
    [a, b] = [Math.max(0, Math.min(a, b)), Math.min(total, Math.max(a, b))];
    return cutOut(cutOut(p, b, total), 0, a);
}

/** Takes a clip out of the video, with whatever was placed on its stretch of the timeline. */
export function removeClip(p: Project, index: number): Project {
    const [a, b] = clipSpans(p)[index] ?? [0, 0];
    const next = cutOut(p, a, b);
    // cutOut drops a clip once nothing of it is left; make sure it went even if it was 0 long.
    return next.clips.length === p.clips.length ? { ...next, clips: next.clips.filter((_, i) => i !== index) } : next;
}

/** Brings back every part of a clip that was cut. */
export function restoreClip(p: Project, index: number): Project {
    return { ...p, clips: p.clips.map((c, i) => i === index ? { ...c, keep: [[0, c.duration]] } : c) };
}

/** Adds [a, b] to the muted parts, joining any it touches. */
export function addRange(ranges: Range[], a: number, b: number): Range[] {
    const all = [...ranges, [Math.min(a, b), Math.max(a, b)] as Range].sort((x, y) => x[0] - y[0]);
    const out: Range[] = [];
    for (const r of all) {
        const last = out.at(-1);
        if (last && r[0] <= last[1] + 0.01) last[1] = Math.max(last[1], r[1]);
        else out.push([...r] as Range);
    }
    return out;
}

/** Takes [a, b] off the muted parts (unmutes it). */
export function subtractRange(ranges: Range[], a: number, b: number): Range[] {
    const out: Range[] = [];
    for (const [s, e] of ranges) {
        if (e <= a || s >= b) { out.push([s, e]); continue; }
        if (s < a) out.push([s, a]);
        if (e > b) out.push([b, e]);
    }
    return out.filter(([s, e]) => e - s > 0.01);
}

export const inRanges = (ranges: Range[], t: number) => ranges.some(([s, e]) => t >= s && t < e);

/* ── The finished video ── */

export interface ClipInfo { width: number; height: number; fps: number; hasAudio: boolean; }

export interface OutputSize { width: number; height: number; fps: number; }

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** The shape the finished video has (width ÷ height). */
export function frameRatio(p: Project, first: { width: number; height: number; } | undefined) {
    return p.frame === "source" ? (first && first.height ? first.width / first.height : 16 / 9) : FRAME_RATIO[p.frame];
}

/**
 * The finished video's size and frame rate. Its shape is the first clip's, or
 * the one picked; its short side is the first clip's, capped at maxHeight
 * (and at 1080 for a new shape, so a phone-shaped video isn't huge).
 */
export function outputSize(p: Project, infos: ClipInfo[]): OutputSize {
    const first = infos[0] ?? { width: 1280, height: 720, fps: 30 };
    const r = frameRatio(p, first);
    let short = Math.min(first.width, first.height);
    if (p.frame !== "source") short = Math.min(1080, Math.max(short, Math.round(Math.max(first.width, first.height) / Math.max(r, 1 / r))));
    if (p.maxHeight && short > p.maxHeight) short = p.maxHeight;
    const [width, height] = r >= 1 ? [short * r, short] : [short, short / r];
    return { width: even(width), height: even(height), fps: Math.min(60, Math.max(10, Math.round(first.fps || 30))) };
}

/** atempo only goes from 0.5 to 2 per step, so bigger changes are chained. */
export function atempo(speed: number): string[] {
    const out: string[] = [];
    let s = speed;
    while (s > 2.0001) { out.push("atempo=2"); s /= 2; }
    while (s < 0.4999) { out.push("atempo=0.5"); s /= 0.5; }
    if (Math.abs(s - 1) > 0.001) out.push(`atempo=${s.toFixed(4)}`);
    return out;
}

const n = (x: number) => (Math.round(x * 1000) / 1000).toString();
const between = (ranges: Range[]) => ranges.map(([a, b]) => `between(t,${n(a)},${n(b)})`).join("+");

/** ffmpeg filters for the colour settings. */
export function colourFilters(p: Project): string[] {
    const sat = p.saturation * (p.look === "vivid" ? 1.35 : 1), con = p.contrast * (p.look === "vivid" ? 1.08 : 1);
    const out: string[] = [];
    if (Math.abs(p.brightness) > 0.001 || Math.abs(con - 1) > 0.001 || Math.abs(sat - 1) > 0.001)
        out.push(`eq=brightness=${(Math.round(p.brightness * 1000) / 1000)}:contrast=${(Math.round(con * 1000) / 1000)}:saturation=${(Math.round(sat * 1000) / 1000)}`);
    if (p.look === "bw") out.push("hue=s=0");
    if (p.look === "vintage") out.push("curves=preset=vintage");
    if (p.look === "warm") out.push("colorbalance=rs=0.12:gs=0.02:bs=-0.12:rm=0.08:bm=-0.08");
    if (p.look === "cool") out.push("colorbalance=rs=-0.1:bs=0.12:rm=-0.06:bm=0.08");
    return out;
}

/** ffmpeg filters for a sound preset. */
export function soundFilters(preset: SoundPreset): string[] {
    switch (preset) {
        case "bass": return ["bass=g=9:f=110:w=0.6"];
        case "voice": return ["highpass=f=90", "equalizer=f=3000:t=q:w=1:g=4", "acompressor=threshold=0.1:ratio=3:attack=10:release=200"];
        case "loud": return ["acompressor=threshold=0.05:ratio=6:attack=5:release=120", "volume=2", "alimiter=limit=0.95"];
        case "radio": return ["highpass=f=300", "lowpass=f=3400", "acompressor=threshold=0.1:ratio=4"];
        case "echo": return ["aecho=0.8:0.7:90|180:0.35|0.2"];
        case "muffled": return ["lowpass=f=600"];
        default: return [];
    }
}

/** Where the watermark sits, as a caption. */
export function watermarkCaption(w: Watermark, total: number): TextItem {
    const left = w.corner === "tl" || w.corner === "bl", top = w.corner === "tl" || w.corner === "tr";
    return { id: "watermark", text: w.text, start: 0, end: total + 1, x: left ? 0.03 : 0.97, y: top ? 0.06 : 0.94, size: w.size, color: "#ffffff", style: "shadow", bold: true, align: left ? "left" : "right", opacity: w.opacity };
}

/** Every caption that goes in, the watermark last. */
export const allCaptions = (p: Project): TextItem[] => p.watermark?.text.trim() ? [...p.texts, watermarkCaption(p.watermark, totalLength(p))] : p.texts;

export interface Encoding { video: string[]; audio: string[]; note?: string; }

/** How hard to squeeze it, from the size you picked. */
export function encoding(p: Project, seconds: number, hasAudio: boolean): Encoding {
    const audioK = typeof p.size === "number" && p.size <= 10 ? 96 : 128;
    const audio = hasAudio ? ["-c:a", "aac", "-b:a", `${audioK}k`] : [];
    const x264 = ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"];
    if (p.size === "best") return { video: [...x264, "-crf", "20"], audio };
    if (p.size === "smaller") return { video: [...x264, "-crf", "27"], audio };
    // Fit under N MB: share the room out over every second, leaving a little spare.
    const totalK = p.size * 8192 * 0.93 / Math.max(1, seconds);
    let videoK = Math.floor(totalK - (hasAudio ? audioK : 0));
    let note: string | undefined;
    if (videoK < 120) { note = `That's a lot to fit in ${p.size} MB — it'll look rough. A shorter clip or a smaller size helps.`; videoK = 120; }
    return { video: [...x264, "-b:v", `${videoK}k`, "-maxrate", `${Math.floor(videoK * 1.3)}k`, "-bufsize", `${videoK * 2}k`], audio, note };
}

export interface Plan {
    /** Inputs in order: each clip, then the music, then one picture per caption. */
    filter: string;
    maps: string[];
    hasAudio: boolean;
    /** Length of one play-through (after speed), seconds. */
    seconds: number;
}

/**
 * The ffmpeg filter graph for the whole edit. `infos` are per clip; captions
 * are pictures the size of the video (input 1+clips+music onward).
 */
export function buildPlan(p: Project, infos: ClipInfo[], out: OutputSize, overlayAudio: boolean[] = []): Plan {
    const list = pieces(p);
    const total = totalLength(p);
    const g: string[] = [];
    const { width: W, height: H, fps } = out;
    const fmt = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";
    const sourceAudio = !p.muteAll && p.volume > 0 && infos.some(i => i.hasAudio);
    const firstOverlay = p.clips.length + (p.music ? 1 : 0);
    const overlaySounds = p.overlays.map((o, k) => ({ o, input: firstOverlay + k })).filter(({ o }, k) => o.kind === "video" && o.sound && overlayAudio[k]);
    const mainAudio = sourceAudio || overlaySounds.length > 0;
    const hasAudio = mainAudio || !!p.music;

    // Every input can only be read once, so clips used for several pieces are split.
    p.clips.forEach((_, ci) => {
        const k = list.filter(x => x.clip === ci).length;
        if (!k) return;
        g.push(k > 1 ? `[${ci}:v]split=${k}${Array.from({ length: k }, (_, j) => `[c${ci}v${j}]`).join("")}` : `[${ci}:v]null[c${ci}v0]`);
        if (sourceAudio && infos[ci]?.hasAudio) g.push(k > 1 ? `[${ci}:a]asplit=${k}${Array.from({ length: k }, (_, j) => `[c${ci}a${j}]`).join("")}` : `[${ci}:a]anull[c${ci}a0]`);
    });

    const used = new Map<number, number>();
    const pads: string[] = [];
    list.forEach((x, i) => {
        const j = used.get(x.clip) ?? 0;
        used.set(x.clip, j + 1);
        const len = x.to - x.from;
        const firstOfClip = !list.some((y, k) => k < i && y.clip === x.clip);
        const lastOfClip = !list.some((y, k) => k > i && y.clip === x.clip);
        const fadeIn = p.joinFade && firstOfClip && x.clip > 0 && len > JOIN_FADE * 2;
        const fadeOut = p.joinFade && lastOfClip && x.clip < p.clips.length - 1 && len > JOIN_FADE * 2;
        const tail = [
            "setsar=1", `fps=${fps}`, "format=yuv420p",
            ...(fadeIn ? [`fade=t=in:st=0:d=${JOIN_FADE}`] : []),
            ...(fadeOut ? [`fade=t=out:st=${n(len - JOIN_FADE)}:d=${JOIN_FADE}`] : []),
        ];
        const cut = `trim=start=${n(x.from)}:end=${n(x.to)},setpts=PTS-STARTPTS`;
        if (p.fill === "blur") {
            // The clip, fitted, over a blurred copy of itself that fills the frame.
            const r = Math.max(4, Math.round(Math.min(W, H) / 24));
            g.push(`[c${x.clip}v${j}]${cut},split[pb${i}][pf${i}]`,
                `[pb${i}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=${r}:2[pbb${i}]`,
                `[pf${i}]scale=${W}:${H}:force_original_aspect_ratio=decrease[pff${i}]`,
                `[pbb${i}][pff${i}]overlay=(W-w)/2:(H-h)/2,${tail.join(",")}[pv${i}]`);
        } else {
            g.push(`[c${x.clip}v${j}]${cut},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,${tail.join(",")}[pv${i}]`);
        }
        pads.push(`[pv${i}]`);
        if (sourceAudio) {
            const af = [
                ...(fadeIn ? [`afade=t=in:st=0:d=${JOIN_FADE}`] : []),
                ...(fadeOut ? [`afade=t=out:st=${n(len - JOIN_FADE)}:d=${JOIN_FADE}`] : []),
            ];
            if (infos[x.clip]?.hasAudio) g.push(`[c${x.clip}a${j}]atrim=start=${n(x.from)}:end=${n(x.to)},asetpts=PTS-STARTPTS,${fmt}${af.length ? "," + af.join(",") : ""}[pa${i}]`);
            else g.push(`anullsrc=r=48000:cl=stereo,atrim=0:${n(len)},${fmt}[pa${i}]`);
            pads.push(`[pa${i}]`);
        }
    });
    g.push(`${pads.join("")}concat=n=${list.length}:v=1:a=${sourceAudio ? 1 : 0}[vj]${sourceAudio ? "[aj]" : ""}`);

    // Picture: colour, overlays, blurs, captions, fades, speed.
    let v = "vj", step = 0;
    const next = () => `v${++step}`;
    const colour = colourFilters(p);
    if (colour.length) { const done = next(); g.push(`[${v}]${colour.join(",")}[${done}]`); v = done; }
    p.overlays.forEach((o, k) => {
        const ow = even(o.w * W), oh = even(o.w * W / (o.aspect || 1));
        const ox = Math.round(o.x * W), oy = Math.round(o.y * H);
        const src = [
            ...(o.kind === "image" ? [] : [`trim=duration=${n(Math.max(0.1, o.end - o.start))}`]),
            `setpts=PTS-STARTPTS+${n(o.start)}/TB`, `scale=${ow}:${oh}`, "format=rgba",
            ...(o.opacity < 0.999 ? [`colorchannelmixer=aa=${n(o.opacity)}`] : []),
        ];
        const pic = next(), done = next();
        g.push(`[${firstOverlay + k}:v]${src.join(",")}[${pic}]`, `[${v}][${pic}]overlay=${ox}:${oy}:enable='${between([[o.start, o.end]])}'[${done}]`);
        v = done;
    });
    for (const b of p.blurs) {
        const bw = even(b.w * W), bh = even(b.h * H), bx = Math.round(b.x * W), by = Math.round(b.y * H);
        const r = Math.max(1, Math.min(Math.round(b.strength), Math.floor(Math.min(bw, bh) / 2) - 1));
        const main = next(), src = next(), blurred = next(), done = next();
        g.push(`[${v}]split[${main}][${src}]`, `[${src}]crop=${bw}:${bh}:${bx}:${by},boxblur=${r}:2[${blurred}]`, `[${main}][${blurred}]overlay=${bx}:${by}:enable='${between([[b.start, b.end]])}'[${done}]`);
        v = done;
    }
    const firstCaption = firstOverlay + p.overlays.length;
    allCaptions(p).forEach((t, i) => {
        const done = next();
        g.push(`[${v}][${firstCaption + i}:v]overlay=0:0:enable='${between([[t.start, t.end]])}'[${done}]`);
        v = done;
    });
    const vEnd = [
        ...(p.fadeIn > 0 ? [`fade=t=in:st=0:d=${n(p.fadeIn)}`] : []),
        ...(p.fadeOut > 0 ? [`fade=t=out:st=${n(Math.max(0, total - p.fadeOut))}:d=${n(p.fadeOut)}`] : []),
        ...(p.speed !== 1 ? [`setpts=PTS/${n(p.speed)}`] : []),
    ];
    g.push(`[${v}]${vEnd.length ? vEnd.join(",") : "null"}[vout]`);

    const seconds = total / p.speed;

    // Sound: muted parts, volume, fades, speed, evening out — then the music under it.
    if (hasAudio) {
        let a: string | null = null;
        if (mainAudio) {
            if (!sourceAudio) g.push(`anullsrc=r=48000:cl=stereo,atrim=0:${n(total)},${fmt}[aj]`);
            // The video's sound with its muted parts silent, then the overlays' sound mixed in.
            const mixIn: string[] = [];
            g.push(`[aj]${sourceAudio && p.muted.length ? `volume=volume=0:enable='${between(p.muted)}'` : "anull"}[am]`);
            for (const { o, input } of overlaySounds) {
                const ms = Math.round(o.start * 1000);
                g.push(`[${input}:a]atrim=0:${n(Math.max(0.1, o.end - o.start))},asetpts=PTS-STARTPTS,${fmt},adelay=${ms}|${ms}[os${input}]`);
                mixIn.push(`[os${input}]`);
            }
            if (mixIn.length) g.push(`[am]${mixIn.join("")}amix=inputs=${mixIn.length + 1}:duration=first:dropout_transition=0:normalize=0[amx]`);
            const base = mixIn.length ? "amx" : "am";
            // Volume and the preset first, then the beep (so the preset never squashes it), then fades and speed.
            const pre = [
                ...(Math.abs(p.volume - 1) > 0.001 ? [`volume=${n(p.volume)}`] : []),
                ...soundFilters(p.soundPreset),
            ];
            let cur = base;
            if (pre.length) { g.push(`[${base}]${pre.join(",")},${fmt}[apre]`); cur = "apre"; }
            if (p.beep && p.muted.length) {
                // ffmpeg's sine is 1/8 loud; ×2.2 puts the beep at about -14 dB, like a TV bleep.
                g.push(`sine=frequency=1000:sample_rate=48000,atrim=0:${n(total)},${fmt},volume='2.2*(${between(p.muted)})':eval=frame[beep]`);
                g.push(`[${cur}][beep]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[abp]`);
                cur = "abp";
            }
            const af = [
                ...(p.audioFadeIn > 0 ? [`afade=t=in:st=0:d=${n(p.audioFadeIn)}`] : []),
                ...(p.audioFadeOut > 0 ? [`afade=t=out:st=${n(Math.max(0, total - p.audioFadeOut))}:d=${n(p.audioFadeOut)}`] : []),
                ...atempo(p.speed),
                ...(p.normalize ? ["loudnorm=I=-16:TP=-1.5:LRA=11"] : []),
            ];
            g.push(`[${cur}]${af.length ? af.join(",") : "anull"},${fmt}[orig]`);
            a = "orig";
        }
        if (p.music) {
            const m = p.clips.length;
            g.push(`[${m}:a]atrim=start=${n(p.music.offset)},asetpts=PTS-STARTPTS,${fmt},volume=${n(p.music.volume)},apad,atrim=0:${n(seconds)}[mus]`);
            if (a) g.push(`[${a}][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`);
            else g.push("[mus]anull[aout]");
        } else g.push(`[${a}]anull[aout]`);
    }

    return { filter: g.join(";"), maps: ["-map", "[vout]", ...(hasAudio ? ["-map", "[aout]"] : [])], hasAudio, seconds };
}

/** Reads what ffmpeg printed about a file: its picture size, frame rate, and whether it has sound. */
export function parseProbe(lines: string[]): ClipInfo {
    const video = lines.find(l => /Stream #\d+:\d+.*Video:/.test(l)) ?? "";
    const size = video.match(/, (\d{2,5})x(\d{2,5})[, []/);
    const fps = video.match(/, ([\d.]+) (?:fps|tbr)/);
    let width = size ? Number(size[1]) : 0, height = size ? Number(size[2]) : 0;
    // Phone videos are often stored sideways with a "rotate" note; ffmpeg turns them upright.
    const rotate = lines.find(l => /rotate\s*:\s*-?(90|270)|displaymatrix: rotation of -?90/.test(l));
    if (rotate) [width, height] = [height, width];
    return { width, height, fps: fps ? Number(fps[1]) : 30, hasAudio: lines.some(l => /Stream #\d+:\d+.*Audio:/.test(l)) };
}
