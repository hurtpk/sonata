/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Money requests ("Pay me $10 for pizza 🍕") and who's paid you back. Kept on
// this computer, next to the wallet (not in settings, so it's never shared).

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

import { Entry, linkFor, tidy } from "./kinds";

export interface Payer { name: string; paid: boolean; paidAt?: number; }
export interface PayRequest {
    id: string;
    /** In cents. */
    amount: number;
    currency: string;
    note: string;
    people: Payer[];
    methods: string[];
    createdAt: number;
}

const KEY = "Sonata_walletRequests";
let list: PayRequest[] = [];
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const save = () => { void DataStore.set(KEY, list); listeners.forEach(l => l()); };

export const loadRequests = () => loaded ??= DataStore.get<PayRequest[]>(KEY).then(v => { list = v ?? []; listeners.forEach(l => l()); }).catch(() => { });

export const allRequests = () => list;

export function useRequests() {
    const [, bump] = useState(0);
    useEffect(() => { void loadRequests(); const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    return list;
}

export function putRequest(r: PayRequest) {
    list = list.some(x => x.id === r.id) ? list.map(x => x.id === r.id ? r : x) : [r, ...list];
    save();
}
export function removeRequest(id: string) { list = list.filter(r => r.id !== id); save(); }
export function togglePaid(id: string, name: string) {
    list = list.map(r => r.id !== id ? r : { ...r, people: r.people.map(p => p.name !== name ? p : { ...p, paid: !p.paid, paidAt: p.paid ? undefined : Date.now() }) });
    save();
}

export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"];
export function money(cents: number, currency: string) {
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100); } catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
}

/** A pay link with the amount filled in, where the app supports it. */
export function payLink(e: Entry, cents: number, currency: string, note: string): string | null {
    const amount = (cents / 100).toFixed(2).replace(/\.00$/, "");
    const t = tidy(e);
    switch (e.kind) {
        case "paypal": return /paypal\.me\//i.test(t) ? `${t.replace(/\/$/, "")}/${amount}${currency}` : null;
        case "cashapp": return currency === "USD" ? `https://cash.app/${t}/${amount}` : linkFor(e);
        case "venmo": return currency === "USD" ? `https://venmo.com/?txn=pay&recipients=${encodeURIComponent(t.slice(1))}&amount=${amount}&note=${encodeURIComponent(note)}` : linkFor(e);
        default: return linkFor(e);
    }
}
