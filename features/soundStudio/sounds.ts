/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord's sounds, your replacements for them (kept in Equicord's local
// storage on this computer), and the hook that swaps a sound for yours the
// moment Discord plays it.

import { AudioProcessor, defaultAudioNames } from "@api/AudioPlayer";
import * as DataStore from "@api/DataStore";
import { findLazy } from "@webpack";

export type Category = "Messages" | "Calls" | "Voice" | "Streams & activities" | "Fun & other";
export const CATEGORIES: Category[] = ["Messages", "Calls", "Voice", "Streams & activities", "Fun & other"];

export interface SoundInfo { id: string; name: string; category: Category; }

const S = (id: string, name: string, category: Category): SoundInfo => ({ id, name, category });

/** The sounds people usually want to change, with names you'd recognise. */
const KNOWN: SoundInfo[] = [
    S("message1", "Message (in a server)", "Messages"),
    S("message2", "Reply in a server", "Messages"),
    S("message3", "Message in DMs", "Messages"),
    S("mention1", "Mention (@role)", "Messages"),
    S("mention2", "Mention (@everyone)", "Messages"),
    S("mention3", "Mention (@here)", "Messages"),
    S("asmr_message1", "ASMR message", "Messages"),
    S("bit_message1", "Bit message", "Messages"),
    S("bop_message1", "Bop message", "Messages"),
    S("ducky_message1", "Ducky message", "Messages"),
    S("lofi_message1", "Lo-fi message", "Messages"),
    S("call_calling", "Outgoing call", "Calls"),
    S("call_ringing", "Incoming call (ringing)", "Calls"),
    S("mute", "Mute", "Voice"),
    S("unmute", "Unmute", "Voice"),
    S("deafen", "Deafen", "Voice"),
    S("undeafen", "Undeafen", "Voice"),
    S("user_join", "Someone joins voice", "Voice"),
    S("user_leave", "Someone leaves voice", "Voice"),
    S("user_moved", "Moved to another channel", "Voice"),
    S("disconnect", "Disconnect", "Voice"),
    S("reconnect", "Reconnect", "Voice"),
    S("ptt_start", "Push to talk on", "Voice"),
    S("ptt_stop", "Push to talk off", "Voice"),
    S("stage_waiting", "Stage waiting", "Voice"),
    S("stream_started", "Stream started", "Streams & activities"),
    S("stream_ended", "Stream ended", "Streams & activities"),
    S("stream_user_joined", "Someone joins your stream", "Streams & activities"),
    S("stream_user_left", "Someone leaves your stream", "Streams & activities"),
    S("activity_launch", "Activity launched", "Streams & activities"),
    S("activity_end", "Activity ended", "Streams & activities"),
    S("activity_user_join", "Someone joins an activity", "Streams & activities"),
    S("activity_user_left", "Someone leaves an activity", "Streams & activities"),
    S("clip_save", "Clip saved", "Streams & activities"),
    S("clip_error", "Clip failed", "Streams & activities"),
    S("success", "Success", "Fun & other"),
    S("discodo", "Discodo", "Fun & other"),
    S("overlayunlock", "Overlay unlocked", "Fun & other"),
    S("highfive_clap", "High five clap", "Fun & other"),
    S("highfive_whistle", "High five whistle", "Fun & other"),
    S("hang_status_select", "Hang status picked", "Fun & other"),
    S("vibing_wumpus", "Vibing Wumpus", "Fun & other"),
    S("human_man", "Human man", "Fun & other"),
    S("robot_man", "Robot man", "Fun & other"),
];

const titleCase = (id: string) => id.replace(/[_-]+/g, " ").replace(/\d+$/, "").trim().replace(/^./, c => c.toUpperCase());

/** Every sound Discord has: the known ones first, then any others found in Discord's files. */
export function allSounds(): SoundInfo[] {
    const known = new Set(KNOWN.map(s => s.id));
    let found: string[] = [];
    try { found = defaultAudioNames(); } catch { }
    const extra = found.filter(id => !known.has(id) && !seasonalBase(id)).sort().map(id => S(id, titleCase(id), "Fun & other"));
    return [...KNOWN, ...extra];
}

/** Holiday versions ("halloween_mute", "call_ringing_beat") play when the plain one would; your sound replaces them too. */
function seasonalBase(id: string): string | null {
    const m = id.match(/^(?:halloween|winter)_(.+)$/);
    if (m) return m[1];
    if (/^call_ringing_.+/.test(id)) return "call_ringing";
    return null;
}

// ─── Your sounds ───

export interface CustomSound { fileName: string; type: string; size: number; dataUri: string; volume: number; enabled: boolean; }

const KEY = "Sonata_SoundStudio";
let sounds: Record<string, CustomSound> = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(fn => fn());

export const customSounds = () => sounds;
export function onSoundsChange(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

export async function loadSounds() {
    sounds = (await DataStore.get<Record<string, CustomSound>>(KEY)) ?? {};
    emit();
}

async function save() {
    await DataStore.set(KEY, sounds);
    emit();
}

const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a)$/i;
export const MAX_SIZE = 6 * 1024 * 1024;

export function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || AUDIO_EXT.test(file.name);
}

function readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(new Error("Couldn't read that file."));
        r.readAsDataURL(file);
    });
}

/** Use a file for a sound. */
export async function setSoundFile(id: string, file: File) {
    if (!isAudioFile(file)) throw new Error("That isn't a sound file — use an MP3, WAV or OGG.");
    if (file.size > MAX_SIZE) throw new Error(`That file is ${(file.size / 1048576).toFixed(1)} MB — sounds can be up to 6 MB.`);
    const dataUri = await readFile(file);
    // Make sure it actually plays before keeping it.
    await new Promise<void>((resolve, reject) => {
        const a = new Audio();
        a.oncanplaythrough = () => resolve();
        a.onerror = () => reject(new Error("That file won't play — it may be damaged or in an unusual format."));
        a.src = dataUri;
        a.load();
    });
    sounds = { ...sounds, [id]: { fileName: file.name, type: file.type, size: file.size, dataUri, volume: sounds[id]?.volume ?? 100, enabled: true } };
    await save();
}

export async function updateSound(id: string, patch: Partial<CustomSound>) {
    if (!sounds[id]) return;
    sounds = { ...sounds, [id]: { ...sounds[id], ...patch } };
    await save();
}

export async function removeSound(id: string) {
    const { [id]: _, ...rest } = sounds;
    sounds = rest;
    await save();
}

export async function clearSounds() {
    sounds = {};
    await save();
}

/** A sound pack: all your sounds in one file, to back up or share. */
export function exportPack() {
    return JSON.stringify({ sonataSoundPack: 1, sounds }, null, 0);
}

export async function importPack(text: string) {
    const data = JSON.parse(text);
    const incoming = data?.sounds;
    if (data?.sonataSoundPack !== 1 || !incoming || typeof incoming !== "object") throw new Error("That isn't a Sonata sound pack.");
    let count = 0;
    for (const [id, s] of Object.entries<any>(incoming)) {
        if (typeof s?.dataUri !== "string" || !s.dataUri.startsWith("data:")) continue;
        sounds[id] = { fileName: String(s.fileName ?? "sound"), type: String(s.type ?? ""), size: Number(s.size) || 0, dataUri: s.dataUri, volume: Math.max(0, Math.min(100, Number(s.volume) || 100)), enabled: s.enabled !== false };
        count++;
    }
    sounds = { ...sounds };
    await save();
    return count;
}

// ─── Playing ───

/** Swaps one of Discord's sounds for yours, just before it plays. Your volume scales Discord's own volume. */
export const swapSound: AudioProcessor = data => {
    const id = sounds[data.audio] ? data.audio : seasonalBase(data.audio);
    const s = id ? sounds[id] : undefined;
    if (!s?.enabled) return;
    data.audio = s.dataUri;
    data.volume = Math.round(data.volume * s.volume / 100);
};

// Discord's sound files, to play the originals in the window (the audio player would swap them).
const discordSounds = findLazy(m => m.resolve && m.id && m.keys?.().some?.((k: string) => k.endsWith(".mp3")), false);

let playing: HTMLAudioElement | null = null;

export function preview(src: string, volume = 100) {
    playing?.pause();
    const a = new Audio(src);
    a.volume = Math.max(0, Math.min(1, volume / 100));
    playing = a;
    a.play().catch(() => { });
}

export function previewOriginal(id: string) {
    try {
        const mod = discordSounds(`./${id}.mp3`);
        const url = typeof mod === "string" ? mod : mod?.default;
        if (url) preview(url);
    } catch { }
}

export const stopPreview = () => { playing?.pause(); playing = null; };
