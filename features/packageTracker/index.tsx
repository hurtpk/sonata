/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Package Tracker: parcels (UPS, USPS, FedEx, DHL, Amazon, Royal Mail, Canada
// Post, OnTrac) and food orders (DoorDash, Uber Eats, Postmates) in one list, with their
// progress and arrival time read off the public tracking page — never the
// address or anyone's name. Parcels can go on the Calendar and move day by
// themselves when they're delayed. In chat, tracking numbers and links get a
// Track button, delivery links are blurred, and you're warned before sending one.

import "../_shared/tool.css";
import "./styles.css";

import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";

import { Accessory, beforeSend } from "./chat";
import { openPackages } from "./Panel";
import { loadPackages, setOpener, settings, startChecks, stopChecks } from "./store";

// A quick look before doing the real work, so most messages cost nothing.
const MAYBE = /1Z|TBA\d|\d{10}|[A-Z]{2}\d{9}[A-Z]{2}|[CD]\d{14}|doordash|drd\.sh|ubereats|eats\.uber|postmates/i;
const SafeAccessory = ErrorBoundary.wrap(Accessory, { noop: true });

export default definePlugin({
    name: "Package Tracker",
    description: "Track parcels and DoorDash, Uber Eats or Postmates orders: progress, arrival time, the store and your food, without the address or anyone's name. Parcels can go on your Calendar and move when they're delayed.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => openPackages(),

    renderMessageAccessory: ({ message }: Record<string, any>) => {
        if (!settings.store.showInChat && !settings.store.hideLinks) return null;
        const content: string = message?.content ?? "";
        if (content.length < 10 || !MAYBE.test(content)) return null;
        return <SafeAccessory message={message} />;
    },

    onBeforeMessageSend: beforeSend,

    start() {
        setOpener(openPackages);
        void loadPackages();
        startChecks();
    },
    stop() { stopChecks(); },
});
