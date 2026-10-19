/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Crypto amounts in messages — "0.01 btc", "2.5 eth", "100 usdt" — shown in
// your currency at today's price. Only well-known coin names count, so
// everyday words that are also coins ("link", "near", "ton") are left alone.
// Prices are checked once a coin shows up on screen, and kept two minutes.

import { callNative } from "../_shared/native";

const COIN = String.raw`(btc|bitcoins?|eth|ether|ethereum|sol|solana|ltc|litecoin|usdt|usdc|doge|dogecoin|xmr|monero|bnb|xrp)`;
const IN_TEXT = new RegExp(String.raw`(?<![\w.$])(\d[\d,]*(?:\.\d+)?|\.\d+)\s?${COIN}(?![\w])`, "gi");

/** Coin names to what the price service calls them. */
const QUERY: Record<string, string> = { bitcoin: "btc", bitcoins: "btc", ether: "eth", ethereum: "eth", solana: "sol", litecoin: "ltc", dogecoin: "doge", monero: "xmr" };

export interface CoinAmount { text: string; amount: number; coin: string; }

export function findCoins(text: string): CoinAmount[] {
    const out: CoinAmount[] = [];
    for (const m of (text ?? "").matchAll(IN_TEXT)) {
        const amount = Number(m[1].replace(/,/g, ""));
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const word = m[2].toLowerCase();
        out.push({ text: m[0], amount, coin: QUERY[word] ?? word });
        if (out.length >= 4) break;
    }
    return out;
}

const prices = new Map<string, { at: number; p: Promise<number | null>; }>();

/** One coin's price in a currency (like "GBP"). */
export function coinPrice(coin: string, currency: string): Promise<number | null> {
    const key = `${coin}:${currency}`;
    const hit = prices.get(key);
    if (hit && Date.now() - hit.at < 2 * 60_000) return hit.p;
    const p = (callNative("fetchCrypto", coin, [currency]) as Promise<any>)
        .then(r => r?.ok ? r.coin.prices?.[currency.toUpperCase()] ?? null : null, () => null);
    prices.set(key, { at: Date.now(), p });
    return p;
}
