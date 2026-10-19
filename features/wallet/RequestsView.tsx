/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Asking for money: make a card ("Pay Sam $10 for pizza 🍕") with your QR code
// and pay links, send it, and tick people off as they pay you back.

import { insertTextIntoChatInputBox } from "@utils/discord";
import { classes } from "@utils/misc";
import { ChannelStore, DraftType, SelectedChannelStore, showToast, UploadHandler, useEffect, useMemo, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { Entry, kindOf, tidy,title } from "./kinds";
import { allRequests, CURRENCIES, loadRequests, money, payLink, PayRequest, putRequest, removeRequest, togglePaid, useRequests } from "./payRequests";
import { requestCardPng } from "./requestCard";
import { qrPrefs } from "./store";

const hex6 = (h: string) => /^#[0-9a-f]{3}$/i.test(h) ? `#${[...h.slice(1)].map(c => c + c).join("")}` : h;
const myName = () => qrPrefs.name || (UserStore.getCurrentUser() as any)?.globalName || UserStore.getCurrentUser()?.username || "";

/** People in the chat you're in (DMs and group DMs), to add with one click. */
function chatPeople(): string[] {
    const ch: any = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
    return (ch?.recipients ?? []).map((id: string) => { const u: any = UserStore.getUser(id); return u?.globalName || u?.username; }).filter(Boolean);
}

/** The message that goes with the card: the amount, and how to pay. */
function messageFor(r: Pick<PayRequest, "amount" | "currency" | "note">, methods: Entry[], who?: string[]) {
    const head = `${who?.length ? `${who.join(", ")} — ` : ""}💸 **${money(r.amount, r.currency)}**${r.note ? ` for ${r.note}` : ""}`;
    const ways = methods.map(e => { const k = kindOf(e.kind); const link = payLink(e, r.amount, r.currency, r.note); return `**${k.name}:** ${k.crypto ? `\`${tidy(e)}\`` : link ?? tidy(e)}`; });
    return [head, ...ways].join("\n");
}

async function cardFile(r: Pick<PayRequest, "amount" | "currency" | "note">, methods: Entry[], qrId: string | null) {
    const qr = methods.find(e => e.id === qrId) ?? null;
    const blob = await requestCardPng({ cents: r.amount, currency: r.currency, note: r.note, name: myName(), qr, others: methods.filter(e => e !== qr), accent: hex6(windowAccent("wallet")) });
    return new File([blob], `pay-${money(r.amount, r.currency).replace(/[^\w.]+/g, "")}.png`, { type: "image/png" });
}

function NewRequest({ entries, onDone }: { entries: Entry[]; onDone(): void; }) {
    const [amount, setAmount] = useState("");
    const [currency, setCurrency] = useState("USD");
    const [note, setNote] = useState("");
    const [people, setPeople] = useState<string[]>([]);
    const [person, setPerson] = useState("");
    const [methods, setMethods] = useState<string[]>(() => entries.filter(e => !kindOf(e.kind).crypto).map(e => e.id).slice(0, 4));
    const [qrId, setQrId] = useState<string | null>(() => entries.find(e => !kindOf(e.kind).crypto)?.id ?? entries[0]?.id ?? null);
    const [preview, setPreview] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const cents = Math.round(Number(amount.replace(",", ".")) * 100);
    const valid = Number.isFinite(cents) && cents > 0 && methods.length > 0;
    const picked = entries.filter(e => methods.includes(e.id));
    const suggestions = chatPeople().filter(n => !people.includes(n));
    const r = { amount: valid ? cents : 0, currency, note: note.trim() };

    // A live preview of the card.
    useEffect(() => {
        if (!valid) { setPreview(null); return; }
        let url: string | null = null, live = true;
        const t = setTimeout(async () => {
            const f = await cardFile(r, picked, qrId).catch(() => null);
            if (f && live) { url = URL.createObjectURL(f); setPreview(url); }
        }, 250);
        return () => { live = false; clearTimeout(t); if (url) URL.revokeObjectURL(url); };
    }, [cents, currency, note, methods.join(), qrId, valid]);

    const addPerson = (n: string) => { const v = n.trim(); if (v && !people.includes(v)) setPeople([...people, v]); setPerson(""); };
    const save = () => putRequest({ id: `r${Date.now().toString(36)}`, ...r, people: people.map(name => ({ name, paid: false })), methods, createdAt: Date.now() });

    const send = async () => {
        const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
        if (!channel) { showToast("Open a chat first", "failure"); return; }
        setBusy(true);
        try {
            UploadHandler.promptToUpload([await cardFile(r, picked, qrId)], channel, DraftType.ChannelMessage);
            insertTextIntoChatInputBox(messageFor(r, picked));
            save();
            showToast("Your request is in the message box — send it when you're ready", "success");
            onDone();
        } catch { showToast("Couldn't make the card", "failure"); } finally { setBusy(false); }
    };
    const copy = async () => {
        setBusy(true);
        try {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": await cardFile(r, picked, qrId) })]);
            save();
            showToast("Card copied — paste it anywhere", "success");
            onDone();
        } catch { showToast("Couldn't copy the card", "failure"); } finally { setBusy(false); }
    };

    return (
        <div className="vc-wallet-req">
            <div className="vc-wallet-req-form">
                <div className="vc-wallet-req-amount">
                    <select className="vc-tool-select" value={currency} onChange={e => setCurrency(e.currentTarget.value)} aria-label="Currency">
                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input className="vc-tool-input" autoFocus inputMode="decimal" value={amount} placeholder="10.00" onChange={e => setAmount(e.currentTarget.value.replace(/[^\d.,]/g, ""))} />
                </div>
                <label className="vc-tool-field">
                    <span className="vc-tool-label">What for</span>
                    <input className="vc-tool-input" value={note} maxLength={60} placeholder="pizza 🍕, tickets, the hotel…" onChange={e => setNote(e.currentTarget.value)} />
                </label>
                <div className="vc-tool-field">
                    <span className="vc-tool-label">Ways to pay</span>
                    <div className="vc-tool-chips">
                        {entries.map(e => (
                            <button key={e.id} type="button" className={classes("vc-tool-chip", methods.includes(e.id) && "vc-tool-chip-on")}
                                onClick={() => setMethods(m => m.includes(e.id) ? m.filter(x => x !== e.id) : [...m, e.id])}>
                                {kindOf(e.kind).glyph} {title(e)}
                            </button>
                        ))}
                    </div>
                </div>
                {picked.length > 0 && (
                    <div className="vc-tool-field">
                        <span className="vc-tool-label">QR code for</span>
                        <div className="vc-tool-chips">
                            <button type="button" className={classes("vc-tool-chip", !picked.some(e => e.id === qrId) && "vc-tool-chip-on")} onClick={() => setQrId(null)}>No QR</button>
                            {picked.map(e => <button key={e.id} type="button" className={classes("vc-tool-chip", qrId === e.id && "vc-tool-chip-on")} onClick={() => setQrId(e.id)}>{kindOf(e.kind).name}</button>)}
                        </div>
                    </div>
                )}
                <div className="vc-tool-field">
                    <span className="vc-tool-label">Who owes you (optional — to tick off as they pay)</span>
                    <div className="vc-tool-row">
                        <input className="vc-tool-input vc-tool-grow" value={person} placeholder="Type a name, press Enter" onChange={e => setPerson(e.currentTarget.value)}
                            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addPerson(person); } }} />
                        <button type="button" className="vc-tool-btn" disabled={!person.trim()} onClick={() => addPerson(person)}>Add</button>
                    </div>
                    {(people.length > 0 || suggestions.length > 0) && (
                        <div className="vc-tool-chips">
                            {people.map(n => <button key={n} type="button" className="vc-tool-chip vc-tool-chip-on" title="Remove" onClick={() => setPeople(people.filter(x => x !== n))}>{n} ✕</button>)}
                            {suggestions.slice(0, 6).map(n => <button key={n} type="button" className="vc-tool-chip" onClick={() => addPerson(n)}>＋ {n}</button>)}
                        </div>
                    )}
                </div>
            </div>
            <div className="vc-wallet-req-preview">
                {preview ? <img src={preview} alt="Your card" /> : <div className="vc-tool-empty"><span className="vc-tool-empty-icon">💸</span>{entries.length ? "Type an amount to see your card." : "Add a payment app or address first."}</div>}
                <div className="vc-wallet-req-btns">
                    <button type="button" className="vc-tool-btn" onClick={onDone}>Cancel</button>
                    <button type="button" className="vc-tool-btn" disabled={!valid || busy} onClick={() => void copy()}>Copy card</button>
                    <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!valid || busy} onClick={() => void send()}>{busy ? "Making it…" : "Put in message"}</button>
                </div>
            </div>
        </div>
    );
}

function RequestCard({ r, entries }: { r: PayRequest; entries: Entry[]; }) {
    const [sure, setSure] = useState(false);
    useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 3000); return () => clearTimeout(t); }, [sure]);
    const paid = r.people.filter(p => p.paid).length;
    const total = r.people.length;
    const done = total > 0 && paid === total;
    const methods = entries.filter(e => r.methods.includes(e.id));
    const remind = () => {
        const owing = r.people.filter(p => !p.paid).map(p => p.name);
        insertTextIntoChatInputBox(`Hey! Just a reminder about ${messageFor(r, methods, owing).replace(/^.*? — /, "")} 🙏`);
        showToast("Reminder put in your message box", "success");
    };
    return (
        <div className={classes("vc-wallet-reqcard", done && "vc-wallet-reqcard-done")}>
            <div className="vc-wallet-reqcard-head">
                <b>{money(r.amount, r.currency)}</b>
                <span className="vc-wallet-reqcard-note">{r.note || "Money request"}</span>
                <span className="vc-tool-spacer" />
                <span className="vc-tool-hint">{new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            </div>
            {total > 0 ? (
                <>
                    <div className="vc-wallet-reqbar"><i style={{ width: `${paid / total * 100}%` }} /></div>
                    <span className="vc-tool-hint">{done ? `Everyone's paid 🎉 · ${money(r.amount * total, r.currency)} back` : `${paid} of ${total} paid · ${money(r.amount * paid, r.currency)} of ${money(r.amount * total, r.currency)}`}</span>
                    <div className="vc-wallet-payers">
                        {r.people.map(p => (
                            <button key={p.name} type="button" className={classes("vc-wallet-payer", p.paid && "vc-wallet-payer-paid")} onClick={() => togglePaid(r.id, p.name)}
                                title={p.paid ? `Paid ${p.paidAt ? new Date(p.paidAt).toLocaleDateString() : ""} — click to undo` : "Click when they've paid"}>
                                <span className="vc-wallet-payer-tick">{p.paid ? "✓" : ""}</span>{p.name}
                            </button>
                        ))}
                    </div>
                </>
            ) : <span className="vc-tool-hint">Nobody added to track.</span>}
            <div className="vc-tool-row">
                {!done && total > 0 && <button type="button" className="vc-tool-btn" onClick={remind}>🔔 Remind</button>}
                <span className="vc-tool-spacer" />
                {sure
                    ? <button type="button" className="vc-tool-btn vc-wallet-sure" onClick={() => removeRequest(r.id)}>Delete</button>
                    : <button type="button" className="vc-wallet-x" title="Delete" aria-label="Delete" onClick={() => setSure(true)}>✕</button>}
            </div>
        </div>
    );
}

export function RequestsView({ entries }: { entries: Entry[]; }) {
    const requests = useRequests();
    // Straight to a new request when there are none yet (once they have loaded).
    const [making, setMaking] = useState(false);
    useEffect(() => { void loadRequests().then(() => { if (!allRequests().length) setMaking(true); }); }, []);
    const owed = useMemo(() => requests.reduce<Record<string, number>>((m, r) => { m[r.currency] = (m[r.currency] ?? 0) + r.amount * r.people.filter(p => !p.paid).length; return m; }, {}), [requests]);
    const owedText = Object.entries(owed).filter(([, v]) => v > 0).map(([c, v]) => money(v, c)).join(" + ");

    return (
        <div className="vc-wallet-requests">
            <div className="vc-wallet-bar">
                {!making && <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => setMaking(true)}>＋ New request</button>}
                <span className="vc-tool-spacer" />
                {owedText && <span className="vc-wallet-owed">Still owed: <b>{owedText}</b></span>}
            </div>
            {making ? <NewRequest entries={entries} onDone={() => setMaking(false)} /> : requests.length ? (
                <div className="vc-wallet-reqgrid">{requests.map(r => <RequestCard key={r.id} r={r} entries={entries} />)}</div>
            ) : (
                <div className="vc-tool-empty"><span className="vc-tool-empty-icon">💸</span>No requests yet.</div>
            )}
        </div>
    );
}
