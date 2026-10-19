/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What Scam Shield (and Roblox Tools' guard) caught, and the links you checked
// yourself — kept only on this computer, for the Scam Shield window.

import * as DataStore from "@api/DataStore";
import { ChannelStore, GuildStore, useEffect, UserStore, useState } from "@webpack/common";

import type { Level, Verdict } from "./scam";

export type LogType = "blocked" | "warned" | "checked";
export type Outcome = "safe" | "opened" | "trusted";

export interface LogEntry {
    id: string;
    at: number;
    type: LogType;
    url: string;
    host: string;
    level: Level;
    kind?: Verdict["kind"];
    brand?: string;
    reason: string;
    /** Clicks: what you chose in the popup. */
    outcome?: Outcome;
    /** Checks: where the link really led. */
    final?: string;
    where?: { channelId?: string; guildId?: string | null; messageId?: string; label?: string; };
    author?: { id: string; name: string; };
    source?: "shield" | "roblox";
}

const KEY = "Sonata_scamShieldLog";
const MAX = 600;
let log: LogEntry[] = [];
let loaded = false;
const listeners = new Set<() => void>();
export const logPrefs = { on: true, days: 90 };

async function load() {
    if (loaded) return;
    log = (await DataStore.get<LogEntry[]>(KEY).catch(() => undefined)) ?? [];
    loaded = true;
    prune();
}

function prune() {
    if (logPrefs.days > 0) {
        const cutoff = Date.now() - logPrefs.days * 86400_000;
        log = log.filter(e => e.at >= cutoff);
    }
    if (log.length > MAX) log = log.slice(0, MAX);
}

const save = () => { prune(); void DataStore.set(KEY, log); listeners.forEach(l => l()); };

/** Where a message was: "#trades · Roblox Traders", or "DMs with Sam". */
export function placeOf(channelId?: string) {
    const c: any = channelId ? ChannelStore.getChannel(channelId) : null;
    if (!c) return { label: "", guildId: null as string | null };
    if (c.guild_id) return { label: `#${c.name} · ${GuildStore.getGuild(c.guild_id)?.name ?? "a server"}`, guildId: c.guild_id as string };
    if (c.type === 1) { const u: any = UserStore.getUser(c.recipients?.[0]); return { label: `DMs with ${u?.globalName ?? u?.username ?? "someone"}`, guildId: null }; }
    return { label: c.name || "a group chat", guildId: null };
}

/** Adds an entry. Warnings under the same message for the same link are only kept once. */
export async function logEvent(e: Omit<LogEntry, "id" | "at">) {
    if (!logPrefs.on) return;
    await load();
    if (e.type === "warned" && e.where?.messageId && log.some(x => x.type === "warned" && x.where?.messageId === e.where!.messageId && x.url === e.url)) return;
    if (e.type === "checked" && log.some(x => x.type === "checked" && x.url === e.url && Date.now() - x.at < 10 * 60_000)) return;
    log = [{ ...e, id: Math.random().toString(36).slice(2, 10), at: Date.now() }, ...log];
    save();
}

export function verdictEntry(v: Verdict, type: LogType, extra: Partial<LogEntry> = {}): Omit<LogEntry, "id" | "at"> {
    return { type, url: v.url, host: v.host, level: v.level, kind: v.kind, brand: v.brand, reason: v.reasons[0] ?? "", ...extra };
}

export async function removeLog(id: string) { await load(); log = log.filter(e => e.id !== id); save(); }
export async function clearLog(types?: LogType[]) { await load(); log = types ? log.filter(e => !types.includes(e.type)) : []; save(); }

export function useLog() {
    const [, bump] = useState(0);
    useEffect(() => {
        const l = () => bump(n => n + 1);
        listeners.add(l);
        if (!loaded) void load().then(l);
        return () => void listeners.delete(l);
    }, []);
    return log;
}
