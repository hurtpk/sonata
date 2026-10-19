/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Battleship and Word Duel: games where each player keeps something secret
// (their fleet, their word). Like Hangman's word, a secret is lightly
// scrambled in the message so it can't be read at a glance — it's a game
// between friends, not a lock.
//
// Payload, both games: "<starter's secret>~<other player's secret>~<starter's moves>~<other's moves>".
// The starter sends their secret first; the other player joins by adding
// theirs together with their first move; then they take turns.

import type { Game } from "./games";

/* ── Scrambling (same idea as Hangman) ─────────────────────────────── */

export function scramble(text: string, key: string) {
    const bytes = [...new TextEncoder().encode(text)].map((b, i) => b ^ key.charCodeAt(i % key.length));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unscramble(code: string, key: string) {
    if (!code) return "";
    try {
        const bin = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
        return new TextDecoder().decode(Uint8Array.from(bin, (c, i) => c.charCodeAt(0) ^ key.charCodeAt(i % key.length)));
    } catch { return ""; }
}

export interface Parts { a: string; b: string; ma: string; mb: string; }
export const parts = (g: Game): Parts => { const [a = "", b = "", ma = "", mb = ""] = g.payload.split("~"); return { a, b, ma, mb }; };
export const joinParts = (p: Parts) => `${p.a}~${p.b}~${p.ma}~${p.mb}`;

/* ── Battleship ─────────────────────────────────────────────────────── */

export const BS = 8;
export const FLEET = [4, 3, 3, 2, 2];
export const SHIP_NAMES = ["Battleship", "Cruiser", "Submarine", "Destroyer", "Patrol boat"];
const A64 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_";
export const cellChar = (i: number) => A64[i];
export const charCell = (c: string) => A64.indexOf(c);

export interface Ship { cell: number; dir: "h" | "v"; }

export function shipCells(size: number, s: Ship): number[] | null {
    const r = Math.floor(s.cell / BS), c = s.cell % BS;
    if (s.dir === "h" ? c + size > BS : r + size > BS) return null;
    return Array.from({ length: size }, (_, k) => s.dir === "h" ? s.cell + k : s.cell + k * BS);
}

/** Every ship's cells, or null if the fleet is incomplete, off the board, or overlapping. */
export function fleetCells(fleet: (Ship | null)[]): number[][] | null {
    const used = new Set<number>();
    const out: number[][] = [];
    for (const [i, s] of fleet.entries()) {
        if (!s) return null;
        const cells = shipCells(FLEET[i], s);
        if (!cells || cells.some(x => used.has(x))) return null;
        cells.forEach(x => used.add(x));
        out.push(cells);
    }
    return out.length === FLEET.length ? out : null;
}

export const encodeFleet = (fleet: Ship[], key: string) => scramble(fleet.map(s => cellChar(s.cell) + s.dir).join(""), key);

export function decodeFleet(code: string, key: string): number[][] | null {
    const raw = unscramble(code, key);
    if (raw.length !== FLEET.length * 2) return null;
    const fleet: Ship[] = [];
    for (let i = 0; i < raw.length; i += 2) {
        const cell = charCell(raw[i]), dir = raw[i + 1];
        if (cell < 0 || cell >= BS * BS || (dir !== "h" && dir !== "v")) return null;
        fleet.push({ cell, dir });
    }
    return fleetCells(fleet);
}

export function randomFleet(): Ship[] {
    for (let attempt = 0; attempt < 500; attempt++) {
        const fleet: Ship[] = [];
        const used = new Set<number>();
        let ok = true;
        for (const size of FLEET) {
            let placed = false;
            for (let t = 0; t < 100 && !placed; t++) {
                const s: Ship = { cell: Math.floor(Math.random() * BS * BS), dir: Math.random() < 0.5 ? "h" : "v" };
                const cells = shipCells(size, s);
                if (cells && !cells.some(x => used.has(x))) { cells.forEach(x => used.add(x)); fleet.push(s); placed = true; }
            }
            if (!placed) { ok = false; break; }
        }
        if (ok) return fleet;
    }
    return [];
}

const shotsOf = (s: string) => [...s].map(charCell);

export interface BsState {
    fleetX: number[][] | null;
    fleetO: number[][] | null;
    shotsX: number[];
    shotsO: number[];
    joined: boolean;
    /** Whose turn: "o" to join (and fire first), then turns. */
    turn: "x" | "o";
    winner: "x" | "o" | null;
}

export function bsState(g: Game): BsState {
    const p = parts(g);
    const fleetX = decodeFleet(p.a, g.id + g.x);
    const fleetO = g.o && p.b ? decodeFleet(p.b, g.id + g.o) : null;
    const shotsX = shotsOf(p.ma), shotsO = shotsOf(p.mb);
    const sunk = (fleet: number[][] | null, shots: number[]) => !!fleet && fleet.every(ship => ship.every(c => shots.includes(c)));
    const winner = sunk(fleetO, shotsX) ? "x" : sunk(fleetX, shotsO) ? "o" : null;
    return { fleetX, fleetO, shotsX, shotsO, joined: !!p.b, turn: !p.b || shotsO.length <= shotsX.length ? "o" : "x", winner };
}

/** Ships of a fleet the shots have fully sunk. */
export const sunkShips = (fleet: number[][] | null, shots: number[]) => fleet ? fleet.map((ship, i) => ship.every(c => shots.includes(c)) ? i : -1).filter(i => i >= 0) : [];

export function bsNextMove(prev: Game, next: Game, author: string): boolean {
    const a = parts(prev), b = parts(next), s = bsState(prev);
    if (a.a !== b.a || s.winner) return false;
    const fire = (before: string, after: string) => {
        if (after.length !== before.length + 1 || !after.startsWith(before)) return false;
        const cell = charCell(after.at(-1)!);
        return cell >= 0 && cell < BS * BS && !shotsOf(before).includes(cell);
    };
    if (!s.joined) {
        // The other player joins: their fleet, plus their first shot.
        if (author === prev.x || next.o !== author || a.ma !== b.ma || !decodeFleet(b.b, next.id + author)) return false;
        return fire(a.mb, b.mb);
    }
    if (a.b !== b.b) return false;
    if (s.turn === "x") return author === prev.x && b.mb === a.mb && fire(a.ma, b.ma);
    return author === prev.o && b.ma === a.ma && fire(a.mb, b.mb);
}

export const bsStart = (g: Game) => { const p = parts(g); return !!decodeFleet(p.a, g.id + g.x) && !p.b && !p.ma && !p.mb; };
export const bsMoves = (g: Game) => { const p = parts(g); return p.ma.length + p.mb.length; };

/* ── Word Duel ──────────────────────────────────────────────────────── */

export const WD_LEN = 5;
export const WD_TRIES = 6;
export const validWord = (w: string) => new RegExp(`^[a-z]{${WD_LEN}}$`).test(w);

export type Mark = "hit" | "near" | "miss";

/** Wordle colours: right place, in the word elsewhere, not in it (repeated letters handled properly). */
export function markGuess(guess: string, word: string): Mark[] {
    const out: Mark[] = Array(WD_LEN).fill("miss");
    const left: Record<string, number> = {};
    for (let i = 0; i < WD_LEN; i++) {
        if (guess[i] === word[i]) out[i] = "hit";
        else left[word[i]] = (left[word[i]] ?? 0) + 1;
    }
    for (let i = 0; i < WD_LEN; i++) {
        if (out[i] === "hit") continue;
        if (left[guess[i]]) { out[i] = "near"; left[guess[i]]--; }
    }
    return out;
}

const guessList = (s: string) => s.match(new RegExp(`.{${WD_LEN}}`, "g")) ?? [];

export interface WdState {
    /** The word the starter picked (the other player guesses it), and the other player's word (the starter guesses it). */
    wordX: string;
    wordO: string;
    guessesX: string[];
    guessesO: string[];
    joined: boolean;
    turn: "x" | "o";
    solvedX: number;
    solvedO: number;
    done: boolean;
    winner: "x" | "o" | null;
    draw: boolean;
}

export function wdState(g: Game): WdState {
    const p = parts(g);
    const wordX = unscramble(p.a, g.id + g.x), wordO = g.o && p.b ? unscramble(p.b, g.id + g.o) : "";
    const guessesX = guessList(p.ma), guessesO = guessList(p.mb);
    // The starter guesses the other player's word; the other player guesses the starter's.
    const solvedX = wordO ? guessesX.findIndex(w => w === wordO) + 1 : 0;
    const solvedO = guessesO.findIndex(w => w === wordX) + 1;
    // The other player guesses first each round; a round ends when the starter has guessed too.
    const rounds = guessesX.length;
    let winner: "x" | "o" | null = null, draw = false, done = false;
    if (guessesO.length === rounds && rounds > 0) {
        const x = solvedX > 0 && solvedX <= rounds, o = solvedO > 0 && solvedO <= rounds;
        if (x && o) { done = true; draw = (solvedX === solvedO); winner = draw ? null : solvedX < solvedO ? "x" : "o"; } else if (x) { done = true; winner = "x"; } else if (o) { done = true; winner = "o"; } else if (rounds >= WD_TRIES) { done = true; draw = true; }
    }
    return { wordX, wordO, guessesX, guessesO, joined: !!p.b, turn: !p.b || guessesO.length <= guessesX.length ? "o" : "x", solvedX, solvedO, done, winner, draw };
}

export function wdNextMove(prev: Game, next: Game, author: string): boolean {
    const a = parts(prev), b = parts(next), s = wdState(prev);
    if (a.a !== b.a || s.done) return false;
    const guess = (before: string, after: string) => after.length === before.length + WD_LEN && after.startsWith(before) && validWord(after.slice(before.length));
    if (!s.joined) {
        if (author === prev.x || next.o !== author || a.ma !== b.ma || !validWord(unscramble(b.b, next.id + author))) return false;
        return guess(a.mb, b.mb);
    }
    if (a.b !== b.b) return false;
    if (s.turn === "x") return author === prev.x && b.mb === a.mb && guess(a.ma, b.ma);
    return author === prev.o && b.ma === a.ma && guess(a.mb, b.mb);
}

export const wdStart = (g: Game) => { const p = parts(g); return validWord(unscramble(p.a, g.id + g.x)) && !p.b && !p.ma && !p.mb; };
export const wdMoves = (g: Game) => { const p = parts(g); return (p.ma.length + p.mb.length) / WD_LEN; };
