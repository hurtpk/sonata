/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// "This week": how long you spent in calls, on which days, who with and
// where — this week or any of the nine before it, next to the week before.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { Clickable, useEffect, useState } from "@webpack/common";

import { ToolHero } from "../_shared/ToolHero";
import { avatar, channelName, displayName, personActions } from "./Panel";
import { clearRecap, dayKey, useRecap, weekOf } from "./recapStore";
import { getCurrent } from "./tracker";

const cl = classNameFactory("vc-vtl-");

/** "3h 20m", "45m", "under a minute". */
function long(ms: number) {
    const m = Math.round(ms / 60000);
    if (m < 1) return ms > 0 ? "under a minute" : "0m";
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${m}m`;
}

const dayName = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: "short" });
const dateName = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function RecapView() {
    const ready = useRecap();
    const [ago, setAgo] = useState(0);
    const [sure, setSure] = useState(false);
    useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 3000); return () => clearTimeout(t); }, [sure]);

    const cur = getCurrent();
    const live = cur && ago === 0 ? { day: dayKey(cur.startedAt), session: cur } : undefined;
    const week = weekOf(ago, live);
    const before = weekOf(ago + 1);
    const top = Math.max(...week.perDay.map(d => d.ms), 1);
    const change = before.ms >= 60_000 ? Math.round((week.ms - before.ms) / before.ms * 100) : null;
    const best = week.people[0];
    const busiest = week.perDay.reduce((a, b) => b.ms > a.ms ? b : a, week.perDay[0]);
    const range = `${dateName(week.from)} – ${dateName(week.perDay[6].t)}`;

    if (!ready) return <div className={cl("hint")}>Loading…</div>;

    return (
        <div className={cl("recap")}>
            <ToolHero icon="📊" kicker={ago === 0 ? "This week" : ago === 1 ? "Last week" : `${ago} weeks ago`}
                title={week.ms ? `${long(week.ms)} in calls` : "No calls yet"}
                sub={week.ms
                    ? [change == null ? null : change === 0 ? "Same as the week before" : `${Math.abs(change)}% ${change > 0 ? "more" : "less"} than the week before`, best && `most with ${displayName(best[0], null)}`].filter(Boolean).join(" · ")
                    : `${range} — calls you're in add up here.`}
                numbers={[{ value: week.calls, label: week.calls === 1 ? "call" : "calls" }, { value: week.people.length, label: week.people.length === 1 ? "person" : "people" }]} />

            <div className={cl("recap-nav")}>
                <button type="button" className="vc-tool-btn" disabled={ago >= 9} onClick={() => setAgo(a => a + 1)}>‹ Earlier</button>
                <span className={cl("recap-range")}>{range}</span>
                <button type="button" className="vc-tool-btn" disabled={ago === 0} onClick={() => setAgo(a => a - 1)}>Later ›</button>
            </div>

            <section className={cl("card")}>
                <div className={cl("card-title")}>Each day<span className={cl("count")}>{busiest.ms ? `busiest: ${dayName(busiest.t)}` : ""}</span></div>
                <div className={cl("recap-days")}>
                    {week.perDay.map(d => (
                        <div key={d.key} className={cl("recap-day")} title={`${dateName(d.t)}: ${long(d.ms)}`}>
                            <span className={cl("recap-time")}>{d.ms ? long(d.ms) : ""}</span>
                            <div className={cl("recap-track")}><i style={{ height: `${d.ms ? Math.max(6, d.ms / top * 100) : 0}%` }} /></div>
                            <span className={cl("recap-label")}>{dayName(d.t)}</span>
                        </div>
                    ))}
                </div>
            </section>

            <div className={cl("columns")}>
                <section className={cl("card")}>
                    <div className={cl("card-title")}>Who you talked with most<span className={cl("count")}>{week.people.length}</span></div>
                    <div className={cl("people")}>
                        {week.people.length ? week.people.slice(0, 10).map(([id, ms], i) => (
                            <Clickable key={id} className={classes(cl("recap-row"), cl("user-action"))} {...personActions(id)} aria-label={`Open profile for ${displayName(id, null)}`}>
                                <span className={cl("recap-rank")}>{i + 1}</span>
                                {avatar(id, null) ? <img className={cl("recap-avatar")} src={avatar(id, null)} alt="" /> : <span className={cl("recap-avatar")} />}
                                <div className={cl("recap-who")}>
                                    <b>{displayName(id, null)}</b>
                                    <div className={cl("recap-bar")}><i style={{ width: `${ms / week.people[0][1] * 100}%` }} /></div>
                                </div>
                                <span className={cl("recap-ms")}>{long(ms)}</span>
                            </Clickable>
                        )) : <div className={cl("hint")}>Nobody yet — people you're in calls with show up here.</div>}
                    </div>
                </section>

                <section className={cl("card")}>
                    <div className={cl("card-title")}>Where<span className={cl("count")}>{week.channels.length}</span></div>
                    <div className={cl("people")}>
                        {week.channels.length ? week.channels.slice(0, 8).map(([id, ms]) => (
                            <div key={id} className={cl("recap-row")}>
                                <span className={cl("recap-rank")}>🔊</span>
                                <div className={cl("recap-who")}>
                                    <b>{channelName(id)}</b>
                                    <div className={cl("recap-bar")}><i style={{ width: `${ms / week.channels[0][1] * 100}%` }} /></div>
                                </div>
                                <span className={cl("recap-ms")}>{long(ms)}</span>
                            </div>
                        )) : <div className={cl("hint")}>No voice channels yet.</div>}
                    </div>
                </section>
            </div>

            <div className="vc-tool-row">
                <span className="vc-tool-hint">Only your own calls, saved on this computer: just how long, who with and where. Kept for 10 weeks.</span>
                <span className="vc-tool-spacer" />
                {sure
                    ? <button type="button" className="vc-tool-btn vc-tool-danger" onClick={() => { void clearRecap(); setSure(false); }}>Delete all of it</button>
                    : <button type="button" className="vc-tool-link" onClick={() => setSure(true)}>Clear recap</button>}
            </div>
        </div>
    );
}
