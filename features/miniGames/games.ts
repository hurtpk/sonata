/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The games' rules, and how a game travels in a message. Each player has one
// message per game carrying the whole game ("sg2.<game>.<id>.<x>.<o>.<board>@<the
// other player's message>", in a spoiler), and makes every move by editing it —
// so a game is two messages, however long it goes on. Sonata compares the two
// and only accepts the newer one if it's a legal next move by the right player,
// so a move out of turn, or an edited board, simply doesn't count.
// (The first version, "sg1", sent a new message for every move.)

import { bsMoves, bsNextMove, bsStart, bsState, wdMoves, wdNextMove, wdStart, wdState } from "./duelRules";
import { dbParse, dbReaches, isMore, moreFinished, MoreKind,moreMoves, moreNextMove, moreStart } from "./moreGames";

export type Kind = "ttt" | "c4" | "hm" | "bs" | "wd" | MoreKind;

export interface Game {
    /** 1: a message per move (old games, shown but not playable). 2: one message per player, edited. */
    v: 1 | 2;
    kind: Kind;
    id: string;
    /** The player who started (X / red / the word-setter). */
    x: string;
    /** The other player, or null until someone takes the first turn as them. */
    o: string | null;
    payload: string;
    /** The other player's game message, once there is one. */
    ref?: string | null;
}

export const GAME_NAMES: Record<Kind, string> = { ttt: "Tic-tac-toe", c4: "Connect Four", hm: "Hangman", bs: "Battleship", wd: "Word Duel", ck: "Checkers", ut: "Ultimate Tic-tac-toe", db: "Dots and Boxes", rp: "Rock Paper Scissors" };

/** Battleship and Word Duel: both players keep a secret and take turns (see duels.ts). */
export const isDuel = (k: Kind): k is "bs" | "wd" => k === "bs" || k === "wd";

const CODE = /\|\|sg([12])\.(ttt|c4|hm|bs|wd|ck|ut|db|rp)\.([a-z0-9]{6})\.(\d{5,21})\.(\d{5,21}|_)\.([^|\s@]+)(?:@(\d{5,21}))?\|\|/;

export function parseGame(content: string | undefined): Game | null {
    const m = content?.match(CODE);
    if (!m) return null;
    return { v: m[1] === "1" ? 1 : 2, kind: m[2] as Kind, id: m[3], x: m[4], o: m[5] === "_" ? null : m[5], payload: m[6], ref: m[7] ?? null };
}

export const encodeGame = (g: Game) => `sg2.${g.kind}.${g.id}.${g.x}.${g.o ?? "_"}.${g.payload}${g.ref ? `@${g.ref}` : ""}`;
export const newId = () => Math.random().toString(36).slice(2, 8).padEnd(6, "0");

// ─── Boards (tic-tac-toe and Connect Four) ───

const C4_W = 7, C4_H = 6;
const count = (s: string, c: string) => [...s].filter(ch => ch === c).length;

/** Whose mark goes next: X when both have played the same number. */
export const turnOf = (board: string): "x" | "o" => count(board, "x") === count(board, "o") ? "x" : "o";

const TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

function c4Lines(): number[][] {
    const lines: number[][] = [];
    const at = (r: number, c: number) => r * C4_W + c;
    for (let r = 0; r < C4_H; r++) {
        for (let c = 0; c < C4_W; c++) {
            for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
                const cells = [0, 1, 2, 3].map(k => [r + dr * k, c + dc * k]);
                if (cells.every(([rr, cc]) => rr >= 0 && rr < C4_H && cc >= 0 && cc < C4_W)) lines.push(cells.map(([rr, cc]) => at(rr, cc)));
            }
        }
    }
    return lines;
}
const C4_LINES = c4Lines();

export interface Outcome { winner: "x" | "o" | null; line: number[] | null; draw: boolean; }

export function boardOutcome(kind: Kind, board: string): Outcome {
    for (const line of kind === "ttt" ? TTT_LINES : C4_LINES) {
        const v = board[line[0]];
        if (v !== "." && line.every(i => board[i] === v)) return { winner: v as "x" | "o", line, draw: false };
    }
    return { winner: null, line: null, draw: !board.includes(".") };
}

/** Where a piece dropped into this column lands, or -1 if it's full. */
export function c4Drop(board: string, col: number) {
    for (let r = C4_H - 1; r >= 0; r--) if (board[r * C4_W + col] === ".") return r * C4_W + col;
    return -1;
}

export const emptyBoard = (kind: Kind) => isMore(kind) ? moreStart(kind) : ".".repeat(kind === "ttt" ? 9 : C4_W * C4_H);
export const C4 = { W: C4_W, H: C4_H };

// ─── Hangman ───
// The word is lightly scrambled so it isn't readable at a glance in the message. (It's a game between
// friends — someone determined could unscramble it, the same way they could peek at a written answer.)

export const MAX_WRONG = 6;

function scramble(text: string, key: string) {
    const bytes = [...new TextEncoder().encode(text)].map((b, i) => b ^ key.charCodeAt(i % key.length));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unscramble(code: string, key: string) {
    try {
        const bin = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
        return new TextDecoder().decode(Uint8Array.from(bin, (c, i) => c.charCodeAt(0) ^ key.charCodeAt(i % key.length)));
    } catch { return ""; }
}

export function hangmanPayload(word: string, id: string, guesses = "") {
    return `${scramble(word.toLowerCase(), id)}~${guesses}`;
}

export function hangmanState(g: Game) {
    const [code, guesses = ""] = g.payload.split("~");
    const word = unscramble(code, g.id);
    const letters = new Set(guesses);
    const wrong = [...letters].filter(l => !word.includes(l)).length;
    const solved = [...word].every(ch => !/[a-z]/.test(ch) || letters.has(ch));
    return { word, code, guesses, letters, wrong, solved, lost: wrong >= MAX_WRONG };
}

// ─── Is this a legal next move? ───

export function isStart(g: Game, author: string) {
    if (author !== g.x) return false;
    if (g.kind === "bs") return bsStart(g);
    if (g.kind === "wd") return wdStart(g);
    if (isMore(g.kind)) return g.payload === moreStart(g.kind);
    if (g.kind === "hm") {
        const s = hangmanState(g);
        return /^[a-z][a-z ]{1,24}[a-z]$/.test(s.word) && s.guesses === "";
    }
    return g.payload === emptyBoard(g.kind);
}

function finished(g: Game) {
    if (g.kind === "hm") { const s = hangmanState(g); return s.solved || s.lost; }
    if (g.kind === "bs") return !!bsState(g).winner;
    if (g.kind === "wd") return wdState(g).done;
    if (isMore(g.kind)) return moreFinished(g);
    const o = boardOutcome(g.kind, g.payload);
    return !!o.winner || o.draw;
}

export function isFinished(g: Game) { return finished(g); }

export function isNextMove(prev: Game, next: Game, author: string) {
    if (next.kind !== prev.kind || next.id !== prev.id || next.x !== prev.x || finished(prev)) return false;
    // Whoever takes the first turn as the second player becomes them; until then, the starter's moves leave it open.
    if (prev.o) { if (next.o !== prev.o) return false; } else if (author === prev.x ? next.o !== null : next.o !== author) return false;
    const o = next.o ?? "";

    if (prev.kind === "bs") return bsNextMove(prev, next, author);
    if (prev.kind === "wd") return wdNextMove(prev, next, author);
    if (isMore(prev.kind)) return moreNextMove(prev, next, author);

    if (prev.kind === "hm") {
        const a = hangmanState(prev), b = hangmanState(next);
        if (author !== o || a.code !== b.code || b.guesses.length !== a.guesses.length + 1 || !b.guesses.startsWith(a.guesses)) return false;
        const letter = b.guesses.at(-1)!;
        return /^[a-z]$/.test(letter) && !a.letters.has(letter);
    }

    const mark = turnOf(prev.payload);
    if (author !== (mark === "x" ? prev.x : o) || next.payload.length !== prev.payload.length) return false;
    const changed = [...next.payload].map((c, i) => c !== prev.payload[i] ? i : -1).filter(i => i >= 0);
    if (changed.length !== 1 || prev.payload[changed[0]] !== "." || next.payload[changed[0]] !== mark) return false;
    // Connect Four pieces fall to the bottom of their column.
    if (prev.kind === "c4" && c4Drop(prev.payload, changed[0] % C4_W) !== changed[0]) return false;
    return true;
}

// ─── Two messages, one game ───

/** How many moves have been made. */
export const movesOf = (g: Game) => isMore(g.kind) ? moreMoves(g) : g.kind === "hm" ? hangmanState(g).guesses.length : g.kind === "bs" ? bsMoves(g) : g.kind === "wd" ? wdMoves(g) : count(g.payload, "x") + count(g.payload, "o");

/** The game as it was before anyone moved. */
export const startOf = (g: Game): Game => ({ ...g, payload: isMore(g.kind) ? moreStart(g.kind) : g.kind === "hm" ? `${hangmanState(g).code}~` : isDuel(g.kind) ? `${g.payload.split("~")[0]}~~~` : emptyBoard(g.kind) });

/**
 * Whether `to` follows legally from `from`, made by `author`: one move for the
 * board games (players take turns, so each message is one move past the other),
 * any number of guesses for Hangman (only the guesser ever moves).
 */
export function reaches(from: Game, to: Game, author: string): boolean {
    // Dots and Boxes: closing a box earns another go, so one player can be several edges ahead.
    if (from.kind === "db" && !isNextMove(from, to, author)) {
        if (to.kind !== "db" || to.id !== from.id || to.x !== from.x || finished(from)) return false;
        if (from.o ? to.o !== from.o : author === from.x ? to.o !== null : to.o !== author) return false;
        const { turn } = dbParse(from.payload);
        return author === (turn === "x" ? from.x : to.o) && dbReaches(from.payload, to.payload);
    }
    if (from.kind !== "hm") return isNextMove(from, to, author);
    const a = hangmanState(from), b = hangmanState(to);
    if (a.code !== b.code || b.guesses.length <= a.guesses.length || !b.guesses.startsWith(a.guesses)) return false;
    let current = from;
    for (let i = a.guesses.length; i < b.guesses.length; i++) {
        const step: Game = { ...to, payload: `${b.code}~${b.guesses.slice(0, i + 1)}` };
        if (!isNextMove(current, step, author)) return false;
        current = step;
    }
    return true;
}

export interface GameMessage { id: string; author: string; game: Game; }

export interface Resolved {
    /** The message holding the newest state, where the board is shown and played. */
    current: GameMessage;
    /** The other player's message, if it's loaded. */
    other: GameMessage | null;
    /** Whether the newest state follows legally. */
    ok: boolean;
}

const older = (a: GameMessage, b: GameMessage) => BigInt(a.id) < BigInt(b.id) ? a : b;

/** Works out where a game stands from its messages (all with the same game id). */
export function resolveGame(messages: GameMessage[], gameX: string): Resolved | null {
    // Each player's own message is the first one they sent for this game (they edit it from then on).
    let x: GameMessage | null = null, o: GameMessage | null = null;
    for (const m of messages) {
        if (m.author === gameX) x = x ? older(x, m) : m;
        else o = o ? older(o, m) : m;
    }
    if (x && o) {
        const [before, after] = movesOf(x.game) >= movesOf(o.game) ? [o, x] : [x, o];
        return { current: after, other: before, ok: reaches(before.game, after.game, after.author) };
    }
    const only = x ?? o;
    if (!only) return null;
    // Just the starter's message: the start, or the starter's first move. Just the other player's (the starter's
    // isn't loaded, far up the chat): it can't be checked here, so it's taken as it is.
    const ok = only === x ? isStart(only.game, gameX) || reaches(startOf(only.game), only.game, gameX) : true;
    return { current: only, other: null, ok };
}
