/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { SelectedChannelStore, useEffect, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { openSection } from "../_shared/Hub";
import { ToolHero } from "../_shared/ToolHero";
import { Window } from "../_shared/Window";
import { sendOne } from "./scheduler";
import * as Q from "./store";
import { TargetChip, TargetPicker } from "./TargetPicker";

const cl = classNameFactory("vc-schedmsg-");
const MAX_LENGTH = 2000;

// ─── Helpers ───

function relative(ms: number, now: number): string {
    let diff = Math.round((ms - now) / 1000);
    if (diff <= 0) return "now";
    const d = Math.floor(diff / 86400); diff %= 86400;
    const h = Math.floor(diff / 3600); diff %= 3600;
    const m = Math.floor(diff / 60); const s = diff % 60;
    if (d) return `in ${d}d ${h}h`;
    if (h) return `in ${h}h ${m}m`;
    if (m) return `in ${m}m${m < 10 && s ? ` ${s}s` : ""}`;
    return `in ${s}s`;
}

const formatWhen = (ms: number) => new Date(ms).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

const pad = (n: number) => String(n).padStart(2, "0");
function toLocalInput(ms: number) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value: string): number | null {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : null;
}

function atTime(hours: number, dayOffset: number, now: number) {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hours, 0, 0, 0);
    return d.getTime();
}

const PRESETS: { label: string; at(now: number): number; }[] = [
    { label: "In 15 min", at: n => n + 15 * 60e3 },
    { label: "In 1 hour", at: n => n + 60 * 60e3 },
    { label: "In 3 hours", at: n => n + 3 * 60 * 60e3 },
    { label: "Tonight 8 PM", at: n => { const t = atTime(20, 0, n); return t > n + 60e3 ? t : atTime(20, 1, n); } },
    { label: "Tomorrow 9 AM", at: n => atTime(9, 1, n) },
];

const REPEATS: { id: Q.Repeat; label: string; }[] = [
    { id: "none", label: "Once" },
    { id: "daily", label: "Daily" },
    { id: "weekly", label: "Weekly" },
];

/** Re-render every second so the countdowns stay live. */
function useNow(ms = 1000) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), ms);
        return () => clearInterval(t);
    }, [ms]);
    return now;
}

// ─── Composer ───

interface Draft {
    editingId: string | null;
    channelId: string;
    content: string;
    sendAt: number;
    repeat: Q.Repeat;
}

function Composer({ draft, setDraft, onDone, now, currentChannelId }: {
    draft: Draft; setDraft(d: Draft): void; onDone(): void; now: number; currentChannelId: string | undefined;
}) {
    const editing = draft.editingId != null;
    const tooSoon = draft.sendAt < now + 5000;
    const { length } = draft.content;
    const valid = !!draft.channelId && draft.content.trim().length > 0 && length <= MAX_LENGTH && !tooSoon;

    const submit = () => {
        if (!valid) return;
        const data = { channelId: draft.channelId, content: draft.content, sendAt: draft.sendAt, repeat: draft.repeat };
        if (editing) Q.updateItem(draft.editingId!, { ...data, status: "pending", error: undefined });
        else Q.addItem(data);
        onDone();
    };

    return (
        <section className={cl("card")}>
            <div className={cl("card-title")}>{editing ? "Edit scheduled message" : "New scheduled message"}</div>

            <div className={cl("field")}>
                <div className={cl("label")}>Send to</div>
                <TargetPicker
                    value={draft.channelId}
                    currentChannelId={currentChannelId}
                    onChange={channelId => setDraft({ ...draft, channelId })}
                />
            </div>

            <div className={cl("field")}>
                <div className={cl("label-row")}>
                    <span className={cl("label")}>Message</span>
                    <span className={classes(cl("counter"), length > MAX_LENGTH && cl("counter-over"))}>{length}/{MAX_LENGTH}</span>
                </div>
                <textarea
                    className={cl("textarea")}
                    value={draft.content}
                    placeholder="What should it say?"
                    onChange={e => setDraft({ ...draft, content: e.currentTarget.value })}
                />
            </div>

            <div className={cl("field")}>
                <div className={cl("label")}>When</div>
                <div className={cl("chips")}>
                    {PRESETS.map(p => (
                        <button key={p.label} type="button" className={cl("chip")} onClick={() => setDraft({ ...draft, sendAt: p.at(Date.now()) })}>
                            {p.label}
                        </button>
                    ))}
                </div>
                <input
                    type="datetime-local"
                    className={cl("datetime")}
                    value={toLocalInput(draft.sendAt)}
                    min={toLocalInput(now)}
                    onChange={e => {
                        const t = fromLocalInput(e.currentTarget.value);
                        if (t != null) setDraft({ ...draft, sendAt: t });
                    }}
                />
            </div>

            <div className={cl("field")}>
                <div className={cl("label")}>Repeat</div>
                <div className={cl("segmented")} role="radiogroup" aria-label="Repeat">
                    {REPEATS.map(r => (
                        <button
                            key={r.id}
                            type="button"
                            role="radio"
                            aria-checked={draft.repeat === r.id}
                            className={classes(cl("segment"), draft.repeat === r.id && cl("segment-active"))}
                            onClick={() => setDraft({ ...draft, repeat: r.id })}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className={classes(cl("summary"), tooSoon && cl("summary-bad"))}>
                {tooSoon
                    ? "Pick a time at least a few seconds from now."
                    : <>Sends <b>{formatWhen(draft.sendAt)}</b> · {relative(draft.sendAt, now)}{draft.repeat !== "none" ? `, then ${draft.repeat}` : ""}</>}
            </div>

            <div className={cl("actions")}>
                {editing && <button type="button" className={cl("btn")} onClick={onDone}>Cancel edit</button>}
                <button type="button" className={classes(cl("btn"), cl("btn-primary"))} disabled={!valid} onClick={submit}>
                    {editing ? "Save changes" : "Schedule"}
                </button>
            </div>
        </section>
    );
}

// ─── Lists ───

function SureButton({ label, run }: { label: string; run(): void; }) {
    const [sure, setSure] = useState(false);
    useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 3000); return () => clearTimeout(t); }, [sure]);
    return sure
        ? <button type="button" className={classes(cl("btn"), cl("btn-small"), cl("btn-sure"))} onClick={run}>Sure?</button>
        : <button type="button" className={classes(cl("btn"), cl("btn-small"), cl("btn-danger"))} onClick={() => setSure(true)}>{label}</button>;
}

function ItemCard({ item, now, children, tone }: { item: Q.ScheduledMessage; now: number; children: React.ReactNode; tone?: "missed" | "failed" | "sent"; }) {
    const when = item.status === "pending"
        ? `${formatWhen(item.sendAt)} · ${relative(item.sendAt, now)}`
        : item.status === "missed"
            ? `Was due ${formatWhen(item.sendAt)}`
            : `${item.status === "sent" ? "Sent" : "Failed"} ${formatWhen(item.sentAt ?? item.sendAt)}`;

    return (
        <div className={classes(cl("item"), tone && cl(`item-${tone}`))}>
            <div className={cl("item-head")}>
                <TargetChip channelId={item.channelId} />
                {item.repeat !== "none" && <span className={cl("badge")}>{item.repeat === "daily" ? "Daily" : "Weekly"}</span>}
                {tone === "missed" && <span className={classes(cl("badge"), cl("badge-warn"))}>Missed</span>}
                {tone === "failed" && <span className={classes(cl("badge"), cl("badge-bad"))}>Failed</span>}
                {tone === "sent" && <span className={classes(cl("badge"), cl("badge-good"))}>Sent</span>}
            </div>
            <div className={cl("item-when")}>{when}</div>
            <div className={cl("item-content")}>{item.content}</div>
            {item.error && <div className={cl("item-error")}>{item.error}</div>}
            <div className={cl("item-actions")}>{children}</div>
        </div>
    );
}

function ListPanel({ now, onEdit, onReuse }: { now: number; onEdit(item: Q.ScheduledMessage): void; onReuse(item: Q.ScheduledMessage): void; }) {
    Q.useQueue();
    const [tab, setTab] = useState<"upcoming" | "history">("upcoming");
    const pending = Q.pending();
    const missed = Q.missed();
    const hist = Q.history();

    return (
        <section className={classes(cl("card"), cl("list"))}>
            <div className={cl("tabs")} role="tablist">
                <button type="button" role="tab" aria-selected={tab === "upcoming"}
                    className={classes(cl("tab"), tab === "upcoming" && cl("tab-active"))} onClick={() => setTab("upcoming")}>
                    Upcoming <span className={cl("tab-count")}>{pending.length + missed.length}</span>
                </button>
                <button type="button" role="tab" aria-selected={tab === "history"}
                    className={classes(cl("tab"), tab === "history" && cl("tab-active"))} onClick={() => setTab("history")}>
                    History <span className={cl("tab-count")}>{hist.length}</span>
                </button>
                {tab === "history" && hist.length > 0 && (
                    <button type="button" className={cl("link")} onClick={Q.clearHistory}>Clear</button>
                )}
            </div>

            <div className={cl("list-body")}>
                {tab === "upcoming" ? (
                    pending.length + missed.length === 0 ? (
                        <div className={cl("empty")}><span className={cl("empty-icon")}>🕑</span>Nothing scheduled yet. Write a message and pick a time.</div>
                    ) : (
                        <>
                            {missed.map(item => (
                                <ItemCard key={item.id} item={item} now={now} tone="missed">
                                    <button type="button" className={classes(cl("btn"), cl("btn-small"), cl("btn-primary"))} onClick={() => sendOne(item)}>Send now</button>
                                    <button type="button" className={classes(cl("btn"), cl("btn-small"))} onClick={() => onEdit(item)}>Reschedule</button>
                                    <SureButton label="Discard" run={() => Q.removeItem(item.id)} />
                                </ItemCard>
                            ))}
                            {pending.map(item => (
                                <ItemCard key={item.id} item={item} now={now}>
                                    <button type="button" className={classes(cl("btn"), cl("btn-small"))} onClick={() => onEdit(item)}>Edit</button>
                                    <button type="button" className={classes(cl("btn"), cl("btn-small"))} onClick={() => sendOne(item)}>Send now</button>
                                    <SureButton label="Cancel" run={() => Q.removeItem(item.id)} />
                                </ItemCard>
                            ))}
                        </>
                    )
                ) : hist.length === 0 ? (
                    <div className={cl("empty")}><span className={cl("empty-icon")}>📬</span>Sent and failed messages show up here.</div>
                ) : hist.map(item => (
                    <ItemCard key={item.id} item={item} now={now} tone={item.status === "sent" ? "sent" : "failed"}>
                        <button type="button" className={classes(cl("btn"), cl("btn-small"))} onClick={() => onReuse(item)}>Schedule again</button>
                        <SureButton label="Remove" run={() => Q.removeItem(item.id)} />
                    </ItemCard>
                ))}
            </div>
        </section>
    );
}

// ─── Window ───

export interface Prefill { content?: string; sendAt?: number; }

function SchedulerModal({ modalProps, initialChannelId, prefill }: { modalProps: RenderModalProps; initialChannelId?: string; prefill?: Prefill; }) {
    Q.useQueue();
    const now = useNow();
    const accent = windowAccent("scheduledMessages");

    const fresh = (channelId = initialChannelId ?? ""): Draft => ({
        editingId: null, channelId, content: "", sendAt: Date.now() + 60 * 60e3, repeat: "none",
    });
    const [draft, setDraft] = useState<Draft>(() => ({ ...fresh(), ...(prefill?.content != null && { content: prefill.content }), ...(prefill?.sendAt && { sendAt: prefill.sendAt }) }));

    const next = Q.pending()[0];
    const missedCount = Q.missed().length;
    const subtitle = [
        `${Q.pending().length} upcoming`,
        next && `next ${relative(next.sendAt, now)}`,
        missedCount && `${missedCount} missed`,
    ].filter(Boolean).join(" · ");

    return (
        <Window {...modalProps} size="lg" title="Scheduled Messages" subtitle={subtitle}>
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon={missedCount ? "⚠️" : "🕑"}
                    kicker={missedCount ? `${missedCount} missed` : next ? "Next message" : "Scheduled Messages"}
                    title={next ? <span className={cl("hero-msg")}>{next.content}</span> : "Nothing scheduled"}
                    sub={next ? <span className={cl("hero-sub")}><TargetChip channelId={next.channelId} /><span className={cl("hero-count")}>{relative(next.sendAt, now)}</span></span> : "Write a message, pick a time, and Sonata sends it for you — even if you're away."}
                    numbers={[{ value: Q.pending().length, label: "upcoming" }, { value: Q.history().filter(i => i.status === "sent").length, label: "sent" }]} />
                <div className={cl("layout")}>
                    <Composer
                        draft={draft}
                        setDraft={setDraft}
                        now={now}
                        currentChannelId={initialChannelId}
                        onDone={() => setDraft(fresh(draft.channelId))}
                    />
                    <ListPanel
                        now={now}
                        onEdit={item => setDraft({
                            editingId: item.id,
                            channelId: item.channelId,
                            content: item.content,
                            // A missed item gets a fresh suggestion in the future.
                            sendAt: item.sendAt > Date.now() + 5000 ? item.sendAt : Date.now() + 15 * 60e3,
                            repeat: item.repeat,
                        })}
                        onReuse={item => setDraft({ ...fresh(item.channelId), content: item.content })}
                    />
                </div>
            </div>
        </Window>
    );
}

export function openScheduler(channelId?: string, prefill?: Prefill) { openSection("planner", "scheduledMessages", props => renderScheduler(props, channelId, prefill)); }

export function renderScheduler(props: RenderModalProps, ...[channelId, prefill]: Parameters<typeof openScheduler>) {
    const id = channelId ?? SelectedChannelStore.getChannelId() ?? undefined;
    return (<SchedulerModal modalProps={props} initialChannelId={id} prefill={prefill} />);
}
