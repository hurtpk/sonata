/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Every update to Sonata, newest first: searchable, each one opening and
// closing, with the ones you haven't seen yet marked New.

import { classes } from "@utils/misc";
import { useEffect, useMemo, useRef, useState } from "@webpack/common";

import { ChangeEntry, CHANGELOG } from "./changelog";
import { checkNow } from "./updateNotice";

/** "October 2026" for grouping. */
function monthOf(e: ChangeEntry) {
    const t = Date.parse(e.date);
    return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "Earlier";
}

function Highlight({ text, q }: { text: string; q: string; }) {
    if (!q) return <>{text}</>;
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return <>{text}</>;
    return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

export function UpdateLog({ seen, onClose, store }: { seen: string | undefined; onClose(): void; store?: any; }) {
    const [q, setQ] = useState("");
    const [notice, setNotice] = useState<boolean>(() => store?.sonataUpdateNotice !== false);
    const [checking, setChecking] = useState<string | null>(null);
    const checkGitHub = async () => {
        setChecking("Checking…");
        const r = await checkNow();
        setChecking(r === null ? "Couldn't reach GitHub" : r ? `Sonata ${r} is out — see the bar at the top` : "You're up to date");
    };
    const [open, setOpen] = useState<Set<string>>(() => new Set(CHANGELOG.filter((e, i) => i === 0 || (seen && e.version > seen)).map(e => e.version)));
    const search = useRef<HTMLInputElement>(null);
    useEffect(() => {
        search.current?.focus();
        const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); onClose(); } };
        window.addEventListener("keydown", key, true);
        return () => window.removeEventListener("keydown", key, true);
    }, []);

    const t = q.trim().toLowerCase();
    const shown = useMemo(() => !t ? CHANGELOG : CHANGELOG.filter(e => e.title.toLowerCase().includes(t) || e.items.some(i => i.text.toLowerCase().includes(t))), [t]);
    const unseen = CHANGELOG.filter(e => seen && e.version > seen).length;
    const changes = CHANGELOG.reduce((n, e) => n + e.items.length, 0);
    const groups: [string, ChangeEntry[]][] = [];
    for (const e of shown) {
        const m = monthOf(e);
        if (groups.at(-1)?.[0] === m) groups.at(-1)![1].push(e); else groups.push([m, [e]]);
    }
    const toggle = (v: string) => setOpen(o => { const n = new Set(o); if (n.has(v)) n.delete(v); else n.add(v); return n; });
    const allOpen = shown.every(e => open.has(e.version));

    return (
        <div className="sonata-welcome" role="dialog" aria-label="Sonata's update log" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="sonata-welcome-card sonata-log">
                <div className="sonata-log-top">
                    <div>
                        <h2>Update <em>log</em></h2>
                        <p className="sonata-welcome-small">{CHANGELOG.length} updates · {changes} changes{unseen ? ` · ${unseen} new since you last looked` : ""}</p>
                    </div>
                    <button type="button" className="sonata-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
                    </button>
                </div>
                <div className="sonata-log-notice">
                    <label className="sonata-check"><input type="checkbox" checked={notice} onChange={e => { const v = e.currentTarget.checked; setNotice(v); if (store) store.sonataUpdateNotice = v; }} /> Tell me at the top of Discord when there's a new version</label>
                    <span className="sonata-spacer" />
                    {checking && <span className="sonata-field-hint">{checking}</span>}
                    <button type="button" className="sonata-btn" disabled={checking === "Checking…"} onClick={() => void checkGitHub()}>Check now</button>
                </div>
                <div className="sonata-log-tools">
                    <input ref={search} className="sonata-log-search" value={q} placeholder="Search every update — e.g. roblox, typing sounds, calendar…" spellCheck={false} onChange={e => setQ(e.currentTarget.value)} />
                    <button type="button" className="sonata-btn" onClick={() => setOpen(allOpen ? new Set() : new Set(shown.map(e => e.version)))}>{allOpen ? "Close all" : "Open all"}</button>
                </div>
                <div className="sonata-log-list">
                    {groups.map(([month, entries]) => (
                        <div key={month} className="sonata-log-month">
                            <div className="sonata-log-month-name">{month}</div>
                            {entries.map(e => {
                                const isOpen = open.has(e.version) || !!t;
                                const isNew = !!seen && e.version > seen;
                                const items = t ? e.items.filter(i => i.text.toLowerCase().includes(t) || e.title.toLowerCase().includes(t)) : e.items;
                                return (
                                    <section key={e.version} className={classes("sonata-log-entry", isOpen && "sonata-log-entry-open", isNew && "sonata-log-entry-new")}>
                                        <button type="button" className="sonata-log-head" onClick={() => toggle(e.version)} aria-expanded={isOpen}>
                                            <span className="sonata-log-icons" aria-hidden>{[...new Set(e.items.map(i => i.icon))].slice(0, 2).join(" ")}</span>
                                            <span className="sonata-log-title">
                                                <b><Highlight text={e.title} q={t} /></b>
                                                <small>{e.date} · {e.items.length} change{e.items.length === 1 ? "" : "s"}</small>
                                            </span>
                                            {isNew && <span className="sonata-log-new">New</span>}
                                            {e === CHANGELOG[0] && <span className="sonata-log-latest">Latest</span>}
                                            <i aria-hidden>{isOpen ? "▾" : "▸"}</i>
                                        </button>
                                        {isOpen && <ul>{items.map((it, i) => <li key={i}><span aria-hidden>{it.icon}</span><span><Highlight text={it.text} q={t} /></span></li>)}</ul>}
                                    </section>
                                );
                            })}
                        </div>
                    ))}
                    {!shown.length && <p className="sonata-log-none">No update mentions “{q.trim()}”.</p>}
                </div>
            </div>
        </div>
    );
}

/** The corner button's little count. */
export const unseenCount = (seen: string | undefined) => seen ? CHANGELOG.filter(e => e.version > seen).length : 0;
