/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, showToast, useEffect, useReducer, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { Window } from "../_shared/Window";
import { playSound } from "./Banner";
import { addReminder, COLOR_IDS, ColorId, COLORS, getReminders, loadReminders, onRemindersChange, quickTimes, Reminder, removeReminder, Repeat, REPEATS, toLocalInput, updateReminder, whenText } from "./store";

const cl = classNameFactory("vc-tool-");
const rm = classNameFactory("vc-remw-");

function useReminders() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => { void loadReminders(); return onRemindersChange(bump); }, []);
    // Keep "in 5 min" fresh.
    useEffect(() => { const t = setInterval(bump, 30_000); return () => clearInterval(t); }, []);
    return [...getReminders()].sort((a, b) => a.at - b.at);
}

export interface Draft { text?: string; link?: Reminder["link"]; at?: number; color?: ColorId; }

function Editor({ draft, defaultColor, editing, onDone }: { draft: Draft; defaultColor: ColorId; editing?: Reminder; onDone(): void; }) {
    const [text, setText] = useState(editing?.text ?? draft.text ?? "");
    const [at, setAt] = useState<number>(editing?.at ?? draft.at ?? quickTimes()[2].at);
    const [color, setColor] = useState<ColorId>(editing?.color ?? draft.color ?? defaultColor);
    const [repeat, setRepeat] = useState<Repeat>(editing?.repeat ?? "none");
    const link = editing?.link ?? draft.link;

    const save = () => {
        if (!text.trim() && !link) { showToast("Write what to remind you about", "failure"); return; }
        if (editing) updateReminder(editing.id, { text: text.trim(), at, color, repeat });
        else addReminder({ text: text.trim(), at, color, repeat, link });
        showToast(`Reminder set for ${whenText(at)}`, "success");
        onDone();
    };

    return (
        <div className={classes(cl("card"), rm("editor"))} style={{ "--rem": COLORS[color].hex } as React.CSSProperties}>
            <input className={cl("input")} autoFocus placeholder={link ? "What about this message? (optional)" : "Remind me to…"} value={text} maxLength={200}
                onChange={e => setText(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") save(); }} />
            {link && <span className={cl("hint")}>🔗 Linked to {link.author ? `${link.author}'s` : "a"} message — the reminder can take you straight to it.</span>}

            <span className={cl("label")}>When</span>
            <div className={rm("chips")}>
                {quickTimes().map(q => (
                    <button key={q.label} type="button" className={classes(rm("chip"), Math.abs(q.at - at) < 60_000 && rm("chip-on"))} onClick={() => setAt(q.at)}>{q.label}</button>
                ))}
                <input type="datetime-local" className={classes(cl("input"), rm("date"))} value={toLocalInput(at)} onChange={e => { const t = new Date(e.currentTarget.value).getTime(); if (t) setAt(t); }} />
            </div>
            <span className={cl("hint")}>Rings {whenText(at)}.</span>

            <span className={cl("label")}>Colour</span>
            <div className={rm("colors")}>
                {COLOR_IDS.map(id => (
                    <button key={id} type="button" title={`${COLORS[id].name}: ${COLORS[id].feel}`} className={classes(rm("swatch"), color === id && rm("swatch-on"))}
                        style={{ background: COLORS[id].hex }} onClick={() => { setColor(id); playSound(COLORS[id].sound, 0.4); }} aria-label={COLORS[id].name} />
                ))}
                <span className={cl("hint")}>{COLORS[color].name}: {COLORS[color].feel}.</span>
            </div>

            <div className={cl("row")}>
                <span className={cl("label")}>Repeat</span>
                <div className={cl("seg")}>
                    {REPEATS.map(r => <button key={r.id} type="button" className={classes(cl("seg-btn"), repeat === r.id && cl("seg-on"))} onClick={() => setRepeat(r.id)}>{r.name}</button>)}
                </div>
            </div>

            <div className={cl("footer")}>
                <span className={cl("spacer")} />
                <button type="button" className={cl("btn")} onClick={onDone}>Cancel</button>
                <button type="button" className={classes(cl("btn"), cl("primary"))} onClick={save}>{editing ? "Save" : "Set reminder"}</button>
            </div>
        </div>
    );
}

function Row({ r, onEdit }: { r: Reminder; onEdit(): void; }) {
    const c = COLORS[r.color] ?? COLORS.blue;
    const late = r.at <= Date.now();
    const [sure, setSure] = useState(false);
    return (
        <div className={classes(rm("row"), late && rm("row-late"))} style={{ "--rem": c.hex } as React.CSSProperties}>
            <span className={rm("bell")} aria-hidden>{late ? "🔔" : "⏰"}</span>
            <button type="button" className={rm("row-main")} onClick={onEdit} title="Edit">
                <span className={rm("row-text")}>{r.text || (r.link ? "That message" : "Reminder")}</span>
                <span className={rm("row-when")}>
                    <span className={rm("pill")}>{late ? "Due now" : whenText(r.at)}</span>
                    {r.repeat !== "none" && <span>🔁 {REPEATS.find(x => x.id === r.repeat)?.name}</span>}
                    {r.link && <span>🔗 linked message</span>}
                </span>
            </button>
            {sure ? (
                <span className={rm("sure")}>
                    <button type="button" className={classes(cl("btn"), rm("del"))} onClick={() => removeReminder(r.id)}>Delete</button>
                    <button type="button" className={cl("btn")} onClick={() => setSure(false)}>Keep</button>
                </span>
            ) : <button type="button" className={rm("x")} aria-label="Delete" title="Delete" onClick={() => setSure(true)}>✕</button>}
        </div>
    );
}

function RemindersModal({ modalProps, draft, defaultColor }: { modalProps: RenderModalProps; draft: Draft | null; defaultColor: ColorId; }) {
    const accent = windowAccent("reminders");
    const list = useReminders();
    const [adding, setAdding] = useState<Draft | null>(draft);
    const [editing, setEditing] = useState<Reminder | null>(null);

    const day = (t: number) => {
        const d = new Date(t).toDateString(), now = Date.now();
        if (t <= now || d === new Date(now).toDateString()) return "Today";
        if (d === new Date(now + 86_400_000).toDateString()) return "Tomorrow";
        return "Later";
    };
    const groups = ["Today", "Tomorrow", "Later"].map(g => [g, list.filter(r => day(r.at) === g)] as const).filter(([, l]) => l.length);
    const next = list[0];
    const todayCount = list.filter(r => day(r.at) === "Today").length;

    return (
        <Window {...modalProps} size="lg" title="Reminders" subtitle="A banner drops down at the top of Discord when one is due — in its colour.">
            <div className={cl("wrap")} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon="⏰" kicker={next ? (next.at <= Date.now() ? "Due now" : "Next up") : "Reminders"}
                    title={next ? (next.text || (next.link ? "That message" : "Reminder")) : "Nothing coming up"}
                    sub={next ? `${next.at <= Date.now() ? "Waiting for you" : whenText(next.at)}${next.repeat !== "none" ? " · repeats" : ""}` : "Set one, and a banner drops down at the top of Discord when it's time."}
                    numbers={list.length ? [{ value: todayCount, label: "today" }, { value: list.length, label: list.length === 1 ? "reminder" : "reminders" }] : []}>
                    {!adding && !editing && <button type="button" className={classes(cl("btn"), cl("primary"))} onClick={() => setAdding({})}>＋ New reminder</button>}
                </ToolHero>
                {(adding || editing) && (
                    <Editor draft={adding ?? {}} editing={editing ?? undefined} defaultColor={defaultColor} onDone={() => { setAdding(null); setEditing(null); }} />
                )}
                {!adding && !editing && (list.length ? groups.map(([g, l]) => (
                    <div key={g} className={rm("group")}>
                        <span className={cl("label")}>{g} · {l.length}</span>
                        <div className={rm("grid")}>{l.map(r => <Row key={r.id} r={r} onEdit={() => setEditing(r)} />)}</div>
                    </div>
                )) : <div className={cl("empty")}><span className={cl("empty-icon")}>⏰</span>No reminders yet. You can also right-click any message → Remind me about this.</div>)}
            </div>
        </Window>
    );
}

export function openReminders(defaultColor: ColorId, draft: Draft | null = null) {
    openModal(props => <RemindersModal modalProps={props} draft={draft} defaultColor={defaultColor} />);
}
