/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What the wallet can hold, and how to check each one: payment apps by
// username or link, crypto by address (with its checksum), Roblox by name.

import { base58, base58check, ethChecksum, segwit } from "./check";

export type KindId = "paypal" | "cashapp" | "venmo" | "zelle" | "btc" | "eth" | "sol" | "ltc" | "usdt" | "usdc" | "roblox";

export interface Network { id: string; name: string; /** How its addresses are checked. */ style: "evm" | "tron" | "solana"; }

export interface Kind {
    id: KindId;
    name: string;
    /** Typed as ;word in chat to put it in. */
    word: string;
    crypto: boolean;
    color: string;
    glyph: string;
    placeholder: string;
    hint: string;
    networks?: Network[];
}

const EVM = (id: string, name: string): Network => ({ id, name, style: "evm" });
export const KINDS: Kind[] = [
    { id: "paypal", name: "PayPal", word: "paypal", crypto: false, color: "#003087", glyph: "P", placeholder: "paypal.me/yourname, username or email", hint: "Your paypal.me link or name, or the email on your PayPal." },
    { id: "cashapp", name: "Cash App", word: "cashapp", crypto: false, color: "#00d64f", glyph: "$", placeholder: "$yourcashtag", hint: "Your $cashtag (or your cash.app link)." },
    { id: "venmo", name: "Venmo", word: "venmo", crypto: false, color: "#008cff", glyph: "V", placeholder: "@your-venmo", hint: "Your @username (or your venmo.com link)." },
    { id: "zelle", name: "Zelle", word: "zelle", crypto: false, color: "#6d1ed4", glyph: "Z", placeholder: "Email or phone number", hint: "The email or US phone number your Zelle uses." },
    { id: "btc", name: "Bitcoin", word: "btc", crypto: true, color: "#f7931a", glyph: "₿", placeholder: "bc1… / 1… / 3…", hint: "A Bitcoin address — starts with bc1, 1 or 3." },
    { id: "eth", name: "Ethereum", word: "eth", crypto: true, color: "#627eea", glyph: "Ξ", placeholder: "0x…", hint: "An Ethereum address — 0x and 40 letters and numbers." },
    { id: "sol", name: "Solana", word: "sol", crypto: true, color: "#9945ff", glyph: "◎", placeholder: "Your Solana address", hint: "A Solana address — 32 to 44 letters and numbers." },
    { id: "ltc", name: "Litecoin", word: "ltc", crypto: true, color: "#345d9d", glyph: "Ł", placeholder: "ltc1… / L… / M…", hint: "A Litecoin address — starts with ltc1, L or M." },
    {
        id: "usdt", name: "USDT", word: "usdt", crypto: true, color: "#26a17b", glyph: "₮", placeholder: "Your USDT address", hint: "Pick the network first — sending on the wrong one loses the money.",
        networks: [EVM("eth", "Ethereum (ERC-20)"), { id: "tron", name: "Tron (TRC-20)", style: "tron" }, { id: "sol", name: "Solana (SPL)", style: "solana" }, EVM("bsc", "BNB Chain (BEP-20)")],
    },
    {
        id: "usdc", name: "USDC", word: "usdc", crypto: true, color: "#2775ca", glyph: "$", placeholder: "Your USDC address", hint: "Pick the network first — sending on the wrong one loses the money.",
        networks: [EVM("eth", "Ethereum (ERC-20)"), { id: "sol", name: "Solana (SPL)", style: "solana" }, EVM("base", "Base"), EVM("bsc", "BNB Chain (BEP-20)")],
    },
    { id: "roblox", name: "Roblox", word: "roblox", crypto: false, color: "#e2231a", glyph: "◆", placeholder: "Your Roblox username", hint: "Your Roblox username — add a game pass, shirt or other catalog item link too, so people can pay you in Robux." },
];
export const kindOf = (id: KindId) => KINDS.find(k => k.id === id)!;

export interface Entry {
    id: string;
    kind: KindId;
    value: string;
    network?: string;
    label?: string;
    note?: string;
    /** Roblox: a game pass, catalog item (shirt, pants…) or bundle people can buy to pay you. */
    pass?: string;
}

const ROBLOX_ITEM = /^(?:https?:\/\/)?(?:www\.)?roblox\.com\/(game-pass|catalog|bundles)\/\d+/i;

/** "Game pass", "Catalog item" or "Bundle", from a Roblox link. */
export function robloxItemKind(link: string) {
    const m = link.trim().match(ROBLOX_ITEM);
    return !m ? "Item" : m[1].toLowerCase() === "game-pass" ? "Game pass" : m[1].toLowerCase() === "bundles" ? "Bundle" : "Catalog item";
}

export interface Check { ok: boolean; message?: string; /** Saved anyway, but worth a look. */ warn?: boolean; }

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const digits = (s: string) => s.replace(/\D/g, "");

async function cryptoCheck(style: "btc" | "ltc" | "evm" | "tron" | "solana", v: string): Promise<Check> {
    switch (style) {
        case "btc":
            if (/^bc1/i.test(v)) return segwit(v, "bc") ? { ok: true } : { ok: false, message: "That bc1… address has a typo — its checksum doesn't match." };
            if (/^[13]/.test(v)) { const r = await base58check(v); return r && r.length === 21 && (r.version === 0 || r.version === 5) ? { ok: true } : { ok: false, message: "That address has a typo — its checksum doesn't match." }; }
            return { ok: false, message: "Bitcoin addresses start with bc1, 1 or 3." };
        case "ltc":
            if (/^ltc1/i.test(v)) return segwit(v, "ltc") ? { ok: true } : { ok: false, message: "That ltc1… address has a typo — its checksum doesn't match." };
            if (/^[LM3]/.test(v)) { const r = await base58check(v); return r && r.length === 21 && [0x30, 0x32, 0x05].includes(r.version) ? { ok: true } : { ok: false, message: "That address has a typo — its checksum doesn't match." }; }
            return { ok: false, message: "Litecoin addresses start with ltc1, L or M." };
        case "evm": {
            if (!/^0x[0-9a-f]{40}$/i.test(v)) return { ok: false, message: "This kind of address is 0x followed by 40 letters (a–f) and numbers." };
            const c = ethChecksum(v);
            if (c === "bad") return { ok: false, message: "That address has a typo — its capital letters don't match its checksum." };
            return c === "ok" ? { ok: true } : { ok: true, warn: true, message: "All one case, so it can't be checked for typos — copy it straight from your wallet app." };
        }
        case "tron": {
            const r = /^T/.test(v) ? await base58check(v) : null;
            return r && r.version === 0x41 && r.length === 21 ? { ok: true } : { ok: false, message: "Tron addresses start with T and are 34 letters — this one has a typo." };
        }
        case "solana":
            return base58(v)?.length === 32 ? { ok: true } : { ok: false, message: "That isn't a Solana address (they're 32–44 letters and numbers, no 0, O, I or l)." };
    }
}

/** Is this entry's value right for its kind (and network)? */
export async function check(e: Pick<Entry, "kind" | "value" | "network" | "pass">): Promise<Check> {
    const v = e.value.trim();
    if (!v) return { ok: false, message: "Fill this in." };
    switch (e.kind) {
        case "paypal":
            return /^(?:https?:\/\/)?(?:www\.)?paypal\.me\/[A-Za-z0-9]{1,20}\/?$/i.test(v) || /^@?[A-Za-z0-9]{1,20}$/.test(v) || EMAIL.test(v)
                ? { ok: true } : { ok: false, message: "Use your paypal.me link, your PayPal username or its email." };
        case "cashapp":
            return /^(?:(?:https?:\/\/)?(?:www\.)?cash\.app\/)?\$?(?=[A-Za-z0-9_]*[A-Za-z])[A-Za-z0-9_]{1,20}\/?$/.test(v)
                ? { ok: true } : { ok: false, message: "A $cashtag is up to 20 letters and numbers, like $yourname." };
        case "venmo":
            return /^(?:(?:https?:\/\/)?(?:www\.|account\.)?venmo\.com\/(?:u\/)?)?@?[A-Za-z0-9_-]{5,30}\/?$/.test(v)
                ? { ok: true } : { ok: false, message: "A Venmo username is 5–30 letters, numbers, - or _." };
        case "zelle":
            if (EMAIL.test(v)) return { ok: true };
            return /^\+?1?\d{10}$/.test(digits(v)) && /^[\d\s()+.-]+$/.test(v) ? { ok: true } : { ok: false, message: "Zelle uses an email or a US phone number." };
        case "roblox":
            if (!/^(?!_)(?!.*_.*_)[A-Za-z0-9_]{3,20}(?<!_)$/.test(v)) return { ok: false, message: "Roblox usernames are 3–20 letters and numbers, with at most one _ in the middle." };
            if (e.pass?.trim() && !ROBLOX_ITEM.test(e.pass.trim())) return { ok: false, message: "The link should look like roblox.com/game-pass/12345, roblox.com/catalog/12345 or roblox.com/bundles/12345." };
            return { ok: true };
        case "btc": return cryptoCheck("btc", v);
        case "ltc": return cryptoCheck("ltc", v);
        case "eth": return cryptoCheck("evm", v);
        case "sol": return cryptoCheck("solana", v);
        case "usdt": case "usdc": {
            const net = kindOf(e.kind).networks!.find(n => n.id === e.network);
            if (!net) return { ok: false, message: "Pick which network this address is on." };
            return cryptoCheck(net.style, v);
        }
    }
}

/** The same thing written the usual way ($tag, @name, a full link). */
export function tidy(e: Entry): string {
    const v = e.value.trim();
    switch (e.kind) {
        case "paypal": {
            const m = v.match(/paypal\.me\/([A-Za-z0-9]+)/i);
            return m ? `https://paypal.me/${m[1]}` : EMAIL.test(v) ? v : `https://paypal.me/${v.replace(/^@/, "")}`;
        }
        case "cashapp": return "$" + v.replace(/^.*cash\.app\//i, "").replace(/^\$/, "").replace(/\/$/, "");
        case "venmo": return "@" + v.replace(/^.*venmo\.com\/(?:u\/)?/i, "").replace(/^@/, "").replace(/\/$/, "");
        default: return v;
    }
}

/** A link that opens it, when there is one. */
export function linkFor(e: Entry): string | null {
    const t = tidy(e);
    switch (e.kind) {
        case "paypal": return t.startsWith("http") ? t : null;
        case "cashapp": return `https://cash.app/${t}`;
        case "venmo": return `https://venmo.com/u/${t.slice(1)}`;
        case "roblox": return e.pass?.trim() ? (e.pass.startsWith("http") ? e.pass.trim() : `https://${e.pass.trim()}`) : null;
        default: return null;
    }
}

/** What a QR code for it should hold (wallet apps open these). */
export function qrFor(e: Entry): string {
    const t = tidy(e);
    switch (e.kind) {
        case "btc": return `bitcoin:${t}`;
        case "ltc": return `litecoin:${t}`;
        case "eth": return `ethereum:${t}`;
        case "sol": return `solana:${t}`;
        default: return linkFor(e) ?? t;
    }
}

export const networkName = (e: Entry) => e.network ? kindOf(e.kind).networks?.find(n => n.id === e.network)?.name : undefined;

/** "Bitcoin", "USDT (Tron (TRC-20))" → "USDT · Tron (TRC-20)", plus your label. */
export function title(e: Entry) {
    const k = kindOf(e.kind), net = networkName(e);
    return `${k.name}${net ? ` · ${net}` : ""}${e.label ? ` — ${e.label}` : ""}`;
}

/** How it reads in a chat message. */
export function chatLine(e: Entry) {
    const k = kindOf(e.kind), net = networkName(e);
    const name = `**${k.name}${net ? ` on ${net}` : ""}${e.label ? ` — ${e.label}` : ""}:**`;
    if (k.crypto) return `${name} \`${tidy(e)}\``;
    if (e.kind === "roblox") return `${name} ${tidy(e)}${e.pass?.trim() ? ` · ${robloxItemKind(e.pass).toLowerCase()}: ${linkFor(e)}` : ""}`;
    return `${name} ${linkFor(e) ?? tidy(e)}`;
}

/* ── Spotting a swapped address ── */

/** Things in a message that look like crypto addresses. */
export const ADDRESS_LIKE = /\b(?:0x[0-9a-fA-F]{40}|bc1[02-9ac-hj-np-z]{11,71}|ltc1[02-9ac-hj-np-z]{11,71}|[13LMT][1-9A-HJ-NP-Za-km-z]{25,34}|[1-9A-HJ-NP-Za-km-z]{32,44})\b/g;

/** A saved address this one is pretending to be (same start and end, different middle). */
export function lookalike(found: string, saved: string[]): string | null {
    if (saved.includes(found)) return null;
    const f = found.toLowerCase();
    for (const s of saved) {
        const t = s.toLowerCase();
        if (f === t || Math.abs(f.length - t.length) > 2) continue;
        if (f.slice(0, 4) === t.slice(0, 4) && f.slice(-4) === t.slice(-4)) return s;
    }
    return null;
}
