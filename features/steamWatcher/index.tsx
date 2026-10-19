/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Steam Watcher: pick Steam games to watch and get a pop-up when one goes on
// sale (or drops under your price), gets an update, comes out, moves its
// release date, or turns free. Also shows your own Steam profile. Uses Steam's
// public store and news while Discord is open; everything's saved here.

import "../_shared/tool.css";
import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import definePlugin, { IconProps, OptionType } from "@utils/types";

import { defineFeatureSettings } from "../../featureSettings";
import { opts, startChecks, stopChecks } from "./check";
import { openWatcher } from "./Panel";
import { loadSteam } from "./store";

const settings = defineFeatureSettings("steamWatcher", {
    checkHours: {
        type: OptionType.SELECT,
        description: "How often to check your games",
        options: [
            { label: "Every hour", value: 1 },
            { label: "Every 3 hours", value: 3, default: true },
            { label: "Every 6 hours", value: 6 },
            { label: "Every 12 hours", value: 12 },
        ],
    },
    country: {
        type: OptionType.SELECT,
        description: "Your Steam store region (for prices and currency)",
        options: [
            { label: "United States (USD)", value: "US", default: true },
            { label: "United Kingdom (GBP)", value: "GB" },
            { label: "Europe (EUR)", value: "DE" },
            { label: "Canada (CAD)", value: "CA" },
            { label: "Australia (AUD)", value: "AU" },
            { label: "New Zealand (NZD)", value: "NZ" },
            { label: "Brazil (BRL)", value: "BR" },
            { label: "Mexico (MXN)", value: "MX" },
            { label: "Poland (PLN)", value: "PL" },
            { label: "India (INR)", value: "IN" },
            { label: "Japan (JPY)", value: "JP" },
        ],
    },
    sales: { type: OptionType.BOOLEAN, description: "Pop up when a game goes on sale or hits your price", default: true },
    updates: {
        type: OptionType.SELECT,
        description: "Pop up for developer posts",
        options: [
            { label: "Updates and patch notes", value: "updates", default: true },
            { label: "Every announcement", value: "all" },
            { label: "Never", value: "off" },
        ],
    },
    releases: { type: OptionType.BOOLEAN, description: "Pop up when a game comes out or its release date moves", default: true },
    free: { type: OptionType.BOOLEAN, description: "Pop up when a game is free to keep or free to play for a while", default: true },
});

function syncOpts() {
    opts.hours = Number(settings.store.checkHours) || 3;
    opts.country = String(settings.store.country || "US");
    opts.sales = settings.store.sales !== false;
    opts.updates = (settings.store.updates as typeof opts.updates) || "updates";
    opts.releases = settings.store.releases !== false;
    opts.free = settings.store.free !== false;
}
opts.onOpen = tab => { syncOpts(); openWatcher(tab); };
opts.sync = syncOpts;

export function SteamIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 21a9 9 0 1 0-8.6-11.7M3.4 13.6l4 1.7M10.4 14.6l2.6-3.2" />
            <circle cx="15.3" cy="9" r="3" />
            <circle cx="8.6" cy="15.9" r="2" />
            <circle cx="15.3" cy="9" r="1.2" fill="currentColor" stroke="none" />
        </svg>
    );
}

const WatcherButton: ChatBarButtonFactory = ({ isMainChat }) => isMainChat
    ? <ChatBarButton tooltip="Steam Watcher" onClick={() => { syncOpts(); openWatcher(); }}><SteamIcon /></ChatBarButton>
    : null;

export default definePlugin({
    name: "SteamWatcher",
    description: "Watch Steam games: get a pop-up when one goes on sale or drops under your price, gets an update (with the patch notes), comes out, moves its release date, or turns free. Link your Steam profile to see it here and add your wishlist.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => { syncOpts(); openWatcher(); },
    chatBarButton: { icon: SteamIcon, render: WatcherButton },

    async start() {
        syncOpts();
        await loadSteam();
        startChecks();
    },
    stop() {
        stopChecks();
    },
});
