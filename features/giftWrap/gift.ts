/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What's inside a gift, and how it travels: a little JSON packed into the
// message (it's a surprise, not a secret — anyone determined could unpack it).

import { DataStore } from "@api/index";

export interface Gift {
    /** Who it's from (display name). */
    f?: string;
    /** The tag's note, e.g. "For Sam 💖". */
    n?: string;
    /** What's inside: text, a link, or an image link. */
    c: string;
    /** Wrapping paper and ribbon. */
    p: string;
    r: string;
    /** Optional: can't be unwrapped before this time (Unix seconds). It's a wait, not a lock — the gift is in the message. */
    u?: number;
}

export const PAPERS: { id: string; name: string; }[] = [
    { id: "classic", name: "Classic red" },
    { id: "midnight", name: "Midnight stars" },
    { id: "mint", name: "Mint dots" },
    { id: "lilac", name: "Lilac" },
    { id: "gold", name: "Gold" },
    { id: "candy", name: "Candy stripes" },
];

export const RIBBONS: { id: string; name: string; color: string; }[] = [
    { id: "gold", name: "Gold", color: "#f5c542" },
    { id: "white", name: "White", color: "#f8fafc" },
    { id: "red", name: "Red", color: "#ef4444" },
    { id: "blue", name: "Blue", color: "#60a5fa" },
    { id: "pink", name: "Pink", color: "#f472b6" },
];

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)));

export const encodeGift = (g: Gift) => `sgw1.${b64(JSON.stringify(g))}`;

export const GIFT_RE = /\|\|sgw1\.([A-Za-z0-9_-]+)\|\|/;

export function decodeGift(code: string): Gift | null {
    try {
        const g = JSON.parse(unb64(code));
        return g && typeof g.c === "string" ? { ...g, u: typeof g.u === "number" && g.u > 0 ? g.u : undefined, p: PAPERS.some(p => p.id === g.p) ? g.p : "classic", r: RIBBONS.some(r => r.id === g.r) ? g.r : "gold" } : null;
    } catch {
        return null;
    }
}

export const IMAGE_RE = /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif)(?:\?\S*)?$/i;

// ─── Which gifts you've opened (so they stay open) ───

const KEY = "Sonata_gifts_opened";
let opened: Set<string> | null = null;

export async function loadOpened() {
    opened ??= new Set((await DataStore.get(KEY)) ?? []);
    return opened;
}

export function markOpened(messageId: string) {
    opened ??= new Set();
    opened.add(messageId);
    // Keep the list small.
    void DataStore.set(KEY, [...opened].slice(-500));
}
