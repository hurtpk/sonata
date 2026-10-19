/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Keyboard sounds, made on the fly (no sound files).
//
// A real key press is a few things at once: a sharp click as the key bottoms
// out, the keycap and case ringing at a few pitches (that's the "thock" or
// "clack"), a little filtered noise, and a quieter clack when the key comes
// back up. Each pack describes those, and every sound is rendered ahead of
// time in several slightly different versions — each key keeps its own
// character, like on a real board, and nothing repeats exactly.
//
// Bubble pop and Wooden blocks are the original simple sounds, kept as they were.

import { isCustom, playCustom, prepare } from "./custom";

export type KeyKind = "key" | "space" | "enter" | "back";

/* ── The original simple sounds (Bubble pop, Wooden blocks) ───────────── */

interface Noise { f: number; q: number; gain: number; decay: number; type?: BiquadFilterType; }
interface Tone { f: number; to?: number; type: OscillatorType; gain: number; decay: number; delay?: number; }
interface Simple { noise?: Noise; tones?: Tone[]; }

const SIMPLE: Record<string, Record<KeyKind, Simple>> = {
    bubble: {
        key: { tones: [{ f: 420, to: 900, type: "sine", gain: 0.6, decay: 0.06 }] },
        space: { tones: [{ f: 280, to: 620, type: "sine", gain: 0.7, decay: 0.08 }] },
        enter: { tones: [{ f: 330, to: 990, type: "sine", gain: 0.6, decay: 0.1 }, { f: 660, to: 1320, type: "sine", gain: 0.25, decay: 0.08, delay: 0.05 }] },
        back: { tones: [{ f: 900, to: 420, type: "sine", gain: 0.5, decay: 0.06 }] },
    },
    wood: {
        key: { noise: { f: 1800, q: 6, gain: 0.35, decay: 0.03 }, tones: [{ f: 880, type: "sine", gain: 0.5, decay: 0.05 }, { f: 1760, type: "sine", gain: 0.12, decay: 0.03 }] },
        space: { noise: { f: 1200, q: 5, gain: 0.35, decay: 0.04 }, tones: [{ f: 520, type: "sine", gain: 0.6, decay: 0.08 }] },
        enter: { noise: { f: 1400, q: 5, gain: 0.4, decay: 0.04 }, tones: [{ f: 660, type: "sine", gain: 0.6, decay: 0.09 }, { f: 990, type: "sine", gain: 0.3, decay: 0.07, delay: 0.06 }] },
        back: { noise: { f: 2200, q: 6, gain: 0.3, decay: 0.025 }, tones: [{ f: 1040, type: "sine", gain: 0.45, decay: 0.04 }] },
    },
};

/* ── The keyboard model ───────────────────────────────────────────────── */

/** [pitch Hz, how long it rings (ms), loudness] */
type Mode = [number, number, number];

interface Hit {
    /** The sharp click when the key bottoms out: noise this short (ms), above this pitch. `second` adds a click-jacket / spring click. */
    click?: { gain: number; hp: number; ms: number; second?: { at: number; gain: number; }; };
    /** Filtered noise for the body of the sound. */
    body?: { gain: number; f: number; q: number; ms: number; type?: "bp" | "lp" | "hp"; };
    /** The keycap, plate and case ringing. */
    modes?: Mode[];
    /** Long rings: a spring "ping", a typewriter bell. */
    rings?: Mode[];
    /** Loudness of the up-stroke clack (0 for none). */
    release?: number;
    /** Spacebar stabilisers rattling, a little after the hit. */
    rattle?: number;
    /** A typewriter carriage ratchet: this many clicks over `ms`. */
    ratchet?: { count: number; ms: number; gain: number; };
    /** Pitch glide for drops: modes slide up by this factor over 20 ms. */
    chirp?: number;
    /** Soft mallet/finger tap instead of a click (for the musical packs). */
    mallet?: number;
}

type Kinds = Record<KeyKind, Hit>;

export interface PackInfo { id: string; name: string; blurb: string; group: "Keyboards" | "Calm" | "Fun"; }

interface Pack extends PackInfo {
    /** Either one sound per key kind, or — for the musical packs — a note per variant. */
    kinds?: Kinds;
    notes?: (kind: KeyKind, i: number) => Hit;
    gain?: number;
}

const k = (key: Hit, space: Hit, enter: Hit, back: Hit): Kinds => ({ key, space, enter, back });

// Pentatonic notes (C major), two octaves — every key lands on a pleasant note.
const PENTA = [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99, 880];

const PACKLIST: Pack[] = [
    {
        id: "soft", name: "Soft mechanical", group: "Keyboards", blurb: "A gentle, everyday mechanical keyboard",
        kinds: k(
            { click: { gain: 0.3, hp: 2600, ms: 1.2 }, body: { gain: 0.45, f: 1700, q: 1.1, ms: 9 }, modes: [[430, 18, 0.5], [1150, 8, 0.25], [2600, 4, 0.1]], release: 0.22 },
            { click: { gain: 0.25, hp: 2000, ms: 1.4 }, body: { gain: 0.45, f: 1000, q: 1, ms: 14 }, modes: [[230, 32, 0.6], [620, 16, 0.3], [1400, 7, 0.1]], release: 0.2, rattle: 0.18 },
            { click: { gain: 0.3, hp: 2200, ms: 1.3 }, body: { gain: 0.5, f: 1300, q: 1, ms: 12 }, modes: [[300, 24, 0.55], [820, 12, 0.3], [1900, 6, 0.1]], release: 0.22 },
            { click: { gain: 0.3, hp: 2800, ms: 1.1 }, body: { gain: 0.4, f: 1900, q: 1.1, ms: 8 }, modes: [[480, 16, 0.5], [1300, 7, 0.25]], release: 0.2 },
        ),
    },
    {
        id: "creamy", name: "Creamy linear", group: "Keyboards", blurb: "Lubed linear switches — smooth, round and soft",
        kinds: k(
            { click: { gain: 0.12, hp: 3000, ms: 0.8 }, body: { gain: 0.5, f: 900, q: 0.9, ms: 12, type: "lp" }, modes: [[340, 26, 0.65], [780, 14, 0.3], [1600, 6, 0.1]], release: 0.14 },
            { click: { gain: 0.1, hp: 2400, ms: 0.9 }, body: { gain: 0.5, f: 700, q: 0.8, ms: 18, type: "lp" }, modes: [[190, 42, 0.75], [480, 20, 0.3], [1050, 8, 0.1]], release: 0.12, rattle: 0.1 },
            { click: { gain: 0.12, hp: 2600, ms: 0.9 }, body: { gain: 0.5, f: 800, q: 0.8, ms: 15, type: "lp" }, modes: [[250, 34, 0.7], [610, 17, 0.3], [1300, 7, 0.1]], release: 0.14 },
            { click: { gain: 0.12, hp: 3200, ms: 0.8 }, body: { gain: 0.45, f: 1000, q: 0.9, ms: 11, type: "lp" }, modes: [[380, 22, 0.6], [880, 12, 0.28]], release: 0.14 },
        ),
    },
    {
        id: "thock", name: "Deep thock", group: "Keyboards", blurb: "Heavy board, thick keycaps — a low, satisfying thock",
        kinds: k(
            { click: { gain: 0.07, hp: 1800, ms: 0.8 }, body: { gain: 0.5, f: 650, q: 0.8, ms: 14, type: "lp" }, modes: [[165, 34, 0.8], [340, 22, 0.45], [720, 10, 0.18]], release: 0.1 },
            { click: { gain: 0.06, hp: 1500, ms: 0.9 }, body: { gain: 0.55, f: 480, q: 0.8, ms: 20, type: "lp" }, modes: [[105, 55, 0.9], [240, 30, 0.4], [520, 14, 0.14]], release: 0.08, rattle: 0.08 },
            { click: { gain: 0.07, hp: 1600, ms: 0.9 }, body: { gain: 0.55, f: 560, q: 0.8, ms: 18, type: "lp" }, modes: [[125, 46, 0.85], [290, 26, 0.42], [610, 12, 0.16]], release: 0.1 },
            { click: { gain: 0.07, hp: 2000, ms: 0.8 }, body: { gain: 0.48, f: 720, q: 0.8, ms: 12, type: "lp" }, modes: [[185, 30, 0.78], [380, 19, 0.4]], release: 0.1 },
        ),
    },
    {
        id: "marbly", name: "Marbly clack", group: "Keyboards", blurb: "Hard plastic keycaps — bright, poppy, a bit like marbles",
        kinds: k(
            { click: { gain: 0.45, hp: 3500, ms: 1 }, body: { gain: 0.45, f: 2600, q: 1.6, ms: 6 }, modes: [[900, 10, 0.5], [2100, 6, 0.35], [3600, 3, 0.16]], release: 0.32 },
            { click: { gain: 0.4, hp: 3000, ms: 1.1 }, body: { gain: 0.45, f: 1900, q: 1.4, ms: 9 }, modes: [[560, 16, 0.55], [1400, 8, 0.32], [2800, 4, 0.14]], release: 0.28, rattle: 0.2 },
            { click: { gain: 0.45, hp: 3200, ms: 1 }, body: { gain: 0.5, f: 2200, q: 1.5, ms: 8 }, modes: [[700, 13, 0.55], [1700, 7, 0.34], [3200, 3, 0.15]], release: 0.3 },
            { click: { gain: 0.45, hp: 3700, ms: 0.9 }, body: { gain: 0.42, f: 2900, q: 1.6, ms: 5 }, modes: [[1000, 9, 0.5], [2300, 5, 0.32]], release: 0.3 },
        ),
    },
    {
        id: "tactile", name: "Tactile (brown switches)", group: "Keyboards", blurb: "A soft bump, then a medium bottom-out",
        kinds: k(
            { click: { gain: 0.22, hp: 3000, ms: 1, second: { at: 5, gain: 0.1 } }, body: { gain: 0.48, f: 1500, q: 1, ms: 9 }, modes: [[380, 20, 0.55], [1000, 9, 0.25], [2300, 4, 0.1]], release: 0.18 },
            { click: { gain: 0.2, hp: 2500, ms: 1.1, second: { at: 6, gain: 0.08 } }, body: { gain: 0.48, f: 950, q: 0.9, ms: 14 }, modes: [[210, 36, 0.65], [560, 18, 0.3], [1250, 8, 0.1]], release: 0.16, rattle: 0.14 },
            { click: { gain: 0.22, hp: 2700, ms: 1, second: { at: 5, gain: 0.1 } }, body: { gain: 0.5, f: 1200, q: 1, ms: 12 }, modes: [[280, 28, 0.6], [760, 13, 0.28], [1700, 6, 0.1]], release: 0.18 },
            { click: { gain: 0.22, hp: 3200, ms: 0.9, second: { at: 5, gain: 0.1 } }, body: { gain: 0.45, f: 1700, q: 1, ms: 8 }, modes: [[420, 18, 0.52], [1100, 8, 0.24]], release: 0.18 },
        ),
    },
    {
        id: "clicky", name: "Clicky (blue switches)", group: "Keyboards", blurb: "The classic click on every press — and a softer one on release",
        kinds: k(
            { click: { gain: 0.85, hp: 4500, ms: 0.9, second: { at: 9, gain: 0.5 } }, body: { gain: 0.42, f: 2400, q: 1.4, ms: 6 }, modes: [[520, 14, 0.35], [1500, 6, 0.2], [4200, 2.5, 0.22]], release: 0.42 },
            { click: { gain: 0.75, hp: 3800, ms: 1, second: { at: 10, gain: 0.45 } }, body: { gain: 0.45, f: 1600, q: 1.2, ms: 10 }, modes: [[260, 28, 0.5], [800, 12, 0.25], [3600, 3, 0.18]], release: 0.38, rattle: 0.22 },
            { click: { gain: 0.85, hp: 4200, ms: 0.9, second: { at: 9, gain: 0.5 } }, body: { gain: 0.45, f: 2000, q: 1.3, ms: 8 }, modes: [[360, 20, 0.42], [1100, 9, 0.22], [3900, 3, 0.2]], release: 0.42 },
            { click: { gain: 0.85, hp: 4800, ms: 0.8, second: { at: 8, gain: 0.48 } }, body: { gain: 0.4, f: 2700, q: 1.4, ms: 5 }, modes: [[600, 12, 0.34], [1700, 5, 0.2]], release: 0.42 },
        ),
    },
    {
        id: "jade", name: "Crisp click (box jade)", group: "Keyboards", blurb: "A sharper, thicker click than blues",
        kinds: k(
            { click: { gain: 1, hp: 3800, ms: 0.8, second: { at: 7, gain: 0.7 } }, body: { gain: 0.45, f: 2000, q: 1.3, ms: 7 }, modes: [[600, 12, 0.4], [1800, 6, 0.3], [3200, 3, 0.22]], release: 0.3 },
            { click: { gain: 0.9, hp: 3300, ms: 0.9, second: { at: 8, gain: 0.6 } }, body: { gain: 0.48, f: 1400, q: 1.1, ms: 11 }, modes: [[300, 26, 0.5], [950, 11, 0.28], [2600, 4, 0.18]], release: 0.28, rattle: 0.2 },
            { click: { gain: 1, hp: 3600, ms: 0.8, second: { at: 7, gain: 0.7 } }, body: { gain: 0.48, f: 1700, q: 1.2, ms: 9 }, modes: [[420, 18, 0.45], [1300, 8, 0.28], [3000, 3, 0.2]], release: 0.3 },
            { click: { gain: 1, hp: 4000, ms: 0.7, second: { at: 6, gain: 0.68 } }, body: { gain: 0.42, f: 2300, q: 1.3, ms: 6 }, modes: [[680, 11, 0.4], [2000, 5, 0.28]], release: 0.3 },
        ),
    },
    {
        id: "topre", name: "Topre (cushioned)", group: "Keyboards", blurb: "Rubber dome with a spring — a muted, cushioned thock",
        kinds: k(
            { click: { gain: 0.05, hp: 2500, ms: 0.6 }, body: { gain: 0.55, f: 600, q: 0.7, ms: 16, type: "lp" }, modes: [[250, 24, 0.7], [520, 14, 0.35], [1100, 6, 0.12]], release: 0.18 },
            { click: { gain: 0.04, hp: 2200, ms: 0.6 }, body: { gain: 0.55, f: 450, q: 0.7, ms: 22, type: "lp" }, modes: [[150, 40, 0.8], [330, 22, 0.35], [760, 9, 0.1]], release: 0.15, rattle: 0.06 },
            { click: { gain: 0.05, hp: 2300, ms: 0.6 }, body: { gain: 0.55, f: 520, q: 0.7, ms: 19, type: "lp" }, modes: [[190, 32, 0.75], [420, 18, 0.35], [900, 8, 0.1]], release: 0.18 },
            { click: { gain: 0.05, hp: 2700, ms: 0.6 }, body: { gain: 0.5, f: 680, q: 0.7, ms: 14, type: "lp" }, modes: [[280, 22, 0.68], [580, 12, 0.32]], release: 0.18 },
        ),
    },
    {
        id: "buckling", name: "Vintage spring (Model M)", group: "Keyboards", blurb: "Buckling springs — a loud snap with that spring ping",
        kinds: k(
            { click: { gain: 0.75, hp: 3000, ms: 1.2, second: { at: 12, gain: 0.45 } }, body: { gain: 0.52, f: 1800, q: 1, ms: 10 }, modes: [[400, 22, 0.45], [1100, 10, 0.3]], rings: [[2650, 70, 0.1], [3900, 45, 0.05]], release: 0.32 },
            { click: { gain: 0.7, hp: 2600, ms: 1.3, second: { at: 13, gain: 0.4 } }, body: { gain: 0.55, f: 1200, q: 0.9, ms: 15 }, modes: [[210, 38, 0.55], [640, 16, 0.3]], rings: [[2400, 80, 0.12], [3600, 50, 0.05]], release: 0.3, rattle: 0.25 },
            { click: { gain: 0.75, hp: 2800, ms: 1.2, second: { at: 12, gain: 0.45 } }, body: { gain: 0.55, f: 1500, q: 1, ms: 12 }, modes: [[300, 28, 0.5], [880, 13, 0.3]], rings: [[2550, 75, 0.11], [3800, 48, 0.05]], release: 0.32 },
            { click: { gain: 0.75, hp: 3200, ms: 1.1, second: { at: 11, gain: 0.45 } }, body: { gain: 0.5, f: 2000, q: 1, ms: 9 }, modes: [[440, 20, 0.45], [1200, 9, 0.28]], rings: [[2750, 65, 0.1]], release: 0.32 },
        ),
    },
    {
        id: "alps", name: "Vintage clicky (Alps)", group: "Keyboards", blurb: "Old-school clicky — crunchy and bright",
        kinds: k(
            { click: { gain: 0.7, hp: 3200, ms: 1.2, second: { at: 6, gain: 0.45 } }, body: { gain: 0.5, f: 2100, q: 1.3, ms: 8 }, modes: [[480, 16, 0.4], [1400, 7, 0.25], [2900, 4, 0.15]], release: 0.25 },
            { click: { gain: 0.65, hp: 2800, ms: 1.3, second: { at: 7, gain: 0.4 } }, body: { gain: 0.5, f: 1400, q: 1.1, ms: 12 }, modes: [[250, 30, 0.5], [800, 12, 0.25], [2200, 5, 0.12]], release: 0.22, rattle: 0.2 },
            { click: { gain: 0.7, hp: 3000, ms: 1.2, second: { at: 6, gain: 0.45 } }, body: { gain: 0.52, f: 1800, q: 1.2, ms: 10 }, modes: [[350, 22, 0.45], [1100, 9, 0.25], [2600, 4, 0.14]], release: 0.25 },
            { click: { gain: 0.7, hp: 3400, ms: 1.1, second: { at: 6, gain: 0.45 } }, body: { gain: 0.48, f: 2300, q: 1.3, ms: 7 }, modes: [[540, 15, 0.4], [1550, 6, 0.24]], release: 0.25 },
        ),
    },
    {
        id: "laptop", name: "Laptop keys", group: "Keyboards", blurb: "Light, quick scissor keys",
        kinds: k(
            { click: { gain: 0.3, hp: 3500, ms: 0.6 }, body: { gain: 0.42, f: 2200, q: 1.3, ms: 4 }, modes: [[900, 7, 0.4], [2100, 4, 0.25]], release: 0.1 },
            { click: { gain: 0.28, hp: 3000, ms: 0.7 }, body: { gain: 0.45, f: 1500, q: 1.2, ms: 7 }, modes: [[600, 10, 0.45], [1500, 5, 0.2]], release: 0.08, rattle: 0.12 },
            { click: { gain: 0.3, hp: 3200, ms: 0.6 }, body: { gain: 0.45, f: 1900, q: 1.3, ms: 5 }, modes: [[760, 9, 0.42], [1800, 4, 0.22]], release: 0.1 },
            { click: { gain: 0.3, hp: 3700, ms: 0.6 }, body: { gain: 0.4, f: 2400, q: 1.3, ms: 4 }, modes: [[980, 6, 0.4], [2300, 4, 0.22]], release: 0.1 },
        ),
    },
    {
        id: "magic", name: "Slim keyboard (Magic Keyboard)", group: "Keyboards", blurb: "Very short, soft, precise taps",
        kinds: k(
            { click: { gain: 0.2, hp: 4000, ms: 0.5 }, body: { gain: 0.38, f: 2800, q: 1.5, ms: 3 }, modes: [[1200, 5, 0.35], [2600, 3, 0.2]], release: 0.05 },
            { click: { gain: 0.18, hp: 3400, ms: 0.6 }, body: { gain: 0.42, f: 2000, q: 1.3, ms: 5 }, modes: [[800, 7, 0.4], [1900, 4, 0.2]], release: 0.04 },
            { click: { gain: 0.2, hp: 3700, ms: 0.5 }, body: { gain: 0.4, f: 2400, q: 1.4, ms: 4 }, modes: [[1000, 6, 0.38], [2300, 3, 0.2]], release: 0.05 },
            { click: { gain: 0.2, hp: 4200, ms: 0.5 }, body: { gain: 0.36, f: 3000, q: 1.5, ms: 3 }, modes: [[1300, 5, 0.34], [2800, 3, 0.18]], release: 0.05 },
        ),
    },
    {
        id: "membrane", name: "Office keyboard", group: "Keyboards", blurb: "A standard rubber-dome keyboard — dull and soft",
        kinds: k(
            { click: { gain: 0.03, hp: 2500, ms: 0.6 }, body: { gain: 0.52, f: 900, q: 0.7, ms: 10, type: "lp" }, modes: [[280, 16, 0.5], [640, 9, 0.25]], release: 0.1 },
            { click: { gain: 0.03, hp: 2200, ms: 0.6 }, body: { gain: 0.55, f: 700, q: 0.7, ms: 15, type: "lp" }, modes: [[180, 26, 0.6], [450, 12, 0.25]], release: 0.08, rattle: 0.16 },
            { click: { gain: 0.03, hp: 2300, ms: 0.6 }, body: { gain: 0.55, f: 800, q: 0.7, ms: 13, type: "lp" }, modes: [[220, 22, 0.55], [540, 11, 0.25]], release: 0.1 },
            { click: { gain: 0.03, hp: 2700, ms: 0.6 }, body: { gain: 0.5, f: 1000, q: 0.7, ms: 9, type: "lp" }, modes: [[310, 15, 0.5], [700, 8, 0.24]], release: 0.1 },
        ),
    },
    {
        id: "silent", name: "Silent switches", group: "Calm", blurb: "Barely-there, muffled taps",
        gain: 0.65,
        kinds: k(
            { body: { gain: 0.5, f: 700, q: 0.7, ms: 7, type: "lp" }, modes: [[260, 12, 0.45], [600, 6, 0.2]] },
            { body: { gain: 0.55, f: 550, q: 0.7, ms: 10, type: "lp" }, modes: [[170, 18, 0.5], [420, 8, 0.2]] },
            { body: { gain: 0.55, f: 620, q: 0.7, ms: 9, type: "lp" }, modes: [[210, 15, 0.48], [500, 7, 0.2]] },
            { body: { gain: 0.5, f: 760, q: 0.7, ms: 6, type: "lp" }, modes: [[290, 11, 0.44], [660, 6, 0.2]] },
        ),
    },
    {
        id: "typewriter", name: "Typewriter", group: "Fun", blurb: "Metal type bars, and the carriage bell on Enter",
        kinds: k(
            { click: { gain: 1, hp: 2500, ms: 1.5, second: { at: 3, gain: 0.4 } }, body: { gain: 0.55, f: 1800, q: 1, ms: 12 }, modes: [[700, 25, 0.35], [1900, 14, 0.25], [3300, 8, 0.15]], release: 0.25 },
            { click: { gain: 0.6, hp: 1800, ms: 1.8 }, body: { gain: 0.6, f: 900, q: 0.9, ms: 18 }, modes: [[180, 30, 0.6], [900, 14, 0.25]], release: 0.3 },
            { click: { gain: 0.9, hp: 2200, ms: 1.5 }, body: { gain: 0.5, f: 1500, q: 1, ms: 14 }, modes: [[600, 20, 0.3]], ratchet: { count: 9, ms: 210, gain: 0.32 }, rings: [[2093, 420, 0.42], [4186, 260, 0.14], [6279, 120, 0.05]] },
            { click: { gain: 1, hp: 2800, ms: 1.4, second: { at: 3, gain: 0.4 } }, body: { gain: 0.5, f: 2100, q: 1, ms: 10 }, modes: [[820, 22, 0.32], [2200, 12, 0.22]], release: 0.25 },
        ),
    },
    {
        id: "rain", name: "Raindrops", group: "Calm", blurb: "Soft drops of water",
        gain: 0.8,
        notes: (kind, i) => {
            const base = kind === "space" ? 700 : kind === "enter" ? 900 : kind === "back" ? 1500 : 1000 + i * 120;
            return { mallet: 0.15, chirp: 1.9, modes: [[base, 28, 0.6], [base * 2.1, 14, 0.12]], body: kind === "space" ? { gain: 0.12, f: 900, q: 0.7, ms: 40, type: "lp" } : undefined };
        },
    },
    {
        id: "kalimba", name: "Kalimba", group: "Calm", blurb: "Every key a soft thumb-piano note",
        gain: 0.62,
        notes: (kind, i) => {
            const f = kind === "space" ? PENTA[0] / 2 : kind === "enter" ? PENTA[5] : kind === "back" ? PENTA[2] / 2 : PENTA[i % PENTA.length];
            const chord: Mode[] = kind === "enter" ? [[f * 1.25, 600, 0.3], [f * 1.5, 600, 0.25]] : [];
            return { mallet: 0.25, modes: [[f, 650, 0.6], [f * 5.95, 70, 0.14], [f * 2.01, 160, 0.06], ...chord] };
        },
    },
    {
        id: "marimba", name: "Marimba", group: "Calm", blurb: "Warm wooden notes",
        gain: 0.72,
        notes: (kind, i) => {
            const f = kind === "space" ? PENTA[0] / 2 : kind === "enter" ? PENTA[7] : kind === "back" ? PENTA[1] / 2 : PENTA[i % PENTA.length];
            return { mallet: 0.35, modes: [[f, 220, 0.65], [f * 4, 35, 0.18], [f * 10, 9, 0.05]], ...(kind === "enter" ? { rings: [[f * 1.5, 200, 0.3]] as Mode[] } : {}) };
        },
    },
    {
        id: "chimes", name: "Soft chimes", group: "Calm", blurb: "Gentle glassy bells",
        gain: 0.6,
        notes: (kind, i) => {
            const f = (kind === "space" ? PENTA[3] : kind === "enter" ? PENTA[8] : kind === "back" ? PENTA[4] : PENTA[i % PENTA.length]) * 2;
            return { mallet: 0.1, modes: [[f, 900, 0.45], [f * 2.76, 350, 0.12], [f * 5.4, 120, 0.04]] };
        },
    },
];

const SIMPLE_INFO: PackInfo[] = [
    { id: "bubble", name: "Bubble pop", group: "Fun", blurb: "Little pops" },
    { id: "wood", name: "Wooden blocks", group: "Fun", blurb: "Knocks on wood" },
];

/** Every pack, for the picker. */
export const PACKS: PackInfo[] = [...PACKLIST.map(({ id, name, blurb, group }) => ({ id, name, blurb, group })), ...SIMPLE_INFO];
export const DEFAULT_PACK = "creamy";

/* ── Rendering ────────────────────────────────────────────────────────── */

const VARIANTS = 8;

// RBJ biquad, for shaping noise.
function biquad(x: Float32Array, sr: number, type: "bp" | "lp" | "hp", f: number, q: number) {
    const w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, a = Math.sin(w) / (2 * q), c = Math.cos(w);
    let b0: number, b1: number, b2: number;
    if (type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; } else if (type === "hp") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; } else { b0 = a; b1 = 0; b2 = -a; }
    const a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
        const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
        x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
    }
}

const jit = (v: number, amount: number) => v * (1 + (Math.random() * 2 - 1) * amount);

/** Adds one strike (bottom-out or the up-stroke) into `out` at `at` seconds. */
function strike(out: Float32Array, sr: number, h: Hit, at: number, scale: number, pitch: number) {
    const start = Math.floor(at * sr);
    const add = (buf: Float32Array, offset = 0) => { for (let i = 0; i < buf.length && start + offset + i < out.length; i++) out[start + offset + i] += buf[i] * scale; };

    const noiseBurst = (ms: number, gain: number, type: "bp" | "lp" | "hp", f: number, q: number) => {
        const n = Math.ceil(sr * ms / 1000 * 7);
        const b = new Float32Array(n);
        const tau = sr * ms / 1000;
        for (let i = 0; i < n; i++) b[i] = (Math.random() * 2 - 1) * Math.exp(-i / tau) * Math.min(1, i / (sr * 0.0003));
        biquad(b, sr, type, f * pitch, q);
        if (type === "bp") biquad(b, sr, "bp", f * pitch, q); // two passes: a firmer "body" pitch
        for (let i = 0; i < n; i++) b[i] *= gain * (type === "bp" ? 2.2 : 1);
        return b;
    };

    if (h.click) {
        add(noiseBurst(jit(h.click.ms, 0.15), jit(h.click.gain, 0.12), "hp", jit(h.click.hp, 0.06), 0.7));
        if (h.click.second) add(noiseBurst(h.click.ms, jit(h.click.second.gain, 0.15), "hp", h.click.hp * 1.1, 0.7), Math.floor(jit(h.click.second.at, 0.12) / 1000 * sr));
    }
    if (h.body) add(noiseBurst(jit(h.body.ms, 0.12), jit(h.body.gain, 0.12), h.body.type ?? "bp", jit(h.body.f, 0.05), h.body.q));

    const ring = (modes: Mode[]) => {
        for (const [f0, ms, g0] of modes) {
            const f = jit(f0, 0.025) * pitch, tau = jit(ms, 0.1) / 1000 * sr, g = jit(g0, 0.12);
            const n = Math.min(out.length - start, Math.ceil(tau * 7));
            const phase = Math.random() * Math.PI * 2;
            const attack = sr * (h.mallet ? 0.0015 + h.mallet * 0.004 : 0.0004);
            for (let i = 0; i < n; i++) {
                const t = i / sr;
                const glide = h.chirp ? 1 + (h.chirp - 1) * Math.min(1, t / 0.02) : 1;
                out[start + i] += Math.sin(2 * Math.PI * f * glide * t + phase) * Math.exp(-i / tau) * Math.min(1, i / attack) * g * scale;
            }
        }
    };
    if (h.modes) ring(h.modes);
    if (h.rings) ring(h.rings);
    if (h.mallet) add(noiseBurst(1.2, h.mallet * 0.5, "lp", 2500, 0.7));
}

function render(h: Hit, sr: number, variant: number): Float32Array {
    const long = Math.max(0.18, ...[...(h.modes ?? []), ...(h.rings ?? [])].map(([, ms]) => ms * 4.5 / 1000)) + (h.ratchet ? h.ratchet.ms / 1000 : 0);
    const out = new Float32Array(Math.ceil(sr * Math.min(long + 0.15, 1.6)));
    // Each key position sounds a touch different (variant), plus a little randomness.
    const pitch = 1 + (variant - VARIANTS / 2) * 0.006;
    if (h.ratchet) {
        for (let i = 0; i < h.ratchet.count; i++) strike(out, sr, { click: { gain: h.ratchet.gain, hp: 2600, ms: 0.9 }, modes: [[1500, 6, 0.08]] }, (i / h.ratchet.count) * h.ratchet.ms / 1000, 1, pitch * (1 + i * 0.01));
        strike(out, sr, { ...h, ratchet: undefined, release: 0 }, h.ratchet.ms / 1000 + 0.01, 1, pitch);
    } else strike(out, sr, h, 0.002, 1, pitch);
    if (h.rattle) strike(out, sr, { click: { gain: h.rattle, hp: 3000, ms: 0.7 }, modes: [[2400, 4, h.rattle * 0.6]] }, jit(0.016, 0.2), 1, pitch);
    if (h.release) strike(out, sr, { ...h, rings: undefined, ratchet: undefined, rattle: 0 }, jit(0.095, 0.2), h.release, pitch * 1.08);
    // A gentle limiter keeps loud packs from clipping.
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * 1.2) / 1.2;
    return out;
}

type Rendered = Record<KeyKind, AudioBuffer[]>;
const cache = new Map<string, Rendered>();

function rendered(ac: AudioContext, id: string): Rendered | null {
    const pack = PACKLIST.find(p => p.id === id);
    if (!pack) return null;
    const hit = cache.get(id);
    if (hit) return hit;
    const sr = ac.sampleRate;
    const raw: Record<KeyKind, Float32Array[]> = { key: [], space: [], enter: [], back: [] };
    for (const kind of ["key", "space", "enter", "back"] as KeyKind[]) {
        for (let v = 0; v < (pack.notes ? (kind === "key" ? PENTA.length : 1) : VARIANTS); v++) raw[kind].push(render(pack.notes ? pack.notes(kind, v) : pack.kinds![kind], sr, pack.notes ? VARIANTS / 2 : v));
    }
    // Same loudness for every pack: the ordinary key's peak sets it.
    const peak = Math.max(1e-4, ...raw.key.map(b => b.reduce((m, x) => Math.max(m, Math.abs(x)), 0)));
    const norm = 0.8 / peak * (pack.gain ?? 1);
    const out = {} as Rendered;
    for (const kind of Object.keys(raw) as KeyKind[]) {
        out[kind] = raw[kind].map(b => {
            const buf = ac.createBuffer(1, b.length, sr);
            const d = buf.getChannelData(0);
            for (let i = 0; i < b.length; i++) d[i] = b[i] * norm;
            return buf;
        });
    }
    // Only the packs in use stay rendered.
    if (cache.size > 2) cache.delete(cache.keys().next().value!);
    cache.set(id, out);
    return out;
}

/* ── Playing ──────────────────────────────────────────────────────────── */

let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;

function audio() {
    ctx ??= new AudioContext({ latencyHint: "interactive" });
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
}

// Where each key sits left-to-right on a keyboard (0–1), for stereo placement.
const ROWS = ["`1234567890-=", "qwertyuiop[]\\", "asdfghjkl;'", "zxcvbnm,./"];
function keyX(e: { key?: string; code?: string; }): number {
    const ch = (e.key ?? "").toLowerCase();
    for (const [r, row] of ROWS.entries()) { const i = row.indexOf(ch); if (i >= 0) return (i + r * 0.35 + 0.5) / 13.5; }
    if (e.key === "Backspace" || e.key === "Delete") return 0.95;
    if (e.key === "Enter") return 0.9;
    return 0.5;
}
const keyHash = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

export interface PlayOptions { volume: number; vary: boolean; stereo: boolean; key?: string; code?: string; }

export function playKey(packId: string, kind: KeyKind, o: PlayOptions) {
    const ac = audio();
    if (isCustom(packId)) return playCustom(ac, packId, kind, { ...o, pan: o.stereo ? (keyX(o) - 0.5) * 0.7 : null });
    if (SIMPLE[packId]) return playSimple(ac, SIMPLE[packId], kind, o.volume, o.vary);
    const r = rendered(ac, packId) ?? rendered(ac, DEFAULT_PACK)!;
    const list = r[kind] ?? r.key;
    const pack = PACKLIST.find(p => p.id === packId);
    // Musical packs: each key has its note. Keyboards: each key has its own version, sometimes a neighbour's.
    const base = keyHash(o.code || o.key || "x") % list.length;
    const pick = pack?.notes || !o.vary ? base : (base + (Math.random() < 0.35 ? 1 : 0)) % list.length;
    const src = ac.createBufferSource();
    src.buffer = list[pick];
    if (o.vary && !pack?.notes) src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.04;
    const g = ac.createGain();
    g.gain.value = Math.max(0, Math.min(1, o.volume)) * (o.vary ? 0.88 + Math.random() * 0.24 : 1);
    let node: AudioNode = src.connect(g);
    if (o.stereo && typeof ac.createStereoPanner === "function") {
        const p = ac.createStereoPanner();
        p.pan.value = (keyX(o) - 0.5) * 0.7;
        node = node.connect(p);
    }
    node.connect(ac.destination);
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch { } };
    src.start();
}

function playSimple(ac: AudioContext, pack: Record<KeyKind, Simple>, kind: KeyKind, volume: number, vary: boolean) {
    const sound = pack[kind] ?? pack.key;
    if (!noiseBuf) {
        noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.25), ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ac.currentTime + 0.002;
    const r = vary ? 1 + (Math.random() - 0.5) * 0.14 : 1;
    const g = vary ? 1 + (Math.random() - 0.5) * 0.3 : 1;
    const out = ac.createGain();
    out.gain.value = Math.max(0, Math.min(1, volume)) * 0.6;
    out.connect(ac.destination);
    let end = t;
    if (sound.noise) {
        const n = sound.noise;
        const src = ac.createBufferSource();
        src.buffer = noiseBuf;
        src.playbackRate.value = r;
        const filter = ac.createBiquadFilter();
        filter.type = n.type ?? "bandpass";
        filter.frequency.value = n.f * r;
        filter.Q.value = n.q;
        const env = ac.createGain();
        env.gain.setValueAtTime(n.gain * g, t);
        env.gain.exponentialRampToValueAtTime(0.0005, t + n.decay);
        src.connect(filter).connect(env).connect(out);
        src.start(t, Math.random() * 0.1);
        src.stop(t + n.decay + 0.02);
        end = Math.max(end, t + n.decay);
    }
    for (const tone of sound.tones ?? []) {
        const start = t + (tone.delay ?? 0);
        const osc = ac.createOscillator();
        osc.type = tone.type;
        osc.frequency.setValueAtTime(tone.f * r, start);
        if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to * r, start + tone.decay);
        const env = ac.createGain();
        env.gain.setValueAtTime(0.0001, start);
        env.gain.linearRampToValueAtTime(tone.gain * g, start + 0.002);
        env.gain.exponentialRampToValueAtTime(0.0005, start + tone.decay);
        osc.connect(env).connect(out);
        osc.start(start);
        osc.stop(start + tone.decay + 0.02);
        end = Math.max(end, start + tone.decay);
    }
    setTimeout(() => out.disconnect(), (end - ac.currentTime) * 1000 + 200);
}

/** Renders a pack ahead of time, so the first key press is instant. */
export function warm(packId: string) {
    if (isCustom(packId)) { void prepare(audio(), packId); return; }
    if (SIMPLE[packId]) return;
    try { rendered(audio(), packId); } catch { }
}

/** A short demo: a few keys, a space, a few more, Enter. */
export function demo(packId: string, o: Omit<PlayOptions, "key" | "code">) {
    const seq: [KeyKind, string, number][] = [["key", "KeyH", 0], ["key", "KeyE", 95], ["key", "KeyL", 175], ["key", "KeyL", 255], ["key", "KeyO", 340], ["space", "Space", 450], ["key", "KeyT", 560], ["key", "KeyH", 640], ["key", "KeyE", 720], ["key", "KeyR", 800], ["key", "KeyE", 880], ["enter", "Enter", 1020]];
    const keys: Record<string, string> = { KeyH: "h", KeyE: "e", KeyL: "l", KeyO: "o", KeyT: "t", KeyR: "r", Space: " ", Enter: "Enter" };
    const run = () => { for (const [kind, code, at] of seq) setTimeout(() => playKey(packId, kind, { ...o, code, key: keys[code] }), at); };
    // Your own packs are decoded first, so the demo isn't silent the first time.
    if (isCustom(packId)) void prepare(audio(), packId).then(run); else run();
}

export function closeAudio() {
    void ctx?.close();
    ctx = null;
    noiseBuf = null;
    cache.clear();
}
