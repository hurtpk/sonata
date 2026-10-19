/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The board shown under a game message. A game is two messages, one per
// player, each edited as they move: the board is shown (and played) under
// whichever holds the newest move, and the other one points to it.

import { classNameFactory } from "@utils/css";
import { sendMessage } from "@utils/discord";
import { classes } from "@utils/misc";
import { ChannelStore, MessageActions, MessageStore, NavigationRouter, UserStore, useStateFromStores } from "@webpack/common";

import { BattleshipBoard, bsStatus, wdStatus,WordDuelBoard } from "./DuelBoards";
import { bsState, encodeFleet, randomFleet, wdState } from "./duelRules";
import { boardOutcome, C4, c4Drop, emptyBoard, encodeGame, Game, GAME_NAMES, GameMessage, hangmanState, isDuel, isFinished, MAX_WRONG, newId, parseGame, resolveGame, turnOf } from "./games";
import { CheckersBoard, DotsBoard, moreCanPlay, moreStatus, RpsBoard, UltimateBoard } from "./MoreBoards";
import { isMore } from "./moreGames";

const mg = classNameFactory("vc-mg-");

const nameOf = (id: string | null) => {
    if (!id) return "anyone";
    const u: any = UserStore.getUser(id);
    return u?.globalName || u?.username || "someone";
};

/** The text everyone sees (people without Sonata see just this), with the game tucked into a spoiler. */
export function gameMessage(g: Game, line: string) {
    return `🎮 **${GAME_NAMES[g.kind]}** — ${line}\n-# Play along with Sonata · ||${encodeGame(g)}||`;
}

function statusLine(g: Game): string {
    if (isMore(g.kind)) return moreStatus(g, nameOf);
    if (g.kind === "bs") return bsStatus(g, nameOf);
    if (g.kind === "wd") return wdStatus(g, nameOf);
    if (g.kind === "hm") {
        const s = hangmanState(g);
        if (s.solved) return `${nameOf(g.o)} guessed the word!`;
        if (s.lost) return `${nameOf(g.o)} ran out of guesses. The word was "${s.word}".`;
        return `${nameOf(g.o)} to guess · ${MAX_WRONG - s.wrong} wrong guesses left`;
    }
    const o = boardOutcome(g.kind, g.payload);
    if (o.winner) return `${nameOf(o.winner === "x" ? g.x : g.o)} wins!`;
    if (o.draw) return "It's a draw.";
    const t = turnOf(g.payload);
    return `${nameOf(t === "x" ? g.x : g.o)}'s turn`;
}

function Gallows({ wrong }: { wrong: number; }) {
    const parts = [
        <circle key="h" cx="70" cy="34" r="9" />,
        <path key="b" d="M70 43V72" />,
        <path key="la" d="M70 52 58 64" />,
        <path key="ra" d="M70 52 82 64" />,
        <path key="ll" d="M70 72 60 90" />,
        <path key="rl" d="M70 72 80 90" />,
    ];
    return (
        <svg className={mg("gallows")} viewBox="0 0 100 104" aria-hidden>
            <path className={mg("gallows-frame")} d="M10 100H60M25 100V8H70V25" />
            <g className={mg("gallows-man")}>{parts.slice(0, wrong)}</g>
        </svg>
    );
}

type Seen = GameMessage & { changed: number; };

/** This game's messages in the channel (and the ones they point to), kept up to date as moves are edited in. */
function useGameMessages(channelId: string, message: any, gameId: string | null) {
    const raw = useStateFromStores([MessageStore], () => {
        if (!gameId) return "";
        const list: any[] = (MessageStore.getMessages(channelId) as any)?._array ?? [];
        const out = new Map<string, [string, string, number]>();
        const add = (m: any) => {
            if (!m?.id || out.has(m.id)) return;
            out.set(m.id, [m.author?.id ?? "", m.content ?? "", Number(m.editedTimestamp ?? m.timestamp ?? 0)]);
        };
        for (const m of list) if (m.content?.includes(gameId)) add(m);
        add(message);
        for (const [, [, content]] of [...out]) {
            const ref = parseGame(content)?.ref;
            if (ref) add(MessageStore.getMessage(channelId, ref));
        }
        // A string, so the board only re-renders when something actually changed.
        return JSON.stringify([...out]);
    }, [channelId, gameId, message.id]);
    if (!raw) return [];
    return (JSON.parse(raw) as [string, [string, string, number]][]).flatMap(([id, [author, content, changed]]) => {
        const game = parseGame(content);
        return game ? [{ id, author, game, changed } as Seen] : [];
    });
}

function Note({ children }: { children: React.ReactNode; }) {
    return <div className={classes(mg("card"), mg("card-note"))}>{children}</div>;
}

export function GameAccessory({ message }: { message: any; }) {
    const me = UserStore.getCurrentUser()?.id;
    const channelId: string = message.channel_id;
    const here = parseGame(message?.content);
    const seen = useGameMessages(channelId, message, here?.v === 2 ? here.id : null);
    if (!here) return null;

    if (here.v === 1) return <Note>🎮 A game from an older Sonata (one message per move). Start a new one from the 🎮 button to play.</Note>;

    const thisOne = seen.find(m => m.id === message.id);
    const res = resolveGame(seen.filter(m => m.game.v === 2 && m.game.id === here.id), here.x);
    if (!res || !thisOne) return null;
    const jump = (id: string) => NavigationRouter.transitionTo(`/channels/${ChannelStore.getChannel(channelId)?.guild_id ?? "@me"}/${channelId}/${id}`);

    // Rematches reuse the same two messages: if the message this one points to has since moved on to a new game, this game is over.
    const pointed = here.ref ? seen.find(m => m.id === here.ref) : null;
    if (!res.other && pointed && pointed.game.id !== here.id && pointed.changed > thisOne.changed) {
        return (
            <Note>
                🎮 This {GAME_NAMES[here.kind]} game is over — a new one started.{" "}
                <button type="button" className={mg("link")} onClick={() => jump(pointed.id)}>Go to it</button>
            </Note>
        );
    }

    // The other player's message: the game carries on in the newer one.
    if (res.current.id !== message.id) {
        return (
            <Note>
                🎮 {GAME_NAMES[here.kind]} — the game continues on {nameOf(res.current.author)}'s message.{" "}
                <button type="button" className={mg("link")} onClick={() => jump(res.current.id)}>Go to it</button>
            </Note>
        );
    }

    if (!res.ok) {
        return <div className={classes(mg("card"), mg("card-bad"))}>🎮 This move doesn't count — it wasn't that player's turn, or the board doesn't match the other player's message.</div>;
    }

    const g = res.current.game;
    const done = isFinished(g);

    // Every move edits your own message for this game — or, the first time you move, the message of yours
    // a rematch points to — so the game never adds more than one message per player.
    const players = [res.current, res.other].filter(Boolean) as GameMessage[];
    const pointedAt = g.ref ? seen.find(m => m.id === g.ref) : null;
    const mine = players.find(m => m.author === me) ?? (pointedAt?.author === me ? pointedAt : null);
    const partner = players.find(m => m.author !== me) ?? null;
    const send = (next: Game, line: string) => {
        const content = gameMessage({ ...next, ref: partner?.id ?? g.ref ?? null }, line);
        if (mine) MessageActions.editMessage(channelId, mine.id, { content });
        else sendMessage(channelId, { content });
    };
    const takesO = !g.o && me !== g.x;
    const nextO = g.o ?? (takesO ? me! : null);

    let canPlay = false;
    if (!done && me) {
        if (isDuel(g.kind)) {
            const st = g.kind === "bs" ? bsState(g) : wdState(g);
            canPlay = !st.joined ? me !== g.x && (!g.o || me === g.o) : st.turn === "x" ? me === g.x : me === g.o;
        } else if (isMore(g.kind)) canPlay = moreCanPlay(g, me);
        else if (g.kind === "hm") canPlay = me === g.o || (!g.o && me !== g.x);
        else canPlay = turnOf(g.payload) === "x" ? me === g.x : (g.o ? me === g.o : me !== g.x);
    }

    const playCell = (i: number) => {
        if (!canPlay || g.kind === "hm") return;
        const cell = g.kind === "c4" ? c4Drop(g.payload, i % C4.W) : i;
        if (cell < 0 || g.payload[cell] !== ".") return;
        const mark = turnOf(g.payload);
        const next: Game = { ...g, o: nextO, payload: g.payload.slice(0, cell) + mark + g.payload.slice(cell + 1) };
        send(next, `${nameOf(me!)} played. ${statusLine(next)}`);
    };

    const guess = (letter: string) => {
        if (!canPlay || g.kind !== "hm") return;
        const s = hangmanState(g);
        if (s.letters.has(letter)) return;
        const next: Game = { ...g, o: nextO, payload: `${s.code}~${s.guesses}${letter}` };
        const hit = s.word.includes(letter);
        send(next, `${nameOf(me!)} guessed "${letter.toUpperCase()}" — ${hit ? "it's in there!" : "nope."} ${statusLine(next)}`);
    };

    const rematch = () => {
        if (!me) return;
        const other = me === g.x ? g.o : g.x;
        const id = newId();
        // Battleship rematches start with a random fleet (it can't be moved once the game is on).
        const payload = g.kind === "bs" ? `${encodeFleet(randomFleet(), id + me)}~~~` : emptyBoard(g.kind);
        const next: Game = { v: 2, kind: g.kind, id, x: me, o: other, payload };
        send(next, `${nameOf(me)} wants a rematch. ${statusLine(next)}`);
    };

    const isPlayer = me === g.x || me === g.o;
    const outcome = g.kind === "hm" || isDuel(g.kind) || isMore(g.kind) ? null : boardOutcome(g.kind, g.payload);

    return (
        <div className={classes(mg("card"), canPlay && mg("card-live"))}>
            <div className={mg("head")}>
                <span className={mg("title")}>{GAME_NAMES[g.kind]}</span>
                <span className={mg("players")}>
                    <span className={mg("p-x")}>{nameOf(g.x)}</span> vs <span className={mg("p-o")}>{nameOf(g.o)}</span>
                </span>
            </div>

            {g.kind === "ttt" && (
                <div className={mg("ttt")}>
                    {[...g.payload].map((c, i) => (
                        <button key={i} type="button" className={classes(mg("cell"), outcome?.line?.includes(i) && mg("cell-win"), canPlay && c === "." && mg("cell-open"))}
                            disabled={!canPlay || c !== "."} onClick={() => playCell(i)} aria-label={`Square ${i + 1}${c === "." ? "" : `, ${c.toUpperCase()}`}`}>
                            {c === "x" && <span className={mg("x")}>✕</span>}
                            {c === "o" && <span className={mg("o")}>◯</span>}
                        </button>
                    ))}
                </div>
            )}

            {g.kind === "c4" && (
                <div className={classes(mg("c4"), canPlay && mg("c4-live"))} style={{ "--cols": C4.W } as React.CSSProperties}>
                    {[...g.payload].map((c, i) => (
                        <button key={i} type="button" className={classes(mg("slot"), outcome?.line?.includes(i) && mg("cell-win"))}
                            disabled={!canPlay || c4Drop(g.payload, i % C4.W) < 0} onClick={() => playCell(i)} aria-label={`Column ${(i % C4.W) + 1}`}>
                            {c !== "." && <span className={classes(mg("disc"), c === "x" ? mg("disc-x") : mg("disc-o"))} />}
                        </button>
                    ))}
                </div>
            )}

            {g.kind === "ck" && <CheckersBoard g={g} me={me} canPlay={canPlay} nextO={nextO} nameOf={nameOf} onMove={send} />}
            {g.kind === "ut" && <UltimateBoard g={g} me={me} canPlay={canPlay} nextO={nextO} nameOf={nameOf} onMove={send} />}
            {g.kind === "db" && <DotsBoard g={g} me={me} canPlay={canPlay} nextO={nextO} nameOf={nameOf} onMove={send} />}
            {g.kind === "rp" && <RpsBoard g={g} me={me} canPlay={canPlay} nextO={nextO} nameOf={nameOf} onMove={send} />}
            {g.kind === "bs" && <BattleshipBoard g={g} me={me} canPlay={canPlay} nameOf={nameOf} onMove={send} />}
            {g.kind === "wd" && <WordDuelBoard g={g} me={me} canPlay={canPlay} nameOf={nameOf} onMove={send} />}

            {g.kind === "hm" && (() => {
                const s = hangmanState(g);
                const reveal = done || me === g.x;
                return (
                    <div className={mg("hm")}>
                        <Gallows wrong={s.wrong} />
                        <div className={mg("hm-side")}>
                            <div className={mg("word")}>
                                {[...s.word].map((ch, i) => ch === " "
                                    ? <span key={i} className={mg("gap")} />
                                    : <span key={i} className={classes(mg("letter"), !s.letters.has(ch) && reveal && mg("letter-peek"))}>{s.letters.has(ch) || reveal ? ch.toUpperCase() : ""}</span>)}
                            </div>
                            {me === g.x && !done && <div className={mg("hint")}>It's your word — only you see the faded letters.</div>}
                            <div className={mg("keys")}>
                                {"abcdefghijklmnopqrstuvwxyz".split("").map(l => {
                                    const used = s.letters.has(l);
                                    return (
                                        <button key={l} type="button" disabled={!canPlay || used} onClick={() => guess(l)}
                                            className={classes(mg("key"), used && (s.word.includes(l) ? mg("key-hit") : mg("key-miss")))}>{l.toUpperCase()}</button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                );
            })()}

            <div className={mg("foot")}>
                <span className={classes(mg("status"), done && mg("status-done"))}>
                    {canPlay ? (takesO ? `Your move — playing this makes you ${g.kind === "hm" ? "the guesser" : "the second player"}.` : g.kind === "bs" ? "Your turn to fire!" : g.kind === "rp" ? "Pick one!" : "Your move!") : statusLine(g)}
                </span>
                {done && isPlayer && mine && g.kind !== "hm" && g.kind !== "wd" && <button type="button" className={mg("btn")} onClick={rematch}>Rematch</button>}
            </div>
        </div>
    );
}
