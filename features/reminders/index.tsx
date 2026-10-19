/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Reminders: set one for any time — or right-click a message → "Remind me
// about this" — and when it's due a banner slides down from the top of
// Discord in the colour you picked (red rings twice and pulses, gray stays
// silent and slides away). Snooze, open the message, or mark it done.

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { IconProps, OptionType } from "@utils/types";
import { Menu, showToast } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { isRinging, mountBanners, ring, setRingOptions, unmountBanners } from "./Banner";
import { openReminders } from "./Panel";
import { addReminder, COLOR_IDS, ColorId, COLORS, getReminders, loadReminders, onRemindersChange, quickTimes, whenText } from "./store";

export const settings = defineFeatureSettings("reminders", {
    defaultColor: {
        type: OptionType.SELECT,
        description: "Colour for new reminders",
        options: COLOR_IDS.map(id => ({ label: `${COLORS[id].name} — ${COLORS[id].feel}`, value: id, default: id === "blue" })),
    },
    volume: { type: OptionType.SLIDER, description: "Sound volume", markers: [0, 25, 50, 75, 100], default: 60, stickToMarkers: false },
    desktop: { type: OptionType.BOOLEAN, description: "Also show a Windows notification when Discord isn't in front", default: true },
});

const defaultColor = () => (settings.store.defaultColor as ColorId) ?? "blue";
let running = false;
export const remindersRunning = () => running;

/** Opens the Reminders window with a new reminder started (used by To-do Lists too). */
export function newReminder(text: string, link?: { channelId: string; messageId: string; guildId?: string | null; author?: string; }) {
    openReminders(defaultColor(), { text, link });
}

export function BellIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
    );
}

const ReminderButton: ChatBarButtonFactory = ({ isMainChat }) => {
    if (!isMainChat) return null;
    return <ChatBarButton tooltip="Reminders" onClick={() => openReminders(defaultColor())}><BellIcon /></ChatBarButton>;
};

const messageMenu: NavContextMenuPatchCallback = (children, { message, channel }: any) => {
    if (!message) return;
    const author = message.author?.globalName || message.author?.username;
    const link = { channelId: message.channel_id, messageId: message.id, guildId: channel?.guild_id ?? null, author };
    const text = (message.content ?? "").replace(/\s+/g, " ").slice(0, 120);
    children.push(
        <Menu.MenuItem id="vc-reminders" label="Remind me about this">
            {quickTimes().map(q => (
                <Menu.MenuItem key={q.label} id={`vc-reminders-${q.label}`} label={q.label} action={() => {
                    addReminder({ text, at: q.at, color: defaultColor(), repeat: "none", link });
                    showToast(`Reminder set for ${whenText(q.at)}`, "success");
                }} />
            ))}
            <Menu.MenuSeparator />
            <Menu.MenuItem id="vc-reminders-custom" label="Pick a time and colour…" action={() => openReminders(defaultColor(), { text, link })} />
        </Menu.MenuItem>
    );
};

// ─── The clock ───

let timer: ReturnType<typeof setTimeout> | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
let unsub: (() => void) | null = null;

function check() {
    if (timer) clearTimeout(timer);
    timer = null;
    setRingOptions({ volume: (Number(settings.store.volume ?? 60) || 0) / 100, desktop: settings.store.desktop !== false });
    const now = Date.now();
    let next = Infinity;
    for (const r of getReminders()) {
        if (r.at <= now) { if (!isRinging(r.id)) ring(r); }
        else next = Math.min(next, r.at);
    }
    // Wake up exactly when the next one is due (timers can't wait longer than ~24 days).
    if (next !== Infinity) timer = setTimeout(check, Math.min(next - now + 50, 2 ** 31 - 1));
}

const onWake = () => { if (!document.hidden) check(); };

export default definePlugin({
    name: "Reminders",
    description: "Set reminders — or right-click a message → Remind me about this — and get a banner at the top of Discord when they're due, in the colour you chose: red rings twice and pulses, gray is silent. Snooze, repeat daily or weekly, or jump to the message.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => openReminders(defaultColor()),
    contextMenus: { message: messageMenu },
    chatBarButton: { icon: BellIcon, render: ReminderButton },

    async start() {
        running = true;
        mountBanners();
        await loadReminders();
        unsub = onRemindersChange(check);
        check();
        // A safety net (a sleeping computer can delay timers) and a check whenever Discord comes back.
        poll = setInterval(check, 30_000);
        document.addEventListener("visibilitychange", onWake);
        window.addEventListener("focus", onWake);
    },

    stop() {
        running = false;
        if (timer) clearTimeout(timer);
        if (poll) clearInterval(poll);
        timer = poll = null;
        unsub?.();
        unsub = null;
        document.removeEventListener("visibilitychange", onWake);
        window.removeEventListener("focus", onWake);
        unmountBanners();
    },
});
