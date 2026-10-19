/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// To-do Lists: a checklist for each channel or DM, saved on this computer.

import { DataStore } from "@api/index";

export interface Item {
    id: string;
    text: string;
    done: boolean;
    created: number;
    doneAt?: number;
    /** The message it came from, if it was added from one. */
    link?: { messageId: string; author?: string; };
}

export interface List { channelId: string; items: Item[]; }

const KEY = "Sonata_todo_lists";
let lists: Record<string, List> = {};
let loaded = false;
const listeners = new Set<() => void>();
const changed = () => {
    // Empty lists aren't worth keeping.
    for (const [id, l] of Object.entries(lists)) if (!l.items.length) delete lists[id];
    lists = { ...lists };
    listeners.forEach(l => l());
    void DataStore.set(KEY, lists);
};

export const onTodoChange = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };
export const getLists = () => lists;
export const getList = (channelId: string): List => lists[channelId] ?? { channelId, items: [] };
export const openCount = (channelId: string | null | undefined) => channelId ? (lists[channelId]?.items.filter(i => !i.done).length ?? 0) : 0;

export async function loadTodos() {
    if (loaded) return;
    lists = (await DataStore.get<Record<string, List>>(KEY).catch(() => undefined)) ?? {};
    loaded = true;
    listeners.forEach(l => l());
}

const newId = () => Math.random().toString(36).slice(2, 10);

function edit(channelId: string, fn: (items: Item[]) => Item[]) {
    const l = getList(channelId);
    lists[channelId] = { channelId, items: fn([...l.items]) };
    changed();
}

export function addItem(channelId: string, text: string, link?: Item["link"]) {
    const t = text.trim();
    if (!t) return;
    edit(channelId, items => [...items, { id: newId(), text: t.slice(0, 500), done: false, created: Date.now(), link }]);
}

/** Several at once — one per line, so a pasted list becomes separate items. */
export function addLines(channelId: string, text: string) {
    const lines = text.split(/\r?\n/).map(l => l.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ x]\])\s*/i, "").trim()).filter(Boolean);
    edit(channelId, items => [...items, ...lines.map(t => ({ id: newId(), text: t.slice(0, 500), done: false, created: Date.now() }))]);
}

export function toggleItem(channelId: string, id: string) {
    edit(channelId, items => items.map(i => i.id === id ? { ...i, done: !i.done, doneAt: i.done ? undefined : Date.now() } : i));
}

export function renameItem(channelId: string, id: string, text: string) {
    const t = text.trim();
    if (!t) return removeItem(channelId, id);
    edit(channelId, items => items.map(i => i.id === id ? { ...i, text: t.slice(0, 500) } : i));
}

export function removeItem(channelId: string, id: string) {
    edit(channelId, items => items.filter(i => i.id !== id));
}

export function moveItem(channelId: string, id: string, toIndex: number) {
    edit(channelId, items => {
        const from = items.findIndex(i => i.id === id);
        if (from < 0) return items;
        const [it] = items.splice(from, 1);
        items.splice(Math.max(0, Math.min(items.length, toIndex)), 0, it);
        return items;
    });
}

export const clearDone = (channelId: string) => edit(channelId, items => items.filter(i => !i.done));
export const clearAll = (channelId: string) => edit(channelId, () => []);

/** The list as text for a message: ☐ / ☑ per item. */
export const asText = (l: List, title: string) => [`**${title}**`, ...l.items.map(i => `${i.done ? "☑" : "☐"} ${i.done ? `~~${i.text}~~` : i.text}`)].join("\n");
