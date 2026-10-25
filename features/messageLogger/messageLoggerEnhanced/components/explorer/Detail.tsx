/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, useEffect, useState } from "@webpack/common";

import { Avatar, Badges, cl, classes, Content, Thumb, useBackend } from "./bits";
import { diffWords, Entry, exportText, fmtBytes, fmtDuration, fmtWhen, LogIndex, Media, Scope, whereText } from "./data";
import { conversationPicture } from "./picture";

interface Props {
    e: Entry;
    index: LogIndex;
    onClose(): void;
    onScope(s: Scope): void;
    openMedia(items: Media[], index: number): void;
    onRemove(list: Entry[]): void;
    onMeta(e: Entry, patch: { star?: boolean; note?: string; }): void;
}

export function Detail({ e, index, onClose, onScope, openMedia, onRemove, onMeta }: Props) {
    const backend = useBackend();
    const [note, setNote] = useState(e.note);
    const [, setTick] = useState(0);
    useEffect(() => setNote(e.note), [e.id]);
    const saveNote = () => { if (note !== e.note) onMeta(e, { note }); };
    const ignored = new Set(backend.ignored());
    const toggleIgnore = (id: string) => { backend.setIgnored(id, !ignored.has(id)); setTick(t => t + 1); };
    const countFor = (pred: (x: Entry) => boolean) => index.entries.filter(pred).length;
    const [changes, setChanges] = useState(true);
    const [ids, setIds] = useState(false);
    const p = e.place;
    const fromThem = index.people.get(e.authorId);
    const allMedia = [...e.media];

    return (
        <aside className={cl("detail")}>
            <div className={cl("detail-head")}>
                <Avatar src={e.author.avatar} size={46} />
                <div className={cl("detail-who")}>
                    <b>{e.author.name}</b>
                    <span>{e.author.username ? `@${e.author.username}` : e.authorId}</span>
                </div>
                <button type="button" className={classes("vc-tool-icon", cl("star"), e.star && cl("star-on"))} title={e.star ? "Unstar" : "Star: keep this log forever"} onClick={() => onMeta(e, { star: !e.star })}>{e.star ? "★" : "☆"}</button>
                <button type="button" className="vc-tool-icon" title="Close (Esc)" onClick={onClose}>✕</button>
            </div>
            <div className={cl("detail-badges")}><Badges e={e} /></div>

            <div className={cl("detail-scroll")}>
                <section className={cl("dsec")}>
                    <div className={cl("crumbs")}>
                        {p.guildId ? (
                            <>
                                <button type="button" className="vc-tool-chip" onClick={() => onScope({ kind: "guild", id: p.guildId! })}>🏠 {p.guildName}</button>
                                {p.categoryName && <button type="button" className="vc-tool-chip" onClick={() => onScope({ kind: "category", guildId: p.guildId!, id: p.categoryId ?? "" })}>📁 {p.categoryName}</button>}
                                <button type="button" className="vc-tool-chip" onClick={() => onScope({ kind: "channel", id: p.channelId })}>{p.kind === "thread" ? "🧵" : "#"} {p.channelName}</button>
                            </>
                        ) : (
                            <button type="button" className="vc-tool-chip" onClick={() => onScope({ kind: "channel", id: p.channelId })}>{p.kind === "group" ? "👥" : "✉️"} {p.kind === "group" ? p.channelName : `DM with ${p.channelName}`}</button>
                        )}
                    </div>
                    <dl className={cl("facts")}>
                        <dt>Sent</dt><dd>{fmtWhen(e.sent)}</dd>
                        {e.edited && <><dt>Edited</dt><dd>{e.versions.length - 1} time{e.versions.length > 2 ? "s" : ""}{e.versions.at(-1)?.at ? `, last ${fmtDuration((e.versions.at(-1)!.at ?? e.sent) - e.sent)} after sending` : ""}</dd></>}
                        {e.gone != null && <><dt>{e.ghost ? "Ghost ping" : "Deleted"}</dt><dd>{fmtWhen(e.gone)} <span className={cl("muted")}>({fmtDuration(e.gone - e.sent)} after sending)</span></dd></>}
                        {e.deleted && e.gone == null && <><dt>Deleted</dt><dd className={cl("muted")}>Time not recorded</dd></>}
                        {e.mentionsMe && <><dt>Pinged you</dt><dd>Yes{e.m.mention_everyone ? " (@everyone)" : ""}</dd></>}
                    </dl>
                </section>

                {e.reply && (
                    <section className={cl("dsec")}>
                        <span className="vc-tool-label">Replying to</span>
                        <div className={cl("reply")}>↪ <b>{e.reply.name}</b> {e.reply.content || "a message"}</div>
                    </section>
                )}

                <section className={cl("dsec")}>
                    <div className="vc-tool-head">
                        <span className="vc-tool-label">{e.edited ? `All ${e.versions.length} versions` : "Message"}</span>
                        {e.edited && <button type="button" className="vc-tool-link" onClick={() => setChanges(c => !c)}>{changes ? "Hide changes" : "Show changes"}</button>}
                    </div>
                    {e.edited ? (
                        <ol className={cl("versions")}>
                            {e.versions.map((v, i) => (
                                <li key={i} className={classes(cl("version"), i === e.versions.length - 1 && cl("version-now"))}>
                                    <span className={cl("version-tag")}>{i === 0 ? "Original" : i === e.versions.length - 1 ? (e.deleted ? "Last" : "Now") : `Edit ${i}`}{v.at ? ` · ${fmtWhen(v.at)}` : ""}</span>
                                    {changes && i > 0
                                        ? <div className={cl("content")}>{diffWords(e.versions[i - 1].content, v.content).map((d, j) => d.kind === "same" ? d.text : <span key={j} className={cl(`diff-${d.kind}`)}>{d.text}</span>)}</div>
                                        : <Content text={v.content} entry={e} />}
                                </li>
                            ))}
                        </ol>
                    ) : <Content text={e.m.content ?? ""} entry={e} className={cl("big")} />}
                </section>

                {allMedia.length > 0 && (
                    <section className={cl("dsec")}>
                        <div className="vc-tool-head">
                            <span className="vc-tool-label">Pictures &amp; videos · {allMedia.length}</span>
                            <button type="button" className="vc-tool-link" onClick={() => allMedia.forEach(m => backend.download(m))}>Download all</button>
                        </div>
                        <div className={cl("dthumbs")}>{allMedia.map((m, i) => <Thumb key={m.key} media={m} onClick={() => openMedia(allMedia, i)} />)}</div>
                    </section>
                )}
                {e.files.length > 0 && (
                    <section className={cl("dsec")}>
                        <span className="vc-tool-label">Files · {e.files.length}</span>
                        {e.files.map(f => <Thumb key={f.key} media={f} onClick={() => backend.download(f)} />)}
                    </section>
                )}
                {e.embeds.length > 0 && (
                    <section className={cl("dsec")}>
                        <span className="vc-tool-label">Embeds</span>
                        {e.embeds.map((x, i) => (
                            <div key={i} className={cl("dembed")}>
                                {x.title && <b>{x.title}</b>}
                                {x.description && <span>{x.description}</span>}
                                {x.url && <a href={x.url} target="_blank" rel="noreferrer">{x.url}</a>}
                            </div>
                        ))}
                    </section>
                )}

                <section className={cl("dsec")}>
                    <div className="vc-tool-head">
                        <span className="vc-tool-label">Your note</span>
                        {e.star && <span className="vc-tool-badge vc-tool-badge-accent">★ Kept forever</span>}
                    </div>
                    <textarea className={classes("vc-tool-area", cl("note-input"))} placeholder="Add a note — only you see it, and you can search for it" value={note}
                        onChange={ev => setNote(ev.currentTarget.value)} onBlur={saveNote} />
                </section>

                {fromThem && fromThem.count > 1 && (
                    <button type="button" className={cl("more-from")} onClick={() => onScope({ kind: "person", id: e.authorId })}>
                        <Avatar src={e.author.avatar} size={22} />
                        <span><b>{fromThem.count - 1}</b> more logged from {e.author.name} — {fromThem.deleted} deleted, {fromThem.edited} edited{fromThem.ghost ? `, ${fromThem.ghost} ghost pings` : ""}</span>
                        <span>›</span>
                    </button>
                )}

                <section className={cl("dsec")}>
                    <span className="vc-tool-label">Logging</span>
                    {([
                        [e.authorId, e.author.name, (x: Entry) => x.authorId === e.authorId],
                        [e.channelId, p.guildId ? `#${p.channelName}` : p.kind === "group" ? p.channelName : `DMs with ${p.channelName}`, (x: Entry) => x.channelId === e.channelId],
                        ...(p.guildId ? [[p.guildId, p.guildName ?? "this server", (x: Entry) => x.place.guildId === p.guildId]] as const : []),
                    ] as const).map(([id, label, pred]) => {
                        const off = ignored.has(id);
                        const n = countFor(pred);
                        return (
                            <div key={id} className={cl("ignore-row")}>
                                <span>{off ? <>🚫 Not logging <b>{label}</b></> : <>Logging <b>{label}</b></>}</span>
                                <button type="button" className="vc-tool-link" onClick={() => toggleIgnore(id)}>{off ? "Log again" : "Stop logging"}</button>
                                {off && n > 0 && <button type="button" className="vc-tool-link" onClick={() => onRemove(index.entries.filter(pred).filter(x => !x.star))}>Delete {n} log{n === 1 ? "" : "s"}</button>}
                            </div>
                        );
                    })}
                </section>

                <section className={cl("dsec")}>
                    <div className="vc-tool-head">
                        <span className="vc-tool-label">IDs</span>
                        <button type="button" className="vc-tool-link" onClick={() => setIds(x => !x)}>{ids ? "Hide" : "Show"}</button>
                    </div>
                    {ids && (
                        <div className={cl("ids")}>
                            {([["Message", e.id], ["Person", e.authorId], ["Channel", e.channelId], ["Server", p.guildId]] as const).filter(([, v]) => v).map(([k, v]) => (
                                <button key={k} type="button" onClick={() => backend.copy(v!)} title="Copy"><span>{k}</span><code>{v}</code></button>
                            ))}
                        </div>
                    )}
                    <span className="vc-tool-hint">Logged {fmtBytes(JSON.stringify(e.rec).length)} · {e.media.filter(m => m.saved).length + e.files.filter(m => m.saved).length} file{e.media.length + e.files.length === 1 ? "" : "s"} saved on this computer</span>
                </section>
            </div>

            <div className={cl("detail-actions")}>
                <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => backend.jump(e)}>Jump to message</button>
                <button type="button" className="vc-tool-btn" onClick={() => backend.quote(e.m.content ?? "")} title="Put it in your message box as a quote">❝ Quote</button>
                <button type="button" className="vc-tool-btn" onClick={() => backend.copy(e.m.content ?? "")}>Copy text</button>
                <button type="button" className="vc-tool-btn" title="Save this message (with its earlier versions) as a picture" onClick={() => {
                    void conversationPicture([e], whereText(e.place)).then(png => backend.save(`message-${e.id}.png`, "image/png", png), err => backend.toast(err?.message ?? "Couldn't make the picture", false));
                }}>🖼️ Picture</button>
                <button type="button" className="vc-tool-btn" title="Save this message as a text file" onClick={() => backend.save(`message-${e.id}.txt`, "text/plain", exportText([e]))}>📝 Text file</button>
                <button type="button" className="vc-tool-btn" onClick={() => backend.profile(e.authorId)}>Profile</button>
                <button type="button" className="vc-tool-btn vc-tool-danger" onClick={() => onRemove([e])}>Delete log</button>
            </div>
        </aside>
    );
}
