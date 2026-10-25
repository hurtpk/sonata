/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Game Hub's Steam: pick Steam games to watch and get a pop-up when one goes
// on sale (or drops under your price), gets an update, comes out, moves its
// release date, or turns free. Also shows your own Steam profile. Uses Steam's
// public store and news while Discord is open; everything's saved here.
// (It used to be its own feature, Steam Watcher; its settings keep that name,
// so nothing you set was lost.)

import "./styles.css";

import { OptionType } from "@utils/types";

import { defineFeatureSettings } from "../../../featureSettings";
import { opts, startChecks, stopChecks } from "./check";
import { openWatcher } from "./Panel";
import { loadSteam } from "./store";

export const steamSettings = defineFeatureSettings("steamWatcher", {
    checkHours: {
        type: OptionType.SELECT,
        description: "Steam: how often to check your games",
        options: [
            { label: "Every hour", value: 1 },
            { label: "Every 3 hours", value: 3, default: true },
            { label: "Every 6 hours", value: 6 },
            { label: "Every 12 hours", value: 12 },
        ],
    },
    country: {
        type: OptionType.SELECT,
        description: "Steam: your store region (for prices and currency)",
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
    sales: { type: OptionType.BOOLEAN, description: "Steam: pop up when a game goes on sale or hits your price", default: true },
    updates: {
        type: OptionType.SELECT,
        description: "Steam: pop up for developer posts",
        options: [
            { label: "Updates and patch notes", value: "updates", default: true },
            { label: "Every announcement", value: "all" },
            { label: "Never", value: "off" },
        ],
    },
    releases: { type: OptionType.BOOLEAN, description: "Steam: pop up when a game comes out or its release date moves", default: true },
    free: { type: OptionType.BOOLEAN, description: "Steam: pop up when a game is free to keep or free to play for a while", default: true },
});

function syncOpts() {
    opts.hours = Number(steamSettings.store.checkHours) || 3;
    opts.country = String(steamSettings.store.country || "US");
    opts.sales = steamSettings.store.sales !== false;
    opts.updates = (steamSettings.store.updates as typeof opts.updates) || "updates";
    opts.releases = steamSettings.store.releases !== false;
    opts.free = steamSettings.store.free !== false;
}
opts.onOpen = tab => { syncOpts(); openWatcher(tab); };
opts.sync = syncOpts;

export async function startSteam() {
    syncOpts();
    await loadSteam();
    startChecks();
}

export const stopSteam = () => stopChecks();

/** Before opening Steam's part of Game Hub: picks up setting changes. */
export const syncSteam = syncOpts;
