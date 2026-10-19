/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, useMemo, useState } from "@webpack/common";

import { Avatar, cl, classes, useBackend } from "./bits";
import { Entry, fmtDay, Scope } from "./data";

type Col = "name" | "count" | "deleted" | "edited" | "ghost" | "media" | "places" | "last";

interface Row { id: string; name: string; username: string; avatar: string; bot: boolean; count: number; deleted: number; edited: number; ghost: number; media: number; places: number; last: number; quick: number; }

export function PeopleView({ list, onScope }: { list: Entry[]; onScope(s: Scope): void; }) {
    const backend = useBackend();
    const [sort, setSort] = useState<{ col: Col; desc: boolean; }>({ col: "count", desc: true });
    const [find, setFind] = useState("");
    const [watched, setWatchedList] = useState(() => backend.watched?.() ?? []);
    const toggleWatch = (id: string) => {
        const on = !watched.includes(id);
        backend.setWatched?.(id, on);
        setWatchedList(backend.watched?.() ?? []);
        backend.toast(on ? "Watching — you'll be told when they delete or edit a message" : "Stopped watching");
    };

    // Worked out from what's shown, so the type, time and search filters apply here too.
    const rows = useMemo(() => {
        const map = new Map<string, Row & { placeSet: Set<string>; }>();
        for (const e of list) {
            let r = map.get(e.authorId);
            if (!r) { r = { id: e.authorId, name: e.author.name, username: e.author.username, avatar: e.author.avatar, bot: e.author.bot, count: 0, deleted: 0, edited: 0, ghost: 0, media: 0, places: 0, last: 0, quick: 0, placeSet: new Set() }; map.set(e.authorId, r); }
            r.count++;
            if (e.deleted) r.deleted++;
            if (e.edited) r.edited++;
            if (e.ghost) r.ghost++;
            if (e.gone != null && e.gone - e.sent < 60_000) r.quick++;
            r.media += e.media.length + e.files.length;
            r.placeSet.add(e.channelId);
            r.last = Math.max(r.last, e.at);
        }
        return [...map.values()].map(r => ({ ...r, places: r.placeSet.size }));
    }, [list]);

    const max = Math.max(1, ...rows.map(r => r.count));
    const shown = useMemo(() => {
        const q = find.trim().toLowerCase();
        const out = q ? rows.filter(r => r.name.toLowerCase().includes(q) || r.username.toLowerCase().includes(q) || r.id === q) : rows.slice();
        const dir = sort.desc ? -1 : 1;
        out.sort((a, b) => sort.col === "name" ? dir * a.name.localeCompare(b.name) : dir * ((a[sort.col] as number) - (b[sort.col] as number)));
        return out;
    }, [rows, sort, find]);

    const Head = ({ col, label, title }: { col: Col; label: string; title?: string; }) => (
        <button type="button" className={classes(cl("th"), sort.col === col && cl("th-on"))} title={title}
            onClick={() => setSort(s => ({ col, desc: s.col === col ? !s.desc : col !== "name" }))}>
            {label}{sort.col === col ? (sort.desc ? " ↓" : " ↑") : ""}
        </button>
    );

    if (!rows.length) return null;

    return (
        <div className={cl("people")}>
            <div className={cl("gbar")}>
                <input className="vc-tool-input" style={{ maxWidth: 280 }} value={find} onChange={e => setFind(e.currentTarget.value)} placeholder={`Find someone among ${rows.length.toLocaleString()} people`} />
                <span className="vc-tool-hint">Click someone to see everything logged from them.</span>
            </div>
            <div className={cl("table")}>
                <div className={classes(cl("tr"), cl("thead"))}>
                    <Head col="name" label="Person" />
                    <Head col="count" label="Logged" />
                    <Head col="deleted" label="🗑️" title="Deleted" />
                    <Head col="edited" label="✏️" title="Edited" />
                    <Head col="ghost" label="👻" title="Ghost pings" />
                    <Head col="media" label="🖼️" title="Pictures and files" />
                    <Head col="places" label="📍" title="Channels and DMs" />
                    <Head col="last" label="Last" />
                    <span />
                </div>
                {shown.slice(0, 300).map(r => (
                    <div key={r.id} className={classes(cl("tr"), cl("prow"))} onClick={() => onScope({ kind: "person", id: r.id })}>
                        <span className={cl("pcell")}>
                            <Avatar src={r.avatar} size={28} />
                            <span className={cl("pname")}>
                                <b>{r.name}{r.bot && <span className="vc-tool-badge" style={{ marginLeft: 6 }}>BOT</span>}</b>
                                <span>{r.username ? `@${r.username}` : r.id}{r.quick ? ` · ${r.quick} deleted within a minute` : ""}</span>
                            </span>
                        </span>
                        <span className={cl("num")}><span className={cl("pbar")}><i style={{ width: `${(r.count / max) * 100}%` }} /></span>{r.count.toLocaleString()}</span>
                        <span className={cl("num")}>{r.deleted || "–"}</span>
                        <span className={cl("num")}>{r.edited || "–"}</span>
                        <span className={cl("num")}>{r.ghost || "–"}</span>
                        <span className={cl("num")}>{r.media || "–"}</span>
                        <span className={cl("num")}>{r.places}</span>
                        <span className={cl("muted")}>{fmtDay(r.last)}</span>
                        <span className={cl("pacts")}>
                            {backend.setWatched && <button type="button" className={classes("vc-tool-icon", cl("watch"), watched.includes(r.id) && cl("watch-on"))} title={watched.includes(r.id) ? "Watching — click to stop" : "Watch: tell me when they delete or edit a message"} onClick={ev => { ev.stopPropagation(); toggleWatch(r.id); }}>👁</button>}
                            <button type="button" className="vc-tool-icon" title="Open their profile" onClick={ev => { ev.stopPropagation(); backend.profile(r.id); }}>👤</button>
                        </span>
                    </div>
                ))}
                {shown.length > 300 && <div className={cl("loading-more")}>Showing the top 300 — search to find others.</div>}
            </div>
        </div>
    );
}
