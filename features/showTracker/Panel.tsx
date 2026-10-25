/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import { openModal } from "@utils/modal";
import type { RenderModalProps } from "@vencord/discord-types";
import { useState } from "@webpack/common";

import { Window } from "../_shared/Window";
import { Choice, FormGroup, FormRow, Toggle } from "../_shared/WindowParts";
import type { Show, Source } from "./native";
import { episodeLabel, follow, Followed, isFollowing, refresh, search, settings, unfollow, untilText, useShows, whenText } from "./store";

type Tab = "next" | "following" | "add";
let lastTab: Tab | null = null;

const Poster = ({ s, size = "small" }: { s: Pick<Show, "image" | "title">; size?: "small" | "big"; }) =>
    s.image ? <img className={classes("vc-shows-poster", `vc-shows-poster-${size}`)} src={s.image} alt="" loading="lazy" />
        : <span className={classes("vc-shows-poster", `vc-shows-poster-${size}`, "vc-shows-noposter")}>{s.title.slice(0, 1)}</span>;

const sourceName = (s: Pick<Show, "source">) => s.source === "anime" ? "AniList" : "TVMaze";

/* ── Coming up ── */

function ComingUp({ list, goAdd }: { list: Followed[]; goAdd(): void; }) {
    const dated = list.filter(s => s.next?.at).sort((a, b) => a.next!.at! - b.next!.at!);
    const undated = list.filter(s => !s.next?.at);
    const day = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const today = day(Date.now());
    const bucket = (t: number) => {
        const d = (day(t) - today) / 86_400_000;
        return d <= 0 ? "Today" : d === 1 ? "Tomorrow" : d < 7 ? "This week" : "Later";
    };
    const groups = new Map<string, Followed[]>();
    for (const s of dated) { const b = bucket(s.next!.at!); groups.set(b, [...(groups.get(b) ?? []), s]); }
    if (!list.length) return (
        <div className="vc-tool-empty">
            <span className="vc-tool-empty-icon">📺</span>
            Follow an anime or TV show and its next episode shows up here, with a pop-up when it's out.
            <button type="button" className="vc-tool-btn vc-tool-primary" onClick={goAdd}>Add a show</button>
        </div>
    );
    return (
        <>
            {[...groups].map(([g, items]) => (
                <FormGroup key={g} title={g}>
                    {items.map(s => (
                        <a key={s.key} className="vc-shows-row" href={s.url} target="_blank" rel="noreferrer">
                            <Poster s={s} />
                            <span className="vc-shows-row-text">
                                <b>{s.title}</b>
                                <span>{episodeLabel(s, s.next)}{s.next?.name ? ` · ${s.next.name}` : ""}</span>
                            </span>
                            <span className="vc-shows-when"><b>{untilText(s.next!.at!)}</b><small>{whenText(s.next!.at!)}</small></span>
                        </a>
                    ))}
                </FormGroup>
            ))}
            {undated.length > 0 && (
                <FormGroup title="No date yet">
                    {undated.map(s => (
                        <a key={s.key} className="vc-shows-row" href={s.url} target="_blank" rel="noreferrer">
                            <Poster s={s} />
                            <span className="vc-shows-row-text"><b>{s.title}</b><span>{s.status}{s.last?.number ? ` · last: ${episodeLabel(s, s.last)}` : ""}</span></span>
                        </a>
                    ))}
                </FormGroup>
            )}
        </>
    );
}

/* ── Following ── */

function Following({ list }: { list: Followed[]; }) {
    if (!list.length) return <div className="vc-tool-empty">You're not following any shows yet.</div>;
    return (
        <div className="vc-shows-grid">
            {list.map(s => (
                <div key={s.key} className="vc-shows-card">
                    <Poster s={s} size="big" />
                    <div className="vc-shows-card-text">
                        <b title={s.title}>{s.title}</b>
                        <small>{s.source === "anime" ? "Anime" : "TV"}{s.where ? ` · ${s.where}` : ""}{s.year ? ` · ${s.year}` : ""}</small>
                        <span className="vc-shows-status">{s.next?.at ? `${episodeLabel(s, s.next)} ${untilText(s.next.at)}` : s.status}</span>
                    </div>
                    <div className="vc-shows-card-tools">
                        <a className="vc-tool-btn" href={s.url} target="_blank" rel="noreferrer">{sourceName(s)}</a>
                        <button type="button" className="vc-tool-btn" onClick={() => unfollow(s.key)}>Unfollow</button>
                    </div>
                </div>
            ))}
        </div>
    );
}

/* ── Adding ── */

function AddShow() {
    const [source, setSource] = useState<Source>("anime");
    const [q, setQ] = useState("");
    const [found, setFound] = useState<Show[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    useShows();
    const go = async () => {
        if (q.trim().length < 2) return;
        setBusy(true); setError(null);
        const r = await search(source, q);
        setBusy(false);
        if (typeof r === "string") setError(r); else setFound(r);
    };
    return (
        <>
            <div className="vc-shows-add">
                <Choice value={source} options={[["anime", "Anime"], ["tv", "TV shows"]] as const} onChange={v => { setSource(v); setFound(null); }} />
                <input className="vc-tool-input" value={q} autoFocus placeholder={source === "anime" ? "Search anime, like Frieren or One Piece" : "Search TV shows, like The Bear or Severance"} aria-label="Search shows"
                    onChange={e => setQ(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") void go(); }} />
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={busy || q.trim().length < 2} onClick={() => void go()}>{busy ? "Searching…" : "Search"}</button>
            </div>
            {error && <div className="vc-tool-hint">{error}</div>}
            {found && !found.length && <div className="vc-tool-empty">Nothing called “{q.trim()}”. Try the show's English or original title.</div>}
            {found && found.length > 0 && (
                <FormGroup>
                    {found.map(s => {
                        const on = isFollowing(s.key);
                        return (
                            <div key={s.key} className="vc-shows-row">
                                <Poster s={s} />
                                <span className="vc-shows-row-text">
                                    <b>{s.title}</b>
                                    <span>{[s.status, s.where, s.year, s.total ? `${s.total} episodes` : null].filter(Boolean).join(" · ")}</span>
                                </span>
                                <button type="button" className={classes("vc-tool-btn", !on && "vc-tool-primary")} onClick={() => on ? unfollow(s.key) : follow(s)}>{on ? "Following" : "Follow"}</button>
                            </div>
                        );
                    })}
                </FormGroup>
            )}
            <FormGroup>
                <FormRow label="Tell me when a new episode is out" help="A pop-up when an episode of a show you follow comes out (while Discord is open).">
                    <Toggle value={!!settings.store.alerts} label="New episode alerts" onChange={v => { settings.store.alerts = v; }} />
                </FormRow>
            </FormGroup>
        </>
    );
}

function ShowsWindow({ modalProps }: { modalProps: RenderModalProps; }) {
    const list = useShows();
    const [tab, setTabState] = useState<Tab>(lastTab ?? (list.length ? "next" : "add"));
    const setTab = (t: Tab) => { lastTab = t; setTabState(t); };
    const [busy, setBusy] = useState(false);
    const soon = list.filter(s => s.next?.at && s.next.at - Date.now() < 7 * 86_400_000).length;
    return (
        <Window {...modalProps} size="lg" title="Show Tracker" subtitle="Anime and TV shows you follow, and when their next episode is out"
            tabs={[["next", "Coming up"], ["following", `Following · ${list.length}`], ["add", "Add a show"]]} tab={tab} onTab={id => setTab(id as Tab)}
            status={[`${list.length} followed`, `${soon} this week`]} statusRight="anilist.co · tvmaze.com"
            tools={tab !== "add" && list.length > 0 && <button type="button" className="vc-tool-btn" disabled={busy} onClick={async () => { setBusy(true); await refresh(); setBusy(false); }}>{busy ? "Checking…" : "Check now"}</button>}>
            <div className="vc-tool-wrap vc-shows">
                {tab === "next" && <ComingUp list={list} goAdd={() => setTab("add")} />}
                {tab === "following" && <Following list={list} />}
                {tab === "add" && <AddShow />}
            </div>
        </Window>
    );
}

export const openShows = () => openModal(props => <ShowsWindow modalProps={props} />);
