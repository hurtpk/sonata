/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The editor's side panels: Time, Crop, Text, Effects, Stickers, Output.

import { EmojiStore, React, SelectedGuildStore, showToast, useEffect, useState } from "@webpack/common";

import { loadGoogleFont } from "../fonts";
import { CAPTION_STYLES, MEME_FONT, SERIF_FONT } from "../render/captions";
import { BANNER_FONTS, BANNERS, FILTERS, PARTICLES } from "../render/effects";
import { formatBytes, SIZE_TARGETS, videoType } from "../render/export";
import { cropAspect, rotatedSize } from "../render/frame";
import { findLoop } from "../render/loop";
import type { Source } from "../render/source";
import { type Timeline, trimRange } from "../render/timeline";
import { BUILT_IN_PRESETS, deletePreset, getPresets, Preset, savePreset } from "../store";
import { type CaptionMode, type CropShape, DEFAULT_FILL, type EditState, type Sticker, type TextLayer } from "../types";
import { loadImage } from "../utils/media";
import { Btn, cl, FillPicker, FontPicker, Range, Row, Section, Seg, Toggle } from "./controls";
import { FrameEditor } from "./timeline";

export type Tool = "none" | "zoom" | "path";

export interface PanelProps {
    s: EditState;
    set(p: Partial<EditState>): void;
    src: Source;
    timeline: Timeline;
    selText: string | null;
    setSelText(id: string | null): void;
    selSticker: string | null;
    setSelSticker(id: string | null): void;
    selFrame: number | null;
    setSelFrame(i: number | null): void;
    tool: Tool;
    setTool(t: Tool): void;
    slidesChanged(): void;
    addFiles(): void;
    applyStyle(style: Partial<EditState>): void;
}

const uid = () => Math.random().toString(36).slice(2, 9);
const pct = (v: number) => `${Math.round(v * 100)}%`;

// ─── Time ───

export function TimePanel(p: PanelProps) {
    const { s, set, src, timeline } = p;
    const [finding, setFinding] = useState<number | null>(null);
    const animated = src.duration > 0 && src.kind !== "slides";

    const loop = async () => {
        const [start, end] = trimRange(src, s);
        setFinding(0);
        try {
            const found = await findLoop(src, start, end, setFinding);
            if (found) { set({ trimStart: found[0], trimEnd: found[1], playMode: "normal" }); showToast("Trimmed to the smoothest loop", "success"); } else showToast("That part is too short to find a loop in", "message");
        } finally { setFinding(null); }
    };

    return (
        <>
            {animated && (
                <>
                    <Section title="Speed">
                        <Seg value={s.speed} onChange={speed => set({ speed })} wrap options={[0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].map(v => ({ value: v, label: `${v}×` }))} />
                    </Section>
                    <Section title="Playback">
                        <Seg value={s.playMode} onChange={playMode => set({ playMode })} options={[
                            { value: "normal", label: "▶ Normal" },
                            { value: "reverse", label: "◀ Reverse" },
                            { value: "boomerang", label: "⇄ Boomerang", title: "Forwards, then backwards — loops perfectly" },
                        ]} />
                    </Section>
                    <Section title="Frame rate" aside={<span className={cl("hint")}>{timeline.base.length} frames</span>}>
                        <Seg value={s.fps} onChange={fps => set({ fps })} wrap options={[
                            { value: 0, label: src.kind === "gif" ? "Original" : "Auto" },
                            ...[10, 15, 24, 30].map(v => ({ value: v, label: `${v} fps` })),
                        ]} />
                        <span className={cl("hint")}>Fewer frames make a smaller file; more look smoother.</span>
                    </Section>
                    <Section title="Loop finder">
                        <span className={cl("hint")}>Finds the two moments in the trimmed part that match best, and trims between them so the end flows back into the start.</span>
                        <Row>
                            <Btn primary disabled={finding != null} onClick={loop}>{finding != null ? `Looking… ${Math.round(finding * 100)}%` : "✨ Find the cleanest loop"}</Btn>
                            {(s.trimStart > 0 || s.trimEnd > 0) && <Btn onClick={() => set({ trimStart: 0, trimEnd: 0 })}>Reset trim</Btn>}
                        </Row>
                    </Section>
                </>
            )}

            {src.kind === "image" && (
                <Section title="Length">
                    <Range label="Seconds" value={s.stillLength} min={0.5} max={8} step={0.5} onChange={stillLength => set({ stillLength })} format={v => `${v}s`} />
                    <span className={cl("hint")}>A still picture only becomes animated when something moves — zoom, overlays, a banner, animated text or stickers.</span>
                    <Range label="Frame rate" value={s.fps || 20} min={8} max={30} step={1} onChange={fps => set({ fps })} format={v => `${v} fps`} />
                    <Row>
                        <Btn onClick={p.addFiles}>＋ Add more pictures for a slideshow</Btn>
                    </Row>
                </Section>
            )}

            {src.kind === "slides" && <SlidesSection {...p} />}

            {src.kind !== "slides" && animated && src.kind === "gif" && s.fps === 0 && s.speed > 2 && (
                <span className={cl("hint")}>At this speed some frames are merged, because GIFs can't show a frame for less than 20 ms.</span>
            )}

            {timeline.base.length > 1 && (
                <Section title="Frames">
                    <FrameEditor src={src} base={timeline.base} edits={s.frameEdits} selected={p.selFrame} onSelect={p.setSelFrame}
                        onEdit={(i, e) => { const next = { ...s.frameEdits }; if (e && (e.drop || (e.dup ?? 0) > 0 || (e.hold ?? 1) > 1)) next[i] = e; else delete next[i]; set({ frameEdits: next }); }}
                        onReset={() => set({ frameEdits: {} })} />
                </Section>
            )}
        </>
    );
}

function SlidesSection({ s, set, src, slidesChanged, addFiles }: PanelProps) {
    const slides = src.slides!;
    const move = (i: number, d: number) => {
        const j = i + d;
        if (j < 0 || j >= slides.length) return;
        [slides[i], slides[j]] = [slides[j], slides[i]];
        slidesChanged();
    };
    return (
        <Section title={`Slideshow · ${slides.length} picture${slides.length === 1 ? "" : "s"}`}>
            <div className={cl("slides")}>
                {slides.map((img, i) => (
                    <div key={i} className={cl("slide")}>
                        <img src={img.src} alt="" draggable={false} />
                        <div className={cl("slide-actions")}>
                            <button type="button" title="Earlier" onClick={() => move(i, -1)}>‹</button>
                            <button type="button" title="Remove" onClick={() => { if (slides.length > 1) { slides.splice(i, 1); slidesChanged(); } }}>×</button>
                            <button type="button" title="Later" onClick={() => move(i, 1)}>›</button>
                        </div>
                    </div>
                ))}
                <button type="button" className={cl("slide", "slide-add")} onClick={addFiles}>＋<span>Add pictures</span></button>
            </div>
            <Range label="Each picture" value={s.slideLength} min={0.3} max={5} step={0.1} onChange={slideLength => set({ slideLength })} format={v => `${v.toFixed(1)}s`} />
            <Range label="Crossfade" value={s.crossfade} min={0} max={Math.min(1.5, s.slideLength / 2)} step={0.05} onChange={crossfade => set({ crossfade })} format={v => v ? `${v.toFixed(2)}s` : "Off"} />
        </Section>
    );
}

// ─── Crop ───

const SHAPES: { value: CropShape; label: string; ratio: number | null; }[] = [
    { value: "free", label: "Free", ratio: null },
    { value: "1:1", label: "Square", ratio: 1 },
    { value: "16:9", label: "16:9", ratio: 16 / 9 },
    { value: "9:16", label: "9:16", ratio: 9 / 16 },
    { value: "4:3", label: "4:3", ratio: 4 / 3 },
    { value: "circle", label: "◯ Circle", ratio: 1 },
];

/** The crop box's width ÷ height in 0–1 units for a shape (or null when free). */
export function shapeRatio(src: Source, s: EditState, shape = s.cropShape) {
    const r = SHAPES.find(x => x.value === shape)?.ratio;
    if (!r) return null;
    const [rw, rh] = rotatedSize(src, s);
    return r * rh / rw;
}

/** The biggest centred crop with that ratio. */
export function centredCrop(ratio: number | null) {
    if (!ratio) return { x: 0, y: 0, w: 1, h: 1 };
    let w = 1, h = 1 / ratio;
    if (h > 1) { h = 1; w = ratio; }
    return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

export function CropPanel({ s, set, src }: PanelProps) {
    const pickShape = (cropShape: CropShape) => set({ cropShape, crop: centredCrop(shapeRatio(src, s, cropShape)) });
    const rotate = (d: number) => {
        const rotate = (((s.rotate + d) % 360 + 360) % 360) as EditState["rotate"];
        const next = { ...s, rotate };
        set({ rotate, crop: centredCrop(shapeRatio(src, next)) });
    };
    const aspect = cropAspect(src, s);

    return (
        <>
            <Section title="Crop">
                <span className={cl("hint")}>Drag the box on the picture, or its corners to resize it.</span>
                <Seg value={s.cropShape} onChange={pickShape} wrap options={SHAPES.map(x => ({ value: x.value, label: x.label }))} />
                {s.cropShape === "circle" && <span className={cl("hint")}>Outside the circle becomes see-through.</span>}
                <Row>
                    <Btn onClick={() => set({ crop: centredCrop(shapeRatio(src, s)) })}>Reset crop</Btn>
                </Row>
            </Section>
            <Section title="Rotate & flip">
                <Row>
                    <Btn onClick={() => rotate(-90)} title="Rotate left">⟲ Left</Btn>
                    <Btn onClick={() => rotate(90)} title="Rotate right">⟳ Right</Btn>
                    <Btn on={s.flipH} onClick={() => set({ flipH: !s.flipH })}>⇋ Flip sideways</Btn>
                    <Btn on={s.flipV} onClick={() => set({ flipV: !s.flipV })}>⇵ Flip upside down</Btn>
                </Row>
            </Section>
            <Section title="Size">
                <div className={cl("dims")}>
                    <label className={cl("field")}>
                        <span>Width</span>
                        <input type="number" min={32} max={1024} value={s.width} onChange={e => set({ width: Number(e.currentTarget.value) || 32 })}
                            onBlur={e => set({ width: Math.max(32, Math.min(1024, Number(e.currentTarget.value) || 256)) })} />
                    </label>
                    <button type="button" className={cl("lock", s.lockAspect && "lock-on")} title={s.lockAspect ? "Keeping the shape" : "Free size"} onClick={() => set({ lockAspect: !s.lockAspect })}>{s.lockAspect ? "🔒" : "🔓"}</button>
                    <label className={cl("field")}>
                        <span>Height</span>
                        <input type="number" min={32} max={1024} value={s.height} disabled={s.lockAspect} onChange={e => set({ height: Number(e.currentTarget.value) || 32 })}
                            onBlur={e => set({ height: Math.max(32, Math.min(1024, Number(e.currentTarget.value) || 256)) })} />
                    </label>
                </div>
                <Seg value={s.width} onChange={width => set({ width })} wrap options={[128, 240, 320, 480, 640].map(v => ({ value: v, label: `${v}px` }))} />
                <span className={cl("hint")}>Shape {aspect.toFixed(2)} : 1</span>
            </Section>
        </>
    );
}

// ─── Text ───

const ANIMS: { value: TextLayer["anim"]; label: string; }[] = [
    { value: "none", label: "None" },
    { value: "typewriter", label: "⌨ Typewriter" },
    { value: "pop", label: "💥 Pop in" },
    { value: "shake", label: "〰 Shake" },
    { value: "wave", label: "🌊 Wave" },
    { value: "rainbow", label: "🌈 Rainbow" },
];

export function newText(i: number): TextLayer {
    return { id: uid(), text: "Your text", x: 0.5, y: i % 2 ? 0.8 : 0.5, size: 0.1, font: "Anton", fill: { ...DEFAULT_FILL }, outline: "#000000", outlineWidth: 0.12, shadow: true, bold: false, from: 0, to: 1, anim: "none" };
}

export function TextPanel({ s, set, selText, setSelText }: PanelProps) {
    const layer = s.texts.find(t => t.id === selText);
    const update = (id: string, patch: Partial<TextLayer>) => set({ texts: s.texts.map(t => t.id === id ? { ...t, ...patch } : t) });
    const pickCaption = (captionMode: CaptionMode) => {
        const font = captionMode === "meme" ? MEME_FONT : captionMode === "wth" ? SERIF_FONT : null;
        if (font) void loadGoogleFont(font);
        set({ captionMode });
    };
    const bubble = s.captionMode === "speechbubble" || s.captionMode === "cutout";
    const two = s.captionMode === "meme" || s.captionMode === "wth";
    const textual = s.captionMode !== "none" && !bubble;

    return (
        <>
            <Section title="Caption style">
                <div className={cl("styles")}>
                    {CAPTION_STYLES.map(c => (
                        <button key={c.id} type="button" title={c.blurb} className={cl("style", `style-${c.id}`, s.captionMode === c.id && "style-on")} onClick={() => pickCaption(c.id)}>
                            <span className={cl("style-art")} aria-hidden />
                            <span>{c.name}</span>
                        </button>
                    ))}
                </div>
                {textual && (
                    <>
                        <textarea className={cl("area")} rows={2} value={s.captionText} placeholder={s.captionMode === "meme" ? "Top text" : s.captionMode === "wth" ? "Big text" : "Caption"} onChange={e => set({ captionText: e.currentTarget.value })} />
                        {two && <textarea className={cl("area")} rows={2} value={s.captionBottom} placeholder={s.captionMode === "meme" ? "Bottom text" : "Smaller text under it"} onChange={e => set({ captionBottom: e.currentTarget.value })} />}
                        <Range label="Text size" value={s.captionSize} min={10} max={100} onChange={captionSize => set({ captionSize })} format={v => `${v}px`} />
                        <FontPicker value={s.fontFamily} onChange={fontFamily => set({ fontFamily })} />
                    </>
                )}
                {bubble && (
                    <>
                        <span className={cl("hint")}>Click the picture to point the bubble's tip at someone.</span>
                        <Range label="Tip position" value={Math.round(s.bubbleTipBase * 100)} min={0} max={80} onChange={v => set({ bubbleTipBase: v / 100 })} format={v => `${v}%`} />
                    </>
                )}
            </Section>

            <Section title="Text on the picture" aside={<Btn small primary onClick={() => { const t = newText(s.texts.length); set({ texts: [...s.texts, t] }); setSelText(t.id); }}>+ Add text</Btn>}>
                {!s.texts.length && <span className={cl("hint")}>Add text you can drag anywhere, with its own colours, timing and animation.</span>}
                <div className={cl("chips")}>
                    {s.texts.map(t => (
                        <button key={t.id} type="button" className={cl("chip", t.id === selText && "chip-on")} onClick={() => setSelText(t.id === selText ? null : t.id)}>{t.text.trim().slice(0, 18) || "(empty)"}</button>
                    ))}
                </div>
                {layer && (
                    <div className={cl("layer")}>
                        <textarea className={cl("area")} rows={2} value={layer.text} autoFocus onChange={e => update(layer.id, { text: e.currentTarget.value })} />
                        <FontPicker value={layer.font} onChange={font => update(layer.id, { font })} />
                        <Range label="Size" value={Math.round(layer.size * 100)} min={3} max={40} onChange={v => update(layer.id, { size: v / 100 })} format={v => `${v}%`} />
                        <Toggle label="Bold" checked={layer.bold} onChange={bold => update(layer.id, { bold })} />
                        <span className={cl("label")}>Fill</span>
                        <FillPicker fill={layer.fill} onChange={fill => update(layer.id, { fill })} />
                        <span className={cl("label")}>Outline</span>
                        <Row>
                            <input type="color" className={cl("color")} value={layer.outline} onChange={e => update(layer.id, { outline: e.currentTarget.value })} />
                            <Range label="Thickness" value={Math.round(layer.outlineWidth * 100)} min={0} max={30} onChange={v => update(layer.id, { outlineWidth: v / 100 })} format={v => v ? `${v}` : "None"} />
                        </Row>
                        <Toggle label="Shadow" checked={layer.shadow} onChange={shadow => update(layer.id, { shadow })} />
                        <span className={cl("label")}>When it shows</span>
                        <Range label="From" value={Math.round(layer.from * 100)} min={0} max={99} onChange={v => update(layer.id, { from: Math.min(v / 100, layer.to - 0.01) })} format={v => `${v}%`} />
                        <Range label="Until" value={Math.round(layer.to * 100)} min={1} max={100} onChange={v => update(layer.id, { to: Math.max(v / 100, layer.from + 0.01) })} format={v => `${v}%`} />
                        <span className={cl("hint")}>Two texts with different timings make a two-part joke.</span>
                        <span className={cl("label")}>Animation</span>
                        <Seg value={layer.anim} onChange={anim => update(layer.id, { anim })} wrap options={ANIMS} />
                        <Row>
                            <Btn small onClick={() => update(layer.id, { x: 0.5, y: 0.5 })}>Centre it</Btn>
                            <Btn small onClick={() => { const t = { ...structuredClone(layer), id: uid(), y: Math.min(0.95, layer.y + 0.1) }; set({ texts: [...s.texts, t] }); setSelText(t.id); }}>Duplicate</Btn>
                            <Btn small danger onClick={() => { set({ texts: s.texts.filter(t => t.id !== layer.id) }); setSelText(null); }}>Delete</Btn>
                        </Row>
                    </div>
                )}
            </Section>
        </>
    );
}

// ─── Effects ───

export function EffectsPanel({ s, set, tool, setTool }: PanelProps) {
    const adjusted = s.brightness !== 100 || s.contrast !== 100 || s.saturation !== 100 || s.hue !== 0 || s.blur !== 0;
    useEffect(() => { if (s.banner !== "none") BANNER_FONTS.forEach(f => void loadGoogleFont(f)); }, [s.banner]);
    return (
        <>
            <Section title="Filter">
                <div className={cl("filters")}>
                    {FILTERS.map(f => (
                        <button key={f.id} type="button" className={cl("filter", `filter-${f.id}`, s.filter === f.id && "filter-on")} onClick={() => set({ filter: f.id })}>
                            <span className={cl("filter-art")} aria-hidden />
                            <span>{f.name}</span>
                        </button>
                    ))}
                </div>
                {s.filter !== "none" && <Range label="Strength" value={Math.round(s.filterAmount * 100)} min={10} max={100} onChange={v => set({ filterAmount: v / 100 })} format={v => `${v}%`} />}
            </Section>
            <Section title="Adjust" aside={adjusted ? <Btn small onClick={() => set({ brightness: 100, contrast: 100, saturation: 100, hue: 0, blur: 0 })}>Reset</Btn> : undefined}>
                <Range label="Brightness" value={s.brightness} min={30} max={200} onChange={brightness => set({ brightness })} format={v => `${v}%`} />
                <Range label="Contrast" value={s.contrast} min={30} max={200} onChange={contrast => set({ contrast })} format={v => `${v}%`} />
                <Range label="Saturation" value={s.saturation} min={0} max={300} onChange={saturation => set({ saturation })} format={v => `${v}%`} />
                <Range label="Hue" value={s.hue} min={-180} max={180} onChange={hue => set({ hue })} format={v => `${v}°`} />
                <Range label="Blur" value={s.blur} min={0} max={10} step={0.5} onChange={blur => set({ blur })} format={v => v ? `${v}px` : "Off"} />
            </Section>
            <Section title="Overlay">
                <Seg value={s.particles} onChange={particles => set({ particles })} wrap options={PARTICLES.map(x => ({ value: x.id, label: `${x.emoji} ${x.name}` }))} />
                {s.particles !== "none" && <Range label="Amount" value={Math.round(s.particleDensity * 100)} min={30} max={250} step={10} onChange={v => set({ particleDensity: v / 100 })} format={v => `${v}%`} />}
            </Section>
            <Section title="Banner">
                <Seg value={s.banner} onChange={banner => set({ banner })} wrap options={BANNERS.map(b => ({ value: b.id, label: b.name }))} />
                {s.banner !== "none" && <Range label="Appears at" value={Math.round(s.bannerAt * 100)} min={0} max={95} onChange={v => set({ bannerAt: v / 100 })} format={v => `${v}%`} />}
            </Section>
            <Section title="Zoom & pan">
                <Seg value={s.zoom} onChange={zoom => set({ zoom })} wrap options={[
                    { value: "none", label: "None" },
                    { value: "in", label: "Slow zoom in" },
                    { value: "out", label: "Slow zoom out" },
                    { value: "punch", label: "Punch-in", title: "A quick zoom at the moment you pick" },
                ]} />
                {s.zoom !== "none" && (
                    <>
                        <Range label="Strength" value={Math.round(s.zoomStrength * 100)} min={5} max={100} onChange={v => set({ zoomStrength: v / 100 })} format={v => `${v}%`} />
                        {s.zoom === "punch" && <Range label="At" value={Math.round(s.zoomAt * 100)} min={0} max={95} onChange={v => set({ zoomAt: v / 100 })} format={v => `${v}%`} />}
                        <Row>
                            <Btn on={tool === "zoom"} onClick={() => setTool(tool === "zoom" ? "none" : "zoom")}>🎯 {tool === "zoom" ? "Click the picture…" : "Pick the zoom point"}</Btn>
                            <span className={cl("hint")}>{pct(s.zoomX)}, {pct(s.zoomY)}</span>
                        </Row>
                    </>
                )}
            </Section>
        </>
    );
}

// ─── Stickers ───

const QUICK_EMOJI = ["😂", "💀", "😭", "🔥", "💯", "👀", "😎", "🥺", "😡", "🤡", "❤️", "✨", "👍", "👎", "🎉", "💥", "⭐", "🗿", "🤔", "😳", "🙏", "💔", "🚨", "⚡"];

function stickerFrom(input: string): Pick<Sticker, "kind" | "value"> | null {
    const v = input.trim();
    if (!v) return null;
    const custom = v.match(/<a?:\w+:(\d+)>/);
    if (custom) return { kind: "image", value: `https://cdn.discordapp.com/emojis/${custom[1]}.png?size=160` };
    if (/^https?:\/\/\S+$/.test(v)) return { kind: "image", value: v };
    return { kind: "emoji", value: v };
}

export function StickersPanel({ s, set, selSticker, setSelSticker, tool, setTool }: PanelProps) {
    const [input, setInput] = useState("");
    const sticker = s.stickers.find(k => k.id === selSticker);
    const update = (id: string, patch: Partial<Sticker>) => set({ stickers: s.stickers.map(k => k.id === id ? { ...k, ...patch } : k) });
    const add = (what: Pick<Sticker, "kind" | "value">) => {
        if (what.kind === "image") void loadImage(what.value).catch(() => showToast("Couldn't load that picture", "failure"));
        const k: Sticker = { id: uid(), ...what, x: 0.3 + Math.random() * 0.4, y: 0.3 + Math.random() * 0.4, size: 0.2, motion: "none", path: [] };
        set({ stickers: [...s.stickers, k] });
        setSelSticker(k.id);
    };
    let serverEmoji: any[] = [];
    try { serverEmoji = (EmojiStore.getGuildEmoji(SelectedGuildStore.getGuildId()) ?? []).slice(0, 48); } catch { /* no server open */ }

    return (
        <>
            <Section title="Add a sticker">
                <div className={cl("emoji-grid")}>
                    {QUICK_EMOJI.map(e => <button key={e} type="button" onClick={() => add({ kind: "emoji", value: e })}>{e}</button>)}
                </div>
                {serverEmoji.length > 0 && (
                    <>
                        <span className={cl("label")}>This server's emojis</span>
                        <div className={cl("emoji-grid")}>
                            {serverEmoji.map(e => (
                                <button key={e.id} type="button" title={`:${e.name}:`} onClick={() => add({ kind: "image", value: `https://cdn.discordapp.com/emojis/${e.id}.png?size=160` })}>
                                    <img src={`https://cdn.discordapp.com/emojis/${e.id}.png?size=48`} alt={e.name} />
                                </button>
                            ))}
                        </div>
                    </>
                )}
                <Row>
                    <input className={cl("input")} value={input} placeholder="Any emoji, a custom emoji, or a picture's link" onChange={e => setInput(e.currentTarget.value)}
                        onKeyDown={e => { if (e.key === "Enter") { const w = stickerFrom(input); if (w) { add(w); setInput(""); } } }} />
                    <Btn primary disabled={!input.trim()} onClick={() => { const w = stickerFrom(input); if (w) { add(w); setInput(""); } }}>Add</Btn>
                </Row>
            </Section>

            {s.stickers.length > 0 && (
                <Section title="Your stickers">
                    <div className={cl("chips")}>
                        {s.stickers.map(k => (
                            <button key={k.id} type="button" className={cl("chip", k.id === selSticker && "chip-on")} onClick={() => setSelSticker(k.id === selSticker ? null : k.id)}>
                                {k.kind === "emoji" ? k.value : <img src={k.value} alt="" />}
                            </button>
                        ))}
                    </div>
                    {sticker ? (
                        <div className={cl("layer")}>
                            <span className={cl("hint")}>Drag it on the picture to move it.</span>
                            <Range label="Size" value={Math.round(sticker.size * 100)} min={4} max={80} onChange={v => update(sticker.id, { size: v / 100 })} format={v => `${v}%`} />
                            <span className={cl("label")}>Motion</span>
                            <Seg value={sticker.motion} onChange={motion => { update(sticker.id, { motion }); if (motion === "path" && sticker.path.length < 2) setTool("path"); }} wrap options={[
                                { value: "none", label: "Still" },
                                { value: "bounce", label: "Bounce" },
                                { value: "spin", label: "Spin" },
                                { value: "pulse", label: "Pulse" },
                                { value: "float", label: "Float" },
                                { value: "path", label: "Follow a path" },
                            ]} />
                            {sticker.motion === "path" && (
                                <Row>
                                    <Btn on={tool === "path"} onClick={() => setTool(tool === "path" ? "none" : "path")}>✏️ {tool === "path" ? "Draw on the picture…" : "Draw the path"}</Btn>
                                    {sticker.path.length > 1 && <Btn small onClick={() => update(sticker.id, { path: [] })}>Clear path</Btn>}
                                </Row>
                            )}
                            <Row>
                                <Btn small onClick={() => { const k = { ...structuredClone(sticker), id: uid(), x: Math.min(0.9, sticker.x + 0.1) }; set({ stickers: [...s.stickers, k] }); setSelSticker(k.id); }}>Duplicate</Btn>
                                <Btn small danger onClick={() => { set({ stickers: s.stickers.filter(k => k.id !== sticker.id) }); setSelSticker(null); }}>Delete</Btn>
                            </Row>
                        </div>
                    ) : <span className={cl("hint")}>Pick a sticker to change its size or make it move.</span>}
                </Section>
            )}
        </>
    );
}

// ─── Output ───

export function OutputPanel({ s, set, src, applyStyle }: PanelProps) {
    const [presets, setPresets] = useState<Preset[]>([]);
    const [name, setName] = useState("");
    useEffect(() => void getPresets().then(setPresets), []);
    const asSquare = (width: number, sizeTarget: number) => set({ width, sizeTarget, cropShape: "1:1", crop: centredCrop(shapeRatio(src, s, "1:1")), lockAspect: true, format: s.format === "video" ? "gif" : s.format });
    const video = videoType().startsWith("video/mp4") ? "MP4" : "WebM";

    return (
        <>
            <Section title="Format">
                <Seg value={s.format} onChange={format => set({ format })} options={[
                    { value: "gif", label: "GIF" },
                    { value: "webp", label: "WebP", title: "Much smaller than a GIF, same quality" },
                    { value: "video", label: video, title: "Smallest of all — but plays as a video, not a GIF" },
                ]} />
                <span className={cl("hint")}>{s.format === "gif" ? "Plays everywhere." : s.format === "webp" ? "An animated WebP — usually a third of the GIF's size." : `A ${video} video — tiny files. Making it plays the GIF through once in real time.`}</span>
                {s.format === "gif" && <Seg value={s.colors} onChange={colors => set({ colors })} options={[256, 128, 64, 32].map(v => ({ value: v, label: `${v} colours` }))} wrap />}
            </Section>
            <Section title="File size">
                <Seg value={s.sizeTarget} onChange={sizeTarget => set({ sizeTarget })} wrap options={SIZE_TARGETS.map(t => ({ value: t.value, label: t.label }))} />
                {s.sizeTarget > 0 && <span className={cl("hint")}>If it's bigger than {formatBytes(s.sizeTarget)}, Sonata lowers the colours, then the frames, then the size until it fits.</span>}
            </Section>
            <Section title="Make it an emoji or sticker">
                <Row>
                    <Btn onClick={() => asSquare(128, 256 * 1024)}>😀 Emoji size (128px)</Btn>
                    <Btn onClick={() => asSquare(320, 500 * 1024)}>🏷️ Sticker size (320px)</Btn>
                </Row>
                <span className={cl("hint")}>Square, and small enough to upload as a server emoji or sticker.</span>
            </Section>
            <Section title="Favourites">
                <Toggle label="Add it to my GIF favourites when I send it" checked={s.favourite} onChange={favourite => set({ favourite })}
                    hint="Discord's favourites need the GIF to be uploaded, so it's starred as soon as your message is sent." />
            </Section>
            <Section title="Presets">
                <div className={cl("chips")}>
                    {[...BUILT_IN_PRESETS, ...presets].map(p => (
                        <span key={p.id} className={cl("preset")}>
                            <button type="button" className={cl("chip")} onClick={() => { applyStyle(p.style); showToast(`Applied "${p.name}"`, "success"); }} title="Apply this style">{p.name}</button>
                            {!p.builtIn && <button type="button" className={cl("preset-x")} title="Delete preset" onClick={() => void deletePreset(p.id).then(setPresets)}>×</button>}
                        </span>
                    ))}
                </div>
                <Row>
                    <input className={cl("input")} value={name} maxLength={32} placeholder="Name this style — e.g. My meme style" onChange={e => setName(e.currentTarget.value)} />
                    <Btn primary disabled={!name.trim()} onClick={() => void savePreset(name.trim(), s).then(list => { setPresets(list); setName(""); showToast("Preset saved", "success"); })}>Save</Btn>
                </Row>
                <span className={cl("hint")}>A preset keeps the look — captions, text, filters, effects, speed and output — not the trim or crop.</span>
            </Section>
        </>
    );
}
