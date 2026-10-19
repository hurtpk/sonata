/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A profile, opened in full: who they are at the top, the numbers that matter
// in one row, their old usernames behind a button, and the rest in tabs —
// Outfit, Value (from Rolimons), Groups and Games.

import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { classes } from "@utils/misc";
import { useEffect, useState } from "@webpack/common";

import { ago, date, fetchPlayerHistory, PRESENCE, RbxPlayerHistory, RbxUser, short, sources } from "./data";
import { Outfit } from "./Outfit";
import { OwnedGames } from "./OwnedGames";
import { PlayerValue } from "./PlayerValue";
import { UserGroups } from "./UserGroups";

const rb = classNameFactory("vc-rbx-");
type Section = "outfit" | "value" | "groups" | "games";
const SECTION_KEY = "vc-rbx-profile-section";

/** Old usernames, each once (most recent first), with how many times they've had it. */
export function uniqueNames(names: string[], current: string) {
    const seen = new Map<string, number>();
    for (const n of names) seen.set(n, (seen.get(n) ?? 0) + 1);
    return [...seen.entries()].map(([name, times]) => ({ name, times, current: name.toLowerCase() === current.toLowerCase() }));
}

function Names({ u }: { u: RbxUser; }) {
    const [open, setOpen] = useState(false);
    const list = uniqueNames(u.names, u.name);
    if (!u.names.length) return null;
    const others = list.filter(n => !n.current).length;
    return (
        <div className={rb("pf-names")}>
            <button type="button" className={classes(rb("pf-names-btn"), open && rb("pf-names-btn-on"))} onClick={() => setOpen(o => !o)} aria-expanded={open}>
                <span>🕘</span>
                <b>{others} previous username{others === 1 ? "" : "s"}</b>
                {u.names.length !== list.length && <small>{u.names.length} changes in all</small>}
                <i>{open ? "▾" : "▸"}</i>
            </button>
            {open && (
                <div className={rb("pf-names-list")}>
                    <div className={rb("chips")}>
                        {list.map(n => (
                            <button key={n.name} type="button" className={classes(rb("chip"), n.current && rb("chip-current"))} onClick={() => copyWithToast(n.name, `Copied ${n.name}`)}
                                title={n.current ? "Their name now — click to copy" : `Click to copy${n.times > 1 ? ` · used ${n.times} times` : ""}`}>
                                {n.name}{n.times > 1 && <small>×{n.times}</small>}{n.current && <small>now</small>}
                            </button>
                        ))}
                    </div>
                    <div className={rb("pf-names-foot")}>
                        <span className="vc-tool-hint">Newest first · click one to copy it</span>
                        <span className={rb("spacer")} />
                        <button type="button" className={rb("link")} onClick={() => copyWithToast(list.map(n => n.name).join(", "), "Copied every username")}>Copy all</button>
                    </div>
                </div>
            )}
        </div>
    );
}

function Bio({ text }: { text: string; }) {
    const [more, setMore] = useState(false);
    if (!text.trim()) return null;
    const long = text.length > 220 || text.split("\n").length > 4;
    return (
        <div className={classes(rb("pf-bio"), long && !more && rb("pf-bio-clamp"))}>
            {text}
            {long && <button type="button" className={rb("link")} onClick={() => setMore(m => !m)}>{more ? "Show less" : "Show more"}</button>}
        </div>
    );
}

export function FullProfile({ u, Img }: { u: RbxUser; Img: (p: { src?: string; className: string; alt?: string; }) => any; }) {
    const [section, setSection] = useState<Section>(() => { try { return (localStorage.getItem(SECTION_KEY) as Section) || "outfit"; } catch { return "outfit"; } });
    const [roli, setRoli] = useState<RbxPlayerHistory | null>(null);
    useEffect(() => {
        if (!sources.rolimons) return;
        let alive = true;
        fetchPlayerHistory(u.id).then(r => alive && r.ok && r.player.tracked && setRoli(r.player));
        return () => { alive = false; };
    }, [u.id]);
    const pick = (s: Section) => { setSection(s); try { localStorage.setItem(SECTION_KEY, s); } catch { } };
    const presence = PRESENCE[u.presence] ?? "Offline";
    const lastSeen = u.presence === 0 ? (roli?.lastOnline ? roli.lastOnline * 1000 : u.lastOnline ? Date.parse(u.lastOnline) : null) : null;

    return (
        <div className={rb("pf")}>
            <div className={rb("pf-hero")}>
                <Img src={u.avatar} className={rb("pf-avatar")} />
                <div className={rb("pf-id")}>
                    <div className={rb("pf-name")}>
                        <b>{u.displayName}</b>
                        {u.verified && <span className={rb("tick")} title="Verified">✔</span>}
                        {u.banned && <span className={rb("banned")}>Banned</span>}
                    </div>
                    <div className={rb("pf-sub")}>
                        <button type="button" className={rb("pf-handle")} title="Copy username" onClick={() => copyWithToast(u.name)}>@{u.name}</button>
                        <span className={classes(rb("pf-pill"), rb(`pf-pill-${u.presence}`))}><i className={classes(rb("dot"), rb(`dot-${u.presence}`))} />{presence}</span>
                        {lastSeen && <span className={rb("pf-muted")}>last seen {ago(lastSeen)}</span>}
                    </div>
                    <div className={rb("pf-meta")}>
                        <span>Joined {date(u.created)} ({ago(u.created)})</span>
                        <span>·</span>
                        <button type="button" className={rb("pf-handle")} title="Copy user ID" onClick={() => copyWithToast(u.id, "User ID copied")}>ID {u.id}</button>
                    </div>
                </div>
            </div>

            <div className={rb("pf-numbers")}>
                <div><b>{short(u.followers)}</b><span>Followers</span></div>
                <div><b>{short(u.following)}</b><span>Following</span></div>
                <div><b>{short(u.friends)}</b><span>Friends</span></div>
                {roli && <div title="From Rolimons"><b>{roli.value ? `R$ ${short(roli.value)}` : "R$ 0"}</b><span>Value</span></div>}
                {roli?.peakValue && <div title="From Rolimons"><b>R$ {short(roli.peakValue.n)}</b><span>Peak value</span></div>}
            </div>

            <Bio text={u.bio} />
            <Names u={u} />

            <div className={rb("pf-tabs")} role="tablist">
                {([["outfit", "👕 Outfit"], ["value", "💎 Value"], ["groups", "👥 Groups"], ["games", "🎮 Games"]] as [Section, string][])
                    .filter(([s]) => s !== "value" || sources.rolimons)
                    .map(([s, l]) => <button key={s} type="button" role="tab" aria-selected={section === s} className={classes(rb("pf-tab"), section === s && rb("pf-tab-on"))} onClick={() => pick(s)}>{l}</button>)}
            </div>
            <div className={rb("pf-section")}>
                {section === "outfit" && <Outfit userId={u.id} body={u.body} who={u.displayName} />}
                {section === "value" && <PlayerValue userId={u.id} />}
                {section === "groups" && <UserGroups userId={u.id} />}
                {section === "games" && <OwnedGames kind="user" id={u.id} name={u.displayName} emptyText={`${u.displayName} hasn't made any public games.`} />}
            </div>
        </div>
    );
}
