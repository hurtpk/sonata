/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Checking a crypto address is real before it's saved: every kind of address
// carries a checksum, so one wrong letter is caught. No Discord in here.

/* ── Base58 (Bitcoin, Litecoin, Solana, Tron) ── */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58(s: string): Uint8Array | null {
    let n = 0n;
    for (const ch of s) {
        const v = B58.indexOf(ch);
        if (v < 0) return null;
        n = n * 58n + BigInt(v);
    }
    const bytes: number[] = [];
    while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
    for (const ch of s) { if (ch !== "1") break; bytes.unshift(0); }
    return Uint8Array.from(bytes);
}

const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource));

/** The version byte of a Base58Check address whose checksum is right, or null. */
export async function base58check(s: string): Promise<{ version: number; length: number; } | null> {
    const b = base58(s);
    if (!b || b.length < 5) return null;
    const body = b.slice(0, -4), sum = b.slice(-4);
    const hash = await sha256(await sha256(body));
    for (let i = 0; i < 4; i++) if (hash[i] !== sum[i]) return null;
    return { version: body[0], length: body.length };
}

/* ── Bech32 / Bech32m (bc1…, ltc1…) ── */

const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values: number[]) {
    const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of values) {
        const top = chk >>> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ v;
        for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i];
    }
    return chk >>> 0;
}

/** A segwit address for this prefix ("bc", "ltc") with a right checksum. */
export function segwit(addr: string, hrp: string): boolean {
    const s = addr.toLowerCase();
    if (addr !== s && addr !== addr.toUpperCase()) return false;
    const at = s.lastIndexOf("1");
    if (s.slice(0, at) !== hrp || at + 7 > s.length || s.length > 90) return false;
    const data: number[] = [];
    for (const ch of s.slice(at + 1)) { const v = B32.indexOf(ch); if (v < 0) return false; data.push(v); }
    const expand = [...[...hrp].map(c => c.charCodeAt(0) >> 5), 0, ...[...hrp].map(c => c.charCodeAt(0) & 31)];
    const check = polymod([...expand, ...data]);
    const version = data[0];
    // Version 0 uses bech32, newer ones (Taproot) bech32m.
    if (check !== (version === 0 ? 1 : 0x2bc830a3)) return false;
    // The rest is the witness program, 5 bits per letter.
    const bits = data.slice(1, -6);
    let acc = 0, n = 0;
    const prog: number[] = [];
    for (const v of bits) { acc = (acc << 5) | v; n += 5; while (n >= 8) { n -= 8; prog.push((acc >> n) & 255); } }
    if (n >= 5 || (acc & ((1 << n) - 1))) return false;
    if (version > 16 || prog.length < 2 || prog.length > 40) return false;
    return version !== 0 || prog.length === 20 || prog.length === 32;
}

/* ── Keccak-256, for Ethereum's mixed-case checksum (EIP-55) ── */

const RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
    0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
    0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const M64 = (1n << 64n) - 1n;
const rotl = (x: bigint, n: number) => n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64;

function keccakF(s: bigint[]) {
    for (let round = 0; round < 24; round++) {
        const c = [0, 1, 2, 3, 4].map(x => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
        for (let x = 0; x < 5; x++) {
            const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
            for (let y = 0; y < 25; y += 5) s[x + y] ^= d;
        }
        const b = new Array<bigint>(25);
        for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + ((2 * x + 3 * y) % 5) * 5] = rotl(s[x + 5 * y], ROT[x + 5 * y]);
        for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = b[x + 5 * y] ^ (~b[(x + 1) % 5 + 5 * y] & M64 & b[(x + 2) % 5 + 5 * y]);
        s[0] ^= RC[round];
    }
}

export function keccak256(input: Uint8Array): Uint8Array {
    const rate = 136;
    const padded = new Uint8Array(Math.ceil((input.length + 1) / rate) * rate);
    padded.set(input);
    padded[input.length] ^= 0x01;
    padded[padded.length - 1] ^= 0x80;
    const s = new Array<bigint>(25).fill(0n);
    for (let off = 0; off < padded.length; off += rate) {
        for (let i = 0; i < rate / 8; i++) {
            let lane = 0n;
            for (let j = 7; j >= 0; j--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + j]);
            s[i] ^= lane;
        }
        keccakF(s);
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((s[i] >> BigInt(8 * j)) & 255n);
    return out;
}

/** "ok" (checksum right), "unchecked" (all one case, so there's no checksum to check), or "bad". */
export function ethChecksum(addr: string): "ok" | "unchecked" | "bad" {
    const hex = addr.slice(2);
    if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return "unchecked";
    const hash = keccak256(new TextEncoder().encode(hex.toLowerCase()));
    for (let i = 0; i < 40; i++) {
        const nibble = (hash[i >> 1] >> (i % 2 ? 0 : 4)) & 15;
        const ch = hex[i];
        if (/[a-f]/i.test(ch) && (nibble >= 8) !== (ch === ch.toUpperCase())) return "bad";
    }
    return "ok";
}

export const toHex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, "0")).join("");
