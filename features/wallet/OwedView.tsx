/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// "Who owes me": add what someone owes you (pick them by searching, pasting
// their ID, from a list of your friends and DMs, or just type a name), tick
// it off as they pay — all at once or a bit at a time — and nudge them with
// a reminder that goes in your chat box for you to send.

import { insertTextIntoChatInputBox, openPrivateChannel } from "@utils/discord";
import { classes } from "@utils/misc";
import { ChannelStore, IconUtils, NavigationRouter, RelationshipStore, showToast, useEffect, useMemo, UserStore, UserUtils, useState } from "@webpack/common";

import { ToolHero } from "../_shared/ToolHero";
import { addDebt, Debt, left, payPart, personKey, removeDebt, settle, settleAll, totals, useOwed } from "./owedStore";
import { CURRENCIES, money, togglePaid, useRequests } from "./payRequests";

const SNOWFLAKE = /^\d{17,20}$/;
const DAY = 86_400_000;

interface Person { userId?: string; name: string; username?: string; avatar?: string | null; }

const nameOf = (u: any) => u?.globalName ?? u?.global_name ?? u?.username ?? "Unknown user";
const personFrom = (u: any): Person => ({ userId: u.id, name: nameOf(u), username: u.username, avatar: u.avatar ?? null });

function avatarOf(p: Person, size = 64) {
    if (!p.userId) return null;
    const u: any = UserStore.getUser(p.userId);
    if (u) { try { return IconUtils.getUserAvatarURL(u, false, size); } catch { } }
    if (p.avatar) return `https://cdn.discordapp.com/avatars/${p.userId}/${p.avatar}.webp?size=${size}`;
    try { return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(p.userId) >> 22n) % 6n)}.png`; } catch { return null; }
}

function Face({ p, size }: { p: Person; size: number; }) {
    const src = avatarOf(p, size * 2);
    return src
        ? <img className="vc-wallet-owe-face" src={src} alt="" width={size} height={size} />
        : <span className="vc-wallet-owe-face vc-wallet-owe-letter" style={{ width: size, height: size }}>{p.name.trim()[0]?.toUpperCase() ?? "?"}</span>;
}

/** Your friends and the people you DM, best-known first, for the dropdown and the search. */
function knownPeople(): Person[] {
    const me = UserStore.getCurrentUser()?.id;
    const seen = new Set<string>();
    const out: Person[] = [];
    const add = (u: any) => { if (u && u.id !== me && !u.bot && !seen.has(u.id)) { seen.add(u.id); out.push(personFrom(u)); } };
    for (const ch of (ChannelStore as any).getSortedPrivateChannels?.() ?? []) if (ch.type === 1) add(UserStore.getUser(ch.recipients?.[0]));
    for (const id of RelationshipStore.getFriendIDs?.() ?? []) add(UserStore.getUser(id));
    return out;
}

/* ── Picking who ── */

function PersonPicker({ value, onChange }: { value: Person | null; onChange(p: Person | null): void; }) {
    const [query, setQuery] = useState("");
    const [focused, setFocused] = useState(false);
    const [lookup, setLookup] = useState<Person | "none" | "loading" | null>(null);
    const people = useMemo(knownPeople, []);
    const byName = useMemo(() => [...people].sort((a, b) => a.name.localeCompare(b.name)), [people]);

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

    const pick = (p: Person) => { onChange(p); setQuery(""); setFocused(false); };
    const matches = SNOWFLAKE.test(q)
        ? (lookup && typeof lookup === "object" ? [lookup] : [])
        : people.filter(p => !q || `${p.name} ${p.username ?? ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 7);

    if (value) {
        return (
            <button type="button" className="vc-wallet-owe-picked" onClick={() => onChange(null)} title="Pick someone else">
                <Face p={value} size={30} />
                <span className="vc-wallet-owe-who"><b>{value.name}</b><small>{value.username ? `@${value.username}` : "Not on Discord"}</small></span>
                <span className="vc-tool-link">Change</span>
            </button>
        );
    }

    return (
        <div className="vc-wallet-owe-picker">
            <div className="vc-tool-row">
                <input className="vc-tool-input vc-tool-grow" value={query} placeholder="Search friends and DMs, paste a user ID, or type any name"
                    onFocus={() => setFocused(true)} onBlur={() => setTimeout(() => setFocused(false), 120)}
                    onChange={e => { setQuery(e.currentTarget.value); setFocused(true); }}
                    onKeyDown={e => {
                        if (e.key !== "Enter") return;
                        if (matches[0]) pick(matches[0]);
                        else if (q && !SNOWFLAKE.test(q)) pick({ name: q });
                    }} />
                <select className="vc-tool-select vc-wallet-owe-select" value="" aria-label="Pick from your friends and DMs"
                    onChange={e => { const p = byName.find(x => x.userId === e.currentTarget.value); if (p) pick(p); }}>
                    <option value="">Pick from list…</option>
                    {byName.map(p => <option key={p.userId} value={p.userId}>{p.name}{p.username && p.username !== p.name ? ` (@${p.username})` : ""}</option>)}
                </select>
            </div>
            {focused && q && (
                <div className="vc-wallet-owe-menu">
                    {lookup === "loading" && <div className="vc-tool-hint">Looking up that ID…</div>}
                    {lookup === "none" && <div className="vc-tool-hint">No Discord user with that ID.</div>}
                    {matches.map(p => (
                        <button key={p.userId} type="button" className="vc-wallet-owe-option" onMouseDown={e => { e.preventDefault(); pick(p); }}>
                            <Face p={p} size={26} />
                            <span className="vc-wallet-owe-who"><b>{p.name}</b>{p.username && <small>@{p.username}</small>}</span>
                        </button>
                    ))}
                    {!SNOWFLAKE.test(q) && (
                        <button type="button" className="vc-wallet-owe-option" onMouseDown={e => { e.preventDefault(); pick({ name: q }); }}>
                            <span className="vc-wallet-owe-face vc-wallet-owe-letter" style={{ width: 26, height: 26 }}>✏️</span>
                            <span className="vc-wallet-owe-who"><b>Use “{q}”</b><small>Someone who isn't on Discord, or you'd rather not pick</small></span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

/* ── Adding ── */

function AddForm({ onDone, start }: { onDone(): void; start?: Person | null; }) {
    const [person, setPerson] = useState<Person | null>(start ?? null);
    const [amount, setAmount] = useState("");
    const [currency, setCurrency] = useState("USD");
    const [note, setNote] = useState("");
    const [due, setDue] = useState("");
    const cents = Math.round(Number(amount.replace(",", ".")) * 100);
    const ok = !!person && cents > 0;

    const save = () => {
        if (!person || !ok) return;
        addDebt({ ...person, amount: cents, currency, note: note.trim(), dueAt: due ? new Date(`${due}T12:00`).getTime() : undefined });
        showToast(`Added: ${person.name} owes you ${money(cents, currency)}`, "success");
        onDone();
    };

    return (
        <section className="vc-wallet-owe-form">
            <div className="vc-tool-field">
                <span className="vc-tool-label">Who</span>
                <PersonPicker value={person} onChange={setPerson} />
            </div>
            <div className="vc-wallet-owe-form-row">
                <label className="vc-tool-field">
                    <span className="vc-tool-label">How much</span>
                    <div className="vc-tool-row">
                        <select className="vc-tool-select" value={currency} onChange={e => setCurrency(e.currentTarget.value)} aria-label="Currency">
                            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input className="vc-tool-input vc-tool-grow" inputMode="decimal" value={amount} placeholder="10.00"
                            onChange={e => setAmount(e.currentTarget.value.replace(/[^\d.,]/g, ""))} onKeyDown={e => { if (e.key === "Enter") save(); }} />
                    </div>
                </label>
                <label className="vc-tool-field vc-tool-grow">
                    <span className="vc-tool-label">What for</span>
                    <input className="vc-tool-input" value={note} maxLength={80} placeholder="pizza 🍕, concert tickets, the Uber…" onChange={e => setNote(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") save(); }} />
                </label>
                <label className="vc-tool-field">
                    <span className="vc-tool-label">Pay by (optional)</span>
                    <input className="vc-tool-input" type="date" value={due} onChange={e => setDue(e.currentTarget.value)} />
                </label>
            </div>
            <div className="vc-tool-row">
                <span className="vc-tool-spacer" />
                <button type="button" className="vc-tool-btn" onClick={onDone}>Cancel</button>
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!ok} onClick={save}>Add{ok ? ` · ${money(cents, currency)}` : ""}</button>
            </div>
        </section>
    );
}

/* ── One person ── */

const when = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
const sumText = (by: Record<string, number>) => Object.entries(by).map(([c, v]) => money(v, c)).join(" · ");

async function remind(p: Person, open: Debt[], close: () => void) {
    const what = open.map(d => `${money(left(d), d.currency)}${d.note ? ` for ${d.note}` : ""}`).join(", ");
    const text = `Hey ${p.name}! Just a reminder about the ${what} 🙂`;
    if (!p.userId) {
        try { await navigator.clipboard.writeText(text); showToast("Reminder copied — paste it wherever you talk to them", "success"); } catch { showToast("Couldn't copy the reminder", "failure"); }
        return;
    }
    let channelId: string | undefined = ChannelStore.getDMFromUserId(p.userId);
    if (!channelId) {
        const r: any = await openPrivateChannel(p.userId, false).catch(() => null);
        channelId = (typeof r === "string" ? r : r?.id) ?? ChannelStore.getDMFromUserId(p.userId);
    }
    if (!channelId) return showToast("Couldn't open a DM with them", "failure");
    close();
    NavigationRouter.transitionTo(`/channels/@me/${channelId}`);
    // In the box, not sent: you read it over and press Enter yourself.
    setTimeout(() => insertTextIntoChatInputBox(text), 500);
}

function DebtLine({ d }: { d: Debt; }) {
    const [paying, setPaying] = useState(false);
    const [part, setPart] = useState("");
    const [sure, setSure] = useState(false);
    useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 3000); return () => clearTimeout(t); }, [sure]);
    const owed = left(d);
    const late = !d.settledAt && d.dueAt != null && d.dueAt < Date.now() - DAY / 2;
    const cents = Math.round(Number(part.replace(",", ".")) * 100);
    return (
        <div className={classes("vc-wallet-owe-line", !!d.settledAt && "vc-wallet-owe-line-done", late && "vc-wallet-owe-line-late")}>
            <button type="button" className={classes("vc-wallet-owe-tick", !!d.settledAt && "vc-wallet-owe-tick-on")} title={d.settledAt ? "Mark as not paid" : "Mark as paid"} onClick={() => settle(d.id, !d.settledAt)}>✓</button>
            <div className="vc-wallet-owe-what">
                <b>{d.note || "Money"}</b>
                <small>
                    Added {when(d.createdAt)}
                    {d.dueAt != null && !d.settledAt && <> · <span className={late ? "vc-wallet-owe-late" : undefined}>{late ? "was due" : "due"} {when(d.dueAt)}</span></>}
                    {!!d.settledAt && <> · paid {when(d.settledAt)}</>}
                    {!d.settledAt && d.paid > 0 && <> · {money(d.paid, d.currency)} of {money(d.amount, d.currency)} paid</>}
                </small>
                {!d.settledAt && d.paid > 0 && <div className="vc-wallet-owe-progress"><i style={{ width: `${d.paid / d.amount * 100}%` }} /></div>}
            </div>
            {paying ? (
                <span className="vc-wallet-owe-pay">
                    <input className="vc-tool-input" autoFocus inputMode="decimal" value={part} placeholder="5.00" onChange={e => setPart(e.currentTarget.value.replace(/[^\d.,]/g, ""))}
                        onKeyDown={e => { if (e.key === "Enter" && cents > 0) { payPart(d.id, cents); setPaying(false); setPart(""); } if (e.key === "Escape") setPaying(false); }} />
                    <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!(cents > 0)} onClick={() => { payPart(d.id, cents); setPaying(false); setPart(""); }}>Add</button>
                </span>
            ) : !d.settledAt && <button type="button" className="vc-tool-btn" title="They paid some of it back" onClick={() => setPaying(true)}>+ Part paid</button>}
            <span className={classes("vc-wallet-owe-amount", !!d.settledAt && "vc-wallet-owe-amount-done")}>{money(d.settledAt ? d.amount : owed, d.currency)}</span>
            {sure
                ? <button type="button" className="vc-tool-btn vc-tool-danger" onClick={() => removeDebt(d.id)}>Delete</button>
                : <button type="button" className="vc-wallet-x" title="Delete" aria-label="Delete" onClick={() => setSure(true)}>✕</button>}
        </div>
    );
}

function PersonCard({ p, debts, showDone, onAdd, close }: { p: Person; debts: Debt[]; showDone: boolean; onAdd(): void; close(): void; }) {
    const open = debts.filter(d => !d.settledAt);
    const shown = showDone ? debts : open;
    const late = open.some(d => d.dueAt != null && d.dueAt < Date.now() - DAY / 2);
    return (
        <section className={classes("vc-wallet-owe-card", !open.length && "vc-wallet-owe-card-done", late && "vc-wallet-owe-card-late")}>
            <header className="vc-wallet-owe-head">
                <Face p={p} size={38} />
                <span className="vc-wallet-owe-who"><b>{p.name}</b><small>{p.username ? `@${p.username}` : "Not on Discord"} · {open.length ? `${open.length} thing${open.length === 1 ? "" : "s"} open` : "all paid up 🎉"}</small></span>
                <span className="vc-wallet-owe-total">{open.length ? sumText(totals(open)) : "✓"}</span>
            </header>
            {shown.length > 0 && <div className="vc-wallet-owe-lines">{shown.map(d => <DebtLine key={d.id} d={d} />)}</div>}
            <div className="vc-tool-row">
                <button type="button" className="vc-tool-btn" onClick={onAdd}>+ Add more</button>
                {open.length > 0 && <button type="button" className="vc-tool-btn" title={p.userId ? "Opens your DM with them and puts a friendly reminder in the message box — you send it" : "Copies a friendly reminder"} onClick={() => void remind(p, open, close)}>💬 Remind</button>}
                <span className="vc-tool-spacer" />
                {open.length > 1 && <button type="button" className="vc-tool-link" onClick={() => settleAll(personKey(open[0]))}>All paid</button>}
            </div>
        </section>
    );
}

/* ── The tab ── */

export function OwedView({ close }: { close(): void; }) {
    const debts = useOwed();
    const requests = useRequests();
    const [adding, setAdding] = useState<Person | null | false>(false);
    const [showDone, setShowDone] = useState(false);

    const groups = useMemo(() => {
        const m = new Map<string, { p: Person; debts: Debt[]; }>();
        for (const d of debts) {
            const k = personKey(d);
            const g = m.get(k) ?? { p: { userId: d.userId, name: d.name, username: d.username, avatar: d.avatar }, debts: [] };
            g.debts.push(d);
            m.set(k, g);
        }
        const owed = (g: { debts: Debt[]; }) => g.debts.reduce((s, d) => s + left(d), 0);
        return [...m.values()].sort((a, b) => owed(b) - owed(a) || Math.max(...b.debts.map(d => d.createdAt)) - Math.max(...a.debts.map(d => d.createdAt)));
    }, [debts]);

    const open = debts.filter(d => !d.settledAt);
    const visible = showDone ? groups : groups.filter(g => g.debts.some(d => !d.settledAt));
    const lateCount = open.filter(d => d.dueAt != null && d.dueAt < Date.now() - DAY / 2).length;
    // People still to tick off on your money requests.
    const fromRequests = requests.flatMap(r => r.people.filter(p => !p.paid).map(p => ({ r, name: p.name })));

    return (
        <div className="vc-wallet-owe">
            <ToolHero icon="🧾" kicker="Who owes me"
                title={open.length ? sumText(totals(open)) : "Nobody owes you anything"}
                sub={open.length ? `${new Set(open.map(personKey)).size} ${new Set(open.map(personKey)).size === 1 ? "person" : "people"}${lateCount ? ` · ${lateCount} overdue` : ""}` : "Add what someone owes you and tick it off when they pay you back."}
                numbers={[{ value: open.length, label: "open" }, { value: debts.length - open.length, label: "paid" }]} />

            {adding !== false ? <AddForm start={adding} onDone={() => setAdding(false)} /> : (
                <div className="vc-tool-row">
                    <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => setAdding(null)}>+ Someone owes me</button>
                    <span className="vc-tool-spacer" />
                    {debts.length > open.length && (
                        <label className="vc-wallet-owe-toggle"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.currentTarget.checked)} /> Show paid</label>
                    )}
                </div>
            )}

            {visible.length ? (
                <div className="vc-wallet-owe-list">
                    {visible.map(g => <PersonCard key={personKey(g.debts[0])} p={g.p} debts={g.debts} showDone={showDone} onAdd={() => setAdding(g.p)} close={close} />)}
                </div>
            ) : adding === false && (
                <div className="vc-tool-empty">
                    <span className="vc-tool-empty-icon">🧾</span>
                    {debts.length ? "Everyone's paid you back. 🎉" : "Nobody yet. Press “Someone owes me” to add the first."}
                </div>
            )}

            {fromRequests.length > 0 && (
                <section className="vc-wallet-section">
                    <span className="vc-tool-label">From your money requests · {fromRequests.length}</span>
                    <div className="vc-wallet-owe-lines">
                        {fromRequests.map(({ r, name }) => (
                            <div key={`${r.id}-${name}`} className="vc-wallet-owe-line">
                                <button type="button" className="vc-wallet-owe-tick" title="Mark as paid" onClick={() => togglePaid(r.id, name)}>✓</button>
                                <div className="vc-wallet-owe-what"><b>{name}</b><small>{r.note || "Money request"} · {when(r.createdAt)}</small></div>
                                <span className="vc-wallet-owe-amount">{money(r.amount, r.currency)}</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            <span className="vc-tool-hint">Kept only on this computer. Reminders go in your message box — nothing is ever sent for you.</span>
        </div>
    );
}
