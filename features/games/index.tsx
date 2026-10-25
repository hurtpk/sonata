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
// Steam (./steam) and Roblox (./roblox) are part of it, not features of their own.

import "../_shared/tool.css";
import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import definePlugin, { IconProps } from "@utils/types";

import { openGames } from "./Panel";
import { applyRates, robloxAccessory, robloxMessageMenu, startRoblox, stopRoblox } from "./roblox/setup";
import { startSteam, stopSteam, syncSteam } from "./steam/setup";
import { settings, startChecks, stopChecks } from "./store";

export function ControllerIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M7 7h10a5 5 0 0 1 4.8 6.4l-1 3.4a2.5 2.5 0 0 1-4.3.9L14.5 15h-5l-2 2.7a2.5 2.5 0 0 1-4.3-.9l-1-3.4A5 5 0 0 1 7 7zM8 10v3M6.5 11.5h3" />
            <circle cx="15.5" cy="10.5" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="17.5" cy="12.5" r="1.1" fill="currentColor" stroke="none" />
        </svg>
    );
}

const open = () => { syncSteam(); applyRates(); openGames(); };

const HubButton: ChatBarButtonFactory = ({ isMainChat }) => isMainChat
    ? <ChatBarButton tooltip="Game Hub" onClick={open}><ControllerIcon /></ChatBarButton>
    : null;

export default definePlugin({
    name: "Game Hub",
    description: "Steam, Roblox, Epic's free games, Fortnite's item shop, Xbox Game Pass, Minecraft servers and players, and prices at every store, with alerts. Steam watches your games for sales and updates; Roblox shows live cards for Roblox links in chat, profile and game look-ups, servers, trades and Robux maths. No sign-in needed.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: open,
    chatBarButton: { icon: ControllerIcon, render: HubButton },
    contextMenus: { message: robloxMessageMenu },
    renderMessageAccessory: robloxAccessory,

    async start() {
        startChecks();
        await Promise.all([startSteam(), startRoblox()]);
    },
    stop() {
        stopChecks();
        stopSteam();
        stopRoblox();
    },
});
