/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// "Discord's layout": some features find parts of Discord by the names of its
// styles (the member list, the chat box, the audio player…). Discord renames
// those now and then, and when it does those features quietly stop doing
// anything. This checks every name Sonata relies on still exists, and only
// reports the ones for features you actually use.
//
// It searches the stylesheets' text (downloaded files are already cached),
// and never walks their rules one by one: reading a stylesheet's rules makes
// Chromium create an object for every rule — tens of thousands for Discord —
// and keep them for as long as Discord is open.

import { doctor } from "../../sonata/doctorBridge";

export interface LayoutCheck {
    id: string;
    /** What stops working, in words. */
    what: string;
    /** Parts of Discord's style names that must exist. */
    names: string[];
    /** Whether you're using the thing that depends on it. */
    inUse(): boolean;
}

const featureOn = (key: string) => doctor()?.features().find(f => f.key === key)?.status === "active";
const sonata = (key: string) => !!doctor()?.store?.[key];

export const CHECKS: LayoutCheck[] = [
    { id: "perf-members", what: "Performance → Hide the member list in huge servers", names: ["membersWrap_"], inUse: () => Number(doctor()?.store?.perfBigServer) > 0 },
    { id: "perf-effects", what: "Performance → Hide profile effects", names: ["profileEffects_"], inUse: () => sonata("perfNoProfileEffects") },
    { id: "perf-deco", what: "Performance → Hide avatar decorations", names: ["avatarDecoration_"], inUse: () => sonata("perfNoDecorations") },
    { id: "perf-nameplates", what: "Performance → Hide animated nameplates", names: ["nameplated_"], inUse: () => sonata("perfNoNameplates") },
    { id: "perf-shadows", what: "Performance → Flatter look", names: ["popout_", "menu_"], inUse: () => sonata("perfNoShadows") },
    { id: "wave", what: "Audio Waveform Player (hiding Discord's own player)", names: ["wrapperAudio_"], inUse: () => featureOn("waveformPlayer") },
    { id: "sticky", what: "Sticky Message (finding the chat box)", names: ["chatContent", "channelTextArea"], inUse: () => featureOn("stickyMessage") },
    { id: "typing", what: "Typing Sounds (finding the chat box)", names: ["channelTextArea"], inUse: () => featureOn("typingSounds") },
    { id: "currency", what: "Currency Converter (hover to show)", names: ["message_"], inUse: () => featureOn("currencyConverter") },
    { id: "calltimer", what: "Call Timer (its place in the voice panel)", names: ["rtcConnectionStatus"], inUse: () => featureOn("callTimer") },
    { id: "spotify", what: "Spotify Controls (the seek bar's look)", names: ["barFill", "grabber"], inUse: () => featureOn("spotifyControls") },
    { id: "dock", what: "Sonata's dock (animated icons)", names: ["lottieIcon"], inUse: () => true },
    { id: "buttons", what: "Sonata's windows (Discord's buttons inside them)", names: ["lookFilled"], inUse: () => true },
];

export interface LayoutResult { check: LayoutCheck; missing: string[]; inUse: boolean; }

/** Which of the names exist, from the last check (null until it has run). */
let found: Set<string> | null = null;
let checking: Promise<void> | null = null;
const listeners = new Set<() => void>();
export const onLayoutChecked = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };

const ALL_NAMES = [...new Set(CHECKS.flatMap(c => c.names))];

/** Reads every stylesheet as text and notes which names appear. Nothing is kept but the result. */
export function runLayoutCheck(): Promise<void> {
    checking ??= (async () => {
        const hits = new Set<string>();
        const look = (text: string) => { for (const n of ALL_NAMES) if (!hits.has(n) && text.includes(`.${n}`)) hits.add(n); };
        for (const sheet of Array.from(document.styleSheets)) {
            const owner = sheet.ownerNode as HTMLElement | null;
            if (owner instanceof HTMLStyleElement) { look(owner.textContent ?? ""); continue; }
            if (!sheet.href) continue;
            try {
                // Already downloaded by Discord, so this comes straight from the cache.
                const res = await fetch(sheet.href, { cache: "force-cache" });
                if (res.ok) look(await res.text());
            } catch { }
            if (hits.size === ALL_NAMES.length) break;
        }
        // Names only used on the page, never in a stylesheet.
        for (const n of ALL_NAMES) if (!hits.has(n) && document.querySelector(`[class*="${n}"]`)) hits.add(n);
        found = hits;
        listeners.forEach(l => l());
    })().finally(() => { checking = null; });
    return checking;
}

export function checkLayout(): LayoutResult[] {
    // Until the first check has finished, nothing counts as missing.
    return CHECKS.map(check => ({ check, missing: found ? check.names.filter(n => !found!.has(n)) : [], inUse: check.inUse() }));
}

/** Only the ones that matter: broken, and for something you use. */
export const layoutProblems = () => checkLayout().filter(r => r.missing.length && r.inUse);
