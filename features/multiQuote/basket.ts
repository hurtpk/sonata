/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The quote basket and the text it turns into. Free of Discord so it can be
// tested on its own.

export interface Quoted {
    id: string;
    channelId: string;
    guildId: string | null;
    authorName: string;
    /** "#general" / "DM" / group name. */
    where: string;
    content: string;
    attachments: number;
    /** ms since epoch */
    timestamp: number;
}

export const MAX_QUOTES = 10;
/** Leave headroom under Discord's 2000-character limit for your own reply. */
export const QUOTE_BUDGET = 1800;

let items: Quoted[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export const getQuotes = () => items;
export const hasQuote = (id: string) => items.some(i => i.id === id);
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Add (or remove, if already there). Returns false if the basket is full. */
export function toggleQuote(q: Quoted) {
    if (hasQuote(q.id)) { items = items.filter(i => i.id !== q.id); emit(); return true; }
    if (items.length >= MAX_QUOTES) return false;
    items = [...items, q];
    emit();
    return true;
}

export function removeQuote(id: string) { items = items.filter(i => i.id !== id); emit(); }
export function clearQuotes() { items = []; emit(); }

export function moveQuote(id: string, delta: -1 | 1) {
    const i = items.findIndex(x => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    items = next;
    emit();
}

export const jumpLink = (q: Pick<Quoted, "guildId" | "channelId" | "id">) =>
    `https://discord.com/channels/${q.guildId ?? "@me"}/${q.channelId}/${q.id}`;

function truncate(text: string, max: number) {
    if (text.length <= max) return text;
    return text.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

export interface FormatOptions { jumpLinks: boolean; timestamps: boolean; }

function header(q: Quoted, o: FormatOptions) {
    const parts = [`**${q.authorName.replace(/[*_~`|]/g, "")}**`, q.where];
    if (o.timestamps) parts.push(`<t:${Math.floor(q.timestamp / 1000)}:f>`);
    if (o.jumpLinks) parts.push(`[jump](<${jumpLink(q)}>)`);
    return `> ${parts.join(" · ")}`;
}

/**
 * Turn the basket into one block of quotes. Long messages are shortened
 * so the whole thing stays under QUOTE_BUDGET characters.
 */
export function formatQuotes(list: Quoted[], o: FormatOptions): string {
    if (!list.length) return "";
    const headers = list.map(q => header(q, o));
    const fixed = headers.reduce((n, h) => n + h.length + 1, 0) + list.length * 4;
    const perQuote = Math.max(40, Math.floor((QUOTE_BUDGET - fixed) / list.length));

    const blocks = list.map((q, i) => {
        const body = truncate(q.content.trim(), perQuote);
        const lines = body ? body.split("\n").map(l => `> ${l}`) : [];
        if (q.attachments) lines.push(`> 📎 ${q.attachments} attachment${q.attachments === 1 ? "" : "s"}`);
        return [headers[i], ...lines].join("\n");
    });
    let out = blocks.join("\n\n") + "\n";
    if (out.length > QUOTE_BUDGET) out = out.slice(0, QUOTE_BUDGET - 1) + "…\n";
    return out;
}
