/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The GIF editor: a live preview (drawn straight from the frames, so every
// change shows instantly), the trim strip under it, and the tool panels.
// The file itself is made quietly in the background whenever you stop
// changing things, so the size is always shown and Send is instant.

import ErrorBoundary from "@components/ErrorBoundary";
import { getCurrentChannel } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { saveFile } from "@utils/web";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, React, showToast, UploadHandler, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "@webpack/common";

import { Cancel, encode, Encoded, formatBytes } from "../render/export";
import { cropAspect, renderFrame, RenderResult, rotatedSize, setStickerListener } from "../render/frame";
import { loadSource, MediaInput, slidesSource, Source } from "../render/source";
import { buildTimeline, timelineSignature, trimRange } from "../render/timeline";
import { rememberedPrefs, rememberPrefs, settings } from "../settings";
import { addRecent, favouriteWhenSent } from "../store";
import { DEFAULT_STATE, type EditState } from "../types";
import { loadImage } from "../utils/media";
import { cl } from "./controls";
import { openRecent } from "./Gallery";
import { CropPanel, EffectsPanel, OutputPanel, PanelProps, shapeRatio, StickersPanel, TextPanel, TimePanel, Tool } from "./panels";
import { CropBox, TrimBar } from "./timeline";

const logger = new Logger("GifMaker");

type Tab = "time" | "crop" | "text" | "effects" | "stickers" | "output";
const TABS: { id: Tab; label: string; icon: string; }[] = [
    { id: "time", label: "Time", icon: "⏱" },
    { id: "crop", label: "Crop", icon: "✂" },
    { id: "text", label: "Text", icon: "𝐓" },
    { id: "effects", label: "Effects", icon: "✨" },
    { id: "stickers", label: "Stickers", icon: "😀" },
    { id: "output", label: "Output", icon: "⬇" },
];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function sized(src: Source, s: EditState): EditState {
    const [rw] = rotatedSize(src, s);
    const width = Math.round(clamp(Math.min(Number(settings.store.startWidth) || 480, rw), 32, 1024));
    return { ...s, width, height: Math.max(16, Math.round(width / cropAspect(src, s))) };
}

/** Files picked from your computer, as inputs (their object URLs are freed when the editor closes). */
export function pickFiles(accept = "image/*,video/*", multiple = true): Promise<{ inputs: MediaInput[]; urls: string[]; }> {
    return new Promise(resolve => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept;
        input.multiple = multiple;
        input.onchange = () => {
            const files = [...input.files ?? []];
            const urls = files.map(f => URL.createObjectURL(f));
            resolve({ urls, inputs: files.map((f, i) => ({ url: urls[i], isVideo: f.type.startsWith("video/"), isGif: f.type === "image/gif" })) });
        };
        input.click();
    });
}

export function openEditor(inputs: MediaInput[], opts: { state?: EditState; ownedUrls?: string[]; startAt?: number; } = {}) {
    openModal(props => (
        <ErrorBoundary>
            <GifEditor modalProps={props} inputs={inputs} initial={opts.state} ownedUrls={opts.ownedUrls ?? []} startAt={opts.startAt} />
        </ErrorBoundary>
    ));
}

function GifEditor({ modalProps, inputs: initialInputs, initial, ownedUrls, startAt }: { modalProps: RenderModalProps; inputs: MediaInput[]; initial?: EditState; ownedUrls: string[]; startAt?: number; }) {
    const [src, setSrc] = useState<Source | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [s, setS] = useState<EditState>(() => initial ?? { ...structuredClone(DEFAULT_STATE), ...rememberedPrefs() });
    const [slidesVer, bumpSlides] = useReducer((n: number) => n + 1, 0);
    const [tab, setTab] = useState<Tab>("time");
    const [tool, setTool] = useState<Tool>("none");
    const [selText, setSelText] = useState<string | null>(null);
    const [selSticker, setSelSticker] = useState<string | null>(null);
    const [selFrame, setSelFrame] = useState<number | null>(null);
    const [prep, setPrep] = useState<{ done: number; total: number; } | null>(null);
    const [thumbs, setThumbs] = useState<string[]>([]);
    const [enc, setEnc] = useState<{ out: Encoded | null; key: string; busy: boolean; progress: number; note?: string; error?: string; }>({ out: null, key: "", busy: false, progress: 0 });
    const [finishing, setFinishing] = useState<"send" | "save" | null>(null);

    const inputs = useRef(initialInputs);
    const owned = useRef(ownedUrls);
    const sRef = useRef(s);
    sRef.current = s;
    const history = useRef({ past: [] as EditState[], future: [] as EditState[], last: 0 });
    const canvas = useRef<HTMLCanvasElement>(null);
    const playhead = useRef<HTMLDivElement>(null);
    const counter = useRef<HTMLSpanElement>(null);
    const play = useRef({ playing: true, idx: 0, acc: 0, last: 0 });
    const dirty = useRef(true);
    const result = useRef<RenderResult | null>(null);
    const drag = useRef<{ kind: "text" | "sticker" | "path"; id: string; ox: number; oy: number; } | null>(null);
    const [playing, setPlaying] = useState(true);

    const srcRef = useRef<Source | null>(null);

    // ─── Loading ───
    useEffect(() => {
        let alive = true;
        let loaded: Source | null = null;
        loadSource(inputs.current).then(x => {
            if (!alive) return x.dispose();
            loaded = x;
            if (!initial) setS(prev => {
                const next = sized(x, prev);
                // Opened from a paused video: start the GIF where it was paused (5 seconds long).
                if (startAt && x.duration > 1) {
                    const a = Math.min(startAt, Math.max(0, x.duration - 1));
                    return { ...next, trimStart: a, trimEnd: Math.min(x.duration, a + 5) >= x.duration - 0.01 ? 0 : Math.min(x.duration, a + 5) };
                }
                return next;
            });
            setSrc(x);
        }).catch(e => alive && setLoadError(e instanceof Error ? e.message : String(e)));
        setStickerListener(() => { dirty.current = true; });
        return () => {
            alive = false;
            (srcRef.current ?? loaded)?.dispose();
            setStickerListener(null);
            owned.current.forEach(u => URL.revokeObjectURL(u));
        };
    }, []);
    // A source swapped later (a picture turned into a slideshow) is cleaned up too.
    useEffect(() => { const prev = srcRef.current; srcRef.current = src; if (prev && prev !== src) prev.dispose(); }, [src]);

    // ─── Editing, with undo ───
    const commit = useCallback((next: EditState, prev: EditState) => {
        const h = history.current;
        const now = Date.now();
        if (now - h.last > 600) { h.past.push(prev); if (h.past.length > 120) h.past.shift(); }
        h.last = now;
        h.future = [];
        setS(next);
    }, []);

    const set = useCallback((patch: Partial<EditState>) => {
        const prev = sRef.current;
        let next = { ...prev, ...patch };
        if (src && next.lockAspect) next.height = Math.max(16, Math.round(next.width / cropAspect(src, next)));
        if (!("frameEdits" in patch) && Object.keys(prev.frameEdits).length && timelineSignature(next) !== timelineSignature(prev)) next = { ...next, frameEdits: {} };
        sRef.current = next;
        commit(next, prev);
    }, [src, commit]);

    const undo = useCallback(() => {
        const h = history.current;
        const prev = h.past.pop();
        if (!prev) return;
        h.future.push(sRef.current);
        h.last = 0;
        sRef.current = prev;
        setS(prev);
    }, []);
    const redo = useCallback(() => {
        const h = history.current;
        const next = h.future.pop();
        if (!next) return;
        h.past.push(sRef.current);
        h.last = 0;
        sRef.current = next;
        setS(next);
    }, []);

    const applyStyle = useCallback((style: Partial<EditState>) => {
        set({ ...structuredClone(style), texts: style.texts ? structuredClone(style.texts) : sRef.current.texts, stickers: style.stickers ? structuredClone(style.stickers) : sRef.current.stickers });
    }, [set]);

    // ─── Timeline & frames ───
    const timeline = useMemo(() => {
        if (!src) return null;
        src.configure?.(s.slideLength, s.crossfade);
        return buildTimeline(src, s);
    }, [src, s, slidesVer]);
    const progress = useMemo(() => {
        if (!timeline) return [];
        let at = 0;
        return timeline.frames.map(f => { const p = at / (timeline.total || 1); at += f.delay; return p; });
    }, [timeline]);
    const tlRef = useRef({ timeline, progress });
    tlRef.current = { timeline, progress };

    const baseKey = timeline ? timeline.base.map(f => f.t.toFixed(3)).join() : "";
    useEffect(() => {
        if (!src || !timeline || src.kind !== "video") return;
        let gone = false;
        void src.prepare([...new Set(timeline.base.map(f => f.t))], (done, total) => {
            if (gone) return;
            dirty.current = true;
            setPrep(done >= total ? null : { done, total });
        });
        return () => { gone = true; };
    }, [src, baseKey]);

    useEffect(() => {
        if (!src || !src.duration || src.kind === "slides") return;
        const n = 12;
        void src.thumbs(Array.from({ length: n }, (_, i) => (i + 0.5) / n * src.duration), 44).then(setThumbs);
    }, [src]);

    // ─── Preview ───
    const tabRef = useRef(tab);
    tabRef.current = tab;
    const selRef = useRef({ selText, selSticker });
    selRef.current = { selText, selSticker };

    const draw = useCallback(() => {
        const c = canvas.current;
        const { timeline: tl, progress: ps } = tlRef.current;
        if (!src || !c || !tl) return;
        const st = play.current;
        st.idx %= tl.frames.length;
        const f = tl.frames[st.idx];
        const p = ps[st.idx] ?? 0;
        const cur = sRef.current;
        result.current = renderFrame(c, src, cur, { t: f.t, index: f.base, p }, { cropView: tabRef.current === "crop", boxesAlways: true });

        // Selection outline and the drawn path (only on the preview, never in the file).
        const r = result.current;
        const ctx = c.getContext("2d")!;
        const { selText: tId, selSticker: kId } = selRef.current;
        const box = r.texts.find(b => b.id === tId) ?? r.stickers.find(b => b.id === kId);
        ctx.save();
        if (box && tabRef.current !== "crop") {
            ctx.setLineDash([5, 4]);
            ctx.strokeStyle = "rgba(255,255,255,0.9)";
            ctx.lineWidth = 1.5;
            ctx.shadowColor = "rgba(0,0,0,0.8)";
            ctx.shadowBlur = 3;
            ctx.strokeRect(box.x - 4, box.y - 4, box.w + 8, box.h + 8);
        }
        const k = cur.stickers.find(x => x.id === kId);
        if (k?.motion === "path" && k.path.length > 1 && tabRef.current === "stickers") {
            const im = r.layout.img;
            ctx.setLineDash([3, 5]);
            ctx.strokeStyle = "rgba(255,255,255,0.7)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            k.path.forEach(([x, y], i) => i ? ctx.lineTo(im.x + x * im.w, im.y + y * im.h) : ctx.moveTo(im.x + x * im.w, im.y + y * im.h));
            ctx.stroke();
        }
        ctx.restore();

        if (counter.current) counter.current.textContent = `${st.idx + 1} / ${tl.frames.length}`;
        if (playhead.current && src.duration) playhead.current.style.left = `${f.t / src.duration * 100}%`;
    }, [src]);

    useEffect(() => {
        let raf = 0;
        const loop = (now: number) => {
            const st = play.current;
            const tl = tlRef.current.timeline;
            if (tl && st.playing && tl.frames.length > 1) {
                st.acc += now - (st.last || now);
                if (st.acc > 1500) st.acc = 0;
                while (st.acc >= tl.frames[st.idx % tl.frames.length].delay) {
                    st.acc -= tl.frames[st.idx % tl.frames.length].delay;
                    st.idx = (st.idx + 1) % tl.frames.length;
                    dirty.current = true;
                }
            }
            st.last = now;
            if (dirty.current) { dirty.current = false; draw(); }
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [draw]);
    useEffect(() => { dirty.current = true; }, [s, timeline, tab, selText, selSticker]);

    const togglePlay = () => { play.current.playing = !play.current.playing; play.current.acc = 0; setPlaying(play.current.playing); };
    const step = (d: number) => {
        const tl = tlRef.current.timeline;
        if (!tl) return;
        play.current.playing = false;
        setPlaying(false);
        play.current.idx = (play.current.idx + d + tl.frames.length) % tl.frames.length;
        dirty.current = true;
    };
    // Picking a frame in the frame editor jumps the preview to it.
    useEffect(() => {
        if (selFrame == null || !timeline) return;
        const i = timeline.frames.findIndex(f => f.base === selFrame);
        if (i >= 0) { play.current.idx = i; play.current.playing = false; setPlaying(false); dirty.current = true; }
    }, [selFrame]);

    // ─── Pointer on the preview ───
    const local = (e: React.PointerEvent) => {
        const c = canvas.current!;
        const r = c.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width * c.width, y = (e.clientY - r.top) / r.height * c.height;
        const im = result.current?.layout.img ?? { x: 0, y: 0, w: c.width, h: c.height };
        return { x, y, nx: (x - im.x) / im.w, ny: (y - im.y) / im.h };
    };
    const hit = (x: number, y: number) => {
        const r = result.current;
        if (!r) return null;
        const inside = (b: { x: number; y: number; w: number; h: number; }) => x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.y - 6 && y <= b.y + b.h + 6;
        const t = [...r.texts].reverse().find(inside);
        if (t) return { kind: "text" as const, id: t.id };
        const k = [...r.stickers].reverse().find(inside);
        if (k) return { kind: "sticker" as const, id: k.id };
        return null;
    };
    const onDown = (e: React.PointerEvent) => {
        if (tab === "crop") return;
        const { x, y, nx, ny } = local(e);
        const cur = sRef.current;
        if (tool === "zoom") { set({ zoomX: clamp(nx, 0, 1), zoomY: clamp(ny, 0, 1) }); setTool("none"); return; }
        if (tool === "path" && selSticker) {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { kind: "path", id: selSticker, ox: 0, oy: 0 };
            set({ stickers: cur.stickers.map(k => k.id === selSticker ? { ...k, path: [[nx, ny]], x: nx, y: ny } : k) });
            return;
        }
        const h = hit(x, y);
        if (h) {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            if (h.kind === "text") {
                const t = cur.texts.find(l => l.id === h.id)!;
                setSelText(h.id);
                if (tab !== "text") setTab("text");
                drag.current = { kind: "text", id: h.id, ox: nx - t.x, oy: ny - t.y };
            } else {
                const k = cur.stickers.find(l => l.id === h.id)!;
                setSelSticker(h.id);
                if (tab !== "stickers") setTab("stickers");
                // Moves its resting spot by however far you drag, wherever its motion has it right now.
                drag.current = { kind: "sticker", id: h.id, ox: nx - k.x, oy: ny - k.y };
            }
            return;
        }
        if (tab === "text" && (cur.captionMode === "speechbubble" || cur.captionMode === "cutout")) { set({ bubbleTipX: clamp(nx, 0, 1), bubbleTipY: clamp(ny, 0, 1) }); return; }
        setSelText(null);
        setSelSticker(null);
    };
    const onMove = (e: React.PointerEvent) => {
        const d = drag.current;
        const { x, y, nx, ny } = local(e);
        if (!d) {
            const c = canvas.current!;
            c.style.cursor = tool !== "none" ? "crosshair" : hit(x, y) ? "grab" : tab === "text" && (s.captionMode === "speechbubble" || s.captionMode === "cutout") ? "crosshair" : "default";
            return;
        }
        const cur = sRef.current;
        if (d.kind === "text") set({ texts: cur.texts.map(t => t.id === d.id ? { ...t, x: clamp(nx - d.ox, -0.1, 1.1), y: clamp(ny - d.oy, -0.1, 1.1) } : t) });
        else if (d.kind === "sticker") set({ stickers: cur.stickers.map(k => k.id === d.id ? { ...k, x: clamp(nx - d.ox, -0.1, 1.1), y: clamp(ny - d.oy, -0.1, 1.1) } : k) });
        else {
            set({
                stickers: cur.stickers.map(k => {
                    if (k.id !== d.id) return k;
                    const last = k.path[k.path.length - 1];
                    return !last || Math.hypot(nx - last[0], ny - last[1]) > 0.015 ? { ...k, path: [...k.path, [clamp(nx, -0.1, 1.1), clamp(ny, -0.1, 1.1)]] } : k;
                })
            });
        }
    };
    const onUp = () => {
        if (drag.current?.kind === "path") setTool("none");
        drag.current = null;
    };

    // ─── Keys ───
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement;
            if (t?.closest?.("input, textarea, [contenteditable=true]")) return;
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); } else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); } else if (e.key === " ") { e.preventDefault(); togglePlay(); } else if (e.key === "ArrowRight" && !mod) step(1);
            else if (e.key === "ArrowLeft" && !mod) step(-1);
            else if (e.key === "Delete" || e.key === "Backspace") {
                const { selText: tId, selSticker: kId } = selRef.current;
                if (tId) { set({ texts: sRef.current.texts.filter(x => x.id !== tId) }); setSelText(null); }
                else if (kId) { set({ stickers: sRef.current.stickers.filter(x => x.id !== kId) }); setSelSticker(null); }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [undo, redo, set]);

    // ─── Making the file ───
    const key = JSON.stringify(s) + slidesVer;
    useEffect(() => {
        if (!src || !timeline || s.format === "video" || prep) return;
        const cancel: Cancel = { cancelled: false };
        let shown = 0;
        const timer = setTimeout(async () => {
            setEnc(e => ({ ...e, busy: true, progress: 0, note: undefined, error: undefined }));
            try {
                const out = await encode(src, s, timeline, cancel, (k, note) => {
                    if (k - shown < 0.05 && k < 1) return;
                    shown = k;
                    setEnc(e => ({ ...e, progress: k, note }));
                });
                if (!cancel.cancelled) setEnc({ out, key, busy: false, progress: 1 });
            } catch (err) {
                logger.error("Encoding failed", err);
                if (!cancel.cancelled) setEnc({ out: null, key: "", busy: false, progress: 0, error: err instanceof Error ? err.message : String(err) });
            }
        }, 1100);
        return () => { cancel.cancelled = true; clearTimeout(timer); };
    }, [key, src, prep == null]);

    const finalFile = async (): Promise<Encoded | null> => {
        if (enc.out && enc.key === key) return enc.out;
        if (!src || !timeline) return null;
        setEnc(e => ({ ...e, busy: true, progress: 0 }));
        try {
            const out = await encode(src, s, timeline, { cancelled: false }, (k, note) => setEnc(e => ({ ...e, progress: k, note })));
            setEnc({ out, key, busy: false, progress: 1 });
            return out;
        } catch (err) {
            setEnc({ out: null, key: "", busy: false, progress: 0, error: err instanceof Error ? err.message : String(err) });
            return null;
        }
    };

    const finish = async (how: "send" | "save") => {
        if (finishing) return;
        const channel = getCurrentChannel();
        if (how === "send" && !channel) { showToast("Open a channel to send it to", "failure"); return; }
        setFinishing(how);
        try {
            const out = await finalFile();
            if (!out) { showToast("Couldn't make the file", "failure"); return; }
            const filename = `sonata-${Date.now().toString(36)}.${out.ext}`;
            const file = new File([out.blob], filename, { type: out.blob.type });
            rememberPrefs(s);
            void addRecent({ name: filename, blob: out.blob, type: out.blob.type, width: out.width, height: out.height, inputs: inputs.current, state: s });
            if (how === "save") { saveFile(file); return; }
            UploadHandler.promptToUpload([file], channel!, 0);
            if (s.favourite) favouriteWhenSent(channel!.id, filename);
            modalProps.onClose();
        } finally {
            setFinishing(null);
        }
    };

    // ─── Slideshow pictures ───
    const addFiles = async () => {
        const picked = await pickFiles("image/*", true);
        if (!picked.inputs.length) return;
        owned.current.push(...picked.urls);
        if (src?.kind === "slides") {
            const imgs = (await Promise.all(picked.inputs.map(i => loadImage(i.url).catch(() => null)))).filter(Boolean) as HTMLImageElement[];
            src.slides!.push(...imgs);
            inputs.current = [...inputs.current, ...picked.inputs];
            bumpSlides();
        } else if (src) {
            const all = [...inputs.current, ...picked.inputs].filter(i => !i.isVideo);
            try {
                const slides = await slidesSource(all.map(i => i.url));
                inputs.current = all;
                setS(prev => sized(slides, { ...prev, trimStart: 0, trimEnd: 0, frameEdits: {}, crop: { x: 0, y: 0, w: 1, h: 1 }, cropShape: "free" }));
                setSrc(slides);
            } catch (e) { showToast(e instanceof Error ? e.message : "Couldn't add those pictures", "failure"); }
        }
    };

    const panelProps: PanelProps | null = src && timeline ? {
        s, set, src, timeline, selText, setSelText, selSticker, setSelSticker, selFrame, setSelFrame, tool, setTool,
        slidesChanged: () => { bumpSlides(); dirty.current = true; }, addFiles, applyStyle,
    } : null;
    const [start, end] = src ? trimRange(src, s) : [0, 0];
    const fresh = enc.out && enc.key === key;
    const status = loadError ? "" : !src ? "Loading…" : prep ? `Reading frames ${prep.done}/${prep.total}` : enc.busy ? `${enc.note ?? "Making the file…"} ${Math.round(enc.progress * 100)}%`
        : enc.error ? `Couldn't make it: ${enc.error}` : fresh ? `${formatBytes(enc.out!.blob.size)} · ${enc.out!.width}×${enc.out!.height} · ${enc.out!.frames} frame${enc.out!.frames === 1 ? "" : "s"}${enc.out!.shrunk ? ` · ${enc.out!.shrunk}` : ""}`
            : s.format === "video" ? "The video is made when you send or save it" : "…";
    const over = fresh && enc.out!.blob.size > 10 * 1024 * 1024;

    return (
        <Modal {...modalProps} size="xl" title="GIF Maker" subtitle="Trim, crop, caption, decorate — then send"
            actionBarInput={<span className={cl("status", over && "status-warn")} title={over ? "Over Discord's 10 MB upload limit without Nitro" : undefined}>{over ? "⚠ " : ""}{status}</span>}
            actions={[
                { text: finishing === "send" ? "Making it…" : "Send", variant: "primary", onClick: () => void finish("send"), disabled: !src || !!finishing },
                { text: finishing === "save" ? "Making it…" : "Save", variant: "secondary", onClick: () => void finish("save"), disabled: !src || !!finishing },
            ]}>
            <div className={cl("editor")}>
                <div className={cl("stage")}>
                    <div className={cl("toolbar")}>
                        <button type="button" className={cl("tb")} onClick={undo} disabled={!history.current.past.length} title="Undo (Ctrl+Z)">↶</button>
                        <button type="button" className={cl("tb")} onClick={redo} disabled={!history.current.future.length} title="Redo (Ctrl+Y)">↷</button>
                        <span className={cl("tb-sep")} />
                        <button type="button" className={cl("tb")} onClick={() => step(-1)} title="Previous frame (←)">⏮</button>
                        <button type="button" className={cl("tb", "tb-play")} onClick={togglePlay} title="Play / pause (Space)">{playing ? "❚❚" : "▶"}</button>
                        <button type="button" className={cl("tb")} onClick={() => step(1)} title="Next frame (→)">⏭</button>
                        <span className={cl("tb-count")} ref={counter} />
                        <span className={cl("tb-grow")} />
                        <button type="button" className={cl("tb", "tb-text")} onClick={() => setTab("output")} title="Presets">🎨 Presets</button>
                        <button type="button" className={cl("tb", "tb-text")} onClick={() => openRecent()} title="GIFs you've made">🕘 Recent</button>
                    </div>
                    <div className={cl("canvas-area", s.captionMode === "cutout" || s.cropShape === "circle" ? "checker" : undefined)}>
                        {loadError ? <div className={cl("message", "message-error")}>{loadError}</div>
                            : !src ? <div className={cl("message")}><span className={cl("spinner")} />Loading…</div>
                                : (
                                    <div className={cl("canvas-wrap")}>
                                        <canvas ref={canvas} className={cl("canvas")} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
                                        {tab === "crop" && <CropBox crop={s.crop} ratio={shapeRatio(src, s)} round={s.cropShape === "circle"} onChange={crop => set({ crop })} />}
                                        {prep && <div className={cl("prep")}><span style={{ width: `${prep.done / prep.total * 100}%` }} /></div>}
                                    </div>
                                )}
                    </div>
                    {src && src.duration > 0 && src.kind !== "slides" && (
                        <TrimBar duration={src.duration} start={start} end={end} playheadRef={playhead} thumbs={thumbs}
                            onChange={(a, b) => set({ trimStart: a, trimEnd: b >= src.duration - 0.01 ? 0 : b })} />
                    )}
                </div>
                <div className={cl("side")}>
                    <div className={cl("tabs")} role="tablist">
                        {TABS.map(t => (
                            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={cl("tab", tab === t.id && "tab-on")} onClick={() => { setTab(t.id); setTool("none"); }}>
                                <span className={cl("tab-icon")}>{t.icon}</span>{t.label}
                            </button>
                        ))}
                    </div>
                    <div className={cl("panel")}>
                        {panelProps && (
                            tab === "time" ? <TimePanel {...panelProps} />
                                : tab === "crop" ? <CropPanel {...panelProps} />
                                    : tab === "text" ? <TextPanel {...panelProps} />
                                        : tab === "effects" ? <EffectsPanel {...panelProps} />
                                            : tab === "stickers" ? <StickersPanel {...panelProps} />
                                                : <OutputPanel {...panelProps} />
                        )}
                    </div>
                </div>
            </div>
        </Modal>
    );
}
