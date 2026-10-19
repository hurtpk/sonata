/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Extra tools for the embed editor: a colour picked from a picture, a banner
// maker, dividers and spacers, a rules builder, and the history of what you've
// sent (to open, edit again or delete).

import { classes } from "@utils/misc";
import { ChannelStore, GuildChannelStore, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { callNative } from "../_shared/native";
import { fetchRef, findLinks, RbxGame } from "../robloxTools/data";

type Toast = (kind: "success" | "error", msg: string) => void;

/* ── Colour from a picture ── */

/** The most striking colour in a picture: common, but not grey, near-black or near-white. */
export async function dominantColor(bytes: Uint8Array): Promise<string | null> {
    try {
        const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
        const c = document.createElement("canvas");
        c.width = 64; c.height = 64;
        const x = c.getContext("2d", { willReadFrequently: true })!;
        x.drawImage(bmp, 0, 0, 64, 64);
        const d = x.getImageData(0, 0, 64, 64).data;
        const buckets = new Map<number, { n: number; r: number; g: number; b: number; score: number; }>();
        for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] < 128) continue;
            const r = d[i], g = d[i + 1], b = d[i + 2];
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            const sat = max ? (max - min) / max : 0, light = (max + min) / 510;
            const key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
            const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0, score: 0 };
            e.n++; e.r += r; e.g += g; e.b += b;
            // Colourful, mid-bright pixels count most.
            e.score += 0.25 + sat * 1.5 * (1 - Math.abs(light - 0.5) * 1.6);
            buckets.set(key, e);
        }
        const best = [...buckets.values()].sort((a, b) => b.score - a.score)[0];
        if (!best) return null;
        const hx = (v: number) => Math.round(v / best.n).toString(16).padStart(2, "0");
        return `${hx(best.r)}${hx(best.g)}${hx(best.b)}`.toUpperCase();
    } catch { return null; }
}

export async function colorFromUrl(url: string): Promise<string | null> {
    const bytes = await callNative<Uint8Array | null>("fetchImageBytes", url);
    return bytes instanceof Uint8Array ? dominantColor(bytes) : null;
}

export function ColorFromImage({ sources, onPick, toast }: { sources: { label: string; url?: string; bytes?: Uint8Array; }[]; onPick(hex: string): void; toast: Toast; }) {
    const [busy, setBusy] = useState(false);
    const usable = sources.filter(s => s.bytes || (s.url && /^https:\/\//.test(s.url)));
    if (!usable.length) return null;
    const pick = async (s: typeof usable[number]) => {
        setBusy(true);
        const hex = s.bytes ? await dominantColor(s.bytes) : await colorFromUrl(s.url!);
        setBusy(false);
        if (!hex) { toast("error", `Couldn't read the colours in “${s.label}”.`); return; }
        onPick(hex);
        toast("success", `Colour #${hex}, from ${s.label.toLowerCase()}.`);
    };
    return (
        <div className="vc-es-chips">
            <span className="vc-es-chips-label">🎨 From picture:</span>
            {usable.map(s => <button key={s.label} type="button" className="vc-es-chip" disabled={busy} onClick={() => pick(s)}>{s.label}</button>)}
        </div>
    );
}

/* ── Dividers and spacers ── */

const DIVIDERS: [string, string][] = [
    ["───────", "\n──────────────────\n"],
    ["━━━━━━━", "\n━━━━━━━━━━━━━━━━━━\n"],
    ["• • •", "\n• • • • • • • • •\n"],
    ["✦ ✦ ✦", "\n✦ ─────── ✦ ─────── ✦\n"],
    ["Header", "\n**━━━━ Section ━━━━**\n"],
    ["Blank line", "\n​\n"],
    ["Invisible space", "⠀"],
    ["Indent", " "],
];

/** On its own line, this becomes a real separator line in the Container layout. */
export const LINE_MARK = "---";

/** Chips that add a divider or spacer at the end of a text box. `line`: offer the real separator line (Container layout only). */
export function DividerChips({ onInsert, line }: { onInsert(text: string): void; line?: boolean; }) {
    return (
        <div className="vc-es-chips">
            <span className="vc-es-chips-label">➖ Dividers:</span>
            {line !== undefined && (
                <button type="button" className="vc-es-chip vc-es-chip-line" disabled={!line}
                    title={line ? "A real separator line, like Discord's own (shown as --- here)" : "Only in the Container layout — classic embeds can't show a real line"}
                    onClick={() => onInsert(`\n${LINE_MARK}\n`)}><i aria-hidden />Line</button>
            )}
            {DIVIDERS.map(([label, text]) => <button key={label} type="button" className="vc-es-chip" title={text.trim() || "(invisible)"} onClick={() => onInsert(text)}>{label}</button>)}
        </div>
    );
}

/* ── Banner maker ── */

export interface BannerOptions { title: string; subtitle: string; emoji: string; from: string; to: string; style: "gradient" | "glow" | "stripes"; size: "wide" | "tall"; }
const SIZES = { wide: [1200, 400], tall: [1200, 630] } as const;

function drawBanner(c: HTMLCanvasElement, o: BannerOptions) {
    const [w, h] = SIZES[o.size];
    c.width = w; c.height = h;
    const x = c.getContext("2d")!;
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, o.from); g.addColorStop(1, o.to);
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    if (o.style === "glow") {
        for (const [cx, cy, r, col] of [[w * 0.18, h * 0.25, h * 0.9, o.to], [w * 0.85, h * 0.8, h * 1.1, o.from], [w * 0.55, h * 0.1, h * 0.6, "#ffffff"]] as const) {
            const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r);
            rg.addColorStop(0, col + (col === "#ffffff" ? "33" : "aa")); rg.addColorStop(1, col + "00");
            x.fillStyle = rg; x.fillRect(0, 0, w, h);
        }
    } else if (o.style === "stripes") {
        x.save(); x.globalAlpha = 0.12; x.fillStyle = "#ffffff";
        for (let i = -h; i < w; i += 60) { x.beginPath(); x.moveTo(i, h); x.lineTo(i + h, 0); x.lineTo(i + h + 26, 0); x.lineTo(i + 26, h); x.fill(); }
        x.restore();
    }
    // A soft shade under the text, so it reads on any colours.
    const shade = x.createLinearGradient(0, h * 0.35, 0, h);
    shade.addColorStop(0, "rgba(0,0,0,0)"); shade.addColorStop(1, "rgba(0,0,0,0.35)");
    x.fillStyle = shade; x.fillRect(0, 0, w, h);
    x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = "#fff";
    x.shadowColor = "rgba(0,0,0,0.35)"; x.shadowBlur = 18; x.shadowOffsetY = 4;
    const font = (size: number, weight = 800) => `${weight} ${size}px "gg sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    const lines = [o.emoji && o.title ? `${o.emoji}  ${o.title}` : o.emoji || o.title].filter(Boolean) as string[];
    let size = Math.round(h * 0.26);
    x.font = font(size);
    while (size > 24 && lines[0] && x.measureText(lines[0]).width > w * 0.88) { size -= 4; x.font = font(size); }
    const sub = o.subtitle.trim();
    const titleY = sub ? h * 0.44 : h / 2;
    if (lines[0]) x.fillText(lines[0], w / 2, titleY);
    if (sub) {
        let s = Math.round(h * 0.1);
        x.font = font(s, 600);
        while (s > 14 && x.measureText(sub).width > w * 0.85) { s -= 2; x.font = font(s, 600); }
        x.globalAlpha = 0.92;
        x.fillText(sub, w / 2, titleY + size * 0.62 + s * 0.6);
        x.globalAlpha = 1;
    }
}

export function BannerMaker({ initial, onUse, onClose }: { initial: Partial<BannerOptions>; onUse(file: { name: string; contentType: string; dataBase64: string; size: number; }): void; onClose(): void; }) {
    const [o, setO] = useState<BannerOptions>({ title: "Announcement", subtitle: "", emoji: "📣", from: "#5865f2", to: "#eb459e", style: "glow", size: "wide", ...initial });
    const canvas = useRef<HTMLCanvasElement>(null);
    useEffect(() => { if (canvas.current) drawBanner(canvas.current, o); }, [o]);
    const set = <K extends keyof BannerOptions>(k: K) => (v: BannerOptions[K]) => setO(p => ({ ...p, [k]: v }));
    const use = () => {
        const url = canvas.current!.toDataURL("image/png");
        const dataBase64 = url.slice(url.indexOf(",") + 1);
        onUse({ name: `banner-${Date.now().toString(36)}.png`, contentType: "image/png", dataBase64, size: Math.round(dataBase64.length * 0.75) });
    };
    return (
        <div className="vc-es-builder">
            <div className="vc-es-builder-head"><b>🖼️ Banner maker</b><span className="vc-tool-spacer" /><button type="button" className="vc-tool-icon" onClick={onClose}>✕</button></div>
            <canvas ref={canvas} className="vc-es-banner-canvas" />
            <div className="vc-es-builder-grid">
                <input className="vc-tool-input" placeholder="Title" value={o.title} maxLength={60} onChange={e => set("title")(e.currentTarget.value)} />
                <input className="vc-tool-input" placeholder="Emoji (optional)" value={o.emoji} maxLength={8} onChange={e => set("emoji")(e.currentTarget.value)} />
                <input className="vc-tool-input" style={{ gridColumn: "1 / -1" }} placeholder="Smaller line under it (optional)" value={o.subtitle} maxLength={100} onChange={e => set("subtitle")(e.currentTarget.value)} />
                <label className="vc-es-color">From <input type="color" value={o.from} onChange={e => set("from")(e.currentTarget.value)} /></label>
                <label className="vc-es-color">To <input type="color" value={o.to} onChange={e => set("to")(e.currentTarget.value)} /></label>
                <div className="vc-tool-seg">
                    {(["glow", "gradient", "stripes"] as const).map(s => <button key={s} type="button" className={classes("vc-tool-seg-btn", o.style === s && "vc-tool-seg-on")} onClick={() => set("style")(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}
                </div>
                <div className="vc-tool-seg">
                    {([["wide", "Wide 3:1"], ["tall", "Card 1.9:1"]] as const).map(([s, l]) => <button key={s} type="button" className={classes("vc-tool-seg-btn", o.size === s && "vc-tool-seg-on")} onClick={() => set("size")(s)}>{l}</button>)}
                </div>
            </div>
            <div className="vc-es-builder-foot">
                <span className="vc-tool-hint">It's attached to the message and shown as the embed's main picture.</span>
                <span className="vc-tool-spacer" />
                <button type="button" className="vc-tool-btn vc-tool-primary" onClick={use}>Use this banner</button>
            </div>
        </div>
    );
}

/* ── Rules builder ── */

export interface RulesResult { title: string; description: string; color: string; footer: string; button?: { label: string; url: string; }; }

const NUMBERS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

export function RulesBuilder({ onUse, onClose }: { onUse(r: RulesResult): void; onClose(): void; }) {
    const [title, setTitle] = useState("📜 Server Rules");
    const [intro, setIntro] = useState("Welcome! Please read these before you start chatting.");
    const [text, setText] = useState("Be kind and respectful to everyone\nNo spam, self-promo or advertising without permission\nKeep it safe for work\nNo harassment, hate speech or doxxing\nFollow Discord's Terms of Service\nListen to the staff");
    const [style, setStyle] = useState<"numbers" | "emoji" | "bold">("emoji");
    const [footer, setFooter] = useState("Breaking the rules can get you muted, kicked or banned.");
    const [agree, setAgree] = useState("✅ I agree");
    const [agreeUrl, setAgreeUrl] = useState("");
    const rules = text.split("\n").map(l => l.trim()).filter(Boolean);
    const body = useMemo(() => {
        const lines = rules.map((r, i) => {
            // "Title - more detail" becomes a bold title and the detail under it.
            const [head, ...rest] = r.split(/\s+[-–—:]\s+/);
            const detail = rest.join(" — ");
            const mark = style === "emoji" ? (NUMBERS[i] ?? `**${i + 1}.**`) : style === "bold" ? `**${i + 1}.**` : `${i + 1}.`;
            return detail ? `${mark} **${head}**\n${" "}${detail}` : `${mark} ${style === "numbers" ? head : `**${head}**`}`;
        });
        return [intro.trim(), intro.trim() ? "" : null, ...lines].filter(l => l !== null).join("\n");
    }, [text, style, intro]);
    const okUrl = !agreeUrl.trim() || /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/|^https?:\/\//.test(agreeUrl.trim());
    return (
        <div className="vc-es-builder">
            <div className="vc-es-builder-head"><b>📜 Rules builder</b><span className="vc-tool-spacer" /><button type="button" className="vc-tool-icon" onClick={onClose}>✕</button></div>
            <input className="vc-tool-input" value={title} onChange={e => setTitle(e.currentTarget.value)} placeholder="Title" />
            <input className="vc-tool-input" value={intro} onChange={e => setIntro(e.currentTarget.value)} placeholder="A line before the rules (optional)" />
            <textarea className="vc-tool-input" style={{ minHeight: 120 }} value={text} onChange={e => setText(e.currentTarget.value)} placeholder="One rule per line. Add “ - more detail” after a rule to explain it." />
            <div className="vc-tool-seg">
                {([["emoji", "1️⃣ Emoji numbers"], ["bold", "**1.** Bold numbers"], ["numbers", "1. Plain"]] as const).map(([s, l]) => <button key={s} type="button" className={classes("vc-tool-seg-btn", style === s && "vc-tool-seg-on")} onClick={() => setStyle(s)}>{l}</button>)}
            </div>
            <input className="vc-tool-input" value={footer} onChange={e => setFooter(e.currentTarget.value)} placeholder="Footer (optional)" />
            <div style={{ display: "flex", gap: 8 }}>
                <input className="vc-tool-input" style={{ flex: 1 }} value={agree} onChange={e => setAgree(e.currentTarget.value)} placeholder="Button text" maxLength={80} />
                <input className="vc-tool-input" style={{ flex: 2 }} value={agreeUrl} onChange={e => setAgreeUrl(e.currentTarget.value)} placeholder="Where it goes — e.g. your #verify channel's link (right-click it → Copy Link)" />
            </div>
            {!okUrl && <span className="vc-tool-error">That link doesn't look right — copy a channel's link from Discord.</span>}
            <pre className="vc-es-rules-preview">{body}</pre>
            <div className="vc-es-builder-foot">
                <span className="vc-tool-hint">{rules.length} rule{rules.length === 1 ? "" : "s"}. This replaces the first embed{agreeUrl.trim() ? " and adds the button" : ""}.</span>
                <span className="vc-tool-spacer" />
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!rules.length || !okUrl}
                    onClick={() => onUse({ title, description: body, color: "5865F2", footer, button: agreeUrl.trim() && agree.trim() ? { label: agree.trim(), url: agreeUrl.trim() } : undefined })}>Use these rules</button>
            </div>
        </div>
    );
}

/* ── Sent history ── */

export interface SentItem { id: string; webhookUrl: string; channelId?: string; guildId?: string; label: string; at: number; }
const MAX_HISTORY = 100;

export const loadHistory = (raw: string): SentItem[] => { try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
export function addToHistory(raw: string, item: SentItem): string {
    const list = loadHistory(raw).filter(x => x.id !== item.id);
    return JSON.stringify([item, ...list].slice(0, MAX_HISTORY));
}

const when = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function SentHistory({ raw, write, onEdit, toast }: { raw: string; write(json: string): void; onEdit(item: SentItem): void; toast: Toast; }) {
    const list = loadHistory(raw);
    const [q, setQ] = useState("");
    const [confirm, setConfirm] = useState<string | null>(null);
    if (!list.length) return <div className="vc-tool-hint">Nothing sent yet — everything you send from here shows up in this list, to open, edit again or delete.</div>;
    const t = q.trim().toLowerCase();
    const shown = list.filter(i => !t || i.label.toLowerCase().includes(t));
    const remove = async (item: SentItem) => {
        const r: any = await callNative("deleteWebhookMessage", `${item.webhookUrl.replace(/\/+$/, "").replace(/\?.*$/, "")}/messages/${item.id}`);
        if (r?.ok || r?.status === 404) {
            write(JSON.stringify(list.filter(x => x.id !== item.id)));
            toast("success", r?.status === 404 ? "It was already gone — removed from the list." : "Deleted from the channel.");
        } else toast("error", `Couldn't delete it: ${r?.body?.message ?? `error ${r?.status ?? "?"}`}`);
        setConfirm(null);
    };
    return (
        <div className="vc-es-history">
            {list.length > 6 && <input className="vc-tool-input" placeholder="Find a message…" value={q} onChange={e => setQ(e.currentTarget.value)} />}
            {shown.slice(0, 40).map(item => {
                const link = item.channelId ? `https://discord.com/channels/${item.guildId ?? "@me"}/${item.channelId}/${item.id}` : null;
                return (
                    <div key={item.id} className="vc-es-history-row">
                        <div className="vc-es-history-main">
                            <b>{item.label || "Message"}</b>
                            <span>{when(item.at)}</span>
                        </div>
                        {link && <a className="vc-tool-btn" href={link} target="_blank" rel="noreferrer" title="Jump to it in Discord">Open</a>}
                        <button type="button" className="vc-tool-btn" onClick={() => onEdit(item)} title="Load it back into the editor to change it">Edit again</button>
                        {confirm === item.id
                            ? <button type="button" className="vc-tool-btn vc-tool-danger" onClick={() => remove(item)}>Really delete?</button>
                            : <button type="button" className="vc-tool-btn" onClick={() => setConfirm(item.id)} title="Delete it from the channel">Delete</button>}
                    </div>
                );
            })}
            <div className="vc-tool-hint">The last {MAX_HISTORY} messages you sent from here. Deleting removes it from the channel for everyone.</div>
        </div>
    );
}

/* ── Navigation hub: a "start here" post that links everywhere ── */

export interface HubRow { emoji: string; label: string; /** A channel ID, a Discord page (<id:…>), or a link. */ target: string; note: string; }
export interface HubResult { title: string; description: string; color: string; buttons: { label: string; url: string; emoji?: string; }[]; }

const HUB_STARTERS: HubRow[] = [
    { emoji: "📜", label: "Rules", target: "", note: "Read these first" },
    { emoji: "🎭", label: "Get roles", target: "<id:customize>", note: "Pick your colours and pings" },
    { emoji: "📣", label: "Announcements", target: "", note: "News and updates" },
    { emoji: "💬", label: "General chat", target: "", note: "Say hi!" },
];

const isChannelId = (t: string) => /^\d{15,22}$/.test(t);

export function NavHubBuilder({ guildId, onUse, onClose }: { guildId: string | null; onUse(r: HubResult): void; onClose(): void; }) {
    const [title, setTitle] = useState("📍 Start here");
    const [intro, setIntro] = useState("Welcome! Here's where everything is:");
    const [rows, setRows] = useState<HubRow[]>(HUB_STARTERS);
    const [asButtons, setAsButtons] = useState(true);
    const channels = useMemo(() => {
        if (!guildId) return [];
        try {
            const all: any = GuildChannelStore.getChannels(guildId);
            return [...(all?.SELECTABLE ?? []), ...(all?.VOCAL ?? [])].map((x: any) => x.channel).filter(Boolean)
                .map((c: any) => ({ id: c.id as string, name: c.name as string, cat: c.parent_id ? ChannelStore.getChannel(c.parent_id)?.name ?? "" : "" }));
        } catch { return []; }
    }, [guildId]);
    const set = (i: number, patch: Partial<HubRow>) => setRows(r => r.map((x, j) => j === i ? { ...x, ...patch } : x));
    /** One of the server's channels (by its ID). */
    const isChannel = (t: string) => isChannelId(t) || channels.some(c => c.id === t);
    const used = rows.filter(r => r.label.trim() && r.target.trim() && r.target.trim() !== "https://");
    const description = [
        intro.trim(),
        intro.trim() ? "" : null,
        ...used.map(r => {
            const t = r.target.trim();
            const where = isChannel(t) ? `<#${t}>` : t.startsWith("<id:") ? t : `[${r.label.trim()}](${t})`;
            const head = `${r.emoji ? r.emoji + " " : ""}**${r.label.trim()}** — ${where}`;
            return r.note.trim() ? `${head}\n-# ${r.note.trim()}` : head;
        }),
    ].filter(l => l !== null).join("\n");
    // Buttons can only open web links, so Discord pages (<id:…>) stay in the text.
    const buttons = asButtons ? used.filter(r => !r.target.startsWith("<id:")).slice(0, 5).map(r => ({ label: r.label.trim().slice(0, 80), url: isChannel(r.target.trim()) && guildId ? `https://discord.com/channels/${guildId}/${r.target.trim()}` : r.target.trim(), emoji: r.emoji || undefined })) : [];
    const selectValue = (t: string) => !t || t.startsWith("<id:") || channels.some(c => c.id === t) ? t : "link";
    return (
        <div className="vc-es-builder">
            <div className="vc-es-builder-head"><b>🧭 Navigation hub</b><span className="vc-tool-spacer" /><button type="button" className="vc-tool-icon" onClick={onClose}>✕</button></div>
            <input className="vc-tool-input" value={title} onChange={e => setTitle(e.currentTarget.value)} placeholder="Title" />
            <input className="vc-tool-input" value={intro} onChange={e => setIntro(e.currentTarget.value)} placeholder="A line before the list (optional)" />
            {rows.map((r, i) => (
                <div key={i} className="vc-es-hub-row">
                    <input className="vc-tool-input vc-es-hub-emoji" value={r.emoji} maxLength={8} onChange={e => set(i, { emoji: e.currentTarget.value })} placeholder="🙂" />
                    <input className="vc-tool-input" value={r.label} maxLength={80} onChange={e => set(i, { label: e.currentTarget.value })} placeholder="Name" />
                    <select className="vc-tool-input" value={selectValue(r.target)} onChange={e => set(i, { target: e.currentTarget.value === "link" ? "https://" : e.currentTarget.value })}>
                        <option value="">Pick where it goes…</option>
                        <optgroup label="Discord pages">
                            <option value="<id:customize>">Channels &amp; Roles</option>
                            <option value="<id:browse>">Browse Channels</option>
                            <option value="<id:guide>">Server Guide</option>
                        </optgroup>
                        {channels.length > 0 && <optgroup label="Channels">{channels.map(c => <option key={c.id} value={c.id}>#{c.name}{c.cat ? ` · ${c.cat}` : ""}</option>)}</optgroup>}
                        <option value="link">A link (message or website)…</option>
                    </select>
                    <button type="button" className="vc-tool-icon" title="Remove" onClick={() => setRows(x => x.filter((_, j) => j !== i))}>✕</button>
                    {selectValue(r.target) === "link" && (
                        <input className="vc-tool-input vc-es-hub-link" value={r.target} onChange={e => set(i, { target: e.currentTarget.value })} placeholder="Paste a message link or a website" />
                    )}
                    <input className="vc-tool-input vc-es-hub-note" value={r.note} onChange={e => set(i, { note: e.currentTarget.value })} placeholder="A short note under it (optional)" />
                </div>
            ))}
            {rows.length < 12 && <button type="button" className="vc-tool-btn" onClick={() => setRows(r => [...r, { emoji: "", label: "", target: "", note: "" }])}>＋ Add a place</button>}
            {!guildId && <span className="vc-tool-hint">Add the webhook (or open the server) to pick its channels from a list.</span>}
            <label className="vc-tool-check"><input type="checkbox" checked={asButtons} onChange={e => setAsButtons(e.currentTarget.checked)} /> Also add the first five as buttons</label>
            <pre className="vc-es-rules-preview">{`${title}\n\n${description}`}</pre>
            <div className="vc-es-builder-foot">
                <span className="vc-tool-hint">{used.length} place{used.length === 1 ? "" : "s"}. This replaces the first embed{buttons.length ? ` and the buttons (${buttons.length})` : ""}.</span>
                <span className="vc-tool-spacer" />
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!used.length} onClick={() => onUse({ title, description, color: "5865F2", buttons })}>Use this hub</button>
            </div>
        </div>
    );
}

/* ── A Roblox game, as an embed ── */

export interface GameResult {
    title: string; url: string; description: string; color: string; imageUrl: string; thumbnailUrl: string; footerText: string;
    fields: { name: string; value: string; inline: boolean; }[];
    button?: { label: string; url: string; };
}

const big = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K` : String(n);

export function RobloxGameBuilder({ onUse, onClose }: { onUse(r: GameResult): void; onClose(): void; }) {
    const [link, setLink] = useState("");
    const [state, setState] = useState<{ loading?: boolean; game?: RbxGame; error?: string; }>({});
    const [stats, setStats] = useState(true);
    const [about, setAbout] = useState(true);
    const [picture, setPicture] = useState<"big" | "small">("big");
    const [play, setPlay] = useState(true);
    const [color, setColor] = useState("00A2FF");

    useEffect(() => {
        const t = link.trim();
        if (!t) { setState({}); return; }
        const ref = findLinks(t.startsWith("http") ? t : `https://www.roblox.com/${t.replace(/^\/+/, "")}`)[0] ?? (/^\d{3,19}$/.test(t) ? { kind: "game" as const, id: t } : null);
        if (!ref || ref.kind !== "game") { setState({ error: "Paste a Roblox game link (roblox.com/games/…)" }); return; }
        let alive = true;
        setState({ loading: true });
        const timer = setTimeout(() => void fetchRef(ref).then((r: any) => {
            if (!alive) return;
            setState(r?.ok && r.info?.kind === "game" ? { game: r.info } : { error: r?.error ?? "Couldn't find that game" });
        }), 350);
        return () => { alive = false; clearTimeout(timer); };
    }, [link]);

    const g = state.game;
    const result: GameResult | null = g ? (() => {
        const url = `https://www.roblox.com/games/${g.placeId}`;
        const likes = g.up + g.down > 0 ? `${Math.round(g.up / (g.up + g.down) * 100)}% 👍` : "–";
        const desc = g.description.replace(/\r/g, "").trim();
        return {
            title: g.name, url,
            description: about && desc ? (desc.length > 350 ? desc.slice(0, 347).trimEnd() + "…" : desc) : "",
            color,
            imageUrl: picture === "big" ? g.thumb || g.icon : "",
            thumbnailUrl: picture === "small" ? g.icon || g.thumb : g.icon,
            footerText: `By ${g.creator}${g.genre && g.genre !== "All" ? ` · ${g.genre}` : ""}`,
            fields: stats ? [
                { name: "🟢 Playing", value: g.playing.toLocaleString(), inline: true },
                { name: "👁️ Visits", value: big(g.visits), inline: true },
                { name: "👍 Likes", value: likes, inline: true },
                { name: "⭐ Favourites", value: big(g.favorites), inline: true },
                { name: "👥 Server size", value: String(g.maxPlayers || "–"), inline: true },
                { name: "🔄 Updated", value: g.updated ? `<t:${Math.floor(new Date(g.updated).getTime() / 1000)}:R>` : "–", inline: true },
            ] : [],
            button: play ? { label: "▶ Play", url } : undefined,
        };
    })() : null;

    return (
        <div className="vc-es-builder">
            <div className="vc-es-builder-head"><b>🎮 Roblox game</b><span className="vc-tool-spacer" /><button type="button" className="vc-tool-icon" onClick={onClose}>✕</button></div>
            <input className="vc-tool-input" autoFocus value={link} onChange={e => setLink(e.currentTarget.value)} placeholder="Paste a Roblox game link — roblox.com/games/…" />
            {state.loading && <span className="vc-tool-hint">Looking up the game…</span>}
            {state.error && <span className="vc-tool-hint" style={{ color: "#f23f43" }}>{state.error}</span>}
            {g && (
                <>
                    <div className="vc-es-game">
                        {g.icon && <img src={g.icon} alt="" />}
                        <div><b>{g.name}</b><span>{g.playing.toLocaleString()} playing · {big(g.visits)} visits · by {g.creator}</span></div>
                    </div>
                    <div className="vc-es-builder-grid">
                        <label className="vc-tool-check"><input type="checkbox" checked={stats} onChange={e => setStats(e.currentTarget.checked)} /> Players, visits, likes…</label>
                        <label className="vc-tool-check"><input type="checkbox" checked={about} onChange={e => setAbout(e.currentTarget.checked)} /> Its description</label>
                        <label className="vc-tool-check"><input type="checkbox" checked={play} onChange={e => setPlay(e.currentTarget.checked)} /> A ▶ Play button</label>
                        <span className="vc-tool-chips">
                            <button type="button" className={classes("vc-tool-chip", picture === "big" && "vc-tool-chip-on")} onClick={() => setPicture("big")}>Big picture</button>
                            <button type="button" className={classes("vc-tool-chip", picture === "small" && "vc-tool-chip-on")} onClick={() => setPicture("small")}>Small icon</button>
                        </span>
                        <label className="vc-tool-check">Colour <input type="color" value={`#${color}`} onChange={e => setColor(e.currentTarget.value.slice(1).toUpperCase())} /></label>
                    </div>
                    <span className="vc-tool-hint">The numbers are from right now — they won't update after it's sent.</span>
                </>
            )}
            <div className="vc-es-builder-foot">
                <span className="vc-tool-hint">This replaces the first embed{play ? " and adds a Play button" : ""}.</span>
                <span className="vc-tool-spacer" />
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!result} onClick={() => result && onUse(result)}>Use this game</button>
            </div>
        </div>
    );
}
