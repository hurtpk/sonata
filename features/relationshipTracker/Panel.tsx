/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { classNameFactory } from "@utils/css";
import { openUserProfile } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, useEffect, useState } from "@webpack/common";

import { ToolHero } from "../_shared/ToolHero";
import { Window } from "../_shared/Window";
import { windowAccent } from "./accent";
import { avatarOf, byLabel, describe, friendshipDetails, nameOf } from "./describe";
import { clearLog, LogEntry, useLog } from "./tracker";

const cl = classNameFactory("vc-rtl-");

type Category = "all" | "friends" | "requests" | "groups" | "servers";
type Who = "any" | "you" | "them";

const CATEGORIES: { id: Category; label: string; }[] = [
    { id: "all", label: "All" },
    { id: "friends", label: "Friends" },
    { id: "requests", label: "Requests" },
    { id: "groups", label: "Group chats" },
    { id: "servers", label: "Servers" },
];

const WHO: { id: Who; label: string; }[] = [
    { id: "any", label: "Anyone" },
    { id: "you", label: "By you" },
    { id: "them", label: "By them" },
];

function categoryOf(e: LogEntry): Category {
    if (e.kind.startsWith("friend-")) return "friends";
    if (e.kind.startsWith("request-")) return "requests";
    if (e.kind.startsWith("group-")) return "groups";
    return "servers";
}

function dayLabel(t: number) {
    const d = new Date(t);
    const today = new Date();
    const yest = new Date(); yest.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yest.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

const timeOf = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function Avatar({ e }: { e: LogEntry; }) {
    const [broken, setBroken] = useState(false);
    const place = e.group ?? e.server;
    const src = e.user ? avatarOf(e.user) : place?.iconURL ?? undefined;
    const square = !e.user && !!e.server;
    if (src && !broken) return <img className={classes(cl("avatar"), square && cl("avatar-square"))} src={src} alt="" onError={() => setBroken(true)} />;
    const label = e.user ? nameOf(e.user) : place?.name ?? "?";
    return <div className={classes(cl("avatar"), cl("avatar-fallback"), square && cl("avatar-square"))}>{label.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase()}</div>;
}

function Row({ e }: { e: LogEntry; }) {
    const { text, tone } = describe(e);
    const clickable = !!e.user && e.user.username !== "unknown";
    const sub = [
        e.user && e.user.username !== "unknown" ? `@${e.user.username}` : null,
        (e.kind === "group-member-removed" || e.kind === "group-member-left") && e.group ? e.group.name : null,
        timeOf(e.t),
    ].filter(Boolean).join(" · ");

    return (
        <div
            className={classes(cl("row"), cl(`tone-${tone}`), clickable && cl("row-click"))}
            onClick={clickable ? () => openUserProfile(e.user!.id) : undefined}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={clickable ? ev => { if (ev.key === "Enter") openUserProfile(e.user!.id); } : undefined}
        >
            <Avatar e={e} />
            <div className={cl("row-text")}>
                <div className={cl("row-title")}>{text}</div>
                {friendshipDetails(e) && <div className={cl("row-friendship")}>{friendshipDetails(e)}</div>}
                <div className={cl("row-sub")}>
                    {sub}
                    {e.offline && <span className={cl("tag")}>While Discord was closed</span>}
                </div>
            </div>
            <span className={classes(cl("by"), cl(`by-${e.by}`))} title={e.by === "them" ? "Not done from this Discord app — if you did it on another device, it shows here too" : undefined}>
                {byLabel(e)}
            </span>
        </div>
    );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: string; }) {
    return (
        <div className={classes(cl("stat"), cl(`stat-${tone}`))}>
            <div className={cl("stat-value")}>{value}</div>
            <div className={cl("stat-label")}>{label}</div>
        </div>
    );
}

function LogModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const log = useLog();
    const accent = windowAccent("relationshipTracker");
    const [category, setCategory] = useState<Category>("all");
    const [who, setWho] = useState<Who>("any");
    const [query, setQuery] = useState("");
    const [confirmClear, setConfirmClear] = useState(false);

    useEffect(() => {
        if (!confirmClear) return;
        const t = setTimeout(() => setConfirmClear(false), 3000);
        return () => clearTimeout(t);
    }, [confirmClear]);

    const q = query.trim().toLowerCase();
    const shown = log.filter(e => {
        if (category !== "all" && categoryOf(e) !== category) return false;
        if (who !== "any" && e.by !== who) return false;
        if (q) {
            const hay = `${describe(e).text} ${e.user?.username ?? ""} ${e.group?.name ?? ""} ${e.server?.name ?? ""}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    const stats = {
        removedYou: log.filter(e => e.kind === "friend-removed" && e.by === "them").length,
        youRemoved: log.filter(e => e.kind === "friend-removed" && e.by === "you").length,
        newFriends: log.filter(e => e.kind === "friend-added").length,
        requests: log.filter(e => e.kind === "request-received").length,
    };

    // Group rows under day headings.
    const days: { label: string; items: LogEntry[]; }[] = [];
    for (const e of shown) {
        const label = dayLabel(e.t);
        if (days.at(-1)?.label === label) days.at(-1)!.items.push(e);
        else days.push({ label, items: [e] });
    }

    const builtinOn = isPluginEnabled("RelationshipNotifier");
    const latest = log[0];
    const weekCount = log.filter(e => e.t > Date.now() - 7 * 86_400_000).length;

    return (
        <Window {...modalProps} size="lg" title="Relationship Log" subtitle={`${log.length} ${log.length === 1 ? "event" : "events"} logged`}>
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <div className={cl("content")}>
                    <ToolHero icon={latest ? (latest.user ? <Avatar e={latest} /> : "💞") : "💞"} kicker={latest ? `Latest · ${dayLabel(latest.t)}, ${timeOf(latest.t)}` : "Relationship Log"}
                        title={latest ? describe(latest).text : "Nothing logged yet"}
                        sub={latest ? (friendshipDetails(latest) || byLabel(latest)) : "Friend changes, requests and group chat or server removals show up here as they happen."}
                        numbers={[{ value: weekCount, label: "this week" }, { value: log.length, label: "all time" }]} />
                    {builtinOn && (
                        <div className={cl("warning")}>
                            The built-in Relationship Notifier is also on, so you may get two notifications for the same thing. You can switch it off — this plugin covers everything it did.
                        </div>
                    )}

                    <div className={cl("stats")}>
                        <Stat value={stats.removedYou} label="Removed you" tone="bad" />
                        <Stat value={stats.youRemoved} label="You removed" tone="neutral" />
                        <Stat value={stats.newFriends} label="New friends" tone="good" />
                        <Stat value={stats.requests} label="Requests received" tone="info" />
                    </div>

                    <div className={cl("controls")}>
                        <div className={cl("chips")} role="tablist" aria-label="Category">
                            {CATEGORIES.map(c => (
                                <button key={c.id} type="button" role="tab" aria-selected={category === c.id}
                                    className={classes(cl("chip"), category === c.id && cl("chip-active"))}
                                    onClick={() => setCategory(c.id)}>
                                    {c.label}
                                </button>
                            ))}
                        </div>
                        <div className={cl("controls-row")}>
                            <div className={cl("segmented")} role="radiogroup" aria-label="Who did it">
                                {WHO.map(w => (
                                    <button key={w.id} type="button" role="radio" aria-checked={who === w.id}
                                        className={classes(cl("segment"), who === w.id && cl("segment-active"))}
                                        onClick={() => setWho(w.id)}>
                                        {w.label}
                                    </button>
                                ))}
                            </div>
                            <input className={cl("search")} value={query} placeholder="Search names, groups, servers"
                                onChange={e => setQuery(e.currentTarget.value)} aria-label="Search" />
                        </div>
                    </div>

                    <div className={cl("list")}>
                        {days.length === 0 ? (
                            <div className={cl("empty")}>
                                <span className={cl("empty-icon")}>{log.length === 0 ? "💞" : "🔍"}</span>
                                {log.length === 0
                                    ? "Nothing logged yet. Friend changes, requests and group chat or server removals will show up here as they happen."
                                    : "Nothing matches these filters."}
                            </div>
                        ) : days.map(d => (
                            <div key={d.label} className={cl("day")}>
                                <div className={cl("day-label")}>{d.label}</div>
                                {d.items.map(e => <Row key={e.id} e={e} />)}
                            </div>
                        ))}
                    </div>

                    <div className={cl("footer")}>
                        <span className={cl("footnote")}>
                            “By them” means it wasn't done from this Discord app — if you do it on your phone, it shows up here the same way.
                        </span>
                        {log.length > 0 && (
                            <button type="button" className={classes(cl("clear"), confirmClear && cl("clear-confirm"))}
                                onClick={() => { if (confirmClear) { clearLog(); setConfirmClear(false); } else setConfirmClear(true); }}>
                                {confirmClear ? "Click again to clear" : "Clear log"}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </Window>
    );
}

export function openLog() {
    openModal(props => <LogModal modalProps={props} />);
}
