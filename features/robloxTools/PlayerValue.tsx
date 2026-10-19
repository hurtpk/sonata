/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What Rolimons knows about a player that Roblox doesn't show: their limiteds'
// value and RAP (and the highest they've been), when they were last seen
// online, a chart of it all over time, and their most valuable items.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useEffect, useMemo, useState } from "@webpack/common";

import { ago, cardActions, fetchInventoryAt, fetchPlayerHistory, RbxInventoryDay, RbxPlayerHistory, short, sources } from "./data";
import { LineChart, Range } from "./History";

const rb = classNameFactory("vc-rbx-");
const DAY = 86400;

type Metric = "value" | "rap" | "count";
const METRICS: { id: Metric; label: string; unit(n: number): string; }[] = [
    { id: "value", label: "Value", unit: n => `R$ ${Math.round(n).toLocaleString()} value` },
    { id: "rap", label: "RAP", unit: n => `R$ ${Math.round(n).toLocaleString()} RAP` },
    { id: "count", label: "Collectibles", unit: n => `${Math.round(n).toLocaleString()} collectibles` },
];
const RANGES: { id: Range; label: string; secs: number; }[] = [
    { id: "30d", label: "30 days", secs: 30 * DAY }, { id: "1y", label: "1 year", secs: 365 * DAY }, { id: "all", label: "All time", secs: Infinity },
];

const day = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export function PlayerValue({ userId }: { userId: string; }) {
    const [state, setState] = useState<{ p?: RbxPlayerHistory; error?: string; }>({});
    const [metric, setMetric] = useState<Metric>("value");
    const [range, setRange] = useState<Range>("all");
    const [allItems, setAllItems] = useState(false);
    // A point clicked on the chart: what they had then.
    const [picked, setPicked] = useState<number | null>(null);
    useEffect(() => setPicked(null), [metric, range, userId]);
    useEffect(() => {
        if (!sources.rolimons) return;
        let alive = true;
        setState({});
        fetchPlayerHistory(userId).then(r => alive && setState(r.ok ? { p: r.player } : { error: r.error }));
        return () => { alive = false; };
    }, [userId]);

    const { p } = state;
    const data = useMemo(() => {
        if (!p) return { t: [], v: [] };
        const { secs } = (RANGES.find(r => r.id === range)!);
        const from = (p.t[p.t.length - 1] ?? 0) - secs;
        const arr = metric === "value" ? p.values : metric === "rap" ? p.raps : p.counts;
        const t: number[] = [], v: number[] = [];
        for (let i = 0; i < p.t.length; i++) if (p.t[i] >= from && arr[i] != null) { t.push(p.t[i]); v.push(arr[i]); }
        return { t, v };
    }, [p, metric, range]);

    if (!sources.rolimons) return null;
    if (state.error) return <span className={rb("muted")}>💎 Couldn't get their Rolimons details: {state.error}</span>;
    if (!p) return <div className={rb("loading")}><span className={rb("spin")} /> Asking Rolimons…</div>;
    if (!p.tracked) return <span className={rb("muted")}>💎 Rolimons hasn't seen this player yet, so there's no value history or last-online time.</span>;

    const hasHistory = p.t.length > 1 && (p.peakValue || p.peakRap);
    const items = allItems ? p.top : p.top.slice(0, 6);

    return (
        <div className={rb("history")}>
            <div className={rb("outfit-head")}>
                <div>
                    <b>💎 From Rolimons</b>
                    <span>What Roblox doesn't show: limiteds' worth, the highest it's been, and when they were last on.</span>
                </div>
            </div>
            <div className={rb("stats")}>
                <div className={rb("stat")}><span>Last seen online</span><b>{p.lastOnline ? ago(p.lastOnline * 1000) : "–"}</b>{p.lastOnline && <small>{day(p.lastOnline)}</small>}</div>
                <div className={rb("stat")}><span>Value</span><b>{p.value != null ? `R$ ${short(p.value)}` : "–"}</b>{p.value ? <small>{p.value.toLocaleString()}</small> : null}</div>
                <div className={rb("stat")}><span>RAP</span><b>{p.rap != null ? `R$ ${short(p.rap)}` : "–"}</b>{p.rap ? <small>{p.rap.toLocaleString()}</small> : null}</div>
                <div className={rb("stat")}><span>Peak value</span><b>{p.peakValue ? `R$ ${short(p.peakValue.n)}` : "–"}</b>{p.peakValue && <small>{day(p.peakValue.t)}</small>}</div>
                <div className={rb("stat")}><span>Peak RAP</span><b>{p.peakRap ? `R$ ${short(p.peakRap.n)}` : "–"}</b>{p.peakRap && <small>{day(p.peakRap.t)}</small>}</div>
                <div className={rb("stat")}><span>Collectibles</span><b>{p.collectibles ?? "–"}</b></div>
                {p.rank != null && <div className={rb("stat")}><span>Rank</span><b>#{p.rank.toLocaleString()}</b><small>by value</small></div>}
                {p.tradeAds > 0 && <div className={rb("stat")}><span>Trade ads</span><b>{p.tradeAds.toLocaleString()}</b></div>}
            </div>
            {hasHistory && (
                <>
                    <div className={rb("filters")}>
                        <div className="vc-tool-seg">
                            {METRICS.map(m => <button key={m.id} type="button" className={classes("vc-tool-seg-btn", metric === m.id && "vc-tool-seg-on")} onClick={() => setMetric(m.id)}>{m.label}</button>)}
                        </div>
                        <span className={rb("spacer")} />
                        <div className="vc-tool-seg">
                            {RANGES.map(r => <button key={r.id} type="button" className={classes("vc-tool-seg-btn", range === r.id && "vc-tool-seg-on")} onClick={() => setRange(r.id)}>{r.label}</button>)}
                        </div>
                    </div>
                    <LineChart t={data.t} v={data.v} unit={METRICS.find(m => m.id === metric)!.unit} range={range}
                        picked={picked} onPick={i => setPicked(p => p === i ? null : i)} pickHint="click to see their items then" />
                    {picked != null && data.t[picked] != null && <BackThen userId={userId} p={p} t={data.t[picked]} onClose={() => setPicked(null)} />}
                </>
            )}
            {p.top.length > 0 && (
                <div className={rb("wear-group")}>
                    <span className={rb("wear-title")}>Most valuable items</span>
                    <div className={rb("wears")}>
                        {items.map(i => (
                            <button key={i.id} type="button" className={classes(rb("wear"), rb("wear-btn"))} title={`${i.name} — open it`} onClick={() => cardActions.lookup(`https://www.roblox.com/catalog/${i.id}`)}>
                                {i.image ? <img src={i.image} alt="" loading="lazy" /> : <span className={rb("img-none")}>💎</span>}
                                <b>{i.name}</b>
                                <span>RAP R$ {short(i.rap)}{i.copies > 1 ? ` · ×${i.copies}` : ""}</span>
                                <i className={classes(rb("price"), rb("price-lim"))}>R$ {short(i.value)}<small> value</small></i>
                            </button>
                        ))}
                    </div>
                    {p.top.length > 6 && <button type="button" className={rb("link")} onClick={() => setAllItems(a => !a)}>{allItems ? "Show fewer" : `Show top ${p.top.length}`}</button>}
                </div>
            )}
            <div className={rb("foot")}>
                {p.lastScan > 0 && <span className="vc-tool-hint">Rolimons last checked their items {ago(p.lastScan * 1000)}.</span>}
                <span className={rb("spacer")} />
                <a className={rb("link")} href={`https://www.rolimons.com/player/${userId}`} target="_blank" rel="noreferrer">See on Rolimons ↗</a>
            </div>
        </div>
    );
}

/** What a player owned on a day — Rolimons' snapshot of their whole inventory, with the days before and after. */
function BackThen({ userId, p, t, onClose }: { userId: string; p: RbxPlayerHistory; t: number; onClose(): void; }) {
    const [at, setAt] = useState(t);
    const [all, setAll] = useState(false);
    const [state, setState] = useState<{ day?: RbxInventoryDay | null; error?: string; }>({});
    const [tries, setTries] = useState(0);
    useEffect(() => setAt(t), [t]);
    useEffect(() => {
        let alive = true;
        setState({});
        fetchInventoryAt(userId, at, tries > 0).then(r => alive && setState(r.ok ? { day: r.day } : { error: r.error }));
        return () => { alive = false; };
    }, [userId, at, tries]);
    const rolimonsDay = `https://www.rolimons.com/history/${userId}?timestamp=${Math.floor((state.day?.at ?? at) / 86400) * 86400}`;

    const d = state.day;
    // The chart's numbers for that day (the closest point to it).
    const when = d?.at ?? at;
    let ci = -1;
    for (let k = 0; k < p.t.length; k++) if (ci < 0 || Math.abs(p.t[k] - when) < Math.abs(p.t[ci] - when)) ci = k;
    const value = ci >= 0 ? p.values[ci] : null, rap = ci >= 0 ? p.raps[ci] : null;
    const ownedNow = useMemo(() => new Set((p.owned ?? []).map(o => o.id)), [p]);
    const items = d?.items ?? [];
    const still = items.filter(i => ownedNow.has(i.id)).length;
    const shown = all ? items : items.slice(0, 18);

    return (
        <div className={rb("then")}>
            <div className={rb("then-head")}>
                <div>
                    <b>Inventory on {day(when)}</b>
                    <span>{[value != null ? `R$ ${Math.round(value).toLocaleString()} value then` : null, rap != null ? `R$ ${Math.round(rap).toLocaleString()} RAP then` : null, d ? `${d.copies.toLocaleString()} collectible${d.copies === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}</span>
                </div>
                <div className={rb("then-nav")}>
                    <button type="button" className="vc-tool-btn" disabled={!d?.prev} title={d?.prev ? day(d.prev) : undefined} onClick={() => d?.prev && setAt(d.prev)}>‹ Previous</button>
                    <button type="button" className="vc-tool-btn" disabled={!d?.next} title={d?.next ? day(d.next) : undefined} onClick={() => d?.next && setAt(d.next)}>Next ›</button>
                    <button type="button" className="vc-tool-icon" title="Close" onClick={onClose}>✕</button>
                </div>
            </div>
            {state.error ? (
                <div className={rb("then-blocked")}>
                    <span className={rb("then-note")}>
                        {/browsers/.test(state.error)
                            ? "Rolimons' security check (Cloudflare) didn't let Discord in for this page just now. It comes and goes — try again in a minute, or open the day in your browser."
                            : `Couldn't get that day from Rolimons: ${state.error}`}
                    </span>
                    <div className={rb("then-nav")}>
                        <button type="button" className="vc-tool-btn" onClick={() => setTries(n => n + 1)}>Try again</button>
                        <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => VencordNative.native.openExternal(rolimonsDay)}>Open this day on Rolimons ↗</button>
                    </div>
                </div>
            )
                : state.day === undefined ? <div className={rb("loading")}><span className={rb("spin")} /> Getting their inventory from that day…</div>
                    : !d ? <span className={rb("then-note")}>Rolimons has no inventory saved for that day.</span>
                        : !items.length ? <span className={rb("then-note")}>They had no limiteds that day.</span>
                            : <>
                                <span className={rb("then-note")}>
                                    {still === items.length ? "They still have all of these." : still ? `They still have ${still} of these — the faded ones are gone now.` : "They don't have any of these any more."} Values shown are today's.
                                </span>
                                <div className={rb("wears")}>
                                    {shown.map(i => {
                                        const gone = !ownedNow.has(i.id);
                                        return (
                                            <button key={i.id} type="button" className={classes(rb("wear"), rb("wear-btn"), gone && rb("then-new"))} title={`${i.name}${gone ? " — they don't have it any more" : ""} — open it`} onClick={() => cardActions.lookup(`https://www.roblox.com/catalog/${i.id}`)}>
                                                {i.image ? <img src={i.image} alt="" loading="lazy" /> : <span className={rb("img-none")}>💎</span>}
                                                <b>{i.name}</b>
                                                <span>{i.serials.length ? `#${i.serials.slice(0, 3).join(", #")}${i.serials.length > 3 ? "…" : ""} · ` : ""}RAP R$ {short(i.rap)}{i.copies > 1 ? ` · ×${i.copies}` : ""}</span>
                                                <i className={classes(rb("price"), rb("price-lim"))}>R$ {short(i.value)}<small> value</small></i>
                                            </button>
                                        );
                                    })}
                                </div>
                                {items.length > 18 && <button type="button" className={rb("link")} onClick={() => setAll(v => !v)}>{all ? "Show fewer" : `Show all ${items.length}`}</button>}
                            </>}
            <div className={rb("foot")}>
                <span className={rb("spacer")} />
                {!state.error && <a className={rb("link")} href={rolimonsDay} target="_blank" rel="noreferrer">This day on Rolimons ↗</a>}
            </div>
        </div>
    );
}
