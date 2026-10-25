/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Who has a role, with a search. It starts from the members Discord already
// has loaded; typing a name also asks Discord for people by that name, so
// someone who isn't loaded yet still turns up.

import { classNameFactory } from "@utils/css";
import type { Guild, Role } from "@vencord/discord-types";
import { FluxDispatcher, GuildMemberCountStore, GuildMemberStore, IconUtils, useEffect, useMemo, UserStore, useState, useStateFromStores } from "@webpack/common";

import { roleFill } from "./RoleInfo";

const cl = classNameFactory("vc-permviewer-");
const MAX_SHOWN = 200;

interface Row { id: string; name: string; sub: string; avatar: string | null; }

export function RoleMembers({ guild, role, onPick }: { guild: Guild; role: Role; onPick(userId: string): void; }) {
    const loaded = useStateFromStores([GuildMemberStore], () => GuildMemberStore.getMemberIds(guild.id).length);
    const [find, setFind] = useState("");
    const [open, setOpen] = useState(false);
    const everyone = role.id === guild.id;
    const total = GuildMemberCountStore?.getMemberCount?.(guild.id) ?? 0;

    const rows = useMemo<Row[]>(() => {
        const members = (GuildMemberStore.getMembers(guild.id) ?? []) as any[];
        return members
            .filter(m => everyone || (m.roles as string[]).includes(role.id))
            .map(m => {
                const u: any = UserStore.getUser(m.userId);
                return {
                    id: m.userId,
                    name: m.nick ?? u?.globalName ?? u?.username ?? m.userId,
                    sub: u?.username ? `@${u.username}` : m.userId,
                    avatar: u ? IconUtils.getUserAvatarURL(u, false, 64) : null,
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [guild.id, role.id, loaded]);

    const q = find.trim().toLowerCase();
    const shown = q ? rows.filter(r => r.name.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q) || r.id === q) : rows;

    // Searching asks Discord for people by that name too (it sends up to 100 at a time).
    useEffect(() => {
        if (!open || q.length < 2) return;
        const t = setTimeout(() => {
            try { FluxDispatcher.dispatch({ type: "GUILD_MEMBERS_REQUEST", guildIds: [guild.id], query: q, limit: 100 }); } catch { }
        }, 400);
        return () => clearTimeout(t);
    }, [q, open]);

    return (
        <section className={cl("rm")}>
            <button type="button" className={cl("rm-head")} aria-expanded={open} onClick={() => setOpen(o => !o)}>
                <i className={cl("who-dot")} style={{ background: roleFill(role) }} />
                <span className={cl("rm-title")}>Members with this role</span>
                <span className="vc-tool-badge">{rows.length.toLocaleString()}</span>
                <span className={cl("rm-chev")}>{open ? "▾" : "▸"}</span>
            </button>
            {open && <>
                <input className="vc-tool-input" autoFocus value={find} onChange={e => setFind(e.currentTarget.value)}
                    placeholder={`Search ${everyone ? "everyone" : `the ${rows.length.toLocaleString()} with ${role.name}`} by name or ID`} />
                {!shown.length
                    ? <div className="vc-tool-empty">{q ? `Nobody with this role called “${find.trim()}” yet — if they're in the server, Discord may still be sending them.` : "Nobody Discord has loaded has this role yet."}</div>
                    : (
                        <div className={cl("rm-list")}>
                            {shown.slice(0, MAX_SHOWN).map(r => (
                                <button key={r.id} type="button" className={cl("rm-row")} title="Look them up" onClick={() => onPick(r.id)}>
                                    {r.avatar ? <img className={cl("who-avatar")} src={r.avatar} alt="" /> : <span className={cl("who-avatar")} />}
                                    <span className={cl("rm-text")}><b>{r.name}</b><span>{r.sub}</span></span>
                                </button>
                            ))}
                        </div>
                    )}
                <span className="vc-tool-hint">
                    {shown.length > MAX_SHOWN ? `Showing ${MAX_SHOWN} of ${shown.length.toLocaleString()} — search to find others. ` : ""}
                    From the {loaded.toLocaleString()} members Discord has loaded{total ? ` of ${total.toLocaleString()}` : ""}; searching asks Discord for more.
                </span>
            </>}
        </section>
    );
}
