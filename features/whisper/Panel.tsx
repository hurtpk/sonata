/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Whisper's window. Write: up to two secrets, each with who can read it
// (anyone with Sonata, a password, or a paired friend), a cover, and when it
// stops opening. History: whispers you've opened. Keys: your password book
// and paired friends. A whisper goes in your message box; you send it.

import { insertTextIntoChatInputBox } from "@utils/discord";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, GuildStore, Modal, NavigationRouter, openModal, SelectedChannelStore, showToast, useEffect, useRef, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { hide, lengthOf, LIMIT, pairMessage, Secret } from "./codec";
import { clearHistory, forget, useHistory } from "./historyStore";
import { myIdentity, noteOffer, offeredTo, removePair, removePassword, renamePassword, savePassword, useKeys } from "./keys";
import { Choice, choiceKey, sealOf } from "./locks";
import { settings } from "./settings";

const COVERS = ["lol same", "ok sounds good", "haha yeah", "wait really", "nice 👍", "true true", "fr", "omg", "sounds good to me", "lmao"];
const coverPick = () => COVERS[Math.floor(Math.random() * COVERS.length)];
const EXPIRY: [number, string][] = [[0, "Never"], [3600, "1 hour"], [86400, "1 day"], [604800, "1 week"]];

const nameOf = (u: any) => u?.globalName ?? u?.global_name ?? u?.username ?? "them";

/** The other person, when the open chat is a DM with just them. */
export function dmPartner(channelId = SelectedChannelStore.getChannelId()) {
    const ch: any = channelId && ChannelStore.getChannel(channelId);
    if (ch?.type !== 1) return null;
    const id = ch.recipients?.[0];
    return id ? { id, name: nameOf(UserStore.getUser(id)) } : null;
}

/* ── Picking who can read a secret ── */

function LockPicker({ value, onChange, taken }: { value: Choice; onChange(c: Choice): void; taken?: string; }) {
    const { book, pairs } = useKeys();
    const [adding, setAdding] = useState(false);
    const [pw, setPw] = useState("");
    const [pwName, setPwName] = useState("");
    const chip = (c: Choice, label: string, title?: string) => {
        const k = choiceKey(c);
        return (
            <button key={k} type="button" title={title} disabled={k === taken}
                className={classes("vc-tool-chip", choiceKey(value) === k && "vc-tool-chip-on")} onClick={() => { setAdding(false); onChange(c); }}>{label}</button>
        );
    };
    const typedIsNew = value.kind === "password" && !book.some(b => b.password === value.password);
    return (
        <div className="vc-whisper-locks">
            <div className="vc-tool-chips">
                {chip({ kind: "sonata" }, "🎵 Anyone with Sonata")}
                {pairs.map(p => chip({ kind: "pair", userId: p.userId }, `🤝 Just ${p.name}`, `Only you and ${p.name} can open it`))}
                {book.map(b => chip({ kind: "password", password: b.password }, `🔑 ${b.name}`, "Anyone who knows this password"))}
                <button type="button" className={classes("vc-tool-chip", (adding || typedIsNew) && "vc-tool-chip-on")} onClick={() => setAdding(true)}>＋ New password</button>
            </div>
            {(adding || typedIsNew) && (
                <div className="vc-whisper-newpass">
                    <input className="vc-tool-input" value={pw} placeholder="Password (3+ characters)" onChange={e => { setPw(e.currentTarget.value); onChange({ kind: "password", password: e.currentTarget.value }); }} />
                    <input className="vc-tool-input" value={pwName} placeholder="Name it, e.g. Squad" onChange={e => setPwName(e.currentTarget.value)} />
                    <button type="button" className="vc-tool-btn" disabled={pw.length < 3} onClick={() => { void savePassword(pwName, pw); setAdding(false); setPwName(""); }}>Save to book</button>
                </div>
            )}
        </div>
    );
}

/* ── Write ── */

interface Draft { text: string; choice: Choice; }

function WriteTab({ start, close }: { start?: Choice; close(): void; }) {
    const { pairs } = useKeys();
    const dm = dmPartner();
    const first: Choice = start ?? (dm && pairs.some(p => p.userId === dm.id) ? { kind: "pair", userId: dm.id } : { kind: "sonata" });
    const [drafts, setDrafts] = useState<Draft[]>([{ text: "", choice: first }]);
    const [cover, setCover] = useState(coverPick);
    const [expiry, setExpiry] = useState(0);
    const [busy, setBusy] = useState(false);
    // In a paired friend's DM, "Just them" is the default — once your keys have loaded, unless you've picked already.
    const touched = useRef(false);
    useEffect(() => {
        if (!touched.current && !start && dm && pairs.some(p => p.userId === dm.id)) setDrafts(ds => [{ ...ds[0], choice: { kind: "pair", userId: dm.id } }, ...ds.slice(1)]);
    }, [pairs.length]);

    const set = (i: number, d: Partial<Draft>) => { if (d.choice) touched.current = true; setDrafts(ds => ds.map((x, j) => j === i ? { ...x, ...d } : x)); };
    const expiresAt = expiry ? Date.now() + expiry * 1000 : undefined;
    const length = lengthOf(cover, drafts.map(d => ({ text: d.text.trim(), kind: d.choice.kind })), expiresAt);
    const same = drafts.length === 2 && choiceKey(drafts[0].choice) === choiceKey(drafts[1].choice);
    const badPassword = drafts.some(d => d.choice.kind === "password" && d.choice.password.length < 3);
    const ok = cover.trim() && drafts.every(d => d.text.trim()) && length <= LIMIT && !same && !badPassword;

    const put = async () => {
        if (!ok || busy) return;
        setBusy(true);
        try {
            const secrets: Secret[] = [];
            for (const d of drafts) {
                const seal = await sealOf(d.choice);
                if (!seal) throw new Error("no key");
                secrets.push({ text: d.text.trim(), seal });
            }
            insertTextIntoChatInputBox(await hide(cover, secrets, expiresAt));
            showToast("Whisper is in your message box — send it when you're ready", "success");
            close();
        } catch {
            showToast("Couldn't make the whisper", "failure");
            setBusy(false);
        }
    };

    return (
        <>
            {drafts.map((d, i) => (
                <section key={i} className="vc-whisper-card">
                    <div className="vc-tool-row">
                        <span className="vc-tool-label">{drafts.length === 1 ? "The hidden message" : i === 0 ? "First secret" : "Second secret — for someone else"}</span>
                        <span className="vc-tool-spacer" />
                        {i === 1 && <button type="button" className="vc-tool-link" onClick={() => setDrafts(ds => ds.slice(0, 1))}>Remove</button>}
                    </div>
                    <textarea className="vc-tool-area vc-whisper-secret" autoFocus={i === 0} rows={3} value={d.text} placeholder={i === 0 ? "What you really want to say… links and picture links show a preview" : "What the other group sees"} onChange={e => set(i, { text: e.currentTarget.value })} />
                    <span className="vc-tool-label">Who can read it</span>
                    <LockPicker value={d.choice} onChange={c => set(i, { choice: c })} taken={drafts.length === 2 ? choiceKey(drafts[1 - i].choice) : undefined} />
                </section>
            ))}
            {drafts.length === 1 && (
                <button type="button" className="vc-tool-btn vc-whisper-add" onClick={() => setDrafts(ds => [...ds, { text: "", choice: ds[0].choice.kind === "sonata" ? { kind: "password", password: "" } : { kind: "sonata" } }])}>
                    ＋ Add a second secret, for a different group (each sees only theirs)
                </button>
            )}

            <label className="vc-tool-field">
                <span className="vc-tool-label">The cover — what everyone else sees</span>
                <div className="vc-tool-row">
                    <input className="vc-tool-input vc-tool-grow" value={cover} maxLength={200} onChange={e => setCover(e.currentTarget.value)} />
                    <button type="button" className="vc-tool-btn" title="Another cover" onClick={() => setCover(coverPick())}>🎲</button>
                </div>
            </label>

            <div className="vc-tool-field">
                <span className="vc-tool-label">Stops opening</span>
                <div className="vc-tool-seg">
                    {EXPIRY.map(([s, label]) => <button key={s} type="button" className={classes("vc-tool-seg-btn", expiry === s && "vc-tool-seg-on")} onClick={() => setExpiry(s)}>{label}</button>)}
                </div>
                {expiry > 0 && <span className="vc-tool-hint">After that Sonata won't open it any more. (The message itself stays.)</span>}
            </div>

            {same && <span className="vc-whisper-over">Both secrets are for the same people — pick someone else for one of them.</span>}
            <div className="vc-tool-row">
                <span className={classes("vc-tool-hint", length > LIMIT && "vc-whisper-over")}>{length > LIMIT ? `Too long by ${(length - LIMIT).toLocaleString()} characters` : `${length.toLocaleString()} / ${LIMIT.toLocaleString()} characters`} · nothing is sent until you press Enter</span>
                <span className="vc-tool-spacer" />
                <button type="button" className="vc-tool-btn" onClick={close}>Cancel</button>
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!ok || busy} onClick={() => void put()}>Put in message box</button>
            </div>
        </>
    );
}

/* ── History ── */

const when = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function placeOf(channelId: string, guildId?: string | null) {
    const ch: any = ChannelStore.getChannel(channelId);
    if (!ch) return "a chat";
    if (ch.type === 1) return `DM with ${nameOf(UserStore.getUser(ch.recipients?.[0]))}`;
    if (ch.type === 3) return ch.name || "a group DM";
    return `#${ch.name}${guildId ? ` · ${GuildStore.getGuild(guildId)?.name ?? ""}` : ""}`;
}

function HistoryTab({ close }: { close(): void; }) {
    const list = useHistory();
    const [shown, setShown] = useState<Set<string>>(new Set());
    const [sure, setSure] = useState(false);
    if (!list.length) return <div className="vc-tool-empty"><span className="vc-tool-empty-icon">📜</span>Whispers you open show up here, so you can find them again.</div>;
    return (
        <>
            <div className="vc-whisper-history">
                {list.map(s => {
                    const k = `${s.messageId}:${s.text}`;
                    const expired = s.expiresAt != null && s.expiresAt < Date.now();
                    return (
                        <div key={k} className="vc-whisper-seen">
                            <div className="vc-whisper-seen-head">
                                <b>{s.author}</b>
                                <span>{placeOf(s.channelId, s.guildId)} · {when(s.at)} · {s.lock}</span>
                            </div>
                            {expired
                                ? <div className="vc-whisper-seen-text vc-whisper-expired">⌛ Expired</div>
                                : <button type="button" className={classes("vc-whisper-seen-text", !shown.has(k) && "vc-whisper-hidden")} onClick={() => setShown(v => { const n = new Set(v); if (n.has(k)) n.delete(k); else n.add(k); return n; })}>{s.text}</button>}
                            <div className="vc-tool-row">
                                <button type="button" className="vc-tool-link" onClick={() => { close(); NavigationRouter.transitionTo(`/channels/${s.guildId ?? "@me"}/${s.channelId}/${s.messageId}`); }}>Jump to it</button>
                                <span className="vc-tool-spacer" />
                                <button type="button" className="vc-tool-link" onClick={() => void forget(s.messageId)}>Forget</button>
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="vc-tool-row">
                <span className="vc-tool-hint">Kept only on this computer. Tap one to read it.</span>
                <span className="vc-tool-spacer" />
                {sure
                    ? <button type="button" className="vc-tool-btn vc-tool-danger" onClick={() => { void clearHistory(); setSure(false); }}>Clear all {list.length}</button>
                    : <button type="button" className="vc-tool-link" onClick={() => setSure(true)}>Clear history</button>}
            </div>
        </>
    );
}

/* ── Keys ── */

function KeysTab({ close }: { close(): void; }) {
    const { book, pairs } = useKeys();
    const s = settings.use(["quickLock", "quickWhisper"]);
    const dm = dmPartner();
    const [revealed, setRevealed] = useState<string | null>(null);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [sure, setSure] = useState<string | null>(null);
    const [newName, setNewName] = useState("");
    const [newPw, setNewPw] = useState("");
    const paired = dm && pairs.some(p => p.userId === dm.id);

    const pair = async () => {
        if (!dm) return;
        const me = await myIdentity();
        insertTextIntoChatInputBox(pairMessage("🤝 I'd like to whisper privately with you — accept it in Sonata", 3, dm.id, me.pub));
        await noteOffer(dm.id);
        showToast(`Pair request for ${dm.name} is in your message box — send it`, "success");
        close();
    };

    return (
        <>
            <section className="vc-whisper-card">
                <span className="vc-tool-label">Paired friends — private whispers with no password</span>
                {pairs.length ? pairs.map(p => (
                    <div key={p.userId} className="vc-whisper-keyrow">
                        <span className="vc-whisper-keyname">🤝 {p.name}</span>
                        <span className="vc-tool-hint" title="Check the same code shows on their side — then nobody swapped the keys in between">Safety code {p.code}</span>
                        <span className="vc-tool-spacer" />
                        {sure === `f:${p.userId}`
                            ? <button type="button" className="vc-tool-btn vc-tool-danger" onClick={() => { void removePair(p.userId); setSure(null); }}>Unpair</button>
                            : <button type="button" className="vc-whisper-x" title="Unpair" aria-label={`Unpair ${p.name}`} onClick={() => setSure(`f:${p.userId}`)}>✕</button>}
                    </div>
                )) : <span className="vc-tool-hint">Nobody yet. Open a DM with a friend who has Sonata and press the button below.</span>}
                <div className="vc-tool-row">
                    <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!dm || !!paired} onClick={() => void pair()}>
                        {!dm ? "🤝 Open a DM to pair" : paired ? `✓ Paired with ${dm.name}` : `🤝 Pair with ${dm.name}`}
                    </button>
                    {dm && !paired && offeredTo(dm.id) && <span className="vc-tool-hint">Request sent — waiting for them to accept.</span>}
                </div>
            </section>

            <section className="vc-whisper-card">
                <span className="vc-tool-label">Password book</span>
                {book.length ? book.map(b => (
                    <div key={b.password} className="vc-whisper-keyrow">
                        {renaming === b.password
                            ? <input className="vc-tool-input" autoFocus defaultValue={b.name} onBlur={e => { void renamePassword(b.password, e.currentTarget.value); setRenaming(null); }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />
                            : <button type="button" className="vc-whisper-keyname" title="Rename" onClick={() => setRenaming(b.password)}>🔑 {b.name}</button>}
                        <button type="button" className="vc-whisper-pw" onClick={() => setRevealed(revealed === b.password ? null : b.password)}>{revealed === b.password ? b.password : "••••••"}</button>
                        <span className="vc-tool-spacer" />
                        {sure === `p:${b.password}`
                            ? <button type="button" className="vc-tool-btn vc-tool-danger" onClick={() => { void removePassword(b.password); setSure(null); }}>Delete</button>
                            : <button type="button" className="vc-whisper-x" title="Delete" aria-label={`Delete ${b.name}`} onClick={() => setSure(`p:${b.password}`)}>✕</button>}
                    </div>
                )) : <span className="vc-tool-hint">Passwords you save are tried automatically on every whisper.</span>}
                <div className="vc-whisper-newpass">
                    <input className="vc-tool-input" value={newName} placeholder="Name, e.g. Squad" onChange={e => setNewName(e.currentTarget.value)} />
                    <input className="vc-tool-input" value={newPw} placeholder="Password" onChange={e => setNewPw(e.currentTarget.value)} />
                    <button type="button" className="vc-tool-btn" disabled={newPw.length < 3} onClick={() => { void savePassword(newName, newPw); setNewName(""); setNewPw(""); }}>Add</button>
                </div>
            </section>

            <section className="vc-whisper-card">
                <span className="vc-tool-label">Quick whispers</span>
                <label className="vc-whisper-check"><input type="checkbox" checked={s.quickWhisper} onChange={e => { settings.store.quickWhisper = e.currentTarget.checked; }} /> Type <code>cover ;; hidden</code> in the message box and the part after <code>;;</code> is hidden when you send</label>
                <div className="vc-tool-row">
                    <span className="vc-tool-hint">Who can read them:</span>
                    <select className="vc-tool-select" value={s.quickLock} onChange={e => { settings.store.quickLock = e.currentTarget.value; }}>
                        <option value="auto">Your paired friend in their DM, otherwise anyone with Sonata</option>
                        <option value="sonata">Anyone with Sonata</option>
                        {book.map(b => <option key={b.name} value={`p:${b.name}`}>🔑 {b.name}</option>)}
                    </select>
                </div>
            </section>
        </>
    );
}

/* ── The window ── */

type Tab = "write" | "history" | "keys";

function WhisperModal({ modalProps, start, tab: startTab }: { modalProps: RenderModalProps; start?: Choice; tab?: Tab; }) {
    const accent = windowAccent("whisper");
    const [tab, setTab] = useState<Tab>(startTab ?? "write");
    const close = modalProps.onClose;
    return (
        <Modal {...modalProps} size="md" title="Whisper" subtitle="Hidden messages only people with Sonata can read">
            <div className="vc-tool-wrap vc-whisper" style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon="🤫" kicker="Whisper" title="Say it quietly" sub="Everyone sees the cover. People with Sonata can tap to read what's hidden underneath." />
                <div className="vc-tool-seg" role="tablist">
                    {([["write", "✍️ Write"], ["history", "📜 History"], ["keys", "🔑 Keys"]] as [Tab, string][]).map(([id, label]) => (
                        <button key={id} type="button" role="tab" aria-selected={tab === id} className={classes("vc-tool-seg-btn", tab === id && "vc-tool-seg-on")} onClick={() => setTab(id)}>{label}</button>
                    ))}
                </div>
                {tab === "write" ? <WriteTab start={start} close={close} /> : tab === "history" ? <HistoryTab close={close} /> : <KeysTab close={close} />}
            </div>
        </Modal>
    );
}

export const openWhisper = (o: { start?: Choice; tab?: Tab; } = {}) => openModal(props => <WhisperModal modalProps={props} {...o} />);
