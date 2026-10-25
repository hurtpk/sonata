/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { React, useEffect, useRef, useState } from "@webpack/common";

import { DownloadIcon, LoopIcon, PauseIcon, PlayIcon, PopOutIcon, QueueIcon, VolumeIcon } from "./icons";
import { channelQueue, pauseMini, popOut, Track } from "./mini";
import { getPeaks, isStereo, MAX_BYTES, Peaks } from "./peaks";

const cl = classNameFactory("vc-wave-");
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Only one file plays at a time. */
let playing: HTMLAudioElement | null = null;
export const pauseInline = () => playing?.pause();

const AUDIO_EXT = /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|weba)(\?|$)/i;
const VOICE_MESSAGE = 1 << 13;

/** The audio files in a message (voice messages keep Discord's own player). */
export function audioFilesOf(message: any): AudioFile[] {
    if (!message?.attachments?.length || (message.flags ?? 0) & VOICE_MESSAGE) return [];
    return message.attachments
        .filter((a: any) => !a.waveform && (/^audio\//.test(a.content_type ?? "") || AUDIO_EXT.test(a.filename ?? "")))
        .map((a: any) => ({ url: a.url, filename: a.filename ?? "audio", size: a.size }));
}

const fmt = (t: number) => {
    if (!isFinite(t)) return "0:00";
    const s = Math.floor(t % 60), m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};
const sizeOf = (n?: number) => !n ? "" : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

export interface AudioFile { url: string; filename: string; size?: number; }

export function WaveformPlayer({ file, split, track }: { file: AudioFile; split: boolean; track: Track; }) {
    const audio = useRef<HTMLAudioElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const box = useRef<HTMLDivElement>(null);
    const [peaks, setPeaks] = useState<Peaks | null | undefined>(undefined);
    const [visible, setVisible] = useState(false);
    const [isPlaying, setPlaying] = useState(false);
    const [time, setTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [speed, setSpeed] = useState(1);
    const [volume, setVolume] = useState(1);
    const lastVolume = useRef(1);
    const [loop, setLoop] = useState(false);
    const [hover, setHover] = useState<number | null>(null);
    // A part to play over and over (seconds): set with the A–B button, or Shift+drag across the waveform.
    const [part, setPart] = useState<{ from: number; to?: number; } | null>(null);
    const partRef = useRef(part);
    partRef.current = part;
    const selecting = useRef<number | null>(null);
    const [width, setWidth] = useState(400);
    const dragging = useRef(false);

    // Work out the waveform only once the player scrolls into view.
    useEffect(() => {
        const el = box.current;
        if (!el) return;
        const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect(); } }, { rootMargin: "200px" });
        io.observe(el);
        const ro = new ResizeObserver(([e]) => setWidth(Math.max(120, Math.round(e.contentRect.width))));
        ro.observe(el);
        return () => { io.disconnect(); ro.disconnect(); };
    }, []);
    useEffect(() => {
        if (!visible) return;
        if ((file.size ?? 0) > MAX_BYTES) { setPeaks(null); return; }
        let alive = true;
        void getPeaks(file.url).then(p => alive && setPeaks(p));
        return () => { alive = false; };
    }, [visible, file.url]);

    // Smooth progress while playing.
    useEffect(() => {
        if (!isPlaying) return;
        let raf = 0;
        const tick = () => {
            const a = audio.current;
            if (a && !dragging.current) {
                keepInPart(a);
                setTime(a.currentTime);
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [isPlaying]);
    useEffect(() => () => { if (playing === audio.current) playing = null; }, []);

    // A streamed file can report an endless length; the decoded waveform knows the real one.
    const dur = (isFinite(duration) && duration) || peaks?.duration || 0;

    /** Back to the start of the looped part once playback runs past its end. */
    function keepInPart(a: HTMLAudioElement) {
        const p = partRef.current;
        if (p?.to != null && (a.currentTime >= p.to || a.currentTime < p.from - 0.05)) a.currentTime = p.from;
    }
    const stereo = !!peaks && split && isStereo(peaks);

    // Draw.
    useEffect(() => {
        const c = canvas.current;
        if (!c) return;
        const dpr = window.devicePixelRatio || 1;
        const h = 44;
        c.width = width * dpr;
        c.height = h * dpr;
        c.style.width = `${width}px`;
        c.style.height = `${h}px`;
        const ctx = c.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, h);
        const style = getComputedStyle(c);
        const first = style.getPropertyValue("--wave-played").trim() || "#5865f2";
        // With a two-colour accent, the played part fades from one to the other.
        const second = style.getPropertyValue("--vc-sonata-accent-2").trim();
        let played: string | CanvasGradient = first;
        if (second) {
            try { const g = ctx.createLinearGradient(0, 0, width, 0); g.addColorStop(0, first); g.addColorStop(1, second); played = g; } catch { }
        }
        const rest = style.getPropertyValue("--wave-rest").trim() || "rgba(255,255,255,0.25)";
        const ghost = style.getPropertyValue("--wave-ghost").trim() || "rgba(255,255,255,0.45)";
        const bar = 3, gap = 1.5, count = Math.floor(width / (bar + gap));
        const at = dur ? time / dur : 0;
        const hov = hover;
        // The looped part, as a soft band behind the bars.
        if (part && dur) {
            const x0 = part.from / dur * width, x1 = (part.to ?? time) / dur * width;
            ctx.fillStyle = style.getPropertyValue("--wave-part").trim() || "rgba(88,101,242,0.18)";
            ctx.fillRect(Math.min(x0, x1), 0, Math.max(2, Math.abs(x1 - x0)), h);
        }
        const sample = (ch: Float32Array, i: number) => {
            const from = Math.floor(i / count * ch.length), to = Math.max(from + 1, Math.floor((i + 1) / count * ch.length));
            let m = 0;
            for (let k = from; k < to; k++) if (ch[k] > m) m = ch[k];
            return m;
        };
        for (let i = 0; i < count; i++) {
            const x = i * (bar + gap);
            const frac = (i + 0.5) / count;
            ctx.fillStyle = frac <= at ? played : hov != null && frac <= hov ? ghost : rest;
            if (!peaks) {
                // Placeholder while loading (or when the file is too big): a gentle, even shape.
                const v = 0.18 + 0.12 * Math.abs(Math.sin(i * 0.7)) * (peaks === undefined ? 0.6 : 1);
                ctx.fillRect(x, h / 2 - v * h / 2, bar, Math.max(2, v * h));
                continue;
            }
            if (stereo) {
                const l = Math.max(0.04, sample(peaks.channels[0], i)), r = Math.max(0.04, sample(peaks.channels[1], i));
                ctx.fillRect(x, h / 2 - l * (h / 2 - 1) - 0.5, bar, l * (h / 2 - 1));
                ctx.fillRect(x, h / 2 + 0.5, bar, r * (h / 2 - 1));
            } else {
                const v = Math.max(0.05, Math.max(...peaks.channels.map(ch => sample(ch, i))));
                const bh = Math.max(2, v * (h - 2));
                ctx.beginPath();
                ctx.roundRect(x, (h - bh) / 2, bar, bh, 1.5);
                ctx.fill();
            }
        }
        if (stereo) {
            ctx.fillStyle = "rgba(255,255,255,0.12)";
            ctx.fillRect(0, h / 2 - 0.25, width, 0.5);
        }
        // Where it's up to: a thin line once it has started.
        if (dur && time > 0) {
            ctx.fillStyle = style.getPropertyValue("--wave-head").trim() || "#fff";
            ctx.beginPath();
            ctx.roundRect(Math.min(width - 2, Math.max(0, at * width - 1)), 1, 2, h - 2, 1);
            ctx.fill();
        }
    }, [peaks, width, time, dur, hover, stereo, part]);

    const toggle = () => {
        const a = audio.current;
        if (!a) return;
        if (a.paused) {
            if (playing && playing !== a) playing.pause();
            pauseMini();
            playing = a;
            if (part?.to != null) keepInPart(a);
            void a.play();
        } else a.pause();
    };
    const fracAt = (e: React.PointerEvent) => {
        const r = canvas.current!.getBoundingClientRect();
        return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    };
    const seekTo = (f: number) => {
        const a = audio.current;
        if (!a || !dur) return;
        a.currentTime = f * dur;
        setTime(a.currentTime);
    };
    const onKey = (e: React.KeyboardEvent) => {
        const a = audio.current;
        if (!a) return;
        if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
        else if (e.key === "ArrowRight") { e.preventDefault(); a.currentTime = Math.min(dur, a.currentTime + 5); setTime(a.currentTime); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); a.currentTime = Math.max(0, a.currentTime - 5); setTime(a.currentTime); }
    };

    const setVol = (v: number) => {
        setVolume(v);
        if (v > 0) lastVolume.current = v;
        if (audio.current) audio.current.volume = v;
    };
    const kind = /\.([a-z0-9]{2,5})$/i.exec(file.filename)?.[1]?.toUpperCase();
    const partLabel = !part ? "A–B" : part.to == null ? "A–…" : fmt(part.from) + "–" + fmt(part.to);

    return (
        <div className={cl("player", isPlaying && "playing")} tabIndex={0} onKeyDown={onKey} aria-label={`Audio: ${file.filename}`}>
            <audio ref={audio} src={file.url} preload="metadata" loop={loop}
                onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
                onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setTime(0); }}
                onTimeUpdate={e => { if (!isPlaying && !dragging.current) setTime(e.currentTarget.currentTime); }} />
            <button type="button" className={cl("play")} onClick={toggle} aria-label={isPlaying ? "Pause" : "Play"}>
                {isPlaying ? <PauseIcon /> : <span className={cl("play-nudge")}><PlayIcon /></span>}
            </button>
            <div className={cl("body")}>
                <div className={cl("head")}>
                    <a className={cl("name")} href={file.url} target="_blank" rel="noreferrer" title={file.filename}>{file.filename}</a>
                    <span className={cl("meta")}>
                        {stereo && <span className={cl("tag")}>L / R</span>}
                        {kind && <span className={cl("tag")}>{kind}</span>}
                        {sizeOf(file.size)}
                    </span>
                </div>
                <div className={cl("wave")} ref={box}>
                    <canvas ref={canvas}
                        onPointerDown={e => {
                            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                            if (e.shiftKey && dur) { selecting.current = fracAt(e) * dur; setPart({ from: selecting.current, to: selecting.current }); return; }
                            dragging.current = true;
                            setTime(fracAt(e) * dur);
                        }}
                        onPointerMove={e => {
                            const f = fracAt(e);
                            setHover(f);
                            if (selecting.current != null) { const t = f * dur; setPart({ from: Math.min(selecting.current, t), to: Math.max(selecting.current, t) }); } else if (dragging.current) setTime(f * dur);
                        }}
                        onPointerUp={e => {
                            if (selecting.current != null) {
                                const t = fracAt(e) * dur, from = Math.min(selecting.current, t), to = Math.max(selecting.current, t);
                                selecting.current = null;
                                // A click with Shift held (no drag) clears the part.
                                setPart(to - from < 0.3 ? null : { from, to });
                                if (to - from >= 0.3 && audio.current) { audio.current.currentTime = from; setTime(from); }
                                return;
                            }
                            if (dragging.current) { dragging.current = false; seekTo(fracAt(e)); }
                        }}
                        onPointerLeave={() => setHover(null)} />
                    {hover != null && dur > 0 && <span className={cl("tip")} style={{ left: `${hover * 100}%` }}>{fmt(hover * dur)}</span>}
                </div>
                <div className={cl("controls")}>
                    <span className={cl("time")}><b>{fmt(time)}</b><span className={cl("total")}> / {fmt(dur)}</span></span>
                    <span className={cl("grow")} />
                    <div className={cl("group")}>
                        <button type="button" className={cl("ctl", "chip", speed !== 1 && "ctl-on")} title="Playback speed" onClick={() => { const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; setSpeed(next); if (audio.current) audio.current.playbackRate = next; }}>{speed}×</button>
                        <button type="button" className={cl("ctl", "chip", part && "ctl-on")}
                            title={!part ? "Loop a part: press here at the start, then again at the end (or Shift+drag across the waveform)" : part.to == null ? "Now press again where the part should end" : "Looping " + partLabel + " — press to stop"}
                            onClick={() => {
                                const t = audio.current?.currentTime ?? time;
                                if (!part) setPart({ from: t });
                                else if (part.to == null) setPart(t - part.from < 0.3 ? null : { from: part.from, to: t });
                                else setPart(null);
                            }}>{partLabel}</button>
                        <button type="button" className={cl("ctl", loop && "ctl-on")} title={loop ? "Looping — press to stop" : "Loop"} aria-pressed={loop} onClick={() => setLoop(v => !v)}><LoopIcon /></button>
                    </div>
                    <div className={cl("group", "vol")}>
                        <button type="button" className={cl("ctl")} title={volume === 0 ? "Unmute" : "Mute"} onClick={() => setVol(volume === 0 ? lastVolume.current : 0)}><VolumeIcon level={volume} /></button>
                        <input type="range" min={0} max={1} step={0.02} value={volume} aria-label="Volume" title={`Volume ${Math.round(volume * 100)}%`}
                            style={{ "--fill": `${volume * 100}%` } as React.CSSProperties}
                            onChange={e => setVol(Number(e.currentTarget.value))} />
                    </div>
                    <div className={cl("group")}>
                        <button type="button" className={cl("ctl")} title="Play this and every audio file after it in this channel"
                            onClick={() => { const q = channelQueue(track); popOut(q[0], audio.current?.currentTime ?? 0, q.slice(1)); }}><QueueIcon /></button>
                        <button type="button" className={cl("ctl")} title="Pop out — keeps playing while you move around Discord"
                            onClick={() => popOut(track, audio.current?.currentTime ?? 0)}><PopOutIcon /></button>
                        <a className={cl("ctl")} href={file.url} download={file.filename} title="Download" target="_blank" rel="noreferrer"><DownloadIcon /></a>
                    </div>
                </div>
            </div>
        </div>
    );
}
