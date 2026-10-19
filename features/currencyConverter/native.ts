/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

// Exchange rates for Currency Converter, from open.er-api.com (free, no key).
// Fetched here because Discord's page isn't allowed to contact other sites.
// Only ever this one URL, with a 3-letter currency code.

export async function fetchExchangeRates(_: IpcMainInvokeEvent, base: string): Promise<{ ok: boolean; rates?: Record<string, number>; error?: string; }> {
    if (!/^[A-Z]{3}$/.test(base)) return { ok: false, error: "Bad currency code" };
    try {
        const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        const json = await res.json();
        if (json?.result !== "success" || typeof json.rates !== "object") return { ok: false, error: "Unexpected reply" };
        const rates: Record<string, number> = {};
        for (const [code, v] of Object.entries(json.rates)) if (/^[A-Z]{3}$/.test(code) && typeof v === "number") rates[code] = v;
        return { ok: true, rates };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Couldn't connect" };
    }
}

// ─── Crypto and stock prices (CoinGecko and Yahoo Finance, both free with no key) ───

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const getJson = async (url: string) => {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
    if (res.status === 429) throw new Error("Too many price checks — try again in a minute");
    if (!res.ok) throw new Error(`Price service answered ${res.status}`);
    return res.json();
};

const COINS: Record<string, string> = {
    btc: "bitcoin", xbt: "bitcoin", eth: "ethereum", sol: "solana", doge: "dogecoin", xrp: "ripple", ada: "cardano", ltc: "litecoin", bnb: "binancecoin",
    usdt: "tether", usdc: "usd-coin", dot: "polkadot", avax: "avalanche-2", shib: "shiba-inu", pepe: "pepe", trx: "tron", link: "chainlink", pol: "polygon-ecosystem-token",
    matic: "polygon-ecosystem-token", ton: "the-open-network", xmr: "monero", bch: "bitcoin-cash", near: "near", atom: "cosmos", sui: "sui", apt: "aptos", arb: "arbitrum",
    op: "optimism", xlm: "stellar", etc: "ethereum-classic", hbar: "hedera-hashgraph", fil: "filecoin", uni: "uniswap", aave: "aave", wif: "dogwifcoin", bonk: "bonk",
};

export interface CryptoPrice { id: string; name: string; symbol: string; prices: Record<string, number>; change24h: number | null; }

export async function fetchCrypto(_: IpcMainInvokeEvent, query: string, vs: string[]): Promise<{ ok: true; coin: CryptoPrice; } | { ok: false; error: string; }> {
    try {
        const q = String(query).trim().toLowerCase().replace(/[^a-z0-9 -]/g, "");
        if (!q) return { ok: false, error: "Which coin?" };
        let id = COINS[q], name = "", symbol = q.toUpperCase();
        if (!id) {
            const s = await getJson(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`);
            const hit = (s?.coins ?? []).find((c: any) => c.symbol?.toLowerCase() === q) ?? s?.coins?.[0];
            if (!hit) return { ok: false, error: `No coin called “${query}”` };
            id = hit.id; name = hit.name; symbol = String(hit.symbol).toUpperCase();
        }
        const cur = [...new Set(vs.map(v => v.toLowerCase()).filter(v => /^[a-z]{3}$/.test(v)))].slice(0, 8).join(",") || "usd";
        const p = await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=${cur}&include_24hr_change=true`);
        const row = p?.[id];
        if (!row) return { ok: false, error: "No price for that coin right now" };
        const prices: Record<string, number> = {};
        for (const [k, v] of Object.entries(row)) if (!k.endsWith("_24h_change") && typeof v === "number") prices[k.toUpperCase()] = v;
        const firstVs = cur.split(",")[0];
        return { ok: true, coin: { id, name: name || id.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()), symbol, prices, change24h: typeof row[`${firstVs}_24h_change`] === "number" ? row[`${firstVs}_24h_change`] : null } };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Couldn't get the price" };
    }
}

export interface StockPrice { symbol: string; name: string; price: number; currency: string; changePct: number | null; exchange: string; time: number; }

export async function fetchStock(_: IpcMainInvokeEvent, query: string): Promise<{ ok: true; stock: StockPrice; } | { ok: false; error: string; }> {
    try {
        let q = String(query).trim().replace(/^\$/, "");
        if (!q) return { ok: false, error: "Which stock?" };
        // A ticker (AAPL, BRK-B, VOD.L) goes straight in; a name (tesla) is looked up first.
        if (!/^[A-Za-z]{1,5}([.-][A-Za-z]{1,2})?$/.test(q) || q === q.toLowerCase() && q.length > 4) {
            const s = await getJson(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=5&newsCount=0`);
            const hit = (s?.quotes ?? []).find((x: any) => ["EQUITY", "ETF", "INDEX", "MUTUALFUND"].includes(x.quoteType));
            if (!hit) return { ok: false, error: `No stock called “${query}”` };
            q = hit.symbol;
        }
        const c = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(q.toUpperCase())}?range=1d&interval=1d`);
        const m = c?.chart?.result?.[0]?.meta;
        if (!m?.regularMarketPrice) return { ok: false, error: `No price for ${q.toUpperCase()}` };
        const prev = m.chartPreviousClose ?? m.previousClose;
        // London (pence), Johannesburg and Tel Aviv quote in hundredths: turn them into the real currency.
        const minor: Record<string, string> = { GBp: "GBP", GBX: "GBP", ZAc: "ZAR", ILA: "ILS" };
        const unit = minor[m.currency] ? 100 : 1;
        return {
            ok: true,
            stock: {
                symbol: m.symbol, name: m.longName ?? m.shortName ?? m.symbol, price: m.regularMarketPrice / unit, currency: minor[m.currency] ?? m.currency ?? "USD",
                changePct: typeof m.regularMarketChangePercent === "number" ? m.regularMarketChangePercent : prev ? (m.regularMarketPrice / prev - 1) * 100 : null,
                exchange: m.fullExchangeName ?? m.exchangeName ?? "", time: (m.regularMarketTime ?? 0) * 1000,
            },
        };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Couldn't get the price" };
    }
}
