/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { copyWithToast, openUserProfile } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, Clickable, ContextMenuApi, GuildMemberStore, GuildStore, Menu, useEffect, UserStore, useState } from "@webpack/common";

import { openSection } from "../_shared/Hub";
import { ToolHero } from "../_shared/ToolHero";
import { Window } from "../_shared/Window";
import { windowAccent } from "./accent";
import { RecapView } from "./RecapView";
import { getCurrent, getPast, Session, useTimeline, VtEvent } from "./tracker";

const cl = classNameFactory("vc-vtl-");

// ─── Helpers ───

export function channelName(id: string | null | undefined) {
    if (!id) return "a voice channel";
    const ch = ChannelStore.getChannel(id);
    if (!ch) return "a voice channel";
    if (ch.isDM() || ch.isGroupDM()) return "a call";
    const guild = ch.guild_id ? GuildStore.getGuild(ch.guild_id) : null;
    return `${ch.name}${guild ? ` · ${guild.name}` : ""}`;
}

function guildOf(channelId: string) {
    return ChannelStore.getChannel(channelId)?.guild_id ?? null;
}

export function displayName(userId: string, guildId: string | null) {
    const user = UserStore.getUser(userId);
    const nick = guildId ? GuildMemberStore.getNick(guildId, userId) : null;
    return nick ?? user?.globalName ?? user?.username ?? "Unknown user";
}

export function avatar(userId: string, guildId: string | null) {
    const user = UserStore.getUser(userId) as any;
    return user?.getAvatarURL?.(guildId ?? undefined, 40) ?? "";
}

function duration(ms: number) {
    let s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60); s %= 60;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
}

/** For "here before you": a lower bound, so whole minutes read better. */
function atLeast(ms: number) {
    const m = Math.floor(ms / 60000);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
const shortClock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function useNow() {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);
    return now;
}

// ─── Pieces ───

interface Row { userId: string; joinedAt: number | null; leftAt: number | null; }

export function personActions(userId: string) {
    return {
        onClick: () => void openUserProfile(userId),
        onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
            event.preventDefault();
            event.stopPropagation();
            ContextMenuApi.openContextMenu(event, () => (
                <Menu.Menu navId="sonata-voice-timeline-user" aria-label="Voice Timeline user" onClose={ContextMenuApi.closeContextMenu}>
                    <Menu.MenuItem id="copy-user-id" label="Copy User ID" action={() => copyWithToast(userId, "User ID copied")} />
                </Menu.Menu>
            ));
        }
    };
}

/** Everyone who was in the session: still here (live) first, then those who left. */
function rowsFor(s: Session): Row[] {
    const here = [...s.present.values()].map(p => ({ userId: p.userId, joinedAt: p.joinedAt, leftAt: null as number | null }));
    const gone = [...s.stays].reverse().map(st => ({ userId: st.userId, joinedAt: st.joinedAt, leftAt: st.leftAt as number | null }));
    // Someone who left and came back appears in both; keep their live row.
    const live = new Set(here.map(r => r.userId));
    return [...here, ...gone.filter(r => !live.has(r.userId))];
}

function PersonRow({ row, s, now }: { row: Row; s: Session; now: number; }) {
    const guildId = guildOf(s.channelId);
    const end = row.leftAt ?? s.endedAt ?? now;
    const start = row.joinedAt ?? s.startedAt;
    const before = row.joinedAt == null;
    const live = row.leftAt == null && s.endedAt == null;

    return (
        <Clickable className={classes(cl("person"), cl("user-action"), !live && cl("person-gone"))} {...personActions(row.userId)} aria-label={`Open profile for ${displayName(row.userId, guildId)}`}>
            <img className={cl("avatar")} src={avatar(row.userId, guildId)} alt="" />
            <div className={cl("person-text")}>
                <div className={cl("person-name")}>{displayName(row.userId, guildId)}</div>
                <div className={cl("person-sub")}>
                    {before
                        ? `Here before ${s.joinedMidway ? "tracking started" : "you"}`
                        : `Joined ${shortClock(row.joinedAt!)}`}
                    {row.leftAt != null && ` · left ${shortClock(row.leftAt)}`}
                </div>
            </div>
            <div className={classes(cl("time"), live && cl("time-live"))}>
                {before ? `${atLeast(end - start)}+` : duration(end - start)}
            </div>
        </Clickable>
    );
}

function eventText(e: VtEvent, s: Session) {
    const guildId = guildOf(s.channelId);
    const who = displayName(e.userId, guildId);
    switch (e.type) {
        case "you-joined": return s.joinedMidway && e.t === s.startedAt ? "Tracking started" : "You joined";
        case "you-left": return "You left";
        case "join": return `${who} joined`;
        case "leave": return `${who} left`;
        case "moved": return `${who} moved to ${channelName(e.to)}`;
    }
}

function TimelineEvent({ e, s }: { e: VtEvent; s: Session; }) {
    const guildId = guildOf(s.channelId);
    const mine = e.type === "you-joined" || e.type === "you-left";
    return (
        <Clickable className={classes(cl("event"), cl("user-action"), cl(`event-${e.type}`))} {...personActions(e.userId)} aria-label={`Open profile for ${displayName(e.userId, guildId)}`}>
            <span className={cl("event-time")}>{clock(e.t)}</span>
            <span className={cl("event-dot")} />
            {!mine && <img className={cl("event-avatar")} src={avatar(e.userId, guildId)} alt="" />}
            <span className={cl("event-text")}>{eventText(e, s)}</span>
        </Clickable>
    );
}

// ─── Window ───

function TimelineModal({ modalProps }: { modalProps: RenderModalProps; }) {
    useTimeline();
    const now = useNow();
    const accent = windowAccent("voiceTimeline");

    const current = getCurrent();
    const sessions = [...(current ? [current] : []), ...getPast()];
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [view, setView] = useState<"calls" | "week">("calls");
    const s = sessions.find(x => x.id === selectedId) ?? sessions[0];

    const subtitle = current
        ? `${channelName(current.channelId)} · ${duration(now - current.startedAt)}`
        : "Not in a voice channel";

    return (
        <Window {...modalProps} size="lg" title="Voice Timeline" subtitle={subtitle}>
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <div className="vc-tool-seg" role="tablist">
                    <button type="button" role="tab" aria-selected={view === "calls"} className={classes("vc-tool-seg-btn", view === "calls" && "vc-tool-seg-on")} onClick={() => setView("calls")}>🎙️ Calls</button>
                    <button type="button" role="tab" aria-selected={view === "week"} className={classes("vc-tool-seg-btn", view === "week" && "vc-tool-seg-on")} onClick={() => setView("week")}>📊 This week</button>
                </div>
                {view === "week" ? <RecapView /> : <>
                {s && (
                    <ToolHero icon="🎙️" kicker={s.endedAt == null ? "Live now" : `${shortClock(s.startedAt)}–${shortClock(s.endedAt)}`}
                        title={channelName(s.channelId)}
                        sub={s.endedAt == null ? `You've been here ${duration(now - s.startedAt)}` : `Lasted ${duration(s.endedAt - s.startedAt)}`}
                        numbers={[{ value: s.endedAt == null ? s.present.size : rowsFor(s).length, label: s.endedAt == null ? "here now" : "people" }, { value: sessions.length, label: sessions.length === 1 ? "call" : "calls" }]} />
                )}
                {!s ? (
                    <div className={cl("empty")}>
                        <span className="vc-tool-empty-icon">🎙️</span>
                        <div className={cl("empty-title")}>No calls yet</div>
                        Join a voice channel and this fills in live: who joins, who leaves, and how long everyone stays.
                    </div>
                ) : (
                    <div className={cl("content")}>
                        {sessions.length > 1 && (
                            <div className={cl("sessions")} role="tablist" aria-label="Sessions">
                                {sessions.map(x => (
                                    <button
                                        key={x.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={x.id === s.id}
                                        className={classes(cl("session"), x.id === s.id && cl("session-active"))}
                                        onClick={() => setSelectedId(x.id)}
                                    >
                                        {x.endedAt == null && <span className={cl("live-dot")} />}
                                        {x.endedAt == null ? "Now" : `${shortClock(x.startedAt)}–${shortClock(x.endedAt)}`}
                                        <span className={cl("session-name")}>{channelName(x.channelId).split(" · ")[0]}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className={cl("columns")}>
                            <section className={cl("card")}>
                                <div className={cl("card-title")}>
                                    {s.endedAt == null ? "In the channel" : "Who was there"}
                                    <span className={cl("count")}>{s.endedAt == null ? `${s.present.size} here` : rowsFor(s).length}</span>
                                </div>
                                <div className={cl("people")}>
                                    {rowsFor(s).length
                                        ? rowsFor(s).map(r => <PersonRow key={`${r.userId}-${r.leftAt ?? "live"}`} row={r} s={s} now={now} />)
                                        : <div className={cl("hint")}>Just you so far.</div>}
                                </div>
                            </section>

                            <section className={cl("card")}>
                                <div className={cl("card-title")}>
                                    Timeline
                                    <span className={cl("count")}>{s.events.length}</span>
                                </div>
                                <div className={cl("events")}>
                                    {[...s.events].reverse().map((e, i) => <TimelineEvent key={`${e.t}-${i}`} e={e} s={s} />)}
                                </div>
                            </section>
                        </div>
                    </div>
                )}
                </>}
            </div>
        </Window>
    );
}

export function openTimeline() { openSection("voiceCalls", "voiceTimeline", props => renderTimeline(props)); }

export function renderTimeline(props: RenderModalProps) {
    return (<TimelineModal modalProps={props} />);
}
