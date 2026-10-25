/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Everything the calendar shows, gathered for a span of time.

import { ChannelStore, GuildScheduledEventStore, GuildStore, UserStore } from "@webpack/common";

import { dateInYear } from "../birthdayReminders/dates";
import { allBirthdays } from "../birthdayReminders/store";
import { calendarParcels } from "../packageTracker/store";
import { getItems, repeatStep } from "../scheduledMessages/store";
import { episodeLabel, followed } from "../showTracker/store";
import { getImports, occurrences } from "./ics";
import { CalendarItem, repeatsBetween } from "./month";
import { getReminders } from "./reminders";

export interface SourceOptions {
    birthdays: boolean;
    scheduled: boolean;
    events: boolean;
    reminders: boolean;
    /** Calendars you imported (.ics files and links). */
    imported: boolean;
    /** Parcels from Package Tracker you've put on the calendar. */
    packages?: boolean;
    /** The next episode of each show you follow in Show Tracker. */
    episodes?: boolean;
    /** Weather's forecast on each day (not an item: drawn on the day itself). */
    weather?: boolean;
    /** Only server events you've marked yourself interested in. */
    interestedOnly: boolean;
}

/** Where a scheduled message goes, the way you'd say it. */
function whereOf(channelId: string) {
    const ch = ChannelStore.getChannel(channelId) as any;
    if (!ch) return "a chat";
    if (ch.isDM?.()) return `DM with ${UserStore.getUser(ch.recipients?.[0])?.username ?? "someone"}`;
    if (ch.isGroupDM?.()) return ch.name || "group DM";
    const guild = ch.guild_id ? GuildStore.getGuild(ch.guild_id)?.name : null;
    return guild ? `#${ch.name} · ${guild}` : `#${ch.name}`;
}

function birthdays(from: number, to: number): CalendarItem[] {
    const out: CalendarItem[] = [];
    const me = UserStore.getCurrentUser()?.id;
    for (let y = new Date(from).getFullYear(); y <= new Date(to).getFullYear(); y++) {
        for (const b of allBirthdays()) {
            const d = dateInYear(b, y);
            if (d.getTime() < from || d.getTime() >= to) continue;
            const age = b.year ? y - b.year : null;
            out.push({
                id: `bday-${b.userId}-${y}`, kind: "birthday", at: d.getTime(), allDay: true,
                title: b.userId === me ? "Your birthday" : `${b.name}'s birthday`,
                detail: age && age > 0 ? `${b.userId === me ? "You turn" : "Turning"} ${age}` : undefined,
                ref: { userId: b.userId, self: b.userId === me },
            });
        }
    }
    return out;
}

function scheduled(from: number, to: number): CalendarItem[] {
    return getItems().filter(m => m.status === "pending").flatMap(m =>
        repeatsBetween(m.sendAt, repeatStep(m.repeat), from, to).map(at => ({
            id: `sched-${m.id}-${at}`, kind: "scheduled" as const, at,
            title: m.content.trim().split("\n")[0].slice(0, 80) || "(message)",
            detail: `${whereOf(m.channelId)}${m.repeat !== "none" ? ` · repeats ${m.repeat}` : ""}`,
            ref: { channelId: m.channelId, messageId: m.id },
        })));
}

function events(from: number, to: number, interestedOnly: boolean): CalendarItem[] {
    const out: CalendarItem[] = [];
    const me = UserStore.getCurrentUser()?.id ?? null;
    for (const guild of Object.values(GuildStore.getGuilds())) {
        for (const e of GuildScheduledEventStore.getGuildScheduledEventsForGuild(guild.id) ?? []) {
            // Scheduled or happening now.
            if (e.status !== 1 && e.status !== 2) continue;
            const at = Date.parse(e.scheduled_start_time);
            if (!(at >= from && at < to)) continue;
            if (interestedOnly && !GuildScheduledEventStore.getRsvp(e.id, null, me)?.interested) continue;
            const place = e.entity_metadata?.location ?? (e.channel_id ? ChannelStore.getChannel(e.channel_id)?.name : null);
            out.push({
                id: `event-${e.id}`, kind: "event", at,
                title: e.name,
                detail: [guild.name, place].filter(Boolean).join(" · "),
                ref: { guildId: guild.id, channelId: e.channel_id, eventId: e.id, live: e.status === 2 },
            });
        }
    }
    return out;
}

function reminders(from: number, to: number): CalendarItem[] {
    return getReminders().filter(r => r.at >= from && r.at < to).map(r => ({
        id: `rem-${r.id}`, kind: "reminder" as const, at: r.at, title: r.title, ref: { reminderId: r.id, done: r.done },
    }));
}

function imported(from: number, to: number): CalendarItem[] {
    const out: CalendarItem[] = [];
    for (const cal of getImports()) {
        if (!cal.enabled) continue;
        for (const e of cal.events) {
            // A holiday from the 24th to the 27th shows on each of those days.
            const spanDays = e.allDay && e.end ? Math.max(1, Math.round((e.end - e.start) / 86_400_000)) : 1;
            const starts = occurrences(e, from - (spanDays - 1) * 86_400_000, to).flatMap(t => Array.from({ length: Math.min(spanDays, 60) }, (_, d) => new Date(new Date(t).setDate(new Date(t).getDate() + d)).getTime())).filter(t => t >= from && t < to);
            for (const at of starts) {
                const mins = e.end && !e.allDay ? Math.round((e.end - e.start) / 60000) : 0;
                const until = mins ? new Date(at + mins * 60000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : null;
                out.push({
                    id: `imp-${cal.id}-${e.uid}-${at}`, kind: "imported", at, allDay: e.allDay, title: e.title,
                    detail: [until && `until ${until}`, e.location, cal.name].filter(Boolean).join(" · "),
                    ref: { color: cal.color, calendar: cal.name, description: e.description },
                });
            }
        }
    }
    return out;
}

/** Show Tracker: when the next episode of each show you follow comes out. */
function episodes(from: number, to: number): CalendarItem[] {
    return followed().flatMap(s => {
        const at = s.next?.at;
        if (!at || at < from || at >= to) return [];
        return [{
            id: `ep-${s.key}-${at}`, kind: "episode" as const, at,
            title: `${s.title} · ${episodeLabel(s, s.next)}`,
            detail: [s.next!.name, s.where].filter(Boolean).join(" · ") || undefined,
            ref: { showKey: s.key, url: s.url },
        }];
    });
}

export function itemsBetween(from: number, to: number, o: SourceOptions): CalendarItem[] {
    const safe = (fn: () => CalendarItem[]) => { try { return fn(); } catch { return []; } };
    return [
        ...(o.birthdays ? safe(() => birthdays(from, to)) : []),
        ...(o.scheduled ? safe(() => scheduled(from, to)) : []),
        ...(o.events ? safe(() => events(from, to, o.interestedOnly)) : []),
        ...(o.reminders ? safe(() => reminders(from, to)) : []),
        ...(o.imported !== false ? safe(() => imported(from, to)) : []),
        ...(o.packages !== false ? safe(() => calendarParcels(from, to).map(p => ({ ...p, kind: "package" as const }))) : []),
        ...(o.episodes !== false ? safe(() => episodes(from, to)) : []),
    ];
}
