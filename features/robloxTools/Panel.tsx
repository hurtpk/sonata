/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import { React, useEffect, useMemo, useReducer, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { currentRates, ensureRates, money, onRatesChange, settings as converterSettings } from "../currencyConverter";
import { robuxResult } from "../currencyConverter/robux";
import { formatNumber } from "../currencyConverter/units";
import { useHubFrame } from "../games/hub";
import { openGames } from "../games/Panel";
import { Assets } from "./Assets";
import { refOf } from "./bookmarks";
import { rb, RefCard } from "./Card";
import { Compare } from "./Compare";
import { ago, cardActions, findLinks, parseLookup, RbxInfo, RbxRef, short, urlFor } from "./data";
import { checkGroups, getGroups, onGroupsChange, unwatchGroup, Watched,watchGroup } from "./groups";
import { Names } from "./Names";
import { People } from "./People";
import { amountOf, RobuxRates } from "./Rates";
import { savedKey,SavedSidebar } from "./SavedSidebar";
import { Servers } from "./Servers";
import { Trade } from "./Trade";

type Tab = "lookup" | "servers" | "compare" | "assets" | "trade" | "groups" | "people" | "names" | "robux";

/** The tools in four groups, so the top of the window stays tidy. */
const GROUPS: { id: string; icon: string; label: string; tools: { tab: Tab; icon: string; label: string; blurb: string; }[]; }[] = [
    {
        id: "find", icon: "🔎", label: "Find", tools: [
            { tab: "lookup", icon: "🔎", label: "Look up", blurb: "Any profile, game, group or item" },
            { tab: "names", icon: "🏷️", label: "Names", blurb: "Is a username free?" },
            { tab: "people", icon: "👤", label: "People", blurb: "Watch name, bio and avatar changes" },
        ],
    },
    {
        id: "games", icon: "🎮", label: "Games", tools: [
            { tab: "servers", icon: "🖥️", label: "Servers", blurb: "Find a server and join it" },
            { tab: "compare", icon: "⚖️", label: "Compare", blurb: "Up to four games side by side" },
            { tab: "assets", icon: "📦", label: "Assets", blurb: "An item's 3D model, textures and sounds" },
        ],
    },
    {
        id: "trading", icon: "🤝", label: "Trading", tools: [
            { tab: "trade", icon: "🤝", label: "Trade", blurb: "Who comes out ahead" },
            { tab: "robux", icon: "🧱", label: "Robux", blurb: "Robux to money and back" },
        ],
    },
    {
        id: "groups", icon: "👥", label: "Groups", tools: [
            { tab: "groups", icon: "👥", label: "Groups", blurb: "Watch groups grow and catch new shouts" },
        ],
    },
];
const groupOf = (t: Tab) => GROUPS.find(g => g.tools.some(x => x.tab === t)) ?? GROUPS[0];

// Cards anywhere can open the server finder; inside the window it just switches tab.
cardActions.servers = placeId => openRoblox("servers", placeId);
cardActions.lookup = query => openRoblox("lookup", query);
cardActions.compare = placeId => openRoblox("compare", placeId);
cardActions.assets = assetId => openRoblox("assets", assetId);

function useGroups() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => onGroupsChange(bump), []);
    return getGroups();
}

/* ── Look up ── */

const RECENT_KEY = "vc-rbx-recent";
const recent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; } };
const remember = (q: string) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...recent().filter(x => x !== q)].slice(0, 8))); } catch { } };

function Lookup({ initial, onInfo }: { initial?: string; onInfo?(info: RbxInfo): void; }) {
    const [text, setText] = useState(initial ?? "");
    const [ref, setRef] = useState<RbxRef | null>(() => initial ? parseLookup(initial) : null);
    const [err, setErr] = useState<string | null>(null);
    const go = (q = text) => {
        const r = parseLookup(q);
        if (!r) { setErr("Paste a Roblox link (profile, game, group or item), a user ID or a username."); return; }
        setErr(null); setRef(r); remember(q.trim());
    };
    return (
        <>
            <div className={rb("bar")}>
                <input className="vc-tool-input" autoFocus value={text} placeholder="A Roblox link, user ID or username — e.g. builderman, roblox.com/games/920587237"
                    onChange={e => setText(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") go(); }} />
                <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => go()}>Look up</button>
            </div>
            {err && <span className="vc-tool-error">{err}</span>}
            {!ref && recent().length > 0 && (
                <div className="vc-tool-chips">
                    <span className="vc-tool-hint">Recent:</span>
                    {recent().map(q => <button key={q} type="button" className="vc-tool-chip" onClick={() => { setText(q); go(q); }}>{q.replace(/^https?:\/\/(www\.)?roblox\.com\//, "")}</button>)}
                </div>
            )}
            {ref ? <RefCard key={`${ref.kind}:${ref.id}`} refx={ref} full onInfo={onInfo} /> : (
                <div className="vc-tool-empty">
                    <span className="vc-tool-empty-icon">🧱</span>
                    Look up any Roblox profile, game, group or catalog item.
                    <span className="vc-tool-hint">Profiles show every username they've had. Roblox links in chat get a live card under the message too.</span>
                </div>
            )}
        </>
    );
}

/* ── Groups ── */

function Spark({ g }: { g: Watched; }) {
    const pts = g.history.slice(-40);
    if (pts.length < 2) return null;
    const lo = Math.min(...pts.map(p => p.members)), hi = Math.max(...pts.map(p => p.members));
    const d = pts.map((p, i) => `${i ? "L" : "M"}${(i / (pts.length - 1)) * 100},${28 - ((p.members - lo) / Math.max(1, hi - lo)) * 26}`).join("");
    return <svg className={rb("spark")} viewBox="0 0 100 30" preserveAspectRatio="none"><path d={d} fill="none" stroke="var(--tl-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}

const Delta = ({ n }: { n: number; }) => <span className={classes(rb("delta"), n > 0 ? rb("up") : n < 0 ? rb("down") : rb("flat"))}>{n > 0 ? "+" : n < 0 ? "−" : "±"}{short(Math.abs(n))}</span>;

function Groups() {
    const groups = useGroups();
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [open, setOpen] = useState<string | null>(null);
    const add = async () => {
        const t = text.trim();
        const id = t.match(/(?:groups|communities)\/(\d+)/)?.[1] ?? (/^\d+$/.test(t) ? t : null);
        if (!id) { setErr("Paste a Roblox group link or its ID number."); return; }
        setBusy(true); setErr(null);
        const e = await watchGroup(id);
        setBusy(false);
        if (e) setErr(e); else setText("");
    };
    const since = (g: Watched, ms: number) => {
        const now = g.history.at(-1)?.members ?? 0;
        const then = [...g.history].reverse().find(p => p.t <= Date.now() - ms) ?? g.history[0];
        return now - (then?.members ?? now);
    };
    return (
        <>
            <div className={rb("bar")}>
                <input className="vc-tool-input" value={text} placeholder="A Roblox group link or ID — roblox.com/communities/…" onChange={e => setText(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} />
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={busy || !text.trim()} onClick={add}>{busy ? "Adding…" : "＋ Watch"}</button>
                {groups.length > 0 && <button type="button" className="vc-tool-btn" onClick={() => checkGroups(true)}>↻ Check now</button>}
            </div>
            {err && <span className="vc-tool-error">{err}</span>}
            {!groups.length ? (
                <div className="vc-tool-empty"><span className="vc-tool-empty-icon">👥</span>No groups watched yet.<span className="vc-tool-hint">Add your group (and rivals') to see members grow over time, and get told about new shouts.</span></div>
            ) : (
                <div className={rb("groups")}>
                    {groups.map(g => {
                        const now = g.history.at(-1)?.members ?? 0;
                        return (
                            <div key={g.id} className={rb("group")}>
                                <div className={rb("head")}>
                                    {g.icon ? <img className={rb("icon")} src={g.icon} alt="" /> : <span className={classes(rb("icon"), rb("img-none"))}>👥</span>}
                                    <div className={rb("who")}>
                                        <b>{g.name}</b>
                                        <span>{now.toLocaleString()} members · checked {ago(g.lastCheck)}{g.error ? ` · ⚠️ ${g.error}` : ""}</span>
                                    </div>
                                    <button type="button" className="vc-tool-icon" title="Show details" onClick={() => setOpen(o => o === g.id ? null : g.id)}>{open === g.id ? "▾" : "▸"}</button>
                                    <button type="button" className="vc-tool-icon" title="Stop watching" onClick={() => unwatchGroup(g.id)}>✕</button>
                                </div>
                                <div className={rb("stats")}>
                                    <div className={rb("stat")}><span>Since added</span><b><Delta n={now - (g.history[0]?.members ?? now)} /></b><small>{new Date(g.addedAt).toLocaleDateString()}</small></div>
                                    <div className={rb("stat")}><span>24 hours</span><b><Delta n={since(g, 86400_000)} /></b></div>
                                    <div className={rb("stat")}><span>7 days</span><b><Delta n={since(g, 7 * 86400_000)} /></b></div>
                                </div>
                                <Spark g={g} />
                                {g.shout && <div className={rb("shout")}><span>📣 {g.shout.poster} · {ago(g.shout.updated)}</span>{g.shout.body}</div>}
                                {open === g.id && <RefCard refx={{ kind: "group", id: g.id }} full />}
                            </div>
                        );
                    })}
                </div>
            )}
        </>
    );
}

/* ── Robux ── */

/** Money from one currency to another with the Converter's exchange rates (NaN until they've arrived). */
function convert(n: number, from: string, to: string) {
    if (from === to) return n;
    const r = currentRates();
    if (!r) return NaN;
    const rate = (c: string) => c === r.base ? 1 : r.rates[c] ?? NaN;
    return n / rate(from) * rate(to);
}

function Robux() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => { void ensureRates(); return onRatesChange(bump); }, []);
    const [dir, setDir] = useState<"from" | "to">("from");
    const [text, setText] = useState("10000");
    const mine = converterSettings.store.target ?? "USD";
    const query = dir === "from" ? `${text} robux` : `${text} ${mine} to robux`;
    const res = useMemo(() => robuxResult(query, { rates: currentRates(), mine, money, fmt: formatNumber }), [query, currentRates()]);
    return (
        <>
            <div className="vc-tool-seg">
                <button type="button" className={classes("vc-tool-seg-btn", dir === "from" && "vc-tool-seg-on")} onClick={() => setDir("from")}>Robux → money</button>
                <button type="button" className={classes("vc-tool-seg-btn", dir === "to" && "vc-tool-seg-on")} onClick={() => setDir("to")}>Money → Robux</button>
            </div>
            <div className={rb("bar")}>
                <span className={rb("unit")}>{dir === "from" ? "R$" : mine}</span>
                <input className="vc-tool-input" inputMode="decimal" value={text} placeholder={dir === "from" ? "10000 (or 50k)" : "100"} onChange={e => setText(e.currentTarget.value.replace(/[^\d.,kmbKMB]/g, ""))} />
            </div>
            <div className="vc-tool-chips">
                {(dir === "from" ? ["400", "1000", "10k", "30k", "100k", "1m"] : ["5", "20", "100", "500", "1000"]).map(v => <button key={v} type="button" className="vc-tool-chip" onClick={() => setText(v)}>{dir === "from" ? `R$ ${v}` : money(Number(v), mine)}</button>)}
            </div>
            {res && res.rows.length > 0 ? (
                <div className={rb("rows")}>
                    {res.rows.map(r => (
                        <div key={r.label} className={classes(rb("row"), r.strong && rb("row-strong"))}>
                            <b>{r.value}</b>
                            <span>{r.label}{r.sub && <small> · {r.sub}</small>}</span>
                        </div>
                    ))}
                </div>
            ) : <span className="vc-tool-hint">{res?.note ?? "Type an amount."}</span>}
            {res?.note && res.rows.length > 0 && <span className="vc-tool-hint">{res.note} Also in the Converter: try "50k robux" or "$100 to robux".</span>}
            <RobuxRates dir={dir} amount={amountOf(text)} mine={mine} money={money} convert={convert} />
        </>
    );
}

/* ── The window ── */

// Where you were, for coming back to Roblox in Game Hub.
let lastTab: Tab = "lookup";
const lastIn: Record<string, Tab> = {};

/** Roblox, as a section of Game Hub: its content here, its tabs on Game Hub's window. */
export function RobloxSection({ start: startTab, initial }: { start?: string; initial?: string; }) {
    const start = (startTab as Tab | undefined) ?? lastTab;
    const [tab, setTabState] = useState<Tab>(start);
    // Each group reopens on the tool you used last in it.
    const setTab = (t: Tab) => { lastTab = t; lastIn[groupOf(t).id] = t; setTabState(t); };
    const group = groupOf(tab);
    const tool = group.tools.find(x => x.tab === tab)!;
    const [serversFor, setServersFor] = useState(start === "servers" ? initial : undefined);
    const [lookupFor, setLookupFor] = useState(start === "lookup" ? initial : undefined);
    const [compareAdd, setCompareAdd] = useState(start === "compare" ? initial : undefined);
    const [compareNonce, setCompareNonce] = useState(0);
    const [assetsFor, setAssetsFor] = useState(start === "assets" ? initial : undefined);
    const [current, setCurrent] = useState<string | null>(null);
    const showing = (info: RbxInfo) => setCurrent(savedKey(info.kind, info.kind === "game" ? info.placeId : info.id));
    const accent = windowAccent("robloxTools");
    useEffect(() => {
        const outside = { ...cardActions };
        cardActions.servers = placeId => { setServersFor(placeId); setTab("servers"); };
        cardActions.lookup = query => { setLookupFor(query); setTab("lookup"); };
        cardActions.compare = placeId => { setCompareAdd(placeId); setTab("compare"); };
        cardActions.assets = assetId => { setAssetsFor(assetId); setTab("assets"); };
        return () => { Object.assign(cardActions, outside); };
    }, []);
    useHubFrame({
        tabs: GROUPS.map(g => [g.id, g.label] as const), tab: group.id,
        onTab: id => { const g = GROUPS.find(x => x.id === id)!; setTab(lastIn[g.id] ?? g.tools[0].tab); },
        status: ["roblox", `${tool.label.toLowerCase()} · ${tool.blurb.toLowerCase()}`],
        statusRight: "no sign-in needed",
    });
    return (
            <div className={classes("vc-tool-wrap", rb("window"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <div className={rb("layout")}>
                <SavedSidebar current={tab === "lookup" ? current : null}
                    onOpen={s => { setLookupFor(urlFor(refOf(s))); setCurrent(savedKey(s.kind, s.id)); setTab("lookup"); }}
                    onOpenMe={id => { setLookupFor(`https://www.roblox.com/users/${id}/profile`); setCurrent(savedKey("user", id)); setTab("lookup"); }}
                    onCompare={() => { setCompareAdd(undefined); setCompareNonce(n => n + 1); setTab("compare"); }} />
                <div className={rb("main")}>
                {group.tools.length > 1 ? (
                    <div className={rb("subnav")} style={{ "--n": group.tools.length } as React.CSSProperties}>
                        {group.tools.map(t => (
                            <button key={t.tab} type="button" className={classes(rb("sub"), tab === t.tab && rb("sub-on"))} onClick={() => setTab(t.tab)}>
                                <b><span aria-hidden>{t.icon}</span> {t.label}</b>
                                <small>{t.blurb}</small>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className={rb("tool-head")}><b>{tool.icon} {tool.label}</b><small>{tool.blurb}</small></div>
                )}
                <ErrorBoundary key={tab} message="This part of Roblox Tools hit a problem — try another tab, or reopen the window.">
                    {tab === "lookup" && <Lookup key={lookupFor ?? ""} initial={lookupFor} onInfo={showing} />}
                    {tab === "servers" && <Servers key={serversFor ?? ""} initial={serversFor} />}
                    {tab === "compare" && <Compare key={`${compareAdd ?? ""}|${compareNonce}`} add={compareAdd} />}
                    {tab === "assets" && <Assets key={assetsFor ?? ""} initial={assetsFor} />}
                    {tab === "trade" && <Trade />}
                    {tab === "groups" && <Groups />}
                    {tab === "people" && <People />}
                    {tab === "names" && <Names />}
                    {tab === "robux" && <Robux />}
                </ErrorBoundary>
                </div>
                </div>
            </div>
    );
}

export function openRoblox(start: Tab = "lookup", initial?: string) {
    // Roblox lives in Game Hub now.
    openGames({ platform: "roblox", robloxTab: start, robloxInitial: initial });
}

/** The cards under a message with Roblox links. */
export function MessageCards({ content, gamesOnly }: { content: string; gamesOnly: boolean; }) {
    const refs = findLinks(content).filter(r => !gamesOnly || r.kind === "game");
    if (!refs.length) return null;
    return (
        <div className={rb("cards")}>
            {refs.map(r => <RefCard key={`${r.kind}:${r.id}`} refx={r} onOpen={() => openRoblox("lookup", `https://www.roblox.com/${r.kind === "user" ? "users" : r.kind === "game" ? "games" : r.kind === "group" ? "communities" : r.bundle ? "bundles" : "catalog"}/${r.id}`)} />)}
        </div>
    );
}
