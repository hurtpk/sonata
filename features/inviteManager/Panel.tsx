/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, showToast, useEffect, useRef, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { canRevoke, collectInvites, Progress, revokeInvite } from "./fetch";
import { applyView, expiringSoon, Filter, InviteRow, isStale, neverExpires, OLD_AFTER_DAYS, relative, Sort, usesText } from "./invites";
import { forgetInvite, setLabel, useInviteStore } from "./store";

const cl = classNameFactory("vc-invm-");

/** Kept between openings so the window shows straight away; Refresh fetches again. */
let cache: { rows: InviteRow[]; problems: string[]; everyone: boolean; at: number; } | null = null;

const iconUrl = (r: InviteRow) => r.guildId && r.guildIcon ? `https://cdn.discordapp.com/icons/${r.guildId}/${r.guildIcon}.webp?size=64` : null;
const initials = (name: string) => name.split(/\s+/).map(w => w[0]).join("").slice(0, 3).toUpperCase();

function LabelInput({ code, value }: { code: string; value: string; }) {
    const [text, setText] = useState(value);
    useEffect(() => setText(value), [value]);
    return (
        <input className={cl("label")} value={text} placeholder="Who it's for…" maxLength={80} spellCheck={false}
            onChange={e => setText(e.currentTarget.value)}
            onBlur={() => { if (text !== value) setLabel(code, text); }}
            onKeyDown={e => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }} />
    );
}

function Row({ r, label, onRevoked }: { r: InviteRow; label: string; onRevoked(code: string): void; }) {
    const [confirm, setConfirm] = useState(false);
    const [busy, setBusy] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const stale = isStale(r);
    const revocable = !r.gone && canRevoke(r);
    const icon = iconUrl(r);

    const revoke = async () => {
        if (!confirm) {
            setConfirm(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setConfirm(false), 3500);
            return;
        }
        clearTimeout(timer.current);
        setBusy(true);
        try {
            await revokeInvite(r.code);
            forgetInvite(r.code);
            onRevoked(r.code);
            showToast(`Revoked discord.gg/${r.code}`, "success");
        } catch (e: any) {
            showToast(e?.body?.message ?? "Couldn't revoke that invite", "failure");
            setBusy(false);
            setConfirm(false);
        }
    };

    let expiry: React.ReactNode;
    if (r.gone) expiry = <span className={classes(cl("badge"), cl("badge-gone"))}>No longer works</span>;
    else if (neverExpires(r)) expiry = <span className={classes(cl("badge"), stale ? cl("badge-stale") : cl("badge-never"))} title={stale ? `Never expires, and it's been around over ${OLD_AFTER_DAYS} days` : "Never expires"}>{stale ? "⚠ Never expires" : "Never expires"}</span>;
    else if (r.expiresAt) expiry = <span className={classes(cl("expiry"), expiringSoon(r) && cl("expiry-soon"))} title={new Date(r.expiresAt).toLocaleString()}>Expires {relative(r.expiresAt)}</span>;
    else expiry = <span className={cl("muted")}>Expiry unknown</span>;

    return (
        <div className={classes(cl("row"), stale && cl("row-stale"), r.gone && cl("row-gone"))}>
            {icon ? <img className={cl("icon")} src={icon} alt="" /> : <span className={classes(cl("icon"), cl("icon-text"))}>{initials(r.guildName)}</span>}
            <div className={cl("main")}>
                <div className={cl("line")}>
                    <span className={cl("code")}>discord.gg/{r.code}</span>
                    {r.temporary && <span className={cl("chip")} title="People who join with it are removed when they go offline, unless given a role">Temporary</span>}
                </div>
                <div className={cl("where")}>{r.guildName}{r.channelName ? ` · #${r.channelName}` : ""}{r.createdAt ? ` · made ${relative(r.createdAt)}` : ""}</div>
                <LabelInput code={r.code} value={label} />
            </div>
            <div className={cl("stats")}>
                <span className={cl("uses")} title={r.uses == null ? "Uses can only be seen in servers where you can manage invites" : "Uses"}>{usesText(r)} <span className={cl("muted")}>uses</span></span>
                {expiry}
            </div>
            <div className={cl("actions")}>
                {!r.gone && <button type="button" className={cl("btn")} onClick={() => { copyToClipboard(`https://discord.gg/${r.code}`); showToast("Invite link copied", "success"); }}>Copy</button>}
                {r.gone
                    ? <button type="button" className={cl("btn")} onClick={() => { forgetInvite(r.code); onRevoked(r.code); }}>Remove</button>
                    : <button type="button" className={classes(cl("btn"), cl("btn-danger"), confirm && cl("btn-confirm"))} disabled={!revocable || busy}
                        title={revocable ? "Delete this invite so nobody can use it" : "You need Manage Channels or Manage Server there to revoke it"}
                        onClick={revoke}>{busy ? "Revoking…" : confirm ? "Sure?" : "Revoke"}</button>}
            </div>
        </div>
    );
}

function InviteModal({ modalProps, everyoneDefault, setEveryoneDefault }: { modalProps: RenderModalProps; everyoneDefault: boolean; setEveryoneDefault(v: boolean): void; }) {
    const accent = windowAccent("inviteManager");
    const store = useInviteStore();
    const [everyone, setEveryone] = useState(everyoneDefault);
    const [data, setData] = useState(cache?.everyone === everyone ? cache : null);
    const [progress, setProgress] = useState<Progress | null>(null);
    const [filter, setFilter] = useState<Filter>("all");
    const [sort, setSort] = useState<Sort>("newest");
    const [query, setQuery] = useState("");
    const run = useRef(0);

    const load = () => {
        const id = ++run.current;
        setProgress({ done: 0, total: 1, label: "" });
        collectInvites(everyone, p => { if (run.current === id) setProgress(p); }, () => run.current !== id).then(res => {
            if (!res || run.current !== id) return;
            cache = { ...res, everyone, at: Date.now() };
            setData(cache);
            setProgress(null);
        }).catch(() => { if (run.current === id) { setProgress(null); showToast("Couldn't load invites", "failure"); } });
    };

    useEffect(() => { if (!data) load(); return () => { run.current++; }; }, [everyone]);

    const rows = data?.rows ?? [];
    const shown = applyView(rows, filter, sort, query, store.labels);
    const counts = { all: rows.length, never: rows.filter(neverExpires).length, stale: rows.filter(r => isStale(r)).length, soon: rows.filter(r => expiringSoon(r)).length };
    const dropRow = (code: string) => {
        if (!data) return;
        cache = { ...data, rows: data.rows.filter(r => r.code !== code) };
        setData(cache);
    };

    const totalUses = rows.reduce((n, r) => n + (r.uses ?? 0), 0);

    const FILTERS: { id: Filter; label: string; }[] = [
        { id: "all", label: "All" },
        { id: "never", label: "Never expire" },
        { id: "stale", label: "Old & never expire" },
        { id: "soon", label: "Expire within a day" },
    ];

    return (
        <Modal {...modalProps} size="lg" title="Invite Manager"
            subtitle={progress ? `Checking ${progress.label || "…"} (${Math.min(progress.done + 1, progress.total)} of ${progress.total})`
                : `${rows.length} invite${rows.length === 1 ? "" : "s"}${counts.stale ? ` · ${counts.stale} old and never expiring` : ""}${data ? ` · checked ${relative(data.at)}` : ""}`}>
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon="🔗" kicker={progress ? `Checking ${progress.label || "…"}` : data ? `Checked ${relative(data.at)}` : "Invite Manager"}
                    title={progress && !data ? "Looking through your servers…" : `${rows.length} invite${rows.length === 1 ? "" : "s"}`}
                    sub={counts.stale ? `⚠ ${counts.stale} old and never expiring — worth a look` : counts.soon ? `${counts.soon} expire within a day` : "Every invite you've made, in one place."}
                    numbers={[{ value: totalUses.toLocaleString(), label: "joins" }, { value: counts.never, label: "never expire" }]}>
                    <button type="button" className={classes("vc-tool-btn", "vc-tool-primary")} disabled={!!progress} onClick={load}>{progress ? "Checking…" : "↻ Refresh"}</button>
                </ToolHero>
                <div className={cl("toolbar")}>
                    <input className={cl("search")} value={query} placeholder="Search code, server, channel or who it's for" onChange={e => setQuery(e.currentTarget.value)} />
                    <select className={cl("select")} value={sort} onChange={e => setSort(e.currentTarget.value as Sort)} aria-label="Sort">
                        <option value="newest">Newest</option>
                        <option value="oldest">Oldest</option>
                        <option value="uses">Most used</option>
                        <option value="expiry">Expiring first</option>
                    </select>
                </div>
                <div className={cl("filters")}>
                    {FILTERS.map(f => (
                        <button key={f.id} type="button" className={classes(cl("filter"), filter === f.id && cl("filter-on"), f.id === "stale" && counts.stale > 0 && cl("filter-warn"))} onClick={() => setFilter(f.id)}>
                            {f.label} <span className={cl("count")}>{counts[f.id]}</span>
                        </button>
                    ))}
                    <label className={cl("everyone")} title="In servers where you can manage invites, also list the ones other people made">
                        <input type="checkbox" checked={everyone} onChange={e => { const v = e.currentTarget.checked; setEveryone(v); setEveryoneDefault(v); setData(cache?.everyone === v ? cache : null); }} />
                        Include other people's
                    </label>
                </div>

                {progress && (
                    <div className={cl("progress")}><div className={cl("bar")} style={{ width: `${Math.round(progress.done / Math.max(1, progress.total) * 100)}%` }} /></div>
                )}

                <div className={cl("list")}>
                    {shown.map(r => <Row key={r.code} r={r} label={store.labels[r.code] ?? ""} onRevoked={dropRow} />)}
                    {!progress && data && shown.length === 0 && (
                        <div className={cl("empty")}>
                            <span className="vc-tool-empty-icon">{rows.length === 0 ? "🔗" : "🔍"}</span>
                            {rows.length === 0
                                ? "No invites found. Discord only shows a server's invites to people with Manage Server (or Manage Channels for a channel) — invites you create from now on are remembered here wherever you make them."
                                : "Nothing matches."}
                        </div>
                    )}
                </div>

                <div className={cl("note")}>
                    Uses are only shown where you can manage invites; elsewhere, invites you made since Invite Manager was switched on are looked up by code.
                    {data?.problems.length ? ` Couldn't check: ${data.problems.join(", ")}.` : ""}
                </div>
            </div>
        </Modal>
    );
}

export function openInviteManager(everyoneDefault: boolean, setEveryoneDefault: (v: boolean) => void) {
    openModal(props => <InviteModal modalProps={props} everyoneDefault={everyoneDefault} setEveryoneDefault={setEveryoneDefault} />);
}
