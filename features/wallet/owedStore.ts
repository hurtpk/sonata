/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Who owes you: one line per thing someone owes ("Sam · $12 · pizza"), what
// they've paid back so far, and when it's settled. A person is a Discord
// user (picked by search, ID or from your friends) or just a typed name.
// Kept on this computer next to the wallet, never in settings.

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

export interface Debt {
    id: string;
    /** Their Discord ID, when they're a Discord user. */
    userId?: string;
    name: string;
    username?: string;
    avatar?: string | null;
    /** In cents. */
    amount: number;
    /** Paid back so far, in cents. */
    paid: number;
    currency: string;
    note: string;
    createdAt: number;
    /** Optional: when they said they'd pay by (midday that day). */
    dueAt?: number;
    settledAt?: number;
}

const KEY = "Sonata_walletOwed";
let list: Debt[] = [];
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const save = () => { void DataStore.set(KEY, list); listeners.forEach(l => l()); };

export const loadOwed = () => loaded ??= DataStore.get<Debt[]>(KEY).then(v => { list = v ?? []; listeners.forEach(l => l()); }).catch(() => { });

export function useOwed() {
    const [, bump] = useState(0);
    useEffect(() => { void loadOwed(); const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    return list;
}

/** What's still owed on a line, in cents. */
export const left = (d: Debt) => d.settledAt ? 0 : Math.max(0, d.amount - d.paid);

/** One person's lines go together: by Discord ID, or by name for people typed in. */
export const personKey = (d: Pick<Debt, "userId" | "name">) => d.userId ? `u:${d.userId}` : `n:${d.name.trim().toLowerCase()}`;

export function addDebt(d: Omit<Debt, "id" | "paid" | "createdAt">) {
    list = [{ ...d, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, paid: 0, createdAt: Date.now() }, ...list];
    save();
}

export function patchDebt(id: string, patch: Partial<Debt>) {
    list = list.map(d => d.id === id ? { ...d, ...patch } : d);
    save();
}

/** They paid some of it back; settles the line once it's all paid. */
export function payPart(id: string, cents: number) {
    list = list.map(d => {
        if (d.id !== id) return d;
        const paid = Math.min(d.amount, d.paid + cents);
        return { ...d, paid, settledAt: paid >= d.amount ? Date.now() : d.settledAt };
    });
    save();
}

export function settle(id: string, on: boolean) {
    list = list.map(d => d.id !== id ? d : on ? { ...d, paid: d.amount, settledAt: Date.now() } : { ...d, paid: 0, settledAt: undefined });
    save();
}

export function settleAll(key: string) {
    const now = Date.now();
    list = list.map(d => personKey(d) === key && !d.settledAt ? { ...d, paid: d.amount, settledAt: now } : d);
    save();
}

export function removeDebt(id: string) {
    list = list.filter(d => d.id !== id);
    save();
}

/** "$20 · €5": what's still owed, per currency. */
export function totals(debts: Debt[]) {
    const by: Record<string, number> = {};
    for (const d of debts) { const l = left(d); if (l) by[d.currency] = (by[d.currency] ?? 0) + l; }
    return by;
}
