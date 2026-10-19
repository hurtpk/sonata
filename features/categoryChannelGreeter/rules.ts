/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Greeters ("rules"), the greetings' text, what's being watched and what was sent.

import { DataStore } from "@api/index";
import { ChannelStore, GuildStore, UserStore } from "@webpack/common";

export type Trigger = "user" | "anyone" | "nobody";

export interface Rule {
    id: string;
    name: string;
    on: boolean;
    guildId: string;
    categoryId: string;
    /** Wait for this member's message, anyone's, or don't wait at all. */
    trigger: Trigger;
    triggerUserId: string;
    /** Only when their message contains this (blank = any message). */
    keyword: string;
    delaySec: number;
    messages: string[];
    order: "random" | "sequence";
    /** The next message, for "in order". */
    next: number;
}

export const newRule = (n: number): Rule => ({
    id: Math.random().toString(36).slice(2, 10),
    name: `Greeter ${n}`,
    on: true,
    guildId: "",
    categoryId: "",
    trigger: "user",
    triggerUserId: "",
    keyword: "",
    delaySec: 0,
    messages: ["Welcome to the new channel!"],
    order: "random",
    next: 0,
});

export function parseRules(json: string): Rule[] {
    try {
        const v = JSON.parse(json || "[]");
        return Array.isArray(v) ? v.filter(r => r && typeof r.id === "string").map(r => ({ ...newRule(1), ...r })) : [];
    } catch {
        return [];
    }
}

/** The things you can put in a greeting. */
export const VARIABLES: { key: string; label: string; }[] = [
    { key: "{user}", label: "mentions who they waited for" },
    { key: "{username}", label: "their name" },
    { key: "{channel}", label: "links the channel" },
    { key: "{channelname}", label: "the channel's name" },
    { key: "{server}", label: "the server's name" },
    { key: "{me}", label: "your name" },
    { key: "{time}", label: "the time now" },
];

export interface Context { channelId: string; userId?: string; }

export function fillIn(text: string, ctx: Context) {
    const channel: any = ChannelStore.getChannel(ctx.channelId);
    const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
    const who: any = ctx.userId ? UserStore.getUser(ctx.userId) : null;
    const me: any = UserStore.getCurrentUser();
    const values: Record<string, string> = {
        "{user}": ctx.userId ? `<@${ctx.userId}>` : "",
        "{username}": who?.globalName || who?.username || "",
        "{channel}": `<#${ctx.channelId}>`,
        "{channelname}": channel?.name ?? "",
        "{server}": guild?.name ?? "",
        "{me}": me?.globalName || me?.username || "",
        "{time}": new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    };
    return text.replace(/\{(user|username|channel|channelname|server|me|time)\}/g, m => values[m] ?? m).trim();
}

/** What a greeting looks like, with example values (for the preview). */
export function previewOf(text: string, rule: Rule) {
    const guild = rule.guildId ? GuildStore.getGuild(rule.guildId) : null;
    const who: any = rule.triggerUserId ? UserStore.getUser(rule.triggerUserId) : null;
    const me: any = UserStore.getCurrentUser();
    const name = who?.globalName || who?.username || "Ticket Bot";
    return text
        .replaceAll("{user}", `@${name}`)
        .replaceAll("{username}", name)
        .replaceAll("{channel}", "#ticket-0042")
        .replaceAll("{channelname}", "ticket-0042")
        .replaceAll("{server}", guild?.name ?? "Your Server")
        .replaceAll("{me}", me?.globalName || me?.username || "you")
        .replaceAll("{time}", new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
}

// ─── What's being watched, and what was sent ───

export interface Watch { channelId: string; ruleId: string; since: number; until: number; }
export interface Sent { t: number; ruleName: string; guildId?: string; channelId: string; channelName: string; text: string; }

const LOG_KEY = "Sonata_greeter_log";
export const watching = new Map<string, Watch & { timer: ReturnType<typeof setTimeout>; }>();
export let sentLog: Sent[] = [];

const listeners = new Set<() => void>();
export const onGreeterChange = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };
export const changed = () => listeners.forEach(l => l());

export async function loadLog() {
    sentLog = (await DataStore.get(LOG_KEY)) ?? [];
    changed();
}

export function logSent(entry: Sent) {
    sentLog = [entry, ...sentLog].slice(0, 40);
    void DataStore.set(LOG_KEY, sentLog);
    changed();
}

export function clearLog() {
    sentLog = [];
    void DataStore.set(LOG_KEY, sentLog);
    changed();
}
