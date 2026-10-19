/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sticky Message: right-click any message → "Stick to bottom", and it stays
// just above the chat box in that channel while you scroll — handy for
// instructions, a recipe, the rules of a game. One per channel, only for you.
// It can stay until you unstick it, or just for a while (an hour, the rest of
// today, a week) and then unstick itself.
// It floats over the chat (following the chat box), so Discord's own layout
// is never touched.

import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { DataStore } from "@api/index";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { createRoot, Menu, NavigationRouter, Parser, SelectedChannelStore, useEffect, useRef, useState, useStateFromStores } from "@webpack/common";

interface Sticky { id: string; channelId: string; guildId?: string; author: string; avatar?: string; content: string; image?: string; at: number; /** Unsticks itself at this time. */ until?: number; }

const KEY = "Sonata_sticky_messages";
let stickies: Record<string, Sticky> = {};
const listeners = new Set<() => void>();
const changed = () => { listeners.forEach(l => l()); void DataStore.set(KEY, stickies); };

/** How long a message can stay stuck: forever, or until a time worked out when you pick it. */
const FOR: { id: string; label: string; until(): number | undefined; }[] = [
    { id: "always", label: "Until I unstick it", until: () => undefined },
    { id: "hour", label: "For 1 hour", until: () => Date.now() + 3_600_000 },
    { id: "today", label: "For the rest of today", until: () => { const d = new Date(); d.setHours(23, 59, 59, 0); return d.getTime(); } },
    { id: "week", label: "For a week", until: () => Date.now() + 7 * 86_400_000 },
];

/** Unstick everything whose time is up. */
function sweep() {
    const now = Date.now();
    const gone = Object.values(stickies).filter(s => s.until != null && s.until <= now);
    if (!gone.length) return;
    for (const s of gone) delete stickies[s.channelId];
    changed();
}

function timeLeft(until: number) {
    const m = Math.max(1, Math.round((until - Date.now()) / 60000));
    if (m < 60) return `${m}m left`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h}h left` : `${Math.round(h / 24)}d left`;
}

function stick(message: any, channel: any, until?: number) {
    const img = [...(message.attachments ?? [])].find((a: any) => /^image\//.test(a.content_type ?? "") || /\.(png|jpe?g|gif|webp)$/i.test(a.filename ?? ""));
    stickies[message.channel_id] = {
        id: message.id,
        channelId: message.channel_id,
        guildId: channel?.guild_id,
        author: message.author?.globalName || message.author?.username || "Someone",
        avatar: message.author?.getAvatarURL?.(channel?.guild_id, 32, false),
        content: message.content ?? "",
        image: img?.proxy_url ?? img?.url,
        at: Date.now(),
        until,
    };
    changed();
}

function unstick(channelId: string) {
    delete stickies[channelId];
    changed();
}

const messageMenu: NavContextMenuPatchCallback = (children, { message, channel }: any) => {
    if (!message) return;
    const stuck = stickies[message.channel_id]?.id === message.id;
    children.push(stuck
        ? <Menu.MenuItem id="vc-sticky-message" label="Unstick from bottom" action={() => unstick(message.channel_id)} />
        : (
            <Menu.MenuItem id="vc-sticky-message" label="Stick to bottom" action={() => stick(message, channel)}>
                {FOR.map(f => <Menu.MenuItem key={f.id} id={`vc-sticky-for-${f.id}`} label={f.label} action={() => stick(message, channel, f.until())} />)}
            </Menu.MenuItem>
        ));
};

function StickyCard() {
    const channelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());
    const [, bump] = useState(0);
    const [collapsed, setCollapsed] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const l = () => bump(n => n + 1);
        listeners.add(l);
        return () => void listeners.delete(l);
    }, []);

    const hasSticky = !!(channelId && stickies[channelId]);

    // Count down (and unstick when time's up) only while something here has a time limit.
    const timed = hasSticky && stickies[channelId!].until != null;
    useEffect(() => {
        if (!timed) return;
        const t = setInterval(() => { sweep(); bump(n => n + 1); }, 30_000);
        return () => clearInterval(t);
    }, [timed, channelId]);

    // Follow the chat box as the window resizes or the reply bar opens — only
    // while a message is stuck here. It used to search the whole page five
    // times a second forever, which made Chromium create and throw away page
    // objects nonstop (and hold on to the memory).
    useEffect(() => {
        if (!hasSticky) return;
        let box: HTMLElement | null = null;
        let last = "";
        const place = () => {
            const el = ref.current;
            if (!el) return;
            if (!box?.isConnected) box = [...document.querySelectorAll<HTMLElement>('[class*="chatContent"] [class*="channelTextArea"]')].find(b => b.offsetParent) ?? null;
            const r = box?.getBoundingClientRect();
            const next = r ? `${r.left}|${r.width}|${window.innerHeight - r.top + 8}` : "hidden";
            if (next === last) return;
            last = next;
            if (!r) { el.style.display = "none"; return; }
            el.style.display = "";
            el.style.left = `${r.left}px`;
            el.style.width = `${r.width}px`;
            el.style.bottom = `${window.innerHeight - r.top + 8}px`;
        };
        place();
        const ro = new ResizeObserver(place);
        const watch = () => { if (box) ro.observe(box); };
        watch();
        // The chat box can be swapped out (opening a thread, the reply bar), so check now and then.
        const t = setInterval(() => { const before = box; place(); if (box !== before) { ro.disconnect(); watch(); } }, 1000);
        window.addEventListener("resize", place);
        return () => { clearInterval(t); ro.disconnect(); window.removeEventListener("resize", place); };
    }, [hasSticky, channelId]);

    const s = channelId ? stickies[channelId] : undefined;
    if (!s) return <div ref={ref} />;

    return (
        <div ref={ref} className={`vc-sticky${collapsed ? " vc-sticky-collapsed" : ""}`}>
            {collapsed ? (
                <button type="button" className="vc-sticky-pill" onClick={() => setCollapsed(false)} title="Show the stuck message">📌 {s.author}'s message</button>
            ) : (
                <>
                    <span className="vc-sticky-pin" aria-hidden>📌</span>
                    {s.avatar && <img className="vc-sticky-avatar" src={s.avatar} alt="" />}
                    <div className={`vc-sticky-body${expanded ? " vc-sticky-expanded" : ""}`} onClick={() => setExpanded(e => !e)} title={expanded ? "Show less" : "Show all"}>
                        <span className="vc-sticky-author">{s.author}</span>
                        {s.until != null && <span className="vc-sticky-left" title={`Unsticks itself ${new Date(s.until).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`}>⏱ {timeLeft(s.until)}</span>}
                        <div className="vc-sticky-text">{s.content ? Parser.parse(s.content, true, { channelId: s.channelId, messageId: s.id, allowLinks: true }) : <i>(image)</i>}</div>
                        {expanded && s.image && <img className="vc-sticky-image" src={s.image} alt="" />}
                    </div>
                    <div className="vc-sticky-actions">
                        <button type="button" title="Jump to the message" onClick={() => NavigationRouter.transitionTo(`/channels/${s.guildId ?? "@me"}/${s.channelId}/${s.id}`)}>↗</button>
                        <button type="button" title="Tuck away" onClick={() => setCollapsed(true)}>–</button>
                        <button type="button" title="Unstick" onClick={() => unstick(s.channelId)}>×</button>
                    </div>
                </>
            )}
        </div>
    );
}

let host: HTMLDivElement | null = null;
let root: { render(n: React.ReactNode): void; unmount(): void; } | null = null;
const SafeCard = ErrorBoundary.wrap(StickyCard, { noop: true });

export default definePlugin({
    name: "StickyMessage",
    description: "Right-click any message → \"Stick to bottom\" to keep it just above the chat box in that channel while you scroll — for instructions, a recipe or game rules. One per channel, only for you.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],

    contextMenus: { message: messageMenu },

    async start() {
        stickies = (await DataStore.get(KEY)) ?? {};
        sweep();
        host = document.createElement("div");
        host.id = "vc-sticky-host";
        document.body.appendChild(host);
        root = createRoot(host);
        root.render(<SafeCard />);
    },

    stop() {
        root?.unmount();
        root = null;
        host?.remove();
        host = null;
    },
});
