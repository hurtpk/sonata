/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Learning your typos: when you fix a word — by editing the message, or by
// sending "*word" right after — the pair is counted. Fix the same one a few
// times and Auto-Correct offers to fix it for you. No Discord in here.

/** How many letters you'd change to turn one word into the other. */
function distance(a: string, b: string) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        // Two letters swapped (teh → the) counts as one slip.
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[a.length][b.length];
}

const NOT_WRITING = /```[\s\S]*?(?:```|$)|`[^`\n]*`|<[^>\s]+>|https?:\/\/\S+|:[a-z0-9_+-]{2,}:|@\w+/gi;
const words = (text: string) => text.replace(NOT_WRITING, " ").match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? [];

/** Is this a fix of a slip, not a different word? (teh → the yes; cat → dog no) */
export function looksLikeFix(wrong: string, right: string) {
    const a = wrong.toLowerCase(), b = right.toLowerCase();
    if (a === b || a.length < 3 || b.length < 3) return false;
    // cat → cats is changing your mind, not fixing a slip.
    if (a + "s" === b || b + "s" === a) return false;
    const d = distance(a, b);
    return d === 1 || (d === 2 && Math.min(a.length, b.length) >= 6 && a[0] === b[0]);
}

/** The words you fixed between what a message said and what you edited it to. */
export function fixesInEdit(before: string, after: string): [string, string][] {
    const a = words(before), b = words(after);
    if (!a.length || a.length !== b.length) return [];
    const pairs: [string, string][] = [];
    for (let i = 0; i < a.length; i++) if (a[i].toLowerCase() !== b[i].toLowerCase()) pairs.push([a[i], b[i]]);
    // A couple of words changed is fixing typos; more is rewriting.
    if (!pairs.length || pairs.length > 2) return [];
    return pairs.filter(([w, r]) => looksLikeFix(w, r)).map(([w, r]) => [w.toLowerCase(), r]);
}

/** "*word" or "word*" sent right after a message with a near miss of it. */
export function starFix(previous: string, text: string): [string, string] | null {
    const m = text.trim().match(/^\*([A-Za-z]+(?:'[A-Za-z]+)?)$|^([A-Za-z]+(?:'[A-Za-z]+)?)\*$/);
    if (!m || !previous) return null;
    const right = m[1] ?? m[2];
    const near = words(previous).filter(w => looksLikeFix(w, right)).sort((x, y) => distance(x.toLowerCase(), right.toLowerCase()) - distance(y.toLowerCase(), right.toLowerCase()));
    return near.length ? [near[0].toLowerCase(), right] : null;
}

export interface Learned {
    /** wrong → what you fixed it to, and how many times. */
    seen: Record<string, { right: string; n: number; }>;
    /** Words you said aren't typos. */
    ignored: string[];
}

export function readLearned(raw: string | undefined): Learned {
    try {
        const j = JSON.parse(raw || "{}");
        return { seen: j.seen && typeof j.seen === "object" ? j.seen : {}, ignored: Array.isArray(j.ignored) ? j.ignored : [] };
    } catch { return { seen: {}, ignored: [] }; }
}

/** Counts a fix; returns the new count (a fix to something else starts over). */
export function count(l: Learned, wrong: string, right: string): number {
    if (l.ignored.includes(wrong)) return 0;
    const prev = l.seen[wrong];
    l.seen[wrong] = prev && prev.right.toLowerCase() === right.toLowerCase() ? { right, n: prev.n + 1 } : { right, n: 1 };
    return l.seen[wrong].n;
}
