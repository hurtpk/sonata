/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The groups someone is in, with their role and rank in each.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useEffect, useMemo, useState } from "@webpack/common";

import { cardActions, fetchUserGroups, RbxMembership, short } from "./data";

const rb = classNameFactory("vc-rbx-");
type Sort = "rank" | "members" | "name";

export function UserGroups({ userId }: { userId: string; }) {
    const [state, setState] = useState<{ groups?: RbxMembership[]; error?: string; }>({});
    const [sort, setSort] = useState<Sort>("rank");
    const [q, setQ] = useState("");
    useEffect(() => {
        let alive = true;
        setState({});
        fetchUserGroups(userId).then(r => alive && setState(r.ok ? { groups: r.groups } : { error: r.error }));
        return () => { alive = false; };
    }, [userId]);

    const list = useMemo(() => {
        const t = q.trim().toLowerCase();
        return (state.groups ?? []).filter(g => !t || g.name.toLowerCase().includes(t) || g.role.toLowerCase().includes(t))
            .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "members" ? b.members - a.members : (Number(b.primary) - Number(a.primary)) || b.rank - a.rank || b.members - a.members);
    }, [state.groups, sort, q]);

    if (state.error) return <span className={rb("muted")}>👥 Couldn't get their groups: {state.error}</span>;
    if (!state.groups) return <div className={rb("loading")}><span className={rb("spin")} /> Finding their groups…</div>;
    const { groups } = state;
    if (!groups.length) return <span className={rb("muted")}>👥 Not in any groups (or they've hidden them).</span>;
    const owns = groups.filter(g => g.rank === 255).length;

    return (
        <div className={rb("ugroups")}>
            <div className={rb("filters")}>
                <span className={rb("pf-muted")}>In <b>{groups.length}</b> group{groups.length === 1 ? "" : "s"}{owns ? <> · owns <b>{owns}</b></> : null}</span>
                <span className={rb("spacer")} />
                {groups.length > 8 && <input className={classes("vc-tool-input", rb("shop-search"))} value={q} placeholder="Find a group or role…" onChange={e => setQ(e.currentTarget.value)} />}
                <select className="vc-tool-select" value={sort} onChange={e => setSort(e.currentTarget.value as Sort)}>
                    <option value="rank">Highest rank first</option>
                    <option value="members">Biggest first</option>
                    <option value="name">A to Z</option>
                </select>
            </div>
            <div className={rb("owned-list")}>
                {list.map(g => (
                    <button key={g.id} type="button" className={classes(rb("owned-row"), rb("ugroup"))} title="Open this group" onClick={() => cardActions.lookup(`https://www.roblox.com/communities/${g.id}`)}>
                        {g.icon ? <img src={g.icon} alt="" loading="lazy" /> : <span className={rb("img-none")}>👥</span>}
                        <div className={rb("owned-main")}>
                            <b>{g.name}{g.verified && <span className={rb("tick")}>✔</span>}</b>
                            <span>{short(g.members)} member{g.members === 1 ? "" : "s"}</span>
                        </div>
                        <div className={rb("ugroup-role")}>
                            {g.rank === 255 && <span className={classes(rb("badge-mini"), rb("badge-owner"))}>👑 Owner</span>}
                            {g.primary && <span className={classes(rb("badge-mini"), rb("badge-primary"))}>★ Main group</span>}
                            <b>{g.role || "Member"}</b>
                            <small>rank {g.rank}</small>
                        </div>
                    </button>
                ))}
                {!list.length && <span className={rb("muted")}>Nothing matches.</span>}
            </div>
        </div>
    );
}
