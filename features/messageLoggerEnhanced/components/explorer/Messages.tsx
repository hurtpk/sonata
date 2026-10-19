/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { Avatar, Badges, cl, classes, Content, Thumb, useBackend } from "./bits";
import { Entry, fmtDay, fmtDuration, fmtTime, fmtWhen, Media, Scope, whereText } from "./data";

const PAGE = 60;

/** Shows more as you scroll to the bottom. */
export function usePaged<T>(list: T[], page = PAGE) {
    const [limit, setLimit] = useState(page);
    const sentinel = useRef<HTMLDivElement>(null);
    useEffect(() => setLimit(page), [list]);
    useEffect(() => {
        const el = sentinel.current;
        if (!el) return;
        const io = new IntersectionObserver(([x]) => { if (x.isIntersecting) setLimit(l => l + page); }, { rootMargin: "400px" });
        io.observe(el);
        return () => io.disconnect();
    }, [list, limit >= list.length]);
    return { shown: list.slice(0, limit), more: limit < list.length, sentinel };
}

export function footLine(e: Entry): string {
    const parts = [`Sent ${fmtWhen(e.sent)}`];
    if (e.edited) parts.push(`edited ${e.versions.length - 1}×`);
    if (e.gone != null) parts.push(`${e.ghost ? "deleted" : "gone"} ${fmtDuration(e.gone - e.sent)} later`);
    return parts.join(" · ");
}

interface Props {
    list: Entry[];
    selectedId: string | null;
    onSelect(e: Entry): void;
    picking: boolean;
    picked: Set<string>;
    onPick(id: string, range?: boolean): void;
    onScope(s: Scope): void;
    openMedia(items: Media[], index: number): void;
    look: "cards" | "discord";
    onStar(e: Entry): void;
}

export function MessagesView({ list, selectedId, onSelect, picking, picked, onPick, onScope, openMedia, look, onStar }: Props) {
    const { shown, more, sentinel } = usePaged(list);
    const backend = useBackend();

    // Day headings.
    const rows = useMemo(() => {
        const out: ({ day: string; count: number; } | Entry)[] = [];
        let last = "";
        const counts = new Map<string, number>();
        for (const e of list) { const d = fmtDay(e.at); counts.set(d, (counts.get(d) ?? 0) + 1); }
        for (const e of shown) {
            const d = fmtDay(e.at);
            if (d !== last) { out.push({ day: d, count: counts.get(d) ?? 0 }); last = d; }
            out.push(e);
        }
        return out;
    }, [shown, list]);

    if (!list.length) return null;

    return (
        <div className={cl("feed")}>
            {rows.map((r, i) => "day" in r
                ? <div key={`d${r.day}`} className={cl("day")}><span>{r.day}</span><i>{r.count.toLocaleString()}</i></div>
                : look === "discord" && backend.discordView
                    ? (
                        <div key={r.id} className={classes(cl("dview"), r.id === selectedId && cl("dview-on"))} onClick={() => onSelect(r)}>
                            {picking && <input type="checkbox" className={cl("pick")} checked={picked.has(r.id)} onClick={ev => { ev.stopPropagation(); onPick(r.id, ev.shiftKey); }} onChange={() => { }} />}
                            {backend.discordView(r, !(rows[i - 1] && !("day" in rows[i - 1]) && (rows[i - 1] as Entry).authorId === r.authorId))}
                            <span className={cl("dview-where")}>{whereText(r.place)} · {footLine(r)}</span>
                        </div>
                    )
                    : <Card key={r.id} e={r} on={r.id === selectedId} picking={picking} picked={picked.has(r.id)} onClick={() => onSelect(r)} onPick={range => onPick(r.id, range)} onScope={onScope} openMedia={openMedia} onStar={() => onStar(r)} />
            )}
            {more && <div ref={sentinel} className={cl("loading-more")}>Loading more…</div>}
        </div>
    );
}

function Card({ e, on, picking, picked, onClick, onPick, onScope, openMedia, onStar }: {
    e: Entry; on: boolean; picking: boolean; picked: boolean; onClick(): void; onPick(range: boolean): void; onScope(s: Scope): void; openMedia(items: Media[], index: number): void; onStar(): void;
}) {
    const tone = e.ghost ? "ghost" : e.deleted ? "del" : "edit";
    const first = e.versions[0];
    return (
        <div className={classes(cl("card"), cl(`card-${tone}`), on && cl("card-on"), picked && cl("card-picked"))} onClick={onClick} data-mlx-id={e.id}>
            {picking && <input type="checkbox" className={cl("pick")} checked={picked} onClick={ev => { ev.stopPropagation(); onPick(ev.shiftKey); }} onChange={() => { }} />}
            <Avatar src={e.author.avatar} size={38} />
            <div className={cl("card-main")}>
                <div className={cl("card-head")}>
                    <b className={cl("name")}>{e.author.name}</b>
                    {e.author.username && e.author.username.toLowerCase() !== e.author.name.toLowerCase() && <span className={cl("user")}>@{e.author.username}</span>}
                    <Badges e={e} />
                    <span className="vc-tool-spacer" />
                    <button type="button" className={classes(cl("star"), e.star && cl("star-on"))} title={e.star ? "Starred — kept forever. Click to unstar" : "Star: keep this log forever"} onClick={ev => { ev.stopPropagation(); onStar(); }}>{e.star ? "★" : "☆"}</button>
                    <span className={cl("time")} title={fmtWhen(e.at)}>{fmtTime(e.at)}</span>
                </div>
                <button type="button" className={cl("where")} onClick={ev => { ev.stopPropagation(); onScope({ kind: "channel", id: e.channelId }); }} title="Show only this place">
                    {whereText(e.place)}
                </button>
                {e.reply && <div className={cl("reply")}>↪ <b>{e.reply.name}</b> {e.reply.content.slice(0, 140) || "a message"}</div>}
                {e.edited && first.content !== e.m.content && <Content text={first.content} entry={e} className={cl("old")} />}
                <Content text={e.m.content ?? ""} entry={e} />
                {e.media.length > 0 && (
                    <div className={cl("thumbs")}>
                        {e.media.slice(0, 4).map((m, i) => (
                            <Thumb key={m.key} media={m} onClick={() => { openMedia(e.media, i); }} />
                        ))}
                        {e.media.length > 4 && <button type="button" className={cl("thumb-more")} onClick={ev => { ev.stopPropagation(); openMedia(e.media, 4); }}>+{e.media.length - 4}</button>}
                    </div>
                )}
                {e.files.length > 0 && <div className={cl("files")}>{e.files.slice(0, 3).map(f => <Thumb key={f.key} media={f} />)}</div>}
                {e.embeds.length > 0 && <div className={cl("embed")}>🔗 <b>{e.embeds[0].title ?? ""}</b> {e.embeds[0].description?.slice(0, 120) ?? ""}</div>}
                {e.note && <div className={cl("note")}>📝 {e.note}</div>}
                <div className={cl("card-foot")}>{footLine(e)}</div>
            </div>
        </div>
    );
}

export type { Props as MessagesProps };
export const stop = (ev: React.SyntheticEvent) => ev.stopPropagation();
