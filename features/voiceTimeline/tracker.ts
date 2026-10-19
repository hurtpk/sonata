/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Tracks the voice channel you're in: who joins, leaves or moves away, and
// when. People already there when you join are recorded as "here before
// you" (Discord doesn't say when they joined). Kept in memory only: the
// current session plus your last 10 (recapStore.ts saves just the totals).

import { useEffect, useState } from "@webpack/common";

import { recordSession } from "./recapStore";

export type EventType = "you-joined" | "you-left" | "join" | "leave" | "moved";

export interface VtEvent {
    t: number;
    userId: string;
    type: EventType;
    /** For "moved": the channel they went to. */
    to?: string | null;
}

export interface Presence {
    userId: string;
    /** null = was already there when you joined. */
    joinedAt: number | null;
}

export interface Stay extends Presence {
    leftAt: number;
}

export interface Session {
    id: number;
    channelId: string;
    startedAt: number;
    endedAt: number | null;
    /** True when tracking began mid-call (plugin started while you were in it). */
    joinedMidway: boolean;
    present: Map<string, Presence>;
    stays: Stay[];
    events: VtEvent[];
}

export interface VoiceStateLike {
    userId: string;
    channelId?: string | null;
}

const MAX_PAST = 10;
const MAX_EVENTS = 500;

let current: Session | null = null;
let past: Session[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export const getCurrent = () => current;
export const getPast = () => past;

function pushEvent(s: Session, e: VtEvent) {
    s.events.push(e);
    if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
}

/** Start tracking `channelId`. `occupants` are the user IDs already in it (excluding you). */
export function startSession(channelId: string, me: string, occupants: string[], now = Date.now(), midway = false) {
    current = {
        id: nextId++,
        channelId,
        startedAt: now,
        endedAt: null,
        joinedMidway: midway,
        present: new Map(occupants.filter(u => u !== me).map(u => [u, { userId: u, joinedAt: null }])),
        stays: [],
        events: [{ t: now, userId: me, type: "you-joined" }],
    };
    emit();
}

export function endSession(me: string, now = Date.now()) {
    if (!current) return;
    pushEvent(current, { t: now, userId: me, type: "you-left" });
    current.endedAt = now;
    // Its totals go into the weekly recap (saved); the call itself stays in memory only.
    void recordSession(current, now);
    past = [current, ...past].slice(0, MAX_PAST);
    current = null;
    emit();
}

/**
 * Apply a batch of voice state updates. `occupantsOf` returns who's in a
 * channel right now (used when you join one).
 */
export function handleVoiceStates(states: VoiceStateLike[], me: string, occupantsOf: (channelId: string) => string[], now = Date.now()) {
    let changed = false;
    for (const s of states) {
        const channelId = s.channelId ?? null;

        if (s.userId === me) {
            if ((current?.channelId ?? null) === channelId) continue;
            if (current) endSession(me, now);
            if (channelId) startSession(channelId, me, occupantsOf(channelId), now);
            changed = true;
            continue;
        }

        if (!current) continue;
        const here = channelId === current.channelId;
        const was = current.present.get(s.userId);

        if (here && !was) {
            current.present.set(s.userId, { userId: s.userId, joinedAt: now });
            pushEvent(current, { t: now, userId: s.userId, type: "join" });
            changed = true;
        } else if (!here && was) {
            current.present.delete(s.userId);
            current.stays.push({ ...was, leftAt: now });
            pushEvent(current, { t: now, userId: s.userId, type: channelId ? "moved" : "leave", to: channelId });
            changed = true;
        }
    }
    if (changed) emit();
}

export function reset() {
    current = null;
    past = [];
    emit();
}

/** Re-render when sessions change. */
export function useTimeline() {
    const [, force] = useState(0);
    useEffect(() => {
        const l = () => force(n => n + 1);
        listeners.add(l);
        return () => { listeners.delete(l); };
    }, []);
}
