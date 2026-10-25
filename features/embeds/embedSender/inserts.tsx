/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A text box with everything for writing in it: a formatting bar (bold,
// headings, lists, spoilers…), and pickers that drop things in where your
// cursor is — fill-ins, the server's roles, channels and people, Discord
// timestamps, and custom emoji. Everything comes from what Discord already
// has loaded; nothing is fetched, and the member list is never scanned.

import { ChannelStore, EmojiStore, GuildChannelStore, GuildMemberStore, GuildRoleStore, GuildStore, React, useMemo, useRef, UserStore,useState } from "@webpack/common";

import { recent as recentChars, remember as rememberChar } from "../../textStyles/charactersPicker";
import { ALL_CHARS, CATEGORIES } from "../../textStyles/charactersPicker/chars";
import { openColoredText } from "../../textStyles/coloredText/Panel";
import { DividerChips } from "./builders";
import { FILL_INS } from "./extras";

type Panel = "fill" | "roles" | "channels" | "people" | "time" | "emoji" | "chars" | null;

/** Bullet styles for lists. A function gets the line's number (from 0). */
const NUMBER_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
const BULLETS: [string, string | ((i: number) => string)][] = [
    ["✅", "✅"], ["➤", "➤"], ["🔹", "🔹"], ["🔸", "🔸"], ["⭐", "⭐"], ["▸", "▸"], ["→", "→"], ["◆", "◆"], ["•", "•"], ["❌", "❌"],
    ["1️⃣ 2️⃣ 3️⃣", i => NUMBER_EMOJI[i] ?? `${i + 1}.`], ["1) 2) 3)", i => `${i + 1})`], ["A. B. C.", i => `${String.fromCharCode(65 + (i % 26))}.`],
];
/** Any bullet already at the start of a line (so a new style replaces it). */
const ANY_BULLET = /^(?:[-•✅➤🔹🔸⭐▸→◆❌]|\d+[.)]|[A-Z]\.|(?:\d\uFE0F?\u20E3)|🔟)\s+/u;

/* ── The text box ── */

export function RichText({ value, onChange, maxLength, minRows = 3, placeholder, guildId, line }: {
    value: string; onChange(v: string): void; maxLength?: number; minRows?: number; placeholder?: string;
    /** The server the message goes to — for roles, channels, people and emoji. */
    guildId: string | null;
    /** Offer the real separator line (Container layout only). */
    line: boolean;
}) {
    const ref = useRef<HTMLTextAreaElement>(null);
    const touched = useRef(false);
    const [panel, setPanel] = useState<Panel>(null);
    const [bulletsOpen, setBulletsOpen] = useState(false);

    React.useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight + 2, 560)}px`;
    }, [value]);

    /** Where the cursor is (the end, if the box hasn't been clicked yet). */
    const range = () => {
        const el = ref.current;
        if (!el) return [value.length, value.length];
        // A box nobody has clicked into yet reports its cursor at the very start; add to the end instead.
        const pristine = !touched.current && el.selectionStart === 0 && el.selectionEnd === 0;
        return pristine ? [value.length, value.length] : [el.selectionStart, el.selectionEnd];
    };
    /** Puts text at the cursor (replacing what's selected), then selects `inner` of it. */
    const put = (from: number, to: number, text: string, inner?: [number, number]) => {
        const next = value.slice(0, from) + text + value.slice(to);
        if (maxLength && next.length > maxLength) return;
        onChange(next);
        const el = ref.current;
        setTimeout(() => {
            if (!el) return;
            el.focus();
            touched.current = true;
            el.setSelectionRange(from + (inner?.[0] ?? text.length), from + (inner?.[1] ?? text.length));
        });
    };
    const insert = (text: string) => { const [s, e] = range(); put(s, e, text); };

    /** **bold** and friends: wraps the selection — or unwraps it if it's already wrapped. */
    const wrap = (before: string, after = before, sample = "text") => {
        const [s, e] = range();
        if (value.slice(s - before.length, s) === before && value.slice(e, e + after.length) === after) {
            const inside = value.slice(s, e);
            return put(s - before.length, e + after.length, inside, [0, inside.length]);
        }
        const inside = value.slice(s, e) || sample;
        put(s, e, before + inside + after, [before.length, before.length + inside.length]);
    };

    /** # heading, > quote, - list…: added to (or taken off) every selected line. */
    const prefix = (mark: string | ((i: number) => string), family: RegExp) => {
        let [s, e] = range();
        s = value.lastIndexOf("\n", s - 1) + 1;
        const end = value.indexOf("\n", e);
        e = end < 0 ? value.length : end;
        const lines = value.slice(s, e).split("\n");
        const markOf = (i: number) => typeof mark === "string" ? mark : mark(i);
        const all = lines.every((l, i) => l.startsWith(markOf(i)));
        const out = lines.map((l, i) => all ? l.slice(markOf(i).length) : markOf(i) + l.replace(family, "")).join("\n");
        put(s, e, out, [0, out.length]);
    };

    const link = () => {
        const [s, e] = range();
        const label = value.slice(s, e) || "link text";
        const text = `[${label}](https://)`;
        put(s, e, text, [label.length + 3, text.length - 1]);
    };

    /** Colored Text on the selection (or a coloured block already there); the result goes back in its place. */
    const colored = () => {
        let [s, e] = range();
        // Inside a coloured block: edit the whole block.
        const before = value.lastIndexOf("```ansi", s), close = before >= 0 ? value.indexOf("```", before + 7) : -1;
        if (before >= 0 && close >= s - 3 && close >= 0) [s, e] = [before, Math.max(e, close + 3)];
        const left = (maxLength ?? 4096) - (value.length - (e - s));
        openColoredText(value.slice(s, e), { name: "Embed Sender", limit: left, put: text => put(s, e, text) });
    };

    const HEADINGS = /^(#{1,3}|-#) /;
    const tools: [string, string, () => void, string?][] = [
        ["B", "Bold (Ctrl+B)", () => wrap("**"), "vc-es2-fmt-b"],
        ["I", "Italic (Ctrl+I)", () => wrap("*"), "vc-es2-fmt-i"],
        ["U", "Underline (Ctrl+U)", () => wrap("__"), "vc-es2-fmt-u"],
        ["S", "Strikethrough", () => wrap("~~"), "vc-es2-fmt-s"],
        ["▮▮", "Spoiler — hidden until clicked", () => wrap("||")],
        ["</>", "Code", () => wrap("`", "`", "code")],
        ["{ }", "Code block", () => wrap("```\n", "\n```", "code")],
        ["🔗", "Link with your own text", link],
        ["|", "", () => { }],
        ["H1", "Big heading", () => prefix("# ", HEADINGS)],
        ["H2", "Heading", () => prefix("## ", HEADINGS)],
        ["H3", "Small heading", () => prefix("### ", HEADINGS)],
        ["-#", "Small grey text", () => prefix("-# ", HEADINGS)],
        ["❝", "Quote", () => prefix("> ", /^> /)],
        ["•", "List", () => prefix("- ", /^(- |\d+\. )/)],
        ["1.", "Numbered list", () => prefix(i => `${i + 1}. `, /^(- |\d+\. )/)],
        ["✦", "Bullet styles — ✅ ➤ 🔹 1️⃣ …", () => setBulletsOpen(o => !o), bulletsOpen ? "vc-es2-fmt-on" : undefined],
        ["|", "", () => { }],
        ["A", "Coloured text — colours, backgrounds, rainbows (shows on desktop)", colored, "vc-es2-fmt-ansi"],
    ];

    const toggle = (p: Panel) => setPanel(cur => cur === p ? null : p);
    const tabs: [Panel, string][] = [["fill", "{ } Fill-ins"], ["roles", "@ Roles"], ["channels", "# Channels"], ["people", "@ People"], ["time", "🕒 Time"], ["emoji", "😀 Emoji"], ["chars", "✩ Characters"]];

    return (
        <div className="vc-es2-rich">
            <div className="vc-es2-fmt" role="toolbar" aria-label="Formatting">
                {tools.map(([label, title, run, cls], i) => label === "|"
                    ? <span key={i} className="vc-es2-fmt-gap" />
                    : <button key={i} type="button" className={"vc-es2-fmt-btn " + (cls ?? "")} title={title} onMouseDown={e => e.preventDefault()} onClick={run}>{label}</button>)}
            </div>
            {bulletsOpen && (
                <div className="vc-es2-bullets" role="toolbar" aria-label="Bullet styles">
                    <span className="vc-tool-hint">Pick lines, then a style:</span>
                    {BULLETS.map(([label, mark]) => (
                        <button key={label} type="button" className="vc-es2-bullet" onMouseDown={e => e.preventDefault()}
                            onClick={() => prefix(typeof mark === "string" ? `${mark} ` : i => `${mark(i)} `, ANY_BULLET)}>{label}</button>
                    ))}
                </div>
            )}
            <textarea ref={ref} className="vc-tool-input vc-es2-text vc-es2-rich-text" rows={minRows} maxLength={maxLength} placeholder={placeholder}
                value={value} onChange={e => onChange(e.target.value)} onFocus={() => { touched.current = true; }} onSelect={() => { touched.current = true; }} onMouseUp={() => { touched.current = true; }}
                onKeyDown={e => {
                    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
                    const k = e.key.toLowerCase();
                    if (k === "b" || k === "i" || k === "u") { e.preventDefault(); wrap(k === "b" ? "**" : k === "i" ? "*" : "__"); }
                }} />
            <div className="vc-es2-insert-tabs">
                {tabs.map(([p, label]) => (
                    <button key={p} type="button" className={"vc-es2-insert-tab" + (panel === p ? " vc-es2-insert-tab-on" : "")} onClick={() => toggle(p)} aria-expanded={panel === p}>{label}</button>
                ))}
            </div>
            {panel && (
                <div className="vc-es2-insert-panel">
                    {panel === "fill" && <FillPanel onPick={insert} />}
                    {panel === "roles" && <RolePanel guildId={guildId} onPick={insert} />}
                    {panel === "channels" && <ChannelPanel guildId={guildId} onPick={insert} />}
                    {panel === "people" && <PeoplePanel guildId={guildId} onPick={insert} />}
                    {panel === "time" && <TimePanel onPick={insert} />}
                    {panel === "emoji" && <EmojiPanel guildId={guildId} onPick={insert} />}
                    {panel === "chars" && <CharsPanel onPick={insert} />}
                </div>
            )}
            <DividerChips line={line} onInsert={insert} />
        </div>
    );
}

/* ── Pickers ── */

const NoServer = () => <div className="vc-tool-hint">Add the webhook first (or open the server), so Sonata knows which server's list to show.</div>;

function Search({ value, onChange, placeholder }: { value: string; onChange(v: string): void; placeholder: string; }) {
    return <input className="vc-tool-input vc-es2-insert-search" autoFocus placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />;
}

function FillPanel({ onPick }: { onPick(t: string): void; }) {
    return (
        <>
            <div className="vc-es2-insert-list vc-es2-insert-chips">
                {FILL_INS.map(([t, d]) => <button key={t} type="button" className="vc-tool-chip" title={d} onClick={() => onPick(t)}>{t}</button>)}
            </div>
            <span className="vc-tool-hint">Filled in when it sends — they work in titles, fields and buttons too.</span>
        </>
    );
}

const colourOf = (c: number | undefined) => c ? `#${c.toString(16).padStart(6, "0")}` : "#99aab5";

function RolePanel({ guildId, onPick }: { guildId: string | null; onPick(t: string): void; }) {
    const [q, setQ] = useState("");
    const roles = useMemo(() => {
        if (!guildId) return [];
        try { return [...GuildRoleStore.getSortedRoles(guildId)].sort((a: any, b: any) => b.position - a.position); } catch { return []; }
    }, [guildId]);
    if (!guildId) return <NoServer />;
    const shown = roles.filter((r: any) => r.id !== guildId && r.name.toLowerCase().includes(q.trim().toLowerCase()));
    return (
        <>
            <Search value={q} onChange={setQ} placeholder={`Search ${roles.length - 1} roles…`} />
            <div className="vc-es2-insert-list vc-es2-insert-chips">
                {!q && <button type="button" className="vc-es2-role" onClick={() => onPick("@everyone")}><i style={{ background: "#99aab5" }} />@everyone</button>}
                {!q && <button type="button" className="vc-es2-role" onClick={() => onPick("@here")}><i style={{ background: "#99aab5" }} />@here</button>}
                {shown.map((r: any) => (
                    <button key={r.id} type="button" className="vc-es2-role" style={{ "--es2-role": colourOf(r.color) } as React.CSSProperties} onClick={() => onPick(`<@&${r.id}>`)} title={r.managed ? "A bot's own role" : undefined}>
                        <i />@{r.name}
                    </button>
                ))}
                {!shown.length && q && <span className="vc-tool-hint">No role called that.</span>}
            </div>
            <span className="vc-tool-hint">In the message text, a role mention pings everyone in that role (classic embeds never ping).</span>
        </>
    );
}

function ChannelPanel({ guildId, onPick }: { guildId: string | null; onPick(t: string): void; }) {
    const [q, setQ] = useState("");
    const groups = useMemo(() => {
        if (!guildId) return [];
        let all: any;
        try { all = GuildChannelStore.getChannels(guildId); } catch { return []; }
        const list = [...(all?.SELECTABLE ?? []), ...(all?.VOCAL ?? [])].map((x: any) => x.channel).filter(Boolean);
        const byCat = new Map<string, any[]>();
        for (const c of list) {
            const cat = c.parent_id ? ChannelStore.getChannel(c.parent_id)?.name ?? "" : "";
            if (!byCat.has(cat)) byCat.set(cat, []);
            byCat.get(cat)!.push(c);
        }
        return [...byCat.entries()];
    }, [guildId]);
    if (!guildId) return <NoServer />;
    const term = q.trim().toLowerCase();
    const icon = (c: any) => c.type === 2 || c.type === 13 ? "🔊" : c.type === 15 ? "💬" : c.type === 5 ? "📣" : "#";
    return (
        <>
            <Search value={q} onChange={setQ} placeholder="Search channels…" />
            <div className="vc-es2-insert-list">
                {!term && (
                    <div className="vc-es2-insert-group">
                        <b>Discord pages</b>
                        <div className="vc-es2-insert-chips">
                            {[["<id:customize>", "Channels & Roles"], ["<id:browse>", "Browse Channels"], ["<id:guide>", "Server Guide"], ["<id:linked-roles>", "Linked Roles"]].map(([t, n]) => (
                                <button key={t} type="button" className="vc-es2-chan" onClick={() => onPick(t)}>✨ {n}</button>
                            ))}
                        </div>
                    </div>
                )}
                {groups.map(([cat, chans]) => {
                    const shown = chans.filter(c => c.name.toLowerCase().includes(term));
                    if (!shown.length) return null;
                    return (
                        <div key={cat} className="vc-es2-insert-group">
                            {cat && <b>{cat}</b>}
                            <div className="vc-es2-insert-chips">
                                {shown.map(c => <button key={c.id} type="button" className="vc-es2-chan" onClick={() => onPick(`<#${c.id}>`)}>{icon(c)} {c.name}</button>)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
}

function PeoplePanel({ guildId, onPick }: { guildId: string | null; onPick(t: string): void; }) {
    const [q, setQ] = useState("");
    const people = useMemo(() => {
        if (!guildId) return [];
        let members: any[] = [];
        try { members = GuildMemberStore.getMembers(guildId) ?? []; } catch { }
        return members.map(m => {
            const u: any = UserStore.getUser(m.userId);
            return u && !u.bot ? { id: m.userId, name: m.nick || u.globalName || u.username, tag: u.username, avatar: u.getAvatarURL?.(guildId, 32) } : null;
        }).filter(Boolean).sort((a: any, b: any) => a.name.localeCompare(b.name)) as { id: string; name: string; tag: string; avatar?: string; }[];
    }, [guildId]);
    if (!guildId) return <NoServer />;
    const term = q.trim().toLowerCase();
    const isId = /^\d{15,22}$/.test(q.trim());
    const shown = people.filter(p => p.name.toLowerCase().includes(term) || p.tag.toLowerCase().includes(term)).slice(0, 60);
    return (
        <>
            <Search value={q} onChange={setQ} placeholder="Search by name, or paste a user ID…" />
            <div className="vc-es2-insert-list vc-es2-insert-chips">
                {isId && <button type="button" className="vc-es2-person" onClick={() => onPick(`<@${q.trim()}>`)}>@ Mention user {q.trim()}</button>}
                {shown.map(p => (
                    <button key={p.id} type="button" className="vc-es2-person" title={`@${p.tag}`} onClick={() => onPick(`<@${p.id}>`)}>
                        {p.avatar && <img src={p.avatar} alt="" />}{p.name}
                    </button>
                ))}
                {!shown.length && !isId && <span className="vc-tool-hint">{q ? "Nobody by that name here." : "Nobody loaded yet."}</span>}
            </div>
            <span className="vc-tool-hint">Only people Discord has already loaded show here — for anyone else, paste their user ID.</span>
        </>
    );
}

const FORMATS: [string, string, Intl.DateTimeFormatOptions | null][] = [
    ["R", "Relative", null],
    ["t", "Short time", { timeStyle: "short" }],
    ["T", "Long time", { timeStyle: "medium" }],
    ["d", "Short date", { dateStyle: "short" }],
    ["D", "Long date", { dateStyle: "long" }],
    ["f", "Date and time", { dateStyle: "long", timeStyle: "short" }],
    ["F", "Day, date and time", { dateStyle: "full", timeStyle: "short" }],
];

/** "in 2 hours", "3 days ago" — how Discord shows a relative timestamp. */
function relative(ms: number) {
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    const s = Math.round((ms - Date.now()) / 1000), a = Math.abs(s);
    if (a < 60) return rtf.format(s, "second");
    if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
    if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
    if (a < 2592000) return rtf.format(Math.round(s / 86400), "day");
    if (a < 31536000) return rtf.format(Math.round(s / 2592000), "month");
    return rtf.format(Math.round(s / 31536000), "year");
}

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function TimePanel({ onPick }: { onPick(t: string): void; }) {
    const [when, setWhen] = useState(() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return localInput(d); });
    const ms = new Date(when).getTime();
    const ok = Number.isFinite(ms);
    const unix = Math.floor(ms / 1000);
    const quick: [string, () => Date][] = [
        ["Now", () => new Date()],
        ["In 1 hour", () => new Date(Date.now() + 3600000)],
        ["Tonight 8 PM", () => { const d = new Date(); d.setHours(20, 0, 0, 0); return d; }],
        ["Tomorrow noon", () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(12, 0, 0, 0); return d; }],
        ["Next week", () => new Date(Date.now() + 7 * 86400000)],
    ];
    return (
        <>
            <div className="vc-es2-row">
                <input type="datetime-local" className="vc-tool-input vc-es2-insert-date" value={when} onChange={e => setWhen(e.target.value)} />
            </div>
            <div className="vc-es2-insert-chips">
                {quick.map(([label, make]) => <button key={label} type="button" className="vc-tool-chip" onClick={() => setWhen(localInput(make()))}>{label}</button>)}
            </div>
            {ok && (
                <div className="vc-es2-time-list">
                    {FORMATS.map(([f, name, opts]) => (
                        <button key={f} type="button" className="vc-es2-time" onClick={() => onPick(`<t:${unix}:${f}>`)}>
                            <b>{opts ? new Intl.DateTimeFormat(undefined, opts).format(ms) : relative(ms)}</b>
                            <span>{name}</span>
                        </button>
                    ))}
                </div>
            )}
            <span className="vc-tool-hint">Everyone sees it in their own timezone — and “Relative” counts down live.</span>
        </>
    );
}

interface EmojiItem { id: string; name: string; animated: boolean; guild: string; }

export const emojiToken = (e: { id: string; name: string; animated: boolean; }) => `<${e.animated ? "a" : ""}:${e.name}:${e.id}>`;
export const emojiUrl = (id: string, animated: boolean) => `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "webp"}?size=48&quality=lossless`;

/** Custom emoji from your servers — the message's server first. */
export function EmojiPanel({ guildId, onPick }: { guildId: string | null; onPick(token: string): void; }) {
    const [q, setQ] = useState("");
    const groups = useMemo(() => {
        let ids: string[] = [];
        try { ids = Object.keys(EmojiStore.getGuilds() ?? {}); } catch { }
        if (guildId && !ids.includes(guildId)) ids.unshift(guildId);
        const out: [string, EmojiItem[]][] = [];
        for (const gid of ids) {
            let list: any[] = [];
            try { list = EmojiStore.getGuildEmoji(gid) ?? []; } catch { }
            const items = list.filter(e => e?.id && e.available !== false).map(e => ({ id: e.id, name: e.name, animated: !!e.animated, guild: gid }));
            if (items.length) out.push([gid, items]);
        }
        out.sort(([a], [b]) => a === guildId ? -1 : b === guildId ? 1 : (GuildStore.getGuild(a)?.name ?? "").localeCompare(GuildStore.getGuild(b)?.name ?? ""));
        return out;
    }, [guildId]);
    const term = q.trim().toLowerCase().replace(/:/g, "");
    let count = 0;
    return (
        <>
            <Search value={q} onChange={setQ} placeholder="Search emoji…" />
            <div className="vc-es2-insert-list">
                {groups.map(([gid, items]) => {
                    const shown = items.filter(e => e.name.toLowerCase().includes(term));
                    if (!shown.length || count > 600) return null;
                    count += shown.length;
                    return (
                        <div key={gid} className="vc-es2-insert-group">
                            <b>{GuildStore.getGuild(gid)?.name ?? "Server"}{gid === guildId ? " · this server" : ""}</b>
                            <div className="vc-es2-emoji-grid">
                                {shown.map(e => (
                                    <button key={e.id} type="button" className="vc-es2-emoji" title={`:${e.name}:`} onClick={() => onPick(emojiToken(e))}>
                                        <img src={emojiUrl(e.id, e.animated)} alt={e.name} loading="lazy" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })}
                {!groups.length && <span className="vc-tool-hint">No custom emoji in your servers.</span>}
            </div>
            <span className="vc-tool-hint">Emoji from other servers only show if that channel lets everyone use external emoji.</span>
        </>
    );
}

/** Sonata's Characters picker, right in the editor: symbols, arrows, stars, boxes, fancy letters… */
export function CharsPanel({ onPick }: { onPick(ch: string): void; }) {
    const [q, setQ] = useState("");
    const [recents, setRecents] = useState<string[]>(() => recentChars());
    const [tab, setTab] = useState(() => recents.length ? "recent" : CATEGORIES[0].id);
    const term = q.trim().toLowerCase();
    const shown = useMemo(() => {
        if (term) return ALL_CHARS.filter(c => c.ch.includes(term) || c.words.includes(term) || c.words.split(" ").some(w => w.startsWith(term)));
        if (tab === "recent") return recents.map(ch => ALL_CHARS.find(c => c.ch === ch) ?? { ch, words: "", category: "recent", wide: ch.length > 2 });
        return ALL_CHARS.filter(c => c.category === tab);
    }, [term, tab, recents]);
    const pick = (ch: string) => { onPick(ch); setRecents(rememberChar(ch)); };
    const tabs: [string, string][] = [...(recents.length ? [["recent", "Recent"] as [string, string]] : []), ...CATEGORIES.map(c => [c.id, c.name] as [string, string])];
    return (
        <>
            <Search value={q} onChange={setQ} placeholder="Search — heart, arrow, star, chess, circled 3, shrug…" />
            {!term && (
                <div className="vc-es2-chars-tabs">
                    {tabs.map(([id, name]) => <button key={id} type="button" className={"vc-es2-chars-tab" + (tab === id ? " vc-es2-chars-tab-on" : "")} onClick={() => setTab(id)}>{name}</button>)}
                </div>
            )}
            <div className="vc-es2-insert-list">
                <div className="vc-es2-chars-grid">
                    {shown.map(c => (
                        <button key={`${c.category}-${c.ch}`} type="button" title={c.words || c.ch} className={"vc-es2-char" + (c.wide ? " vc-es2-char-wide" : "")} onMouseDown={e => e.preventDefault()} onClick={() => pick(c.ch)}>{c.ch}</button>
                    ))}
                    {!shown.length && <span className="vc-tool-hint">Nothing matches “{q}”.</span>}
                </div>
            </div>
            <span className="vc-tool-hint">They go in where your cursor is. Your recent ones are shared with the chat box's Characters button.</span>
        </>
    );
}
