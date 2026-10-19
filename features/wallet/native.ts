/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

// How much is at one of your addresses, read from public blockchain
// explorers (nothing to sign in to, read-only), and today's coin prices from
// CoinGecko. Fetched here because Discord's page isn't allowed to contact
// these sites. Only ever these fixed addresses, with an address that's been
// checked to look right first.

const EVM_RPC: Record<string, string> = { eth: "https://ethereum-rpc.publicnode.com", base: "https://base-rpc.publicnode.com", bsc: "https://bsc-rpc.publicnode.com" };
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";

/** Token contracts, and how many decimal places they use. */
const TOKENS: Record<string, Record<string, [string, number]>> = {
    usdt: { eth: ["0xdAC17F958D2ee523a2206206994597C13D831ec7", 6], bsc: ["0x55d398326f99059fF775485246999027B3197955", 18], tron: ["TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", 6], sol: ["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", 6] },
    usdc: { eth: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6], base: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6], bsc: ["0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", 18], sol: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 6] },
};

const getJson = async (url: string) => {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status === 429) throw new Error("Too many checks — try again in a minute");
    if (!res.ok) throw new Error(`The explorer answered ${res.status}`);
    return res.json();
};
const rpc = async (url: string, method: string, params: unknown[]) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (res.status === 429) throw new Error("Too many checks — try again in a minute");
    if (!res.ok) throw new Error(`The network answered ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error.message ?? "The network said no");
    return j.result;
};

/** A big whole number (wei, satoshis…) as a coin amount. */
const units = (raw: bigint, decimals: number) => {
    const s = raw.toString().padStart(decimals + 1, "0");
    return Number(`${s.slice(0, -decimals) || "0"}.${s.slice(-decimals)}`);
};

const ok = (v: string) => /^[A-Za-z0-9]{25,90}$/.test(v);

export async function walletBalance(_: IpcMainInvokeEvent, kind: string, network: string | undefined, address: string): Promise<{ ok: true; amount: number; } | { ok: false; error: string; }> {
    try {
        const a = String(address).trim();
        if (!ok(a)) return { ok: false, error: "That address doesn't look right" };
        switch (kind) {
            case "btc": case "ltc": {
                // Bitcoin and Litecoin: what came in minus what went out, including what's still on its way.
                const j = await getJson(`${kind === "btc" ? "https://mempool.space" : "https://litecoinspace.org"}/api/address/${a}`);
                const sum = (s: any) => BigInt(s?.funded_txo_sum ?? 0) - BigInt(s?.spent_txo_sum ?? 0);
                return { ok: true, amount: units(sum(j.chain_stats) + sum(j.mempool_stats), 8) };
            }
            case "eth":
                return { ok: true, amount: units(BigInt(await rpc(EVM_RPC.eth, "eth_getBalance", [a, "latest"])), 18) };
            case "sol":
                return { ok: true, amount: Number((await rpc(SOLANA_RPC, "getBalance", [a]))?.value ?? 0) / 1e9 };
            case "usdt": case "usdc": {
                const token = TOKENS[kind]?.[network ?? ""];
                if (!token) return { ok: false, error: "Pick the network first" };
                const [contract, decimals] = token;
                if (network === "tron") {
                    const j = await getJson(`https://api.trongrid.io/v1/accounts/${a}`);
                    const list: Record<string, string>[] = j?.data?.[0]?.trc20 ?? [];
                    const raw = list.map(x => x[contract]).find(Boolean) ?? "0";
                    return { ok: true, amount: units(BigInt(raw), decimals) };
                }
                if (network === "sol") {
                    const r = await rpc(SOLANA_RPC, "getTokenAccountsByOwner", [a, { mint: contract }, { encoding: "jsonParsed" }]);
                    const amount = (r?.value ?? []).reduce((n: number, acc: any) => n + (Number(acc?.account?.data?.parsed?.info?.tokenAmount?.uiAmount) || 0), 0);
                    return { ok: true, amount };
                }
                const url = EVM_RPC[network ?? ""];
                if (!url || !/^0x[0-9a-fA-F]{40}$/.test(a)) return { ok: false, error: "That address doesn't look right" };
                // balanceOf(address)
                const data = "0x70a08231" + a.slice(2).toLowerCase().padStart(64, "0");
                return { ok: true, amount: units(BigInt(await rpc(url, "eth_call", [{ to: contract, data }, "latest"]) || "0x0"), decimals) };
            }
        }
        return { ok: false, error: "No balance for this kind" };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Couldn't check" };
    }
}

const GECKO: Record<string, string> = { btc: "bitcoin", eth: "ethereum", sol: "solana", ltc: "litecoin", usdt: "tether", usdc: "usd-coin" };

/** Today's price of the wallet's coins, in one currency. */
export async function walletPrices(_: IpcMainInvokeEvent, currency: string): Promise<{ ok: true; prices: Record<string, number>; } | { ok: false; error: string; }> {
    try {
        const cur = /^[a-z]{3}$/i.test(currency) ? currency.toLowerCase() : "usd";
        const j = await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(GECKO).join(",")}&vs_currencies=${cur}`);
        const prices: Record<string, number> = {};
        for (const [k, id] of Object.entries(GECKO)) if (typeof j?.[id]?.[cur] === "number") prices[k] = j[id][cur];
        return { ok: true, prices };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Couldn't get prices" };
    }
}
