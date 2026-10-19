/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { ChannelStore, NavigationRouter, ReadStateStore, RestAPI, useEffect, useLayoutEffect, useRef, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { isUnread, readableContent } from "./resolve";

const cl = classNameFactory("vc-dmprev-");

export interface PreviewState { channelId: string; rect: DOMRect; }

let state: PreviewState | null = null;
const listeners = new Set<() => void>();
export function setPreview(next: PreviewState | null) { state = next; listeners.forEach(l => l()); }
export const getPreview = () => state;

export interface PreviewMessage {
    id: string;
    authorId: string;
    authorName: string;
    content: string;
    timestamp: number;
    images: string[];
    otherFiles: number;
    embeds: number;
}

// Messages fetched for channels that weren't loaded yet, reused until a new
// message arrives (or for a minute) so hovering back and forth is free.
const cache = new Map<string, { lastId: string | null; at: number; messages: PreviewMessage[]; }>();
const CACHE_MS = 60_000;

const nameOf = (u: any) => u?.globalName ?? u?.global_name ?? u?.username ?? "Someone";

function toPreview(m: any): PreviewMessage {
    const attachments: any[] = m.attachments ?? [];
    const images = attachments
        .filter(a => (a.content_type ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(a.filename ?? ""))
        .map(a => a.proxy_url ?? a.url).filter(Boolean);
    return {
        id: m.id,
        authorId: m.author?.id,
        authorName: nameOf(m.author),
        content: m.content ?? "",
        timestamp: new Date(m.timestamp).getTime(),
        images,
        otherFiles: attachments.length - images.length,
        embeds: m.embeds?.length ?? 0,
    };
}

/** Latest messages: from what Discord already has loaded, else one small fetch (cached). */
export async function latestMessages(channelId: string, count: number, store: any): Promise<PreviewMessage[]> {
    const lastId = (ChannelStore.getChannel(channelId) as any)?.lastMessageId ?? null;
    const loaded: any[] = store?.getMessages?.(channelId)?.toArray?.() ?? [];
    if (loaded.length && (!lastId || loaded[loaded.length - 1]?.id === lastId)) {
        return loaded.slice(-count).map(toPreview);
    }
    const hit = cache.get(channelId);
    if (hit && hit.lastId === lastId && Date.now() - hit.at < CACHE_MS && hit.messages.length >= Math.min(count, 1)) {
        return hit.messages.slice(-count);
    }
    // Reading messages this way does not mark anything as read.
    const res: any = await RestAPI.get({ url: `/channels/${channelId}/messages`, query: { limit: count } });
    const messages = (res?.body ?? []).slice().reverse().map(toPreview);
    cache.set(channelId, { lastId, at: Date.now(), messages });
    return messages;
}

export function PreviewPopover({ count, showImages, messageStore, onEnter, onLeave }: {
    count: number; showImages: boolean; messageStore: any; onEnter(): void; onLeave(): void;
}) {
    const [, force] = useState(0);
    useEffect(() => {
        const l = () => force(n => n + 1);
        listeners.add(l);
        return () => { listeners.delete(l); };
    }, []);
    const [data, setData] = useState<{ channelId: string; messages: PreviewMessage[] | null; error?: boolean; } | null>(null);
    const box = useRef<HTMLDivElement>(null);
    const [top, setTop] = useState<number | null>(null);

    const current = state;
    useEffect(() => {
        if (!current) return;
        let cancelled = false;
        setData({ channelId: current.channelId, messages: null });
        latestMessages(current.channelId, count, messageStore)
            .then(messages => { if (!cancelled) setData({ channelId: current.channelId, messages }); })
            .catch(() => { if (!cancelled) setData({ channelId: current.channelId, messages: [], error: true }); });
        return () => { cancelled = true; };
    }, [current?.channelId]);

    // Centre on the bubble, but keep the whole popover on-screen.
    useLayoutEffect(() => {
        if (!current || !box.current) return;
        const h = box.current.offsetHeight;
        const centre = current.rect.top + current.rect.height / 2;
        setTop(Math.max(12, Math.min(centre - h / 2, window.innerHeight - h - 12)));
    });

    if (!current) return null;
    const ch = ChannelStore.getChannel(current.channelId) as any;
    if (!ch) return null;

    const group = ch.isGroupDM?.();
    const other = !group ? UserStore.getUser(ch.recipients?.[0]) : null;
    const title = group ? (ch.name || "Group DM") : nameOf(other);
    const ack = ReadStateStore.ackMessageId?.(current.channelId);
    const unreadCount = ReadStateStore.getUnreadCount?.(current.channelId) ?? 0;
    const messages = data?.channelId === current.channelId ? data.messages : null;
    const accent = windowAccent("messagePreview");

    const width = 320;
    const left = Math.min(current.rect.right + 14, window.innerWidth - width - 12);

    return (
        <div
            ref={box}
            className={cl("popover")}
            style={{ left, top: top ?? current.rect.top, width, visibility: top == null ? "hidden" : undefined, ...(accent ? { "--vc-tool-accent": accent } : {}) } as React.CSSProperties}
            onMouseEnter={onEnter}
            onMouseLeave={onLeave}
            onClick={() => { NavigationRouter.transitionTo(`/channels/@me/${current.channelId}`); setPreview(null); }}
            role="dialog"
            aria-label={`Preview of ${title}`}
        >
            <div className={cl("head")}>
                <span className={cl("title")}>{title}</span>
                {unreadCount > 0 && <span className={cl("badge")}>{unreadCount} new</span>}
            </div>
            <div className={cl("body")}>
                {messages == null ? (
                    <div className={cl("note")}>Loading…</div>
                ) : data?.error ? (
                    <div className={cl("note")}>Couldn't load the preview.</div>
                ) : messages.length === 0 ? (
                    <div className={cl("note")}>No messages yet.</div>
                ) : messages.map(m => (
                    <div key={m.id} className={classes(cl("msg"), isUnread(m.id, ack) && cl("msg-unread"))}>
                        <div className={cl("msg-head")}>
                            <span className={cl("msg-author")}>{m.authorId === UserStore.getCurrentUser()?.id ? "You" : m.authorName}</span>
                            <span className={cl("msg-time")}>{new Date(m.timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                        </div>
                        {m.content && <div className={cl("msg-text")}>{readableContent(m.content, id => nameOf(UserStore.getUser(id)))}</div>}
                        {showImages && m.images.length > 0 && (
                            <div className={cl("imgs")}>{m.images.slice(0, 3).map(src => <img key={src} className={cl("img")} src={`${src}${src.includes("?") ? "&" : "?"}width=160&height=120`} alt="" />)}</div>
                        )}
                        {(m.otherFiles > 0 || (!showImages && m.images.length > 0) || (!m.content && m.embeds > 0)) && (
                            <div className={cl("msg-extra")}>
                                {[
                                    (!showImages && m.images.length) ? `🖼 ${m.images.length} image${m.images.length === 1 ? "" : "s"}` : null,
                                    m.otherFiles ? `📎 ${m.otherFiles} file${m.otherFiles === 1 ? "" : "s"}` : null,
                                    !m.content && m.embeds ? "🔗 embed" : null,
                                ].filter(Boolean).join(" · ")}
                            </div>
                        )}
                    </div>
                ))}
            </div>
            <div className={cl("foot")}>Click to open · previewing doesn't mark anything as read</div>
        </div>
    );
}
