/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Payment received: every few minutes (only if you switch it on), the
// balance at each of your crypto addresses is checked, and you get a
// notification when one goes up — with how much came in and what it's worth.
// The first check of an address is silent; it just learns what's there.

import * as DataStore from "@api/DataStore";
import { showNotification } from "@api/Notifications";

import { Entry, kindOf, tidy, title } from "./kinds";
import { checkBalance, coinAmount, getPrices, usd } from "./prices";
import { allEntries } from "./store";

const KEY = "Sonata_walletSeen";
interface Seen { amounts: Record<string, number>; lastCheck: number; }
let seen: Seen = { amounts: {}, lastCheck: 0 };
let loaded = false;

export const alerts = { on: false, minutes: 15, onOpen: () => { }, set: (_on: boolean, _minutes: number) => { } };
export const status = { checking: false, lastCheck: 0 };
const listeners = new Set<() => void>();
export const onStatus = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };
const changed = () => listeners.forEach(l => l());

const keyOf = (e: Entry) => `${e.kind}:${e.network ?? ""}:${tidy(e)}`;
/** What we last saw at this address, if it's been checked. */
export const lastSeen = (e: Entry) => seen.amounts[keyOf(e)];

async function load() {
    if (loaded) return;
    seen = { amounts: {}, lastCheck: 0, ...(await DataStore.get<Seen>(KEY).catch(() => undefined)) };
    status.lastCheck = seen.lastCheck;
    loaded = true;
}
const save = () => void DataStore.set(KEY, seen);

/** Checks every crypto address once, one at a time. */
export async function checkNow() {
    if (status.checking) return;
    await load();
    status.checking = true;
    changed();
    try {
        const crypto = allEntries().filter(e => kindOf(e.kind).crypto);
        const prices = crypto.length ? await getPrices() : null;
        for (const e of crypto) {
            const r = await checkBalance(e, true);
            if (!r.ok) continue;
            const key = keyOf(e), before = seen.amounts[key];
            seen.amounts[key] = r.amount;
            // Ignore dust-level wobbles; only real money coming in.
            if (before != null && r.amount - before > Math.max(1e-9, before * 1e-9)) {
                const got = r.amount - before, sym = e.kind.toUpperCase(), price = prices?.[e.kind];
                showNotification({
                    title: "💰 Crypto received",
                    body: `+${coinAmount(got)} ${sym}${price != null ? ` (≈ ${usd(got * price)})` : ""} at ${title(e)}. Balance: ${coinAmount(r.amount)} ${sym}.`,
                    onClick: alerts.onOpen,
                });
            }
            // A short pause between addresses, to be gentle with the explorers.
            await new Promise(res => setTimeout(res, 1500));
        }
        seen.lastCheck = status.lastCheck = Date.now();
        save();
    } finally {
        status.checking = false;
        changed();
    }
}

let timer: ReturnType<typeof setInterval> | undefined;

/** Checks when it's been long enough (looked at once a minute while Discord is open). */
export function startAlerts() {
    stopAlerts();
    void load().then(() => changed());
    timer = setInterval(() => {
        if (alerts.on && !status.checking && Date.now() - status.lastCheck >= alerts.minutes * 60_000) void checkNow();
    }, 60_000);
}

export function stopAlerts() {
    if (timer) clearInterval(timer);
    timer = undefined;
}
