/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// "Send to" picker: search your DMs, group DMs and this server's channels,
// or paste any user ID / channel ID. Every entry shows its picture — the
// person's avatar for DMs, the group's icon, or the server's icon.

import { classNameFactory } from "@utils/css";
import { openPrivateChannel } from "@utils/discord";
import { classes } from "@utils/misc";
import { ChannelStore, GuildChannelStore, GuildStore, IconUtils, PrivateChannelSortStore, useEffect, useMemo, useRef, UserStore, UserUtils, useState } from "@webpack/common";

const cl = classNameFactory("vc-schedmsg-");
const SNOWFLAKE = /^\d{17,20}$/;

export interface Target {
    /** Channel ID — or, for kind "user", a user ID without a DM yet. */
    id: string;
    kind: "dm" | "group" | "channel" | "user";
    label: string;
    sub: string;
    icon?: string;
    /** Rounded-square (servers) instead of a circle. */
    square?: boolean;
    /** Text for the initials when there's no picture (e.g. the server's name). */
    fallback?: string;
}

// Users looked up by pasted ID may not be in Discord's user cache yet;
// remember them so the new DM shows their name and avatar straight away.
const lookedUp = new Map<string, any>();
const getUser = (id: string) => UserStore.getUser(id) ?? lookedUp.get(id);

function userLabel(user: any) {
    return user?.globalName ?? user?.username ?? "Unknown user";
}

function userIcon(user: any, id: string) {
    try {
        return user ? IconUtils.getUserAvatarURL(user, false, 48) : IconUtils.getDefaultAvatarURL(id);
    } catch {
        return undefined;
    }
}

/** Describe a channel ID for display: name, detail line and picture. */
export function targetForChannel(channelId: string): Target | null {
    const ch = ChannelStore.getChannel(channelId) as any;
    if (!ch) return null;

    if (ch.isDM()) {
        const userId = ch.recipients?.[0];
        const user = getUser(userId);
        return { id: ch.id, kind: "dm", label: userLabel(user), sub: user?.username ? `@${user.username} · DM` : "Direct message", icon: userIcon(user, userId) };
    }

    if (ch.isGroupDM()) {
        const names = (ch.recipients ?? []).map((u: string) => userLabel(getUser(u)));
        let icon: string | undefined;
        try { icon = IconUtils.getChannelIconURL({ id: ch.id, icon: ch.icon, size: 48 }); } catch { }
        if (!icon && ch.recipients?.[0]) icon = userIcon(getUser(ch.recipients[0]), ch.recipients[0]);
        return { id: ch.id, kind: "group", label: ch.name || names.join(", ") || "Group DM", sub: `Group DM · ${names.length + 1} members`, icon };
    }

    const guild = ch.guild_id ? GuildStore.getGuild(ch.guild_id) as any : null;
    let icon: string | undefined;
    try { icon = guild?.icon ? IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 48 }) : undefined; } catch { }
    return { id: ch.id, kind: "channel", label: `#${ch.name}`, sub: guild?.name ?? "Server channel", icon, square: true, fallback: guild?.name };
}

function targetForUser(user: any): Target {
    return { id: user.id, kind: "user", label: userLabel(user), sub: `@${user.username} · will message them directly`, icon: userIcon(user, user.id) };
}

export function TargetAvatar({ target, size = 28 }: { target: Pick<Target, "icon" | "label" | "square" | "fallback">; size?: number; }) {
    const [broken, setBroken] = useState(false);
    const style = { width: size, height: size, borderRadius: target.square ? Math.round(size * 0.3) : "50%" };
    if (target.icon && !broken) {
        return <img className={cl("avatar")} style={style} src={target.icon} alt="" onError={() => setBroken(true)} />;
    }
    const letters = (target.fallback ?? target.label).replace(/^[#@]/, "").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
    return <div className={cl("avatar-fallback")} style={{ ...style, fontSize: Math.round(size * 0.38) }}>{letters || "?"}</div>;
}

/** Small "avatar + name" used in the queue list. */
export function TargetChip({ channelId }: { channelId: string; }) {
    const t = targetForChannel(channelId);
    if (!t) return <span className={cl("item-channel")}>Unknown channel</span>;
    return (
        <span className={cl("target-chip")}>
            <TargetAvatar target={t} size={20} />
            <span className={cl("item-channel")}>{t.label}</span>
            {t.kind === "channel" && <span className={cl("target-chip-sub")}>{t.sub}</span>}
        </span>
    );
}

function useBaseOptions(currentId: string | undefined, selectedId: string) {
    return useMemo(() => {
        const ids: string[] = [];
        const push = (id?: string | null) => { if (id && !ids.includes(id) && ChannelStore.getChannel(id)) ids.push(id); };
        push(currentId);
        push(selectedId);
        for (const id of PrivateChannelSortStore.getPrivateChannelIds?.() ?? []) push(id);
        const guildId = currentId ? ChannelStore.getChannel(currentId)?.guild_id : null;
        if (guildId) for (const entry of (GuildChannelStore.getChannels(guildId)?.SELECTABLE ?? []) as any[]) push(entry?.channel?.id);
        return ids.map(targetForChannel).filter(Boolean) as Target[];
    }, [currentId, selectedId]);
}

export function TargetPicker({ value, currentChannelId, onChange }: {
    value: string;
    currentChannelId?: string;
    onChange(channelId: string): void;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const [lookup, setLookup] = useState<{ id: string; state: "loading" | "none" | Target; } | null>(null);
    const [opening, setOpening] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const root = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLInputElement>(null);

    const base = useBaseOptions(currentChannelId, value);
    const selected = value ? targetForChannel(value) : null;
    const q = query.trim();
    const isId = SNOWFLAKE.test(q);

    // Pasted ID: a channel we know, a cached user, or look the user up.
    useEffect(() => {
        if (!isId) { setLookup(null); return; }
        const channel = targetForChannel(q);
        if (channel) { setLookup({ id: q, state: channel }); return; }
        const cached = UserStore.getUser(q);
        if (cached) { setLookup({ id: q, state: targetForUser(cached) }); return; }
        let cancelled = false;
        setLookup({ id: q, state: "loading" });
        Promise.resolve(UserUtils.getUser(q))
            .then((user: any) => {
                if (user) lookedUp.set(q, user);
                if (!cancelled) setLookup({ id: q, state: user ? targetForUser(user) : "none" });
            })
            .catch(() => { if (!cancelled) setLookup({ id: q, state: "none" }); });
        return () => { cancelled = true; };
    }, [q, isId]);

    const options: Target[] = isId
        ? (lookup && typeof lookup.state === "object" ? [lookup.state] : [])
        : base.filter(t => !q || `${t.label} ${t.sub}`.toLowerCase().includes(q.toLowerCase()));

    useEffect(() => setActive(0), [q]);

    // Close when clicking anywhere else.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
        document.addEventListener("mousedown", onDown, true);
        return () => document.removeEventListener("mousedown", onDown, true);
    }, [open]);

    const choose = async (t: Target) => {
        setError(null);
        if (t.kind !== "user") {
            onChange(t.id);
            setOpen(false);
            setQuery("");
            return;
        }
        // A person: use your DM with them, opening one quietly if needed.
        const existing = ChannelStore.getDMFromUserId(t.id);
        if (existing) {
            onChange(existing);
        } else {
            setOpening(true);
            try {
                const result: any = await openPrivateChannel(t.id, false);
                const id = (typeof result === "string" ? result : result?.id) ?? ChannelStore.getDMFromUserId(t.id);
                if (!id) throw new Error("no channel");
                onChange(id);
            } catch {
                setError("Couldn't open a DM with that person (they may not accept DMs from you).");
                setOpening(false);
                return;
            }
            setOpening(false);
        }
        setOpen(false);
        setQuery("");
    };

    const onKey = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, options.length - 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
        else if (e.key === "Enter") { e.preventDefault(); if (options[active]) choose(options[active]); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    };

    return (
        <div className={cl("picker")} ref={root}>
            {!open ? (
                <button
                    type="button"
                    className={cl("picker-field")}
                    onClick={() => { setOpen(true); setTimeout(() => input.current?.focus(), 0); }}
                >
                    {selected ? (
                        <>
                            <TargetAvatar target={selected} />
                            <span className={cl("picker-text")}>
                                <span className={cl("picker-label")}>{selected.label}</span>
                                <span className={cl("picker-sub")}>{selected.id === currentChannelId ? `${selected.sub} · current` : selected.sub}</span>
                            </span>
                        </>
                    ) : (
                        <span className={cl("picker-placeholder")}>Choose a person, group or channel</span>
                    )}
                    <span className={cl("picker-chevron")} aria-hidden>▾</span>
                </button>
            ) : (
                <div className={classes(cl("picker-field"), cl("picker-field-open"))}>
                    <input
                        ref={input}
                        className={cl("picker-input")}
                        value={query}
                        placeholder="Search, or paste a user or channel ID"
                        onChange={e => setQuery(e.currentTarget.value)}
                        onKeyDown={onKey}
                        aria-label="Search or paste an ID"
                    />
                </div>
            )}

            {open && (
                <div className={cl("picker-menu")} role="listbox">
                    {opening && <div className={cl("picker-note")}>Opening DM…</div>}
                    {!opening && isId && lookup?.state === "loading" && <div className={cl("picker-note")}>Looking up that ID…</div>}
                    {!opening && isId && lookup?.state === "none" && <div className={cl("picker-note")}>No user or channel found with that ID.</div>}
                    {!opening && !isId && options.length === 0 && <div className={cl("picker-note")}>No matches. You can also paste a user or channel ID.</div>}
                    {!opening && options.map((t, i) => (
                        <div
                            key={`${t.kind}-${t.id}`}
                            role="option"
                            aria-selected={t.id === value}
                            className={classes(cl("picker-option"), i === active && cl("picker-option-active"), t.id === value && cl("picker-option-selected"))}
                            onMouseEnter={() => setActive(i)}
                            onMouseDown={e => { e.preventDefault(); choose(t); }}
                        >
                            <TargetAvatar target={t} />
                            <span className={cl("picker-text")}>
                                <span className={cl("picker-label")}>{t.label}</span>
                                <span className={cl("picker-sub")}>{t.sub}</span>
                            </span>
                            {t.id === currentChannelId && <span className={cl("picker-tag")}>Current</span>}
                            {t.id === value && <span className={cl("picker-check")}>✓</span>}
                        </div>
                    ))}
                </div>
            )}

            {error && <div className={cl("picker-error")}>{error}</div>}
        </div>
    );
}
