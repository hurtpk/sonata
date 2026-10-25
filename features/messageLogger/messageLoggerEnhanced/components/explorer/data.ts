/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Everything the log window shows, worked out once from the saved logs:
// where each message was (server › category › channel, or which DM), who
// sent it, its pictures and files, and how fast it vanished.

import { ChannelStore, GuildStore, IconUtils, UserStore } from "@webpack/common";

export type Status = "DELETED" | "EDITED" | "GHOST_PINGED";
export interface LogRecord { message_id: string; channel_id: string; status: Status; message: any; }

export type MediaKind = "image" | "video" | "audio" | "file";
export interface Media {
    key: string;
    entry: Entry;
    kind: MediaKind;
    name: string;
    url: string;
    size?: number;
    width?: number;
    height?: number;
    /** A copy is on this computer, so it still opens after Discord removes it. */
    saved: boolean;
    att?: any;
    fromEmbed?: boolean;
    spoiler?: boolean;
}

export interface Version { at: number | null; content: string; }

export interface Entry {
    id: string;
    rec: LogRecord;
    m: any;
    status: Status;
    deleted: boolean;
    edited: boolean;
    ghost: boolean;
    sent: number;
    gone: number | null;
    /** When it happened: deleted, last edited, or sent. Used to sort and group. */
    at: number;
    versions: Version[];
    channelId: string;
    place: Place;
    authorId: string;
    author: Author;
    media: Media[];
    files: Media[];
    embeds: { title?: string; description?: string; url?: string; }[];
    hasLink: boolean;
    mentionsMe: boolean;
    reply: { name: string; content: string; } | null;
    search: string;
    /** Your star and note (from meta.ts). */
    star: boolean;
    note: string;
    base: string;
}

export type MetaMap = Record<string, { star?: boolean; note?: string; }>;

/** Puts your stars and notes onto the entries (notes are searchable too). */
export function applyMeta(index: LogIndex, meta: MetaMap) {
    for (const e of index.entries) {
        const m = meta[e.id];
        e.star = !!m?.star;
        e.note = m?.note ?? "";
        e.search = e.note ? `${e.base}\n${e.note.toLowerCase()}` : e.base;
    }
}

export interface Author { id: string; name: string; username: string; avatar: string; bot: boolean; }

export type ChannelKind = "text" | "voice" | "thread" | "forum" | "announce" | "dm" | "group" | "unknown";
export interface Place {
    channelId: string;
    channelName: string;
    kind: ChannelKind;
    guildId: string | null;
    guildName: string | null;
    categoryId: string | null;
    categoryName: string | null;
    /** For threads: the channel the thread is in. */
    parentName: string | null;
    dmUser: Author | null;
}

export interface PlaceChannel { id: string; name: string; kind: ChannelKind; parentName: string | null; count: number; }
export interface PlaceCategory { id: string; name: string; count: number; channels: PlaceChannel[]; }
export interface PlaceGuild { id: string; name: string; icon: string | null; count: number; categories: PlaceCategory[]; }
export interface PlaceDm { id: string; name: string; avatar: string; group: boolean; count: number; last: number; }
export interface Person extends Author { deleted: number; edited: number; ghost: number; media: number; count: number; last: number; places: Set<string>; }

export interface LogIndex {
    entries: Entry[];
    byId: Map<string, Entry>;
    guilds: PlaceGuild[];
    dms: PlaceDm[];
    people: Map<string, Person>;
}

const EPOCH = 1420070400000;
export const snowflakeTime = (id: string) => { try { return Number(BigInt(id) >> 22n) + EPOCH; } catch { return 0; } };
const time = (v: any): number | null => {
    if (v == null) return null;
    if (typeof v === "number") return v;
    if (typeof v === "object" && typeof v.valueOf === "function") { const n = Number(v.valueOf()); return Number.isFinite(n) ? n : null; }
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : null;
};

export function avatarOf(u: { id?: string; avatar?: string | null; } | null | undefined): string {
    if (u?.id && u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.webp?size=64`;
    try { return IconUtils.getDefaultAvatarURL(u?.id ?? "0"); } catch { return "https://cdn.discordapp.com/embed/avatars/0.png"; }
}

function authorOf(a: any): Author {
    const id = a?.id ?? "0";
    const live: any = (() => { try { return UserStore.getUser(id); } catch { return null; } })();
    const name = a?.globalName ?? a?.global_name ?? live?.globalName ?? a?.username ?? live?.username ?? "Unknown";
    return { id, name, username: a?.username ?? live?.username ?? "", avatar: avatarOf(a?.avatar ? a : live ?? a), bot: !!a?.bot };
}

const KIND: Record<number, ChannelKind> = { 0: "text", 1: "dm", 2: "voice", 3: "group", 5: "announce", 10: "thread", 11: "thread", 12: "thread", 13: "voice", 15: "forum", 16: "forum" };

function placeOf(channelId: string, guildHint: string | null, author: Author, myId: string | undefined, cache: Map<string, Place>): Place {
    const hit = cache.get(channelId);
    if (hit) return hit;
    const ch: any = (() => { try { return ChannelStore.getChannel(channelId); } catch { return null; } })();
    let p: Place;
    if (ch) {
        const kind = KIND[ch.type] ?? "text";
        const guildId = ch.guild_id ?? guildHint ?? null;
        let parent: any = null, category: any = null;
        if (kind === "thread" && ch.parent_id) parent = ChannelStore.getChannel(ch.parent_id);
        const catId = (parent ?? ch).parent_id;
        if (catId) category = ChannelStore.getChannel(catId);
        const guild: any = guildId ? GuildStore.getGuild(guildId) : null;
        let dmUser: Author | null = null;
        if (kind === "dm") {
            const rid = ch.recipients?.[0] ?? ch.getRecipientId?.();
            const u: any = rid ? UserStore.getUser(rid) : null;
            dmUser = u ? authorOf(u) : author.id !== myId ? author : null;
        }
        const name = kind === "dm" ? (dmUser?.name ?? "Direct message")
            : kind === "group" ? (ch.name || (ch.recipients ?? []).map((id: string) => { const u: any = UserStore.getUser(id); return u?.globalName ?? u?.username; }).filter(Boolean).slice(0, 3).join(", ") || "Group DM")
                : ch.name ?? "unknown";
        p = {
            channelId, channelName: name, kind, guildId: kind === "dm" || kind === "group" ? null : guildId,
            guildName: guild?.name ?? (guildId ? "Unknown server" : null),
            categoryId: category?.id ?? null, categoryName: category?.name ?? null,
            parentName: parent?.name ?? null, dmUser,
        };
    } else {
        // A channel Discord no longer knows (left the server, closed DM).
        const guild: any = guildHint ? GuildStore.getGuild(guildHint) : null;
        p = guildHint
            ? { channelId, channelName: `deleted-channel-${channelId.slice(-4)}`, kind: "unknown", guildId: guildHint, guildName: guild?.name ?? "A server you left", categoryId: null, categoryName: null, parentName: null, dmUser: null }
            : { channelId, channelName: author.id !== myId ? author.name : "Closed DM", kind: "dm", guildId: null, guildName: null, categoryId: null, categoryName: null, parentName: null, dmUser: author.id !== myId ? author : null };
    }
    cache.set(channelId, p);
    return p;
}

const EXT_KIND: [RegExp, MediaKind][] = [[/\.(png|jpe?g|gif|webp|avif|bmp|heic)$/i, "image"], [/\.(mp4|webm|mov|mkv|m4v)$/i, "video"], [/\.(mp3|ogg|wav|flac|m4a|opus)$/i, "audio"]];
function kindOf(type: string | undefined, name: string): MediaKind {
    if (type?.startsWith("image")) return "image";
    if (type?.startsWith("video")) return "video";
    if (type?.startsWith("audio")) return "audio";
    for (const [re, k] of EXT_KIND) if (re.test(name.split("?")[0])) return k;
    return "file";
}

const LINK = /https?:\/\/\S+/i;

export function buildIndex(records: LogRecord[]): LogIndex {
    const myId: string | undefined = (() => { try { return UserStore.getCurrentUser()?.id; } catch { return undefined; } })();
    const places = new Map<string, Place>();
    const entries: Entry[] = [];

    for (const rec of records) {
        const m = rec.message;
        if (!m) continue;
        const author = authorOf(m.author);
        const place = placeOf(rec.channel_id ?? m.channel_id, m.guildId ?? m.guild_id ?? null, author, myId, places);
        const sent = time(m.timestamp) ?? snowflakeTime(m.id);
        const gone = time(m.deletedTimestamp);
        const history: any[] = Array.isArray(m.editHistory) ? m.editHistory : [];
        const versions: Version[] = [...history.map(h => ({ at: time(h.timestamp), content: h.content ?? "" })), { at: null, content: m.content ?? "" }];
        // The first version was sent at the message's own time; each later one when the one before was replaced.
        for (let i = versions.length - 1; i > 0; i--) versions[i].at = versions[i - 1].at;
        if (versions.length) versions[0].at = sent;
        const ghost = rec.status === "GHOST_PINGED";
        const deleted = rec.status !== "EDITED" || !!m.deleted;
        const edited = history.length > 0;
        const lastEdit = edited ? time(history[history.length - 1].timestamp) : null;

        const e = {
            id: rec.message_id, rec, m, status: rec.status, deleted, edited, ghost, sent, gone,
            at: gone ?? lastEdit ?? sent, versions, channelId: place.channelId, place,
            authorId: author.id, author, media: [] as Media[], files: [] as Media[], embeds: [] as Entry["embeds"],
            hasLink: LINK.test(m.content ?? ""), mentionsMe: false, reply: null as Entry["reply"], search: "", star: false, note: "", base: "",
        } as Entry;

        for (const a of m.attachments ?? []) {
            const name = a.filename ?? a.title ?? "file";
            const kind = kindOf(a.content_type, name);
            const item: Media = {
                key: `${e.id}:${a.id}`, entry: e, kind, name, url: a.proxy_url || a.url, size: a.size,
                width: a.width, height: a.height, saved: !!a.path, att: a, spoiler: name.startsWith("SPOILER_"),
            };
            (kind === "file" || kind === "audio" ? e.files : e.media).push(item);
        }
        for (const [i, em] of (m.embeds ?? []).entries()) {
            const pic = em.video ?? em.image ?? em.thumbnail;
            if (pic?.url && em.type !== "article" && em.type !== "link") {
                const video = !!em.video && em.type !== "gifv";
                e.media.push({ key: `${e.id}:e${i}`, entry: e, kind: video ? "video" : "image", name: em.title ?? em.provider?.name ?? "Embedded media", url: pic.proxy_url || pic.url, width: pic.width, height: pic.height, saved: false, fromEmbed: true });
            }
            if (em.title || em.description) e.embeds.push({ title: em.title, description: em.description, url: em.url });
        }

        const mentions: any[] = m.mentions ?? [];
        e.mentionsMe = ghost || !!m.mention_everyone || (!!myId && mentions.some(x => (typeof x === "string" ? x : x?.id) === myId));
        const ref = m.referenced_message;
        if (ref?.author) e.reply = { name: ref.author.globalName ?? ref.author.username ?? "someone", content: ref.content ?? "" };

        e.search = [
            ...versions.map(v => v.content), author.name, author.username, place.channelName, place.guildName ?? "", place.categoryName ?? "",
            ...e.media.map(x => x.name), ...e.files.map(x => x.name), ...e.embeds.map(x => `${x.title ?? ""} ${x.description ?? ""}`),
        ].join("\n").toLowerCase();
        e.base = e.search;
        entries.push(e);
    }

    entries.sort((a, b) => b.at - a.at);

    const byId = new Map(entries.map(e => [e.id, e]));
    const guildMap = new Map<string, PlaceGuild & { cats: Map<string, PlaceCategory & { chans: Map<string, PlaceChannel>; }>; }>();
    const dmMap = new Map<string, PlaceDm>();
    const people = new Map<string, Person>();

    for (const e of entries) {
        const p = e.place;
        if (p.guildId) {
            let g = guildMap.get(p.guildId);
            if (!g) {
                const live: any = GuildStore.getGuild(p.guildId);
                g = { id: p.guildId, name: p.guildName ?? "Unknown server", icon: live?.icon ? `https://cdn.discordapp.com/icons/${live.id}/${live.icon}.webp?size=64` : null, count: 0, categories: [], cats: new Map() };
                guildMap.set(p.guildId, g);
            }
            g.count++;
            const catKey = p.categoryId ?? "";
            let c = g.cats.get(catKey);
            if (!c) { c = { id: catKey, name: p.categoryName ?? "No category", count: 0, channels: [], chans: new Map() }; g.cats.set(catKey, c); }
            c.count++;
            let ch = c.chans.get(p.channelId);
            if (!ch) { ch = { id: p.channelId, name: p.channelName, kind: p.kind, parentName: p.parentName, count: 0 }; c.chans.set(p.channelId, ch); }
            ch.count++;
        } else {
            let d = dmMap.get(p.channelId);
            if (!d) { d = { id: p.channelId, name: p.channelName, avatar: p.dmUser?.avatar ?? avatarOf(null), group: p.kind === "group", count: 0, last: e.at }; dmMap.set(p.channelId, d); }
            d.count++;
        }

        let who = people.get(e.authorId);
        if (!who) { who = { ...e.author, deleted: 0, edited: 0, ghost: 0, media: 0, count: 0, last: e.at, places: new Set() }; people.set(e.authorId, who); }
        who.count++;
        if (e.deleted) who.deleted++;
        if (e.edited) who.edited++;
        if (e.ghost) who.ghost++;
        who.media += e.media.length + e.files.length;
        who.places.add(p.guildId ?? p.channelId);
    }

    const guilds = [...guildMap.values()].map(({ cats, ...g }) => ({
        ...g,
        // Named categories first, in the server's order is unknown here, so by name; "No category" last.
        categories: [...cats.values()].map(({ chans, ...c }) => ({ ...c, channels: [...chans.values()].sort((a, b) => b.count - a.count) }))
            .sort((a, b) => (a.id === "" ? 1 : 0) - (b.id === "" ? 1 : 0) || a.name.localeCompare(b.name)),
    })).sort((a, b) => b.count - a.count);
    const dms = [...dmMap.values()].sort((a, b) => b.last - a.last);

    return { entries, byId, guilds, dms, people };
}

/* ── Where you're looking ───────────────────────────────────────────── */

export type Scope =
    | { kind: "all"; }
    | { kind: "dms"; }
    | { kind: "guild"; id: string; }
    | { kind: "category"; guildId: string; id: string; }
    | { kind: "channel"; id: string; }
    | { kind: "person"; id: string; };

export function inScope(e: Entry, s: Scope): boolean {
    switch (s.kind) {
        case "all": return true;
        case "dms": return !e.place.guildId;
        case "guild": return e.place.guildId === s.id;
        case "category": return e.place.guildId === s.guildId && (e.place.categoryId ?? "") === s.id;
        case "channel": return e.channelId === s.id;
        case "person": return e.authorId === s.id;
    }
}

export const sameScope = (a: Scope, b: Scope) => JSON.stringify(a) === JSON.stringify(b);

/* ── Filters and search ─────────────────────────────────────────────── */

export type TypeFilter = "all" | "deleted" | "edited" | "ghost";
export type Period = "all" | "day" | "week" | "month";
export type HasFilter = "media" | "file" | "link" | "reply" | "me" | "quick" | "star";
export interface Filters { type: TypeFilter; period: Period; has: HasFilter[]; query: string; }
export const NO_FILTERS: Filters = { type: "all", period: "all", has: [], query: "" };

interface Term { key: string | null; value: string; negate: boolean; }
const KEYS = new Set(["from", "user", "in", "channel", "server", "guild", "has", "before", "after", "during", "on", "is", "message"]);

export function parseQuery(q: string): Term[] {
    const out: Term[] = [];
    for (const m of q.matchAll(/(-|!)?(?:(\w+):)?(?:"([^"]*)"|(\S+))/g)) {
        const key = m[2]?.toLowerCase() ?? null;
        const value = (m[3] ?? m[4] ?? "").toLowerCase();
        if (!value) continue;
        if (key && !KEYS.has(key)) out.push({ key: null, value: `${m[2]}:${value}`, negate: !!m[1] });
        else out.push({ key, value, negate: !!m[1] });
    }
    return out;
}

const DAY = 86_400_000;
function matchTerm(e: Entry, t: Term): boolean {
    const v = t.value;
    switch (t.key) {
        case null: return e.search.includes(v);
        case "message": return e.id === v;
        case "from": case "user": return e.authorId === v || e.author.name.toLowerCase().includes(v) || e.author.username.toLowerCase().includes(v);
        case "in": case "channel": return e.channelId === v || e.place.channelName.toLowerCase().includes(v.replace(/^#/, ""));
        case "server": case "guild": return e.place.guildId === v || !!e.place.guildName?.toLowerCase().includes(v);
        case "has":
            if (v === "image" || v === "picture") return e.media.some(x => x.kind === "image");
            if (v === "video") return e.media.some(x => x.kind === "video");
            if (v === "file" || v === "attachment") return e.files.length + e.media.filter(x => !x.fromEmbed).length > 0;
            if (v === "link") return e.hasLink;
            if (v === "embed") return e.embeds.length > 0 || e.media.some(x => x.fromEmbed);
            if (v === "reply") return !!e.reply;
            return false;
        case "is":
            if (v === "deleted") return e.deleted;
            if (v === "edited") return e.edited;
            if (v === "ghost" || v === "ghostping") return e.ghost;
            if (v === "dm") return !e.place.guildId;
            if (v === "bot") return e.author.bot;
            if (v === "starred" || v === "star") return e.star;
            if (v === "noted") return !!e.note;
            return false;
        case "before": { const d = Date.parse(v); return Number.isFinite(d) && e.at < d; }
        case "after": { const d = Date.parse(v); return Number.isFinite(d) && e.at > d; }
        case "during": case "on": { const d = Date.parse(v); return Number.isFinite(d) && e.at >= d && e.at < d + DAY; }
    }
    return false;
}

export const quickDelete = (e: Entry) => e.gone != null && e.gone - e.sent < 60_000;

export function applyFilters(list: Entry[], f: Filters, now = Date.now()): Entry[] {
    const terms = parseQuery(f.query.trim());
    const since = f.period === "day" ? now - DAY : f.period === "week" ? now - 7 * DAY : f.period === "month" ? now - 30 * DAY : 0;
    return list.filter(e => {
        if (f.type === "deleted" && !e.deleted) return false;
        if (f.type === "edited" && !e.edited) return false;
        if (f.type === "ghost" && !e.ghost) return false;
        if (since && e.at < since) return false;
        for (const h of f.has) {
            if (h === "media" && !e.media.length) return false;
            if (h === "file" && !e.files.length) return false;
            if (h === "link" && !e.hasLink) return false;
            if (h === "reply" && !e.reply) return false;
            if (h === "me" && !e.mentionsMe) return false;
            if (h === "quick" && !quickDelete(e)) return false;
            if (h === "star" && !e.star) return false;
        }
        for (const t of terms) if (matchTerm(e, t) === t.negate) return false;
        return true;
    });
}

/* ── Words that changed between two versions ───────────────────────── */

export type DiffPart = { text: string; kind: "same" | "add" | "del"; };
export function diffWords(a: string, b: string): DiffPart[] {
    const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
    if (A.length * B.length > 250_000) return [{ text: a, kind: "del" }, { text: " ", kind: "same" }, { text: b, kind: "add" }];
    const n = A.length, m = B.length;
    const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out: DiffPart[] = [];
    const push = (text: string, kind: DiffPart["kind"]) => { const last = out[out.length - 1]; if (last?.kind === kind) last.text += text; else out.push({ text, kind }); };
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (A[i] === B[j]) { push(A[i], "same"); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) push(A[i++], "del"); else push(B[j++], "add");
    }
    while (i < n) push(A[i++], "del");
    while (j < m) push(B[j++], "add");
    return out;
}

/* ── Formatting ─────────────────────────────────────────────────────── */

export function fmtDuration(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} h`;
    return `${Math.round(h / 24)} days`;
}

export function fmtDay(ms: number, now = Date.now()): string {
    const d = new Date(ms), t = new Date(now);
    const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((start(t) - start(d)) / DAY);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === t.getFullYear() ? undefined : "numeric" });
}

export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
export const fmtWhen = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function fmtBytes(n?: number): string {
    if (!n) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function whereText(p: Place): string {
    if (p.kind === "dm") return `DM with ${p.channelName}`;
    if (p.kind === "group") return `Group DM · ${p.channelName}`;
    const ch = p.kind === "thread" ? `🧵 ${p.channelName}${p.parentName ? ` in #${p.parentName}` : ""}` : `#${p.channelName}`;
    return `${p.guildName ?? "Server"} › ${ch}`;
}

/* ── Exporting ──────────────────────────────────────────────────────── */

export function exportText(list: Entry[]): string {
    return list.map(e => {
        const head = `[${fmtWhen(e.sent)}] ${e.author.name} (@${e.author.username}) — ${whereText(e.place)}`;
        const tags = [e.deleted && (e.gone ? `deleted ${fmtWhen(e.gone)}` : "deleted"), e.edited && `edited ${e.versions.length - 1}×`, e.ghost && "ghost ping"].filter(Boolean).join(", ");
        const body = e.edited ? e.versions.map((v, i) => `  ${i === e.versions.length - 1 ? "now" : `v${i + 1}`}: ${v.content}`).join("\n") : `  ${e.m.content ?? ""}`;
        const files = [...e.media, ...e.files].map(x => `  📎 ${x.name} ${x.url}`).join("\n");
        return [head + (tags ? ` (${tags})` : ""), body, files].filter(Boolean).join("\n");
    }).join("\n\n");
}

const csvCell = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
export function exportCsv(list: Entry[]): string {
    const rows = [["sent", "deleted", "type", "author", "username", "author_id", "server", "channel", "content", "earlier_versions", "attachments", "message_id", "channel_id"]];
    for (const e of list) rows.push([
        new Date(e.sent).toISOString(), e.gone ? new Date(e.gone).toISOString() : "", e.ghost ? "ghost ping" : e.deleted ? "deleted" : "edited",
        e.author.name, e.author.username, e.authorId, e.place.guildName ?? "", e.place.channelName, e.m.content ?? "",
        e.versions.slice(0, -1).map(v => v.content).join(" | "), [...e.media, ...e.files].map(x => x.url).join(" "), e.id, e.channelId,
    ]);
    return rows.map(r => r.map(csvCell).join(",")).join("\n");
}

export const exportJson = (list: Entry[]) => JSON.stringify(list.map(e => e.rec), null, 2);
