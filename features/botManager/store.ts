/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Your bots — read from the same list Discord's Developer Portal shows you
// (names, pictures, IDs; never tokens, which Discord only shows on its own site) —
// plus which ones to watch, and how far you've got through the guide.
// Online check: a bot's status is known when it shares a server with you; when a
// watched bot goes offline (or comes back), you get a notification.

import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";
import { OptionType } from "@utils/types";
import { GuildMemberStore, GuildStore, PresenceStore, RestAPI, useEffect, useState } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";

export const settings = defineFeatureSettings("botManager", {
    notifyOffline: { type: OptionType.BOOLEAN, description: "Tell me when one of my bots goes offline", default: true },
    notifyBack: { type: OptionType.BOOLEAN, description: "…and when it's back online", default: true },
});

export interface Bot {
    appId: string;
    name: string;
    icon: string | null;
    description: string;
    botId: string | null;
    botName: string | null;
    avatar: string | null;
    isPublic: boolean;
    guilds: number | null;
    team: string | null;
    createdAt: number;
}

interface Saved { bots: Bot[]; loadedAt: number; unwatched: string[]; guideDone: number[]; }

const KEY = "Sonata_botManager";
let state: Saved = { bots: [], loadedAt: 0, unwatched: [], guideDone: [] };
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const save = () => void DataStore.set(KEY, state);

export const loadSaved = () => loaded ??= DataStore.get<Saved>(KEY).then(v => { if (v) state = { ...state, ...v }; emit(); }).catch(() => { });
export const bots = () => state.bots;
export const loadedAt = () => state.loadedAt;
export const isWatched = (botId: string) => !state.unwatched.includes(botId);
export const guideDone = () => state.guideDone;

export function useBotState() {
    const [, bump] = useState(0);
    useEffect(() => { void loadSaved(); const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    return state;
}

const createdAt = (id: string) => { try { return Number((BigInt(id) >> 22n) + 1420070400000n); } catch { return 0; } };

/** Your apps from Discord (yours and your teams'). Only what's needed is kept. */
export async function refreshBots(): Promise<{ ok: true; } | { ok: false; error: string; }> {
    try {
        const res: any = await RestAPI.get({ url: "/applications", query: { with_team_applications: true } });
        const list: any[] = Array.isArray(res?.body) ? res.body : [];
        state = {
            ...state,
            loadedAt: Date.now(),
            bots: list.map(a => ({
                appId: String(a.id),
                name: String(a.name ?? "Untitled app"),
                icon: a.icon ?? null,
                description: String(a.description ?? ""),
                botId: a.bot?.id ? String(a.bot.id) : null,
                botName: a.bot?.username ?? null,
                avatar: a.bot?.avatar ?? null,
                isPublic: !!a.bot_public,
                guilds: typeof a.approximate_guild_count === "number" ? a.approximate_guild_count : null,
                team: a.team?.name ?? null,
                createdAt: createdAt(String(a.id)),
            })).sort((x, y) => y.createdAt - x.createdAt),
        };
        emit(); save();
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.status === 401 || e?.status === 403 ? "Discord didn't let Sonata see your apps." : "Couldn't reach Discord — try again in a moment." };
    }
}

export function setWatched(botId: string, on: boolean) {
    state = { ...state, unwatched: on ? state.unwatched.filter(i => i !== botId) : [...new Set([...state.unwatched, botId])] };
    emit(); save();
}

export function setGuideStep(i: number, done: boolean) {
    state = { ...state, guideDone: done ? [...new Set([...state.guideDone, i])] : state.guideDone.filter(x => x !== i) };
    emit(); save();
}

export const portalUrl = (appId: string, page: "bot" | "oauth2" | "general" = "general") =>
    `https://discord.com/developers/applications/${appId}/${page === "general" ? "information" : page}`;

export function botPicture(b: Bot, size = 64) {
    if (b.botId && b.avatar) return `https://cdn.discordapp.com/avatars/${b.botId}/${b.avatar}.png?size=${size}`;
    if (b.icon) return `https://cdn.discordapp.com/app-icons/${b.appId}/${b.icon}.png?size=${size}`;
    return null;
}

/* ── Online check ── */

export type Status = "online" | "idle" | "dnd" | "offline" | "unknown";

/** Servers you're in that this bot is also in (as far as Discord has told the app). */
export function sharedServers(botId: string) {
    const guilds = Object.values(GuildStore.getGuilds?.() ?? {}) as any[];
    return guilds.filter(g => { try { return GuildMemberStore.isMember(g.id, botId); } catch { return false; } });
}

export function statusOf(botId: string | null): Status {
    if (!botId) return "unknown";
    // Discord only sends a bot's status to people who share a server with it.
    if (!sharedServers(botId).length) return "unknown";
    const s = PresenceStore.getStatus(botId) as Status;
    return s === "online" || s === "idle" || s === "dnd" ? s : "offline";
}

const last = new Map<string, Status>();
let timer: ReturnType<typeof setInterval> | null = null;

function check() {
    for (const b of state.bots) {
        if (!b.botId || !isWatched(b.botId)) continue;
        const now = statusOf(b.botId);
        const before = last.get(b.botId);
        last.set(b.botId, now);
        // The first look only records; unknown never counts as a change.
        if (!before || before === "unknown" || now === "unknown") continue;
        const wasOn = before !== "offline", isOn = now !== "offline";
        const icon = botPicture(b, 128) ?? undefined;
        if (wasOn && !isOn && settings.store.notifyOffline)
            showNotification({ title: `${b.botName ?? b.name} went offline`, body: "Its program stopped, or lost its connection. Open Bot Manager to see what to check.", icon });
        if (!wasOn && isOn && settings.store.notifyBack)
            showNotification({ title: `${b.botName ?? b.name} is back online`, body: "It's running again.", icon });
    }
}

export function startWatching() {
    stopWatching();
    void loadSaved().then(() => {
        check();
        timer = setInterval(check, 30_000);
        // Picks up renamed bots, new bots and new pictures once a day.
        if (Date.now() - state.loadedAt > 24 * 3600_000) void refreshBots();
    });
}

export function stopWatching() {
    if (timer) clearInterval(timer);
    timer = null;
    last.clear();
}
