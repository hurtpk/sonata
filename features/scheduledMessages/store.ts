/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The queue of scheduled messages, saved in Equicord's DataStore (IndexedDB)
// so it survives restarts. Everything that changes the queue goes through
// here, and UI subscribes with useQueue().

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

export type Repeat = "none" | "daily" | "weekly";
export type Status = "pending" | "sent" | "failed" | "missed";

export interface ScheduledMessage {
    id: string;
    channelId: string;
    content: string;
    /** When it should send (ms since epoch). */
    sendAt: number;
    createdAt: number;
    repeat: Repeat;
    status: Status;
    /** When it was actually sent (history entries). */
    sentAt?: number;
    error?: string;
}

const KEY = "ScheduledMessages_queue";
/** History (sent / failed / missed) kept, newest first. */
const HISTORY_LIMIT = 50;

let items: ScheduledMessage[] = [];
let loaded = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach(l => l());
const persist = () => DataStore.set(KEY, items).catch(() => { });

export async function loadQueue() {
    const saved = await DataStore.get<ScheduledMessage[]>(KEY).catch(() => undefined);
    items = Array.isArray(saved) ? saved : [];
    loaded = true;
    emit();
}

export const getItems = () => items;
export const isLoaded = () => loaded;

export const pending = () => items.filter(i => i.status === "pending").sort((a, b) => a.sendAt - b.sendAt);
export const missed = () => items.filter(i => i.status === "missed").sort((a, b) => a.sendAt - b.sendAt);
/** Sent / failed entries, newest first (ties broken by the order they were added). */
function sortedHistory(list: ScheduledMessage[]) {
    return list
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.status === "sent" || item.status === "failed")
        .sort((a, b) => ((b.item.sentAt ?? b.item.sendAt) - (a.item.sentAt ?? a.item.sendAt)) || (b.index - a.index))
        .map(({ item }) => item);
}

export const history = () => sortedHistory(items);

function commit(next: ScheduledMessage[]) {
    // Trim old history so the store can't grow forever.
    const hist = sortedHistory(next);
    const drop = new Set(hist.slice(HISTORY_LIMIT).map(i => i.id));
    items = next.filter(i => !drop.has(i.id));
    persist();
    emit();
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function addItem(data: Pick<ScheduledMessage, "channelId" | "content" | "sendAt" | "repeat">) {
    const item: ScheduledMessage = { ...data, id: newId(), createdAt: Date.now(), status: "pending" };
    commit([...items, item]);
    return item;
}

export function updateItem(id: string, patch: Partial<ScheduledMessage>) {
    commit(items.map(i => i.id === id ? { ...i, ...patch } : i));
}

export function removeItem(id: string) {
    commit(items.filter(i => i.id !== id));
}

export function clearHistory() {
    commit(items.filter(i => i.status === "pending" || i.status === "missed"));
}

/** Record a finished send as a separate history entry (repeats stay queued). */
export function recordHistory(source: ScheduledMessage, status: "sent" | "failed", error?: string) {
    const entry: ScheduledMessage = { ...source, id: newId(), status, sentAt: Date.now(), error, repeat: "none" };
    commit([...items, entry]);
}

const DAY = 24 * 60 * 60 * 1000;
export function repeatStep(repeat: Repeat) {
    return repeat === "daily" ? DAY : repeat === "weekly" ? 7 * DAY : 0;
}

/** Next occurrence of a repeating message that's after `after`. */
export function nextOccurrence(sendAt: number, repeat: Repeat, after = Date.now()) {
    const step = repeatStep(repeat);
    if (!step) return sendAt;
    let t = sendAt;
    while (t <= after) t += step;
    return t;
}

/** Re-render when the queue changes. */
export function useQueue() {
    const [, force] = useState(0);
    useEffect(() => {
        const l = () => force(n => n + 1);
        listeners.add(l);
        return () => { listeners.delete(l); };
    }, []);
    return items;
}
