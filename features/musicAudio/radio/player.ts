/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Radio's one player: a station, a SoundCloud like or one of your files. It
// keeps playing when the window closes (the small player in the corner has the
// controls), and goes on to the next song in a list.

import { useEffect, useState } from "@webpack/common";

import { pauseInline } from "../waveformPlayer/Player";
import type { ScTrack, Station } from "./native";
import { MusicFile, settings } from "./store";

export type Item =
    | { kind: "radio"; key: string; title: string; sub?: string; art?: string; station: Station; }
    | { kind: "sc"; key: string; title: string; sub?: string; art?: string; track: ScTrack; }
    | { kind: "file"; key: string; title: string; sub?: string; art?: string; file: MusicFile; };

interface State { item: Item | null; queue: Item[]; at: number; playing: boolean; loading: boolean; error: string | null; /** The Radio window is open (the corner player hides meanwhile). */ windowOpen: number; }
let state: State = { item: null, queue: [], at: -1, playing: false, loading: false, error: null, windowOpen: 0 };
const listeners = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; listeners.forEach(l => l()); };
export const playerState = () => state;
export const windowOpened = (by: 1 | -1) => set({ windowOpen: Math.max(0, state.windowOpen + by) });

export function usePlayer() {
    const [, bump] = useState(0);
    useEffect(() => { const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    return state;
}

const native = () => VencordNative.pluginHelpers.Sonata as any;
let base: string | null = null;
export async function serverBase() {
    if (base) return base;
    const r = await native().radioBase().catch(() => null);
    if (r?.ok) base = r.base;
    return base;
}
/** A station logo (or any picture), through the player server so Discord's page may show it. */
export const viaServer = (url?: string) => url && base ? `${base}/img?u=${encodeURIComponent(url)}` : undefined;

/* ── Covers ── */

/** Each song's cover once known (null: it has none). SoundCloud's come from its embed info, files' from inside the file. */
const covers = new Map<string, string | null>();
const asked = new Set<string>();
const waiting: Item[] = [];
let batch: ReturnType<typeof setTimeout> | undefined;
const coverListeners = new Set<() => void>();

export function coverOf(item: Item) {
    if (item.kind === "radio") return viaServer(item.station.logo);
    const c = covers.get(item.key);
    // SoundCloud's pictures come through the player server (Discord's page may not load them directly); files' are data: links.
    return !c ? undefined : item.kind === "sc" ? viaServer(c) : c;
}

/** Asks for a song's cover (when it comes into view); several at once go together. */
export function wantCover(item: Item) {
    if (item.kind === "radio" || asked.has(item.key)) return;
    asked.add(item.key);
    if (item.kind === "file") {
        void Promise.resolve(native().musicCover?.(item.file.id)).then((c: string | null) => { covers.set(item.key, c ?? null); coverListeners.forEach(l => l()); }).catch(() => { });
        return;
    }
    waiting.push(item);
    clearTimeout(batch);
    batch = setTimeout(askWaiting, 150);
}

async function askWaiting() {
    const list = waiting.splice(0, 24) as Extract<Item, { kind: "sc"; }>[];
    if (!list.length) return;
    // More than one batch's worth: the rest go next.
    if (waiting.length) batch = setTimeout(askWaiting, 400);
    const r: Record<string, string | null> = await native().scCovers?.(list.map(i => i.track.url)).catch(() => ({})) ?? {};
    for (const i of list) {
        const art = r[i.track.url];
        if (art === undefined) asked.delete(i.key); // not answered (busy): ask again next time it's seen
        else covers.set(i.key, art ?? null);
    }
    coverListeners.forEach(l => l());
}

export function useCovers() {
    const [, bump] = useState(0);
    useEffect(() => { const l = () => bump(n => n + 1); coverListeners.add(l); return () => void coverListeners.delete(l); }, []);
}

let audio: HTMLAudioElement | null = null;
/** Songs that couldn't play (copy-protected, gone…), so lists can mark them. */
export const failed = new Map<string, string>();
let token = 0;

function el() {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = "none";
    audio.volume = (settings.store.volume ?? 70) / 100;
    audio.addEventListener("playing", () => set({ playing: true, loading: false, error: null }));
    audio.addEventListener("pause", () => set({ playing: false }));
    audio.addEventListener("waiting", () => set({ loading: true }));
    audio.addEventListener("ended", () => { if (state.item?.kind !== "radio") void next(); });
    audio.addEventListener("error", () => {
        if (!state.item || !audio?.getAttribute("src")) return;
        const why = state.item.kind === "radio" ? "This station isn't working right now." : "This song couldn't be played.";
        failed.set(state.item.key, why);
        set({ loading: false, playing: false, error: why });
        // In a list, go on to the next one.
        if (state.queue.length > 1) setTimeout(() => void next(), 1500);
    });
    return audio;
}

/** SoundCloud plays as one long stream, so moving along the bar starts it again from there. */
let sc: { id: string; duration: number; from: number; } | null = null;

async function srcFor(item: Item): Promise<string | { error: string; }> {
    const b = await serverBase();
    if (!b) return { error: "The player couldn't start. Restart Discord fully and try again." };
    if (item.kind === "radio") {
        void native().radioClicked?.(item.station.id);
        return `${b}/radio?u=${encodeURIComponent(item.station.url)}`;
    }
    if (item.kind === "file") return `${b}/file/${item.file.id}`;
    const r = await native().scPrepare(item.track.url).catch(() => null);
    if (!r?.ok) return { error: r?.error ?? "Couldn't get this song." };
    sc = { id: r.id, duration: Number(r.duration) || 0, from: 0 };
    return `${b}/sc/${r.id}`;
}

/** Plays something now. With a list, the rest of the list plays after it. */
export async function play(item: Item, queue: Item[] = [item]) {
    const mine = ++token;
    const a = el();
    try { pauseInline(); } catch { }
    a.pause();
    sc = null;
    set({ item, queue, at: Math.max(0, queue.findIndex(q => q.key === item.key)), loading: true, playing: false, error: null });
    wantCover(item);
    const src = await srcFor(item);
    if (mine !== token) return;
    if (typeof src !== "string") {
        failed.set(item.key, src.error);
        set({ loading: false, error: src.error });
        if (queue.length > 1) setTimeout(() => { if (mine === token) void next(); }, 1500);
        return;
    }
    a.src = src;
    a.play().catch(() => { if (mine === token) set({ loading: false }); });
}

export function toggle() {
    const a = el();
    if (!state.item) return;
    if (a.paused) {
        try { pauseInline(); } catch { }
        // A station picks up live again rather than from where it was paused.
        if (state.item.kind === "radio") void play(state.item, state.queue);
        else void a.play().catch(() => { });
    } else a.pause();
}

export async function next() {
    if (state.queue.length < 2) return;
    // Skip ones already known not to play.
    for (let step = 1; step <= state.queue.length; step++) {
        const i = (state.at + step) % state.queue.length;
        if (i === 0 && step > 0 && !settings.store.repeat) { stop(); return; }
        const it = state.queue[i];
        if (!failed.has(it.key) || it.kind === "radio") { await play(it, state.queue); return; }
    }
    stop();
}

export async function previous() {
    if (position().time > 4 || state.queue.length < 2) { seek(0); return; }
    const i = (state.at - 1 + state.queue.length) % state.queue.length;
    await play(state.queue[i], state.queue);
}

export function stop() {
    token++;
    if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    set({ item: null, queue: [], at: -1, playing: false, loading: false, error: null, windowOpen: state.windowOpen });
}

export function setVolume(v: number) {
    settings.store.volume = Math.round(v);
    if (audio) audio.volume = v / 100;
    listeners.forEach(l => l());
}

/** Where the song is, in seconds, and how long it is (0 for a station, which is live). */
export function position() {
    if (!audio || !state.item || state.item.kind === "radio") return { time: 0, duration: 0 };
    if (state.item.kind === "sc" && sc) return { time: sc.from + audio.currentTime, duration: sc.duration };
    return { time: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : 0 };
}

/** Jumps to a time in the song. */
export async function seek(t: number) {
    const a = el();
    const { duration } = position();
    if (!state.item || state.item.kind === "radio" || !duration) return;
    const to = Math.max(0, Math.min(duration - 0.5, t));
    if (state.item.kind === "file") { a.currentTime = to; return; }
    if (!sc) return;
    const b = await serverBase();
    if (!b) return;
    const wasPlaying = !a.paused;
    sc = { ...sc, from: to };
    a.src = `${b}/sc/${sc.id}?t=${Math.floor(to)}`;
    set({ loading: true });
    if (wasPlaying || state.playing) await a.play().catch(() => set({ loading: false }));
    else set({ loading: false });
    listeners.forEach(l => l());
}

export function shuffled<T>(list: T[]) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
}
