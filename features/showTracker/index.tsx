/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Show Tracker: follow anime (from AniList) and TV shows (from TVMaze), see
// when each one's next episode is out, and get a pop-up when it is. Both are
// free and public — no account, no key.

import "../_shared/tool.css";
import "./styles.css";

import definePlugin from "@utils/types";

import { openShows } from "./Panel";
import { setOpener, settings, startChecks, stopChecks } from "./store";

export default definePlugin({
    name: "ShowTracker",
    description: "Follow anime and TV shows, see when the next episode is out, and get a pop-up when it is. No account needed.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,
    openSettingsModal: () => openShows(),
    start() { setOpener(openShows); startChecks(); },
    stop() { stopChecks(); },
});
