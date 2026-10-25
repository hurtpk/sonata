/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Who in a server has a permission — from the members Discord has already
// loaded (it never asks for the whole member list), and which role gives it.

import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { openUserProfile } from "@utils/discord";
import type { Guild, RenderModalProps, Role } from "@vencord/discord-types";
import { GuildMemberStore, GuildRoleStore, IconUtils, openModal, PermissionsBits, useMemo, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../../../controller/accent";
import { ToolHero } from "../../../_shared/ToolHero";
import { Window } from "../../../_shared/Window";
import { roleFill } from "./RoleInfo";

const cl = classNameFactory("vc-permviewer-");
const MAX_SHOWN = 300;

interface Holder { id: string; name: string; sub: string; avatar: string | null; via: string; viaRole: Role | null; top: number; }

/** Everyone loaded who has `bit`, best-placed first. Also says if @everyone already has it. */
export function whoHas(guild: Guild, bit: bigint): { everyone: boolean; holders: Holder[]; loaded: number; } {
    const roles = GuildRoleStore.getRolesSnapshot(guild.id) as Record<string, Role>;
    const everyoneRole = roles[guild.id];
    const isAdmin = (r: Role) => (r.permissions & PermissionsBits.ADMINISTRATOR) === PermissionsBits.ADMINISTRATOR;
    const allows = (r: Role | undefined) => !!r && ((r.permissions & bit) === bit || isAdmin(r));
    const everyone = allows(everyoneRole);
    const members = (GuildMemberStore.getMembers(guild.id) ?? []) as any[];
    const holders: Holder[] = [];
    for (const m of members) {
        const own = (m.roles as string[]).map(id => roles[id]).filter(Boolean).sort((x, y) => y.position - x.position);
        const top = own[0]?.position ?? 0;
        // The role that gives it: one that ticks it, or else an Administrator role.
        const viaRole = own.find(x => (x.permissions & bit) === bit) ?? own.find(isAdmin) ?? null;
        const owner = m.userId === guild.ownerId;
        // People who only have it through @everyone are covered by the note at the top.
        if (!owner && !viaRole) continue;
        const via = owner ? "Server owner" : (viaRole!.permissions & bit) === bit ? viaRole!.name : `${viaRole!.name} (Administrator)`;
        const u: any = UserStore.getUser(m.userId);
        holders.push({
            id: m.userId,
            name: m.nick ?? u?.globalName ?? u?.username ?? m.userId,
            sub: u?.username ? `@${u.username}` : m.userId,
            avatar: u ? IconUtils.getUserAvatarURL(u, false, 64) : null,
            via, viaRole: owner ? null : viaRole, top: owner ? Infinity : top,
        });
    }
    holders.sort((a, b) => b.top - a.top || a.name.localeCompare(b.name));
    return { everyone, holders, loaded: members.length };
}

function WhoHasModal({ modalProps, guild, bit, title }: { modalProps: RenderModalProps; guild: Guild; bit: bigint; title: string; }) {
    const { everyone, holders, loaded } = useMemo(() => whoHas(guild, bit), [guild.id, bit]);
    const [find, setFind] = useState("");
    const q = find.trim().toLowerCase();
    const shown = q ? holders.filter(h => h.name.toLowerCase().includes(q) || h.sub.toLowerCase().includes(q) || h.via.toLowerCase().includes(q)) : holders;
    // Group by the role that gives it.
    const accent = windowAccent("permissionsViewer");
    const groups = new Map<string, Holder[]>();
    for (const h of shown.slice(0, MAX_SHOWN)) groups.set(h.via, [...(groups.get(h.via) ?? []), h]);

    return (
        <Window {...modalProps} size="lg" title={`Who can: ${title}`} subtitle={`In ${guild.name} · from the ${loaded.toLocaleString()} members Discord has loaded`}>
            <div className={classNameFactory("vc-tool-")("wrap")} style={{ paddingBottom: 12, display: "flex", flexDirection: "column", gap: 10, ...(accent ? { "--vc-tool-accent": accent } : {}) } as React.CSSProperties}>
                <ToolHero icon="🛡️" kicker={`Who can · ${guild.name}`} title={title}
                    sub={everyone ? "Everyone can — the @everyone role allows it." : `From the ${loaded.toLocaleString()} members Discord has loaded`}
                    numbers={[{ value: holders.length.toLocaleString(), label: holders.length === 1 ? "person" : "people" }, { value: groups.size, label: groups.size === 1 ? "role" : "roles" }]} />
                {everyone && <div className={cl("who-note")}>✓ <b>Everyone</b> can do this — the @everyone role allows it. Below are people who also get it from another role.</div>}
                <input className="vc-tool-input" value={find} onChange={e => setFind(e.currentTarget.value)} placeholder={`Find among ${holders.length.toLocaleString()} ${holders.length === 1 ? "person" : "people"}`} />
                {!holders.length && <div className="vc-tool-empty"><span className="vc-tool-empty-icon">🫥</span>Nobody Discord has loaded gets this from a role{everyone ? " (other than @everyone)" : ""}.</div>}
                {[...groups].map(([via, list]) => (
                    <section key={via} className="vc-tool-section">
                        <span className="vc-tool-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {list[0].viaRole && <i className={cl("who-dot")} style={{ background: roleFill(list[0].viaRole) }} />}
                            {via} · {list.length}
                        </span>
                        <div className="vc-tool-list">
                            {list.map(h => (
                                <div key={h.id} className="vc-tool-item" style={{ cursor: "pointer" }} onClick={() => openUserProfile(h.id)}>
                                    {h.avatar ? <img className={cl("who-avatar")} src={h.avatar} alt="" /> : <span className={cl("who-avatar")} />}
                                    <span className="vc-tool-item-main"><span className="vc-tool-item-title">{h.name}</span><span className="vc-tool-item-sub">{h.sub}</span></span>
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
                {shown.length > MAX_SHOWN && <span className="vc-tool-hint">Showing the first {MAX_SHOWN} — search to find others.</span>}
                <span className="vc-tool-hint">Only server-wide roles count here — a channel can still allow or block it for someone.</span>
            </div>
        </Window>
    );
}

export const openWhoHas = (guild: Guild, bit: bigint, title: string) =>
    openModal(props => <ErrorBoundary><WhoHasModal modalProps={props} guild={guild} bit={bit} title={title} /></ErrorBoundary>);
