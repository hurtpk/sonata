/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The boards for Checkers, Ultimate Tic-tac-toe, Dots and Boxes and
// Rock-Paper-Scissors, shown under a game message (see Board).

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useState } from "@webpack/common";

import type { Game } from "./games";
import {
    ckApply, CkMove, ckMoves, ckParse, ckSq, DB_N, dbH, dbOutcome, dbParse, dbPlay, dbV, isMore, moreOutcome, moreTurn,
    RP_EMOJI, RP_WINS, rpPayload, rpScore, Side, utAllowed, utOutcome, utParse, utPlay, utSmall
} from "./moreGames";

const mg = classNameFactory("vc-mg-");

type Move = (next: Game, line: string) => void;
interface BoardProps { g: Game; me: string | undefined; canPlay: boolean; nextO: string | null; nameOf(id: string | null): string; onMove: Move; }

const sideOf = (g: Game, me: string | undefined): Side | null => me === g.x ? "x" : me && me === g.o ? "o" : null;

/** Whether `me` can move right now (for the four games here). */
export function moreCanPlay(g: Game, me: string | undefined): boolean {
    if (!me || !isMore(g.kind)) return false;
    const o = moreOutcome(g);
    if (o.winner || o.draw) return false;
    const turn = moreTurn(g);
    if (turn === "x") return me === g.x;
    if (turn === "o") return g.o ? me === g.o : me !== g.x;
    // Rock-Paper-Scissors: anyone in the game who isn't a pick ahead.
    const s = rpScore(g);
    if (me === g.x) return s.x.length <= s.o.length;
    return (g.o ? me === g.o : true) && s.o.length <= s.x.length;
}

export function moreStatus(g: Game, nameOf: (id: string | null) => string): string {
    const who = (s: Side | null) => nameOf(s === "x" ? g.x : s === "o" ? g.o : null);
    const o = moreOutcome(g);
    if (g.kind === "db") {
        const d = dbOutcome(g.payload);
        if (o.winner) return `${who(o.winner)} wins ${Math.max(d.x, d.o)}–${Math.min(d.x, d.o)}!`;
        if (o.draw) return `It's a draw, ${d.x}–${d.o}.`;
        return `${who(dbParse(g.payload).turn)}'s turn · ${d.x}–${d.o}`;
    }
    if (g.kind === "rp") {
        const s = rpScore(g);
        if (o.winner) return `${who(o.winner)} wins ${Math.max(s.xWins, s.oWins)}–${Math.min(s.xWins, s.oWins)}!`;
        if (o.draw) return `It's a draw, ${s.xWins}–${s.oWins}.`;
        return `Round ${s.rounds + 1} · ${s.xWins}–${s.oWins} · first to ${RP_WINS}`;
    }
    if (o.winner) return `${who(o.winner)} wins!`;
    if (o.draw) return g.kind === "ck" ? "It's a draw — 50 turns without a capture." : "It's a draw.";
    const t = moreTurn(g);
    return `${t === "both" ? "Everyone" : who(t)}'s turn`;
}

/* ── Checkers ──────────────────────────────────────────────────────── */

export function CheckersBoard({ g, me, canPlay, nextO, nameOf, onMove }: BoardProps) {
    const s = ckParse(g.payload);
    const [path, setPath] = useState<number[]>([]);
    const moves = canPlay ? ckMoves(s.board, s.turn) : [];
    const fits = moves.filter(m => path.every((sq, i) => m.path[i] === sq));
    const starts = new Set(moves.map(m => m.path[0]));
    const nexts = new Set(path.length ? fits.map(m => m.path[path.length]).filter(n => n != null) : []);
    const mustJump = moves.some(m => m.captured.length);
    // You look at the board from your own side.
    const flip = sideOf(g, me) === "o";

    const finish = (m: CkMove) => {
        setPath([]);
        const next: Game = { ...g, o: nextO, payload: ckApply(g.payload, m) };
        const kings = (b: string) => [...b].filter(c => c === "X" || c === "O").length;
        const crowned = kings(m.board) > kings(s.board);
        const line = `${nameOf(me!)} ${m.captured.length ? `jumped ${m.captured.length === 1 ? "a piece" : `${m.captured.length} pieces`}` : "moved"}${crowned ? " and got a king 👑" : ""}. ${moreStatus(next, nameOf)}`;
        onMove(next, line);
    };

    const click = (sq: number) => {
        if (!canPlay) return;
        if (!path.length || (starts.has(sq) && !nexts.has(sq))) {
            if (starts.has(sq)) setPath(path[0] === sq && path.length === 1 ? [] : [sq]);
            return;
        }
        if (!nexts.has(sq)) return;
        const p = [...path, sq];
        const done = moves.find(m => m.path.length === p.length && m.path.every((x, i) => x === p[i]));
        if (done) finish(done);
        else setPath(p);
    };

    const rows = flip ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    const cols = flip ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    return (
        <div className={mg("ck-wrap")}>
            <div className={classes(mg("ck"), canPlay && mg("ck-live"))}>
                {rows.flatMap(r => cols.map(c => {
                    const sq = ckSq(r, c);
                    if (sq < 0) return <span key={`${r}-${c}`} className={mg("ck-light")} />;
                    const p = s.board[sq];
                    const picked = path.includes(sq);
                    return (
                        <button key={sq} type="button" className={classes(mg("ck-sq"), picked && mg("ck-picked"), (path.length ? nexts.has(sq) : starts.has(sq)) && mg("ck-can"))}
                            disabled={!canPlay} onClick={() => click(sq)} aria-label={`Square ${sq + 1}`}>
                            {p !== "." && <span className={classes(mg("ck-piece"), p.toLowerCase() === "x" ? mg("ck-x") : mg("ck-o"), p === p.toUpperCase() && mg("ck-king"))}>{p === p.toUpperCase() ? "♛" : ""}</span>}
                        </button>
                    );
                }))}
            </div>
            {canPlay && <span className={mg("hint")}>{path.length ? "Now pick where it goes — keep going while there's a jump." : mustJump ? "You have to jump — pick a glowing piece." : "Pick a piece, then where it goes."}</span>}
        </div>
    );
}

/* ── Ultimate Tic-tac-toe ──────────────────────────────────────────── */

export function UltimateBoard({ g, canPlay, nextO, nameOf, onMove, me }: BoardProps) {
    const { cells, last } = utParse(g.payload);
    const allowed = canPlay ? new Set(utAllowed(g.payload)) : new Set<number>();
    const big = utOutcome(g.payload);
    const play = (cell: number) => {
        if (!canPlay || cells[cell] !== "." || !allowed.has(Math.floor(cell / 9))) return;
        const next: Game = { ...g, o: nextO, payload: utPlay(g.payload, cell) };
        onMove(next, `${nameOf(me!)} played. ${moreStatus(next, nameOf)}`);
    };
    return (
        <div className={mg("ut")}>
            {Array.from({ length: 9 }, (_, b) => {
                const won = utSmall(cells, b);
                return (
                    <div key={b} className={classes(mg("ut-board"), allowed.has(b) && mg("ut-open"), big.line?.includes(b) && mg("cell-win"), (won === "x" || won === "o") && mg(`ut-won-${won}`))}>
                        {Array.from({ length: 9 }, (__, i) => {
                            const cell = b * 9 + i, c = cells[cell];
                            return (
                                <button key={i} type="button" className={classes(mg("ut-cell"), cell === last && mg("ut-last"))} disabled={!canPlay || c !== "." || !allowed.has(b)} onClick={() => play(cell)}>
                                    {c === "x" && <span className={mg("x")}>✕</span>}
                                    {c === "o" && <span className={mg("o")}>◯</span>}
                                </button>
                            );
                        })}
                        {(won === "x" || won === "o") && <span className={classes(mg("ut-big"), mg(won))}>{won === "x" ? "✕" : "◯"}</span>}
                    </div>
                );
            })}
        </div>
    );
}

/* ── Dots and Boxes ────────────────────────────────────────────────── */

export function DotsBoard({ g, canPlay, nextO, nameOf, onMove, me }: BoardProps) {
    const { edges, boxes } = dbParse(g.payload);
    const score = dbOutcome(g.payload);
    const draw = (e: number) => {
        if (!canPlay || edges[e] !== ".") return;
        const { payload, closed } = dbPlay(g.payload, e);
        const next: Game = { ...g, o: nextO, payload };
        onMove(next, `${nameOf(me!)} ${closed ? `closed ${closed === 1 ? "a box" : `${closed} boxes`} and goes again` : "drew a line"}. ${moreStatus(next, nameOf)}`);
    };
    const size = DB_N * 2 + 1;
    return (
        <div className={mg("db-wrap")}>
            <div className={mg("db-score")}>
                <span className={mg("p-x")}>{nameOf(g.x)} · {score.x}</span>
                <span className={mg("p-o")}>{nameOf(g.o)} · {score.o}</span>
            </div>
            <div className={classes(mg("db"), canPlay && mg("db-live"))} style={{ "--n": DB_N } as React.CSSProperties}>
                {Array.from({ length: size * size }, (_, k) => {
                    const r = Math.floor(k / size), c = k % size;
                    if (r % 2 === 0 && c % 2 === 0) return <span key={k} className={mg("db-dot")} />;
                    if (r % 2 === 1 && c % 2 === 1) {
                        const box = boxes[((r - 1) / 2) * DB_N + (c - 1) / 2];
                        return <span key={k} className={classes(mg("db-box"), box !== "." && mg(`db-box-${box}`))}>{box !== "." ? (box === "x" ? "✕" : "◯") : ""}</span>;
                    }
                    const e = r % 2 === 0 ? dbH(r / 2, (c - 1) / 2) : dbV((r - 1) / 2, c / 2);
                    const m = edges[e];
                    return (
                        <button key={k} type="button" className={classes(mg(r % 2 === 0 ? "db-h" : "db-v"), m !== "." && mg(`db-line-${m}`))}
                            disabled={!canPlay || m !== "."} onClick={() => draw(e)} aria-label="Draw this line" />
                    );
                })}
            </div>
        </div>
    );
}

/* ── Rock-Paper-Scissors ───────────────────────────────────────────── */

export function RpsBoard({ g, me, canPlay, nextO, nameOf, onMove }: BoardProps) {
    const s = rpScore(g);
    const side = sideOf(g, me) ?? (!g.o && me !== g.x ? "o" : null);
    const mineNow = side === "x" ? s.x : side === "o" ? s.o : "";
    const theirsNow = side === "x" ? s.o : side === "o" ? s.x : "";
    const pending = side && mineNow.length > s.rounds ? mineNow[s.rounds] : null;
    const theyPicked = side && theirsNow.length > s.rounds;

    const pickIt = (c: "r" | "p" | "s") => {
        if (!canPlay || !side) return;
        const x = side === "x" ? s.x + c : s.x, o = side === "o" ? s.o + c : s.o;
        const oId = g.o ?? nextO;
        const next: Game = { ...g, o: oId, payload: rpPayload({ ...g, o: oId }, x, o, oId) };
        const after = rpScore(next);
        // The pick stays secret until both have picked; then the round is shown.
        const line = after.rounds > s.rounds
            ? `Round ${after.rounds}: ${RP_EMOJI[after.x[after.rounds - 1]]} vs ${RP_EMOJI[after.o[after.rounds - 1]]} — ${after.results.at(-1) === "d" ? "a tie" : `${nameOf(after.results.at(-1) === "x" ? g.x : oId)} takes it`}. ${moreStatus(next, nameOf)}`
            : `${nameOf(me!)} picked — your turn to pick!`;
        onMove(next, line);
    };

    return (
        <div className={mg("rp")}>
            <div className={mg("rp-score")}>
                <span className={mg("p-x")}>{nameOf(g.x)}</span>
                <b>{s.xWins} – {s.oWins}</b>
                <span className={mg("p-o")}>{nameOf(g.o)}</span>
            </div>
            {s.rounds > 0 && (
                <div className={mg("rp-rounds")}>
                    {Array.from({ length: s.rounds }, (_, i) => (
                        <span key={i} className={classes(mg("rp-round"), mg(`rp-${s.results[i]}`))} title={`Round ${i + 1}`}>
                            {RP_EMOJI[s.x[i]]}<small>vs</small>{RP_EMOJI[s.o[i]]}
                        </span>
                    ))}
                </div>
            )}
            {canPlay ? (
                <div className={mg("rp-picks")}>
                    {(["r", "p", "s"] as const).map(c => (
                        <button key={c} type="button" className={mg("rp-pick")} onClick={() => pickIt(c)} title={c === "r" ? "Rock" : c === "p" ? "Paper" : "Scissors"}>{RP_EMOJI[c]}</button>
                    ))}
                </div>
            ) : pending ? (
                <span className={mg("hint")}>You picked {RP_EMOJI[pending]} — waiting for {nameOf(side === "x" ? g.o : g.x)} to pick.</span>
            ) : null}
            {theyPicked && canPlay && <span className={mg("hint")}>{nameOf(side === "x" ? g.o : g.x)} has picked — your turn!</span>}
        </div>
    );
}
