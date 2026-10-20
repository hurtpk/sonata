/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { sendMessage } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, openModal, SelectedChannelStore, showToast, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { Window } from "../_shared/Window";
import { gameMessage } from "./Board";
import { FleetPlacer } from "./DuelBoards";
import { encodeFleet, fleetCells, randomFleet, scramble, Ship, validWord, WD_LEN } from "./duelRules";
import { emptyBoard, Game, GAME_NAMES, hangmanPayload, Kind, newId } from "./games";

const cl = classNameFactory("vc-tool-");
const mg = classNameFactory("vc-mg-");

const GAMES: { kind: Kind; emoji: string; blurb: string; }[] = [
    { kind: "ttt", emoji: "⭕", blurb: "Three in a row on a 3 × 3 grid." },
    { kind: "c4", emoji: "🔴", blurb: "Drop discs and line up four." },
    { kind: "hm", emoji: "🔤", blurb: "Pick a word; they guess it letter by letter." },
    { kind: "bs", emoji: "🚢", blurb: "Hide your fleet, take turns firing, sink theirs." },
    { kind: "wd", emoji: "🟩", blurb: "You each pick a 5-letter word — first to guess the other's wins." },
    { kind: "ck", emoji: "⛀", blurb: "Jump their pieces, reach the far side for a king." },
    { kind: "ut", emoji: "#️⃣", blurb: "Nine tic-tac-toe boards in one — where you play sends them." },
    { kind: "db", emoji: "🔲", blurb: "Draw lines, close boxes — a box earns another go." },
    { kind: "rp", emoji: "✊", blurb: "Rock, paper, scissors — first to 3 wins. Picks stay hidden." },
];

function StartModal({ modalProps, channelId }: { modalProps: RenderModalProps; channelId: string; }) {
    const accent = windowAccent("miniGames");
    const [kind, setKind] = useState<Kind>("ttt");
    const [word, setWord] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [fleet, setFleet] = useState<(Ship | null)[]>(() => randomFleet());
    const me = UserStore.getCurrentUser();
    const channel: any = ChannelStore.getChannel(channelId);
    // In a one-to-one DM the other player is known; anywhere else, whoever plays second joins.
    const other: string | null = channel?.type === 1 ? (channel.recipients?.[0] ?? null) : null;

    const start = () => {
        const id = newId();
        let payload: string;
        if (kind === "hm") {
            const w = word.trim().toLowerCase().replace(/\s+/g, " ");
            if (!/^[a-z][a-z ]{1,24}[a-z]$/.test(w)) { setError("Use 3–26 letters (spaces between words are fine)."); return; }
            payload = hangmanPayload(w, id);
        } else if (kind === "bs") {
            if (!fleetCells(fleet)) { setError("Place all five ships first (or press Random)."); return; }
            payload = `${encodeFleet(fleet as Ship[], id + me.id)}~~~`;
        } else if (kind === "wd") {
            const w = word.trim().toLowerCase();
            if (!validWord(w)) { setError(`Pick a word of exactly ${WD_LEN} letters.`); return; }
            payload = `${scramble(w, id + me.id)}~~~`;
        } else payload = emptyBoard(kind);
        const g: Game = { v: 2, kind, id, x: me.id, o: other, payload };
        const who = (me as any).globalName || me.username;
        const line = kind === "hm" ? `${who} picked a word. ${other ? "Your turn to guess!" : "Anyone can guess."}`
            : kind === "bs" ? `${who} hid their fleet. ${other ? "Place yours and fire first!" : "Anyone can take them on."}`
                : kind === "wd" ? `${who} picked a 5-letter word for you to guess. ${other ? "Pick one for them and guess first!" : "Anyone can join."}`
                    : kind === "rp" ? `${who} wants to play Rock Paper Scissors — first to 3 wins. ${other ? "Pick yours!" : "Anyone can play."}`
                        : `${who} started a game. Their move first.`;
        sendMessage(channelId, { content: gameMessage(g, line) });
        showToast(`${GAME_NAMES[kind]} started`, "success");
        modalProps.onClose();
    };

    return (
        <Window {...modalProps} size="lg" title="Mini Games" subtitle={other ? "Play right here in this DM" : "Play in this channel — the first person to answer joins"}>
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon={GAMES.find(g => g.kind === kind)?.emoji ?? "🎮"} kicker={other ? `With ${(UserStore.getUser(other) as any)?.globalName ?? UserStore.getUser(other)?.username ?? "them"}` : "Anyone here can join"}
                    title={GAME_NAMES[kind]} sub={GAMES.find(g => g.kind === kind)?.blurb}>
                    <button type="button" className={classes(cl("btn"), cl("primary"))} onClick={start}>▶ Start</button>
                </ToolHero>
                <div className={mg("pick")}>
                    {GAMES.map(gm => (
                        <button key={gm.kind} type="button" className={classes(mg("tile"), kind === gm.kind && mg("tile-on"))} onClick={() => setKind(gm.kind)}>
                            <span className={mg("tile-emoji")}>{gm.emoji}</span>
                            <span className={mg("tile-name")}>{GAME_NAMES[gm.kind]}</span>
                            <span className={mg("tile-blurb")}>{gm.blurb}</span>
                        </button>
                    ))}
                </div>
                {kind === "bs" && (
                    <div className={cl("card")}>
                        <span className={cl("label")}>Hide your fleet</span>
                        <FleetPlacer fleet={fleet} setFleet={setFleet} />
                    </div>
                )}
                {kind === "wd" && (
                    <div className={cl("card")}>
                        <span className={cl("label")}>A {WD_LEN}-letter word for them to guess</span>
                        <input className={cl("input")} type="password" autoFocus value={word} maxLength={WD_LEN} placeholder="e.g. crane" onChange={e => setWord(e.currentTarget.value.replace(/[^a-z]/gi, ""))}
                            onKeyDown={e => { if (e.key === "Enter") start(); }} />
                        <span className={cl("hint")}>They pick one for you too. You take turns guessing, Wordle-style (green = right spot, yellow = in the word) — 6 tries each.</span>
                    </div>
                )}
                {kind === "hm" && (
                    <div className={cl("card")}>
                        <span className={cl("label")}>Your secret word</span>
                        <input className={cl("input")} type="password" autoFocus value={word} maxLength={26} placeholder="Type a word or short phrase" onChange={e => setWord(e.currentTarget.value)}
                            onKeyDown={e => { if (e.key === "Enter") start(); }} />
                        <span className={cl("hint")}>Letters only. It's scrambled in the message so it can't be read at a glance.</span>
                    </div>
                )}
                <div className={cl("hint")}>Both of you need Sonata to play. People without it see a short summary of each move.</div>
                {error && <div className={cl("error")}>{error}</div>}
                <div className={cl("footer")}>
                    <span className={cl("spacer")} />
                    <button type="button" className={cl("btn")} onClick={modalProps.onClose}>Cancel</button>
                    <button type="button" className={classes(cl("btn"), cl("primary"))} onClick={start}>Start {GAME_NAMES[kind]}</button>
                </div>
            </div>
        </Window>
    );
}

export function openMiniGames() {
    const channelId = SelectedChannelStore.getChannelId();
    if (!channelId) { showToast("Open a DM or channel first", "failure"); return; }
    openModal(props => <StartModal modalProps={props} channelId={channelId} />);
}
