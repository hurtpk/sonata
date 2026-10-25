/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, useEffect, useMemo, useState } from "@webpack/common";

import { Avatar, cl, classes, useBackend } from "./bits";
import { Entry, fmtBytes, fmtDay, fmtDuration, fmtWhen, Scope, whereText } from "./data";

const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props { list: Entry[]; onScope(s: Scope): void; onOpen(e: Entry): void; onQuery(q: string): void; }

export function OverviewView({ list, onScope, onOpen, onQuery }: Props) {
    const backend = useBackend();
    const [storage, setStorage] = useState<{ usage: number; quota: number; } | null>(null);
    useEffect(() => { backend.storage?.().then(setStorage).catch(() => { }); }, []);

    const s = useMemo(() => {
        const now = Date.now();
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const days = Array.from({ length: 30 }, (_, i) => ({ start: today.getTime() - (29 - i) * DAY, del: 0, edit: 0, ghost: 0 }));
        const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
        const people = new Map<string, { e: Entry; n: number; }>();
        const places = new Map<string, { e: Entry; n: number; }>();
        let oldest = 0, deleted = 0, edited = 0, ghost = 0, media = 0, saved = 0, quick = 0, goneSum = 0, goneN = 0;
        for (const e of list) {
            if (!oldest || e.at < oldest) oldest = e.at;
            if (e.deleted) deleted++;
            if (e.edited) edited++;
            if (e.ghost) ghost++;
            for (const m of [...e.media, ...e.files]) { media++; if (m.saved) saved++; }
            if (e.gone != null) { const d = e.gone - e.sent; goneSum += d; goneN++; if (d < 60_000) quick++; }
            const di = Math.floor((e.at - days[0].start) / DAY);
            if (di >= 0 && di < 30) { const d = days[di]; if (e.ghost) d.ghost++; else if (e.deleted) d.del++; else d.edit++; }
            const t = new Date(e.at);
            heat[t.getDay()][t.getHours()]++;
            const p = people.get(e.authorId); if (p) p.n++; else people.set(e.authorId, { e, n: 1 });
            const c = places.get(e.channelId); if (c) c.n++; else places.set(e.channelId, { e, n: 1 });
        }
        const byGone = list.filter(e => e.gone != null).sort((a, b) => (a.gone! - a.sent) - (b.gone! - b.sent));
        return {
            now, days, heat, deleted, edited, ghost, media, saved, quick,
            avgGone: goneN ? goneSum / goneN : 0,
            heatMax: heat.flat().reduce((a, b) => Math.max(a, b), 1),
            dayMax: Math.max(1, ...days.map(d => d.del + d.edit + d.ghost)),
            topPeople: [...people.values()].sort((a, b) => b.n - a.n).slice(0, 6),
            topPlaces: [...places.values()].sort((a, b) => b.n - a.n).slice(0, 6),
            people: people.size, places: places.size,
            quickest: byGone.slice(0, 5),
            mostEdited: list.filter(e => e.edited).sort((a, b) => b.versions.length - a.versions.length).slice(0, 5),
            ghosts: list.filter(e => e.ghost).slice(0, 5),
            oldest,
        };
    }, [list]);

    const peopleMax = s.topPeople[0]?.n ?? 1, placesMax = s.topPlaces[0]?.n ?? 1;
    const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

    return (
        <div className={cl("overview")}>
            <div className="vc-tool-stats">
                <div className="vc-tool-stat vc-tool-stat-accent"><span>Logged</span><b>{list.length.toLocaleString()}</b></div>
                <div className="vc-tool-stat"><span>🗑️ Deleted</span><b>{s.deleted.toLocaleString()}</b></div>
                <div className="vc-tool-stat"><span>✏️ Edited</span><b>{s.edited.toLocaleString()}</b></div>
                <div className="vc-tool-stat"><span>👻 Ghost pings</span><b>{s.ghost.toLocaleString()}</b></div>
                <div className="vc-tool-stat"><span>🖼️ Pictures &amp; files</span><b>{s.media.toLocaleString()}<small className={cl("stat-sub")}> {s.saved} saved</small></b></div>
                <div className="vc-tool-stat"><span>👥 People</span><b>{s.people.toLocaleString()}</b></div>
                <div className="vc-tool-stat"><span>📍 Places</span><b>{s.places.toLocaleString()}</b></div>
                <div className="vc-tool-stat"><span>⚡ Gone in a minute</span><b>{s.quick.toLocaleString()}</b></div>
            </div>

            <section className="vc-tool-section">
                <div className="vc-tool-head">
                    <span className="vc-tool-label">Last 30 days</span>
                    <span className={cl("legend")}><i className={cl("lg-del")} />Deleted <i className={cl("lg-edit")} />Edited <i className={cl("lg-ghost")} />Ghost pings</span>
                </div>
                <div className={cl("chart")}>
                    {s.days.map(d => {
                        const total = d.del + d.edit + d.ghost;
                        return (
                            <button key={d.start} type="button" className={cl("col")} disabled={!total} onClick={() => onQuery(`on:${dayKey(d.start)}`)}
                                title={`${fmtDay(d.start)}: ${total} (${d.del} deleted, ${d.edit} edited, ${d.ghost} ghost pings)`}>
                                <span className={cl("stack")} style={{ height: `${(total / s.dayMax) * 100}%` }}>
                                    {d.ghost > 0 && <i className={cl("lg-ghost")} style={{ flex: d.ghost }} />}
                                    {d.edit > 0 && <i className={cl("lg-edit")} style={{ flex: d.edit }} />}
                                    {d.del > 0 && <i className={cl("lg-del")} style={{ flex: d.del }} />}
                                </span>
                            </button>
                        );
                    })}
                </div>
                <div className={cl("chart-axis")}><span>{fmtDay(s.days[0].start)}</span><span>{fmtDay(s.days[15].start)}</span><span>Today</span></div>
            </section>

            <div className={cl("two")}>
                <section className="vc-tool-section">
                    <span className="vc-tool-label">Busiest times</span>
                    <div className={cl("heat")}>
                        {s.heat.map((row, d) => (
                            <React.Fragment key={d}>
                                <span className={cl("heat-day")}>{WEEKDAYS[d]}</span>
                                {row.map((n, h) => <i key={h} title={`${WEEKDAYS[d]} ${h}:00 — ${n}`} style={{ opacity: n ? 0.18 + 0.82 * (n / s.heatMax) : 0.06 }} />)}
                            </React.Fragment>
                        ))}
                        <span />
                        {[0, 6, 12, 18].map(h => <span key={h} className={cl("heat-hour")} style={{ gridColumn: `${h + 2} / span 6` }}>{h === 0 ? "12am" : h === 12 ? "12pm" : h < 12 ? `${h}am` : `${h - 12}pm`}</span>)}
                    </div>
                </section>
                <section className="vc-tool-section">
                    <span className="vc-tool-label">Facts</span>
                    <dl className={cl("facts")}>
                        <dt>Oldest log</dt><dd>{s.oldest ? fmtWhen(s.oldest) : "–"}</dd>
                        <dt>Usual time before deleting</dt><dd>{s.avgGone ? fmtDuration(s.avgGone) : "–"}</dd>
                        <dt>Pictures saved</dt><dd>{s.saved} of {s.media}</dd>
                        {storage && <><dt>Space used</dt><dd>{fmtBytes(storage.usage)}</dd></>}
                    </dl>
                </section>
            </div>

            <div className={cl("two")}>
                <section className="vc-tool-section">
                    <span className="vc-tool-label">Most logged people</span>
                    {s.topPeople.map(({ e, n }) => (
                        <button key={e.authorId} type="button" className={cl("rank")} onClick={() => onScope({ kind: "person", id: e.authorId })}>
                            <Avatar src={e.author.avatar} size={22} />
                            <span className={cl("rank-name")}>{e.author.name}</span>
                            <span className={cl("rank-bar")}><i style={{ width: `${(n / peopleMax) * 100}%` }} /></span>
                            <b>{n}</b>
                        </button>
                    ))}
                </section>
                <section className="vc-tool-section">
                    <span className="vc-tool-label">Most logged places</span>
                    {s.topPlaces.map(({ e, n }) => (
                        <button key={e.channelId} type="button" className={cl("rank")} onClick={() => onScope({ kind: "channel", id: e.channelId })}>
                            <span className={cl("rank-icon")}>{e.place.guildId ? "#" : e.place.kind === "group" ? "👥" : "✉️"}</span>
                            <span className={cl("rank-name")} title={whereText(e.place)}>{e.place.guildId ? `${e.place.channelName} · ${e.place.guildName}` : e.place.channelName}</span>
                            <span className={cl("rank-bar")}><i style={{ width: `${(n / placesMax) * 100}%` }} /></span>
                            <b>{n}</b>
                        </button>
                    ))}
                </section>
            </div>

            <div className={cl("two")}>
                <MiniList title="⚡ Deleted fastest" list={s.quickest} onOpen={onOpen} note={e => `gone after ${fmtDuration(e.gone! - e.sent)}`} />
                <MiniList title="✏️ Edited the most" list={s.mostEdited} onOpen={onOpen} note={e => `${e.versions.length - 1} edits`} />
            </div>
            {s.ghosts.length > 0 && <MiniList title="👻 Latest ghost pings" list={s.ghosts} onOpen={onOpen} note={e => `${fmtDay(e.at)} · ${whereText(e.place)}`} />}
        </div>
    );
}

function MiniList({ title, list, onOpen, note }: { title: string; list: Entry[]; onOpen(e: Entry): void; note(e: Entry): string; }) {
    return (
        <section className="vc-tool-section">
            <span className="vc-tool-label">{title}</span>
            {!list.length ? <span className="vc-tool-hint">Nothing yet.</span> : list.map(e => (
                <button key={e.id} type="button" className={classes("vc-tool-item", cl("mini"))} onClick={() => onOpen(e)}>
                    <Avatar src={e.author.avatar} size={26} />
                    <span className="vc-tool-item-main">
                        <span className="vc-tool-item-title"><b>{e.author.name}</b> {e.m.content?.slice(0, 80) || (e.media.length ? "🖼️ a picture" : "…")}</span>
                        <span className="vc-tool-item-sub">{note(e)}</span>
                    </span>
                </button>
            ))}
        </section>
    );
}
