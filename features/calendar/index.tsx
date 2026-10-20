/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./styles.css";

import { showNotification } from "@api/Notifications";
import { Settings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

import { defineFeatureSettings, isFeatureRunning, QOL_NAME } from "../../featureSettings";
import { refreshDock } from "../../utilities/dock";
import { registerCustomDockButton } from "../../utilities/shared";
import { loadBirthdays } from "../birthdayReminders/store";
import { isLoaded, loadQueue } from "../scheduledMessages/store";
import { loadImports } from "./ics";
import { openCalendar } from "./Panel";
import { loadReminders, takeDue } from "./reminders";
import type { SourceOptions } from "./sources";

export const settings = defineFeatureSettings("calendar", {
    weekStart: {
        type: OptionType.SELECT,
        description: "First day of the week",
        options: [
            { label: "Monday", value: 1, default: true },
            { label: "Sunday", value: 0 },
        ],
    },
    interestedOnly: {
        type: OptionType.BOOLEAN,
        description: "Only show server events you've marked yourself interested in",
        default: false,
    },
    showBirthdays: { type: OptionType.BOOLEAN, description: "Show birthdays", default: true, hidden: true },
    showScheduled: { type: OptionType.BOOLEAN, description: "Show scheduled messages", default: true, hidden: true },
    showEvents: { type: OptionType.BOOLEAN, description: "Show server events", default: true, hidden: true },
    showReminders: { type: OptionType.BOOLEAN, description: "Show reminders", default: true, hidden: true },
    showImported: { type: OptionType.BOOLEAN, description: "Show imported calendars", default: true, hidden: true },
    showPackages: { type: OptionType.BOOLEAN, description: "Show parcels from Package Tracker", default: true, hidden: true },
    addedToDock: {
        type: OptionType.BOOLEAN,
        description: "Internal: the dock button was added once (removing it from the dock keeps it removed).",
        default: false,
        hidden: true,
    },
});

const SETTING_FOR: Record<keyof SourceOptions, string> = {
    birthdays: "showBirthdays", scheduled: "showScheduled", events: "showEvents", reminders: "showReminders", imported: "showImported", packages: "showPackages", interestedOnly: "interestedOnly",
};

function open() {
    const s = settings.store as any;
    openCalendar(Number(settings.store.weekStart) === 0 ? 0 : 1, {
        birthdays: s.showBirthdays, scheduled: s.showScheduled, events: s.showEvents, reminders: s.showReminders, imported: s.showImported !== false, packages: s.showPackages !== false, interestedOnly: s.interestedOnly,
    }, (k, v) => { s[SETTING_FOR[k]] = v; });
}

/** Put a Calendar button on the dock the first time, like adding it from Plugin Utilities → Dock. */
function addDockButtonOnce() {
    if (settings.store.addedToDock) return;
    settings.store.addedToDock = true;
    const store = Settings.plugins[QOL_NAME];
    let custom: Record<string, string> = {};
    try { custom = JSON.parse(store.customDock || "{}") ?? {}; } catch { }
    const id = "opticord:calendar";
    if (custom[id]) return;
    store.customDock = JSON.stringify({ ...custom, [id]: "calendar" });
    registerCustomDockButton(id, "calendar");
    refreshDock();
}

function checkReminders() {
    for (const r of takeDue()) {
        showNotification({ title: "🔔 Reminder", body: r.title, onClick: open });
    }
}

let timer: ReturnType<typeof setInterval> | undefined;

export default definePlugin({
    name: "Calendar",
    description: "One small calendar with your birthdays, scheduled messages, reminders and server events — plus calendars you import (.ics files or links), and export to any calendar app. Opened from its dock button.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: open,

    async start() {
        // The calendar also shows saved birthdays / scheduled messages while those features are off.
        if (!isFeatureRunning("birthdayReminders")) loadBirthdays();
        if (!isLoaded()) loadQueue();
        await loadReminders();
        await loadImports();
        checkReminders();
        timer = setInterval(checkReminders, 20_000);
        addDockButtonOnce();
    },

    stop() {
        clearInterval(timer);
    },
});
