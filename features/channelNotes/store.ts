/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Channel Notes: your private notes on channels, DMs and servers. Only you
// see them; they're kept on this computer.

import * as DataStore from "@api/DataStore";
import { ChannelStore, GuildStore, useEffect, UserStore, useState } from "@webpack/common";

export interface Note { text: string; at: number; }

const KEY = "Sonata_channelNotes";
let notes: Record<string, Note> = {};
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const emit = () => listeners.forEach(l => l());

export const loadNotes = () => loaded ??= DataStore.get<Record<string, Note>>(KEY).then(v => { notes = v ?? {}; emit(); }).catch(() => { });

/** "c:<channel id>" for a channel or DM, "g:<server id>" for a whole server. */
export const channelKey = (id: string) => `c:${id}`;
export const guildKey = (id: string) => `g:${id}`;

export const noteOf = (key: string) => notes[key];
export const allNotes = () => Object.entries(notes).filter(([, n]) => n.text.trim()).sort((a, b) => b[1].at - a[1].at);

export function setNote(key: string, text: string) {
    if (text.trim()) notes = { ...notes, [key]: { text, at: Date.now() } };
    else { const { [key]: _, ...rest } = notes; notes = rest; }
    emit();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void DataStore.set(KEY, notes), 400);
}

export function useNotes() {
    const [, bump] = useState(0);
    useEffect(() => { void loadNotes(); const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    return notes;
}

/** "#general · My Server", "Sam", "Group with Sam, Alex", or the server's name. */
export function placeName(key: string): string {
    const id = key.slice(2);
    if (key.startsWith("g:")) return GuildStore.getGuild(id)?.name ?? "A server";
    const ch: any = ChannelStore.getChannel(id);
    if (!ch) return "A channel";
    if (ch.type === 1) { const u: any = UserStore.getUser(ch.recipients?.[0]); return u?.globalName || u?.username || "A DM"; }
    if (ch.type === 3) return ch.name || "Group DM";
    const g = GuildStore.getGuild(ch.guild_id);
    return `#${ch.name}${g ? ` · ${g.name}` : ""}`;
}
