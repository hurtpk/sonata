/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Compare games: up to four side by side, with the best of each row picked out.

import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { classes } from "@utils/misc";
import { useEffect, useState } from "@webpack/common";

import { ago, date, fetchHistory, fetchRef, parseLookup, RbxGame, RbxHistory, short, sources } from "./data";

const rb = classNameFactory("vc-rbx-");
const KEY = "vc-rbx-compare";
const MAX = 4;

const load = (): string[] => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.slice(0, MAX) : []; } catch { return []; } };
const store = (ids: string[]) => { try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { } };

/** Adds a game to the comparison (used by game cards' Compare button). */
/** Replaces the comparison with these games (the sidebar's Compare). */
export function setCompareList(placeIds: string[]) { store(placeIds.slice(0, MAX)); }

export function addToCompare(placeId: string) {
    const ids = load().filter(x => x !== placeId);
    store([...ids, placeId].slice(-MAX));
}

const likePct = (g: RbxGame) => g.up + g.down ? g.up / (g.up + g.down) * 100 : null;

interface Metric { label: string; hint?: string; value(g: RbxGame): number | null; show(g: RbxGame): string; lowBest?: boolean; }

const METRICS: Metric[] = [
    { label: "Playing now", value: g => g.playing, show: g => g.playing.toLocaleString() },
    { label: "Visits", value: g => g.visits, show: g => short(g.visits) },
    { label: "Favourites", value: g => g.favorites, show: g => short(g.favorites) },
    { label: "Likes", value: likePct, show: g => likePct(g) == null ? "–" : `${likePct(g)!.toFixed(1)}%` },
    { label: "Votes", value: g => g.up + g.down, show: g => short(g.up + g.down) },
    { label: "Favourited by", hint: "Out of every 1,000 visits, how many favourited it — how much players stick around.", value: g => g.visits ? g.favorites / g.visits * 1000 : null, show: g => g.visits ? `${(g.favorites / g.visits * 1000).toFixed(1)} per 1k` : "–" },
    { label: "Last update", value: g => Date.parse(g.updated) || null, show: g => ago(g.updated) || "–" },
    { label: "Made", value: () => null, show: g => date(g.created) },
    { label: "Server size", value: g => g.maxPlayers || null, show: g => g.maxPlayers ? String(g.maxPlayers) : "–" },
];

/** Rows from Rolimons' history. */
const HISTORY_ROWS: { label: string; value(h: RbxHistory): number | null; show(h: RbxHistory): string; }[] = [
    { label: "Avg playtime", value: h => h.avgPlaytime, show: h => h.avgPlaytime != null ? `${h.avgPlaytime.toFixed(1)} min` : "–" },
    { label: "Peak, all time", value: h => h.peaks.all?.n ?? null, show: h => h.peaks.all ? short(h.peaks.all.n) : "–" },
    { label: "Peak, 30 days", value: h => h.peaks.d30?.n ?? null, show: h => h.peaks.d30 ? short(h.peaks.d30.n) : "–" },
];

export function Compare({ add }: { add?: string; }) {
    const [ids, setIds] = useState<string[]>(() => { if (add) addToCompare(add); return load(); });
    const [games, setGames] = useState<Record<string, RbxGame | string>>({});
    const [text, setText] = useState("");
    const [err, setErr] = useState<string | null>(null);
    const [tick, setTick] = useState(0);
    const [hist, setHist] = useState<Record<string, RbxHistory | null>>({});

    useEffect(() => { store(ids); }, [ids]);
    useEffect(() => {
        if (!sources.rolimons) return;
        let alive = true;
        for (const id of ids) {
            if (id in hist) continue;
            fetchHistory(id).then(r => alive && setHist(h => ({ ...h, [id]: r.ok && r.history.tracked ? r.history : null })));
        }
        return () => { alive = false; };
    }, [ids]);
    useEffect(() => {
        let alive = true;
        for (const id of ids) {
            if (tick === 0 && games[id] && typeof games[id] !== "string") continue;
            fetchRef({ kind: "game", id }, tick > 0).then(r => alive && setGames(g => ({ ...g, [id]: r.ok && r.info?.kind === "game" ? r.info : r.error ?? "Not found" })));
        }
        return () => { alive = false; };
    }, [ids, tick]);

    const addOne = () => {
        const t = text.trim();
        const r = parseLookup(t);
        const id = r?.kind === "game" ? r.id : /^\d+$/.test(t) ? t : null;
        if (!id) { setErr("Paste a Roblox game link (roblox.com/games/…) or its place ID."); return; }
        if (ids.includes(id)) { setErr("That game's already in."); return; }
        if (ids.length >= MAX) { setErr(`Up to ${MAX} games at once — remove one first.`); return; }
        setErr(null); setText(""); setIds([...ids, id]);
    };

    const ready = ids.map(id => games[id]).filter((g): g is RbxGame => !!g && typeof g !== "string");
    const best = (m: Metric) => {
        const vals = ready.map(m.value).filter((v): v is number => v != null);
        if (ready.length < 2 || vals.length < 2) return null;
        return m.lowBest ? Math.min(...vals) : Math.max(...vals);
    };
    const copy = () => copyWithToast([
        ["", ...ready.map(g => g.name)].join(" | "),
        ...METRICS.map(m => [m.label, ...ready.map(m.show)].join(" | ")),
    ].join("\n"), "Comparison copied");

    return (
        <>
            <div className={rb("bar")}>
                <input className="vc-tool-input" value={text} disabled={ids.length >= MAX} placeholder={ids.length >= MAX ? `${MAX} games in — remove one to add another` : "Add a game — paste a roblox.com/games/… link or place ID"}
                    onChange={e => setText(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") addOne(); }} />
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!text.trim() || ids.length >= MAX} onClick={addOne}>＋ Add</button>
                {ids.length > 0 && <button type="button" className="vc-tool-btn" onClick={() => setTick(t => t + 1)}>↻</button>}
            </div>
            {err && <span className="vc-tool-error">{err}</span>}
            {!ids.length ? (
                <div className="vc-tool-empty">
                    <span className="vc-tool-empty-icon">⚖️</span>
                    Put up to {MAX} games side by side.
                    <span className="vc-tool-hint">Yours against the competition: players, visits, likes, favourites, how often they update. Game cards also have a Compare button.</span>
                </div>
            ) : (
                <div className={rb("cmp-wrap")}>
                    <table className={rb("cmp")}>
                        <thead>
                            <tr>
                                <th />
                                {ids.map(id => {
                                    const g = games[id];
                                    return (
                                        <th key={id}>
                                            <div className={rb("cmp-head")}>
                                                <button type="button" className={rb("cmp-x")} title="Remove" onClick={() => setIds(ids.filter(x => x !== id))}>✕</button>
                                                {!g ? <span className={rb("spin")} /> : typeof g === "string" ? <span className={rb("muted")}>⚠️ {g}</span> : (
                                                    <>
                                                        {g.icon ? <img src={g.icon} alt="" /> : <span className={rb("img-none")}>🧱</span>}
                                                        <b title={g.name}>{g.name}</b>
                                                        <small>by {g.creator}</small>
                                                    </>
                                                )}
                                            </div>
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {METRICS.map(m => {
                                const top = best(m);
                                return (
                                    <tr key={m.label}>
                                        <th title={m.hint}>{m.label}{m.hint && <i> ⓘ</i>}</th>
                                        {ids.map(id => {
                                            const g = games[id];
                                            if (!g || typeof g === "string") return <td key={id}>–</td>;
                                            const v = m.value(g);
                                            return <td key={id} className={classes(top != null && v === top && rb("cmp-best"))}>{m.show(g)}</td>;
                                        })}
                                    </tr>
                                );
                            })}
                            {sources.rolimons && HISTORY_ROWS.map(row => {
                                const vals = ids.map(id => hist[id] ? row.value(hist[id]!) : null);
                                const known = vals.filter((v): v is number => v != null);
                                const top = known.length > 1 ? Math.max(...known) : null;
                                return (
                                    <tr key={row.label}>
                                        <th title="From Rolimons">{row.label}<i> ⓘ</i></th>
                                        {ids.map((id, i) => <td key={id} className={classes(top != null && vals[i] === top && rb("cmp-best"))}>{!(id in hist) ? "…" : hist[id] ? row.show(hist[id]!) : "–"}</td>)}
                                    </tr>
                                );
                            })}
                            <tr>
                                <th>Genre</th>
                                {ids.map(id => { const g = games[id]; return <td key={id}>{g && typeof g !== "string" ? g.genre || "–" : "–"}</td>; })}
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}
            {ready.length > 1 && (
                <div className={rb("foot")}>
                    <span className="vc-tool-hint">The best of each row is highlighted. Numbers are live from Roblox{sources.rolimons ? "; playtime and peaks from Rolimons" : ""}.</span>
                    <span className={rb("spacer")} />
                    <button type="button" className={rb("link")} onClick={copy}>Copy as text</button>
                </div>
            )}
        </>
    );
}
