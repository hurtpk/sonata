/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A game's history from Rolimons: average playtime, peak player counts, and
// charts of players, playtime, visits, favourites and rating over time.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useEffect, useMemo, useState } from "@webpack/common";

import { fetchHistory, RbxHistory, RbxPeak, short, sources } from "./data";

const rb = classNameFactory("vc-rbx-");
const DAY = 86400;

type Metric = "players" | "playtime" | "visits" | "favorites" | "rating";
export type Range = "24h" | "7d" | "30d" | "1y" | "all";

const METRICS: { id: Metric; label: string; unit(n: number): string; }[] = [
    { id: "players", label: "Players", unit: n => `${Math.round(n).toLocaleString()} playing` },
    { id: "playtime", label: "Playtime", unit: n => `${n.toFixed(1)} min average` },
    { id: "visits", label: "Visits a day", unit: n => `${short(n)} visits a day` },
    { id: "favorites", label: "Favourites", unit: n => `${Math.round(n).toLocaleString()} favourites` },
    { id: "rating", label: "Rating", unit: n => `${n.toFixed(2)}% liked` },
];
const RANGES: { id: Range; label: string; secs: number; }[] = [
    { id: "24h", label: "24 hours", secs: DAY }, { id: "7d", label: "7 days", secs: 7 * DAY }, { id: "30d", label: "30 days", secs: 30 * DAY },
    { id: "1y", label: "1 year", secs: 365 * DAY }, { id: "all", label: "All time", secs: Infinity },
];

function series(h: RbxHistory, m: Metric, from: number): { t: number[]; v: number[]; } {
    const t: number[] = [], v: number[] = [];
    for (let i = 0; i < h.t.length; i++) {
        if (h.t[i] < from) continue;
        let val: number | null;
        switch (m) {
            case "players": val = h.players_[i]; break;
            case "playtime": val = h.playtime[i]; break;
            case "favorites": val = h.favorites[i]; break;
            case "rating": { const all = h.up[i] + h.down[i]; val = all ? h.up[i] / all * 100 : null; break; }
            case "visits": {
                if (i === 0) { val = null; break; }
                const dt = (h.t[i] - h.t[i - 1]) / DAY;
                const dv = h.visits[i] - h.visits[i - 1];
                val = dt > 0 && dv >= 0 ? dv / dt : null;
                break;
            }
        }
        if (val != null && Number.isFinite(val)) { t.push(h.t[i]); v.push(val); }
    }
    return { t, v };
}

/** At most ~360 points to draw; players keep each group's highest so peaks survive. */
function thin(t: number[], v: number[], keepMax: boolean) {
    const n = 360;
    if (t.length <= n) return { t, v };
    const k = Math.ceil(t.length / n);
    const T: number[] = [], V: number[] = [];
    for (let i = 0; i < t.length; i += k) {
        const sv = v.slice(i, i + k);
        T.push(t[Math.min(i + k, t.length) - 1]);
        V.push(keepMax ? Math.max(...sv) : sv.reduce((a, b) => a + b, 0) / sv.length);
    }
    return { t: T, v: V };
}

const when = (t: number, range: Range) => new Date(t * 1000).toLocaleString(undefined, range === "24h" || range === "7d"
    ? { weekday: "short", hour: "numeric", minute: "2-digit" }
    : { year: range === "30d" ? undefined : "numeric", month: "short", day: "numeric" });

function Chart({ h, metric, range }: { h: RbxHistory; metric: Metric; range: Range; }) {
    const now = h.t[h.t.length - 1] ?? 0;
    const { secs } = RANGES.find(r => r.id === range)!;
    const data = useMemo(() => { const s = series(h, metric, now - secs); return thin(s.t, s.v, metric === "players"); }, [h, metric, range]);
    return <LineChart t={data.t} v={data.v} unit={METRICS.find(x => x.id === metric)!.unit} range={range} floorZero={metric !== "rating" && metric !== "playtime"} />;
}

/** Short numbers for the side of a chart: 71.4, 10.8K, 24.5M. */
const axis = (n: number) => Math.abs(n) >= 1000 ? short(n) : n.toFixed(Math.abs(n) < 10 && n % 1 ? 1 : 0);

/** A line chart with hover read-outs. Times in seconds. */
export function LineChart({ t: ts, v: vs, unit, range, floorZero = true, picked = null, onPick, pickHint }: { t: number[]; v: number[]; unit(n: number): string; range: Range; floorZero?: boolean; /** A point clicked on, kept marked. */ picked?: number | null; onPick?(i: number): void; pickHint?: string; }) {
    const [hover, setHover] = useState<number | null>(null);
    const data = { t: ts, v: vs };
    const m = { unit };
    if (data.t.length < 2) return <div className={rb("chart-empty")}>Not enough history for this yet.</div>;

    const W = 600, H = 170;
    let lo = Math.min(...data.v), hi = Math.max(...data.v);
    if (floorZero) lo = Math.min(lo, 0);
    if (hi === lo) hi = lo + 1;
    const pad = (hi - lo) * 0.08;
    const top = hi + pad, bot = floorZero ? lo : lo - (lo ? pad : 0);
    const t0 = data.t[0], t1 = data.t[data.t.length - 1];
    const x = (t: number) => (t - t0) / Math.max(1, t1 - t0) * W;
    const y = (v: number) => H - (v - bot) / (top - bot) * H;
    // Long stretches with no data are drawn dashed, not as if the line really went straight across.
    const steps = data.t.slice(1).map((t, i) => t - data.t[i]).sort((a, b) => a - b);
    const gapAt = Math.max((steps[Math.floor(steps.length / 2)] || 1) * 8, 3 * 86400);
    const segs: number[][] = [[0]];
    const gaps: [number, number][] = [];
    for (let i = 1; i < data.t.length; i++) {
        if (data.t[i] - data.t[i - 1] > gapAt) { gaps.push([i - 1, i]); segs.push([i]); } else segs[segs.length - 1].push(i);
    }
    const pt = (i: number) => `${x(data.t[i]).toFixed(1)},${y(data.v[i]).toFixed(1)}`;
    const line = segs.map(sg => sg.map((i, k) => `${k ? "L" : "M"}${pt(i)}`).join("")).join("");
    const area = segs.filter(sg => sg.length > 1).map(sg => `M${x(data.t[sg[0]]).toFixed(1)},${H}${sg.map(i => `L${pt(i)}`).join("")}L${x(data.t[sg[sg.length - 1]]).toFixed(1)},${H}Z`).join("");
    const peakI = data.v.indexOf(Math.max(...data.v));
    const hi_ = hover ?? null;

    const nearest = (e: React.MouseEvent<HTMLDivElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        const t = t0 + (e.clientX - r.left) / r.width * (t1 - t0);
        let best = 0;
        for (let i = 1; i < data.t.length; i++) if (Math.abs(data.t[i] - t) < Math.abs(data.t[best] - t)) best = i;
        return best;
    };
    const onMove = (e: React.MouseEvent<HTMLDivElement>) => setHover(nearest(e));
    const pick = picked != null && picked < data.t.length ? picked : null;

    return (
        <div className={classes(rb("chart"), onPick && rb("chart-pickable"))} onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onPick ? e => onPick(nearest(e)) : undefined}>
            <div className={rb("chart-axis")}><span>{axis(top)}</span><span>{axis(bot)}</span></div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={rb("chart-svg")}>
                <defs>
                    <linearGradient id="vc-rbx-area" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="var(--tl-accent, #00a2ff)" stopOpacity="0.35" />
                        <stop offset="1" stopColor="var(--tl-accent, #00a2ff)" stopOpacity="0" />
                    </linearGradient>
                </defs>
                {[0.25, 0.5, 0.75].map(f => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className={rb("chart-grid")} vectorEffect="non-scaling-stroke" />)}
                <path d={area} fill="url(#vc-rbx-area)" />
                <path d={line} fill="none" stroke="var(--tl-accent, #00a2ff)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                {gaps.map(([a, b]) => <line key={a} x1={x(data.t[a])} y1={y(data.v[a])} x2={x(data.t[b])} y2={y(data.v[b])} className={rb("chart-gap")} vectorEffect="non-scaling-stroke" />)}
                {hi_ != null && <line x1={x(data.t[hi_])} x2={x(data.t[hi_])} y1="0" y2={H} className={rb("chart-cursor")} vectorEffect="non-scaling-stroke" />}
                {pick != null && <line x1={x(data.t[pick])} x2={x(data.t[pick])} y1="0" y2={H} className={rb("chart-picked")} vectorEffect="non-scaling-stroke" />}
            </svg>
            {pick != null && <i className={rb("chart-dot")} style={{ left: `calc(46px + (100% - 56px) * ${x(data.t[pick]) / W})`, top: `calc(44px + 170px * ${y(data.v[pick]) / H})` }} />}
            {hi_ != null ? (
                <div className={rb("chart-tip")} style={{ left: `${Math.min(82, Math.max(0, x(data.t[hi_]) / W * 100 - 9))}%` }}>
                    <b>{m.unit(data.v[hi_])}</b><span>{when(data.t[hi_], range)}{onPick && pickHint ? ` · ${pickHint}` : ""}</span>
                </div>
            ) : (
                <div className={rb("chart-tip")} style={{ left: `${Math.min(82, Math.max(0, x(data.t[peakI]) / W * 100 - 9))}%` }}>
                    <b>Highest shown: {m.unit(data.v[peakI])}</b><span>{when(data.t[peakI], range)}</span>
                </div>
            )}
            <div className={rb("chart-x")}><span>{when(t0, range)}</span>{gaps.length > 0 && <i>dashed = no data for a while</i>}<span>{when(t1, range)}</span></div>
        </div>
    );
}

const Peak = ({ label, p }: { label: string; p: RbxPeak | null; }) => (
    <div className={rb("stat")}>
        <span>{label}</span>
        <b>{p ? p.n.toLocaleString() : "–"}</b>
        {p && <small>{p.when ?? (p.t ? new Date(p.t * 1000).toLocaleDateString() : "")}</small>}
    </div>
);

export function GameHistory({ placeId }: { placeId: string; }) {
    const [state, setState] = useState<{ h?: RbxHistory; error?: string; }>({});
    const [metric, setMetric] = useState<Metric>("players");
    const [range, setRange] = useState<Range>("7d");
    useEffect(() => {
        if (!sources.rolimons) return;
        let alive = true;
        setState({});
        fetchHistory(placeId).then(r => alive && setState(r.ok ? { h: r.history } : { error: r.error }));
        return () => { alive = false; };
    }, [placeId]);

    if (!sources.rolimons) return null;
    if (state.error) return <span className={rb("muted")}>📈 Couldn't get the history: {state.error}</span>;
    if (!state.h) return <div className={rb("loading")}><span className={rb("spin")} /> Getting the history from Rolimons…</div>;
    const { h } = state;
    if (!h.tracked) return <span className={rb("muted")}>📈 Rolimons doesn't track this game yet, so there's no history or peaks for it.</span>;

    return (
        <div className={rb("history")}>
            <div className={rb("stats")}>
                <div className={rb("stat")}><span>Avg playtime</span><b>{h.avgPlaytime != null ? `${h.avgPlaytime.toFixed(2)} min` : "–"}</b></div>
                <Peak label="Peak, all time" p={h.peaks.all} />
                <Peak label="Peak, 30 days" p={h.peaks.d30} />
                <Peak label="Peak, 7 days" p={h.peaks.d7} />
                <Peak label="Peak, 24 hours" p={h.peaks.h24} />
            </div>
            <div className={rb("filters")}>
                <div className="vc-tool-seg">
                    {METRICS.map(m => <button key={m.id} type="button" className={classes("vc-tool-seg-btn", metric === m.id && "vc-tool-seg-on")} onClick={() => setMetric(m.id)}>{m.label}</button>)}
                </div>
                <span className={rb("spacer")} />
                <div className="vc-tool-seg">
                    {RANGES.map(r => <button key={r.id} type="button" className={classes("vc-tool-seg-btn", range === r.id && "vc-tool-seg-on")} onClick={() => setRange(r.id)}>{r.label}</button>)}
                </div>
            </div>
            <Chart h={h} metric={metric} range={range} />
            <div className={rb("foot")}>
                <span className="vc-tool-hint">Tracked since {new Date(h.since * 1000).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}.</span>
                <span className={rb("spacer")} />
                <a className={rb("link")} href={`https://www.rolimons.com/game/${placeId}`} target="_blank" rel="noreferrer">History from Rolimons ↗</a>
            </div>
        </div>
    );
}
