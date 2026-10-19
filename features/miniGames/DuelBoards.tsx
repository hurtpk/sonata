/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What Battleship and Word Duel look like under a game message.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { React, useState } from "@webpack/common";

import { BS, bsState, cellChar, encodeFleet, FLEET, fleetCells, joinParts, markGuess, parts, randomFleet, scramble, Ship, SHIP_NAMES, shipCells, sunkShips, validWord, WD_LEN, WD_TRIES, wdState } from "./duelRules";
import type { Game } from "./games";

const mg = classNameFactory("vc-mg-");

/* ── Placing ships ──────────────────────────────────────────────────── */

export function FleetPlacer({ fleet, setFleet }: { fleet: (Ship | null)[]; setFleet(f: (Ship | null)[]): void; }) {
    const [sel, setSel] = useState(() => Math.max(0, fleet.findIndex(s => !s)));
    const [dir, setDir] = useState<"h" | "v">("h");
    const [hover, setHover] = useState<number | null>(null);
    const placed = fleet.map((s, i) => s ? shipCells(FLEET[i], s) ?? [] : []);
    const owner = new Map<number, number>();
    placed.forEach((cells, i) => cells.forEach(c => owner.set(c, i)));
    const preview = hover != null ? shipCells(FLEET[sel], { cell: hover, dir }) : null;
    const previewOk = !!preview && preview.every(c => owner.get(c) === undefined || owner.get(c) === sel);

    const place = (cell: number) => {
        const at = owner.get(cell);
        // Clicking a placed ship picks it up again.
        if (at !== undefined && at !== sel) { setSel(at); return; }
        const cells = shipCells(FLEET[sel], { cell, dir });
        if (!cells || cells.some(c => owner.get(c) !== undefined && owner.get(c) !== sel)) return;
        const next = fleet.slice();
        next[sel] = { cell, dir };
        setFleet(next);
        const nextEmpty = next.findIndex(s => !s);
        if (nextEmpty >= 0) setSel(nextEmpty);
    };

    return (
        <div className={mg("place")}>
            <div className={mg("place-ships")}>
                {FLEET.map((size, i) => (
                    <button key={i} type="button" className={classes(mg("ship-pick"), sel === i && mg("ship-pick-on"), fleet[i] && mg("ship-pick-done"))} onClick={() => setSel(i)}>
                        <span className={mg("ship-dots")}>{"■".repeat(size)}</span>{SHIP_NAMES[i]}
                    </button>
                ))}
                <div className={mg("place-tools")}>
                    <button type="button" className={mg("btn2")} onClick={() => setDir(d => d === "h" ? "v" : "h")}>{dir === "h" ? "↔ Across" : "↕ Down"}</button>
                    <button type="button" className={mg("btn2")} onClick={() => setFleet(randomFleet())}>🎲 Random</button>
                    <button type="button" className={mg("btn2")} onClick={() => { setFleet(FLEET.map(() => null)); setSel(0); }}>Clear</button>
                </div>
            </div>
            <div className={mg("grid")} style={{ "--n": BS } as React.CSSProperties} onMouseLeave={() => setHover(null)}
                onContextMenu={e => { e.preventDefault(); setDir(d => d === "h" ? "v" : "h"); }}>
                {Array.from({ length: BS * BS }, (_, i) => {
                    const o = owner.get(i);
                    const inPreview = preview?.includes(i);
                    return (
                        <button key={i} type="button" className={classes(mg("sq"), o !== undefined && mg("sq-ship"), o === sel && mg("sq-sel"), inPreview && (previewOk ? mg("sq-prev") : mg("sq-bad")))}
                            onMouseEnter={() => setHover(i)} onClick={() => place(i)} aria-label={`Square ${i + 1}`} />
                    );
                })}
            </div>
            <span className={mg("hint")}>Pick a ship, then click where it starts. Right-click the grid (or the button) to turn it.</span>
        </div>
    );
}

/* ── Battleship board ───────────────────────────────────────────────── */

interface DuelProps {
    g: Game;
    me: string | undefined;
    canPlay: boolean;
    nameOf(id: string | null): string;
    onMove(next: Game, line: string): void;
}

function Grid({ label, ships, shots, reveal, onShoot, live }: { label: string; ships: number[][] | null; shots: number[]; reveal: boolean; onShoot?(i: number): void; live: boolean; }) {
    const shipAt = new Set((ships ?? []).flat());
    const sunk = new Set(sunkShips(ships, shots).flatMap(i => ships![i]));
    const last = shots.at(-1);
    return (
        <div className={mg("side")}>
            <span className={mg("side-label")}>{label}</span>
            <div className={classes(mg("grid"), live && mg("grid-live"))} style={{ "--n": BS } as React.CSSProperties}>
                {Array.from({ length: BS * BS }, (_, i) => {
                    const shot = shots.includes(i), hit = shot && shipAt.has(i);
                    return (
                        <button key={i} type="button" disabled={!live || shot} onClick={() => onShoot?.(i)}
                            className={classes(mg("sq"), reveal && shipAt.has(i) && mg("sq-ship"), shot && (hit ? mg("sq-hit") : mg("sq-miss")), sunk.has(i) && mg("sq-sunk"), i === last && mg("sq-last"))}
                            aria-label={`Square ${i + 1}${shot ? hit ? ", hit" : ", miss" : ""}`}>
                            {shot ? hit ? "✹" : "•" : ""}
                        </button>
                    );
                })}
            </div>
            {ships && <span className={mg("hint")}>{FLEET.length - sunkShips(ships, shots).length} of {FLEET.length} ships still afloat</span>}
        </div>
    );
}

export function BattleshipBoard({ g, me, canPlay, nameOf, onMove }: DuelProps) {
    const s = bsState(g);
    const p = parts(g);
    const [fleet, setFleet] = useState<(Ship | null)[]>(() => randomFleet());
    const joining = canPlay && !s.joined;
    const meX = me === g.x, meO = !!me && me === g.o;
    const over = !!s.winner;

    const shoot = (i: number) => {
        if (!canPlay) return;
        if (joining) {
            if (!fleetCells(fleet)) return;
            const next: Game = { ...g, o: me!, payload: joinParts({ ...p, b: encodeFleet(fleet as Ship[], g.id + me), mb: p.mb + cellChar(i) }) };
            const hit = s.fleetX?.flat().includes(i);
            onMove(next, `${nameOf(me!)} joined and fired — ${hit ? "💥 hit!" : "miss."} ${nameOf(g.x)}'s turn.`);
            return;
        }
        const enemy = meX ? s.fleetO : s.fleetX;
        const before = meX ? s.shotsX : s.shotsO;
        const nextParts = meX ? { ...p, ma: p.ma + cellChar(i) } : { ...p, mb: p.mb + cellChar(i) };
        const next: Game = { ...g, payload: joinParts(nextParts) };
        const hit = !!enemy?.flat().includes(i);
        const sunkNow = sunkShips(enemy, [...before, i]).filter(k => !sunkShips(enemy, before).includes(k));
        const ns = bsState(next);
        const tail = ns.winner ? `${nameOf(me!)} sank the whole fleet and wins! 🏆` : `${nameOf(meX ? g.o : g.x)}'s turn.`;
        onMove(next, `${nameOf(me!)} fired — ${hit ? sunkNow.length ? `💥 sank the ${SHIP_NAMES[sunkNow[0]].toLowerCase()}!` : "💥 hit!" : "miss."} ${tail}`);
    };

    if (joining) {
        const ready = !!fleetCells(fleet);
        return (
            <div className={mg("bs")}>
                <div className={mg("side")}>
                    <span className={mg("side-label")}>1 · Place your fleet</span>
                    <FleetPlacer fleet={fleet} setFleet={setFleet} />
                </div>
                <Grid label={ready ? `2 · Fire your first shot at ${nameOf(g.x)}` : "2 · Then fire your first shot"} ships={s.fleetX} shots={s.shotsO} reveal={false} onShoot={shoot} live={ready} />
            </div>
        );
    }

    if (meX || meO) {
        const mine = meX ? s.fleetX : s.fleetO, theirs = meX ? s.fleetO : s.fleetX;
        const myShots = meX ? s.shotsX : s.shotsO, theirShots = meX ? s.shotsO : s.shotsX;
        return (
            <div className={mg("bs")}>
                <Grid label={`${nameOf(meX ? g.o : g.x)}'s waters`} ships={theirs} shots={myShots} reveal={over} onShoot={shoot} live={canPlay} />
                <Grid label="Your fleet" ships={mine} shots={theirShots} reveal live={false} />
            </div>
        );
    }

    // Watching someone else's game.
    return (
        <div className={mg("bs")}>
            <Grid label={`${nameOf(g.x)}'s fleet`} ships={s.fleetX} shots={s.shotsO} reveal={over} live={false} />
            <Grid label={`${nameOf(g.o)}'s fleet`} ships={s.fleetO} shots={s.shotsX} reveal={over} live={false} />
        </div>
    );
}

export function bsStatus(g: Game, nameOf: (id: string | null) => string): string {
    const s = bsState(g);
    if (s.winner) return `${nameOf(s.winner === "x" ? g.x : g.o)} sank the whole fleet and wins!`;
    if (!s.joined) return `Waiting for ${g.o ? nameOf(g.o) : "someone"} to place their fleet`;
    return `${nameOf(s.turn === "x" ? g.x : g.o)}'s turn to fire`;
}

/* ── Word Duel board ────────────────────────────────────────────────── */

function Rows({ guesses, word, label, hidden }: { guesses: string[]; word: string; label: string; hidden?: boolean; }) {
    return (
        <div className={mg("side")}>
            <span className={mg("side-label")}>{label}</span>
            <div className={mg("wd-rows")}>
                {Array.from({ length: WD_TRIES }, (_, r) => {
                    const gs = guesses[r];
                    const marks = gs && word ? markGuess(gs, word) : null;
                    return (
                        <div key={r} className={mg("wd-row")}>
                            {Array.from({ length: WD_LEN }, (_, c) => (
                                <span key={c} className={classes(mg("wd-tile"), marks && mg(`wd-${marks[c]}`), gs && mg("wd-filled"))}>{gs && !hidden ? gs[c].toUpperCase() : ""}</span>
                            ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export function WordDuelBoard({ g, me, canPlay, nameOf, onMove }: DuelProps) {
    const s = wdState(g);
    const p = parts(g);
    const [secret, setSecret] = useState("");
    const [guess, setGuess] = useState("");
    const [err, setErr] = useState<string | null>(null);
    const joining = canPlay && !s.joined;
    const meX = me === g.x, meO = !!me && me === g.o;
    const isPlayer = meX || meO;

    const letters = new Map<string, "hit" | "near" | "miss">();
    const myGuesses = meX ? s.guessesX : s.guessesO, myTarget = meX ? s.wordO : s.wordX;
    for (const gs of myGuesses) markGuess(gs, myTarget).forEach((m, i) => {
        const prev = letters.get(gs[i]);
        if (prev !== "hit" && (m === "hit" || prev !== "near")) letters.set(gs[i], m);
    });

    const submit = () => {
        const w = guess.trim().toLowerCase();
        if (!validWord(w)) { setErr(`Guesses are ${WD_LEN} letters.`); return; }
        if (joining) {
            const sw = secret.trim().toLowerCase();
            if (!validWord(sw)) { setErr(`Pick a ${WD_LEN}-letter word for ${nameOf(g.x)} first.`); return; }
            const next: Game = { ...g, o: me!, payload: joinParts({ ...p, b: scramble(sw, g.id + me), mb: p.mb + w }) };
            onMove(next, `${nameOf(me!)} joined and made their first guess. ${nameOf(g.x)}'s turn.`);
        } else {
            const next: Game = { ...g, payload: joinParts(meX ? { ...p, ma: p.ma + w } : { ...p, mb: p.mb + w }) };
            const ns = wdState(next);
            const right = w === myTarget;
            const tail = ns.done ? ns.draw ? "It's a draw!" : `${nameOf(ns.winner === "x" ? g.x : g.o)} wins! 🏆` : right ? `Got it in ${myGuesses.length + 1}! ${meO ? `${nameOf(g.x)} gets one last try to tie.` : ""}` : `${nameOf(meX ? g.o : g.x)}'s turn.`;
            onMove(next, `${nameOf(me!)} guessed (${myGuesses.length + 1}/${WD_TRIES}). ${tail}`);
        }
        setGuess(""); setErr(null);
    };

    const input = canPlay && (
        <div className={mg("wd-input")}>
            {joining && <input className="vc-tool-input" type="password" maxLength={WD_LEN} value={secret} placeholder={`Your secret ${WD_LEN}-letter word for ${nameOf(g.x)}`} onChange={e => setSecret(e.currentTarget.value.replace(/[^a-z]/gi, ""))} />}
            <div className={mg("wd-guess")}>
                <input className="vc-tool-input" maxLength={WD_LEN} value={guess} placeholder="Your guess" onChange={e => setGuess(e.currentTarget.value.replace(/[^a-z]/gi, ""))} onKeyDown={e => { if (e.key === "Enter") submit(); }} />
                <button type="button" className={mg("btn")} style={{ marginLeft: 0 }} onClick={submit}>Guess</button>
            </div>
            {err && <span className={mg("hint")} style={{ color: "var(--status-danger, #f23f43)" }}>{err}</span>}
            {!joining && (
                <div className={mg("wd-keys")}>
                    {"qwertyuiopasdfghjklzxcvbnm".split("").map(l => <span key={l} className={classes(mg("wd-key"), letters.get(l) && mg(`wd-${letters.get(l)}`))}>{l.toUpperCase()}</span>)}
                </div>
            )}
        </div>
    );

    if (!s.joined && !joining) {
        return <div className={mg("hint")}>Waiting for {g.o ? nameOf(g.o) : "someone"} to pick a word for {nameOf(g.x)} and guess first.</div>;
    }

    return (
        <div className={mg("wd")}>
            {isPlayer || joining ? (
                <>
                    <Rows label={`Your guesses at ${nameOf(meX ? g.o : g.x)}'s word`} guesses={joining ? [] : myGuesses} word={myTarget} />
                    <Rows label={`${nameOf(meX ? g.o : g.x)}'s guesses at your word`} guesses={meX ? s.guessesO : s.guessesX} word={meX ? s.wordX : s.wordO} />
                </>
            ) : (
                <>
                    <Rows label={`${nameOf(g.o)} guessing`} guesses={s.guessesO} word={s.wordX} hidden={!s.done} />
                    <Rows label={`${nameOf(g.x)} guessing`} guesses={s.guessesX} word={s.wordO} hidden={!s.done} />
                </>
            )}
            {input}
            {s.done && <div className={mg("hint")}>The words were <b>{s.wordX.toUpperCase()}</b> ({nameOf(g.x)}'s) and <b>{s.wordO.toUpperCase()}</b> ({nameOf(g.o)}'s).</div>}
        </div>
    );
}

export function wdStatus(g: Game, nameOf: (id: string | null) => string): string {
    const s = wdState(g);
    if (s.done) return s.draw ? "It's a draw." : `${nameOf(s.winner === "x" ? g.x : g.o)} wins!`;
    if (!s.joined) return `Waiting for ${g.o ? nameOf(g.o) : "someone"} to join`;
    return `${nameOf(s.turn === "x" ? g.x : g.o)}'s turn · round ${Math.min(WD_TRIES, s.guessesX.length + 1)} of ${WD_TRIES}`;
}
