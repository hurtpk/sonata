/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Whisper's keys, all kept on this computer:
//  • the password book — passwords with names ("Squad", "Me & Sam");
//  • your pairing key — made once, the public half is what a pair request sends;
//  • paired friends — their public key, so Sonata can work out the key you
//    share with them (ECDH on P-256) without either of you typing anything.

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

export interface BookEntry { name: string; password: string; }
export interface Pair { userId: string; name: string; theirPub: number[]; id: string; code: string; at: number; }
interface Identity { pub: number[]; priv: JsonWebKey; }

const BOOK = "Sonata_whisperBook", OLD_BOOK = "Sonata_whisperPasswords";
const IDENTITY = "Sonata_whisperIdentity", PAIRS = "Sonata_whisperPairs", OFFERS = "Sonata_whisperOffers";

let book: BookEntry[] = [];
let pairs: Pair[] = [];
/** Pair requests you sent: who to, and when (a reply is only accepted from them). */
let offers: { to: string; at: number; }[] = [];
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export function loadKeys() {
    return loaded ??= (async () => {
        const saved = await DataStore.get<BookEntry[]>(BOOK);
        if (saved) book = saved;
        else {
            // The first Whisper kept plain passwords; give them names.
            const old = (await DataStore.get<string[]>(OLD_BOOK)) ?? [];
            book = old.map((password, i) => ({ name: old.length === 1 ? "My password" : `Password ${i + 1}`, password }));
            if (book.length) await DataStore.set(BOOK, book);
        }
        pairs = (await DataStore.get<Pair[]>(PAIRS)) ?? [];
        offers = ((await DataStore.get<typeof offers>(OFFERS)) ?? []).filter(o => Date.now() - o.at < 30 * 86_400_000);
        emit();
    })().catch(() => { });
}

export function useKeys() {
    const [, bump] = useState(0);
    useEffect(() => { void loadKeys(); const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    return { book, pairs };
}

export const getBook = () => book;
export const getPairs = () => pairs;

/* ── The password book ── */

export async function savePassword(name: string, password: string) {
    await loadKeys();
    if (!password) return;
    const n = name.trim() || `Password ${book.length + 1}`;
    book = [{ name: n, password }, ...book.filter(b => b.password !== password && b.name !== n)].slice(0, 30);
    emit();
    await DataStore.set(BOOK, book);
}

export async function renamePassword(password: string, name: string) {
    book = book.map(b => b.password === password ? { ...b, name: name.trim() || b.name } : b);
    emit();
    await DataStore.set(BOOK, book);
}

export async function removePassword(password: string) {
    book = book.filter(b => b.password !== password);
    emit();
    await DataStore.set(BOOK, book);
}

export const labelFor = (password: string) => book.find(b => b.password === password)?.name;

/* ── Pairing ── */

const toHex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, "0")).join("");

let identity: Promise<{ pub: Uint8Array; priv: CryptoKey; }> | null = null;

/** Your pairing key, made the first time it's needed. */
export function myIdentity() {
    return identity ??= (async () => {
        let id = await DataStore.get<Identity>(IDENTITY);
        if (!id) {
            const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
            id = { pub: [...new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))], priv: await crypto.subtle.exportKey("jwk", kp.privateKey) };
            await DataStore.set(IDENTITY, id);
        }
        const priv = await crypto.subtle.importKey("jwk", id.priv, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
        return { pub: new Uint8Array(id.pub), priv };
    })();
}

/** The same for both of you: a pair's ID (first 8 bytes) and its safety code, from both public keys. */
async function pairFingerprint(a: Uint8Array, b: Uint8Array) {
    const [x, y] = toHex(a) < toHex(b) ? [a, b] : [b, a];
    const both = new Uint8Array(x.length + y.length);
    both.set(x); both.set(y, x.length);
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", both));
    const code = [0, 1, 2].map(i => String(((h[8 + i * 2] << 8) | h[9 + i * 2]) % 10000).padStart(4, "0")).join(" ");
    return { id: toHex(h.slice(0, 8)), code };
}

const shared = new Map<string, Promise<CryptoKey>>();

/** The key only you and this friend can work out. */
export function pairKey(p: Pair) {
    let k = shared.get(p.id);
    if (!k) {
        k = (async () => {
            const me = await myIdentity();
            const theirs = await crypto.subtle.importKey("raw", new Uint8Array(p.theirPub), { name: "ECDH", namedCurve: "P-256" }, false, []);
            const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: theirs }, me.priv, 256));
            const salted = new Uint8Array(bits.length + 22);
            salted.set(bits); salted.set(new TextEncoder().encode("Sonata Whisper pair v1"), bits.length);
            const raw = await crypto.subtle.digest("SHA-256", salted);
            return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
        })();
        shared.set(p.id, k);
    }
    return k;
}

export const pairById = (id: string) => pairs.find(p => p.id === id);
export const pairWith = (userId: string) => pairs.find(p => p.userId === userId);

/** Save (or refresh) a pair from their public key. */
export async function addPair(userId: string, name: string, theirPub: Uint8Array) {
    await loadKeys();
    const me = await myIdentity();
    const { id, code } = await pairFingerprint(me.pub, theirPub);
    const existing = pairs.find(p => p.userId === userId);
    if (existing?.id === id) return existing;
    const pair: Pair = { userId, name, theirPub: [...theirPub], id, code, at: Date.now() };
    pairs = [pair, ...pairs.filter(p => p.userId !== userId)];
    offers = offers.filter(o => o.to !== userId);
    emit();
    await DataStore.set(PAIRS, pairs);
    await DataStore.set(OFFERS, offers);
    return pair;
}

export async function removePair(userId: string) {
    pairs = pairs.filter(p => p.userId !== userId);
    emit();
    await DataStore.set(PAIRS, pairs);
}

export async function noteOffer(to: string) {
    await loadKeys();
    offers = [{ to, at: Date.now() }, ...offers.filter(o => o.to !== to)];
    await DataStore.set(OFFERS, offers);
}

export const offeredTo = (userId: string) => offers.some(o => o.to === userId);
