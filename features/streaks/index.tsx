/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Streaks: how many days in a row you and a friend have messaged each other,
// as a 🔥 next to them in your DM list — with an ⌛ when today's not done yet
// and the day's nearly over, and an optional reminder.

import "../_shared/tool.css";
import "./styles.css";

import { showNotification } from "@api/Notifications";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, NavigationRouter, Tooltip, useEffect, useReducer,UserStore } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { openStreaks } from "./Panel";
import { knownChannels, loadStreaks, onStreaksChange, recordDay, recordMessages, Rule, Streak, streakOf, today } from "./store";

export const settings = defineFeatureSettings("streaks", {
    rule: {
        type: OptionType.SELECT,
        description: "A day counts when",
        options: [
            { label: "You both send a message (like Snapchat)", value: "both", default: true },
            { label: "Either of you sends a message", value: "either" },
        ],
    },
    minStreak: {
        type: OptionType.SLIDER,
        description: "Show the 🔥 from this many days",
        markers: [1, 2, 3, 4, 5, 6, 7],
        default: 3,
        stickToMarkers: true,
    },
    warnHour: {
        type: OptionType.SELECT,
        description: "Show ⌛ when today isn't done yet, from",
        options: [
            { label: "6 pm", value: 18 },
            { label: "8 pm", value: 20, default: true },
            { label: "9 pm", value: 21 },
            { label: "10 pm", value: 22 },
            { label: "Never", value: 99 },
        ],
    },
    remind: {
        type: OptionType.BOOLEAN,
        description: "Send me a reminder when a streak is about to end and I haven't messaged yet",
        default: true,
    },
    lastReminded: {
        type: OptionType.STRING,
        description: "Internal: reminders already sent today (JSON).",
        default: "{}",
        hidden: true,
    },
});

const rule = () => settings.store.rule as Rule;

/** Where today stands, e.g. "you still need to message today". */
export function todayNote(s: Streak, r: Rule) {
    if (s.doneToday) return "today's done ✓";
    if (r === "either") return "message today to keep it";
    if (!s.meToday && !s.themToday) return "you both still need to message today";
    return !s.meToday ? "you still need to message today" : "they still need to message today";
}
export const atRiskNow = () => new Date().getHours() >= Number(settings.store.warnHour);

export function useStreaks() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => onStreaksChange(bump), []);
}

const Badge = ErrorBoundary.wrap(({ channelId }: { channelId: string; }) => {
    useStreaks();
    settings.use(["rule", "minStreak", "warnHour"]);
    const s = streakOf(channelId, rule());
    if (s.count < settings.store.minStreak) return null;
    const risk = !s.doneToday && atRiskNow();
    const tip = `${s.count}-day streak — ${todayNote(s, rule())}`;
    return (
        <Tooltip text={tip}>
            {props => (
                <span {...props} className="vc-streak-badge">
                    🔥<span className="vc-streak-count">{s.count}</span>{risk && <span className="vc-streak-risk">⌛</span>}
                </span>
            )}
        </Tooltip>
    );
}, { noop: true });

let reminderTimer: ReturnType<typeof setInterval> | null = null;

function checkReminders() {
    if (!settings.store.remind || !atRiskNow()) return;
    let sent: Record<string, number> = {};
    try { sent = JSON.parse(settings.store.lastReminded || "{}"); } catch { }
    const t = today();
    let any = false;
    for (const id of knownChannels()) {
        const s = streakOf(id, rule());
        if (s.count < settings.store.minStreak || s.doneToday || s.meToday || sent[id] === t) continue;
        const ch: any = ChannelStore.getChannel(id);
        const u: any = ch?.recipients?.[0] && UserStore.getUser(ch.recipients[0]);
        if (!u) continue;
        sent[id] = t;
        any = true;
        void showNotification({
            title: `⌛ Your ${s.count}-day streak with ${u.globalName || u.username} ends at midnight`,
            body: "Send them a message to keep it going.",
            icon: u.getAvatarURL?.(undefined, 80, false),
            onClick: () => NavigationRouter.transitionTo(`/channels/@me/${id}`),
        });
    }
    if (any) settings.store.lastReminded = JSON.stringify(sent);
}

const isDM = (channelId: string) => (ChannelStore.getChannel(channelId) as any)?.type === 1;

export default definePlugin({
    name: "Streaks",
    description: "A 🔥 day count next to friends in your DM list for every day in a row you've both messaged — with an ⌛ when today's not done and the day's nearly over, reminders, your best streaks, and a history scan to find the streaks you already have.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => openStreaks(),

    renderMemberListDecorator(props: any) {
        if (props.type !== "dm" || props.channel?.type !== 1) return null;
        return <Badge channelId={props.channel.id} />;
    },

    flux: {
        MESSAGE_CREATE({ channelId, message, optimistic }: any) {
            if (optimistic || !message?.author || !isDM(channelId)) return;
            recordDay(channelId, message.author.id === UserStore.getCurrentUser()?.id, Date.parse(message.timestamp) || Date.now());
        },
        LOAD_MESSAGES_SUCCESS({ channelId, messages }: any) {
            if (isDM(channelId) && Array.isArray(messages)) recordMessages(channelId, messages);
        },
    },

    async start() {
        await loadStreaks();
        reminderTimer = setInterval(checkReminders, 5 * 60 * 1000);
        setTimeout(checkReminders, 20_000);
    },

    stop() {
        if (reminderTimer) clearInterval(reminderTimer);
        reminderTimer = null;
    },
});
