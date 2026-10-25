/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Server finder: a game's public servers, fullest or emptiest first, with
// room-for-friends and ping filters, and one click to join or share one.

import { copyWithToast } from "@utils/discord";
import { classes } from "@utils/misc";
import { showToast, useEffect, useMemo, useState } from "@webpack/common";

import { rb } from "./Card";
import { fetchRef, fetchServers, joinServer, parseLookup, RbxGame, RbxServer, serverLink, short } from "./data";

type Order = "Desc" | "Asc";

async function join(placeId: string, s?: RbxServer) {
    showToast(s ? `Joining a server with ${s.playing} player${s.playing === 1 ? "" : "s"}…` : "Opening Roblox…", "message");
    const why = await joinServer(placeId, s?.id);
    if (why) showToast(why, "failure");
}

function GameHead({ placeId }: { placeId: string; }) {
    const [g, setG] = useState<RbxGame | null>(null);
    const [err, setErr] = useState<string | null>(null);
    useEffect(() => {
        let alive = true;
        setG(null); setErr(null);
        fetchRef({ kind: "game", id: placeId }).then(r => { if (!alive) return; if (r.ok && r.info?.kind === "game") setG(r.info); else setErr(r.error ?? "Not found"); });
        return () => { alive = false; };
    }, [placeId]);
    if (err) return <span className="vc-tool-error">{err}</span>;
    if (!g) return <div className={rb("loading")}><span className={rb("spin")} /> Finding the game…</div>;
    return (
        <div className={rb("head")}>
            {g.icon ? <img className={rb("icon")} src={g.icon} alt="" /> : <span className={classes(rb("icon"), rb("img-none"))}>🧱</span>}
            <div className={rb("who")}>
                <b>{g.name}</b>
                <span><span className={rb("live")}>{short(g.playing)} playing</span> · {g.maxPlayers || "?"} per server · by {g.creator}</span>
            </div>
            <button type="button" className="vc-tool-btn" onClick={() => join(g.placeId)}>▶ Play</button>
        </div>
    );
}

function ServerRow({ placeId, s }: { placeId: string; s: RbxServer; }) {
    const pct = s.max ? Math.min(100, s.playing / s.max * 100) : 0;
    const free = s.max - s.playing;
    return (
        <div className={rb("server")}>
            <div className={rb("server-fill")}>
                <b>{s.playing}<small>/{s.max}</small></b>
                <span className={rb("bar-track")}><span className={classes(rb("bar-fill"), pct >= 90 && rb("bar-full"))} style={{ width: `${pct}%` }} /></span>
                <small>{free > 0 ? `${free} free` : "full"}</small>
            </div>
            {s.faces.length > 0 && <div className={rb("faces")}>{s.faces.map(f => <img key={f} src={f} alt="" />)}</div>}
            <div className={rb("server-meta")}>
                {s.ping != null && <span className={classes(rb("ping"), s.ping < 100 ? rb("up") : s.ping < 200 ? rb("flat") : rb("down"))} title="The server's average ping">📶 {s.ping} ms</span>}
                {s.fps != null && <span title="How smoothly the server is running (60 is perfect)">{s.fps} fps</span>}
            </div>
            <span className={rb("spacer")} />
            <button type="button" className="vc-tool-icon" title="Copy a link to this server — anyone who clicks it lands here" onClick={() => copyWithToast(serverLink(placeId, s.id), "Server link copied")}>🔗</button>
            <button type="button" className="vc-tool-btn vc-tool-primary" disabled={free <= 0} onClick={() => join(placeId, s)}>Join</button>
        </div>
    );
}

export function Servers({ initial }: { initial?: string; }) {
    const [text, setText] = useState(initial ?? "");
    const [placeId, setPlaceId] = useState<string | null>(() => initial ? parseLookup(initial)?.kind === "game" ? parseLookup(initial)!.id : /^\d+$/.test(initial) ? initial : null : null);
    const [order, setOrder] = useState<Order>("Desc");
    const [room, setRoom] = useState(1);
    const [maxPing, setMaxPing] = useState(0);
    const [list, setList] = useState<RbxServer[]>([]);
    const [next, setNext] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    const go = () => {
        const t = text.trim();
        const r = parseLookup(t);
        const id = r?.kind === "game" ? r.id : /^\d+$/.test(t) ? t : null;
        if (!id) { setErr("Paste a Roblox game link (roblox.com/games/…) or its place ID."); return; }
        setErr(null); setPlaceId(id); setTick(x => x + 1);
    };

    const load = async (cursor?: string) => {
        if (!placeId) return;
        setBusy(true); setErr(null);
        const r = await fetchServers(placeId, order, true, cursor);
        setBusy(false);
        if (!r.ok) { setErr(r.error); return; }
        setList(l => cursor ? [...l, ...r.servers.filter(s => !l.some(x => x.id === s.id))] : r.servers);
        setNext(r.next);
    };
    useEffect(() => { setList([]); setNext(null); void load(); }, [placeId, order, tick]);

    const shown = useMemo(() => list.filter(s => s.max - s.playing >= room && (!maxPing || (s.ping ?? 0) <= maxPing)), [list, room, maxPing]);
    const best = shown[0];

    return (
        <>
            <div className={rb("bar")}>
                <input className="vc-tool-input" value={text} placeholder="A Roblox game link or place ID — roblox.com/games/920587237" onChange={e => setText(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") go(); }} />
                <button type="button" className="vc-tool-btn vc-tool-primary" onClick={go}>Find servers</button>
            </div>
            {err && <span className="vc-tool-error">{err}</span>}
            {!placeId ? (
                <div className="vc-tool-empty">
                    <span className="vc-tool-empty-icon">🖥️</span>
                    Find a server to join in any Roblox game.
                    <span className="vc-tool-hint">Pick the fullest or emptiest, make sure there's room for your friends, skip laggy ones, and share a link that drops people into the same server.</span>
                </div>
            ) : (
                <>
                    <GameHead placeId={placeId} />
                    <div className={rb("filters")}>
                        <div className="vc-tool-seg">
                            <button type="button" className={classes("vc-tool-seg-btn", order === "Desc" && "vc-tool-seg-on")} onClick={() => setOrder("Desc")}>Fullest first</button>
                            <button type="button" className={classes("vc-tool-seg-btn", order === "Asc" && "vc-tool-seg-on")} onClick={() => setOrder("Asc")}>Emptiest first</button>
                        </div>
                        <label className={rb("filter")}>Room for
                            <select className="vc-tool-select" value={room} onChange={e => setRoom(Number(e.currentTarget.value))}>
                                {[1, 2, 3, 4, 6, 8, 10].map(n => <option key={n} value={n}>{n === 1 ? "just me" : `${n} people`}</option>)}
                            </select>
                        </label>
                        <label className={rb("filter")}>Ping
                            <select className="vc-tool-select" value={maxPing} onChange={e => setMaxPing(Number(e.currentTarget.value))}>
                                <option value={0}>any</option>
                                {[80, 120, 200, 300].map(n => <option key={n} value={n}>under {n} ms</option>)}
                            </select>
                        </label>
                        <span className={rb("spacer")} />
                        <button type="button" className="vc-tool-btn" disabled={busy} onClick={() => setTick(x => x + 1)}>↻</button>
                        <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!best} onClick={() => best && join(placeId, best)}>
                            {order === "Desc" ? "Join the fullest with room" : "Join the emptiest"}
                        </button>
                    </div>
                    {busy && !list.length && <div className={rb("loading")}><span className={rb("spin")} /> Asking Roblox for servers…</div>}
                    {!busy && list.length > 0 && <span className="vc-tool-hint">{shown.length
                        ? <>{shown.length} of {list.length} servers loaded fit{shown.length === list.length ? "" : " your filters"}. Ping is the server's own average, not yours.</>
                        : <>None of the {list.length} servers loaded fit your filters{order === "Desc" ? " — full servers rarely have room for a group, so try Emptiest first" : ""}{next ? ", or load more" : ""}.</>}</span>}
                    {!busy && !list.length && !err && <span className="vc-tool-hint">No public servers with room right now — nobody's playing, or every server is full.</span>}
                    <div className={rb("servers")}>{shown.map(s => <ServerRow key={s.id} placeId={placeId} s={s} />)}</div>
                    {next && <button type="button" className="vc-tool-btn" disabled={busy} onClick={() => load(next)}>{busy ? "Loading…" : "Load 100 more"}</button>}
                </>
            )}
        </>
    );
}
