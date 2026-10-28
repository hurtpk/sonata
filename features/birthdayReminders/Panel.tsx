/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled, plugins } from "@api/PluginManager";
import { classNameFactory } from "@utils/css";
import { openPrivateChannel } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, IconUtils, RelationshipStore, showToast, useEffect, useMemo, UserStore, UserUtils, useState } from "@webpack/common";

import { isFeatureRunning } from "../../featureSettings";
import { playEffect } from "../_shared/effects";
import { openSection } from "../_shared/Hub";
import { Window } from "../_shared/Window";
import { openScheduler } from "../scheduledMessages/Panel";
import { Birthday, colorOf, daysInMonth, daysUntil, formatDate, MONTH_COLORS, MONTHS, nextOccurrence, sortByUpcoming, turning } from "./dates";
import { patchBirthday, removeBirthday, setBirthday, useBirthdays } from "./store";

const cl = classNameFactory("vc-bday-");
const SNOWFLAKE = /^\d{17,20}$/;

/** A colour for each month, used for its cards and the month strip. */
const SHORT = MONTHS.map(m => m.slice(0, 3));
/** Colours to pick for someone's glow. */
const SWATCHES = ["#ff5c6c", "#ff8a3d", "#ffb020", "#ffd84d", "#c9e265", "#3ddc84", "#2dd4bf", "#00b0f4", "#5b8cff", "#7c5cff", "#c26bff", "#ff6fae", "#ff9eb5", "#c69c6d", "#e0e0e0"];

/** Picking a glow colour: their month's (the default), a swatch, or your own. */
function ColorRow({ value, month, onChange }: { value: string | null; month: number; onChange(c: string | null): void; }) {
    const custom = value && !SWATCHES.includes(value) ? value : null;
    return (
        <div className={cl("colors")}>
            <button type="button" className={classes(cl("color"), cl("color-auto"), !value && cl("color-on"))} style={{ "--c": MONTH_COLORS[month - 1] } as React.CSSProperties} title="Their month's colour" onClick={() => onChange(null)}>
                <span>{SHORT[month - 1]}</span>
            </button>
            {SWATCHES.map(c => (
                <button key={c} type="button" className={classes(cl("color"), value === c && cl("color-on"))} style={{ "--c": c } as React.CSSProperties} title={c} onClick={() => onChange(c)} />
            ))}
            <label className={classes(cl("color"), cl("color-custom"), custom && cl("color-on"))} style={custom ? { "--c": custom } as React.CSSProperties : undefined} title="Your own colour">
                {!custom && <span>+</span>}
                <input type="color" value={custom ?? "#ff6fae"} onChange={e => onChange(e.currentTarget.value)} />
            </label>
        </div>
    );
}

/** Discord's own grey avatar for someone, by their ID. */
const defaultAvatar = (userId: string) => {
    try { return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(userId) >> 22n) % 6n)}.png`; } catch { return "https://cdn.discordapp.com/embed/avatars/0.png"; }
};

/** Their picture now (if Discord knows them), else the one saved with the birthday, else the default. */
export function avatarUrl(b: Pick<Birthday, "userId" | "avatar">, size = 64) {
    const u: any = UserStore.getUser(b.userId);
    if (u) { try { return IconUtils.getUserAvatarURL(u, false, size); } catch { } }
    if (b.avatar) return `https://cdn.discordapp.com/avatars/${b.userId}/${b.avatar}.${b.avatar.startsWith("a_") ? "gif" : "webp"}?size=${size}`;
    return defaultAvatar(b.userId);
}

/** A picture that falls back to Discord's default if it can't load (an old, changed avatar). */
function Avatar({ b, size, className }: { b: Pick<Birthday, "userId" | "avatar">; size: number; className?: string; }) {
    const [src, setSrc] = useState(() => avatarUrl(b, size * 2));
    useEffect(() => setSrc(avatarUrl(b, size * 2)), [b.userId, b.avatar]);
    return <img className={className} src={src} alt="" width={size} height={size} onError={() => { const d = defaultAvatar(b.userId); if (src !== d) setSrc(d); }} />;
}

const nameOf = (u: any) => u?.globalName ?? u?.global_name ?? u?.username ?? "Unknown user";
const myId = () => UserStore.getCurrentUser()?.id;
const isMe = (userId: string) => userId === myId();

interface Person { userId: string; name: string; avatar: string | null; username: string; }
const personFrom = (u: any): Person => ({ userId: u.id, name: nameOf(u), avatar: u.avatar ?? null, username: u.username });

/* ── Picking someone ── */

function PersonPicker({ value, onChange }: { value: Person | null; onChange(p: Person): void; }) {
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(!value);
    const [lookup, setLookup] = useState<Person | "none" | "loading" | null>(null);

    const friends = useMemo(() => {
        const me = UserStore.getCurrentUser();
        const list = (RelationshipStore.getFriendIDs?.() ?? []).map(id => UserStore.getUser(id)).filter(Boolean).map(personFrom);
        return me ? [personFrom(me), ...list] : list;
    }, []);

    const q = query.trim();
    useEffect(() => {
        if (!SNOWFLAKE.test(q)) { setLookup(null); return; }
        const cached = UserStore.getUser(q);
        if (cached) { setLookup(personFrom(cached)); return; }
        let cancelled = false;
        setLookup("loading");
        Promise.resolve(UserUtils.getUser(q))
            .then((u: any) => { if (!cancelled) setLookup(u ? personFrom(u) : "none"); })
            .catch(() => { if (!cancelled) setLookup("none"); });
        return () => { cancelled = true; };
    }, [q]);

    const options: Person[] = SNOWFLAKE.test(q)
        ? (lookup && typeof lookup === "object" ? [lookup] : [])
        : friends.filter(f => !q || `${f.name} ${f.username}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8);

    return (
        <div className={cl("picker")}>
            {value && !open ? (
                <button type="button" className={cl("picker-field")} onClick={() => setOpen(true)}>
                    <Avatar b={value} size={32} className={cl("avatar")} />
                    <span className={cl("picker-name")}>{value.name}</span>
                    <span className={cl("picker-sub")}>{isMe(value.userId) ? "You" : `@${value.username}`}</span>
                    <span className={cl("picker-change")}>Change</span>
                </button>
            ) : (
                <input className={classes("vc-tool-input", cl("input"))} autoFocus={open} value={query} placeholder="Search friends, or paste a user ID"
                    onFocus={() => setOpen(true)} onChange={e => { setQuery(e.currentTarget.value); setOpen(true); }} />
            )}
            {open && (
                <div className={cl("picker-menu")}>
                    {lookup === "loading" && <div className={cl("picker-note")}>Looking up that ID…</div>}
                    {lookup === "none" && <div className={cl("picker-note")}>No user with that ID.</div>}
                    {!SNOWFLAKE.test(q) && options.length === 0 && <div className={cl("picker-note")}>No friends match. You can also paste a user ID.</div>}
                    {options.map(p => (
                        <button key={p.userId} type="button" className={cl("picker-option")}
                            onMouseDown={e => { e.preventDefault(); onChange(p); setOpen(false); setQuery(""); }}>
                            <Avatar b={p} size={28} className={cl("avatar")} />
                            <span className={cl("picker-name")}>{p.name}</span>
                            <span className={cl("picker-sub")}>{isMe(p.userId) ? "You" : `@${p.username}`}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ── Adding and editing ── */

function Editor({ initial, onDone }: { initial: Birthday | null; onDone(): void; }) {
    const [person, setPerson] = useState<Person | null>(initial ? { userId: initial.userId, name: initial.name, avatar: initial.avatar ?? null, username: UserStore.getUser(initial.userId)?.username ?? initial.name } : null);
    const [month, setMonth] = useState(initial?.month ?? new Date().getMonth() + 1);
    const [day, setDay] = useState(initial?.day ?? new Date().getDate());
    const [year, setYear] = useState(initial?.year ? String(initial.year) : "");
    const [color, setColor] = useState<string | null>(initial?.color ?? null);

    const maxDay = daysInMonth(month);
    useEffect(() => { if (day > maxDay) setDay(maxDay); }, [month]);
    const yearNum = year.trim() ? Number(year) : null;
    const yearOk = yearNum == null || (Number.isInteger(yearNum) && yearNum >= 1900 && yearNum <= new Date().getFullYear());
    const preview = person ? { month, day } : null;
    const until = preview ? daysUntil(preview) : null;

    const save = () => {
        if (!person || !yearOk) return;
        setBirthday({ userId: person.userId, name: person.name, avatar: person.avatar, month, day, year: yearNum, color });
        showToast(isMe(person.userId) ? "Saved your birthday" : `Saved ${person.name}'s birthday`, "success");
        onDone();
    };

    return (
        <section className={cl("editor")} style={{ "--m": colorOf({ month, color }) } as React.CSSProperties}>
            <div className={cl("editor-head")}>
                <b>{initial ? "Edit birthday" : "Add a birthday"}</b>
                <button type="button" className="vc-tool-icon" title="Close" onClick={onDone}>✕</button>
            </div>
            <PersonPicker value={person} onChange={setPerson} />
            <span className="vc-tool-label">Month</span>
            <div className={cl("months-pick")}>
                {SHORT.map((m, i) => (
                    <button key={m} type="button" className={classes(cl("month-chip"), month === i + 1 && cl("month-chip-on"))} style={{ "--m": MONTH_COLORS[i] } as React.CSSProperties} onClick={() => setMonth(i + 1)}>{m}</button>
                ))}
            </div>
            <span className="vc-tool-label">Glow colour</span>
            <ColorRow value={color} month={month} onChange={setColor} />
            <div className={cl("date-row")}>
                <label className={cl("field")}>
                    <span>Day</span>
                    <select className="vc-tool-input" value={day} onChange={e => setDay(Number(e.currentTarget.value))}>
                        {Array.from({ length: maxDay }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                    </select>
                </label>
                <label className={cl("field")}>
                    <span>Year born (optional)</span>
                    <input className={classes("vc-tool-input", !yearOk && cl("input-bad"))} value={year} placeholder="e.g. 2010" inputMode="numeric"
                        onChange={e => setYear(e.currentTarget.value.replace(/\D/g, "").slice(0, 4))} />
                </label>
            </div>
            {person && until != null && (
                <div className={cl("editor-preview")}>
                    🎂 {MONTHS[month - 1]} {day} — {until === 0 ? "that's today!" : until === 1 ? "tomorrow" : `in ${until} days`}
                    {yearNum && yearOk ? ` · turns ${nextOccurrence({ month, day }).getFullYear() - yearNum}` : ""}
                </div>
            )}
            <div className={cl("actions")}>
                <button type="button" className="vc-tool-btn" onClick={onDone}>Cancel</button>
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!person || !yearOk} onClick={save}>{initial ? "Save changes" : "Add birthday"}</button>
            </div>
        </section>
    );
}

/* ── Sending a message ── */

async function dmChannelFor(userId: string) {
    const existing = ChannelStore.getDMFromUserId(userId);
    if (existing) return existing;
    const result: any = await openPrivateChannel(userId, false);
    return (typeof result === "string" ? result : result?.id) ?? ChannelStore.getDMFromUserId(userId);
}

type Queue = (o: { channelId: string; content: string; sendAt: number; }) => void;

/** Scheduled Messages: Sonata's own copy, or an older standalone one if that's what's installed. */
const scheduler = (): Queue | undefined => {
    if (isFeatureRunning("scheduledMessages")) return o => openScheduler(o.channelId, { content: o.content, sendAt: o.sendAt });
    const standalone = isPluginEnabled("ScheduledMessages") ? (plugins.ScheduledMessages as any)?.openPrefilled : undefined;
    return typeof standalone === "function" ? standalone : undefined;
};

async function queueFor(b: Birthday, hour: number, queue: Queue) {
    const channelId = await dmChannelFor(b.userId).catch(() => null);
    if (!channelId) return showToast("Couldn't open a DM with them", "failure");
    const at = nextOccurrence(b); at.setHours(hour, 0, 0, 0);
    queue({ channelId, content: `Happy birthday, ${b.name}! 🎉`, sendAt: at.getTime() > Date.now() ? at.getTime() : Date.now() + 60_000 });
}

/* ── One person ── */

const whenText = (days: number) => days === 0 ? "Today!" : days === 1 ? "Tomorrow" : days < 7 ? `In ${days} days` : days < 60 ? `In ${Math.round(days / 7)} week${Math.round(days / 7) === 1 ? "" : "s"}` : `In ${Math.round(days / 30.4)} months`;

function Card({ b, onEdit, hour }: { b: Birthday; onEdit(): void; hour: number; }) {
    const [sure, setSure] = useState(false);
    const days = daysUntil(b);
    const age = turning(b);
    const me = isMe(b.userId);
    const queue = me ? undefined : scheduler();
    const color = colorOf(b);
    const [painting, setPainting] = useState(false);
    const close = days <= 7;

    return (
        <div className={classes(cl("card"), days === 0 && cl("card-today"), close && cl("card-close"))} style={{ "--m": color } as React.CSSProperties}>
            <div className={cl("card-head")}>
                <span className={classes(cl("ring"), close && cl("ring-glow"))}><Avatar b={b} size={44} className={cl("avatar-lg")} /></span>
                <div className={cl("card-title")}>
                    <b>{b.name}{me && <span className={cl("you")}>You</span>}</b>
                    <span>{formatDate(b)}{age ? ` · ${days === 0 ? "turning" : "turns"} ${age}` : ""}</span>
                </div>
                <div className={cl("countdown")}>
                    {days === 0 ? <span className={cl("today-badge")}>🎂 Today!</span> : <><b>{days}</b><span>{days === 1 ? "day" : "days"}</span></>}
                </div>
            </div>
            <div className={cl("card-row")}>
                {days === 0 && <button type="button" className="vc-tool-chip" onClick={() => playEffect("confetti")}>🎉 Celebrate</button>}
                {!me && <button type="button" className="vc-tool-chip" onClick={() => openPrivateChannel(b.userId)}>💬 Message</button>}
                {queue && days > 0 && <button type="button" className="vc-tool-chip" title="Queue a birthday message with Scheduled Messages" onClick={() => void queueFor(b, hour, queue)}>⏰ Queue a message</button>}
                <span className="vc-tool-spacer" />
                {days > 0 && <span className={cl("when")}>{whenText(days)}</span>}
                <button type="button" className={classes(cl("btn"), cl("paint"), painting && cl("paint-on"))} title="Change their colour" onClick={() => setPainting(v => !v)}><i style={{ background: color }} />🎨</button>
                <button type="button" className={cl("btn")} onClick={onEdit}>Edit</button>
                {sure ? (
                    <span className={cl("sure")}>
                        <button type="button" className={classes(cl("btn"), cl("btn-danger"))} onClick={() => removeBirthday(b.userId)}>Remove</button>
                        <button type="button" className={cl("btn")} onClick={() => setSure(false)}>Keep</button>
                    </span>
                ) : (
                    <button type="button" className={cl("x")} title="Remove" onClick={() => setSure(true)}>
                        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={3} strokeLinecap="round" /></svg>
                    </button>
                )}
            </div>
            {painting && <ColorRow value={b.color ?? null} month={b.month} onChange={c => patchBirthday(b.userId, { color: c })} />}
        </div>
    );
}

/* ── The top: today, or what's next ── */

function Hero({ list, onAdd, onAddMine, hasMine }: { list: Birthday[]; onAdd(): void; onAddMine(): void; hasMine: boolean; }) {
    const today = list.filter(b => daysUntil(b) === 0);
    const next = list.find(b => daysUntil(b) > 0);
    const star = today[0] ?? next;
    return (
        <section className={classes(cl("hero"), today.length > 0 && cl("hero-today"))} style={star ? { "--m": colorOf(star) } as React.CSSProperties : undefined}>
            {star ? (
                <>
                    <span className={classes(cl("ring"), cl("ring-glow"), cl("hero-ring"))}><Avatar b={star} size={64} className={cl("hero-avatar")} /></span>
                    <div className={cl("hero-text")}>
                        <span className={cl("hero-label")}>{today.length ? "🎂 Birthday today" : "Next birthday"}</span>
                        <b>{today.length ? today.map(b => isMe(b.userId) ? "You!" : b.name).join(", ") : next!.name}</b>
                        <span>{today.length ? (today.some(b => isMe(b.userId)) ? "Happy birthday! 🎉" : "Send them something nice 🎉") : `${formatDate(next!)}${turning(next!) ? ` · turns ${turning(next!)}` : ""}`}</span>
                    </div>
                    {!today.length && next && (
                        <div className={cl("hero-count")}><b>{daysUntil(next)}</b><span>{daysUntil(next) === 1 ? "day to go" : "days to go"}</span></div>
                    )}
                    {today.length > 0 && <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => playEffect("confetti")}>🎉 Celebrate</button>}
                </>
            ) : (
                <div className={cl("hero-text")}>
                    <span className={cl("hero-label")}>Birthdays</span>
                    <b>Never miss a birthday</b>
                    <span>Add friends' birthdays (and yours) — you'll get a reminder on the day, and the day before.</span>
                </div>
            )}
            <div className={cl("hero-actions")}>
                <button type="button" className="vc-tool-btn vc-tool-primary" onClick={onAdd}>+ Add a birthday</button>
                {!hasMine && <button type="button" className="vc-tool-btn" onClick={onAddMine}>+ Add yours</button>}
            </div>
        </section>
    );
}

/* ── The window ── */

/** Confetti once per day when the window is opened on someone's birthday. */
let celebratedOn = "";

function BirthdayModal({ modalProps, focusUserId, hour, confetti }: { modalProps: RenderModalProps; focusUserId?: string; hour: number; confetti: boolean; }) {
    const list = sortByUpcoming(useBirthdays());
    const mine = list.find(b => isMe(b.userId));
    const [editing, setEditing] = useState<Birthday | "new" | null>(() => {
        if (!focusUserId) return null;
        const existing = list.find(b => b.userId === focusUserId);
        if (existing) return existing;
        const u = UserStore.getUser(focusUserId);
        return u ? { userId: u.id, name: nameOf(u), avatar: (u as any).avatar ?? null, month: new Date().getMonth() + 1, day: new Date().getDate() } : "new";
    });
    const [editorKey, setEditorKey] = useState(0);
    const [month, setMonth] = useState<number | null>(null);
    const [find, setFind] = useState("");

    // Keep names and pictures up to date with what Discord knows now.
    useEffect(() => {
        for (const b of list) {
            const u: any = UserStore.getUser(b.userId);
            if (u && ((u.avatar ?? null) !== (b.avatar ?? null) || nameOf(u) !== b.name)) patchBirthday(b.userId, { avatar: u.avatar ?? null, name: nameOf(u) });
        }
    }, []);

    const today = list.filter(b => daysUntil(b) === 0);
    useEffect(() => {
        const day = new Date().toDateString();
        if (!confetti || !today.length || celebratedOn === day) return;
        celebratedOn = day;
        playEffect("confetti");
    }, []);

    const addMine = () => {
        const me = UserStore.getCurrentUser();
        if (!me) return;
        setEditing({ userId: me.id, name: nameOf(me), avatar: (me as any).avatar ?? null, month: new Date().getMonth() + 1, day: new Date().getDate() });
        setEditorKey(k => k + 1);
    };
    const perMonth = MONTHS.map((_, i) => list.filter(b => b.month === i + 1).length);
    const q = find.trim().toLowerCase();
    const shown = list.filter(b => (month == null || b.month === month) && (!q || b.name.toLowerCase().includes(q)));
    const groups: [string, Birthday[]][] = [
        ["Today", shown.filter(b => daysUntil(b) === 0)],
        ["This week", shown.filter(b => { const d = daysUntil(b); return d > 0 && d <= 7; })],
        ["This month", shown.filter(b => { const d = daysUntil(b); return d > 7 && d <= 31; })],
        ["Later", shown.filter(b => daysUntil(b) > 31)],
    ];

    return (
        <Window {...modalProps} size="lg" title="Birthdays" subtitle={`${list.length} saved · reminders at ${hour}:00`}>
            <div className={classes("vc-tool-wrap", cl("wrap"))}>
                <Hero list={list} hasMine={!!mine} onAdd={() => { setEditing("new"); setEditorKey(k => k + 1); }} onAddMine={addMine} />

                {editing && (
                    <Editor key={`${editing === "new" ? "new" : editing.userId}-${editorKey}`} initial={editing === "new" ? null : editing}
                        onDone={() => { setEditing(null); setEditorKey(k => k + 1); }} />
                )}

                {list.length > 0 && (
                    <>
                        <div className={cl("months")}>
                            {SHORT.map((m, i) => (
                                <button key={m} type="button" className={classes(cl("month"), month === i + 1 && cl("month-on"), !perMonth[i] && cl("month-empty"), new Date().getMonth() === i && cl("month-now"))}
                                    style={{ "--m": MONTH_COLORS[i] } as React.CSSProperties} title={`${MONTHS[i]}: ${perMonth[i]} birthday${perMonth[i] === 1 ? "" : "s"}`}
                                    onClick={() => setMonth(month === i + 1 ? null : i + 1)}>
                                    <span>{m}</span>
                                    <b>{perMonth[i] || "·"}</b>
                                </button>
                            ))}
                        </div>
                        <div className={cl("tools")}>
                            <input className="vc-tool-input" value={find} placeholder="Find someone" onChange={e => setFind(e.currentTarget.value)} />
                            {month != null && <button type="button" className="vc-tool-chip vc-tool-chip-on" onClick={() => setMonth(null)}>{MONTHS[month - 1]} ✕</button>}
                        </div>
                    </>
                )}

                {groups.map(([label, items]) => items.length > 0 && (
                    <section key={label} className={cl("group")}>
                        <span className="vc-tool-label">{label} · {items.length}</span>
                        <div className={cl("grid")}>
                            {items.map(b => <Card key={b.userId} b={b} hour={hour} onEdit={() => { setEditing(b); setEditorKey(k => k + 1); }} />)}
                        </div>
                    </section>
                ))}
                {list.length > 0 && !shown.length && <div className="vc-tool-empty">Nobody matches that.</div>}
                <span className="vc-tool-hint">Tip: right-click anyone → Set birthday. Their countdown shows on their profile too (only you see it).</span>
            </div>
        </Window>
    );
}

export function openBirthdays(focusUserId: string | undefined, hour: number, confetti = true) { openSection("people", "birthdayReminders", props => renderBirthdays(props, focusUserId, hour, confetti)); }

export function renderBirthdays(props: RenderModalProps, ...[focusUserId, hour, confetti = true]: Parameters<typeof openBirthdays>) {
    return (<BirthdayModal modalProps={props} focusUserId={focusUserId} hour={hour} confetti={confetti} />);
}
