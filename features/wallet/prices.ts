/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Coin prices (kept two minutes) and address balances (only when you ask),
// plus reading "0.01 btc" or "$50 in eth" for the what's-it-worth box.

import { useEffect, useState } from "@webpack/common";

import { callNative } from "../_shared/native";
import { Entry, KindId, kindOf, tidy } from "./kinds";

export const COINS: KindId[] = ["btc", "eth", "sol", "ltc", "usdt", "usdc"];
const NAMES: Record<string, KindId> = {
    btc: "btc", bitcoin: "btc", bitcoins: "btc", xbt: "btc", eth: "eth", ether: "eth", ethereum: "eth", sol: "sol", solana: "sol",
    ltc: "ltc", litecoin: "ltc", usdt: "usdt", tether: "usdt", usdc: "usdc",
};

let prices: { at: number; map: Record<string, number>; } | null = null;
let asking: Promise<Record<string, number> | null> | null = null;

export function getPrices(): Promise<Record<string, number> | null> {
    if (prices && Date.now() - prices.at < 2 * 60_000) return Promise.resolve(prices.map);
    asking ??= (callNative("walletPrices", "usd") as Promise<any>).then(r => {
        asking = null;
        if (!r?.ok) return prices?.map ?? null;
        prices = { at: Date.now(), map: r.prices };
        return r.prices;
    }, () => { asking = null; return prices?.map ?? null; });
    return asking;
}

export function usePrices() {
    const [map, setMap] = useState<Record<string, number> | null>(prices?.map ?? null);
    useEffect(() => { let alive = true; void getPrices().then(m => alive && setMap(m)); return () => { alive = false; }; }, []);
    return map;
}

export const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n);
export const coinAmount = (n: number) => n === 0 ? "0" : n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : n.toPrecision(4).replace(/\.?0+$/, "");

/** "0.01 btc" → worth in USD, "$50 in eth" / "50 usd to sol" → how much of the coin. */
export function readAsk(text: string): { coin: KindId; amount: number; dir: "toUsd" | "toCoin"; } | null {
    const t = text.trim().toLowerCase().replace(/,/g, "");
    let m = t.match(/^(\d*\.?\d+)\s*([a-z]+)$/);
    if (m && NAMES[m[2]]) return { coin: NAMES[m[2]], amount: Number(m[1]), dir: "toUsd" };
    m = t.match(/^([a-z]+)$/);
    if (m && NAMES[m[1]]) return { coin: NAMES[m[1]], amount: 1, dir: "toUsd" };
    m = t.match(/^(?:\$\s*(\d*\.?\d+)|(\d*\.?\d+)\s*(?:usd|dollars?|\$))\s*(?:in|to|into|of)?\s*([a-z]+)$/);
    if (m && NAMES[m[3]]) return { coin: NAMES[m[3]], amount: Number(m[1] ?? m[2]), dir: "toCoin" };
    return null;
}

/* ── Balances ── */

const balances = new Map<string, { at: number; p: Promise<{ ok: true; amount: number; } | { ok: false; error: string; }>; }>();

export function checkBalance(e: Entry, fresh = false) {
    const key = `${e.kind}:${e.network ?? ""}:${tidy(e)}`;
    const hit = balances.get(key);
    if (hit && !fresh && Date.now() - hit.at < 5 * 60_000) return hit.p;
    const p = (callNative("walletBalance", e.kind, e.network, tidy(e)) as Promise<any>).catch(() => ({ ok: false, error: "Couldn't check" }));
    balances.set(key, { at: Date.now(), p });
    return p;
}

export const hasBalance = (e: Entry) => kindOf(e.kind).crypto;
