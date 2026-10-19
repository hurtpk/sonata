/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Every public game a group (or player) owns, with live player counts and
// the totals across all of them.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useEffect, useState } from "@webpack/common";

import { ago, cardActions, fetchOwnedGames, RbxOwnedGame, short } from "./data";

const rb = classNameFactory("vc-rbx-");

export function OwnedGames({ kind, id, name, emptyText }: { kind: "group" | "user"; id: string; name: string; emptyText?: string; }) {
    const [state, setState] = useState<{ games?: RbxOwnedGame[]; more?: boolean; error?: string; }>({});
    const [all, setAll] = useState(false);
    const [tick, setTick] = useState(0);
    useEffect(() => {
        let alive = true;
        setState({});
        fetchOwnedGames(kind, id, tick > 0).then(r => alive && setState(r.ok ? { games: r.games, more: r.more } : { error: r.error }));
        return () => { alive = false; };
    }, [kind, id, tick]);

    if (state.error) return <span className={rb("muted")}>🎮 Couldn't get their games: {state.error}</span>;
    if (!state.games) return <div className={rb("loading")}><span className={rb("spin")} /> Finding {kind === "group" ? "the group's" : "their"} games…</div>;
    const { games } = state;
    if (!games.length) return kind === "group" || emptyText ? <span className={rb("muted")}>🎮 {emptyText ?? `${name} doesn't own any public games.`}</span> : null;

    const playing = games.reduce((a, g) => a + g.playing, 0);
    const visits = games.reduce((a, g) => a + g.visits, 0);
    const live = games.filter(g => g.playing > 0).length;
    const shown = all ? games : games.slice(0, 8);

    return (
        <div className={rb("owned")}>
            <div className={rb("outfit-head")}>
                <div>
                    <b>🎮 {games.length}{state.more ? "+" : ""} game{games.length === 1 ? "" : "s"} {kind === "group" ? "owned by the group" : "they made"}</b>
                    <span><span className={rb("live")}>{short(playing)} playing now</span> across {live} of them · {short(visits)} visits in all</span>
                </div>
                <span className={rb("spacer")} />
                <button type="button" className={rb("link")} onClick={() => setTick(t => t + 1)} title="Check again">↻</button>
            </div>
            <div className={rb("owned-list")}>
                {shown.map(g => {
                    const share = playing ? g.playing / playing * 100 : 0;
                    return (
                        <div key={g.universeId} className={rb("owned-row")}>
                            {g.icon ? <img src={g.icon} alt="" loading="lazy" /> : <span className={rb("img-none")}>🧱</span>}
                            <div className={rb("owned-main")}>
                                <b>{g.name}</b>
                                <span>{short(g.visits)} visits · {short(g.favorites)} favourites{g.updated ? ` · updated ${ago(g.updated)}` : ""}</span>
                                {playing > 0 && <span className={rb("bar-track")}><span className={rb("bar-fill")} style={{ width: `${Math.max(share, g.playing ? 1.5 : 0)}%` }} /></span>}
                            </div>
                            <span className={classes(rb("owned-playing"), g.playing > 0 && rb("live"))}>{short(g.playing)}<small>playing</small></span>
                            {g.placeId && (
                                <span className={rb("owned-btns")}>
                                    <button type="button" className={rb("link")} onClick={() => cardActions.lookup(`https://www.roblox.com/games/${g.placeId}`)}>Details</button>
                                    {g.playing > 0 && <button type="button" className={rb("link")} onClick={() => cardActions.servers(g.placeId)}>Servers</button>}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
            {games.length > 8 && <button type="button" className={rb("link")} onClick={() => setAll(a => !a)}>{all ? "Show fewer" : `Show all ${games.length}`}</button>}
        </div>
    );
}
