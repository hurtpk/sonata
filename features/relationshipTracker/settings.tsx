/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { OptionType } from "@utils/types";

import { defineFeatureSettings } from "../../featureSettings";
import { openLog } from "./Panel";

// Everything is always logged; these only control notifications.
export const settings = defineFeatureSettings("relationshipTracker", {
    openWindow: {
        type: OptionType.COMPONENT,
        component: () => <button type="button" className="vc-tool-btn" onClick={() => openLog()}>Open Relationship Log</button>,
    },
    notices: {
        type: OptionType.BOOLEAN,
        description: "Also show a banner at the top of Discord for notifications (so you can't miss them).",
        default: false,
    },
    offlineChanges: {
        type: OptionType.BOOLEAN,
        description: "When Discord starts, log (and notify about) changes that happened while it was closed.",
        default: true,
    },
    notifyFriendRemoved: {
        type: OptionType.BOOLEAN,
        description: "Notify when someone removes you as a friend",
        default: true,
    },
    notifyAccepted: {
        type: OptionType.BOOLEAN,
        description: "Notify when someone accepts your friend request",
        default: true,
    },
    notifyRequests: {
        type: OptionType.BOOLEAN,
        description: "Notify about new incoming friend requests",
        default: true,
    },
    notifyRequestCancelled: {
        type: OptionType.BOOLEAN,
        description: "Notify when a friend request to you is cancelled, or yours is declined",
        default: true,
    },
    notifyGroups: {
        type: OptionType.BOOLEAN,
        description: "Notify when you're removed from a group chat",
        default: true,
    },
    notifyGroupMembers: {
        type: OptionType.BOOLEAN,
        description: "Notify when someone else leaves or is removed from one of your group chats",
        default: false,
    },
    notifyServers: {
        type: OptionType.BOOLEAN,
        description: "Notify when you're removed from a server",
        default: true,
    },
    migratedFromQol: {
        type: OptionType.BOOLEAN,
        description: "Internal: settings copied from QOL's Relationship Notifier",
        default: false,
        hidden: true,
    },
});
