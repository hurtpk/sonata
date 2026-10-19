/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Your own sound packs: sound files you drop in, kept on this computer
// (Equicord's local storage). Each sound has the silence at its start cut off,
// so it plays the moment you press the key, and is evened out in loudness.

import { get, set } from "@api/DataStore";

import type { KeyKind } from "./sounds";

export const KINDS: KeyKind[] = ["key", "space", "enter", "back"];
export interface SoundFile { name: string; data: Uint8Array; }
export interface CustomPack { id: string; name: string; sounds: Record<KeyKind, SoundFile[]>; }

const KEY = "Sonata_typingSoundPacks";
export const MAX_FILE = 1024 * 1024;
export const MAX_KEYS = 8;

let packs: CustomPack[] | null = null;
const listeners = new Set<() => void>();

export async function loadPacks(): Promise<CustomPack[]> {
    packs ??= ((await get<CustomPack[]>(KEY)) ?? []).filter(p => p?.id && p.sounds?.key?.length);
    return packs;
}
export const knownPacks = () => packs ?? [];
export const isCustom = (id: string | undefined) => !!id?.startsWith("custom-");
export function onPacksChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

export async function savePack(pack: CustomPack) {
    const list = await loadPacks();
    packs = list.some(p => p.id === pack.id) ? list.map(p => p.id === pack.id ? pack : p) : [...list, pack];
    rendered.delete(pack.id);
    await set(KEY, packs);
    listeners.forEach(fn => fn());
}
export async function deletePack(id: string) {
    packs = (await loadPacks()).filter(p => p.id !== id);
    rendered.delete(id);
    await set(KEY, packs);
    listeners.forEach(fn => fn());
}

/* ── Getting them ready to play ── */

type Ready = Record<KeyKind, AudioBuffer[]>;
const rendered = new Map<string, Ready>();
const preparing = new Map<string, Promise<void>>();

/** Cuts the quiet start off, caps the length (with a short fade), so key presses feel instant. */
function tidy(ac: BaseAudioContext, buf: AudioBuffer): AudioBuffer {
    const ch = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
    const gate = Math.max(0.01, peak * 0.06);
    let start = 0;
    while (start < ch.length && Math.abs(ch[start]) < gate) start++;
    start = Math.max(0, start - Math.floor(buf.sampleRate * 0.002));
    const len = Math.max(1, Math.min(ch.length - start, Math.floor(buf.sampleRate * 1.2)));
    const out = ac.createBuffer(1, len, buf.sampleRate);
    const d = out.getChannelData(0), fade = Math.floor(buf.sampleRate * 0.03);
    for (let c = 0; c < buf.numberOfChannels; c++) {
        const src = buf.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] += src[start + i] / buf.numberOfChannels;
    }
    for (let i = 0; i < fade && i < len; i++) d[len - 1 - i] *= i / fade;
    return out;
}

export function decodeSound(ac: BaseAudioContext, data: Uint8Array): Promise<AudioBuffer> {
    const copy = data.slice().buffer;
    return ac.decodeAudioData(copy).then(b => tidy(ac, b));
}

/** Decodes a pack's sounds (once), evened out so the ordinary keys peak at the same level as the built-in packs. */
export function prepare(ac: AudioContext, id: string): Promise<void> {
    if (rendered.has(id)) return Promise.resolve();
    let p = preparing.get(id);
    if (!p) {
        p = (async () => {
            const pack = (await loadPacks()).find(x => x.id === id);
            if (!pack) return;
            const out = {} as Ready;
            for (const kind of KINDS) out[kind] = (await Promise.all((pack.sounds[kind] ?? []).map(s => decodeSound(ac, s.data).catch(() => null)))).filter(Boolean) as AudioBuffer[];
            const peak = Math.max(1e-4, ...out.key.map(b => b.getChannelData(0).reduce((m, x) => Math.max(m, Math.abs(x)), 0)));
            const norm = 0.8 / peak;
            for (const kind of KINDS) for (const b of out[kind]) { const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] *= norm; }
            rendered.set(id, out);
        })().finally(() => preparing.delete(id));
        preparing.set(id, p);
    }
    return p;
}

/** Plays one of your sounds. The first press after picking a pack just gets it ready. */
export function playCustom(ac: AudioContext, id: string, kind: KeyKind, o: { volume: number; vary: boolean; pan: number | null; key?: string; code?: string; }) {
    const ready = rendered.get(id);
    if (!ready) { void prepare(ac, id); return; }
    const list = ready[kind].length ? ready[kind] : ready.key;
    if (!list.length) return;
    // Each key keeps its own sound when there are several, like a real keyboard; "vary" mixes it up a little.
    let h = 7; const s = o.code || o.key || "x";
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const pick = o.vary && Math.random() < 0.35 ? (h + 1) % list.length : h % list.length;
    const src = ac.createBufferSource();
    src.buffer = list[pick];
    if (o.vary) src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.04;
    const g = ac.createGain();
    g.gain.value = Math.max(0, Math.min(1, o.volume)) * (o.vary ? 0.88 + Math.random() * 0.24 : 1);
    let node: AudioNode = src.connect(g);
    if (o.pan != null && typeof ac.createStereoPanner === "function") {
        const p = ac.createStereoPanner();
        p.pan.value = o.pan;
        node = node.connect(p);
    }
    node.connect(ac.destination);
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch { } };
    src.start();
}
