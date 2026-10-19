/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The rules for Checkers, Ultimate Tic-tac-toe, Dots and Boxes and
// Rock-Paper-Scissors. Like the other games, the whole game travels in the
// payload and each move is checked against the rules before it counts:
// a move is legal only if the new payload is exactly what that move makes.
//
// Payloads:
//   ck  "<whose turn x|o><32 squares>~<turns since a capture>~<turns played>"   squares: . x X o O (capital = king)
//   ut  "<81 cells>~<last cell played, or ->"                     cell = small board × 9 + square
//   db  "<40 edges>~<16 boxes>~<whose turn>"                      edges/boxes: . x o
//   rp  "<starter's picks>~<other's picks>"                       picks r/p/s, lightly scrambled (like Hangman's word)

import { scramble, unscramble } from "./duelRules";
import type { Game } from "./games";

export type Side = "x" | "o";
export const other = (s: Side): Side => s === "x" ? "o" : "x";
const count = (s: string, c: string) => [...s].filter(ch => ch === c).length;

/* ── Checkers ────────────────────────────────────────────────────────── */

export const CK_DRAW_AFTER = 50;
/** Square number (0–31) of a dark square, or -1. */
export const ckSq = (r: number, c: number) => r < 0 || r > 7 || c < 0 || c > 7 || (r + c) % 2 !== 1 ? -1 : r * 4 + (c >> 1);
export const ckRC = (k: number) => { const r = k >> 2; return [r, ((k & 3) << 1) + (r % 2 === 0 ? 1 : 0)] as const; };

export const ckStart = () => `x${"o".repeat(12)}${".".repeat(8)}${"x".repeat(12)}~0~0`;

export function ckParse(payload: string) {
    const [head = "", quiet = "0", ply = "0"] = payload.split("~");
    return { turn: (head[0] === "o" ? "o" : "x") as Side, board: head.slice(1), quiet: Number(quiet) || 0, ply: Number(ply) || 0 };
}

const owner = (p: string): Side | null => p === "x" || p === "X" ? "x" : p === "o" || p === "O" ? "o" : null;
const dirsOf = (p: string) => p === "x" ? [[-1, -1], [-1, 1]] : p === "o" ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1], [1, -1], [1, 1]];

/** A whole turn: the squares the piece visits, the squares jumped, and the board after. */
export interface CkMove { path: number[]; captured: number[]; board: string; }

/** Every legal whole turn for `side`. Captures are compulsory, multi-jumps continue, crowning ends the turn. */
export function ckMoves(board: string, side: Side): CkMove[] {
    const jumps: CkMove[] = [], steps: CkMove[] = [];
    const set = (b: string, i: number, v: string) => b.slice(0, i) + v + b.slice(i + 1);
    const crownRow = side === "x" ? 0 : 7;

    const jumpFrom = (b: string, at: number, piece: string, path: number[], captured: number[]) => {
        const [r, c] = ckRC(at);
        let any = false;
        for (const [dr, dc] of dirsOf(piece)) {
            const mid = ckSq(r + dr, c + dc), to = ckSq(r + 2 * dr, c + 2 * dc);
            if (mid < 0 || to < 0 || b[to] !== "." || owner(b[mid]) !== other(side) || captured.includes(mid)) continue;
            any = true;
            let nb = set(set(set(b, at, "."), mid, "."), to, piece);
            const crowned = piece === side && ckRC(to)[0] === crownRow;
            if (crowned) nb = set(nb, to, piece.toUpperCase());
            if (crowned) jumps.push({ path: [...path, to], captured: [...captured, mid], board: nb });
            else jumpFrom(nb, to, piece, [...path, to], [...captured, mid]);
        }
        if (!any && captured.length) jumps.push({ path, captured, board: b });
    };

    for (let i = 0; i < 32; i++) {
        const piece = board[i];
        if (owner(piece) !== side) continue;
        jumpFrom(board, i, piece, [i], []);
        if (jumps.length) continue;
        const [r, c] = ckRC(i);
        for (const [dr, dc] of dirsOf(piece)) {
            const to = ckSq(r + dr, c + dc);
            if (to < 0 || board[to] !== ".") continue;
            const crowned = piece === side && ckRC(to)[0] === crownRow;
            steps.push({ path: [i, to], captured: [], board: set(set(board, i, "."), to, crowned ? piece.toUpperCase() : piece) });
        }
    }
    return jumps.length ? jumps : steps;
}

/** The payload after a whole turn. */
export const ckApply = (payload: string, m: CkMove) => {
    const s = ckParse(payload);
    return `${other(s.turn)}${m.board}~${m.captured.length ? 0 : s.quiet + 1}~${s.ply + 1}`;
};

export function ckOutcome(payload: string): { winner: Side | null; draw: boolean; } {
    const s = ckParse(payload);
    if (s.quiet >= CK_DRAW_AFTER) return { winner: null, draw: true };
    return ckMoves(s.board, s.turn).length ? { winner: null, draw: false } : { winner: other(s.turn), draw: false };
}

const ckNext = (prev: string, next: string) => ckMoves(ckParse(prev).board, ckParse(prev).turn).some(m => ckApply(prev, m) === next);
export const ckCaptured = (payload: string, side: Side) => 12 - [...ckParse(payload).board].filter(p => owner(p) === other(side)).length;

/* ── Ultimate Tic-tac-toe ────────────────────────────────────────────── */

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export const utStart = () => `${".".repeat(81)}~-`;

export function utParse(payload: string) {
    const [cells = "", last = "-"] = payload.split("~");
    return { cells, last: last === "-" ? -1 : Number(last) };
}

/** A small board's result: x / o won, "d" full with no winner, or "." still going. */
export function utSmall(cells: string, b: number): string {
    const sq = cells.slice(b * 9, b * 9 + 9);
    for (const l of LINES) if (sq[l[0]] !== "." && l.every(i => sq[i] === sq[l[0]])) return sq[l[0]];
    return sq.includes(".") ? "." : "d";
}

export function utOutcome(payload: string): { winner: Side | null; draw: boolean; line: number[] | null; } {
    const { cells } = utParse(payload);
    const big = Array.from({ length: 9 }, (_, b) => utSmall(cells, b));
    for (const l of LINES) if ((big[l[0]] === "x" || big[l[0]] === "o") && l.every(i => big[i] === big[l[0]])) return { winner: big[l[0]] as Side, draw: false, line: l };
    return { winner: null, draw: big.every(s => s !== "."), line: null };
}

/** Which small boards the next move may go in. */
export function utAllowed(payload: string): number[] {
    const { cells, last } = utParse(payload);
    const open = Array.from({ length: 9 }, (_, b) => b).filter(b => utSmall(cells, b) === ".");
    if (last < 0) return open;
    const target = last % 9;
    return open.includes(target) ? [target] : open;
}

export const utTurn = (payload: string): Side => { const { cells } = utParse(payload); return count(cells, "x") === count(cells, "o") ? "x" : "o"; };
export const utPlay = (payload: string, cell: number) => {
    const { cells } = utParse(payload);
    return `${cells.slice(0, cell)}${utTurn(payload)}${cells.slice(cell + 1)}~${cell}`;
};

function utNext(prev: string, next: string) {
    const a = utParse(prev).cells, b = utParse(next).cells;
    if (a.length !== 81 || b.length !== 81) return false;
    const changed = [...b].map((c, i) => c !== a[i] ? i : -1).filter(i => i >= 0);
    if (changed.length !== 1 || a[changed[0]] !== ".") return false;
    return utAllowed(prev).includes(Math.floor(changed[0] / 9)) && utPlay(prev, changed[0]) === next;
}

/* ── Dots and Boxes ──────────────────────────────────────────────────── */

export const DB_N = 4;
const H = (DB_N + 1) * DB_N; // horizontal edges
export const DB_EDGES = H * 2;
export const dbH = (r: number, c: number) => r * DB_N + c;
export const dbV = (r: number, c: number) => H + r * (DB_N + 1) + c;
const boxEdges = (r: number, c: number) => [dbH(r, c), dbH(r + 1, c), dbV(r, c), dbV(r, c + 1)];

export const dbStart = () => `${".".repeat(DB_EDGES)}~${".".repeat(DB_N * DB_N)}~x`;

export function dbParse(payload: string) {
    const [edges = "", boxes = "", turn = "x"] = payload.split("~");
    return { edges, boxes, turn: (turn === "o" ? "o" : "x") as Side };
}

/** Draws an edge: boxes it closes go to the player, who then goes again. */
export function dbPlay(payload: string, edge: number) {
    const { edges, boxes, turn } = dbParse(payload);
    const e = edges.slice(0, edge) + turn + edges.slice(edge + 1);
    let b = boxes, closed = 0;
    for (let r = 0; r < DB_N; r++) for (let c = 0; c < DB_N; c++) {
        const i = r * DB_N + c;
        if (b[i] === "." && boxEdges(r, c).every(x => e[x] !== ".")) { b = b.slice(0, i) + turn + b.slice(i + 1); closed++; }
    }
    return { payload: `${e}~${b}~${closed ? turn : other(turn)}`, closed };
}

export function dbOutcome(payload: string): { winner: Side | null; draw: boolean; x: number; o: number; } {
    const { boxes } = dbParse(payload);
    const x = count(boxes, "x"), o = count(boxes, "o");
    if (boxes.includes(".")) return { winner: null, draw: false, x, o };
    return { winner: x === o ? null : x > o ? "x" : "o", draw: x === o, x, o };
}

/**
 * Several edges in a row by the same player: legal when every edge but the
 * last closes a box (that's what earns another go). Finds an order that works.
 */
export function dbReaches(from: string, to: string): boolean {
    const a = dbParse(from).edges, b = dbParse(to).edges;
    if (a.length !== DB_EDGES || b.length !== DB_EDGES) return false;
    if ([...a].some((e, i) => e !== "." && b[i] !== e)) return false;
    const added = [...b].map((e, i) => a[i] === "." && e !== "." ? i : -1).filter(i => i >= 0);
    if (!added.length || added.length > 30) return false;
    const tried = new Set<string>();
    const go = (p: string, left: number[]): boolean => {
        if (!left.length) return p === to;
        const k = `${p}|${left.join(",")}`;
        if (tried.has(k)) return false;
        tried.add(k);
        for (const e of left) {
            const { payload, closed } = dbPlay(p, e);
            const rest = left.filter(x => x !== e);
            if (rest.length && !closed) continue;
            if (go(payload, rest)) return true;
        }
        return false;
    };
    return go(from, added);
}

function dbNext(prev: string, next: string) {
    const a = dbParse(prev).edges, b = dbParse(next).edges;
    if (a.length !== DB_EDGES || b.length !== DB_EDGES) return false;
    const changed = [...b].map((c, i) => c !== a[i] ? i : -1).filter(i => i >= 0);
    return changed.length === 1 && a[changed[0]] === "." && dbPlay(prev, changed[0]).payload === next;
}

/* ── Rock-Paper-Scissors, best of 5 ──────────────────────────────────── */

export const RP_WINS = 3;
export const RP_MAX_ROUNDS = 15;
export const RP_EMOJI: Record<string, string> = { r: "✊", p: "✋", s: "✌️" };
const beats = (a: string, b: string) => (a === "r" && b === "s") || (a === "p" && b === "r") || (a === "s" && b === "p");

export const rpStart = () => "~";
const key = (g: Game, who: string | null) => g.id + (who ?? "");

export function rpPicks(g: Game) {
    const [a = "", b = ""] = g.payload.split("~");
    return { x: unscramble(a, key(g, g.x)), o: unscramble(b, key(g, g.o)) };
}

export function rpPayload(g: Game, x: string, o: string, oId: string | null) {
    return `${x ? scramble(x, key(g, g.x)) : ""}~${o ? scramble(o, key(g, oId)) : ""}`;
}

export function rpScore(g: Game) {
    const p = rpPicks(g);
    const rounds = Math.min(p.x.length, p.o.length);
    let xWins = 0, oWins = 0;
    const results: ("x" | "o" | "d")[] = [];
    for (let i = 0; i < rounds; i++) {
        const r = beats(p.x[i], p.o[i]) ? "x" : beats(p.o[i], p.x[i]) ? "o" : "d";
        if (r === "x") xWins++; else if (r === "o") oWins++;
        results.push(r);
    }
    const done = xWins >= RP_WINS || oWins >= RP_WINS || rounds >= RP_MAX_ROUNDS;
    return { ...p, rounds, xWins, oWins, results, done, winner: !done ? null : xWins > oWins ? "x" as Side : oWins > xWins ? "o" as Side : null };
}

function rpNext(prev: Game, next: Game, author: string) {
    const a = rpPicks(prev), b = rpPicks({ ...next });
    const mine: Side = author === prev.x ? "x" : "o";
    const theirs = other(mine);
    if (b[theirs] !== a[theirs]) return false;
    if (b[mine].length !== a[mine].length + 1 || !b[mine].startsWith(a[mine]) || !/[rps]$/.test(b[mine])) return false;
    // Nobody picks two rounds ahead: you wait for the other player's pick first.
    return b[mine].length <= a[theirs].length + 1;
}

/* ── Shared ──────────────────────────────────────────────────────────── */

export type MoreKind = "ck" | "ut" | "db" | "rp";
export const MORE_KINDS: MoreKind[] = ["ck", "ut", "db", "rp"];
export const isMore = (k: string): k is MoreKind => (MORE_KINDS as string[]).includes(k);

export const moreStart = (k: MoreKind) => k === "ck" ? ckStart() : k === "ut" ? utStart() : k === "db" ? dbStart() : rpStart();

/** Whose turn it is ("both" for Rock-Paper-Scissors, where either may pick). */
export function moreTurn(g: Game): Side | "both" {
    if (g.kind === "ck") return ckParse(g.payload).turn;
    if (g.kind === "ut") return utTurn(g.payload);
    if (g.kind === "db") return dbParse(g.payload).turn;
    return "both";
}

export function moreOutcome(g: Game): { winner: Side | null; draw: boolean; } {
    if (g.kind === "ck") return ckOutcome(g.payload);
    if (g.kind === "ut") return utOutcome(g.payload);
    if (g.kind === "db") return dbOutcome(g.payload);
    const s = rpScore(g);
    return { winner: s.winner, draw: s.done && !s.winner };
}

export const moreFinished = (g: Game) => { const o = moreOutcome(g); return !!o.winner || o.draw; };

export function moreMoves(g: Game): number {
    if (g.kind === "ck") return ckParse(g.payload).ply;
    if (g.kind === "ut") return 81 - count(utParse(g.payload).cells, ".");
    if (g.kind === "db") return DB_EDGES - count(dbParse(g.payload).edges, ".");
    const p = rpPicks(g);
    return p.x.length + p.o.length;
}

export function moreNextMove(prev: Game, next: Game, author: string): boolean {
    const turn = moreTurn(prev);
    if (turn !== "both" && author !== (turn === "x" ? prev.x : next.o)) return false;
    if (prev.kind === "ck") return ckNext(prev.payload, next.payload);
    if (prev.kind === "ut") return utNext(prev.payload, next.payload);
    if (prev.kind === "db") return dbNext(prev.payload, next.payload);
    return rpNext(prev, next, author);
}
