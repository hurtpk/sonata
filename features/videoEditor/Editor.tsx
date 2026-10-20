/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Video Editor window. Drag across the timeline to pick a stretch, then
// cut it out, keep only it, mute it, or put a caption or blur on it. The
// preview plays the edit as it will come out; Export makes the MP4.

import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { saveFile } from "@utils/web";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, DraftType, openModal, React, SelectedChannelStore, showToast, UploadHandler, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { Window } from "../_shared/Window";
import { realDuration } from "../fileConverter/Trimmer";
import { captionUrl } from "./captions";
import { Exported, exportVideo, GifOptions, stopExport } from "./engine";
import { addRange, allCaptions, BlurItem, Clip, clipSpans, cutOut, emptyProject, Frame, frameRatio, inRanges, JOIN_FADE, keepOnly, locate, Look, Music, outputLength, Overlay, pieces, Project, Range, removeClip, restoreClip, SizeChoice, SoundPreset, subtractRange, TextItem, totalLength, Watermark } from "./project";

const cl = classNameFactory("vc-tool-");
const ve = classNameFactory("vc-vedit-");

const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export function clock(s: number, tenths = true) {
    if (!Number.isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60), r = s - m * 60;
    return `${m}:${r < 10 ? "0" : ""}${tenths ? r.toFixed(1) : Math.floor(r)}`;
}

/* ── Loading files ── */

function mediaInfo(file: Blob, kind: "video" | "audio"): Promise<{ url: string; duration: number; width: number; height: number; }> {
    const url = URL.createObjectURL(file);
    const el = document.createElement(kind);
    el.preload = "metadata";
    el.muted = true;
    el.src = url;
    return new Promise((res, rej) => {
        el.onloadedmetadata = async () => {
            const duration = await realDuration(el);
            const w = (el as HTMLVideoElement).videoWidth ?? 0, h = (el as HTMLVideoElement).videoHeight ?? 0;
            el.removeAttribute("src"); el.load();
            if (!duration || (kind === "video" && !w)) { URL.revokeObjectURL(url); rej(new Error("no-preview")); return; }
            res({ url, duration, width: w, height: h });
        };
        el.onerror = () => { URL.revokeObjectURL(url); rej(new Error("no-preview")); };
    });
}

async function loadClip(file: File): Promise<Clip> {
    const m = await mediaInfo(file, "video");
    return { id: uid(), name: file.name || "video.mp4", file, url: m.url, duration: m.duration, width: m.width, height: m.height, keep: [[0, m.duration]] };
}

/** A few frames from across a clip, for the timeline. Kept per clip. */
const thumbCache = new Map<string, string[]>();
function useThumbs(clip: Clip, count = 10) {
    const [frames, setFrames] = useState<string[]>(() => thumbCache.get(clip.id) ?? []);
    useEffect(() => {
        const cached = thumbCache.get(clip.id);
        if (cached) { setFrames(cached); return; }
        setFrames([]);
        let stop = false;
        const v = document.createElement("video");
        v.muted = true; v.preload = "auto"; v.src = clip.url;
        const c = document.createElement("canvas");
        c.height = 54; c.width = Math.round(54 * (clip.width / clip.height || 16 / 9));
        const ctx = c.getContext("2d")!;
        (async () => {
            await new Promise<void>(r => { v.onloadeddata = () => r(); v.onerror = () => r(); });
            const out: string[] = [];
            for (let i = 0; i < count && !stop; i++) {
                v.currentTime = Math.min(clip.duration - 0.05, ((i + 0.5) / count) * clip.duration);
                await new Promise(r => { v.onseeked = r; setTimeout(r, 1500); });
                ctx.drawImage(v, 0, 0, c.width, c.height);
                out.push(c.toDataURL("image/jpeg", 0.55));
            }
            if (!stop) { thumbCache.set(clip.id, out); setFrames(out); }
        })();
        return () => { stop = true; v.removeAttribute("src"); v.load(); };
    }, [clip.id]);
    return frames;
}

/* ── The window ── */

type Tab = "clips" | "text" | "blur" | "pictures" | "sound" | "look" | "export";
type Pick = { kind: "text" | "blur" | "overlay"; id: string; } | null;

export function openVideoEditor(files: File[] = []) {
    openModal(props => (
        <ErrorBoundary>
            <VideoEditor modalProps={props} initial={files} />
        </ErrorBoundary>
    ));
}

function VideoEditor({ modalProps, initial }: { modalProps: RenderModalProps; initial: File[]; }) {
    const accent = windowAccent("videoEditor");
    const [p, setP] = useState<Project>(emptyProject);
    const [undo, setUndo] = useState<Project[]>([]);
    const [redo, setRedo] = useState<Project[]>([]);
    const lastKey = useRef<{ key: string; at: number; } | null>(null);
    const [now, setNow] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [sel, setSel] = useState<Range | null>(null);
    const [tab, setTab] = useState<Tab>("clips");
    const [pick, setPick] = useState<Pick>(null);
    const [loadingFiles, setLoadingFiles] = useState(0);
    const [over, setOver] = useState(false);
    const picker = useRef<HTMLInputElement>(null);
    const total = totalLength(p);

    /** Changes the project. Quick repeats with the same key (dragging a slider) are one undo step. */
    const change = (next: Project, key?: string) => {
        const t = Date.now();
        const merge = key && lastKey.current?.key === key && t - lastKey.current.at < 1200;
        lastKey.current = key ? { key, at: t } : null;
        if (!merge) { setUndo(u => [...u.slice(-60), p]); setRedo([]); }
        setP(next);
    };
    const doUndo = () => { const prev = undo.at(-1); if (!prev) return; setUndo(u => u.slice(0, -1)); setRedo(r => [...r, p]); setP(prev); lastKey.current = null; };
    const doRedo = () => { const nxt = redo.at(-1); if (!nxt) return; setRedo(r => r.slice(0, -1)); setUndo(u => [...u, p]); setP(nxt); lastKey.current = null; };

    useEffect(() => { if (now > total) setNow(total); }, [total]);

    /** The video(s) just as they came in — no edits, no converting — into your message, and the editor closes. */
    const sendOriginal = () => {
        const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
        if (!channel) { showToast("Open a chat first", "failure"); return; }
        const seen = new Set<Blob>();
        const files = p.clips.filter(c => !seen.has(c.file) && seen.add(c.file))
            .map(c => c.file instanceof File ? c.file : new File([c.file], c.name, { type: c.file.type || "video/mp4" }));
        UploadHandler.promptToUpload(files, channel, DraftType.ChannelMessage);
        showToast(files.length === 1 ? "Added the original video to your message" : `Added the ${files.length} original videos to your message`, "success");
        modalProps.onClose();
    };

    const addFiles = async (list: FileList | File[] | null) => {
        const files = [...(list ?? [])];
        const videos = files.filter(f => f.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|mkv)$/i.test(f.name));
        if (!videos.length) { if (files.length) showToast("Those aren't videos", "failure"); return; }
        setLoadingFiles(n => n + videos.length);
        const loaded: Clip[] = [];
        for (const f of videos) {
            try { loaded.push(await loadClip(f)); } catch { showToast(`${f.name} can't play here — turn it into an MP4 with File Converter first`, "failure"); }
            setLoadingFiles(n => n - 1);
        }
        if (loaded.length) setP(cur => { setUndo(u => [...u.slice(-60), cur]); setRedo([]); return { ...cur, clips: [...cur.clips, ...loaded] }; });
    };
    useEffect(() => { if (initial.length) void addFiles(initial); }, []);
    // Clean up the files' preview addresses when the window closes.
    const pRef = useRef(p); pRef.current = p;
    useEffect(() => () => { pRef.current.clips.forEach(c => URL.revokeObjectURL(c.url)); pRef.current.overlays.forEach(o => URL.revokeObjectURL(o.url)); if (pRef.current.music) URL.revokeObjectURL(pRef.current.music.url); }, []);

    // Keys: space plays, Ctrl+Z / Ctrl+Y undo and redo, Delete cuts the selection.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select");
            if (typing) return;
            if (e.key === " ") { e.preventDefault(); setPlaying(v => !v); }
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); }
            else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); doRedo(); }
            else if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); act("cut"); }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    });

    const act = (what: "cut" | "keep" | "mute" | "unmute" | "text" | "blur") => {
        const [a, b] = sel ?? [now, Math.min(total, now + 3)];
        if (what === "cut") { change(cutOut(p, a, b)); setSel(null); setNow(a); }
        else if (what === "keep") { change(keepOnly(p, a, b)); setSel(null); setNow(0); }
        else if (what === "mute") change({ ...p, muted: addRange(p.muted, a, b) });
        else if (what === "unmute") change({ ...p, muted: subtractRange(p.muted, a, b) });
        else if (what === "text") {
            const t: TextItem = { id: uid(), text: "Your text", start: a, end: Math.max(b, a + 0.5), x: 0.5, y: 0.85, size: 0.075, color: "#ffffff", style: "outline", bold: true };
            change({ ...p, texts: [...p.texts, t] }); setPick({ kind: "text", id: t.id }); setTab("text");
        } else if (what === "blur") {
            const bl: BlurItem = { id: uid(), x: 0.35, y: 0.35, w: 0.3, h: 0.2, start: sel ? a : 0, end: sel ? b : total, strength: 18 };
            change({ ...p, blurs: [...p.blurs, bl] }); setPick({ kind: "blur", id: bl.id }); setTab("blur");
        }
    };

    const props: PanelProps = { p, change, now, sel, total, pick, setPick, setTab, setNow };

    return (
        <Window {...modalProps} size="xxl" title="Video Editor" subtitle="Trim, cut, caption, blur and add music — then export. It all happens on your computer."
            tools={p.clips.length > 0 && (
                <button type="button" className="vc-tool-btn" onClick={sendOriginal}
                    title={p.clips.length > 1 ? "Send the videos as they were, without any edits" : "Send the video as it was, without any edits"}>
                    {p.clips.length > 1 ? "Send originals" : "Send original"}
                </button>
            )}>
            <div className={classes(cl("wrap"), ve("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}
                onDragOver={e => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); setOver(true); } }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
                onDrop={e => { e.preventDefault(); setOver(false); void addFiles(e.dataTransfer.files); }}>
                <input ref={picker} type="file" accept="video/*" multiple hidden onChange={e => { void addFiles(e.currentTarget.files); e.currentTarget.value = ""; }} />

                {!p.clips.length ? (
                    <button type="button" className={classes(ve("drop"), over && ve("drop-over"))} onClick={() => picker.current?.click()}>
                        <span className={ve("drop-icon")}>🎬</span>
                        <b>{loadingFiles ? "Opening…" : "Drop videos here, or click to choose"}</b>
                        <span>Several videos are joined one after another. Or right-click a video in chat → Edit video.</span>
                    </button>
                ) : (
                    <div className={ve("main")}>
                        <div className={ve("left")}>
                            <Stage p={p} change={change} now={now} setNow={setNow} playing={playing} setPlaying={setPlaying} pick={pick} total={total} />
                            <div className={ve("transport")}>
                                <button type="button" className={classes(cl("btn"), cl("primary"), ve("play"))} aria-label={playing ? "Pause" : "Play"} onClick={() => { if (!playing && now >= total - 0.05) setNow(0); setPlaying(v => !v); }}>
                                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>{playing ? <path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />}</svg>
                                </button>
                                <span className={ve("time")}>{clock(now)} <i>/ {clock(total)}</i></span>
                                {(p.speed !== 1 || p.loops > 1) && <span className={cl("hint")}>Comes out {clock(outputLength(p))} long{p.speed !== 1 ? ` · ${p.speed}× speed` : ""}{p.loops > 1 ? ` · plays ${p.loops}×` : ""}</span>}
                                <span className={cl("spacer")} />
                                <button type="button" className={cl("btn")} disabled={!undo.length} onClick={doUndo} title="Undo (Ctrl+Z)">↶ Undo</button>
                                <button type="button" className={cl("btn")} disabled={!redo.length} onClick={doRedo} title="Redo (Ctrl+Y)">↷ Redo</button>
                            </div>
                            <Timeline p={p} now={now} setNow={setNow} sel={sel} setSel={setSel} total={total} pick={pick} playing={playing} setPlaying={setPlaying} onPick={(k, id) => { setPick({ kind: k, id }); setTab(k === "overlay" ? "pictures" : k); }} />
                            <div className={ve("actions")}>
                                <span className={ve("actions-label")}>{sel ? `${clock(sel[0])} – ${clock(sel[1])} (${(sel[1] - sel[0]).toFixed(1)} s)` : "Drag across the timeline to pick a part"}</span>
                                <button type="button" className={cl("btn")} disabled={!sel} onClick={() => act("cut")} title="Take this part out (Delete)">✂️ Cut out</button>
                                <button type="button" className={cl("btn")} disabled={!sel} onClick={() => act("keep")} title="Throw away everything else">⟷ Keep only this</button>
                                {sel && p.muted.some(([a, b]) => a < sel[1] && b > sel[0])
                                    ? <button type="button" className={cl("btn")} onClick={() => act("unmute")}>🔊 Unmute</button>
                                    : <button type="button" className={cl("btn")} disabled={!sel} onClick={() => act("mute")}>🔇 Mute</button>}
                                <button type="button" className={cl("btn")} onClick={() => act("text")} title={sel ? "A caption for this part" : "A caption for 3 seconds from here"}>🅣 Caption</button>
                                <button type="button" className={cl("btn")} onClick={() => act("blur")} title={sel ? "Blur a spot during this part" : "Blur a spot for the whole video"}>▦ Blur</button>
                                {sel && <button type="button" className={cl("link")} onClick={() => setSel(null)}>Clear</button>}
                            </div>
                        </div>

                        <aside className={ve("side")}>
                            <div className={classes(cl("seg"), ve("tabs"))}>
                                {([["clips", "🎞️ Clips"], ["text", "🅣 Text"], ["pictures", "🖼 Pictures"], ["blur", "▦ Blur"], ["sound", "🔊 Sound"], ["look", "⏩ Look"], ["export", "⬇ Export"]] as [Tab, string][]).map(([id, label]) => (
                                    <button key={id} type="button" className={classes(cl("seg-btn"), tab === id && cl("seg-on"))} onClick={() => setTab(id)}>{label}</button>
                                ))}
                            </div>
                            <div className={ve("panel")}>
                                {tab === "clips" && <ClipsPanel {...props} onAdd={() => picker.current?.click()} loading={loadingFiles} />}
                                {tab === "text" && <TextPanel {...props} />}
                                {tab === "blur" && <BlurPanel {...props} />}
                                {tab === "pictures" && <PicturesPanel {...props} />}
                                {tab === "sound" && <SoundPanel {...props} />}
                                {tab === "look" && <LookPanel {...props} />}
                                {tab === "export" && <ExportPanel {...props} />}
                            </div>
                        </aside>
                    </div>
                )}
                {over && p.clips.length > 0 && <div className={ve("drop-overlay")}>Drop to add to the end</div>}
            </div>
        </Window>
    );
}

/* ── Preview ── */

/** Shows a clip at a moment — waiting for it to load first if it's a different clip. */
function showAt(v: HTMLVideoElement, clip: Clip, at: number, then?: () => void) {
    if (v.dataset.clip !== clip.id) {
        v.dataset.clip = clip.id;
        v.dataset.loading = "1";
        v.src = clip.url;
        v.addEventListener("loadedmetadata", () => { v.currentTime = at; delete v.dataset.loading; then?.(); }, { once: true });
        return;
    }
    v.currentTime = at;
    then?.();
}

/** The colour settings as a CSS filter, for the preview (close to what the export does). */
function cssColour(p: Project) {
    const sat = p.saturation * (p.look === "vivid" ? 1.35 : 1), con = p.contrast * (p.look === "vivid" ? 1.08 : 1);
    const parts = [`brightness(${1 + p.brightness})`, `contrast(${con})`, `saturate(${sat})`];
    if (p.look === "bw") parts.push("grayscale(1)");
    if (p.look === "vintage") parts.push("sepia(0.45)", "contrast(0.92)");
    if (p.look === "warm") parts.push("sepia(0.2)", "saturate(1.1)", "hue-rotate(-6deg)");
    if (p.look === "cool") parts.push("hue-rotate(12deg)", "saturate(0.92)", "brightness(1.02)");
    return parts.join(" ");
}

/* The preview's sound goes through the browser's audio engine, so the sound
   presets, the beep and volume over 100% can be heard while editing. */
interface PreviewSound { ctx: AudioContext; src: MediaElementAudioSourceNode; chain: AudioNode[]; gain: GainNode; beep: GainNode; preset: SoundPreset | null; }

function presetNodes(ctx: AudioContext, preset: SoundPreset): { input: AudioNode; output: AudioNode; nodes: AudioNode[]; } | null {
    const biquad = (type: BiquadFilterType, f: number, gain = 0, q = 1) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.gain.value = gain; b.Q.value = q; return b; };
    const comp = (threshold: number, ratio: number) => { const c = ctx.createDynamicsCompressor(); c.threshold.value = threshold; c.ratio.value = ratio; return c; };
    const line = (...nodes: AudioNode[]) => { nodes.slice(1).forEach((n, i) => nodes[i].connect(n)); return { input: nodes[0], output: nodes.at(-1)!, nodes }; };
    switch (preset) {
        case "bass": return line(biquad("lowshelf", 110, 9));
        case "voice": return line(biquad("highpass", 90), biquad("peaking", 3000, 4, 1), comp(-20, 3));
        case "loud": { const g = ctx.createGain(); g.gain.value = 2; return line(comp(-26, 6), g, comp(-1, 20)); }
        case "radio": return line(biquad("highpass", 300), biquad("lowpass", 3400), comp(-20, 4));
        case "muffled": return line(biquad("lowpass", 600));
        case "echo": {
            const input = ctx.createGain(), output = ctx.createGain(), delay = ctx.createDelay(1), fb = ctx.createGain();
            delay.delayTime.value = 0.09; fb.gain.value = 0.35;
            input.connect(output); input.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(output);
            return { input, output, nodes: [input, output, delay, fb] };
        }
        default: return null;
    }
}

function wireSound(s: PreviewSound, preset: SoundPreset) {
    if (s.preset === preset) return;
    s.src.disconnect();
    s.chain.forEach(n => n.disconnect());
    const made = presetNodes(s.ctx, preset);
    if (made) { s.src.connect(made.input); made.output.connect(s.gain); s.chain = made.nodes; }
    else { s.src.connect(s.gain); s.chain = []; }
    s.preset = preset;
}

/** A picture, GIF or video laid over the preview, playing along. */
function OverlayView({ o, now, playing, speed, on }: { o: Overlay; now: number; playing: boolean; speed: number; on: boolean; }) {
    const ref = useRef<HTMLVideoElement>(null);
    const visible = now >= o.start && now < o.end;
    useEffect(() => {
        const v = ref.current;
        if (!v) return;
        const want = clamp(now - o.start, 0, o.duration || 0);
        v.muted = !o.sound;
        if (!playing || !visible) { v.pause(); if (Math.abs(v.currentTime - want) > 0.05) v.currentTime = want; }
        else { v.playbackRate = speed; if (v.paused) void v.play().catch(() => { }); if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want; }
    });
    const style: React.CSSProperties = { left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, aspectRatio: String(o.aspect || 1), opacity: o.opacity };
    return (
        <div className={classes(ve("overlay"), on && ve("overlay-on"))} style={style}>
            {o.kind === "video" ? <video ref={ref} src={o.url} playsInline preload="auto" /> : <img src={o.url} alt="" draggable={false} />}
            {on && <span className={ve("blur-handle")} data-handle="1" />}
        </div>
    );
}

function Stage({ p, change, now, setNow, playing, setPlaying, pick, total }: {
    p: Project; change(next: Project, key?: string): void; now: number; setNow(t: number): void;
    playing: boolean; setPlaying(v: boolean): void; pick: Pick; total: number;
}) {
    const video = useRef<HTMLVideoElement>(null);
    const bg = useRef<HTMLVideoElement>(null);
    const music = useRef<HTMLAudioElement>(null);
    const stage = useRef<HTMLDivElement>(null);
    const wrap = useRef<HTMLDivElement>(null);
    const sound = useRef<PreviewSound | null>(null);
    const [room, setRoom] = useState({ w: 640, h: 360 });
    const first = p.clips[0];
    const aspect = frameRatio(p, first);
    const here = locate(p, now);
    const nowRef = useRef(now); nowRef.current = now;
    const pRef = useRef(p); pRef.current = p;

    // The picture fills the room it has while keeping its shape, so captions and blurs line up exactly.
    useEffect(() => {
        const el = wrap.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setRoom({ w: el.clientWidth, h: el.clientHeight }));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const bw = Math.max(1, Math.min(room.w, room.h * aspect)), box = { w: bw, h: bw / aspect };

    useEffect(() => () => { void sound.current?.ctx.close().catch(() => { }); }, []);
    /** The audio engine, made the first time you press play (browsers want a click first). */
    const ensureSound = () => {
        if (sound.current || !video.current) return;
        try {
            const ctx = new AudioContext();
            const src = ctx.createMediaElementSource(video.current);
            const gain = ctx.createGain(); gain.connect(ctx.destination);
            const osc = ctx.createOscillator(); osc.frequency.value = 1000;
            const beep = ctx.createGain(); beep.gain.value = 0;
            osc.connect(beep); beep.connect(ctx.destination); osc.start();
            sound.current = { ctx, src, chain: [], gain, beep, preset: null };
            wireSound(sound.current, pRef.current.soundPreset);
        } catch { sound.current = null; }
    };

    // Paused: show the frame at the playhead.
    useEffect(() => {
        const v = video.current;
        if (!v || playing || !here) return;
        const clip = p.clips[here.piece.clip];
        if (v.dataset.clip !== clip.id || Math.abs(v.currentTime - here.source) > 0.04) showAt(v, clip, here.source);
    }, [playing, here?.piece.clip, here?.source, p.clips]);

    // Playing: run through the pieces, skipping what was cut.
    useEffect(() => {
        const v = video.current;
        if (!v || !playing) { v?.pause(); music.current?.pause(); return; }
        ensureSound();
        void sound.current?.ctx.resume().catch(() => { });
        let stop = false, index = locate(pRef.current, nowRef.current)?.index ?? 0;
        const start = (i: number, at: number) => {
            const piece = pieces(pRef.current)[i];
            if (!piece) return;
            showAt(v, pRef.current.clips[piece.clip], at, () => {
                v.playbackRate = pRef.current.speed;
                void v.play().catch(() => { });
            });
        };
        const here0 = locate(pRef.current, nowRef.current);
        if (!here0) { setPlaying(false); return; }
        start(here0.index, here0.source);
        const m = music.current, mus = pRef.current.music;
        if (m && mus) { m.currentTime = mus.offset + nowRef.current / pRef.current.speed; void m.play().catch(() => { }); }
        const tick = () => {
            if (stop) return;
            const list = pieces(pRef.current);
            const piece = list[index];
            if (!piece) { setPlaying(false); return; }
            if (v.dataset.loading) { requestAnimationFrame(tick); return; }
            if (v.currentTime >= piece.to - 0.02 || v.ended) {
                if (index + 1 < list.length) { index++; start(index, list[index].from); }
                else if (pRef.current.loops > 1) { index = 0; start(0, list[0].from); setNow(0); if (m && mus) m.currentTime = mus.offset; }
                else { setNow(totalLength(pRef.current)); setPlaying(false); return; }
            } else {
                const t = piece.at + Math.max(0, v.currentTime - piece.from);
                setNow(t);
                if (m && mus && Math.abs(m.currentTime - (mus.offset + t / pRef.current.speed)) > 0.35) m.currentTime = mus.offset + t / pRef.current.speed;
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return () => { stop = true; v.pause(); m?.pause(); };
    }, [playing]);

    // Sound in the preview: muted parts (or the beep), volume, the preset, music.
    useEffect(() => {
        const v = video.current;
        if (!v) return;
        const silent = p.muteAll || inRanges(p.muted, now);
        const s = sound.current;
        if (s) {
            wireSound(s, p.soundPreset);
            v.muted = false; v.volume = 1;
            s.gain.gain.value = silent ? 0 : p.volume;
            s.beep.gain.value = playing && p.beep && !p.muteAll && inRanges(p.muted, now) ? 0.2 : 0;
        } else {
            v.muted = silent;
            v.volume = clamp(p.volume, 0, 1);
        }
        v.playbackRate = p.speed;
        if (music.current && p.music) music.current.volume = clamp(p.music.volume, 0, 1);
    }, [now, playing, p.muteAll, p.muted, p.volume, p.speed, p.music, p.beep, p.soundPreset]);

    // The blurred copy behind the picture follows the main one.
    const blurFill = p.fill === "blur";
    useEffect(() => {
        const v = video.current, b = bg.current;
        if (!v || !b || !blurFill) return;
        if (b.src !== v.src) b.src = v.src;
        if (Math.abs(b.currentTime - v.currentTime) > 0.15) b.currentTime = v.currentTime;
        b.playbackRate = v.playbackRate;
        if (playing && b.paused) void b.play().catch(() => { });
        if (!playing && !b.paused) b.pause();
    });

    // Fading to and from black (and between clips).
    let black = 0;
    if (p.fadeIn > 0 && now < p.fadeIn) black = Math.max(black, 1 - now / p.fadeIn);
    if (p.fadeOut > 0 && now > total - p.fadeOut) black = Math.max(black, (now - (total - p.fadeOut)) / p.fadeOut);
    if (p.joinFade) for (const [, end] of clipSpans(p).slice(0, -1)) {
        const d = Math.abs(now - end);
        if (d < JOIN_FADE) black = Math.max(black, 1 - d / JOIN_FADE);
    }

    const shownCaptions = allCaptions(p);
    const captions = useMemo(() => shownCaptions.map(t => ({ t, url: captionUrl(t, Math.round(box.w), Math.round(box.h)) })),
        [p.texts, p.watermark, total, Math.round(box.w), Math.round(box.h)]);

    // Dragging a caption, blur or overlay around (whichever is picked in its tab).
    const drag = useRef<{ mode: "move" | "size"; dx: number; dy: number; } | null>(null);
    const posOf = (e: React.PointerEvent) => {
        const r = stage.current!.getBoundingClientRect();
        return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
    };
    const picked = pick?.kind === "text" ? p.texts.find(t => t.id === pick.id)
        : pick?.kind === "blur" ? p.blurs.find(b => b.id === pick.id)
            : pick?.kind === "overlay" ? p.overlays.find(o => o.id === pick.id) : undefined;
    /** An overlay's height as a share of the picture's. */
    const overlayH = (o: Overlay) => o.w * aspect / (o.aspect || 1);
    const onDown = (e: React.PointerEvent) => {
        if (!picked) return;
        const pos = posOf(e);
        const handle = !!(e.target as HTMLElement).dataset.handle;
        if (pick!.kind === "text") drag.current = { mode: "move", dx: 0, dy: 0 };
        else {
            const r = pick!.kind === "blur" ? picked as BlurItem : { ...(picked as Overlay), h: overlayH(picked as Overlay) };
            const inside = pos.x >= r.x && pos.x <= r.x + r.w && pos.y >= r.y && pos.y <= r.y + r.h;
            drag.current = handle ? { mode: "size", dx: 0, dy: 0 } : inside ? { mode: "move", dx: pos.x - r.x, dy: pos.y - r.y } : { mode: "move", dx: r.w / 2, dy: r.h / 2 };
        }
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { }
        onMove(e);
    };
    const onMove = (e: React.PointerEvent) => {
        if (!drag.current || !picked) return;
        const pos = posOf(e), d = drag.current;
        if (pick!.kind === "text") {
            change({ ...p, texts: p.texts.map(t => t.id === pick!.id ? { ...t, x: pos.x, y: pos.y } : t) }, `move-${pick!.id}`);
        } else if (pick!.kind === "blur") {
            const b = picked as BlurItem;
            const next = d.mode === "size"
                ? { ...b, w: clamp(pos.x - b.x, 0.03, 1 - b.x), h: clamp(pos.y - b.y, 0.03, 1 - b.y) }
                : { ...b, x: clamp(pos.x - d.dx, 0, 1 - b.w), y: clamp(pos.y - d.dy, 0, 1 - b.h) };
            change({ ...p, blurs: p.blurs.map(x => x.id === b.id ? next : x) }, `move-${b.id}`);
        } else {
            const o = picked as Overlay;
            const next = d.mode === "size"
                ? { ...o, w: clamp(pos.x - o.x, 0.05, 1 - o.x) }
                : { ...o, x: clamp(pos.x - d.dx, 0, Math.max(0, 1 - o.w)), y: clamp(pos.y - d.dy, 0, Math.max(0, 1 - overlayH(o))) };
            change({ ...p, overlays: p.overlays.map(x => x.id === o.id ? next : x) }, `move-${o.id}`);
        }
    };

    const tip = pick?.kind === "text" ? "Drag on the picture to move the caption" : pick?.kind === "blur" ? "Drag the box to move it, its corner to resize" : "Drag it to move it, its corner to resize";
    return (
        <div ref={wrap} className={ve("stage-wrap")}>
            <div ref={stage} className={classes(ve("stage"), picked && ve("stage-drag"))} style={{ width: box.w, height: box.h }}
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }}
                onClick={() => { if (!picked) setPlaying(!playing); }}>
                {blurFill && <video ref={bg} className={ve("video-bg")} muted playsInline style={{ filter: `blur(${Math.round(box.h / 24)}px) ${cssColour(p)}` }} />}
                <video ref={video} className={ve("video")} playsInline preload="auto" style={{ filter: cssColour(p) }} />
                {p.overlays.filter(o => now >= o.start && now < o.end || pick?.id === o.id).map(o => (
                    <OverlayView key={o.id} o={o} now={now} playing={playing} speed={p.speed} on={pick?.id === o.id} />
                ))}
                {p.blurs.filter(b => now >= b.start && now < b.end || pick?.id === b.id).map(b => (
                    <div key={b.id} className={classes(ve("blur"), pick?.id === b.id && ve("blur-on"))}
                        style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, backdropFilter: `blur(${b.strength * box.h / 400}px)` }}>
                        {pick?.id === b.id && <span className={ve("blur-handle")} data-handle="1" />}
                    </div>
                ))}
                {captions.filter(({ t }) => now >= t.start && now < t.end || pick?.id === t.id).map(({ t, url }) => (
                    <img key={t.id} className={classes(ve("caption"), pick?.id === t.id && ve("caption-on"))} src={url} alt="" draggable={false} />
                ))}
                {black > 0 && <div className={ve("black")} style={{ opacity: black }} />}
                {picked && <div className={ve("stage-tip")}>{tip}</div>}
            </div>
            {p.music && <audio ref={music} src={p.music.url} preload="auto" />}
        </div>
    );
}

/* ── Timeline ── */

function Timeline({ p, now, setNow, sel, setSel, total, pick, onPick, playing, setPlaying }: {
    p: Project; now: number; setNow(t: number): void; sel: Range | null; setSel(r: Range | null): void; total: number;
    pick: Pick; onPick(kind: "text" | "blur" | "overlay", id: string): void; playing: boolean; setPlaying(v: boolean): void;
}) {
    const bar = useRef<HTMLDivElement>(null);
    const drag = useRef<{ from: number; moved: boolean; edge?: 0 | 1; scrub?: boolean; resume?: boolean; } | null>(null);
    const timeAt = (x: number) => { const r = bar.current!.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1) * total; };
    const pct = (t: number) => `${total ? (t / total) * 100 : 0}%`;
    const list = pieces(p);

    return (
        <div className={ve("timeline")}>
            <div ref={bar} className={ve("track")}
                onPointerDown={e => {
                    const t = timeAt(e.clientX);
                    const { edge, scrub } = (e.target as HTMLElement).dataset;
                    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { }
                    if (scrub) {
                        // Grabbing the playhead: scrub through the video, and keep playing from where it's let go.
                        drag.current = { from: t, moved: true, scrub: true, resume: playing };
                        if (playing) setPlaying(false);
                        return;
                    }
                    drag.current = edge && sel ? { from: sel[edge === "0" ? 1 : 0], moved: true, edge: edge === "0" ? 0 : 1 } : { from: t, moved: false };
                    if (!edge) { if (playing) setPlaying(false); setNow(t); }
                }}
                onPointerMove={e => {
                    const d = drag.current;
                    if (!d) return;
                    const t = timeAt(e.clientX);
                    if (d.scrub) { setNow(t); return; }
                    if (!d.moved && Math.abs(t - d.from) < total * 0.004) return;
                    d.moved = true;
                    setSel([Math.min(t, d.from), Math.max(t, d.from)]);
                }}
                onPointerUp={() => {
                    const d = drag.current;
                    if (d && !d.moved) setSel(null);
                    if (d?.scrub && d.resume) setPlaying(true);
                    drag.current = null;
                }}>
                {list.map((x, i) => <TrackPiece key={`${p.clips[x.clip].id}-${x.from}`} clip={p.clips[x.clip]} piece={x} total={total} first={i === 0 || list[i - 1].clip !== x.clip} />)}
                {sel && (
                    <div className={ve("sel")} style={{ left: pct(sel[0]), width: pct(sel[1] - sel[0]) }}>
                        <span data-edge="0" className={ve("sel-edge")} /><span data-edge="1" className={classes(ve("sel-edge"), ve("sel-edge-r"))} />
                    </div>
                )}
                <div className={ve("playhead")} data-scrub="1" style={{ left: pct(now) }} title="Drag to scrub">
                    <span className={ve("playhead-knob")} data-scrub="1" />
                </div>
            </div>
            <div className={ve("lanes")}>
                {p.muted.length > 0 && (
                    <div className={ve("lane")} title="Muted parts">
                        <span className={ve("lane-name")}>{p.beep ? "📢" : "🔇"}</span>
                        {p.muted.map(([a, b], i) => <span key={i} className={classes(ve("item"), ve("item-mute"))} style={{ left: pct(a), width: pct(b - a) }} onClick={() => setSel([a, b])} />)}
                    </div>
                )}
                {p.texts.length > 0 && (
                    <div className={ve("lane")}>
                        <span className={ve("lane-name")}>🅣</span>
                        {p.texts.map(t => <span key={t.id} className={classes(ve("item"), ve("item-text"), pick?.id === t.id && ve("item-on"))} style={{ left: pct(t.start), width: pct(t.end - t.start) }} onClick={() => onPick("text", t.id)}>{t.text.split("\n")[0]}</span>)}
                    </div>
                )}
                {p.overlays.length > 0 && (
                    <div className={ve("lane")}>
                        <span className={ve("lane-name")}>🖼</span>
                        {p.overlays.map(o => <span key={o.id} className={classes(ve("item"), ve("item-overlay"), pick?.id === o.id && ve("item-on"))} style={{ left: pct(o.start), width: pct(o.end - o.start) }} onClick={() => onPick("overlay", o.id)}>{o.name}</span>)}
                    </div>
                )}
                {p.blurs.length > 0 && (
                    <div className={ve("lane")}>
                        <span className={ve("lane-name")}>▦</span>
                        {p.blurs.map((b, i) => <span key={b.id} className={classes(ve("item"), ve("item-blur"), pick?.id === b.id && ve("item-on"))} style={{ left: pct(b.start), width: pct(b.end - b.start) }} onClick={() => onPick("blur", b.id)}>Blur {i + 1}</span>)}
                    </div>
                )}
            </div>
        </div>
    );
}

function TrackPiece({ clip, piece, total, first }: { clip: Clip; piece: { from: number; to: number; at: number; }; total: number; first: boolean; }) {
    const frames = useThumbs(clip);
    const len = piece.to - piece.from;
    const shown = frames.filter((_, i) => { const t = ((i + 0.5) / frames.length) * clip.duration; return t >= piece.from - clip.duration / frames.length / 2 && t <= piece.to + clip.duration / frames.length / 2; });
    return (
        <div className={classes(ve("piece"), first && ve("piece-first"))} style={{ left: `${(piece.at / total) * 100}%`, width: `${(len / total) * 100}%` }} title={`${clip.name} · ${clock(piece.from)}–${clock(piece.to)}`}>
            {shown.map((f, i) => <img key={i} src={f} alt="" draggable={false} />)}
            {first && <span className={ve("piece-name")}>{clip.name}</span>}
        </div>
    );
}

/* ── Side panels ── */

interface PanelProps {
    p: Project; change(next: Project, key?: string): void; now: number; sel: Range | null; total: number;
    pick: Pick; setPick(p: Pick): void; setTab(t: Tab): void; setNow(t: number): void;
}

function Slider({ label, value, min, max, step, onChange, show }: { label: string; value: number; min: number; max: number; step: number; onChange(v: number): void; show?: string; }) {
    return (
        <label className={ve("slider")}>
            <span>{label}</span>
            <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.currentTarget.value))} />
            <b>{show ?? value}</b>
        </label>
    );
}

function Times({ start, end, total, sel, onChange }: { start: number; end: number; total: number; sel: Range | null; onChange(s: number, e: number): void; }) {
    const num = (v: number, set: (n: number) => void) => <input type="number" className={classes(cl("input"), ve("num"))} min={0} max={total} step={0.1} value={Number(v.toFixed(1))} onChange={e => set(clamp(Number(e.currentTarget.value) || 0, 0, total))} />;
    return (
        <div className={ve("times")}>
            <span>From</span>{num(start, s => onChange(s, Math.max(end, s + 0.1)))}
            <span>to</span>{num(end, e => onChange(Math.min(start, e - 0.1), e))}
            {sel && <button type="button" className={cl("link")} onClick={() => onChange(sel[0], sel[1])}>Use the picked part</button>}
            <button type="button" className={cl("link")} onClick={() => onChange(0, total)}>Whole video</button>
        </div>
    );
}

function ClipsPanel({ p, change, onAdd, loading }: PanelProps & { onAdd(): void; loading: number; }) {
    const spans = clipSpans(p);
    const move = (i: number, d: number) => {
        const clips = [...p.clips];
        [clips[i], clips[i + d]] = [clips[i + d], clips[i]];
        change({ ...p, clips });
    };
    return (
        <div className={ve("stack")}>
            {p.clips.map((c, i) => {
                const kept = spans[i][1] - spans[i][0];
                return (
                    <div key={c.id} className={ve("clip")}>
                        <ClipThumb clip={c} />
                        <div className={ve("clip-main")}>
                            <b title={c.name}>{c.name}</b>
                            <span>{clock(kept)}{kept < c.duration - 0.05 ? ` of ${clock(c.duration)} kept` : ""} · {c.width}×{c.height}</span>
                        </div>
                        {kept < c.duration - 0.05 && <button type="button" className={ve("mini")} title="Bring back the parts you cut" onClick={() => change(restoreClip(p, i))}>↺</button>}
                        <button type="button" className={ve("mini")} disabled={i === 0} title="Move earlier" onClick={() => move(i, -1)}>▲</button>
                        <button type="button" className={ve("mini")} disabled={i === p.clips.length - 1} title="Move later" onClick={() => move(i, 1)}>▼</button>
                        <button type="button" className={ve("mini")} title="Take this clip out" onClick={() => change(removeClip(p, i))}>✕</button>
                    </div>
                );
            })}
            <button type="button" className={ve("add")} onClick={onAdd}>{loading ? "Opening…" : "＋ Add more clips"}</button>
            {p.clips.length > 1 && (
                <label className={cl("check")}>
                    <input type="checkbox" checked={p.joinFade} onChange={e => change({ ...p, joinFade: e.currentTarget.checked })} /> Fade through black between clips
                </label>
            )}
            <span className={cl("hint")}>Clips play one after another. Different sizes are fitted to the first clip's shape, with black bars if needed.</span>
        </div>
    );
}

function ClipThumb({ clip }: { clip: Clip; }) {
    const frames = useThumbs(clip);
    return frames[1] ?? frames[0] ? <img className={ve("clip-thumb")} src={frames[1] ?? frames[0]} alt="" /> : <span className={ve("clip-thumb")} />;
}

const COLOURS = ["#ffffff", "#ffe066", "#ff6b6b", "#69db7c", "#4dabf7", "#da77f2", "#000000"];

function TextPanel({ p, change, sel, total, pick, setPick, now }: PanelProps) {
    const t = pick?.kind === "text" ? p.texts.find(x => x.id === pick.id) : undefined;
    const set = (patch: Partial<TextItem>, key?: string) => t && change({ ...p, texts: p.texts.map(x => x.id === t.id ? { ...x, ...patch } : x) }, key && `${key}-${t.id}`);
    const add = () => {
        const [a, b] = sel ?? [now, Math.min(total, now + 3)];
        const item: TextItem = { id: uid(), text: "Your text", start: a, end: Math.max(b, a + 0.5), x: 0.5, y: 0.85, size: 0.075, color: "#ffffff", style: "outline", bold: true };
        change({ ...p, texts: [...p.texts, item] });
        setPick({ kind: "text", id: item.id });
    };
    return (
        <div className={ve("stack")}>
            <button type="button" className={classes(cl("btn"), cl("primary"))} onClick={add}>＋ Add a caption {sel ? "for the picked part" : "here"}</button>
            {p.texts.length > 0 && (
                <div className={ve("chips")}>
                    {p.texts.map(x => <button key={x.id} type="button" className={classes(ve("chip"), pick?.id === x.id && ve("chip-on"))} onClick={() => setPick({ kind: "text", id: x.id })}>🅣 {x.text.split("\n")[0].slice(0, 18) || "(empty)"}</button>)}
                </div>
            )}
            {t ? (
                <>
                    <textarea className={classes(cl("input"), ve("textbox"))} value={t.text} onChange={e => set({ text: e.currentTarget.value }, "text")} placeholder="What it says" />
                    <Times start={t.start} end={t.end} total={total} sel={sel} onChange={(s, e) => set({ start: s, end: e })} />
                    <Slider label="Size" min={0.03} max={0.2} step={0.005} value={t.size} show={`${Math.round(t.size * 100)}`} onChange={v => set({ size: v }, "size")} />
                    <div className={ve("row")}>
                        {COLOURS.map(c => <button key={c} type="button" className={classes(ve("swatch"), t.color === c && ve("swatch-on"))} style={{ background: c }} onClick={() => set({ color: c })} />)}
                        <input type="color" className={ve("swatch-pick")} value={t.color} onChange={e => set({ color: e.currentTarget.value }, "colour")} />
                    </div>
                    <div className={cl("seg")}>
                        {([["outline", "Outline"], ["box", "Box"], ["shadow", "Shadow"]] as const).map(([s, l]) => <button key={s} type="button" className={classes(cl("seg-btn"), t.style === s && cl("seg-on"))} onClick={() => set({ style: s })}>{l}</button>)}
                        <button type="button" className={classes(cl("seg-btn"), t.bold && cl("seg-on"))} onClick={() => set({ bold: !t.bold })}><b>B</b></button>
                    </div>
                    <div className={cl("seg")}>
                        {([["Top", 0.12], ["Middle", 0.5], ["Bottom", 0.86]] as const).map(([l, y]) => <button key={l} type="button" className={cl("seg-btn")} onClick={() => set({ x: 0.5, y })}>{l}</button>)}
                    </div>
                    <span className={cl("hint")}>Drag on the picture to put it anywhere.</span>
                    <div className={ve("row")}>
                        <button type="button" className={cl("btn")} onClick={() => setPick(null)}>Done</button>
                        <button type="button" className={classes(cl("btn"), ve("danger"))} onClick={() => { change({ ...p, texts: p.texts.filter(x => x.id !== t.id) }); setPick(null); }}>Delete caption</button>
                    </div>
                </>
            ) : p.texts.length > 0 && <span className={cl("hint")}>Pick a caption to change it.</span>}
            <WatermarkBox p={p} change={change} now={now} sel={sel} total={total} pick={pick} setPick={setPick} setTab={() => { }} setNow={() => { }} />
        </div>
    );
}

function BlurPanel({ p, change, sel, total, pick, setPick }: PanelProps) {
    const b = pick?.kind === "blur" ? p.blurs.find(x => x.id === pick.id) : undefined;
    const set = (patch: Partial<BlurItem>, key?: string) => b && change({ ...p, blurs: p.blurs.map(x => x.id === b.id ? { ...x, ...patch } : x) }, key && `${key}-${b.id}`);
    const add = () => {
        const item: BlurItem = { id: uid(), x: 0.35, y: 0.35, w: 0.3, h: 0.2, start: sel ? sel[0] : 0, end: sel ? sel[1] : total, strength: 18 };
        change({ ...p, blurs: [...p.blurs, item] });
        setPick({ kind: "blur", id: item.id });
    };
    return (
        <div className={ve("stack")}>
            <button type="button" className={classes(cl("btn"), cl("primary"))} onClick={add}>＋ Blur a spot {sel ? "during the picked part" : "for the whole video"}</button>
            <span className={cl("hint")}>For hiding a name, a chat or a face that stays in one place — move and resize the box on the picture.</span>
            {p.blurs.length > 0 && (
                <div className={ve("chips")}>
                    {p.blurs.map((x, i) => <button key={x.id} type="button" className={classes(ve("chip"), pick?.id === x.id && ve("chip-on"))} onClick={() => setPick({ kind: "blur", id: x.id })}>▦ Blur {i + 1}</button>)}
                </div>
            )}
            {b && (
                <>
                    <Times start={b.start} end={b.end} total={total} sel={sel} onChange={(s, e) => set({ start: s, end: e })} />
                    <Slider label="Strength" min={4} max={40} step={1} value={b.strength} onChange={v => set({ strength: v }, "strength")} />
                    <div className={ve("row")}>
                        <button type="button" className={cl("btn")} onClick={() => setPick(null)}>Done</button>
                        <button type="button" className={classes(cl("btn"), ve("danger"))} onClick={() => { change({ ...p, blurs: p.blurs.filter(x => x.id !== b.id) }); setPick(null); }}>Delete blur</button>
                    </div>
                </>
            )}
        </div>
    );
}

const SOUND_PRESETS: [SoundPreset, string][] = [["none", "Normal"], ["bass", "Bass boost"], ["voice", "Clearer voice"], ["loud", "Louder"], ["radio", "Radio"], ["echo", "Echo"], ["muffled", "Muffled"]];

function SoundPanel({ p, change, setNow }: PanelProps) {
    const musicPicker = useRef<HTMLInputElement>(null);
    const addMusic = async (file?: File) => {
        if (!file) return;
        try {
            const m = await mediaInfo(file, "audio");
            if (p.music) URL.revokeObjectURL(p.music.url);
            const music: Music = { name: file.name, file, url: m.url, duration: m.duration, volume: 0.6, offset: 0 };
            change({ ...p, music });
        } catch { showToast("That song can't be played here — try an MP3", "failure"); }
    };
    return (
        <div className={ve("stack")}>
            <label className={cl("check")}><input type="checkbox" checked={p.muteAll} onChange={e => change({ ...p, muteAll: e.currentTarget.checked })} /> Mute the whole video</label>
            {!p.muteAll && (
                <>
                    <Slider label="Volume" min={0} max={3} step={0.05} value={p.volume} show={`${Math.round(p.volume * 100)}%`} onChange={v => change({ ...p, volume: v }, "volume")} />
                    <span className={cl("label")}>Sound preset</span>
                    <div className={ve("chips")}>
                        {SOUND_PRESETS.map(([id, label]) => <button key={id} type="button" className={classes(ve("chip"), p.soundPreset === id && ve("chip-on"))} onClick={() => change({ ...p, soundPreset: id })}>{label}</button>)}
                    </div>
                    <label className={cl("check")}><input type="checkbox" checked={p.normalize} onChange={e => change({ ...p, normalize: e.currentTarget.checked })} /> Even out loud and quiet parts</label>
                    <Slider label="Fade in" min={0} max={5} step={0.1} value={p.audioFadeIn} show={p.audioFadeIn ? `${p.audioFadeIn.toFixed(1)} s` : "off"} onChange={v => change({ ...p, audioFadeIn: v }, "afi")} />
                    <Slider label="Fade out" min={0} max={5} step={0.1} value={p.audioFadeOut} show={p.audioFadeOut ? `${p.audioFadeOut.toFixed(1)} s` : "off"} onChange={v => change({ ...p, audioFadeOut: v }, "afo")} />
                    <span className={cl("label")}>Muted parts</span>
                    <label className={cl("check")}><input type="checkbox" checked={p.beep} onChange={e => change({ ...p, beep: e.currentTarget.checked })} /> 📢 Beep over them instead of silence</label>
                    {p.muted.length ? (
                        <div className={ve("stack-tight")}>
                            {p.muted.map(([a, b], i) => (
                                <div key={i} className={ve("row")}>
                                    <button type="button" className={cl("link")} onClick={() => setNow(a)}>{p.beep ? "📢" : "🔇"} {clock(a)} – {clock(b)}</button>
                                    <button type="button" className={ve("mini")} title="Unmute" onClick={() => change({ ...p, muted: p.muted.filter((_, j) => j !== i) })}>✕</button>
                                </div>
                            ))}
                        </div>
                    ) : <span className={cl("hint")}>Pick a part on the timeline and press 🔇 Mute.</span>}
                </>
            )}
            <span className={cl("label")}>Music</span>
            <input ref={musicPicker} type="file" accept="audio/*" hidden onChange={e => { void addMusic(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
            {p.music ? (
                <>
                    <div className={ve("row")}>
                        <span className={ve("music-name")} title={p.music.name}>🎵 {p.music.name}</span>
                        <button type="button" className={ve("mini")} title="Remove the music" onClick={() => change({ ...p, music: null })}>✕</button>
                    </div>
                    <Slider label="Music volume" min={0} max={1.5} step={0.05} value={p.music.volume} show={`${Math.round(p.music.volume * 100)}%`} onChange={v => change({ ...p, music: { ...p.music!, volume: v } }, "mvol")} />
                    <Slider label="Start the song at" min={0} max={Math.max(0, p.music.duration - 1)} step={0.5} value={p.music.offset} show={clock(p.music.offset, false)} onChange={v => change({ ...p, music: { ...p.music!, offset: v } }, "moff")} />
                </>
            ) : <button type="button" className={ve("add")} onClick={() => musicPicker.current?.click()}>＋ Add a song</button>}
        </div>
    );
}

const LOOKS: [Look, string][] = [["none", "None"], ["bw", "Black & white"], ["vintage", "Vintage"], ["warm", "Warm"], ["cool", "Cool"], ["vivid", "Vivid"]];
const FRAMES: [Frame, string][] = [["source", "Original"], ["16:9", "16:9"], ["9:16", "9:16"], ["1:1", "1:1"], ["4:5", "4:5"]];

function LookPanel({ p, change }: PanelProps) {
    const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
    const colourChanged = p.brightness !== 0 || p.contrast !== 1 || p.saturation !== 1 || p.look !== "none";
    return (
        <div className={ve("stack")}>
            <span className={cl("label")}>Shape</span>
            <div className={cl("seg")}>
                {FRAMES.map(([f, l]) => <button key={f} type="button" className={classes(cl("seg-btn"), p.frame === f && cl("seg-on"))} onClick={() => change({ ...p, frame: f })}>{l}</button>)}
            </div>
            <div className={cl("seg")}>
                <button type="button" className={classes(cl("seg-btn"), p.fill === "black" && cl("seg-on"))} onClick={() => change({ ...p, fill: "black" })}>Black bars</button>
                <button type="button" className={classes(cl("seg-btn"), p.fill === "blur" && cl("seg-on"))} onClick={() => change({ ...p, fill: "blur" })}>Blurred background</button>
            </div>
            <span className={cl("hint")}>When a clip doesn't fit the shape, the space around it is filled.</span>

            <span className={cl("label")}>Colour</span>
            <div className={ve("chips")}>
                {LOOKS.map(([id, label]) => <button key={id} type="button" className={classes(ve("chip"), p.look === id && ve("chip-on"))} onClick={() => change({ ...p, look: id })}>{label}</button>)}
            </div>
            <Slider label="Brightness" min={-0.5} max={0.5} step={0.01} value={p.brightness} show={`${p.brightness > 0 ? "+" : ""}${Math.round(p.brightness * 100)}`} onChange={v => change({ ...p, brightness: v }, "bright")} />
            <Slider label="Contrast" min={0.5} max={2} step={0.01} value={p.contrast} show={`${Math.round(p.contrast * 100)}%`} onChange={v => change({ ...p, contrast: v }, "contrast")} />
            <Slider label="Saturation" min={0} max={2.5} step={0.01} value={p.saturation} show={`${Math.round(p.saturation * 100)}%`} onChange={v => change({ ...p, saturation: v }, "sat")} />
            {colourChanged && <button type="button" className={cl("link")} onClick={() => change({ ...p, brightness: 0, contrast: 1, saturation: 1, look: "none" })}>Reset colour</button>}

            <span className={cl("label")}>Speed</span>
            <div className={cl("seg")}>
                {SPEEDS.map(s => <button key={s} type="button" className={classes(cl("seg-btn"), p.speed === s && cl("seg-on"))} onClick={() => change({ ...p, speed: s })}>{s}×</button>)}
            </div>
            <span className={cl("hint")}>The sound keeps its normal pitch.</span>
            <Slider label="Play it" min={1} max={10} step={1} value={p.loops} show={p.loops === 1 ? "once" : `${p.loops} times`} onChange={v => change({ ...p, loops: v }, "loops")} />
            <span className={cl("label")}>Fade from and to black</span>
            <Slider label="At the start" min={0} max={3} step={0.1} value={p.fadeIn} show={p.fadeIn ? `${p.fadeIn.toFixed(1)} s` : "off"} onChange={v => change({ ...p, fadeIn: v }, "fi")} />
            <Slider label="At the end" min={0} max={3} step={0.1} value={p.fadeOut} show={p.fadeOut ? `${p.fadeOut.toFixed(1)} s` : "off"} onChange={v => change({ ...p, fadeOut: v }, "fo")} />
        </div>
    );
}

/** One click for where it's going. */
const EXPORT_PRESETS: { id: string; label: string; hint: string; set: Partial<Project>; }[] = [
    { id: "discord", label: "Discord", hint: "Under 10 MB · 720p", set: { size: 10, maxHeight: 720, frame: "source" } },
    { id: "nitro", label: "Discord Nitro", hint: "Under 500 MB · full size", set: { size: 500, maxHeight: 0, frame: "source" } },
    { id: "vertical", label: "TikTok · Reels · Shorts", hint: "9:16 · 1080p", set: { frame: "9:16", fill: "blur", maxHeight: 1080, size: "best" } },
    { id: "youtube", label: "YouTube", hint: "16:9 · 1080p · best", set: { frame: "16:9", maxHeight: 1080, size: "best" } },
    { id: "x", label: "Twitter / X", hint: "16:9 · 720p", set: { frame: "16:9", maxHeight: 720, size: "smaller" } },
    { id: "insta", label: "Instagram post", hint: "4:5 · 1080p", set: { frame: "4:5", fill: "blur", maxHeight: 1080, size: "smaller" } },
];

function ExportPanel({ p, change }: PanelProps) {
    const [busy, setBusy] = useState<{ text: string; progress?: number; } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<(Exported & { url: string; }) | null>(null);
    const [custom, setCustom] = useState(typeof p.size === "number" && ![10, 50, 500].includes(p.size) ? String(p.size) : "");
    useEffect(() => () => { if (done) URL.revokeObjectURL(done.url); }, [done]);
    const sizes: [SizeChoice, string, string][] = [["best", "Best quality", "Bigger file"], ["smaller", "Smaller", "Good for sharing"], [10, "Under 10 MB", "Discord's free limit"], [50, "Under 50 MB", "Nitro Basic"], [500, "Under 500 MB", "Nitro"]];
    const heights: [number, string][] = [[0, "Original"], [1080, "1080p"], [720, "720p"], [480, "480p"]];
    const inputSize = p.clips.reduce((n, c) => n + c.file.size, 0);
    const presetOn = (set: Partial<Project>) => Object.entries(set).every(([k, v]) => (p as any)[k] === v);
    const [asGif, setAsGif] = useState(false);
    const [gif, setGif] = useState<GifOptions>({ width: 480, fps: 15, fit10: true });

    const run = async () => {
        setError(null);
        if (done) { URL.revokeObjectURL(done.url); setDone(null); }
        setBusy({ text: "Starting…" });
        try {
            const r = await exportVideo(p, (text, progress) => setBusy({ text, progress }), asGif ? gif : undefined);
            setDone({ ...r, url: URL.createObjectURL(r.blob) });
        } catch (e) {
            setError(e instanceof Error && e.message ? e.message : "It stopped");
        } finally {
            setBusy(null);
        }
    };
    const file = () => new File([done!.blob], done!.name, { type: done!.gif ? "image/gif" : "video/mp4" });
    const send = () => {
        const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
        if (!channel) { showToast("Open a chat first", "failure"); return; }
        UploadHandler.promptToUpload([file()], channel, DraftType.ChannelMessage);
        showToast("Added to your message", "success");
    };

    return (
        <div className={ve("stack")}>
            <span className={cl("label")}>Export as</span>
            <div className={cl("seg")}>
                <button type="button" className={classes(cl("seg-btn"), !asGif && cl("seg-on"))} onClick={() => setAsGif(false)}>🎬 Video (MP4)</button>
                <button type="button" className={classes(cl("seg-btn"), asGif && cl("seg-on"))} onClick={() => setAsGif(true)}>🖼️ GIF</button>
            </div>
            {asGif ? (
                <div className={ve("stack")}>
                    <span className={cl("label")}>Width</span>
                    <div className={cl("seg")}>
                        {[[320, "320px"], [480, "480px"], [640, "640px"], [0, "Original"]].map(([w, l]) => <button key={w} type="button" className={classes(cl("seg-btn"), gif.width === w && cl("seg-on"))} onClick={() => setGif(g => ({ ...g, width: w as number }))}>{l}</button>)}
                    </div>
                    <span className={cl("label")}>Smoothness</span>
                    <div className={cl("seg")}>
                        {[10, 15, 20, 25].map(f => <button key={f} type="button" className={classes(cl("seg-btn"), gif.fps === f && cl("seg-on"))} onClick={() => setGif(g => ({ ...g, fps: f }))}>{f} fps</button>)}
                    </div>
                    <label className={cl("check")}><input type="checkbox" checked={gif.fit10} onChange={e => setGif(g => ({ ...g, fit10: e.currentTarget.checked }))} /> Keep it under 10 MB (makes it smaller if it needs to)</label>
                    <span className={cl("hint")}>GIFs have no sound and get big fast — short clips work best. Everything you edited (cuts, captions, speed…) is in it.</span>
                </div>
            ) : <>
            <span className={cl("label")}>Made for</span>
            <div className={ve("sizes")}>
                {EXPORT_PRESETS.map(x => (
                    <button key={x.id} type="button" className={classes(ve("size"), presetOn(x.set) && ve("size-on"))} onClick={() => change({ ...p, ...x.set })}>
                        <b>{x.label}</b><span>{x.hint}</span>
                    </button>
                ))}
            </div>
            <details className={ve("more")}>
                <summary>Choose it yourself</summary>
                <div className={ve("stack")}>
                    <span className={cl("label")}>File size</span>
                    <div className={ve("sizes")}>
                        {sizes.map(([v, label, hint]) => (
                            <button key={String(v)} type="button" className={classes(ve("size"), p.size === v && ve("size-on"))} onClick={() => change({ ...p, size: v })}>
                                <b>{label}</b><span>{hint}</span>
                            </button>
                        ))}
                    </div>
                    <div className={ve("row")}>
                        <span className={cl("hint")}>Or under</span>
                        <input type="number" min={1} max={2000} className={classes(cl("input"), ve("num"))} placeholder="MB" value={custom}
                            onChange={e => { setCustom(e.currentTarget.value); const n = Number(e.currentTarget.value); if (n >= 1) change({ ...p, size: n }, "size"); }} />
                        <span className={cl("hint")}>MB</span>
                    </div>
                    <span className={cl("label")}>Picture size</span>
                    <div className={cl("seg")}>
                        {heights.map(([h, l]) => <button key={h} type="button" className={classes(cl("seg-btn"), p.maxHeight === h && cl("seg-on"))} onClick={() => change({ ...p, maxHeight: h })}>{l}</button>)}
                    </div>
                    <span className={cl("hint")}>The shape (9:16, 1:1…) is in ⏩ Look.</span>
                </div>
            </details>
            </>}
            {!asGif && <span className={cl("hint")}>Comes out as an MP4, {clock(outputLength(p))} long{p.frame !== "source" ? `, ${p.frame}` : ""}. Long videos take a while — it all runs on your computer (the converter is a one-time 31 MB download).</span>}
            {inputSize > 900 * 1048576 && <span className={cl("error")}>These clips are very big ({(inputSize / 1048576 / 1024).toFixed(1)} GB) — exporting may run out of memory. Trim them in another app first if it fails.</span>}

            {busy ? (
                <div className={ve("busy")}>
                    <span>{busy.text}</span>
                    <div className={ve("bar")}><div style={{ width: `${Math.round((busy.progress ?? 0) * 100)}%` }} /></div>
                    <button type="button" className={cl("btn")} onClick={() => stopExport()}>Stop</button>
                </div>
            ) : (
                <button type="button" className={classes(cl("btn"), cl("primary"), ve("export"))} onClick={run}>{asGif ? "⬇ Make GIF" : "⬇ Export video"}</button>
            )}
            {error && <div className={cl("error")}>{error}</div>}
            {done && (
                <div className={ve("done")}>
                    {done.gif ? <img src={done.url} alt="" className={ve("done-video")} /> : <video src={done.url} controls className={ve("done-video")} />}
                    <span className={cl("hint")}>{done.name} · {(done.blob.size / 1048576).toFixed(1)} MB · {clock(done.seconds)}</span>
                    {done.note && <span className={cl("hint")}>{done.note}</span>}
                    <div className={ve("row")}>
                        <button type="button" className={classes(cl("btn"), cl("primary"))} onClick={send}>Send in chat</button>
                        <button type="button" className={cl("btn")} onClick={() => saveFile(file())}>Save</button>
                    </div>
                </div>
            )}
        </div>
    );
}

/** A picture's or video's shape and length, for an overlay. */
async function overlayFrom(file: File): Promise<Omit<Overlay, "x" | "y" | "w" | "start" | "end" | "opacity" | "sound" | "id">> {
    const url = URL.createObjectURL(file);
    if (file.type.startsWith("video/")) {
        URL.revokeObjectURL(url);
        const m = await mediaInfo(file, "video");
        return { name: file.name, file, url: m.url, kind: "video", aspect: m.width / m.height, duration: m.duration };
    }
    // Its load event, not decode(): decode() waits for the window to be drawn, so it stalls while Discord is minimised.
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("no-preview")); }; img.src = url; });
    return { name: file.name, file, url, kind: file.type === "image/gif" ? "gif" : "image", aspect: img.naturalWidth / img.naturalHeight || 1, duration: 0 };
}

function PicturesPanel({ p, change, sel, total, pick, setPick }: PanelProps) {
    const picker = useRef<HTMLInputElement>(null);
    const o = pick?.kind === "overlay" ? p.overlays.find(x => x.id === pick.id) : undefined;
    const set = (patch: Partial<Overlay>, key?: string) => o && change({ ...p, overlays: p.overlays.map(x => x.id === o.id ? { ...x, ...patch } : x) }, key && `${key}-${o.id}`);
    const add = async (file?: File) => {
        if (!file) return;
        try {
            const base = await overlayFrom(file);
            const w = base.kind === "video" ? 0.32 : 0.22;
            const [a, b] = sel ?? [0, total];
            const item: Overlay = { ...base, id: uid(), x: 1 - w - 0.03, y: 0.04, w, start: a, end: base.kind === "video" && !sel ? Math.min(total, a + base.duration) : b, opacity: 1, sound: true };
            change({ ...p, overlays: [...p.overlays, item] });
            setPick({ kind: "overlay", id: item.id });
        } catch { showToast(`${file.name} can't be shown here`, "failure"); }
    };
    const corner = (x: number, y: number) => {
        if (!o) return;
        const h = o.w * frameRatio(p, p.clips[0]) / (o.aspect || 1);
        set({ x: x < 0 ? 0.03 : x > 0 ? 0.97 - o.w : (1 - o.w) / 2, y: y < 0 ? 0.04 : y > 0 ? 0.96 - h : (1 - h) / 2 });
    };
    return (
        <div className={ve("stack")}>
            <input ref={picker} type="file" accept="image/*,video/*" hidden onChange={e => { void add(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
            <button type="button" className={classes(cl("btn"), cl("primary"))} onClick={() => picker.current?.click()}>＋ Add a picture, GIF or video {sel ? "for the picked part" : ""}</button>
            <span className={cl("hint")}>A logo, a sticker, or a video in the corner (like a webcam over gameplay). Move and resize it on the picture.</span>
            {p.overlays.length > 0 && (
                <div className={ve("chips")}>
                    {p.overlays.map(x => <button key={x.id} type="button" className={classes(ve("chip"), pick?.id === x.id && ve("chip-on"))} onClick={() => setPick({ kind: "overlay", id: x.id })}>{x.kind === "video" ? "🎞️" : "🖼"} {x.name.slice(0, 16)}</button>)}
                </div>
            )}
            {o && (
                <>
                    <Times start={o.start} end={o.end} total={total} sel={sel} onChange={(s, e) => set({ start: s, end: e })} />
                    <Slider label="Size" min={0.05} max={1} step={0.01} value={o.w} show={`${Math.round(o.w * 100)}%`} onChange={v => set({ w: v, x: Math.min(o.x, 1 - v) }, "size")} />
                    <Slider label="See-through" min={0.1} max={1} step={0.05} value={o.opacity} show={`${Math.round(o.opacity * 100)}%`} onChange={v => set({ opacity: v }, "opacity")} />
                    <div className={ve("corners")}>
                        {([[-1, -1, "↖"], [0, -1, "↑"], [1, -1, "↗"], [-1, 0, "←"], [0, 0, "•"], [1, 0, "→"], [-1, 1, "↙"], [0, 1, "↓"], [1, 1, "↘"]] as const).map(([x, y, l]) => (
                            <button key={l} type="button" className={ve("corner")} onClick={() => corner(x, y)}>{l}</button>
                        ))}
                    </div>
                    {o.kind === "video" && <label className={cl("check")}><input type="checkbox" checked={o.sound} onChange={e => set({ sound: e.currentTarget.checked })} /> Include its sound</label>}
                    <div className={ve("row")}>
                        <button type="button" className={cl("btn")} onClick={() => setPick(null)}>Done</button>
                        <button type="button" className={classes(cl("btn"), ve("danger"))} onClick={() => { URL.revokeObjectURL(o.url); change({ ...p, overlays: p.overlays.filter(x => x.id !== o.id) }); setPick(null); }}>Delete</button>
                    </div>
                </>
            )}
        </div>
    );
}

/** Your name or tag in a corner, all the way through. */
function WatermarkBox({ p, change }: PanelProps) {
    const w = p.watermark;
    const set = (patch: Partial<Watermark>, key?: string) => change({ ...p, watermark: { text: "", corner: "br", size: 0.04, opacity: 0.8, ...w, ...patch } }, key);
    return (
        <div className={ve("stack-tight")}>
            <span className={cl("label")}>Watermark</span>
            <input className={cl("input")} placeholder="@yourname — shows in a corner the whole time" value={w?.text ?? ""} onChange={e => set({ text: e.currentTarget.value }, "wm-text")} />
            {w?.text.trim() && (
                <>
                    <div className={cl("seg")}>
                        {([["tl", "↖ Top left"], ["tr", "↗ Top right"], ["bl", "↙ Bottom left"], ["br", "↘ Bottom right"]] as const).map(([c, l]) => <button key={c} type="button" className={classes(cl("seg-btn"), w.corner === c && cl("seg-on"))} onClick={() => set({ corner: c })}>{l}</button>)}
                    </div>
                    <Slider label="Size" min={0.02} max={0.09} step={0.005} value={w.size} show={`${Math.round(w.size * 100)}`} onChange={v => set({ size: v }, "wm-size")} />
                    <Slider label="See-through" min={0.2} max={1} step={0.05} value={w.opacity} show={`${Math.round(w.opacity * 100)}%`} onChange={v => set({ opacity: v }, "wm-op")} />
                    <button type="button" className={cl("link")} onClick={() => change({ ...p, watermark: null })}>Remove watermark</button>
                </>
            )}
        </div>
    );
}
