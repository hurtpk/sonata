/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Split View: open a second channel or DM in a panel docked to the right of
// Discord — read it live and reply from there while you use the main chat
// for something else. Right-click a channel or a DM → "Open in Split View".
// Drag the panel's left edge to resize it.

import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import ErrorBoundary from "@components/ErrorBoundary";
import { sendMessage } from "@utils/discord";
import { classes } from "@utils/misc";
import definePlugin from "@utils/types";
import { ChannelStore, createRoot, GuildStore, Menu, MessageActions, MessageStore, NavigationRouter, Parser, showToast, useEffect, useRef, UserStore, useState, useStateFromStores } from "@webpack/common";

const KEY = "Sonata_split_view";
interface State { channelId: string | null; width: number; }
let state: State = { channelId: null, width: 400 };
const listeners = new Set<() => void>();
const changed = () => { listeners.forEach(l => l()); void DataStore.set(KEY, state); };

export function openSplit(channelId: string) {
    state = { ...state, channelId };
    changed();
}

const closeSplit = () => { state = { ...state, channelId: null }; changed(); };

// ─── Right-click menus ───

const item = (channelId: string | undefined) => !channelId ? null : (
    <Menu.MenuItem id="vc-split-view" label={state.channelId === channelId ? "Close Split View" : "Open in Split View"}
        action={() => state.channelId === channelId ? closeSplit() : openSplit(channelId)} />
);

const channelMenu: NavContextMenuPatchCallback = (children, { channel }: any) => {
    if (channel?.id && channel.type !== 4) children.push(item(channel.id));
};

const userMenu: NavContextMenuPatchCallback = (children, { user, channel }: any) => {
    const dm = channel?.type === 1 ? channel.id : user?.id && ChannelStore.getDMFromUserId?.(user.id);
    if (dm) children.push(item(dm));
};

// ─── The panel ───

const nameOf = (a: any) => a?.globalName || a?.username || "Unknown";
const timeOf = (t: any) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const IMG = /^image\//;

function Message({ m, grouped, channelId }: { m: any; grouped: boolean; channelId: string; }) {
    const channel: any = ChannelStore.getChannel(channelId);
    const images = [...(m.attachments ?? [])].filter((a: any) => IMG.test(a.content_type ?? "") || /\.(png|jpe?g|gif|webp)$/i.test(a.filename ?? ""));
    const files = [...(m.attachments ?? [])].filter((a: any) => !images.includes(a));
    return (
        <div className={classes("vc-split-msg", grouped && "vc-split-grouped")}>
            {!grouped && <img className="vc-split-avatar" src={m.author?.getAvatarURL?.(channel?.guild_id, 40, false)} alt="" />}
            <div className="vc-split-msg-body">
                {!grouped && (
                    <div className="vc-split-msg-head">
                        <span className="vc-split-author">{nameOf(m.author)}</span>
                        <span className="vc-split-time">{timeOf(m.timestamp)}</span>
                    </div>
                )}
                {m.content && <div className="vc-split-text">{Parser.parse(m.content, true, { channelId, messageId: m.id, allowLinks: true })}</div>}
                {images.slice(0, 4).map((a: any) => <img key={a.id} className="vc-split-image" src={a.proxy_url ?? a.url} alt={a.filename} loading="lazy" />)}
                {files.map((a: any) => <a key={a.id} className="vc-split-file" href={a.url} target="_blank" rel="noreferrer">📎 {a.filename}</a>)}
                {!m.content && !m.attachments?.length && m.embeds?.length > 0 && <div className="vc-split-embed">🔗 {m.embeds[0].title ?? m.embeds[0].url ?? "Embed"}</div>}
            </div>
        </div>
    );
}

function SplitPanel() {
    const [, bump] = useState(0);
    useEffect(() => { const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    const { channelId } = state;
    const messages: any[] = useStateFromStores([MessageStore], () => channelId ? [...((MessageStore.getMessages(channelId) as any)?._array ?? [])] : [], [channelId]);
    const [draft, setDraft] = useState("");
    const list = useRef<HTMLDivElement>(null);
    const stick = useRef(true);
    const resizing = useRef(false);

    // Load the channel's recent messages if Discord hasn't yet.
    useEffect(() => {
        if (!channelId) return;
        if (!(MessageStore.getMessages(channelId) as any)?._array?.length) {
            try { (MessageActions as any).fetchMessages({ channelId, limit: 50 }); } catch { /* shown as empty */ }
        }
        stick.current = true;
    }, [channelId]);

    // Stay at the bottom as new messages come in (unless you've scrolled up).
    useEffect(() => {
        const el = list.current;
        if (el && stick.current) el.scrollTop = el.scrollHeight;
    }, [messages.length, channelId]);

    if (!channelId) return null;
    const channel: any = ChannelStore.getChannel(channelId);
    if (!channel) return null;
    const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
    const dmUser: any = channel.type === 1 ? UserStore.getUser(channel.recipients?.[0]) : null;
    const title = channel.type === 1 ? `@${nameOf(dmUser)}` : channel.type === 3 ? channel.name || "Group DM" : `#${channel.name}`;
    const shown = messages.slice(-80);

    const send = () => {
        const text = draft.trim();
        if (!text) return;
        sendMessage(channelId, { content: text });
        setDraft("");
        stick.current = true;
    };

    const startResize = (e: React.PointerEvent) => {
        resizing.current = true;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };
    const onResize = (e: React.PointerEvent) => {
        if (!resizing.current) return;
        state.width = Math.max(300, Math.min(window.innerWidth * 0.6, window.innerWidth - e.clientX));
        bump(n => n + 1);
    };
    const endResize = () => { if (resizing.current) { resizing.current = false; changed(); } };

    return (
        <aside className="vc-split" style={{ width: state.width }} aria-label={`Split View: ${title}`}>
            <div className="vc-split-grip" onPointerDown={startResize} onPointerMove={onResize} onPointerUp={endResize} title="Drag to resize" />
            <header className="vc-split-head">
                <div className="vc-split-title">
                    <span className="vc-split-name">{title}</span>
                    {guild && <span className="vc-split-sub">{guild.name}</span>}
                </div>
                <button type="button" title="Open it in the main view" onClick={() => { NavigationRouter.transitionTo(`/channels/${channel.guild_id ?? "@me"}/${channelId}`); closeSplit(); }}>⤢</button>
                <button type="button" title="Close Split View" onClick={closeSplit}>×</button>
            </header>
            <div className="vc-split-list" ref={list} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
                {shown.length === 0 && <div className="vc-split-empty">Loading messages…</div>}
                {shown.map((m, i) => {
                    const prev = shown[i - 1];
                    const grouped = !!prev && prev.author?.id === m.author?.id && new Date(m.timestamp).getTime() - new Date(prev.timestamp).getTime() < 5 * 60_000;
                    return <Message key={m.id} m={m} grouped={grouped} channelId={channelId} />;
                })}
            </div>
            <div className="vc-split-compose">
                <textarea rows={1} value={draft} placeholder={`Message ${title}`} onChange={e => setDraft(e.currentTarget.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            </div>
        </aside>
    );
}

let host: HTMLDivElement | null = null;
let root: { render(n: React.ReactNode): void; unmount(): void; } | null = null;
const Safe = ErrorBoundary.wrap(SplitPanel, { noop: true });

export default definePlugin({
    name: "SplitView",
    description: "Open a second channel or DM in a panel on the right — read it live and reply from there while you use the main chat. Right-click a channel or DM → \"Open in Split View\"; drag its edge to resize.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],

    contextMenus: {
        "channel-context": channelMenu,
        "thread-context": channelMenu,
        "gdm-context": channelMenu,
        "user-context": userMenu,
    },

    async start() {
        state = { channelId: null, width: 400, ...(await DataStore.get(KEY)) };
        host = document.createElement("div");
        host.id = "vc-split-host";
        document.body.appendChild(host);
        root = createRoot(host);
        root.render(<Safe />);
        if (state.channelId && !ChannelStore.getChannel(state.channelId)) { state.channelId = null; showToast("Split View's channel isn't available any more", "message"); }
    },

    stop() {
        root?.unmount();
        root = null;
        host?.remove();
        host = null;
    },
});
