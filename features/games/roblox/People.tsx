/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Profile watch: the Roblox accounts you watch, and a timeline of every
// username, display name, bio and avatar change.

import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { classes } from "@utils/misc";
import { useEffect, useReducer, useState } from "@webpack/common";

import { ago, cardActions } from "./data";
import { isMe } from "./me";
import { Change, checkPeople, describeChange, FIELD_LABEL, getPeople, onPeopleChange, Person, unwatchPerson, watchPerson } from "./watchlist";

const rb = classNameFactory("vc-rbx-");

function usePeople() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => onPeopleChange(bump), []);
    return getPeople();
}

function ChangeRow({ c }: { c: Change; }) {
    const [open, setOpen] = useState(false);
    return (
        <div className={rb("change")}>
            <span className={rb("change-when")} title={new Date(c.t).toLocaleString()}>{ago(c.t)}</span>
            <span className={rb("change-tag")}>{FIELD_LABEL[c.field]}</span>
            {c.field === "avatar" ? (
                <span className={rb("change-avatar")}>
                    <img src={c.from} alt="Before" title="Before" loading="lazy" /><i>→</i><img src={c.to} alt="After" title="After" loading="lazy" />
                </span>
            ) : c.field === "bio" ? (
                <span className={rb("change-text")}>
                    <button type="button" className={rb("link")} onClick={() => setOpen(o => !o)}>{open ? "Hide" : c.to ? "See old and new bio" : "See the old bio"}</button>
                    {open && <span className={rb("change-bio")}><small>Before</small>{c.from || "(empty)"}<small>After</small>{c.to || "(empty)"}</span>}
                </span>
            ) : c.field === "banned" || c.field === "verified" ? (
                <span className={rb("change-text")}>{c.field === "banned" ? (c.to === "yes" ? "🚫 Banned" : "✅ Unbanned") : (c.to === "yes" ? "✔ Got verified" : "Lost verified")}</span>
            ) : (
                <span className={rb("change-text")}>
                    <s>{c.field === "name" ? `@${c.from}` : c.from}</s> → <b>{c.field === "name" ? `@${c.to}` : c.to}</b>
                    <button type="button" className={rb("link")} title="Copy the old one" onClick={() => copyWithToast(c.from)}>copy old</button>
                </span>
            )}
        </div>
    );
}

function PersonCard({ p }: { p: Person; }) {
    const [open, setOpen] = useState(false);
    const last = p.changes[0];
    return (
        <div className={rb("group")}>
            <div className={rb("head")}>
                {p.avatar ? <img className={rb("avatar")} src={p.avatar} alt="" /> : <span className={classes(rb("avatar"), rb("img-none"))}>👤</span>}
                <div className={rb("who")}>
                    <b>{p.displayName}{p.verified && <span className={rb("tick")}>✔</span>}{p.banned && <span className={rb("banned")}>Banned</span>}</b>
                    <span>@{p.name} · checked {ago(p.lastCheck)}{p.error ? ` · ⚠️ ${p.error}` : ""}</span>
                </div>
                <button type="button" className={rb("link")} onClick={() => cardActions.lookup(`https://www.roblox.com/users/${p.id}/profile`)}>Profile</button>
                {isMe(p.id) ? <span className={rb("me-tag")} title="Your account is always watched">You</span> : <button type="button" className="vc-tool-icon" title="Stop watching" onClick={() => unwatchPerson(p.id)}>✕</button>}
            </div>
            {p.changes.length ? (
                <>
                    <span className={rb("muted")}>
                        {p.changes.length} change{p.changes.length === 1 ? "" : "s"} since {new Date(p.addedAt).toLocaleDateString()} · latest: {describeChange(last)} {ago(last.t)}
                    </span>
                    <button type="button" className={rb("link")} onClick={() => setOpen(o => !o)}>{open ? "Hide the timeline" : "Show the timeline"}</button>
                    {open && <div className={rb("changes")}>{p.changes.map((c, i) => <ChangeRow key={`${c.t}-${i}`} c={c} />)}</div>}
                </>
            ) : <span className={rb("muted")}>No changes since you started watching ({new Date(p.addedAt).toLocaleDateString()}).</span>}
        </div>
    );
}

export function People() {
    const people = usePeople();
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [q, setQ] = useState("");

    const add = async () => {
        const t = text.trim();
        const id = t.match(/users\/(\d+)/)?.[1] ?? t.replace(/^@/, "");
        if (!id) return;
        setBusy(true); setErr(null);
        const e = await watchPerson(id);
        setBusy(false);
        if (e) setErr(e); else setText("");
    };
    const t = q.trim().toLowerCase();
    const shown = people.filter(p => !t || p.name.toLowerCase().includes(t) || p.displayName.toLowerCase().includes(t) || p.changes.some(c => c.field === "name" && c.from.toLowerCase().includes(t)));
    const recent = people.flatMap(p => p.changes.slice(0, 3).map(c => ({ p, c }))).sort((a, b) => b.c.t - a.c.t).slice(0, 6);

    return (
        <>
            <div className={rb("bar")}>
                <input className="vc-tool-input" value={text} placeholder="A Roblox username, profile link or user ID" onChange={e => setText(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} />
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={busy || !text.trim()} onClick={add}>{busy ? "Adding…" : "＋ Watch"}</button>
                {people.length > 0 && <button type="button" className="vc-tool-btn" onClick={() => checkPeople(true)}>↻ Check now</button>}
            </div>
            {err && <span className="vc-tool-error">{err}</span>}
            {!people.length ? (
                <div className="vc-tool-empty">
                    <span className="vc-tool-empty-icon">👤</span>
                    Watch Roblox accounts for changes.
                    <span className="vc-tool-hint">Get told when someone changes their username, display name, bio or avatar — or gets banned — and keep the old ones. Profile cards have a Watch button too.</span>
                </div>
            ) : (
                <>
                    {recent.length > 0 && (
                        <div className={rb("section")}>
                            <span className={rb("wear-title")}>Latest changes</span>
                            {recent.map(({ p, c }, i) => <span key={i} className={rb("recent")}><b>{p.displayName}</b> {describeChange(c)} · {ago(c.t)}</span>)}
                        </div>
                    )}
                    {people.length > 5 && <input className="vc-tool-input" value={q} placeholder="Find someone (old usernames count too)…" onChange={e => setQ(e.currentTarget.value)} />}
                    <div className={rb("groups")}>{shown.map(p => <PersonCard key={p.id} p={p} />)}</div>
                </>
            )}
        </>
    );
}
