/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, SelectedChannelStore } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { openScheduler } from "./Panel";
import { startScheduler, stopScheduler } from "./scheduler";
import { loadQueue } from "./store";

const settings = defineFeatureSettings("scheduledMessages", {
    openWindow: {
        type: OptionType.COMPONENT,
        component: () => (
            <button type="button" className="vc-tool-btn" onClick={() => openScheduler()}>Open Scheduled Messages</button>
        ),
    },
});

// Right-click the chat box → "Schedule message…" for the channel you're in.
const chatInputMenu: NavContextMenuPatchCallback = children => {
    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="vc-schedmsg-open"
                label="Schedule message…"
                action={() => openScheduler(SelectedChannelStore.getChannelId() ?? undefined)}
            />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "ScheduledMessages",
    description: "Write a message now and have it sent later — once, daily or weekly. Manage everything (edit, reschedule, cancel, send now) from its own window.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    // Its own window — dockable from Plugin Utilities → Dock.
    openSettingsModal: () => openScheduler(),

    /** For other plugins (e.g. Sonata's Birthday Reminders): open with a draft filled in. */
    openPrefilled({ channelId, content, sendAt }: { channelId: string; content?: string; sendAt?: number; }) {
        openScheduler(channelId, { content, sendAt });
    },

    contextMenus: {
        "textarea-context": chatInputMenu,
    },

    async start() {
        await loadQueue();
        startScheduler();
    },

    stop() {
        stopScheduler();
    },
});
