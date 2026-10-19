/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Robux ↔ money: what Robux cost to buy, and what they're worth cashed out
// through DevEx. Roblox's own published rates (US dollars); change them in
// Roblox Tools' settings if Roblox does.

export const ROBUX = {
    /** Buying: 400 Robux for $4.99 — about $0.0125 each (bigger packs are a little cheaper). */
    buy: 0.0125,
    /** Cashing out through the Developer Exchange: $0.0038 per Robux. */
    devex: 0.0038,
    /** Roblox keeps 30% of game pass, developer product and item sales. */
    fee: 0.3,
    /** The smallest amount you can cash out. */
    devexMin: 30_000,
};

export function setRobuxRates(r: Partial<typeof ROBUX>) { Object.assign(ROBUX, r); }

/** "50k robux", "R$ 1,000", "1000 rbx" → an amount of Robux. */
export function parseRobux(text: string): number | null {
    const m = text.trim().match(/^(?:r\$\s*([\d,.]+\s*[kmb]?)|([\d,.]+\s*[kmb]?)\s*(?:robux|rbx|r\$))$/i);
    if (!m) return null;
    return amount(m[1] ?? m[2]);
}

/** "$100 to robux", "50 eur in robux" → money to turn into Robux. */
export function parseToRobux(text: string): { amount: number; code: string; } | null {
    const m = text.trim().match(/^(?:([$€£])\s*([\d,.]+\s*[kmb]?)|([\d,.]+\s*[kmb]?)\s*([a-z]{3}))\s+(?:to|in|into)\s+(?:robux|rbx|r\$)$/i);
    if (!m) return null;
    const sym: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP" };
    return { amount: amount(m[2] ?? m[3]), code: m[1] ? sym[m[1]] : m[4].toUpperCase() };
}

function amount(s: string) {
    const t = s.replace(/[,\s]/g, "").toLowerCase();
    const k = t.endsWith("k") ? 1e3 : t.endsWith("m") ? 1e6 : t.endsWith("b") ? 1e9 : 1;
    return Number(t.replace(/[kmb]$/, "")) * k;
}

export interface RobuxRow { value: string; label: string; sub?: string; strong?: boolean; }

/** Converter rows for "50k robux" or "$100 to robux". */
export function robuxResult(text: string, o: {
    rates: { base: string; rates: Record<string, number>; } | null; mine: string;
    money(n: number, code: string): string; fmt(n: number): string;
}): { title: string; kind: string; rows: RobuxRow[]; note?: string; } | null {
    // US dollars → your currency (and back), from the Converter's exchange rates.
    const r = o.rates;
    const rate = (code: string) => !r ? NaN : code === r.base ? 1 : r.rates[code] ?? NaN;
    const usdTo = (usd: number, code: string) => usd / rate("USD") * rate(code);
    const both = (usd: number) => o.mine === "USD" || !Number.isFinite(usdTo(usd, o.mine)) ? o.money(usd, "USD") : `${o.money(usd, "USD")} · ${o.money(usdTo(usd, o.mine), o.mine)}`;
    const rbx = (n: number) => `R$ ${Math.round(n).toLocaleString()}`;

    const robux = parseRobux(text);
    if (robux != null && Number.isFinite(robux)) {
        const kept = robux * (1 - ROBUX.fee);
        return {
            title: rbx(robux), kind: "Robux",
            rows: [
                { value: both(robux * ROBUX.buy), label: "What it costs to buy", sub: `at about ${ROBUX.buy} each`, strong: true },
                { value: both(robux * ROBUX.devex), label: "What it's worth cashed out (DevEx)", sub: robux < ROBUX.devexMin ? `DevEx needs at least ${rbx(ROBUX.devexMin)}` : `at ${ROBUX.devex} each` },
                { value: `${rbx(kept)} · ${both(kept * ROBUX.devex)}`, label: "If it's from sales: what you keep", sub: `after Roblox's ${Math.round(ROBUX.fee * 100)}% cut, then cashed out` },
            ],
            note: "Roblox's published rates; bigger Robux packs and Premium cost a little less per Robux.",
        };
    }

    const want = parseToRobux(text);
    if (want && Number.isFinite(want.amount)) {
        const usd = want.code === "USD" ? want.amount : want.amount / rate(want.code) * rate("USD");
        if (!Number.isFinite(usd)) return { title: text, kind: "Robux", rows: [], note: "Getting exchange rates…" };
        const need = usd / ROBUX.devex;
        return {
            title: o.money(want.amount, want.code), kind: "Robux",
            rows: [
                { value: rbx(usd / ROBUX.buy), label: "Robux it buys", strong: true },
                { value: rbx(Math.max(need, ROBUX.devexMin)), label: "Robux needed to cash this out", sub: need < ROBUX.devexMin ? `DevEx starts at ${rbx(ROBUX.devexMin)} (${o.money(ROBUX.devexMin * ROBUX.devex, "USD")})` : "through DevEx" },
                { value: rbx(need / (1 - ROBUX.fee)), label: "Sales needed to earn that", sub: "before Roblox's 30% cut" },
            ],
            note: "Roblox's published rates (in US dollars).",
        };
    }
    return null;
}
