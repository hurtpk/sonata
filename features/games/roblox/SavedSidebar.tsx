/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Saved sidebar: everything you bookmarked, grouped, with live numbers.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useEffect, useReducer, useState } from "@webpack/common";

import { getLive, getSaved, loadSaved, onSavedChange, refreshLive, removeSaved, Saved, SavedKind } from "./bookmarks";
import { setCompareList } from "./Compare";
import { PRESENCE, short } from "./data";
import { isMuted, onAlertsChange, toggleMuted } from "./gameAlerts";
import { getMe } from "./me";
import { MyAccount } from "./MyAccount";

const rb = classNameFactory("vc-rbx-");
const SECTIONS: { kind: SavedKind; label: string; icon: string; }[] = [
    { kind: "game", label: "Games", icon: "🎮" },
    { kind: "user", label: "Profiles", icon: "👤" },
    { kind: "group", label: "Groups", icon: "👥" },
    { kind: "item", label: "Items", icon: "👕" },
];
type Sort = "recent" | "name" | "live";

const COLLAPSE_KEY = "vc-rbx-side-collapsed";
const OPEN_KEY = "vc-rbx-side-closed-sections";
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };

export const savedKey = (kind: string, id: string) => `${kind}:${id}`;
const getMeId = () => getMe()?.id;

function useSaved() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
        const off = onSavedChange(bump), offBells = onAlertsChange(bump);
        void loadSaved().then(() => refreshLive());
        const t = setInterval(() => void refreshLive(), 60_000);
        return () => { off(); offBells(); clearInterval(t); };
    }, []);
    return getSaved();
}

function liveLine(s: Saved) {
    const live = getLive();
    if (s.kind === "game") {
        const n = s.universeId != null ? live?.games[s.universeId] : undefined;
        return n == null ? <span>{s.sub}</span> : <span><i className={classes(rb("dot"), n > 0 && rb("dot-2"))} />{short(n)} playing</span>;
    }
    if (s.kind === "user") {
        const p = live?.users[s.id];
        return p == null ? <span>{s.sub}</span> : <span><i className={classes(rb("dot"), rb(`dot-${p}`))} />{PRESENCE[p] ?? "Offline"} · {s.sub}</span>;
    }
    if (s.kind === "group") {
        const m = live?.groups[s.id];
        return <span>{m != null ? `${short(m)} members` : s.sub}</span>;
    }
    return <span>{s.sub}</span>;
}

const liveValue = (s: Saved) => {
    const live = getLive();
    if (s.kind === "game") return s.universeId ? live?.games[s.universeId] ?? -1 : -1;
    if (s.kind === "user") return live?.users[s.id] ?? -1;
    if (s.kind === "group") return live?.groups[s.id] ?? -1;
    return -1;
};

export function SavedSidebar({ current, onOpen, onOpenMe, onCompare }: { current: string | null; onOpen(s: Saved): void; onOpenMe(id: string): void; onCompare(): void; }) {
    const saved = useSaved();
    const [collapsed, setCollapsed] = useState<boolean>(() => read(COLLAPSE_KEY, false));
    const [closed, setClosed] = useState<string[]>(() => read(OPEN_KEY, []));
    const [q, setQ] = useState("");
    const [sort, setSort] = useState<Sort>("recent");
    const [busy, setBusy] = useState(false);

    const collapse = (v: boolean) => { setCollapsed(v); write(COLLAPSE_KEY, v); };
    const toggleSection = (k: string) => { const next = closed.includes(k) ? closed.filter(x => x !== k) : [...closed, k]; setClosed(next); write(OPEN_KEY, next); };

    if (collapsed) {
        return (
            <aside className={classes(rb("side"), rb("side-collapsed"))}>
                <button type="button" className={rb("side-rail")} onClick={() => collapse(false)} title="Show saved">
                    <span>★</span><b>{saved.length}</b>
                </button>
            </aside>
        );
    }

    const t = q.trim().toLowerCase();
    const shown = saved.filter(s => !t || s.name.toLowerCase().includes(t) || s.sub.toLowerCase().includes(t));
    const order = (a: Saved, b: Saved) => sort === "name" ? a.name.localeCompare(b.name) : sort === "live" ? liveValue(b) - liveValue(a) : b.addedAt - a.addedAt;
    const games = saved.filter(s => s.kind === "game");

    return (
        <aside className={rb("side")}>
            <div className={rb("side-head")}>
                <b>★ Saved</b>
                <span className={rb("side-count")}>{saved.length}</span>
                <span className={rb("spacer")} />
                {saved.length > 0 && (
                    <button type="button" className="vc-tool-icon" title="Get the latest numbers" disabled={busy}
                        onClick={async () => { setBusy(true); await refreshLive(true); setBusy(false); }}>{busy ? "…" : "↻"}</button>
                )}
                <button type="button" className="vc-tool-icon" title="Hide the sidebar" onClick={() => collapse(true)}>«</button>
            </div>
            {saved.length > 5 && (
                <div className={rb("side-tools")}>
                    <input className="vc-tool-input" value={q} placeholder="Find…" onChange={e => setQ(e.currentTarget.value)} />
                    <select className="vc-tool-select" value={sort} onChange={e => setSort(e.currentTarget.value as Sort)} title="Order">
                        <option value="recent">Newest</option>
                        <option value="name">A–Z</option>
                        <option value="live">Busiest</option>
                    </select>
                </div>
            )}
            <MyAccount current={!!current && current === savedKey("user", getMeId() ?? "")} onOpen={onOpenMe} />
            <div className={rb("side-list")}>
                {!saved.length && (
                    <div className={rb("side-empty")}>
                        <span>☆</span>
                        Nothing saved yet.
                        <small>Press <b>☆ Save</b> on any game, profile, group or item card to keep it here.</small>
                    </div>
                )}
                {SECTIONS.map(sec => {
                    const items = shown.filter(s => s.kind === sec.kind).sort(order);
                    if (!items.length) return null;
                    const isClosed = closed.includes(sec.kind) && !t;
                    return (
                        <div key={sec.kind} className={rb("side-sec")}>
                            <div className={rb("side-sec-head")}>
                                <button type="button" className={rb("side-sec-btn")} onClick={() => toggleSection(sec.kind)}>
                                    <i>{isClosed ? "▸" : "▾"}</i>{sec.icon} {sec.label} <small>{items.length}</small>
                                </button>
                                {sec.kind === "game" && games.length > 1 && !isClosed && (
                                    <button type="button" className={rb("link")} title="Put up to 4 saved games side by side"
                                        onClick={() => { setCompareList(games.slice(0, 4).map(g => g.id)); onCompare(); }}>Compare</button>
                                )}
                            </div>
                            {!isClosed && items.map(s => {
                                const key = savedKey(s.kind, s.id);
                                return (
                                    <div key={key} className={classes(rb("side-row"), current === key && rb("side-row-on"))} role="button" tabIndex={0}
                                        onClick={() => onOpen(s)} onKeyDown={e => { if (e.key === "Enter") onOpen(s); }} title={s.name}>
                                        {s.icon ? <img className={classes(rb("side-img"), s.kind === "user" && rb("side-img-round"))} src={s.icon} alt="" loading="lazy" />
                                            : <span className={classes(rb("side-img"), rb("img-none"))}>{sec.icon}</span>}
                                        <span className={rb("side-text")}><b>{s.name}</b>{liveLine(s)}</span>
                                        {s.kind === "game" && s.universeId && (
                                            <button type="button" className={classes(rb("side-x"), rb("side-bell"), isMuted(s.universeId) && rb("side-bell-off"))}
                                                title={isMuted(s.universeId) ? "Alerts off for this game — click to turn on" : "Alerts on: updates and milestones — click to mute"}
                                                onClick={e => { e.stopPropagation(); void toggleMuted(s.universeId!); }}>{isMuted(s.universeId) ? "🔕" : "🔔"}</button>
                                        )}
                                        <button type="button" className={rb("side-x")} title="Remove from saved" onClick={e => { e.stopPropagation(); removeSaved(s.kind, s.id); }}>✕</button>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
                {saved.length > 0 && !shown.length && <span className={rb("muted")}>Nothing matches.</span>}
            </div>
        </aside>
    );
}
