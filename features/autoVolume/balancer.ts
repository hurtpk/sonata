/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Auto Volume Balance's engine. While you're in a voice channel it reads how
// loud each person is (from Discord's own voice stats, a few times a second,
// only while they're talking), and nudges their local volume toward one
// target, so quiet people come up and loud people come down. Someone who
// stays far too loud (clipping, ear-rape) gets locally muted for a while.
// It only ever changes what *you* hear — the same as moving their volume
// slider yourself.

import { DataStore } from "@api/index";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, MediaEngineStore, RelationshipStore, SelectedChannelStore, showToast, UserStore, VoiceStateStore } from "@webpack/common";

const AudioActions = findByPropsLazy("setLocalVolume", "toggleLocalMute");
const STORE_KEY = "Sonata_autoVolume_set";
const ALLOW_KEY = "Sonata_autoVolume_allow";
const MANUAL_KEY = "Sonata_autoVolume_manual";
const SCALE_KEY = "Sonata_autoVolume_sliderScale";

// Discord's volume slider isn't the raw volume: the % it shows is a curve of it (its own formula, copied
// from Discord's code). Raw 80 shows as 92% — so a "starting volume of 80" used to land on 92%. Everything
// you choose here is in slider %, turned into Discord's raw volume only when it's set.
/** Slider % → Discord's raw volume. */
export function sliderToRaw(percent: number) {
    if (percent <= 0) return 0;
    const n = percent / 100;
    return (n < 1 ? Math.pow(n, 2.8) : Math.pow(10, (n - 1) * 6 / 20)) * 100;
}
/** Discord's raw volume → slider %. */
export function rawToSlider(raw: number) {
    if (raw <= 0) return 0;
    const n = raw / 100;
    return (n < 1 ? Math.pow(n, 1 / 2.8) : 20 * Math.log10(n) / 6 + 1) * 100;
}
const CONTEXT = "default";

export interface BalancerSettings {
    setOnJoin: boolean;
    /** Use the starting volume every time someone joins, not just the first time Sonata hears them. */
    joinEveryTime: boolean;
    joinVolume: number;
    balance: boolean;
    target: number;
    minVolume: number;
    maxVolume: number;
    muteTooLoud: boolean;
    /** "smart" = only complete ear-rape, "smartMusic" = that and blasted music/sound (see isEarRape), otherwise a loudness limit in dB. */
    tooLoud: number | "smart" | "smartMusic";
    /** Seconds they have to stay that loud. */
    tooLoudFor: number;
    spareFriends: boolean;
    unmuteAfter: number;
    leaveManual: boolean;
}

export interface PersonState {
    userId: string;
    /** How loud their mic is, before your volume (peak, dBFS), or null until they've talked. */
    loudness: number | null;
    volume: number;
    status: "listening" | "balanced" | "manual" | "muted" | "set";
    /** Their loudness right now (dB below maximum), while they're talking. */
    now: number | null;
    friend: boolean;
    mutedUntil?: number;
    /** Loudest they've been since joining, and their usual talking level (dB below maximum). */
    peak: number | null;
    usual: number | null;
    /** You said never to auto-mute them. */
    allowed: boolean;
    /** Why and when Sonata muted them, and how loud they were. */
    muted?: { at: number; why: string; peak: number; usual: number | null; };
}

export type LogKind = "here" | "join" | "leave" | "mute" | "unmute";

export interface LogEntry {
    key: number;
    kind: LogKind;
    userId: string;
    name: string;
    avatar?: string;
    t: number;
    /** How loud they were (for leaving, over their whole stay; for a mute, at the time). */
    usual: number | null;
    peak: number | null;
    why?: string;
}

/** How often levels are read: often enough to tell talking (with gaps) from a solid wall of sound. */
const POLL_MS = 300;

let getSettings: () => BalancerSettings;
let timer: ReturnType<typeof setInterval> | null = null;
let channelId: string | null = null;
interface Tracked extends PersonState { samples: number[]; loudRun: number; lastChange: number; recent: Sample[]; sum: number; count: number; }
const people = new Map<string, Tracked>();
/** Volumes Sonata set (so a volume you set yourself is told apart). Kept across restarts. */
let ours: Record<string, number> = {};
/** People whose volume you changed yourself. Kept across restarts, so Discord restarting never undoes your choice. */
const manual = new Set<string>();
const saveManual = () => void DataStore.set(MANUAL_KEY, [...manual]);
let applying = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(l => l());

export const onBalancerChange = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };
export const peopleNow = () => [...people.values()].map(({ samples, loudRun, lastChange, recent, sum, count, ...p }) => p);
export const inCall = () => channelId;

/** People you said never to auto-mute. Kept across restarts. */
let allowed = new Set<string>();

// What happened in the call: who was here, joined, left, got muted or unmuted.
const log: LogEntry[] = [];
let logKey = 0;
export const activity = () => log;

function record(kind: LogKind, id: string, extra: Partial<LogEntry> = {}) {
    const u: any = UserStore.getUser(id);
    const p = people.get(id);
    log.unshift({
        key: ++logKey, kind, userId: id, t: Date.now(),
        name: u?.globalName || u?.username || "Someone",
        avatar: u?.getAvatarURL?.(undefined, 40, false),
        usual: p?.usual ?? null, peak: p?.peak ?? null,
        ...extra,
    });
    if (log.length > 80) log.length = 80;
}

/** Discord's raw volume for them. */
const rawOf = (id: string) => MediaEngineStore.getLocalVolume(id, CONTEXT as any) ?? 100;
/** Their volume as Discord's slider shows it. */
const volumeOf = (id: string) => Math.round(rawToSlider(rawOf(id)));
const isMuted = (id: string) => !!(MediaEngineStore as any).isLocalMute?.(id, CONTEXT);
const nameOf = (id: string) => { const u: any = UserStore.getUser(id); return u?.globalName || u?.username || "Someone"; };

/** Set their volume, in slider % (what Discord's slider will show). */
function setVolume(id: string, volume: number) {
    const v = Math.round(sliderToRaw(Math.max(0, Math.min(200, volume))));
    applying = true;
    try {
        if (AudioActions?.setLocalVolume) AudioActions.setLocalVolume(id, v, CONTEXT);
        else FluxDispatcher.dispatch({ type: "AUDIO_SET_LOCAL_VOLUME", context: CONTEXT, userId: id, volume: v } as any);
    } finally { applying = false; }
    ours[id] = v;
    void DataStore.set(STORE_KEY, ours);
}

function toggleMute(id: string) {
    applying = true;
    try {
        if (AudioActions?.toggleLocalMute) AudioActions.toggleLocalMute(id, CONTEXT);
        else FluxDispatcher.dispatch({ type: "AUDIO_TOGGLE_LOCAL_MUTE", context: CONTEXT, userId: id } as any);
    } finally { applying = false; }
}

/** You moved someone's slider yourself: leave them alone from now on. */
export function onLocalVolume(e: { userId: string; context?: string; }) {
    if (applying || (e.context && e.context !== CONTEXT)) return;
    manual.add(e.userId);
    saveManual();
    delete ours[e.userId];
    void DataStore.set(STORE_KEY, ours);
    const p = people.get(e.userId);
    if (p) { p.status = "manual"; p.volume = volumeOf(e.userId); changed(); }
}

/** Was this volume set by you (rather than Sonata or the default)? */
const setByYou = (id: string) => {
    if (manual.has(id)) return true;
    const v = rawOf(id);
    return v !== 100 && ours[id] !== v;
};

function addPerson(id: string, joinedNow: boolean) {
    if (people.has(id) || id === UserStore.getCurrentUser()?.id) return;
    const s = getSettings();
    const leave = s.leaveManual && setByYou(id);
    people.set(id, {
        userId: id, loudness: null, now: null, friend: RelationshipStore.isFriend(id), volume: volumeOf(id), status: leave ? "manual" : "listening",
        peak: null, usual: null, allowed: allowed.has(id), samples: [], loudRun: 0, lastChange: 0, recent: [], sum: 0, count: 0,
    });
    if (leave) manual.add(id);
    // Only the first time (unless you asked for every time): someone Sonata already set or balanced keeps
    // their volume — Discord remembers it — instead of being put back to the starting volume on every restart.
    else if (s.setOnJoin && (s.joinEveryTime || (ours[id] == null && !manual.has(id))) && volumeOf(id) !== s.joinVolume) {
        setVolume(id, s.joinVolume);
        const p = people.get(id)!;
        p.volume = s.joinVolume;
        p.status = "set";
    }
    record(joinedNow ? "join" : "here", id);
}

function syncMembers() {
    const mine = SelectedChannelStore.getVoiceChannelId() ?? null;
    // Nobody stays muted by Sonata after they (or you) leave.
    const drop = (id: string, theyLeft: boolean) => {
        if (people.get(id)?.status === "muted" && isMuted(id)) toggleMute(id);
        if (theyLeft) record("leave", id);
        people.delete(id);
    };
    // Someone already in the call when you join "was here"; anyone after that "joined".
    let fresh = false;
    if (mine !== channelId) {
        for (const id of [...people.keys()]) drop(id, false);
        channelId = mine;
        fresh = true;
        if (mine) log.length = 0;
    }
    if (!channelId) { changed(); return; }
    const states = VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {};
    const ids = new Set(Object.values(states).map((v: any) => v.userId));
    for (const id of ids) addPerson(id, !fresh);
    for (const id of [...people.keys()]) if (!ids.has(id)) drop(id, true);
    changed();
}

export const onVoiceStates = () => syncMembers();

const db = (level: number) => 20 * Math.log10(Math.max(level, 1e-5));

/** One reading: when, whether they were making sound, and how loud their mic was (dB below maximum). */
interface Sample { t: number; on: boolean; db: number; /** What you actually hear (after your volume for them). */ heard: number; }
const HISTORY_MS = 8000;

const pct = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

/**
 * Is this ear-rape or blasted sound, rather than someone being loud?
 *
 * - Ear-rape (screaming into a boosted mic): pinned at the very top — mostly
 *   clipping — with no let-up for 2.5 seconds.
 * - Blasted music / soundboard: no pauses at all for 6 seconds, loud, and at
 *   an almost constant level.
 *
 * Talking — even shouting — has gaps between words, breaths, and big swings
 * in level, and a shout or a laugh is over in a moment, so it never matches.
 */
export function isEarRape(recent: Sample[], now: number, music = false): "earrape" | "music" | null {
    const last = (ms: number) => recent.filter(x => now - x.t <= ms);

    // Complete ear-rape: their mic pinned at the very top (clipping) almost the whole time for 3 seconds,
    // with hardly any let-up — AND still blaring for you after your volume. Someone with a naturally hot
    // mic, even shouting, has gaps and dips, and once turned down isn't loud for you any more.
    const short = last(3000);
    const on = short.filter(x => x.on);
    if (short.length >= 9 && on.length / short.length >= 0.95) {
        const mic = on.map(x => x.db).sort((a, b) => a - b);
        const heard = on.map(x => x.heard).sort((a, b) => a - b);
        const clipping = mic.filter(d => d >= -1.5).length / mic.length;
        if (pct(mic, 0.5) >= -1 && pct(mic, 0.25) >= -2 && clipping >= 0.7 && pct(heard, 0.5) >= -6) return "earrape";
    }

    // Blasted music / soundboard (only if you asked for it): a solid, flat wall of loud sound for 8
    // seconds with no gaps at all. Talking always has gaps and big swings in level.
    if (music) {
        const long = last(8000);
        if (long.length >= 24 && long.every(x => x.on)) {
            const levels = long.map(x => x.db).sort((a, b) => a - b);
            const heard = long.map(x => x.heard).sort((a, b) => a - b);
            if (pct(levels, 0.5) >= -5 && levels[0] >= -8 && pct(levels, 0.9) - pct(levels, 0.1) <= 3 && pct(heard, 0.5) >= -7) return "music";
        }
    }
    return null;
}

async function poll() {
    if (!channelId) return;
    const s = getSettings();
    if (!s.balance && !s.muteTooLoud) return;
    const stats: any[] = [];
    try {
        MediaEngineStore.getMediaEngine().eachConnection((c: any) => { if (typeof c.getStats === "function") stats.push(c.getStats()); }, CONTEXT as any);
    } catch { return; }
    const results = await Promise.all(stats.map(p => Promise.resolve(p).catch(() => null)));
    const now = Date.now();

    // Unmute after the timeout.
    for (const p of people.values()) {
        if (p.status !== "muted" || !p.mutedUntil || now < p.mutedUntil) continue;
        if (isMuted(p.userId)) toggleMute(p.userId);
        p.status = "listening";
        p.mutedUntil = undefined;
        p.muted = undefined;
        p.loudRun = 0;
        p.samples = [];
        record("unmute", p.userId, { why: "time's up" });
        showToast(`🔊 Unmuted ${nameOf(p.userId)}`, "message");
    }

    for (const r of results) {
        const inbound = r?.rtp?.inbound;
        if (!inbound) continue;
        for (const [id, list] of Object.entries<any[]>(inbound)) {
            const p = people.get(id);
            const audio = list?.find(x => x?.type === "audio");
            if (!p || !audio || p.status === "muted") continue;
            const gain = Math.max(rawOf(id), 1) / 100;
            const sounding = !!audio.audioDetected && audio.audioLevel > 0.003;
            // The level exactly as Discord measures it — nothing worked out from your volume for them. (Discord
            // measures before your volume, so adding your volume back made anyone you'd turned down look
            // far louder than they were: someone at 30% talking normally looked like clipping.)
            const measured = sounding ? db(audio.audioLevel) : -90;
            p.recent.push({ t: now, on: sounding, db: measured, heard: measured });
            while (p.recent.length && now - p.recent[0].t > HISTORY_MS) p.recent.shift();
            if (!sounding) { p.loudRun = Math.max(0, p.loudRun - 1); p.now = null; continue; }

            // Discord measures the level after your volume is applied (what you actually hear).
            const heard = db(audio.audioLevel);
            // Their mic's own level, for the meter and the too-loud check.
            const source = heard;
            p.samples.push(heard);
            if (p.samples.length > 30) p.samples.shift();
            const sorted = [...p.samples].sort((a, b) => a - b);
            // A high percentile of their talking: steady, and not thrown by one quiet word.
            const heardLevel = sorted[Math.floor(sorted.length * 0.75)];
            p.loudness = heardLevel - db(gain);

            // Way too loud for a couple of seconds straight → mute.
            p.now = source;
            p.peak = p.peak == null ? source : Math.max(p.peak, source);
            p.sum += source;
            p.count++;
            p.usual = p.sum / p.count;
            // Way too loud for long enough (checked twice a second) → mute. Friends are spared if you asked.
            // Never someone you turned down yourself — you're already handling them.
            const youTurnedDown = manual.has(id) && rawOf(id) < 100;
            const canMute = s.muteTooLoud && !(s.spareFriends && p.friend) && !p.allowed && !youTurnedDown;
            let why: string | null = null;
            if (canMute && (s.tooLoud === "smart" || s.tooLoud === "smartMusic")) {
                const kind = isEarRape(p.recent, now, s.tooLoud === "smartMusic");
                if (kind) why = kind === "earrape" ? "ear-rape" : "blasting music or sound";
            } else if (canMute) {
                if (source >= (s.tooLoud as number)) p.loudRun += 1; else p.loudRun = Math.max(0, p.loudRun - 2);
                if (p.loudRun >= Math.max(1, Math.round(s.tooLoudFor * 1000 / POLL_MS))) why = "way too loud";
            }
            if (why) {
                if (!isMuted(id)) toggleMute(id);
                // How loud they were just now, for the window.
                const window = p.recent.filter(x => x.on).map(x => x.db);
                p.muted = { at: now, why, peak: Math.max(source, ...window), usual: window.length ? window.reduce((a, b) => a + b, 0) / window.length : null };
                record("mute", id, { why, peak: p.muted.peak, usual: p.muted.usual });
                p.status = "muted";
                p.mutedUntil = s.unmuteAfter > 0 ? now + s.unmuteAfter * 1000 : undefined;
                p.loudRun = 0;
                p.recent = [];
                showToast(`🔇 Muted ${nameOf(id)} — ${why}${s.unmuteAfter > 0 ? ` (back in ${s.unmuteAfter}s)` : ""}`, "message");
                continue;
            }

            if (!s.balance || p.status === "manual" || p.samples.length < 10 || now - p.lastChange < 2500) continue;
            // How far what you hear is from the target; close enough is left alone.
            const off = s.target - heardLevel;
            const cur = rawOf(id);
            if (Math.abs(off) < 2) { p.status = "balanced"; continue; }
            // Small steps (at most ~3.5 dB at a time), measured again after each, so it settles without jumping.
            // Worked out in raw volume (that's what loudness follows), kept between your limits (slider %).
            const step = Math.max(-6, Math.min(6, off)) * 0.6;
            const next = Math.max(sliderToRaw(s.minVolume), Math.min(sliderToRaw(s.maxVolume), cur * Math.pow(10, step / 20)));
            if (Math.abs(next - cur) < 2) { p.status = "balanced"; continue; }
            setVolume(id, rawToSlider(next));
            p.volume = Math.round(rawToSlider(next));
            p.status = "balanced";
            p.lastChange = now;
            // What's heard changes with the volume, so start measuring again.
            p.samples = [];
        }
    }
    changed();
}

/** Set everyone in the call back to normal volume (and forget what Sonata did). */
export function resetEveryone() {
    for (const id of people.keys()) {
        if (ours[id] != null || people.get(id)!.status !== "manual") setVolume(id, 100);
        if (people.get(id)!.status === "muted" && isMuted(id)) toggleMute(id);
        const p = people.get(id)!;
        p.volume = 100;
        p.status = "listening";
        p.muted = undefined;
        p.mutedUntil = undefined;
        p.samples = [];
    }
    manual.clear();
    saveManual();
    ours = {};
    void DataStore.set(STORE_KEY, ours);
    changed();
}

/** Unmute someone Sonata muted, straight away. */
export function unmuteNow(id: string) {
    const p = people.get(id);
    if (!p || p.status !== "muted") return;
    if (isMuted(id)) toggleMute(id);
    p.status = "listening";
    p.mutedUntil = undefined;
    p.muted = undefined;
    p.recent = [];
    record("unmute", id, { why: "by you" });
    changed();
}

/** Never auto-mute this person again (and unmute them if they are). */
export function allowAlways(id: string, allow = true) {
    if (allow) allowed.add(id); else allowed.delete(id);
    void DataStore.set(ALLOW_KEY, [...allowed]);
    const p = people.get(id);
    if (p) p.allowed = allow;
    if (allow) unmuteNow(id);
    changed();
}

/** Let Sonata manage someone you'd set by hand. */
export function release(id: string) {
    manual.delete(id);
    saveManual();
    const p = people.get(id);
    if (p) { p.status = "listening"; p.samples = []; }
    changed();
}

export async function startBalancer(settings: () => BalancerSettings) {
    getSettings = settings;
    ours = (await DataStore.get(STORE_KEY)) ?? {};
    allowed = new Set((await DataStore.get(ALLOW_KEY)) ?? []);
    manual.clear();
    for (const id of (await DataStore.get<string[]>(MANUAL_KEY)) ?? []) manual.add(id);
    if (!(await DataStore.get(SCALE_KEY))) {
        const join = settings().joinVolume;
        for (const [id, v] of Object.entries(ours)) if (!manual.has(id) && Math.round(v) === Math.round(join)) delete ours[id];
        void DataStore.set(STORE_KEY, ours);
        void DataStore.set(SCALE_KEY, 1);
    }
    syncMembers();
    timer = setInterval(() => void poll(), POLL_MS);
}

export function stopBalancer() {
    if (timer) clearInterval(timer);
    timer = null;
    // Don't leave anyone muted by us.
    for (const p of people.values()) if (p.status === "muted" && isMuted(p.userId)) toggleMute(p.userId);
    people.clear();
    log.length = 0;
    channelId = null;
}
