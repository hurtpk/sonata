/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Who else uses Sonata, as far as this client knows: people with Sonata's
// invisible marker in their About Me (only there if they switched it on), and
// people who've sent something only Sonata can make (a game, a gift,
// chat, a shared setup). Kept on this computer.

import { DataStore } from "@api/index";

const KEY = "Sonata_known_users_v1";
interface Known { yes: boolean; at: number; via: "profile" | "message"; }

let known: Record<string, Known> = {};
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
let version = 0;

export const onSonataUsersChange = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };
export const sonataUsersVersion = () => version;

function changed() {
    version++;
    listeners.forEach(l => l());
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void DataStore.set(KEY, known), 2000);
}

export async function loadSonataUsers() {
    if (loaded) return;
    loaded = true;
    known = { ...(await DataStore.get(KEY)) ?? {}, ...known };
    version++;
    listeners.forEach(l => l());
}

export const usesSonata = (userId: string) => !!known[userId]?.yes;

/** From their profile: the marker is either there or not. */
export function noteProfile(userId: string, hasMarker: boolean) {
    const cur = known[userId];
    // A Sonata-only message is stronger proof than a profile without the marker.
    if (!hasMarker && cur?.yes && cur.via === "message") return;
    if (cur?.yes === hasMarker && cur.via === "profile" && Date.now() - cur.at < 60_000) return;
    known[userId] = { yes: hasMarker, at: Date.now(), via: "profile" };
    changed();
}

/** They sent something only Sonata makes. */
export function noteSonataMessage(userId: string) {
    if (known[userId]?.yes) return;
    known[userId] = { yes: true, at: Date.now(), via: "message" };
    changed();
}

// ─── The invisible marker ───
// Unicode "tag" characters (U+E0020–U+E007E) mirror plain ASCII but are
// invisible; "sonata1" written in them is Sonata's marker.

const MARKER_TEXT = "sonata1";
export const MARKER = [...MARKER_TEXT].map(c => String.fromCodePoint(0xE0000 + c.charCodeAt(0))).join("");

export const hasMarker = (bio: string | undefined | null) => !!bio && bio.includes(MARKER);
export const withoutMarker = (bio: string) => bio.split(MARKER).join("");
