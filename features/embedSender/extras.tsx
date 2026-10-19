/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Embed Sender extras: fill-ins like {date} and {server}, saved webhooks,
// colours picked from a server icon, and sending later (once or repeating).

import { ChannelStore, GuildMemberCountStore, GuildStore, React, SelectedChannelStore, useEffect, UserStore,useState } from "@webpack/common";

/* ── Which server and channel a webhook posts in ───────────────────── */

export interface HookInfo { guildId: string | null; channelId: string | null; name: string | null; /** Set when the webhook belongs to a bot (only those can send clickable buttons). */ applicationId: string | null; }
const hookCache = new Map<string, Promise<HookInfo | null>>();

export function hookInfo(url: string): Promise<HookInfo | null> {
    const key = url.trim().split("?")[0];
    if (!/^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/(v\d+\/)?webhooks\/\d+\/[\w-]+$/.test(key)) return Promise.resolve(null);
    let p = hookCache.get(key);
    if (!p) {
        p = VencordNative.pluginHelpers.Sonata.getWebhookMessage(key)
            .then((r: any) => r?.ok && r.body ? { guildId: r.body.guild_id ?? null, channelId: r.body.channel_id ?? null, name: r.body.name ?? null, applicationId: r.body.application_id ?? null } : null)
            .catch(() => null);
        hookCache.set(key, p);
    }
    return p;
}

/** Look the webhook up again next time (after its name or picture changed). */
export const forgetHook = (url: string) => { hookCache.delete(url.trim().split("?")[0]); };

export function useHookInfo(url: string): HookInfo | null {
    const [info, setInfo] = useState<HookInfo | null>(null);
    useEffect(() => {
        let alive = true;
        const t = setTimeout(() => hookInfo(url).then(i => alive && setInfo(i)), 300);
        return () => { alive = false; clearTimeout(t); };
    }, [url]);
    return info;
}

/* ── Fill-ins ───────────────────────────────────────────────────────── */

export const FILL_INS: [string, string][] = [
    ["{date}", "Today's date"], ["{time}", "The time now"], ["{weekday}", "Day of the week"],
    ["{timestamp}", "A Discord timestamp everyone sees in their own time"], ["{relative}", "\"in 5 minutes\" style Discord timestamp"],
    ["{server}", "The server's name"], ["{channel}", "The channel, as a link"], ["{membercount}", "How many members the server has"],
    ["{me}", "Your name"], ["{mention}", "Mentions you"], ["{servericon}", "Link to the server icon (for image fields)"],
];

export type FillContext = Record<string, string>;

export function fillContext(info: HookInfo | null, now = new Date()): FillContext {
    const ch = info?.channelId ? ChannelStore.getChannel(info.channelId) : null;
    const guildId = info?.guildId ?? ch?.guild_id ?? (() => { const c = ChannelStore.getChannel(SelectedChannelStore.getChannelId()); return c?.guild_id ?? null; })();
    const guild: any = guildId ? GuildStore.getGuild(guildId) : null;
    const me: any = UserStore.getCurrentUser();
    const unix = Math.floor(now.getTime() / 1000);
    const count = guildId ? (GuildMemberCountStore.getMemberCount(guildId) ?? guild?.memberCount) : null;
    return {
        date: now.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
        time: now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
        weekday: now.toLocaleDateString(undefined, { weekday: "long" }),
        timestamp: `<t:${unix}:F>`,
        relative: `<t:${unix}:R>`,
        server: guild?.name ?? "{server}",
        channel: info?.channelId ? `<#${info.channelId}>` : ch ? `<#${ch.id}>` : "{channel}",
        membercount: count != null ? Number(count).toLocaleString() : "{membercount}",
        me: me?.globalName ?? me?.username ?? "",
        mention: me ? `<@${me.id}>` : "",
        servericon: guild?.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=512` : "",
    };
}

export const hasFillIns = (s: string) => /\{(date|time|weekday|timestamp|relative|server|channel|membercount|me|mention|servericon)\}/i.test(s);

export function fill(text: string, ctx: FillContext): string {
    return typeof text === "string" ? text.replace(/\{(\w+)\}/g, (all, k) => ctx[k.toLowerCase()] ?? all) : text;
}

/** Every text in a message, filled in. */
export function fillAll<T>(value: T, ctx: FillContext): T {
    if (typeof value === "string") return fill(value, ctx) as T;
    if (Array.isArray(value)) return value.map(v => fillAll(v, ctx)) as T;
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillAll(v, ctx)])) as T;
    return value;
}

export function FillInChips({ onInsert }: { onInsert(token: string): void; }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="vc-embedsender-fill">
            <button type="button" className="vc-tool-link" onClick={() => setOpen(o => !o)}>{open ? "Hide fill-ins" : "{ } Fill-ins"}</button>
            {open && (
                <div className="vc-tool-chips">
                    {FILL_INS.map(([t, d]) => <button key={t} type="button" className="vc-tool-chip" title={d} onClick={() => onInsert(t)}>{t}</button>)}
                    <span className="vc-tool-hint">They work anywhere — titles, fields, buttons — and are filled in when it sends.</span>
                </div>
            )}
        </div>
    );
}

/* ── Saved webhooks ─────────────────────────────────────────────────── */

export interface SavedHook { name: string; url: string; }
export function loadHooks(raw: string): SavedHook[] { try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v.filter(h => h?.url) : []; } catch { return []; } }

export function SavedWebhooks({ raw, write, current, onPick }: { raw: string; write(json: string): void; current: string; onPick(url: string, name: string): void; }) {
    const [list, setList] = useState(() => loadHooks(raw));
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState("");
    const info = useHookInfo(current);
    const store = (next: SavedHook[]) => { setList(next); write(JSON.stringify(next)); };
    const saved = list.some(h => h.url.trim() === current.trim());
    const suggestion = () => {
        const ch = info?.channelId ? ChannelStore.getChannel(info.channelId) : null;
        const g: any = info?.guildId ? GuildStore.getGuild(info.guildId) : null;
        return [info?.name, ch ? `#${ch.name}` : null, g?.name].filter(Boolean).join(" · ");
    };

    return (
        <div className="vc-embedsender-hooks">
            {list.map(h => (
                <span key={h.url} className={"vc-tool-chip vc-embedsender-hook" + (h.url.trim() === current.trim() ? " vc-tool-chip-on" : "")}>
                    <button type="button" onClick={() => onPick(h.url, h.name)} title={h.url.replace(/\/[\w-]+$/, "/…")}>🔗 {h.name}</button>
                    <button type="button" className="vc-embedsender-hook-x" title="Forget this webhook" onClick={() => store(list.filter(x => x !== h))}>✕</button>
                </span>
            ))}
            {current.trim() && !saved && !naming && <button type="button" className="vc-tool-link" onClick={() => { setNaming(true); setName(suggestion()); }}>★ Save this webhook</button>}
            {naming && (
                <span className="vc-embedsender-hook-name">
                    <input className="vc-tool-input" autoFocus placeholder="Name it, e.g. #announcements" value={name} onChange={e => setName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && name.trim()) { store([...list, { name: name.trim(), url: current.trim() }]); setNaming(false); } if (e.key === "Escape") setNaming(false); }} />
                    <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!name.trim()} onClick={() => { store([...list, { name: name.trim(), url: current.trim() }]); setNaming(false); }}>Save</button>
                </span>
            )}
        </div>
    );
}

/** Keeps a webhook chosen in the picker, under the name it has in Discord. */
export function rememberHook(raw: string, url: string, name: string): string {
    const list = loadHooks(raw);
    if (list.some(h => h.url.trim() === url.trim())) return raw;
    return JSON.stringify([...list, { name, url }]);
}

/* ── Colours from a picture ─────────────────────────────────────────── */

const paletteCache = new Map<string, Promise<string[]>>();

/** The main colours of a picture (most common first, dull greys left out). */
export function palette(url: string): Promise<string[]> {
    let p = paletteCache.get(url);
    if (p) return p;
    p = new Promise<string[]>(resolve => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            try {
                const c = document.createElement("canvas");
                c.width = c.height = 48;
                const g = c.getContext("2d", { willReadFrequently: true })!;
                g.drawImage(img, 0, 0, 48, 48);
                const px = g.getImageData(0, 0, 48, 48).data;
                const buckets = new Map<string, { n: number; r: number; g: number; b: number; }>();
                for (let i = 0; i < px.length; i += 4) {
                    if (px[i + 3] < 128) continue;
                    const r = px[i], gr = px[i + 1], b = px[i + 2];
                    const k = `${r >> 4},${gr >> 4},${b >> 4}`;
                    const e = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
                    e.n++; e.r += r; e.g += gr; e.b += b;
                    buckets.set(k, e);
                }
                const cols = [...buckets.values()].map(e => ({ n: e.n, r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }))
                    .map(c => { const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b); return { ...c, sat: max ? (max - min) / max : 0, light: (max + min) / 510 }; })
                    .sort((a, b) => b.n * (0.35 + b.sat) - a.n * (0.35 + a.sat));
                const out: { r: number; g: number; b: number; }[] = [];
                for (const c of cols) {
                    if (out.length >= 6) break;
                    if (c.light < 0.08 || c.light > 0.95) continue;
                    if (out.some(o => Math.abs(o.r - c.r) + Math.abs(o.g - c.g) + Math.abs(o.b - c.b) < 70)) continue;
                    out.push(c);
                }
                resolve(out.map(c => [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase()));
            } catch { resolve([]); }
        };
        img.onerror = () => resolve([]);
        img.src = url;
    });
    paletteCache.set(url, p);
    return p;
}

export function Palette({ sources, onPick }: { sources: { label: string; url: string; }[]; onPick(hex: string): void; }) {
    const [sets, setSets] = useState<{ label: string; colors: string[]; }[]>([]);
    const key = sources.map(s => s.url).join("|");
    useEffect(() => {
        let alive = true;
        Promise.all(sources.map(async s => ({ label: s.label, colors: await palette(s.url) })))
            .then(r => alive && setSets(r.filter(x => x.colors.length)));
        return () => { alive = false; };
    }, [key]);
    if (!sets.length) return null;
    return (
        <div className="vc-embedsender-palette">
            {sets.map(s => (
                <span key={s.label} className="vc-embedsender-palette-row">
                    <span className="vc-tool-hint">{s.label}</span>
                    {s.colors.map(c => <button key={c} type="button" className="vc-embedsender-swatch" style={{ background: `#${c}` }} title={`#${c}`} onClick={() => onPick(c)} />)}
                </span>
            ))}
        </div>
    );
}

/** Pictures worth taking colours from: the webhook's server, the server you're in, and the embed's own images. */
export function paletteSources(info: HookInfo | null, embed: { thumbnailUrl?: string; imageUrl?: string; authorIcon?: string; }): { label: string; url: string; }[] {
    const out: { label: string; url: string; }[] = [];
    const icon = (id: string | null | undefined) => { const g: any = id ? GuildStore.getGuild(id) : null; return g?.icon ? { name: g.name as string, url: `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` } : null; };
    const hook = icon(info?.guildId);
    if (hook) out.push({ label: hook.name, url: hook.url });
    const here = icon(ChannelStore.getChannel(SelectedChannelStore.getChannelId())?.guild_id);
    if (here && here.url !== hook?.url) out.push({ label: here.name, url: here.url });
    for (const [label, url] of [["Thumbnail", embed.thumbnailUrl], ["Image", embed.imageUrl], ["Author icon", embed.authorIcon]] as const)
        if (url && /^https?:\/\//.test(url)) out.push({ label, url });
    return out.slice(0, 4);
}

/* ── Sending later ──────────────────────────────────────────────────── */

export type Repeat = "once" | "daily" | "weekly";
export interface Scheduled {
    id: string;
    at: number;
    repeat: Repeat;
    webhookUrl: string;
    label: string;
    draft: { content: string; embeds: any[]; buttons: any[]; layout?: "container" | "classic"; username?: string; avatarUrl?: string; };
    lastError?: string;
}

export function loadScheduled(raw: string): Scheduled[] { try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } }

export function nextTime(s: Scheduled, after = Date.now()): number | null {
    if (s.repeat === "once") return null;
    const step = s.repeat === "daily" ? 86400_000 : 7 * 86400_000;
    let t = s.at;
    while (t <= after) t += step;
    return t;
}

const toLocalInput = (t: number) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

export function ScheduleBox({ raw, write, makeItem, onDone, toast, sendNow }: {
    raw: string; write(json: string): void; makeItem(): Omit<Scheduled, "id" | "at" | "repeat"> | null; onDone?(): void;
    toast(kind: "success" | "error", text: string): void; sendNow(s: Scheduled): Promise<boolean>;
}) {
    const [list, setList] = useState(() => loadScheduled(raw));
    const [when, setWhen] = useState(() => toLocalInput(Date.now() + 3600_000));
    const [repeat, setRepeat] = useState<Repeat>("once");
    // The list changes on its own as things send, so it's re-read now and then.
    useEffect(() => { const t = setInterval(() => setList(loadScheduled(raw)), 5000); return () => clearInterval(t); }, [raw]);
    const store = (next: Scheduled[]) => { setList(next); write(JSON.stringify(next)); };

    const add = () => {
        const item = makeItem();
        if (!item) return;
        const at = new Date(when).getTime();
        if (!Number.isFinite(at) || at < Date.now() - 60_000) { toast("error", "Pick a time in the future."); return; }
        store([...list, { ...item, id: Date.now().toString(36), at, repeat }].sort((a, b) => a.at - b.at));
        toast("success", `Scheduled for ${new Date(at).toLocaleString()}${repeat !== "once" ? `, then every ${repeat === "daily" ? "day" : "week"}` : ""}.`);
        onDone?.();
    };

    const quick: [string, () => number][] = [
        ["In 1 hour", () => Date.now() + 3600_000],
        ["Tonight 8 PM", () => { const d = new Date(); d.setHours(20, 0, 0, 0); if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1); return d.getTime(); }],
        ["Tomorrow 9 AM", () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); }],
        ["Monday 9 AM", () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); return d.getTime(); }],
    ];

    return (
        <div className="vc-embedsender-sched">
            <div className="vc-tool-chips">
                {quick.map(([l, f]) => <button key={l} type="button" className="vc-tool-chip" onClick={() => setWhen(toLocalInput(f()))}>{l}</button>)}
            </div>
            <div className="vc-embedsender-sched-row">
                <input className="vc-tool-input" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} style={{ colorScheme: "dark" }} />
                <div className="vc-tool-seg">
                    {(["once", "daily", "weekly"] as Repeat[]).map(r => <button key={r} type="button" className={"vc-tool-seg-btn" + (repeat === r ? " vc-tool-seg-on" : "")} onClick={() => setRepeat(r)}>{r === "once" ? "Once" : r === "daily" ? "Every day" : "Every week"}</button>)}
                </div>
                <button type="button" className="vc-tool-btn vc-tool-primary" onClick={add}>⏰ Schedule</button>
            </div>
            <span className="vc-tool-hint">Discord needs to be open at that time. If it was closed, it sends when you next open it (repeats skip ahead instead). Fill-ins are filled in when it sends. Files aren't included.</span>

            {list.length > 0 && (
                <div className="vc-tool-list">
                    {list.map(s => (
                        <div key={s.id} className="vc-tool-item">
                            <span className="vc-embedsender-sched-icon">{s.repeat === "once" ? "⏰" : "🔁"}</span>
                            <div className="vc-tool-item-main">
                                <span className="vc-tool-item-title">{s.label}</span>
                                <span className="vc-tool-item-sub">{new Date(s.at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{s.repeat !== "once" ? ` · every ${s.repeat === "daily" ? "day" : "week"}` : ""}{s.lastError ? ` · last try failed: ${s.lastError}` : ""}</span>
                            </div>
                            <button type="button" className="vc-tool-btn" onClick={async () => { const ok = await sendNow(s); if (ok) setList(loadScheduled(raw)); }}>Send now</button>
                            <button type="button" className="vc-tool-icon" title="Cancel" onClick={() => store(list.filter(x => x.id !== s.id))}>✕</button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export function summaryLabel(d: Scheduled["draft"]): string {
    const e = d.embeds?.find(x => x?.title || x?.description);
    return (e?.title || e?.description || d.content || "Embed").replace(/\s+/g, " ").slice(0, 60);
}
