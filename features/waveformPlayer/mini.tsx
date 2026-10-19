/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The pop-out player: keeps playing in the corner while you move around
// Discord, shows who sent the file, and plays the rest of the channel's audio
// one after another when you pick "Play all".

import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { createRoot, MessageStore, NavigationRouter, React, useEffect, useRef, useState } from "@webpack/common";

import { getPeaks, Peaks } from "./peaks";
import { AudioFile, audioFilesOf, pauseInline } from "./Player";

const cl = classNameFactory("vc-wave-mini-");

export interface Track extends AudioFile {
    channelId: string;
    guildId?: string;
    messageId: string;
    author: string;
    avatar?: string;
}

let current: { track: Track; startAt: number; autoplay: boolean; } | null = null;
let miniAudio: HTMLAudioElement | null = null;
/** Pauses the corner player (when a file in chat starts playing instead). */
export const pauseMini = () => miniAudio?.pause();
let queue: Track[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(l => l());

/** Every audio file in the channel after (and including) this one, oldest first. */
export function channelQueue(from: Track): Track[] {
    const all: any[] = (MessageStore.getMessages(from.channelId) as any)?._array ?? [];
    const out: Track[] = [];
    let seen = false;
    for (const m of all) {
        for (const f of audioFilesOf(m)) {
            if (m.id === from.messageId && f.url === from.url) seen = true;
            if (seen) out.push(trackOf(f, m, from.guildId));
        }
    }
    return out.length ? out : [from];
}

export function trackOf(f: AudioFile, message: any, guildId?: string): Track {
    const a = message.author;
    return {
        ...f,
        channelId: message.channel_id,
        guildId,
        messageId: message.id,
        author: a?.globalName || a?.username || "Someone",
        avatar: a?.getAvatarURL?.(guildId, 32, false),
    };
}

/** Moves a file into the corner player (from where it was), optionally with what plays next. */
export function popOut(track: Track, startAt = 0, next: Track[] = []) {
    pauseInline();
    current = { track, startAt, autoplay: true };
    queue = next;
    changed();
}

const fmt = (t: number) => !isFinite(t) ? "0:00" : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function MiniWave({ peaks, at, onSeek }: { peaks: Peaks | null; at: number; onSeek(f: number): void; }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const c = canvas.current;
        if (!c) return;
        const w = 220, h = 26, dpr = window.devicePixelRatio || 1;
        c.width = w * dpr; c.height = h * dpr;
        const ctx = c.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const played = getComputedStyle(c).getPropertyValue("--wave-played").trim() || "#5865f2";
        const count = 55, bar = 2.5, gap = (w - count * bar) / (count - 1);
        for (let i = 0; i < count; i++) {
            let v = 0.25;
            if (peaks) {
                const ch = peaks.channels[0];
                const from = Math.floor(i / count * ch.length), to = Math.floor((i + 1) / count * ch.length);
                for (let k = from; k < to; k++) v = Math.max(v, ch[k]);
                v = Math.max(0.08, v);
            }
            ctx.fillStyle = (i + 0.5) / count <= at ? played : "rgba(255,255,255,0.25)";
            const bh = Math.max(2, v * h);
            ctx.fillRect(i * (bar + gap), (h - bh) / 2, bar, bh);
        }
    }, [peaks, at]);
    return <canvas ref={canvas} className={cl("wave")} style={{ width: 220, height: 26 }} onClick={e => { const r = e.currentTarget.getBoundingClientRect(); onSeek((e.clientX - r.left) / r.width); }} />;
}

function MiniPlayer() {
    const [, bump] = useState(0);
    useEffect(() => { const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    const audio = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const [time, setTime] = useState(0);
    const [dur, setDur] = useState(0);
    const [peaks, setPeaks] = useState<Peaks | null>(null);
    const track = current?.track ?? null;
    useEffect(() => { miniAudio = audio.current; return () => { miniAudio = null; }; });

    useEffect(() => {
        const a = audio.current;
        if (!a || !current) return;
        setPeaks(null);
        if ((track!.size ?? 0) < 60 * 1024 * 1024) void getPeaks(track!.url).then(setPeaks);
        a.src = track!.url;
        a.currentTime = current.startAt;
        if (current.autoplay) void a.play().catch(() => { });
    }, [track?.url, track?.messageId]);

    if (!track) return null;
    const next = () => {
        const n = queue.shift();
        if (n) { current = { track: n, startAt: 0, autoplay: true }; changed(); } else setPlaying(false);
    };
    const close = () => { audio.current?.pause(); current = null; queue = []; changed(); };

    return (
        <div className={cl("box")} role="region" aria-label="Audio player">
            <audio ref={audio} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={next}
                onTimeUpdate={e => setTime(e.currentTarget.currentTime)} onLoadedMetadata={e => setDur(e.currentTarget.duration)} />
            <button type="button" className={cl("play")} aria-label={playing ? "Pause" : "Play"} onClick={() => { const a = audio.current!; if (a.paused) { pauseInline(); void a.play(); } else a.pause(); }}>
                {playing ? "❚❚" : "▶"}
            </button>
            <div className={cl("main")}>
                <div className={cl("title")} title={track.filename}>{track.filename}</div>
                <button type="button" className={cl("from")} title="Go to the message" onClick={() => NavigationRouter.transitionTo(`/channels/${track.guildId ?? "@me"}/${track.channelId}/${track.messageId}`)}>
                    {track.avatar && <img src={track.avatar} alt="" />}
                    <span>sent by {track.author}</span>
                </button>
                <MiniWave peaks={peaks} at={dur ? time / dur : 0} onSeek={f => { if (audio.current && dur) audio.current.currentTime = f * dur; }} />
                <div className={cl("meta")}>
                    <span>{fmt(time)} / {fmt(dur)}</span>
                    {queue.length > 0 && <span>{queue.length} more up next</span>}
                </div>
            </div>
            <div className={cl("side")}>
                {queue.length > 0 && <button type="button" title="Next" onClick={next}>⏭</button>}
                <button type="button" title="Close" onClick={close}>×</button>
            </div>
        </div>
    );
}

let host: HTMLDivElement | null = null;
let root: { render(n: React.ReactNode): void; unmount(): void; } | null = null;
const Safe = ErrorBoundary.wrap(MiniPlayer, { noop: true });

export function mountMini() {
    if (host) return;
    host = document.createElement("div");
    host.className = "vc-wave-mini-host";
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(<Safe />);
}

export function unmountMini() {
    root?.unmount();
    root = null;
    host?.remove();
    host = null;
    current = null;
    queue = [];
}
