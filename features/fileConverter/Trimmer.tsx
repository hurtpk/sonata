/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A visual trimmer for one video or sound: a preview, a strip of frames, and
// two handles for where it starts and ends. "Play the cut" plays just the part
// that will be kept. Files the built-in player can't open (AVI, some MKV) get
// the plain start / end boxes instead — ffmpeg still trims them fine.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useEffect, useMemo, useRef, useState } from "@webpack/common";

import type { MediaOptions } from "./media";

const cl = classNameFactory("vc-tool-");
const fc = classNameFactory("vc-fconv-");

const FRAMES = 10;

/** 83.4 → "1:23.4" */
export function clock(s: number) {
    if (!Number.isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60), r = s - m * 60;
    return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
}

/**
 * The real length. Files saved by in-browser recorders often don't store it
 * (the player says "Infinity" or almost 0); jumping far past the end makes the
 * player work it out.
 */
export function realDuration(el: HTMLMediaElement): Promise<number> {
    const good = () => Number.isFinite(el.duration) && el.duration > 0.05;
    if (good()) return Promise.resolve(el.duration);
    return new Promise(res => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            el.removeEventListener("durationchange", check);
            el.removeEventListener("timeupdate", check);
            const d = good() ? el.duration : 0;
            el.currentTime = 0;
            res(d);
        };
        const check = () => { if (good()) finish(); };
        el.addEventListener("durationchange", check);
        el.addEventListener("timeupdate", check);
        el.currentTime = 1e101;
        setTimeout(finish, 3000);
    });
}

/** A row of little frames from across the video, for the timeline. */
function useFrames(url: string, isVideo: boolean, duration: number) {
    const [frames, setFrames] = useState<string[]>([]);
    useEffect(() => {
        if (!isVideo || !duration) return;
        let stop = false;
        const v = document.createElement("video");
        v.muted = true; v.preload = "auto"; v.src = url;
        const canvas = document.createElement("canvas");
        canvas.width = 96; canvas.height = 54;
        const ctx = canvas.getContext("2d")!;
        (async () => {
            await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(); }).catch(() => { stop = true; });
            const out: string[] = [];
            for (let i = 0; i < FRAMES && !stop; i++) {
                v.currentTime = Math.min(duration - 0.05, ((i + 0.5) / FRAMES) * duration);
                await new Promise(r => { v.onseeked = r; setTimeout(r, 1500); });
                if (stop) break;
                const ratio = v.videoWidth / v.videoHeight || 16 / 9;
                const w = 54 * ratio, x = (96 - w) / 2;
                ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 96, 54);
                ctx.drawImage(v, x, 0, w, 54);
                out.push(canvas.toDataURL("image/jpeg", 0.6));
                setFrames([...out]);
            }
        })();
        return () => { stop = true; v.removeAttribute("src"); v.load(); };
    }, [url, isVideo, duration]);
    return frames;
}

export function Trimmer({ file, media, setMedia }: { file: File; media: MediaOptions; setMedia: (m: MediaOptions) => void; }) {
    const url = useMemo(() => URL.createObjectURL(file), [file]);
    useEffect(() => () => URL.revokeObjectURL(url), [url]);
    const isVideo = file.type.startsWith("video/") || /\.(mp4|webm|mov|mkv|m4v)$/i.test(file.name);
    const player = useRef<HTMLVideoElement & HTMLAudioElement>(null);
    const [duration, setDuration] = useState(0);
    const [failed, setFailed] = useState(false);
    const [now, setNow] = useState(0);
    const [playingCut, setPlayingCut] = useState(false);
    const frames = useFrames(url, isVideo, duration);

    const start = Math.min(media.start, duration || media.start);
    const end = media.end > 0 ? Math.min(media.end, duration || media.end) : duration;
    const kept = Math.max(0, end - start);
    // "To the very end" is saved as 0, so a file's real length is never baked in.
    const set = (s: number, e: number) => {
        s = Math.max(0, Math.min(s, duration - 0.1));
        e = Math.max(s + 0.1, Math.min(e, duration));
        setMedia({ ...media, start: Math.round(s * 10) / 10, end: e >= duration - 0.1 ? 0 : Math.round(e * 10) / 10 });
    };

    const seek = (t: number) => { if (player.current) player.current.currentTime = t; setNow(t); };
    const playCut = () => {
        const p = player.current;
        if (!p) return;
        if (playingCut) { p.pause(); setPlayingCut(false); return; }
        p.currentTime = start;
        void p.play();
        setPlayingCut(true);
    };

    const numbers = (
        <div className={cl("row")}>
            <input className={classes(cl("input"), fc("num"))} type="number" min={0} step={0.1} placeholder="Start" value={media.start || ""} onChange={e => setMedia({ ...media, start: Math.max(0, Number(e.currentTarget.value) || 0) })} />
            <span className={cl("hint")}>to</span>
            <input className={classes(cl("input"), fc("num"))} type="number" min={0} step={0.1} placeholder="End" value={media.end || ""} onChange={e => setMedia({ ...media, end: Math.max(0, Number(e.currentTarget.value) || 0) })} />
            <span className={cl("hint")}>seconds</span>
        </div>
    );

    if (failed) return (
        <div className={fc("opt")}>
            <span className={cl("label")}>Trim</span>
            {numbers}
            <span className={cl("hint")}>No preview for this kind of file, but it still trims.</span>
        </div>
    );

    const pct = (t: number) => duration ? `${(t / duration) * 100}%` : "0%";
    const Media = isVideo ? "video" : "audio";

    return (
        <div className={classes(fc("opt"), fc("trim"))}>
            <div className={fc("trim-head")}>
                <span className={cl("label")}>Trim</span>
                {duration > 0 && <span className={cl("hint")}>{clock(start)} → {clock(end)} · keeping {kept.toFixed(1)} s of {duration.toFixed(1)} s</span>}
                {(media.start > 0 || media.end > 0) && <button type="button" className={cl("link")} onClick={() => setMedia({ ...media, start: 0, end: 0 })}>Reset</button>}
            </div>
            <Media
                ref={player}
                className={isVideo ? fc("trim-video") : fc("trim-audio")}
                src={url}
                preload="metadata"
                playsInline
                onLoadedMetadata={e => { void realDuration(e.currentTarget).then(d => d ? setDuration(d) : setFailed(true)); }}
                onError={() => setFailed(true)}
                onTimeUpdate={e => {
                    const t = e.currentTarget.currentTime;
                    setNow(t);
                    if (playingCut && t >= end) { e.currentTarget.pause(); e.currentTarget.currentTime = start; setPlayingCut(false); }
                }}
                onPause={() => setPlayingCut(false)}
            />
            {duration > 0 && (
                <>
                    <div className={fc("timeline")} onPointerDown={e => {
                        if ((e.target as HTMLElement).tagName === "INPUT") return;
                        const r = e.currentTarget.getBoundingClientRect();
                        seek(((e.clientX - r.left) / r.width) * duration);
                    }}>
                        <div className={fc("frames")}>
                            {frames.length ? frames.map((f, i) => <img key={i} src={f} alt="" draggable={false} />) : <div className={fc("wave")} />}
                        </div>
                        <div className={fc("cut-out")} style={{ left: 0, width: pct(start) }} />
                        <div className={fc("cut-out")} style={{ left: pct(end), right: 0 }} />
                        <div className={fc("cut-keep")} style={{ left: pct(start), width: pct(kept) }} />
                        <div className={fc("playhead")} style={{ left: pct(now) }} />
                        <input type="range" className={fc("handle")} aria-label="Start" min={0} max={duration} step={0.1} value={start} onChange={e => { const v = Number(e.currentTarget.value); set(v, end); seek(v); }} />
                        <input type="range" className={fc("handle")} aria-label="End" min={0} max={duration} step={0.1} value={end} onChange={e => { const v = Number(e.currentTarget.value); set(start, v); seek(v); }} />
                    </div>
                    <div className={fc("trim-actions")}>
                        <button type="button" className={classes(cl("btn"), cl("primary"))} onClick={playCut}>{playingCut ? "⏸ Stop" : "▶ Play the cut"}</button>
                        <button type="button" className={cl("btn")} onClick={() => set(now, end)} title="Start where the preview is now">⇤ Start here</button>
                        <button type="button" className={cl("btn")} onClick={() => set(start, now)} title="End where the preview is now">End here ⇥</button>
                        <span className={cl("hint")}>{clock(now)}</span>
                    </div>
                    <details className={fc("trim-exact")}>
                        <summary>Exact times</summary>
                        {numbers}
                    </details>
                </>
            )}
        </div>
    );
}
