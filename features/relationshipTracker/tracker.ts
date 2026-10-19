/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The relationship log and the rules for reading Discord's events.
//
// Who did it:
//   - Removals / declines / cancels: actions you take in this app are marked
//     through hooks on Discord's own remove / leave / close actions (see
//     index.tsx). If the hook didn't fire, it wasn't done from here — so
//     "them" really means "not from this Discord app" (you on your phone
//     looks the same).
//   - New friendships: if THEIR request was pending, you accepted; if YOUR
//     request was pending, they accepted. Read from the previous state.
//   - Changes found at startup (Discord was closed) can't be attributed.

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

export const enum Rel { NONE = 0, FRIEND = 1, BLOCKED = 2, INCOMING = 3, OUTGOING = 4 }

export type Kind =
    | "friend-added" | "friend-removed"
    | "request-received" | "request-sent" | "request-cancelled" | "request-declined"
    | "group-removed" | "group-left" | "group-member-removed" | "group-member-left"
    | "server-removed" | "server-left";

export type By = "you" | "them" | "unknown";

export interface UserSnap { id: string; username: string; globalName?: string | null; avatar?: string | null; }
export interface PlaceSnap { id: string; name: string; iconURL?: string | null; }

export interface LogEntry {
    id: string;
    t: number;
    kind: Kind;
    by: By;
    /** Found at startup — happened while Discord was closed. */
    offline?: boolean;
    /** Friend removal that happened by you blocking them. */
    blocked?: boolean;
    /** For requests: whose request it was. */
    direction?: "incoming" | "outgoing";
    user?: UserSnap;
    /** Group chats: who removed the user. */
    actor?: UserSnap;
    group?: PlaceSnap;
    server?: PlaceSnap;
    /** Friend removals: when you'd become friends, and when you last talked in DMs. */
    friendsSince?: number;
    lastTalked?: number;
}

const LOG_LIMIT = 2000;

// ─── "Was this you?" markers ───

const manual = new Map<string, number>();
const MANUAL_TTL = 15_000;

/** Called from the hooks on Discord's own remove / leave / close actions. */
export function markManual(id: string) {
    manual.set(id, Date.now());
}

export function consumeManual(id: string) {
    const at = manual.get(id);
    manual.delete(id);
    return at != null && Date.now() - at < MANUAL_TTL;
}

// ─── Relationship snapshot (previous state of everyone) ───

export const known = new Map<string, number>();

export function seedRelationships(entries: Iterable<[string, number]>) {
    known.clear();
    for (const [id, type] of entries) known.set(id, type);
}

let seq = 0;
const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** A relationship appeared or changed type. */
export function relationshipAdded(userId: string, type: number, user: UserSnap | undefined, now = Date.now()): LogEntry | null {
    const prev = known.get(userId) ?? Rel.NONE;
    known.set(userId, type);
    if (prev === type) return null;
    const base = { id: newId(), t: now, user: user ?? { id: userId, username: "unknown" } };

    switch (type) {
        case Rel.FRIEND:
            return {
                ...base, kind: "friend-added",
                by: prev === Rel.INCOMING ? "you" : prev === Rel.OUTGOING ? "them" : "unknown",
            };
        case Rel.INCOMING:
            return { ...base, kind: "request-received", by: "them", direction: "incoming" };
        case Rel.OUTGOING:
            return { ...base, kind: "request-sent", by: "you", direction: "outgoing" };
        case Rel.BLOCKED:
            // Blocking a friend ends the friendship — that's you unadding them.
            return prev === Rel.FRIEND ? { ...base, kind: "friend-removed", by: "you", blocked: true } : null;
    }
    return null;
}

/** A relationship went away. `typeFromEvent` is what it was before. */
export function relationshipRemoved(userId: string, typeFromEvent: number | undefined, user: UserSnap | undefined, wasYou: boolean, now = Date.now()): LogEntry | null {
    const prev = typeFromEvent ?? known.get(userId) ?? Rel.NONE;
    known.delete(userId);
    const base = { id: newId(), t: now, user: user ?? { id: userId, username: "unknown" } };

    switch (prev) {
        case Rel.FRIEND:
            return { ...base, kind: "friend-removed", by: wasYou ? "you" : "them" };
        case Rel.INCOMING:
            // Their request disappeared: you declined/ignored it, or they withdrew it.
            return wasYou
                ? { ...base, kind: "request-declined", by: "you", direction: "incoming" }
                : { ...base, kind: "request-cancelled", by: "them", direction: "incoming" };
        case Rel.OUTGOING:
            // Your request disappeared: you cancelled it, or they declined it.
            return wasYou
                ? { ...base, kind: "request-cancelled", by: "you", direction: "outgoing" }
                : { ...base, kind: "request-declined", by: "them", direction: "outgoing" };
    }
    return null;
}

/**
 * Compare the saved state from last time with now (Discord was closed in
 * between). Who did any of it can't be known, so it's logged as unknown.
 * `users` resolves a user snapshot for an ID.
 */
export function offlineRelationshipChanges(before: Map<string, number>, after: Map<string, number>, users: (id: string) => UserSnap, now = Date.now()): LogEntry[] {
    const out: LogEntry[] = [];
    const ids = new Set([...before.keys(), ...after.keys()]);
    for (const id of ids) {
        const was = before.get(id) ?? Rel.NONE;
        const is = after.get(id) ?? Rel.NONE;
        if (was === is) continue;
        const base = { id: newId(), t: now, offline: true, user: users(id) };

        if (is === Rel.FRIEND) {
            // Only you can accept their request (from any device); only they can accept yours.
            out.push({ ...base, kind: "friend-added", by: was === Rel.OUTGOING ? "them" : was === Rel.INCOMING ? "you" : "unknown" });
        } else if (was === Rel.FRIEND) {
            out.push({ ...base, kind: "friend-removed", by: is === Rel.BLOCKED ? "you" : "unknown", blocked: is === Rel.BLOCKED || undefined });
        } else if (is === Rel.INCOMING) {
            out.push({ ...base, kind: "request-received", by: "them", direction: "incoming" });
        } else if (is === Rel.OUTGOING) {
            out.push({ ...base, kind: "request-sent", by: "you", direction: "outgoing" });
        } else if (was === Rel.INCOMING) {
            out.push({ ...base, kind: "request-cancelled", by: "unknown", direction: "incoming" });
        } else if (was === Rel.OUTGOING) {
            out.push({ ...base, kind: "request-declined", by: "unknown", direction: "outgoing" });
        }
    }
    return out;
}

/** Groups / servers you were in last time but aren't now. */
export function offlinePlaceChanges<T extends PlaceSnap>(before: Map<string, T> | undefined, nowIds: Set<string>, kind: "group-removed" | "server-removed", now = Date.now()): LogEntry[] {
    if (!before) return [];
    const out: LogEntry[] = [];
    for (const [id, place] of before) {
        if (nowIds.has(id)) continue;
        out.push({ id: newId(), t: now, offline: true, kind, by: "unknown", ...(kind === "group-removed" ? { group: place } : { server: place }) });
    }
    return out;
}

export function groupMemberChange(group: PlaceSnap, target: UserSnap, actor: UserSnap | undefined, now = Date.now()): LogEntry {
    const left = !actor || actor.id === target.id;
    return { id: newId(), t: now, kind: left ? "group-member-left" : "group-member-removed", by: left ? "them" : "unknown", group, user: target, actor: left ? undefined : actor };
}

export function placeGone(kind: "group" | "server", place: PlaceSnap, wasYou: boolean, now = Date.now()): LogEntry {
    if (kind === "group") return { id: newId(), t: now, kind: wasYou ? "group-left" : "group-removed", by: wasYou ? "you" : "unknown", group: place };
    return { id: newId(), t: now, kind: wasYou ? "server-left" : "server-removed", by: wasYou ? "you" : "unknown", server: place };
}

// ─── The log ───

let log: LogEntry[] = [];
let logKey: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export async function loadLog(key: string) {
    logKey = key;
    const saved = await DataStore.get<LogEntry[]>(key).catch(() => undefined);
    log = Array.isArray(saved) ? saved : [];
    emit();
}

export function addEntries(entries: (LogEntry | null | undefined)[]) {
    const real = entries.filter(Boolean) as LogEntry[];
    if (!real.length) return;
    log = [...real.reverse(), ...log].slice(0, LOG_LIMIT);
    if (logKey) DataStore.set(logKey, log).catch(() => { });
    emit();
}

export const getLog = () => log;

export function clearLog() {
    log = [];
    if (logKey) DataStore.set(logKey, log).catch(() => { });
    emit();
}

export function useLog() {
    const [, force] = useState(0);
    useEffect(() => {
        const l = () => force(n => n + 1);
        listeners.add(l);
        return () => { listeners.delete(l); };
    }, []);
    return log;
}
