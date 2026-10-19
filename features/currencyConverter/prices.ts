/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Live crypto and stock prices for the Converter: "1 btc", "0.5 eth to eur",
// "$AAPL", "tesla stock", "10 nvda shares". Prices are checked when you ask,
// kept for a minute, and come from CoinGecko and Yahoo Finance.

import { useEffect, useState } from "@webpack/common";

import { callNative } from "../_shared/native";

// Coin names that are also everyday words or units (ton, link, near…) only count on the Crypto tab.
export const COIN_WORDS = new Set(["btc", "xbt", "bitcoin", "eth", "ether", "ethereum", "sol", "solana", "doge", "dogecoin", "xrp", "ada", "ltc", "bnb", "usdt", "usdc", "avax", "shib", "pepe", "trx", "matic", "xmr", "bch", "sui", "arb", "xlm", "hbar", "aave", "wif", "bonk", "litecoin", "cardano", "monero"]);

export type PriceAsk = { kind: "crypto"; amount: number; query: string; to?: string; } | { kind: "stock"; amount: number; query: string; };

const num = (s?: string) => s ? Number(s.replace(/,/g, "")) : 1;

/** Whether what you typed is asking for a crypto or stock price. */
export function askFor(text: string, mode: string): PriceAsk | null {
    const q = text.trim();
    if (!q) return null;
    const ticker = q.match(/^\$([A-Za-z]{1,5}(?:[.-][A-Za-z]{1,2})?)$/);
    if (ticker) return { kind: "stock", amount: 1, query: ticker[1] };
    const named = q.match(/^(?:([\d,.]+)\s+)?(.+?)\s+(?:stocks?|shares?)$/i);
    if (named) return { kind: "stock", amount: num(named[1]), query: named[2] };
    const coin = q.match(/^(?:([\d,]*\.?\d+)\s*)?([a-z][a-z0-9 -]{1,24}?)(?:\s+(?:to|in|into)\s+([a-z]{3}))?$/i);
    if (coin && (mode === "crypto" || COIN_WORDS.has(coin[2].toLowerCase()))) return { kind: "crypto", amount: num(coin[1]), query: coin[2], to: coin[3]?.toUpperCase() };
    if (mode === "stocks") {
        const m = q.match(/^(?:([\d,.]+)\s+)?(.+)$/);
        if (m) return { kind: "stock", amount: num(m[1]), query: m[2] };
    }
    return null;
}

const cache = new Map<string, { at: number; data: any; }>();

export function usePrice(ask: PriceAsk | null, vs: string[]) {
    const [state, setState] = useState<{ key: string; loading: boolean; data?: any; error?: string; }>({ key: "", loading: false });
    const key = ask ? `${ask.kind}:${ask.query.toLowerCase()}:${vs.join(",")}` : "";
    useEffect(() => {
        if (!ask) return;
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < 60_000) { setState({ key, loading: false, data: hit.data }); return; }
        setState({ key, loading: true });
        let alive = true;
        // A short wait, so typing "bitc…" doesn't check on every letter.
        const t = setTimeout(async () => {
            const r: any = ask.kind === "crypto" ? await callNative("fetchCrypto", ask.query, vs) : await callNative("fetchStock", ask.query);
            if (!alive) return;
            if (r?.ok) {
                const data = r.coin ?? r.stock;
                cache.set(key, { at: Date.now(), data });
                setState({ key, loading: false, data });
            } else setState({ key, loading: false, error: r?.error ?? "Couldn't get the price" });
        }, 450);
        return () => { alive = false; clearTimeout(t); };
    }, [key]);
    return state.key === key ? state : { key, loading: !!ask, data: undefined, error: undefined };
}

const pct = (n: number | null | undefined) => n == null ? "" : `${n >= 0 ? "▲" : "▼"} ${Math.abs(n).toFixed(2)}%`;

export interface PriceRow { value: string; label: string; sub?: string; strong?: boolean; }

/** The Converter's result for a price question. */
export function priceResult(ask: PriceAsk, price: ReturnType<typeof usePrice>, o: {
    q: string; mine: string; rates: { base: string; rates: Record<string, number>; } | null;
    money(n: number, code: string): string; fmt(n: number): string; currencyName(code: string): string;
}): { title: string; kind: string; rows: PriceRow[]; note?: string; } {
    const kind = ask.kind === "crypto" ? "Crypto" : "Stocks";
    // Tiny prices (meme coins at £0.000003) keep their digits instead of rounding to 0.00.
    const money = (v: number, code: string) => {
        if (Math.abs(v) >= 1 || v === 0) return o.money(v, code);
        try { return new Intl.NumberFormat(undefined, { style: "currency", currency: code, maximumSignificantDigits: 4 }).format(v); } catch { return `${v.toPrecision(4)} ${code}`; }
    };
    if (price.loading) return { title: o.q, kind, rows: [], note: "Checking the price…" };
    if (price.error || !price.data) return { title: o.q, kind, rows: [], note: price.error ?? "No price" };

    if (ask.kind === "crypto") {
        const c = price.data;
        const first = ask.to ?? o.mine;
        const order = Object.keys(c.prices).sort((a, b) => (a === first ? -1 : 0) - (b === first ? -1 : 0));
        return {
            title: `${o.fmt(ask.amount)} ${c.symbol} · ${c.name}`, kind,
            rows: order.map((code, i) => ({ value: money(ask.amount * c.prices[code], code), label: o.currencyName(code), sub: i === 0 && c.change24h != null ? `${pct(c.change24h)} in 24 h` : undefined, strong: i === 0 })),
            note: "Live price from CoinGecko; it changes all the time. Just the number, not advice.",
        };
    }

    const st = price.data;
    const r = o.rates;
    const toBase = r ? (st.currency === r.base ? 1 : 1 / (r.rates[st.currency] ?? NaN)) : NaN;
    const inMine = r && st.currency !== o.mine ? toBase * (o.mine === r.base ? 1 : r.rates[o.mine] ?? NaN) : NaN;
    const rows: PriceRow[] = [{ value: money(ask.amount * st.price, st.currency), label: ask.amount === 1 ? "One share" : `${o.fmt(ask.amount)} shares`, sub: st.changePct != null ? `${pct(st.changePct)} today` : undefined, strong: true }];
    if (Number.isFinite(inMine)) rows.push({ value: money(ask.amount * st.price * inMine, o.mine), label: `In ${o.currencyName(o.mine)}` });
    const when = st.time ? new Date(st.time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
    return {
        title: `${ask.amount !== 1 ? `${o.fmt(ask.amount)} × ` : ""}${st.symbol} · ${st.name}`, kind, rows,
        note: `${st.exchange ? `${st.exchange} · ` : ""}${when ? `as of ${when} ` : ""}(Yahoo Finance, may be delayed). Just the number, not advice.`,
    };
}
