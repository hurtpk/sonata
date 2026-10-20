/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Game Hub: one window for Steam, Roblox, Epic's free games and
// Fortnite's item shop, Xbox Game Pass's lists, Minecraft servers and players,
// and a game's price at every store at once — with notifications for new free
// games, Fortnite items you're waiting for, price drops, Game Pass changes and
// Minecraft servers going down. Only public data: no sign-in, no API keys.

import "../_shared/tool.css";
import "./styles.css";

import definePlugin from "@utils/types";

import { openGames } from "./Panel";
import { settings, startChecks, stopChecks } from "./store";

export default definePlugin({
    name: "Game Hub",
    description: "Steam, Roblox, Epic's free games, Fortnite's item shop, Xbox Game Pass, Minecraft servers and players, and prices at every store, with alerts. No sign-in needed.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => openGames(),

    start() { startChecks(); },
    stop() { stopChecks(); },
});
