/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Bot Manager: your Discord bots in one place — who's online (with a
// notification when one goes offline), a step-by-step guide to making one, an
// invite builder with plain-English permissions, a starter project in
// JavaScript or Python, and fixes for the problems people hit most.
// It reads the same list as the Developer Portal and never touches bot tokens.

import "../_shared/tool.css";
import "./styles.css";

import definePlugin from "@utils/types";

import { openBotManager } from "./Panel";
import { settings, startWatching, stopWatching } from "./store";

export default definePlugin({
    name: "BotManager",
    description: "Your Discord bots in one place: who's online (with a notification when one goes offline), a step-by-step guide to making one, an invite builder with plain-English permissions, starter code in JavaScript or Python, and fixes for common problems.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => openBotManager(),

    start() {
        startWatching();
    },
    stop() {
        stopWatching();
    },
});
