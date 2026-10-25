/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A limited's price over time, from Rolimons: its RAP (what it really sells
// for), its cheapest listing, and its value — with the highest and lowest.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useEffect, useMemo, useState } from "@webpack/common";

import { fetchItemHistory, RbxItemHistory, short, sources } from "./data";
import { LineChart, Range } from "./History";

const rb = classNameFactory("vc-rbx-");
const DAY = 86400;

type Metric = "rap" | "best" | "value";
const METRICS: { id: Metric; label: string; long: string; }[] = [
    { id: "rap", label: "RAP", long: "RAP" },
    { id: "best", label: "Cheapest", long: "cheapest listing" },
    { id: "value", label: "Value", long: "value" },
];
const RANGES: { id: Range; label: string; secs: number; }[] = [
    { id: "30d", label: "30 days", secs: 30 * DAY }, { id: "1y", label: "1 year", secs: 365 * DAY }, { id: "all", label: "All time", secs: Infinity },
];
const day = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export function ItemPrices({ itemId }: { itemId: string; }) {
    const [state, setState] = useState<{ h?: RbxItemHistory | null; error?: string; }>({});
    const [metric, setMetric] = useState<Metric>("rap");
    const [range, setRange] = useState<Range>("1y");
    useEffect(() => {
        if (!sources.rolimons) return;
        let alive = true;
        setState({});
        fetchItemHistory(itemId).then(r => alive && setState(r.ok ? { h: r.history } : { error: r.error }));
        return () => { alive = false; };
    }, [itemId]);

    const { h } = state;
    const has = (m: Metric) => !!h && h[m].some(v => v != null && v > 0);
    const available = METRICS.filter(m => has(m.id));
    const use = has(metric) ? metric : available[0]?.id ?? "rap";

    const data = useMemo(() => {
        if (!h) return { t: [] as number[], v: [] as number[] };
        const { secs } = (RANGES.find(r => r.id === range)!);
        const from = (h.t[h.t.length - 1] ?? 0) - secs;
        const t: number[] = [], v: number[] = [];
        for (let i = 0; i < h.t.length; i++) { const x = h[use][i]; if (h.t[i] >= from && x != null && x > 0) { t.push(h.t[i]); v.push(x); } }
        return { t, v };
    }, [h, use, range]);

    if (!sources.rolimons) return null;
    if (state.error) return <span className={rb("muted")}>📈 Couldn't get its price history: {state.error}</span>;
    if (state.h === undefined) return <div className={rb("loading")}><span className={rb("spin")} /> Getting its price history from Rolimons…</div>;
    if (!h || !available.length) return <span className={rb("muted")}>📈 Rolimons has no price history for this item.</span>;

    const lo = data.v.length ? Math.min(...data.v) : 0, hi = data.v.length ? Math.max(...data.v) : 0;
    const now = data.v[data.v.length - 1], start = data.v[0];
    const change = start ? (now - start) / start * 100 : 0;
    const label = METRICS.find(m => m.id === use)!;

    return (
        <div className={rb("history")}>
            <div className={rb("outfit-head")}>
                <div>
                    <b>📈 Price history</b>
                    <span>From Rolimons — RAP is what it's really been selling for.</span>
                </div>
            </div>
            {data.v.length > 0 && (
                <div className={rb("stats")}>
                    <div className={rb("stat")}><span>Now</span><b>R$ {short(now)}</b><small>{label.long}</small></div>
                    <div className={rb("stat")}><span>Change</span><b style={{ color: change > 0.5 ? "#23a55a" : change < -0.5 ? "#f23f43" : undefined }}>{change > 0 ? "+" : ""}{change.toFixed(1)}%</b><small>over {RANGES.find(r => r.id === range)!.label.toLowerCase()}</small></div>
                    <div className={rb("stat")}><span>Highest</span><b>R$ {short(hi)}</b><small>{day(data.t[data.v.indexOf(hi)])}</small></div>
                    <div className={rb("stat")}><span>Lowest</span><b>R$ {short(lo)}</b><small>{day(data.t[data.v.indexOf(lo)])}</small></div>
                </div>
            )}
            <div className={rb("filters")}>
                {available.length > 1 && (
                    <div className="vc-tool-seg">
                        {available.map(m => <button key={m.id} type="button" className={classes("vc-tool-seg-btn", use === m.id && "vc-tool-seg-on")} onClick={() => setMetric(m.id)}>{m.label}</button>)}
                    </div>
                )}
                <span className={rb("spacer")} />
                <div className="vc-tool-seg">
                    {RANGES.map(r => <button key={r.id} type="button" className={classes("vc-tool-seg-btn", range === r.id && "vc-tool-seg-on")} onClick={() => setRange(r.id)}>{r.label}</button>)}
                </div>
            </div>
            <LineChart t={data.t} v={data.v} unit={n => `R$ ${Math.round(n).toLocaleString()} ${label.long}`} range={range} floorZero={false} />
            <div className={rb("foot")}>
                <span className={rb("spacer")} />
                <a className={rb("link")} href={`https://www.rolimons.com/item/${itemId}`} target="_blank" rel="noreferrer">See on Rolimons ↗</a>
            </div>
        </div>
    );
}
