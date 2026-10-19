/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, Modal, NavigationRouter, openModal, useEffect, useRef, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { allNotes, channelKey, guildKey, Note, noteOf, placeName, setNote, useNotes } from "./store";

function ago(t: number) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    if (m < 1440) return `${Math.round(m / 60)} h ago`;
    return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function go(key: string, close: () => void) {
    const id = key.slice(2);
    if (key.startsWith("g:")) NavigationRouter.transitionToGuild?.(id) ?? NavigationRouter.transitionTo(`/channels/${id}`);
    else NavigationRouter.transitionTo(`/channels/${(ChannelStore.getChannel(id) as any)?.guild_id ?? "@me"}/${id}`);
    close();
}

function NoteEditor({ k }: { k: string; }) {
    useNotes();
    const note = noteOf(k);
    const [text, setText] = useState(note?.text ?? "");
    const [saved, setSaved] = useState(true);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Shows the saved note once it has loaded (and when switching notes) — unless you're in the middle of typing.
    useEffect(() => { setText(noteOf(k)?.text ?? ""); setSaved(true); }, [k]);
    useEffect(() => { if (saved) setText(noteOf(k)?.text ?? ""); }, [note?.at]);
    const change = (v: string) => {
        setText(v); setSaved(false);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { setNote(k, v); setSaved(true); }, 500);
    };
    useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); } }, []);
    return (
        <section className="vc-cnotes-editor">
            <textarea className="vc-tool-area vc-cnotes-text" autoFocus value={text} placeholder={`Anything you want to remember about ${placeName(k)} — rules, who's who, links, what you were talking about…`}
                onChange={e => change(e.currentTarget.value)} onBlur={() => { if (!saved) { setNote(k, text); setSaved(true); } }} />
            <div className="vc-tool-row">
                <span className="vc-tool-hint">{saved ? (note ? `✓ Saved · ${ago(note.at)}` : "Only you can see this.") : "Saving…"} · {text.length.toLocaleString()} characters</span>
                <span className="vc-tool-spacer" />
                {text && <button type="button" className="vc-tool-link" onClick={() => { setText(""); setNote(k, ""); }}>Clear</button>}
            </div>
        </section>
    );
}

function NoteCard({ k, n, onOpen, close }: { k: string; n: Note; onOpen(): void; close(): void; }) {
    const [sure, setSure] = useState(false);
    useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 3000); return () => clearTimeout(t); }, [sure]);
    return (
        <div className="vc-cnotes-card">
            <button type="button" className="vc-cnotes-card-main" onClick={onOpen} title="Open this note">
                <span className="vc-cnotes-where">{k.startsWith("g:") ? "🏠" : "#"} {placeName(k)}</span>
                <span className="vc-cnotes-preview">{n.text}</span>
                <span className="vc-tool-hint">{ago(n.at)}</span>
            </button>
            <div className="vc-cnotes-card-tools">
                <button type="button" className="vc-tool-btn" onClick={() => go(k, close)}>Go there</button>
                {sure
                    ? <button type="button" className="vc-tool-btn vc-cnotes-sure" onClick={() => setNote(k, "")}>Delete</button>
                    : <button type="button" className="vc-cnotes-x" title="Delete" aria-label="Delete" onClick={() => setSure(true)}>✕</button>}
            </div>
        </div>
    );
}

function NotesModal({ modalProps, channelId, guildId, startKey }: { modalProps: RenderModalProps; channelId?: string; guildId?: string; startKey?: string; }) {
    useNotes();
    const accent = windowAccent("channelNotes");
    const here = channelId ? channelKey(channelId) : null;
    const server = guildId ? guildKey(guildId) : null;
    const [tab, setTab] = useState<string>(startKey ?? here ?? server ?? "all");
    const list = allNotes();
    const current = tab === "all" ? null : tab;
    const note = current ? noteOf(current) : null;

    return (
        <Modal {...modalProps} size="lg" title="Channel Notes" subtitle="Your private notes on channels, DMs and servers — only you can see them">
            <div className="vc-tool-wrap vc-cnotes-wrap" style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon="📝" kicker={current ? (current.startsWith("g:") ? "Server note" : "Channel note") : "All your notes"}
                    title={current ? placeName(current) : `${list.length} note${list.length === 1 ? "" : "s"}`}
                    sub={current ? (note ? `Last changed ${ago(note.at)}` : "No note here yet — start typing below.") : "Click one to read or change it."}
                    numbers={[{ value: list.length, label: list.length === 1 ? "note" : "notes" }]} />
                <div className="vc-tool-seg">
                    {here && <button type="button" className={classes("vc-tool-seg-btn", tab === here && "vc-tool-seg-on")} onClick={() => setTab(here)}>💬 {placeName(here).split(" · ")[0]}{noteOf(here) ? " •" : ""}</button>}
                    {server && <button type="button" className={classes("vc-tool-seg-btn", tab === server && "vc-tool-seg-on")} onClick={() => setTab(server)}>🏠 Server{noteOf(server) ? " •" : ""}</button>}
                    {current && current !== here && current !== server && <button type="button" className="vc-tool-seg-btn vc-tool-seg-on">📝 {placeName(current).split(" · ")[0]}</button>}
                    <button type="button" className={classes("vc-tool-seg-btn", tab === "all" && "vc-tool-seg-on")} onClick={() => setTab("all")}>📚 All notes · {list.length}</button>
                </div>
                {current ? <NoteEditor k={current} /> : list.length ? (
                    <div className="vc-cnotes-grid">{list.map(([k, n]) => <NoteCard key={k} k={k} n={n} onOpen={() => setTab(k)} close={modalProps.onClose} />)}</div>
                ) : (
                    <div className="vc-tool-empty"><span className="vc-tool-empty-icon">📝</span>No notes yet. Open one from the 📝 button in any chat, or right-click a channel or server.</div>
                )}
            </div>
        </Modal>
    );
}

export function openNotes(o: { channelId?: string; guildId?: string; startKey?: string; } = {}) {
    openModal(props => <NotesModal modalProps={props} {...o} />);
}
