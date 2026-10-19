/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Trade calculator: limiteds (and Robux) on each side, valued with Rolimons'
// numbers — who comes out ahead, by how much, and anything to watch out for
// (projected RAP, low demand). Pull items straight from your own inventory,
// or anyone's.

import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { classes } from "@utils/misc";
import { useEffect, useMemo, useState } from "@webpack/common";

import { fetchLimiteds, fetchPlayerHistory, fetchRef, fetchThumbs, RbxLimited, short } from "./data";
import { getMe } from "./me";

const rb = classNameFactory("vc-rbx-");
const MAX_ITEMS = 4;
const TAX = 0.3;
const KEY = "vc-rbx-trade";
const DEMAND = ["Terrible", "Low", "Normal", "High", "Amazing"];
const TREND = ["Lowering", "Unstable", "Stable", "Raising", "Fluctuating"];

type SideId = "give" | "get";
interface Side { items: string[]; robux: string; }
const blank = (): Record<SideId, Side> => ({ give: { items: [], robux: "" }, get: { items: [], robux: "" } });
const load = (): Record<SideId, Side> => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? ""); return v?.give && v?.get ? v : blank(); } catch { return blank(); } };
const store = (v: Record<SideId, Side>) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { } };

const worth = (i: RbxLimited) => i.value ?? i.rap;
const robuxOf = (s: string) => Math.max(0, Math.floor(Number(s.replace(/[^\d]/g, "")) || 0));
const rbx = (n: number) => `R$ ${Math.round(n).toLocaleString()}`;

function Badges({ i }: { i: RbxLimited; }) {
    return (
        <span className={rb("tr-badges")}>
            {i.demand >= 0 && <span className={classes(rb("tr-pill"), rb(`tr-d${i.demand}`))} title="Rolimons demand">{DEMAND[i.demand]} demand</span>}
            {i.trend >= 0 && <span className={rb("tr-pill")} title="Rolimons trend">{TREND[i.trend]}</span>}
            {i.projected && <span className={classes(rb("tr-pill"), rb("tr-warn"))} title="Its RAP has been pushed up — the value is what it's really worth">Projected</span>}
            {i.rare && <span className={classes(rb("tr-pill"), rb("tr-rare"))}>Rare</span>}
            {i.hyped && <span className={classes(rb("tr-pill"), rb("tr-hyped"))}>Hyped</span>}
        </span>
    );
}

function Picker({ all, onPick, full }: { all: RbxLimited[]; onPick(id: string): void; full: boolean; }) {
    const [q, setQ] = useState("");
    const t = q.trim().toLowerCase();
    const hits = useMemo(() => !t ? [] : all.filter(i => i.name.toLowerCase().includes(t) || i.acronym.toLowerCase() === t || i.id === t)
        .sort((a, b) => Number(b.acronym.toLowerCase() === t) - Number(a.acronym.toLowerCase() === t) || worth(b) - worth(a)).slice(0, 8), [all, t]);
    return (
        <div className={rb("tr-pick")}>
            <input className="vc-tool-input" value={q} disabled={full} placeholder={full ? `${MAX_ITEMS} items is the most a trade can have` : "Add an item — name or short name (e.g. Valk, DC)…"} onChange={e => setQ(e.currentTarget.value)}
                onKeyDown={e => { if (e.key === "Enter" && hits[0]) { onPick(hits[0].id); setQ(""); } }} />
            {hits.length > 0 && (
                <div className={rb("tr-hits")}>
                    {hits.map(i => (
                        <button key={i.id} type="button" className={rb("tr-hit")} onClick={() => { onPick(i.id); setQ(""); }}>
                            <b>{i.name}</b>{i.acronym && <small>{i.acronym}</small>}
                            <span>{rbx(worth(i))}{i.value == null ? " RAP" : ""}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/** Someone's limiteds, to click into the trade. */
function Inventory({ all, side, onPick, full }: { all: Map<string, RbxLimited>; side: SideId; onPick(id: string): void; full: boolean; }) {
    const me = getMe();
    const [who, setWho] = useState(side === "give" && me ? me.name : "");
    const [state, setState] = useState<{ items?: { id: string; copies: number; }[]; name?: string; error?: string; busy?: boolean; }>({});
    const [thumbs, setThumbs] = useState<Record<string, string>>({});
    const look = async (q = who) => {
        const name = q.trim().replace(/^@/, "");
        if (!name) return;
        setState({ busy: true });
        const u = await fetchRef({ kind: "user", id: name });
        if (!u.ok || u.info?.kind !== "user") { setState({ error: u.error ?? "Couldn't find them" }); return; }
        const p = await fetchPlayerHistory(u.info.id);
        if (!p.ok) { setState({ error: p.error }); return; }
        const items = p.player.owned.filter(o => all.has(o.id)).sort((a, b) => worth(all.get(b.id)!) - worth(all.get(a.id)!));
        setState({ items, name: u.info.displayName });
        setThumbs(await fetchThumbs(items.slice(0, 60).map(i => i.id)));
    };
    useEffect(() => { if (side === "give" && me && all.size) void look(me.name); }, [all.size]);
    return (
        <div className={rb("tr-inv")}>
            <div className={rb("bar")}>
                <input className="vc-tool-input" value={who} placeholder={side === "give" ? "Your username (or set My account)" : "Their username"} onChange={e => setWho(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") look(); }} />
                <button type="button" className="vc-tool-btn" disabled={state.busy || !who.trim()} onClick={() => look()}>{state.busy ? "…" : "Show items"}</button>
            </div>
            {state.error && <span className="vc-tool-error">{state.error}</span>}
            {state.items && (state.items.length ? (
                <div className={rb("tr-inv-grid")}>
                    {state.items.slice(0, 60).map(o => {
                        const i = all.get(o.id)!;
                        return (
                            <button key={o.id} type="button" className={rb("tr-inv-item")} disabled={full} title={`${i.name} — ${rbx(worth(i))}${o.copies > 1 ? ` · they have ${o.copies}` : ""}`} onClick={() => onPick(o.id)}>
                                {thumbs[o.id] ? <img src={thumbs[o.id]} alt="" loading="lazy" /> : <span className={rb("img-none")}>💎</span>}
                                <small>{i.acronym || i.name}</small>
                                <b>{short(worth(i))}</b>
                                {o.copies > 1 && <i>×{o.copies}</i>}
                            </button>
                        );
                    })}
                </div>
            ) : <span className={rb("muted")}>{state.name} has no limiteds Rolimons knows of (or their inventory is private).</span>)}
        </div>
    );
}

function SideBox({ id, label, side, all, thumbs, set }: { id: SideId; label: string; side: Side; all: Map<string, RbxLimited>; thumbs: Record<string, string>; set(s: Side): void; }) {
    const [inv, setInv] = useState(false);
    const items = side.items.map(x => all.get(x)).filter(Boolean) as RbxLimited[];
    const robux = robuxOf(side.robux);
    const full = side.items.length >= MAX_ITEMS;
    const add = (itemId: string) => { if (!full) set({ ...side, items: [...side.items, itemId] }); };
    return (
        <div className={classes(rb("tr-side"), rb(`tr-${id}`))}>
            <div className={rb("tr-side-head")}>
                <b>{label}</b>
                <span className={rb("spacer")} />
                <button type="button" className={classes(rb("link"), inv && rb("saved-on"))} onClick={() => setInv(v => !v)}>{inv ? "Hide inventory" : id === "give" ? "From my items" : "From their items"}</button>
            </div>
            <Picker all={[...all.values()]} onPick={add} full={full} />
            {inv && <Inventory all={all} side={id} onPick={add} full={full} />}
            <div className={rb("tr-items")}>
                {items.map((i, n) => (
                    <div key={`${i.id}-${n}`} className={rb("tr-item")}>
                        {thumbs[i.id] ? <img src={thumbs[i.id]} alt="" /> : <span className={rb("img-none")}>💎</span>}
                        <div className={rb("tr-item-main")}>
                            <b>{i.name}{i.acronym && <small> · {i.acronym}</small>}</b>
                            <span>Value <b>{i.value != null ? rbx(i.value) : "—"}</b> · RAP {rbx(i.rap)}</span>
                            <Badges i={i} />
                        </div>
                        <button type="button" className="vc-tool-icon" title="Take it out" onClick={() => set({ ...side, items: side.items.filter((_, k) => k !== n) })}>✕</button>
                    </div>
                ))}
                {!items.length && <span className={rb("tr-empty")}>No items yet.</span>}
            </div>
            <label className={rb("tr-robux")}>
                <span>+ Robux</span>
                <input className="vc-tool-input" inputMode="numeric" value={side.robux} placeholder="0" onChange={e => set({ ...side, robux: e.currentTarget.value })} />
                {robux > 0 && <small>arrives as {rbx(robux * (1 - TAX))} after Roblox's {TAX * 100}%</small>}
            </label>
        </div>
    );
}

export function Trade() {
    const [sides, setSides] = useState(load);
    const [list, setList] = useState<{ items?: RbxLimited[]; error?: string; at?: number; }>({});
    const [thumbs, setThumbs] = useState<Record<string, string>>({});
    useEffect(() => { fetchLimiteds().then(r => setList(r.ok ? { items: r.items, at: r.at } : { error: r.error })); }, []);
    useEffect(() => { store(sides); }, [sides]);
    const all = useMemo(() => new Map((list.items ?? []).map(i => [i.id, i])), [list.items]);
    const ids = [...sides.give.items, ...sides.get.items];
    useEffect(() => {
        const need = ids.filter(x => !thumbs[x]);
        if (need.length) void fetchThumbs(need).then(t => setThumbs(o => ({ ...o, ...t })));
    }, [ids.join(",")]);

    if (list.error) return <span className="vc-tool-error">Couldn't get item values from Rolimons: {list.error}</span>;
    if (!list.items) return <div className={rb("loading")}><span className={rb("spin")} /> Getting every limited's value from Rolimons…</div>;

    const total = (s: Side) => {
        const items = s.items.map(x => all.get(x)).filter(Boolean) as RbxLimited[];
        const robux = robuxOf(s.robux) * (1 - TAX);
        return { value: items.reduce((a, i) => a + worth(i), 0) + robux, rap: items.reduce((a, i) => a + i.rap, 0) + robux, items };
    };
    const give = total(sides.give), get = total(sides.get);
    const diff = get.value - give.value;
    const pct = give.value ? diff / give.value * 100 : get.value ? 100 : 0;
    const rapDiff = get.rap - give.rap;
    const ready = give.value > 0 || get.value > 0;
    const verdict = !ready ? null : Math.abs(pct) < 5 ? { k: "fair", t: "Fair trade" } : diff > 0 ? { k: "win", t: "You win" } : { k: "loss", t: "You lose" };
    const warnings = [
        ...get.items.filter(i => i.projected).map(i => `${i.name} is projected — its RAP is pushed up, so it's worth less than it looks.`),
        ...get.items.filter(i => i.demand >= 0 && i.demand <= 1).map(i => `${i.name} has ${DEMAND[i.demand].toLowerCase()} demand — it could be hard to trade away later.`),
        ...give.items.filter(i => i.rare).map(i => `You're giving away ${i.name}, which is rare.`),
    ];
    const set = (id: SideId) => (s: Side) => setSides(o => ({ ...o, [id]: s }));
    const copy = () => copyWithToast([
        `You give: ${give.items.map(i => i.acronym || i.name).join(", ") || "nothing"}${robuxOf(sides.give.robux) ? ` + R$ ${robuxOf(sides.give.robux).toLocaleString()}` : ""} (${rbx(give.value)})`,
        `You get: ${get.items.map(i => i.acronym || i.name).join(", ") || "nothing"}${robuxOf(sides.get.robux) ? ` + R$ ${robuxOf(sides.get.robux).toLocaleString()}` : ""} (${rbx(get.value)})`,
        verdict ? `${verdict.t}: ${diff >= 0 ? "+" : "−"}${rbx(Math.abs(diff))} value (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)` : "",
    ].filter(Boolean).join("\n"), "Trade copied");

    return (
        <div className={rb("tr")}>
            <div className={classes(rb("tr-result"), verdict && rb(`tr-${verdict.k}`))}>
                {verdict ? (
                    <>
                        <div className={rb("tr-verdict")}><b>{verdict.t}</b><span>{diff >= 0 ? "+" : "−"}{rbx(Math.abs(diff))} value · {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%</span></div>
                        <div className={rb("tr-totals")}>
                            <span>You give <b>{rbx(give.value)}</b> <small>RAP {rbx(give.rap)}</small></span>
                            <span>You get <b>{rbx(get.value)}</b> <small>RAP {rbx(get.rap)} ({rapDiff >= 0 ? "+" : "−"}{short(Math.abs(rapDiff))})</small></span>
                        </div>
                    </>
                ) : <span className="vc-tool-hint">Add items to either side to see who comes out ahead.</span>}
                <span className={rb("spacer")} />
                <div className={rb("tr-actions")}>
                    <button type="button" className="vc-tool-btn" title="Swap the two sides" onClick={() => setSides(o => ({ give: o.get, get: o.give }))}>⇄ Swap</button>
                    {ready && <button type="button" className="vc-tool-btn" onClick={copy}>Copy</button>}
                    {ready && <button type="button" className="vc-tool-btn" onClick={() => setSides(blank())}>Clear</button>}
                </div>
            </div>
            {warnings.length > 0 && <div className={rb("tr-warnings")}>{warnings.map(w => <span key={w}>⚠️ {w}</span>)}</div>}
            <div className={rb("tr-sides")}>
                <SideBox id="give" label="You give" side={sides.give} all={all} thumbs={thumbs} set={set("give")} />
                <SideBox id="get" label="You get" side={sides.get} all={all} thumbs={thumbs} set={set("get")} />
            </div>
            <div className={rb("foot")}>
                <span className="vc-tool-hint">Values from Rolimons ({list.items.length.toLocaleString()} limiteds{list.at ? `, updated ${new Date(list.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}). Items without a value count at their RAP. Robux is counted after Roblox's 30%.</span>
                <span className={rb("spacer")} />
                <a className={rb("link")} href="https://www.rolimons.com/tradecalculator" target="_blank" rel="noreferrer">Rolimons ↗</a>
            </div>
        </div>
    );
}
