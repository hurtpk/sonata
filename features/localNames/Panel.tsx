/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, GuildRoleStore, GuildStore, openModal, useRef, useState } from "@webpack/common";

import { openSection } from "../_shared/Hub";
import { Window } from "../_shared/Window";
import { FormGroup, FormRow } from "../_shared/WindowParts";
import { iconFrom, Kind, setLocalIcon, setLocalName, setLocalRole, useNames } from "./store";

/** The real name, even while the local one is showing. */
export type RealName = (kind: Kind, id: string) => string;

const what = (kind: Kind, id: string) => {
    if (kind === "guild") return "server";
    const c: any = ChannelStore.getChannel(id);
    return c?.type === 3 ? "group chat" : c?.isThread?.() ? "thread" : "channel";
};

function RenameWindow({ modalProps, kind, id, real }: { modalProps: RenderModalProps; kind: Kind; id: string; real: RealName; }) {
    const names = useNames();
    const original = real(kind, id);
    const [text, setText] = useState(names[kind][id] ?? "");
    const save = () => { setLocalName(kind, id, text); modalProps.onClose(); };
    return (
        <Window {...modalProps} size="sm" title="Local Names" subtitle="Only you see the new name"
            actions={[
                ...(names[kind][id] ? [{ text: "Use the real name", variant: "secondary", onClick: () => { setLocalName(kind, id, null); modalProps.onClose(); } }] : []),
                { text: "Save", variant: "primary", onClick: save },
            ]}
            status={["only you see the new name"]}>
            <FormGroup>
                <FormRow label={`Rename this ${what(kind, id)}`} help={original ? `Its real name: ${original}` : undefined} stack>
                    <input className="vc-tool-input" autoFocus value={text} maxLength={100} placeholder={original || "A name just for you"} aria-label="New name"
                        onChange={e => setText(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") save(); }} />
                </FormRow>
            </FormGroup>
        </Window>
    );
}

export const openRename = (kind: Kind, id: string, real: RealName) => openModal(props => <RenameWindow modalProps={props} kind={kind} id={id} real={real} />);

/* ── A server's icon, just for you ── */

function IconTab({ guildId }: { guildId: string; }) {
    const names = useNames();
    const guild: any = GuildStore.getGuild(guildId);
    const mine = names.icon[guildId];
    const [picked, setPicked] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const input = useRef<HTMLInputElement>(null);
    const shown = picked ?? mine;
    const pick = async (f?: File | null) => {
        if (!f) return;
        setError(null);
        try { setPicked(await iconFrom(f)); } catch { setError("That picture couldn't be opened. Try a PNG, JPG, GIF or WebP."); }
    };
    return (
            <FormGroup>
                <div className="vc-localnames-icon"
                    onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void pick(e.dataTransfer.files[0]); }}>
                    <div className="vc-localnames-icon-pic">
                        {shown ? <img src={shown} alt="" /> : <span>{(guild?.name ?? "?").split(/\s+/).map((w: string) => w[0]).join("").slice(0, 3)}</span>}
                    </div>
                    <div className="vc-localnames-icon-text">
                        <b>{guild?.name ?? "This server"}</b>
                        <span>Pick a picture, or drop one here. It's cropped to a square and kept small.</span>
                        <button type="button" className="vc-tool-btn" onClick={() => input.current?.click()}>{shown ? "Pick a different picture" : "Pick a picture"}</button>
                        {error && <span className="vc-localnames-error">{error}</span>}
                    </div>
                    <input ref={input} type="file" accept="image/*" hidden onChange={e => { void pick(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
                </div>
                <div className="vc-localnames-buttons">
                    {mine && <button type="button" className="vc-tool-btn" onClick={() => { setLocalIcon(guildId, null); setPicked(null); }}>Use the real icon</button>}
                    <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!picked} onClick={() => { if (picked) { setLocalIcon(guildId, picked); setPicked(null); } }}>{picked ? "Save this icon" : mine ? "Saved" : "Save"}</button>
                </div>
            </FormGroup>
    );
}

/* ── A server's roles, renamed just for you ── */

const roleColour = (r: any) => r?.colorString ?? (r?.color ? `#${r.color.toString(16).padStart(6, "0")}` : "var(--sw-muted)");

function RolesTab({ guildId, realRole }: { guildId: string; realRole(role: any): string; }) {
    const names = useNames();
    const [query, setQuery] = useState("");
    const roles: any[] = (GuildRoleStore.getSortedRoles(guildId) ?? []).filter((r: any) => r.id !== guildId);
    const q = query.trim().toLowerCase();
    const shown = roles.filter(r => !q || realRole(r).toLowerCase().includes(q) || names.role[r.id]?.toLowerCase().includes(q));
    const count = roles.filter(r => names.role[r.id]).length;
    return (
            <div className="vc-tool-wrap">
                {roles.length > 0 && (
                    <div className="vc-localnames-roles-head">
                        <input className="vc-tool-input" value={query} placeholder={`Search ${roles.length} roles`} aria-label="Search roles" onChange={e => setQuery(e.currentTarget.value)} />
                        <span className="vc-tool-hint">{count ? `${count} renamed` : "None renamed yet"}</span>
                    </div>
                )}
                {!roles.length ? <div className="vc-tool-empty"><span className="vc-tool-empty-icon">🎭</span>This server's roles haven't loaded yet. Open the server once, then try again.</div> : (
                    <FormGroup>
                        {shown.map(r => (
                            <FormRow key={r.id} label={<span className="vc-localnames-role"><i style={{ background: roleColour(r) }} />{realRole(r)}</span>}>
                                <RoleInput guildId={guildId} roleId={r.id} value={names.role[r.id]} placeholder={realRole(r)} />
                            </FormRow>
                        ))}
                        {!shown.length && <div className="vc-tool-empty">No roles match “{query.trim()}”.</div>}
                    </FormGroup>
                )}
            </div>
    );
}

/** One role's name box: saved when you leave it or press Enter. */
function RoleInput({ guildId, roleId, value, placeholder }: { guildId: string; roleId: string; value?: string; placeholder: string; }) {
    const [text, setText] = useState(value ?? "");
    const save = () => { if ((value ?? "") !== text.trim()) setLocalRole(guildId, roleId, text); };
    return <input className="vc-tool-input vc-localnames-role-input" value={text} maxLength={100} placeholder={placeholder} aria-label={`Your name for ${placeholder}`}
        onChange={e => setText(e.currentTarget.value)} onBlur={save} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />;
}

/* ── A server, just for you: its name, icon and role names in one window ── */

type ServerTab = "name" | "icon" | "roles";

function NameTab({ guildId, real }: { guildId: string; real: RealName; }) {
    const names = useNames();
    const original = real("guild", guildId);
    const [text, setText] = useState(names.guild[guildId] ?? "");
    const saved = (names.guild[guildId] ?? "") === text.trim();
    return (
        <FormGroup>
            <FormRow label="Rename this server" help={original ? `Its real name: ${original}` : undefined} stack>
                <input className="vc-tool-input" autoFocus value={text} maxLength={100} placeholder={original || "A name just for you"} aria-label="New name"
                    onChange={e => setText(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") setLocalName("guild", guildId, text); }} />
            </FormRow>
            <div className="vc-localnames-buttons">
                {names.guild[guildId] && <button type="button" className="vc-tool-btn" onClick={() => { setLocalName("guild", guildId, null); setText(""); }}>Use the real name</button>}
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={saved} onClick={() => setLocalName("guild", guildId, text)}>{saved && text.trim() ? "Saved" : "Save"}</button>
            </div>
        </FormGroup>
    );
}

function ServerWindow({ modalProps, guildId, real, realRole, start }: { modalProps: RenderModalProps; guildId: string; real: RealName; realRole(role: any): string; start: ServerTab; }) {
    const names = useNames();
    const [tab, setTab] = useState<ServerTab>(start);
    const roles = Object.keys(names.role).filter(id => names.roleGuild?.[id] === guildId).length;
    const done = [names.guild[guildId] && "renamed", names.icon[guildId] && "new icon", roles && `${roles} role${roles === 1 ? "" : "s"} renamed`].filter(Boolean) as string[];
    return (
        <Window {...modalProps} size="md" title="Just for me" subtitle={real("guild", guildId) || "This server"}
            tabs={[["name", "Name"], ["icon", "Icon"], ["roles", "Roles"]]} tab={tab} onTab={id => setTab(id as ServerTab)}
            status={[done.length ? done.join(" · ") : "nothing changed yet", "only you see these"]}>
            {tab === "name" && <NameTab guildId={guildId} real={real} />}
            {tab === "icon" && <IconTab guildId={guildId} />}
            {tab === "roles" && <RolesTab guildId={guildId} realRole={realRole} />}
        </Window>
    );
}

/** A server's name, icon and role names, just for you — one window, on a tab. */
export const openServer = (guildId: string, real: RealName, realRole: (role: any) => string, tab: ServerTab = "name") =>
    openModal(props => <ServerWindow modalProps={props} guildId={guildId} real={real} realRole={realRole} start={tab} />);

function AllNamesWindow({ modalProps, real, realRole }: { modalProps: RenderModalProps; real: RealName; realRole(role: any): string; }) {
    const names = useNames();
    const rows = (kind: Kind) => Object.entries(names[kind]);
    const icons = Object.keys(names.icon);
    // Renamed roles, grouped by their server.
    const roleServers = [...new Set(Object.values(names.roleGuild))];
    const count = rows("guild").length + rows("channel").length + Object.keys(names.role).length + icons.length;
    const where = (kind: Kind, id: string) => {
        if (kind === "guild") return "Server";
        const c: any = ChannelStore.getChannel(id);
        if (c?.type === 3) return "Group chat";
        const g = c?.guild_id ? GuildStore.getGuild(c.guild_id) : null;
        return g ? `Channel in ${g.name}` : "Channel";
    };
    const list = (kind: Kind) => rows(kind).map(([id, name]) => (
        <FormRow key={id} label={name} help={`${where(kind, id)} · real name: ${real(kind, id) || "unknown (not loaded)"}`}>
            <button type="button" className="vc-tool-btn" onClick={() => kind === "guild" ? openServer(id, real, realRole, "name") : openRename(kind, id, real)}>Rename</button>
            <button type="button" className="vc-tool-btn" onClick={() => setLocalName(kind, id, null)}>Use the real name</button>
        </FormRow>
    ));
    return (
        <Window {...modalProps} size="md" title="Local Names" subtitle="Servers, channels, group chats and roles you renamed, and server icons you changed, just for you"
            status={[`${count} changed`, "only you see them"]}>
            <div className="vc-tool-wrap">
                {count === 0 ? (
                    <div className="vc-tool-empty">
                        <span className="vc-tool-empty-icon">🏷️</span>
                        Nothing changed yet. Right-click a server, channel or group chat and pick "Rename just for me", "Change icon just for me" or "Rename roles just for me".
                    </div>
                ) : <>
                    {rows("guild").length > 0 && <FormGroup title="Servers">{list("guild")}</FormGroup>}
                    {rows("channel").length > 0 && <FormGroup title="Channels and group chats">{list("channel")}</FormGroup>}
                    {icons.length > 0 && (
                        <FormGroup title="Server icons">
                            {icons.map(id => (
                                <FormRow key={id} label={<span className="vc-localnames-role"><img className="vc-localnames-mini" src={names.icon[id]} alt="" />{real("guild", id) || "Server (not loaded)"}</span>}>
                                    <button type="button" className="vc-tool-btn" onClick={() => openServer(id, real, realRole, "icon")}>Change</button>
                                    <button type="button" className="vc-tool-btn" onClick={() => setLocalIcon(id, null)}>Use the real icon</button>
                                </FormRow>
                            ))}
                        </FormGroup>
                    )}
                    {roleServers.map(g => (
                        <FormGroup key={g} title={`Roles in ${real("guild", g) || "a server"}`}>
                            {Object.keys(names.role).filter(id => names.roleGuild[id] === g).map(id => {
                                const role: any = GuildRoleStore.getRole(g, id);
                                return (
                                    <FormRow key={id} label={<span className="vc-localnames-role"><i style={{ background: roleColour(role) }} />{names.role[id]}</span>} help={`real name: ${role ? realRole(role) : "unknown (not loaded)"}`}>
                                        <button type="button" className="vc-tool-btn" onClick={() => openServer(g, real, realRole, "roles")}>Rename</button>
                                        <button type="button" className="vc-tool-btn" onClick={() => setLocalRole(g, id, null)}>Use the real name</button>
                                    </FormRow>
                                );
                            })}
                        </FormGroup>
                    ))}
                </>}
            </div>
        </Window>
    );
}

export const openAllNames = (real: RealName, realRole: (role: any) => string) => openSection("serverTools", "localNames", props => renderAllNames(props, real, realRole));

export function renderAllNames(props: RenderModalProps, ...[real, realRole]: Parameters<typeof openAllNames>) { return (<AllNamesWindow modalProps={props} real={real} realRole={realRole} />); }
