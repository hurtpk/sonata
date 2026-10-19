/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Whisper's format: a normal "cover" message with the real one hidden after
// it as invisible characters. The hidden part starts with Sonata's own
// marker, then bytes written out two bits per invisible character:
//
//   version 1 (the first Whisper): one secret, no password or a password.
//   version 2: up to two secrets, each with its own lock — anyone with
//     Sonata, a password, or a paired friend — so one message can say one
//     thing to one group and another to another. Each is sealed with AES-GCM;
//     inside is the text and, if it was given one, when it stops opening.
//   3 and 4: a pair request and its reply, carrying a public key and who
//     it's for (no secret in them).
//
// Without Sonata, it's just the cover.

const ch = (...codes: number[]) => String.fromCharCode(...codes);
/** Sonata's marker: invisible separator and invisible plus (U+2063, U+2064), twice. */
const MARK = ch(0x2063, 0x2064, 0x2063, 0x2064);
/** Four characters that take up no space, one for each pair of bits. */
const DIGITS = [ch(0x200b), ch(0x200c), ch(0x200d), ch(0x2060)];
/** Any invisible characters left at the end of the cover. */
const TRAILING = new RegExp(`[${ch(0x200b)}-${ch(0x200d)}${ch(0x2060)}-${ch(0x2064)}]+$`);
const SALT = new TextEncoder().encode("Sonata Whisper v1");
export const LIMIT = 2000;

export const hasWhisper = (content: string | undefined) => !!content?.includes(MARK);
/** The message without the hidden part (what people without Sonata see). */
export const coverOf = (content: string) => content.split(MARK)[0].replace(TRAILING, "");

/* ── Keys from passwords ── */

const passwordKeys = new Map<string, Promise<CryptoKey>>();
export function passwordKey(password: string) {
    let k = passwordKeys.get(password);
    if (!k) {
        k = crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"])
            .then(base => crypto.subtle.deriveKey({ name: "PBKDF2", salt: SALT, iterations: 120_000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
        passwordKeys.set(password, k);
    }
    return k;
}

/* ── Invisible ink ── */

function toInvisible(bytes: Uint8Array) {
    let out = "";
    for (const b of bytes) out += DIGITS[b >> 6] + DIGITS[(b >> 4) & 3] + DIGITS[(b >> 2) & 3] + DIGITS[b & 3];
    return out;
}

function fromInvisible(s: string): Uint8Array | null {
    const d: number[] = [];
    for (const c of s) { const i = DIGITS.indexOf(c); if (i >= 0) d.push(i); }
    if (!d.length || d.length % 4) return null;
    const out = new Uint8Array(d.length / 4);
    for (let i = 0; i < out.length; i++) out[i] = d[i * 4] << 6 | d[i * 4 + 1] << 4 | d[i * 4 + 2] << 2 | d[i * 4 + 3];
    return out;
}

const join = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
};

const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map(x => parseInt(x, 16)));
const toHex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, "0")).join("");
const idBytes = (id: string) => { const b = new Uint8Array(8); let v = BigInt(id); for (let i = 7; i >= 0; i--) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; };
const idOf = (b: Uint8Array) => b.reduce((v, x) => (v << 8n) | BigInt(x), 0n).toString();

/* ── Writing ── */

export const KIND = { sonata: 0, password: 1, pair: 2 } as const;

/** What one secret is locked with, ready to seal. */
export type Seal = { kind: "sonata"; } | { kind: "password"; password: string; } | { kind: "pair"; pairId: string; key: CryptoKey; };

export interface Secret { text: string; seal: Seal; }

const bodyOf = (text: string, expiresAt?: number) => new TextEncoder().encode(JSON.stringify(expiresAt ? { t: text, x: Math.floor(expiresAt / 1000) } : { t: text }));

/** How long the finished message will be, before it's made (to show what's left). */
export function lengthOf(cover: string, secrets: { text: string; kind: Seal["kind"]; }[], expiresAt?: number) {
    const bytes = 2 + secrets.reduce((n, s) => n + 3 + (s.kind === "pair" ? 8 : 0) + 12 + 16 + bodyOf(s.text, expiresAt).length, 0);
    return cover.trim().length + MARK.length + bytes * 4;
}

async function keyOf(seal: Seal) {
    return seal.kind === "pair" ? seal.key : passwordKey(seal.kind === "password" ? seal.password : "");
}

/** Cover text + the hidden secrets, ready for the message box. */
export async function hide(cover: string, secrets: Secret[], expiresAt?: number) {
    const slots: Uint8Array[] = [];
    for (const s of secrets.slice(0, 2)) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyOf(s.seal), bodyOf(s.text, expiresAt)));
        const data = s.seal.kind === "pair" ? join(fromHex(s.seal.pairId), iv, sealed) : join(iv, sealed);
        slots.push(join(new Uint8Array([KIND[s.seal.kind], data.length >> 8, data.length & 255]), data));
    }
    return `${cover.trim()}${MARK}${toInvisible(join(new Uint8Array([2, slots.length]), ...slots))}`;
}

/** A pair request (3) or its reply (4): your public key, and who it's for. */
export function pairMessage(cover: string, type: 3 | 4, to: string, pub: Uint8Array) {
    return `${cover.trim()}${MARK}${toInvisible(join(new Uint8Array([type]), idBytes(to), pub))}`;
}

/* ── Reading ── */

export interface Keyring {
    passwords: string[];
    /** The key for a pair ID, if you're in that pair. */
    pairKey(pairId: string): Promise<CryptoKey | null>;
}

export interface Opened {
    text: string;
    /** When it stops opening (ms), if it does. */
    expiresAt?: number;
    lock: { kind: "sonata"; } | { kind: "password"; password: string; } | { kind: "pair"; pairId: string; };
}

export type Read =
    | { type: "none"; }
    | { type: "pair-request"; to: string; pub: Uint8Array; }
    | { type: "pair-reply"; to: string; pub: Uint8Array; }
    | { type: "whisper"; opened: Opened[]; needsPassword: boolean; forSomeoneElse: boolean; };

async function tryOpen(key: CryptoKey, iv: Uint8Array, sealed: Uint8Array) {
    try { return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, sealed as BufferSource)); } catch { return null; }
}

function parseBody(plain: Uint8Array, legacy: boolean): { text: string; expiresAt?: number; } {
    const s = new TextDecoder().decode(plain);
    if (legacy) return { text: s };
    try { const j = JSON.parse(s); return { text: String(j.t ?? ""), expiresAt: typeof j.x === "number" ? j.x * 1000 : undefined }; } catch { return { text: s }; }
}

/** Everything in a message's hidden part that these keys can open (and what's still locked). */
export async function read(content: string, keys: Keyring): Promise<Read> {
    const bytes = fromInvisible(content.split(MARK)[1] ?? "");
    if (!bytes) return { type: "none" };

    if ((bytes[0] === 3 || bytes[0] === 4) && bytes.length === 1 + 8 + 65)
        return { type: bytes[0] === 3 ? "pair-request" as const : "pair-reply" as const, to: idOf(bytes.slice(1, 9)), pub: bytes.slice(9) };

    const opened: Opened[] = [];
    let needsPassword = false, forSomeoneElse = false;

    // Version 1: [1][has password][iv][sealed].
    if (bytes[0] === 1 && bytes.length >= 2 + 12 + 16) {
        const locked = bytes[1] === 1, iv = bytes.slice(2, 14), sealed = bytes.slice(14);
        for (const password of locked ? keys.passwords : [""]) {
            const plain = await tryOpen(await passwordKey(password), iv, sealed);
            if (plain) { opened.push({ ...parseBody(plain, true), lock: locked ? { kind: "password", password } : { kind: "sonata" } }); break; }
        }
        return { type: "whisper", opened, needsPassword: !opened.length && locked, forSomeoneElse: false };
    }

    if (bytes[0] !== 2) return { type: "none" };
    let at = 2;
    for (let n = 0; n < bytes[1] && at + 3 <= bytes.length; n++) {
        const kind = bytes[at], len = (bytes[at + 1] << 8) | bytes[at + 2];
        const data = bytes.slice(at + 3, at + 3 + len);
        at += 3 + len;
        if (kind === KIND.pair) {
            const pairId = toHex(data.slice(0, 8));
            const key = await keys.pairKey(pairId);
            const plain = key && await tryOpen(key, data.slice(8, 20), data.slice(20));
            if (plain) opened.push({ ...parseBody(plain, false), lock: { kind: "pair", pairId } });
            else forSomeoneElse = true;
        } else {
            const iv = data.slice(0, 12), sealed = data.slice(12);
            let got = false;
            for (const password of kind === KIND.password ? keys.passwords : [""]) {
                const plain = await tryOpen(await passwordKey(password), iv, sealed);
                if (plain) { opened.push({ ...parseBody(plain, false), lock: kind === KIND.password ? { kind: "password", password } : { kind: "sonata" } }); got = true; break; }
            }
            if (!got && kind === KIND.password) needsPassword = true;
        }
    }
    return { type: "whisper", opened, needsPassword, forSomeoneElse };
}
