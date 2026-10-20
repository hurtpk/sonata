/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { openPrivateChannel } from "@utils/discord";
import { classes } from "@utils/misc";
import { saveFile } from "@utils/web";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, NavigationRouter, openModal, showToast, useMemo, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { isFeatureRunning } from "../../featureSettings";
import { ToolHero } from "../_shared/ToolHero";
import { Window } from "../_shared/Window";
import { useBirthdays } from "../birthdayReminders/store";
import { openPackage } from "../packageTracker/store";
import { openScheduler } from "../scheduledMessages/Panel";
import { useQueue } from "../scheduledMessages/store";
import { addImport, ExportItem, ImportedCalendar, removeImport, updateImport, useImports, writeIcs } from "./ics";
import { byDay, CalendarItem, dayKey, Kind, monthGrid, sameDay, weekdayNames } from "./month";
import { addReminder, removeReminder, useReminders } from "./reminders";
import { itemsBetween, SourceOptions } from "./sources";

const cl = classNameFactory("vc-cal-");

const KINDS: { kind: Kind; label: string; icon: string; }[] = [
    { kind: "birthday", label: "Birthdays", icon: "🎂" },
    { kind: "scheduled", label: "Scheduled messages", icon: "🕑" },
    { kind: "event", label: "Server events", icon: "📅" },
    { kind: "reminder", label: "Reminders", icon: "🔔" },
    { kind: "imported", label: "Imported", icon: "🗓️" },
    { kind: "package", label: "Packages", icon: "📦" },
];

const optionKey: Record<Kind, keyof SourceOptions> = { birthday: "birthdays", scheduled: "scheduled", event: "events", reminder: "reminders", imported: "imported", package: "packages" };

const timeText = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function ItemRow({ it, close }: { it: CalendarItem; close(): void; }) {
    const meta = KINDS.find(k => k.kind === it.kind)!;
    const past = it.at < Date.now() && !it.allDay;

    const actions: { label: string; run(): void; danger?: boolean; }[] = [];
    if (it.kind === "birthday" && !it.ref.self) actions.push({ label: "Message", run: () => { openPrivateChannel(it.ref.userId); close(); } });
    if (it.kind === "scheduled") actions.push({ label: "Open", run: () => openScheduler(it.ref.channelId) });
    if (it.kind === "event") {
        actions.push({
            label: it.ref.live ? "Join" : "Go to server", run: () => {
                const ch = it.ref.channelId && ChannelStore.getChannel(it.ref.channelId);
                NavigationRouter.transitionTo(ch ? `/channels/${it.ref.guildId}/${ch.id}` : `/channels/${it.ref.guildId}`);
                close();
            }
        });
    }
    if (it.kind === "reminder") actions.push({ label: "Delete", danger: true, run: () => removeReminder(it.ref.reminderId) });
    if (it.kind === "package") actions.push({ label: "Open", run: () => { openPackage(it.ref.packageId); close(); } });

    return (
        <div className={classes(cl("item"), cl(`item-${it.kind}`), past && cl("item-past"))} style={it.ref?.color ? ({ "--k": it.ref.color } as React.CSSProperties) : undefined} title={it.ref?.description}>
            <span className={cl("item-icon")}>{meta.icon}</span>
            <div className={cl("item-text")}>
                <div className={cl("item-title")}>
                    {it.title}
                    {it.ref?.live && <span className={cl("live")}>Live</span>}
                    {it.kind === "reminder" && it.ref.done && <span className={cl("done")}>Done</span>}
                </div>
                <div className={cl("item-sub")}>{it.allDay ? "All day" : timeText(it.at)}{it.detail ? ` · ${it.detail}` : ""}</div>
            </div>
            <div className={cl("item-actions")}>
                {actions.map(a => <button key={a.label} type="button" className={classes(cl("mini"), a.danger && cl("mini-danger"))} onClick={a.run}>{a.label}</button>)}
            </div>
        </div>
    );
}

function AddReminder({ day }: { day: Date; }) {
    const [title, setTitle] = useState("");
    const [time, setTime] = useState("09:00");
    const add = () => {
        const [h, m] = time.split(":").map(Number);
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h || 0, m || 0).getTime();
        if (!title.trim()) return;
        if (at <= Date.now()) return showToast("Pick a time that hasn't passed yet", "failure");
        addReminder(title.trim(), at);
        setTitle("");
        showToast("Reminder added", "success");
    };
    return (
        <div className={cl("add")}>
            <input className={cl("input")} value={title} placeholder="Remind me to…" maxLength={200}
                onChange={e => setTitle(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} />
            <input className={classes(cl("input"), cl("time"))} type="time" value={time} onChange={e => setTime(e.currentTarget.value)} aria-label="Time" />
            <button type="button" className={cl("btn-primary")} disabled={!title.trim()} onClick={add}>Add</button>
        </div>
    );
}

/* ── Importing and exporting ── */

/** Everything in the calendar from a month ago to a year ahead, as calendar-file entries. */
function exportItems(): ExportItem[] {
    const now = Date.now();
    const all = itemsBetween(now - 30 * 86_400_000, now + 366 * 86_400_000, { birthdays: true, scheduled: true, events: true, reminders: true, imported: false, packages: true, interestedOnly: false });
    const seenBirthday = new Set<string>();
    const out: ExportItem[] = [];
    for (const it of all) {
        if (it.kind === "birthday") {
            // One repeating yearly event per person.
            if (seenBirthday.has(it.ref.userId)) continue;
            seenBirthday.add(it.ref.userId);
            out.push({ uid: `bday-${it.ref.userId}`, title: it.title.replace(/^Your birthday$/, "My birthday"), at: it.at, allDay: true, yearly: true });
        } else out.push({ uid: it.id, title: it.kind === "scheduled" ? `Scheduled message: ${it.title}` : it.title, at: it.at, allDay: it.allDay, detail: it.detail, minutes: it.kind === "event" ? 60 : 15 });
    }
    return out;
}

function Calendars() {
    const imports = useImports();
    const [url, setUrl] = useState("");
    const [busy, setBusy] = useState<string | null>(null);
    const [open, setOpen] = useState(false);

    const fromFile = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".ics,text/calendar";
        input.multiple = true;
        input.onchange = async () => {
            for (const f of Array.from(input.files ?? [])) {
                try {
                    const cal = addImport(await f.text(), f.name.replace(/\.ics$/i, ""));
                    showToast(`Added “${cal.name}” — ${cal.events.length} event${cal.events.length === 1 ? "" : "s"}`, "success");
                } catch (e) { showToast(`${f.name}: ${e instanceof Error ? e.message : "couldn't read it"}`, "failure"); }
            }
        };
        input.click();
    };

    const fetchIcs = async (link: string) => {
        const u = link.trim().replace(/^webcal:\/\//i, "https://");
        if (!/^https:\/\//i.test(u)) throw new Error("Paste a calendar link that starts with https:// or webcal://");
        const r = await VencordNative.pluginHelpers.Sonata.getWebhookMessage(u);
        if (!r?.ok) throw new Error(`The link didn't work (${r?.status ?? "no answer"})`);
        const text = typeof r.body === "string" ? r.body : "";
        if (!text.includes("BEGIN:VCALENDAR")) throw new Error("That link isn't a calendar (.ics) file");
        return { text, u };
    };

    const fromLink = async () => {
        setBusy("link");
        try {
            const { text, u } = await fetchIcs(url);
            const cal = addImport(text, new URL(u).hostname, u);
            showToast(`Added “${cal.name}” — ${cal.events.length} events`, "success");
            setUrl("");
        } catch (e) { showToast(e instanceof Error ? e.message : "Couldn't add it", "failure"); } finally { setBusy(null); }
    };

    const refresh = async (c: ImportedCalendar) => {
        if (!c.url) return;
        setBusy(c.id);
        try { const { text } = await fetchIcs(c.url); addImport(text, c.name, c.url); showToast(`Updated “${c.name}”`, "success"); } catch (e) { showToast(e instanceof Error ? e.message : "Couldn't update it", "failure"); } finally { setBusy(null); }
    };

    const exportAll = () => {
        const items = exportItems();
        if (!items.length) { showToast("There's nothing to export yet", "failure"); return; }
        saveFile(new File([writeIcs(items)], `discord-calendar-${new Date().toISOString().slice(0, 10)}.ics`, { type: "text/calendar" }));
        showToast(`Exported ${items.length} item${items.length === 1 ? "" : "s"} — open the file to add them to Google, Outlook or Apple Calendar`, "success");
    };

    return (
        <div className={cl("cals")}>
            <div className={cl("cals-bar")}>
                <button type="button" className={cl("mini")} onClick={fromFile}>⬆ Import .ics file</button>
                <button type="button" className={cl("mini")} onClick={() => setOpen(o => !o)}>🔗 From a link</button>
                <button type="button" className={cl("mini")} onClick={exportAll} title="Birthdays, reminders, scheduled messages and server events, for any calendar app">⬇ Export</button>
            </div>
            {open && (
                <div className={cl("add")}>
                    <input className={cl("input")} value={url} placeholder="https://… or webcal://… (a calendar's .ics link)" onChange={e => setUrl(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") fromLink(); }} />
                    <button type="button" className={cl("btn-primary")} disabled={!url.trim() || busy === "link"} onClick={fromLink}>{busy === "link" ? "Adding…" : "Add"}</button>
                </div>
            )}
            {imports.map(c => (
                <div key={c.id} className={cl("cal")}>
                    <input type="checkbox" checked={c.enabled} onChange={e => updateImport(c.id, { enabled: e.currentTarget.checked })} title={c.enabled ? "Hide it" : "Show it"} />
                    <span className={cl("cal-dot")} style={{ background: c.color }} />
                    <span className={cl("cal-name")} title={`${c.events.length} events · added ${new Date(c.importedAt).toLocaleDateString()}`}>{c.name}</span>
                    <span className={cl("cal-n")}>{c.events.length}</span>
                    {c.url && <button type="button" className={cl("mini")} disabled={busy === c.id} onClick={() => refresh(c)} title="Get the latest from the link">{busy === c.id ? "…" : "↻"}</button>}
                    <button type="button" className={classes(cl("mini"), cl("mini-danger"))} onClick={() => removeImport(c.id)} title="Remove this calendar">✕</button>
                </div>
            ))}
        </div>
    );
}

function CalendarModal({ modalProps, weekStart, sources, setSource }: {
    modalProps: RenderModalProps; weekStart: 0 | 1; sources: SourceOptions; setSource(k: keyof SourceOptions, v: boolean): void;
}) {
    // Re-render when birthdays, scheduled messages or reminders change.
    useBirthdays(); useQueue(); useReminders(); useImports();
    const accent = windowAccent("calendar");
    const today = new Date();
    const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });
    const [selected, setSelected] = useState<Date>(today);
    const [shown, setShown] = useState<SourceOptions>(sources);

    const grid = useMemo(() => monthGrid(view.y, view.m, weekStart), [view.y, view.m, weekStart]);
    const days = byDay(itemsBetween(grid[0].getTime(), grid[41].getTime() + 86_400_000, shown));
    const selectedItems = days.get(dayKey(selected)) ?? [];

    const move = (delta: number) => setView(v => { const d = new Date(v.y, v.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
    const toggle = (k: keyof SourceOptions) => { const v = !shown[k]; setShown(s => ({ ...s, [k]: v })); setSource(k, v); };

    const monthName = new Date(view.y, view.m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

    // The top card: what's next, and how busy today and this month are.
    const now = Date.now();
    const upcoming = itemsBetween(now, now + 60 * 86_400_000, shown).filter(i => i.allDay ? dayKey(new Date(i.at)) >= dayKey(today) : i.at >= now).sort((a, b) => a.at - b.at);
    const next = upcoming[0];
    const todayCount = (days.get(dayKey(today)) ?? []).length;
    const monthCount = grid.filter(d => d.getMonth() === view.m).reduce((n, d) => n + (days.get(dayKey(d))?.length ?? 0), 0);
    const nextWhen = next && (sameDay(new Date(next.at), today) ? `Today${next.allDay ? "" : ` at ${timeText(next.at)}`}`
        : new Date(next.at).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) + (next.allDay ? "" : ` · ${timeText(next.at)}`));

    return (
        <Window {...modalProps} size="lg" title="Calendar" subtitle={today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}>
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon={next ? KINDS.find(k => k.kind === next.kind)!.icon : "📅"} kicker={next ? "Coming up" : "Calendar"}
                    title={next ? next.title : "Nothing coming up"}
                    sub={next ? nextWhen : "Birthdays, reminders, scheduled messages and server events all show up here."}
                    numbers={[{ value: todayCount, label: "today" }, { value: monthCount, label: new Date(view.y, view.m, 1).toLocaleDateString(undefined, { month: "long" }) }]}>
                    {next && <button type="button" className={cl("mini")} onClick={() => { const d = new Date(next.at); setSelected(d); setView({ y: d.getFullYear(), m: d.getMonth() }); }}>Show me</button>}
                </ToolHero>
                <div className={cl("layout")}>
                    <section className={cl("month")}>
                        <div className={cl("head")}>
                            <button type="button" className={cl("nav")} aria-label="Previous month" onClick={() => move(-1)}>‹</button>
                            <div className={cl("title")}>{monthName}</div>
                            <button type="button" className={cl("nav")} aria-label="Next month" onClick={() => move(1)}>›</button>
                            <button type="button" className={cl("mini")} onClick={() => { setView({ y: today.getFullYear(), m: today.getMonth() }); setSelected(today); }}>Today</button>
                        </div>
                        <div className={cl("grid")}>
                            {weekdayNames(weekStart).map(n => <div key={n} className={cl("dow")}>{n}</div>)}
                            {grid.map(d => {
                                const items = days.get(dayKey(d)) ?? [];
                                const kinds = KINDS.filter(k => items.some(i => i.kind === k.kind));
                                return (
                                    <button key={d.getTime()} type="button"
                                        className={classes(cl("day"), d.getMonth() !== view.m && cl("day-out"), sameDay(d, today) && cl("day-today"), sameDay(d, selected) && cl("day-selected"))}
                                        onClick={() => { setSelected(d); if (d.getMonth() !== view.m) setView({ y: d.getFullYear(), m: d.getMonth() }); }}
                                        aria-label={`${d.toDateString()}${items.length ? `, ${items.length} item${items.length === 1 ? "" : "s"}` : ""}`}>
                                        <span className={cl("num")}>{d.getDate()}</span>
                                        <span className={cl("dots")}>{kinds.map(k => <span key={k.kind} className={classes(cl("dot"), cl(`dot-${k.kind}`))} />)}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <div className={cl("legend")}>
                            {KINDS.map(k => (
                                <button key={k.kind} type="button" className={classes(cl("chip"), !shown[optionKey[k.kind]] && cl("chip-off"))} onClick={() => toggle(optionKey[k.kind])}
                                    title={shown[optionKey[k.kind]] ? `Hide ${k.label.toLowerCase()}` : `Show ${k.label.toLowerCase()}`}>
                                    <span className={classes(cl("dot"), cl(`dot-${k.kind}`))} />{k.label}
                                </button>
                            ))}
                        </div>
                        <Calendars />
                        {(!isFeatureRunning("birthdayReminders") || !isFeatureRunning("scheduledMessages")) && (
                            <div className={cl("hint")}>
                                {[!isFeatureRunning("birthdayReminders") && "Birthday Reminders", !isFeatureRunning("scheduledMessages") && "Scheduled Messages"].filter(Boolean).join(" and ")} {(!isFeatureRunning("birthdayReminders") && !isFeatureRunning("scheduledMessages")) ? "are" : "is"} off — saved ones still show here, but won't remind or send until you turn {(!isFeatureRunning("birthdayReminders") && !isFeatureRunning("scheduledMessages")) ? "them" : "it"} on.
                            </div>
                        )}
                    </section>

                    <section className={cl("side")}>
                        <div className={cl("side-title")}>{selected.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
                        <div className={cl("items")}>
                            {selectedItems.length === 0
                                ? <div className={cl("empty")}><span className={cl("empty-icon")}>🌤️</span>Nothing on this day.</div>
                                : selectedItems.map(it => <ItemRow key={it.id} it={it} close={modalProps.onClose} />)}
                        </div>
                        {dayKey(selected) >= dayKey(today) && <AddReminder day={selected} />}
                    </section>
                </div>
            </div>
        </Window>
    );
}

export function openCalendar(weekStart: 0 | 1, sources: SourceOptions, setSource: (k: keyof SourceOptions, v: boolean) => void) {
    openModal(props => <CalendarModal modalProps={props} weekStart={weekStart} sources={sources} setSource={setSource} />);
}
