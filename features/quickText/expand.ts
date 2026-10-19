/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Quick Text's snippets and how they expand. Kept on this computer.
// A snippet's text can hold:
//   {date} {time} {day} {me} {clipboard} {random:a|b|c}  — filled in by themselves
//   {anything else}                                      — a blank you fill in

import * as DataStore from "@api/DataStore";
import { useEffect, UserStore, useState } from "@webpack/common";

export interface Snippet { id: string; trigger: string; text: string; uses: number; }

const KEY = "Sonata_quickText";
let list: Snippet[] = [];
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const save = () => { void DataStore.set(KEY, list); listeners.forEach(l => l()); };

export const loadSnippets = () => loaded ??= DataStore.get<Snippet[]>(KEY).then(v => { list = v ?? []; listeners.forEach(l => l()); }).catch(() => { });
export const snippets = () => list;
export function useSnippets() {
    const [, bump] = useState(0);
    useEffect(() => { void loadSnippets(); const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    return list;
}
export function putSnippet(s: Snippet) { list = list.some(x => x.id === s.id) ? list.map(x => x.id === s.id ? s : x) : [s, ...list]; save(); }
export function removeSnippet(id: string) { list = list.filter(s => s.id !== id); save(); }
export function used(id: string) { list = list.map(s => s.id === id ? { ...s, uses: s.uses + 1 } : s); save(); }

export const TRIGGER = /^[a-z0-9][a-z0-9_-]{0,19}$/i;
export const VARIABLES: [string, string][] = [["{date}", "today's date"], ["{time}", "the time"], ["{day}", "the weekday"], ["{me}", "your name"], ["{clipboard}", "what you copied"], ["{random:yes|no|maybe}", "one at random"]];
const BUILT_IN = /^(date|time|day|me|clipboard|random:.+)$/i;

/** The blanks you fill in yourself ({name}, {place}…), in order, once each. */
export function blanksOf(text: string): string[] {
    const out: string[] = [];
    for (const m of text.matchAll(/\{([^{}\n]{1,40})\}/g)) if (!BUILT_IN.test(m[1]) && !out.includes(m[1])) out.push(m[1]);
    return out;
}

/** Fills in everything: the built-in variables, and your blanks from `values`. */
export async function fill(text: string, values: Record<string, string> = {}): Promise<string> {
    let clip: string | null = null;
    if (/\{clipboard\}/i.test(text)) { try { clip = await navigator.clipboard.readText(); } catch { clip = ""; } }
    const me: any = UserStore.getCurrentUser();
    const now = new Date();
    return text.replace(/\{([^{}\n]{1,40})\}/g, (whole, name: string) => {
        const k = name.toLowerCase();
        if (k === "date") return now.toLocaleDateString();
        if (k === "time") return now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        if (k === "day") return now.toLocaleDateString(undefined, { weekday: "long" });
        if (k === "me") return me?.globalName || me?.username || "";
        if (k === "clipboard") return clip ?? "";
        if (k.startsWith("random:")) { const opts = name.slice(7).split("|").map(s => s.trim()).filter(Boolean); return opts.length ? opts[Math.floor(Math.random() * opts.length)] : ""; }
        return name in values ? values[name] : whole;
    });
}

/** ;trigger words in a message that match a snippet. */
export function triggersIn(content: string): Snippet[] {
    const found: Snippet[] = [];
    for (const m of content.matchAll(/(^|\s);([a-z0-9][a-z0-9_-]{0,19})(?=$|[\s.,!?)])/gi)) {
        const s = list.find(x => x.trigger.toLowerCase() === m[2].toLowerCase());
        if (s && !found.includes(s)) found.push(s);
    }
    return found;
}

/** Puts each snippet's text in place of its ;trigger. */
export function replaceTriggers(content: string, texts: Map<string, string>) {
    return content.replace(/(^|\s);([a-z0-9][a-z0-9_-]{0,19})(?=$|[\s.,!?)])/gi, (whole, pre: string, word: string) => {
        const s = list.find(x => x.trigger.toLowerCase() === word.toLowerCase());
        return s && texts.has(s.id) ? pre + texts.get(s.id) : whole;
    });
}
