/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { openPrivateChannel } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, UserStore } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { playEffect } from "../_shared/effects";
import { colorOf, daysUntil, dueReminders, formatDate, nextOccurrence, turning } from "./dates";
import { avatarUrl, openBirthdays } from "./Panel";
import { allBirthdays, getBirthday, loadBirthdays, patchBirthday, useBirthdays } from "./store";

export const settings = defineFeatureSettings("birthdayReminders", {
    remindHour: {
        type: OptionType.SLIDER,
        description: "Hour of the day to remind you (if Discord isn't open then, you're reminded when it opens)",
        markers: [6, 8, 9, 10, 12, 15, 18, 21],
        default: 9,
        stickToMarkers: true,
    },
    remindDayBefore: {
        type: OptionType.BOOLEAN,
        description: "Also remind me the day before",
        default: true,
    },
    onProfiles: {
        type: OptionType.BOOLEAN,
        description: "Show a birthday countdown on the profiles of people whose birthday you've saved (only you see it)",
        default: true,
    },
    confetti: {
        type: OptionType.BOOLEAN,
        description: "Drop confetti from the top of the screen on a birthday (only you see it)",
        default: true,
    },
});

const open = (userId?: string) => openBirthdays(userId, settings.store.remindHour, settings.store.confetti);

const isMe = (userId: string) => userId === UserStore.getCurrentUser()?.id;

export function checkReminders(now = new Date()) {
    const { today, tomorrow } = dueReminders(allBirthdays(), now, settings.store.remindHour, settings.store.remindDayBefore);
    for (const b of today) {
        const age = turning(b, now);
        showNotification(isMe(b.userId)
            ? {
                title: "🎂 Happy birthday!",
                body: `Happy birthday to you${age ? ` — you're ${age} today` : ""}! 🎉`,
                icon: avatarUrl(b),
                onClick: () => open(),
            }
            : {
                title: "🎂 Birthday today",
                body: `It's ${b.name}'s birthday${age ? ` — they're turning ${age}` : ""}! Click to message them.`,
                icon: avatarUrl(b),
                onClick: () => openPrivateChannel(b.userId),
            });
        patchBirthday(b.userId, { notifiedYear: nextOccurrence(b, now).getFullYear() });
    }
    for (const b of tomorrow) {
        showNotification({
            title: "Birthday tomorrow",
            body: `${b.name}'s birthday is tomorrow.`,
            icon: avatarUrl(b),
            onClick: () => open(b.userId),
        });
        patchBirthday(b.userId, { eveNotifiedYear: nextOccurrence(b, now).getFullYear() });
    }
    if (today.length && settings.store.confetti) playEffect("confetti");
    return { today, tomorrow };
}

// Right-click a person → "Set birthday…" / "Edit birthday".
const userMenu: NavContextMenuPatchCallback = (children, { user }) => {
    if (!user?.id || user.bot) return;
    children.push(
        <Menu.MenuItem
            id="vc-bday-set"
            label={getBirthday(user.id) ? "Edit birthday" : "Set birthday…"}
            action={() => open(user.id)}
        />
    );
};

/** "🎂 Birthday · March 3 · in 12 days, turning 16" on their profile. */
function ProfileCountdown({ userId, isSideBar }: { userId: string; isSideBar: boolean; }) {
    useBirthdays();
    const b = getBirthday(userId);
    if (!b || settings.store.onProfiles === false) return null;
    const days = daysUntil(b), age = turning(b);
    const mine = isMe(userId);
    const when = days === 0 ? "today! 🎉" : days === 1 ? "tomorrow" : `in ${days} days`;
    return (
        <div className={`vc-bday-profile${days === 0 ? " vc-bday-profile-today" : ""}${isSideBar ? " vc-bday-profile-side" : ""}`} style={{ "--m": colorOf(b) } as React.CSSProperties} title="Only you see this — from Birthday Reminders" onClick={() => open(userId)}>
            <span className="vc-bday-profile-icon" aria-hidden>🎂</span>
            <span className="vc-bday-profile-text">
                <b>{days === 0 ? (mine ? "Your birthday is today! 🎉" : "Birthday today! 🎉") : `${mine ? "Your birthday" : "Birthday"} ${when}`}</b>
                <span>{formatDate(b)}{age ? ` · ${days === 0 ? "turning" : "turns"} ${age}` : ""}</span>
            </span>
        </div>
    );
}

let timer: ReturnType<typeof setInterval> | undefined;

export default definePlugin({
    name: "BirthdayReminders",
    description: "Save friends' birthdays (and your own) and get reminded on the day — with confetti — and the day before. Can queue a birthday message with Scheduled Messages.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => open(),
    contextMenus: { "user-context": userMenu },
    renderProfileSection: { render: (props: { userId: string; isSideBar: boolean; }) => <ProfileCountdown {...props} />, priority: 5 },

    async start() {
        await loadBirthdays();
        setTimeout(checkReminders, 5_000);
        timer = setInterval(checkReminders, 10 * 60_000);
    },

    stop() {
        clearInterval(timer);
    },
});
