/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, useEffect, useMemo, useState } from "@webpack/common";

import { Avatar, cl, classes, Thumb, useBackend, useMediaUrl } from "./bits";
import { Entry, fmtBytes, fmtDay, fmtWhen, Media, whereText } from "./data";
import { usePaged } from "./Messages";

type Kind = "all" | "image" | "video" | "file";

export function GalleryView({ list, openMedia, onShowMessage }: { list: Entry[]; openMedia(items: Media[], index: number): void; onShowMessage(e: Entry): void; }) {
    const [kind, setKind] = useState<Kind>("all");
    const [savedOnly, setSavedOnly] = useState(false);
    const [size, setSize] = useState<"s" | "m" | "l">("m");
    const backend = useBackend();

    const all = useMemo(() => list.flatMap(e => [...e.media, ...e.files]), [list]);
    const counts = useMemo(() => ({
        all: all.length,
        image: all.filter(m => m.kind === "image").length,
        video: all.filter(m => m.kind === "video").length,
        file: all.filter(m => m.kind === "file" || m.kind === "audio").length,
        saved: all.filter(m => m.saved).length,
    }), [all]);
    const items = useMemo(() => all.filter(m =>
        (kind === "all" || (kind === "file" ? m.kind === "file" || m.kind === "audio" : m.kind === kind)) && (!savedOnly || m.saved)
    ), [all, kind, savedOnly]);
    const visual = useMemo(() => items.filter(m => m.kind === "image" || m.kind === "video"), [items]);
    const { shown, more, sentinel } = usePaged(items, 80);

    const groups = useMemo(() => {
        const out: { day: string; items: Media[]; }[] = [];
        for (const m of shown) {
            const d = fmtDay(m.entry.at);
            if (out.at(-1)?.day !== d) out.push({ day: d, items: [] });
            out.at(-1)!.items.push(m);
        }
        return out;
    }, [shown]);

    return (
        <div className={cl("gallery")}>
            <div className={cl("gbar")}>
                <div className="vc-tool-seg">
                    {([["all", "All"], ["image", "🖼️ Pictures"], ["video", "🎬 Videos"], ["file", "📄 Files"]] as const).map(([k, label]) => (
                        <button key={k} type="button" className={classes("vc-tool-seg-btn", kind === k && "vc-tool-seg-on")} onClick={() => setKind(k)}>{label} <small>{counts[k]}</small></button>
                    ))}
                </div>
                <label className="vc-tool-check"><input type="checkbox" checked={savedOnly} onChange={e => setSavedOnly(e.currentTarget.checked)} /> 💾 Only saved copies ({counts.saved})</label>
                <span className="vc-tool-spacer" />
                <div className="vc-tool-seg">
                    {(["s", "m", "l"] as const).map(s => <button key={s} type="button" className={classes("vc-tool-seg-btn", size === s && "vc-tool-seg-on")} onClick={() => setSize(s)} title="Tile size">{s.toUpperCase()}</button>)}
                </div>
            </div>

            {!items.length ? (
                <div className="vc-tool-empty"><span className="vc-tool-empty-icon">🖼️</span>No {kind === "all" ? "pictures or files" : kind === "file" ? "files" : `${kind}s`} here{savedOnly ? " with a saved copy" : ""}.</div>
            ) : groups.map(g => (
                <div key={g.day} className={cl("gday")}>
                    <div className={cl("day")}><span>{g.day}</span><i>{g.items.length}</i></div>
                    <div className={classes(cl("grid"), cl(`grid-${size}`))}>
                        {g.items.map(m => m.kind === "file" || m.kind === "audio"
                            ? <Thumb key={m.key} media={m} className={cl("gfile")} onClick={() => backend.download(m)} />
                            : (
                                <div key={m.key} className={cl("gtile")}>
                                    <Thumb media={m} onClick={() => openMedia(visual, visual.indexOf(m))} />
                                    <button type="button" className={cl("gtile-info")} onClick={() => onShowMessage(m.entry)} title="Show the message">
                                        <Avatar src={m.entry.author.avatar} size={18} />
                                        <span>{m.entry.author.name}</span>
                                    </button>
                                </div>
                            ))}
                    </div>
                </div>
            ))}
            {more && <div ref={sentinel} className={cl("loading-more")}>Loading more…</div>}
        </div>
    );
}

/** The big viewer: arrow keys to move, Esc to close. */
export function Lightbox({ items, index, onIndex, onClose, onShowMessage }: { items: Media[]; index: number; onIndex(i: number): void; onClose(): void; onShowMessage(e: Entry): void; }) {
    const backend = useBackend();
    const m = items[index];
    const { url, local } = useMediaUrl(m ?? null);
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [url]);

    useEffect(() => {
        const key = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") onClose();
            else if (ev.key === "ArrowRight") onIndex(Math.min(items.length - 1, index + 1));
            else if (ev.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
            else return;
            ev.preventDefault();
            ev.stopImmediatePropagation();
        };
        // Capture, so Esc closes the viewer and not the whole window.
        window.addEventListener("keydown", key, true);
        return () => window.removeEventListener("keydown", key, true);
    }, [index, items.length]);

    if (!m) return null;
    const e = m.entry;

    return (
        <div className={cl("lightbox")} onClick={onClose}>
            <div className={cl("lb-top")} onClick={ev => ev.stopPropagation()}>
                <Avatar src={e.author.avatar} size={30} />
                <div className={cl("lb-who")}>
                    <b>{e.author.name}</b>
                    <span>{whereText(e.place)} · {fmtWhen(e.sent)}</span>
                </div>
                <span className={classes("vc-tool-badge", local ? "vc-tool-badge-good" : "")}>{local ? "💾 Saved copy" : m.fromEmbed ? "From a link" : "Discord's link"}</span>
                <span className={cl("lb-count")}>{index + 1} / {items.length}</span>
                <button type="button" className="vc-tool-btn" onClick={() => onShowMessage(e)}>Show message</button>
                <button type="button" className="vc-tool-btn" onClick={() => backend.copy(m.url)}>Copy link</button>
                <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => backend.download(m)}>Download</button>
                <button type="button" className="vc-tool-icon" onClick={onClose} title="Close (Esc)">✕</button>
            </div>
            <div className={cl("lb-stage")}>
                {index > 0 && <button type="button" className={classes(cl("lb-nav"), cl("lb-prev"))} onClick={ev => { ev.stopPropagation(); onIndex(index - 1); }}>‹</button>}
                <div className={cl("lb-media")} onClick={ev => ev.stopPropagation()}>
                    {!url ? <span className={cl("muted")}>Loading…</span>
                        : failed ? <span className={cl("thumb-gone")}>🚫<small>{m.saved ? "Couldn't open the saved copy" : "Discord already removed this, and no copy was saved"}</small></span>
                            : m.kind === "video" ? <video key={url} src={url} controls autoPlay loop onError={() => setFailed(true)} />
                                : <img key={url} src={url} alt="" onError={() => setFailed(true)} />}
                </div>
                {index < items.length - 1 && <button type="button" className={classes(cl("lb-nav"), cl("lb-next"))} onClick={ev => { ev.stopPropagation(); onIndex(index + 1); }}>›</button>}
            </div>
            <div className={cl("lb-bottom")} onClick={ev => ev.stopPropagation()}>
                <span>{m.name}</span>
                {m.width && m.height ? <span>{m.width}×{m.height}</span> : null}
                {m.size ? <span>{fmtBytes(m.size)}</span> : null}
                {e.m.content && <span className={cl("lb-caption")}>“{e.m.content.slice(0, 160)}”</span>}
            </div>
        </div>
    );
}
