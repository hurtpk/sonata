/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../../../../_shared/tool.css";
import "./explorer.css";

import { RenderModalProps } from "@vencord/discord-types";
import { React, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { Window } from "../../../../_shared/Window";
import { Avatar, Backend, backendCtx, cl, classes, GuildIcon, useBackend } from "./bits";
import { applyFilters, applyMeta, buildIndex, Entry, exportCsv, exportJson, exportText, Filters, fmtBytes, fmtWhen, HasFilter, inScope, LogIndex, LogRecord, Media, MetaMap, NO_FILTERS, Period, sameScope, Scope, TypeFilter, whereText } from "./data";
import { Detail } from "./Detail";
import { GalleryView, Lightbox } from "./Gallery";
import { MessagesView } from "./Messages";
import { OverviewView } from "./Overview";
import { PeopleView } from "./People";
import { conversationPicture, MAX_PICTURE } from "./picture";

function BackendProvider({ value, children }: { value: Backend; children: React.ReactNode; }) {
    const Ctx = backendCtx();
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

type View = "overview" | "messages" | "media" | "people";

const PREFS_KEY = "vc-mlx-prefs";
const loadPrefs = (): { view?: View; look?: "cards" | "discord"; newest?: boolean; } => { try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}"); } catch { return {}; } };
const savePrefs = (p: object) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...p })); } catch { } };

/** "user:123" from a right-click menu becomes "everything from that person", and so on. */
function fromQuery(q: string | undefined): { scope: Scope; query: string; } {
    const m = q?.trim().match(/^(user|from|channel|in|server|guild):(\d{5,})$/i);
    if (!m) return { scope: { kind: "all" }, query: q ?? "" };
    const k = m[1].toLowerCase();
    return { scope: k === "user" || k === "from" ? { kind: "person", id: m[2] } : k === "server" || k === "guild" ? { kind: "guild", id: m[2] } : { kind: "channel", id: m[2] }, query: "" };
}

export interface ExplorerProps { modalProps: RenderModalProps; backend: Backend; initialQuery?: string; accent?: string | null; }

export function Explorer({ modalProps, backend, initialQuery, accent }: ExplorerProps) {
    const prefs = useMemo(loadPrefs, []);
    const init = useMemo(() => fromQuery(initialQuery), []);
    const [records, setRecords] = useState<LogRecord[] | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const [fresh, setFresh] = useState(0);
    const [scope, setScopeRaw] = useState<Scope>(init.scope);
    const [view, setViewRaw] = useState<View>(prefs.view ?? "messages");
    const [filters, setFilters] = useState<Filters>({ ...NO_FILTERS, query: init.query });
    const [typed, setTyped] = useState(init.query);
    const [newest, setNewest] = useState(prefs.newest ?? true);
    const [look, setLook] = useState<"cards" | "discord">(prefs.look === "discord" && backend.discordView ? "discord" : "cards");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [picking, setPicking] = useState(false);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [lastPick, setLastPick] = useState<string | null>(null);
    const [lightbox, setLightbox] = useState<{ items: Media[]; index: number; } | null>(null);
    const [exportOpen, setExportOpen] = useState(false);
    const [storageOpen, setStorageOpen] = useState(false);
    const [meta, setMetaMap] = useState<MetaMap>({});
    const [metaTick, setMetaTick] = useState(0);
    const searchRef = useRef<HTMLInputElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);

    const load = () => {
        setFailed(null);
        Promise.all([backend.load(), backend.meta().catch(() => ({}))]).then(([r, m]) => { setMetaMap(m); setRecords(r); setFresh(0); }).catch(err => setFailed(String(err?.message ?? err)));
    };
    useEffect(load, []);
    useEffect(() => backend.watch?.(() => setFresh(n => n + 1)), []);
    // Typing waits a moment before searching, so big logs stay smooth.
    useEffect(() => { const t = setTimeout(() => setFilters(f => ({ ...f, query: typed })), 200); return () => clearTimeout(t); }, [typed]);

    const index: LogIndex | null = useMemo(() => {
        if (!records) return null;
        const ix = buildIndex(records);
        applyMeta(ix, meta);
        return ix;
    }, [records]);
    const scoped = useMemo(() => index ? index.entries.filter(e => inScope(e, scope)) : [], [index, scope, metaTick]);
    const filtered = useMemo(() => {
        const out = applyFilters(scoped, filters);
        return newest ? out : out.reverse();
    }, [scoped, filters, newest, metaTick]);
    const typeCounts = useMemo(() => {
        const c = { all: 0, deleted: 0, edited: 0, ghost: 0 };
        for (const e of applyFilters(scoped, { ...filters, type: "all" })) { c.all++; if (e.deleted) c.deleted++; if (e.edited) c.edited++; if (e.ghost) c.ghost++; }
        return c;
    }, [scoped, filters.period, filters.has, filters.query, metaTick]);

    const selected = selectedId && index ? index.byId.get(selectedId) ?? null : null;

    // Stars and notes change the entries in place, then the lists are worked out again.
    const changeMeta = (e: Entry, patch: { star?: boolean; note?: string; }) => {
        const next = { ...meta[e.id], ...patch };
        setMetaMap(m => ({ ...m, [e.id]: next }));
        if (index) { applyMeta(index, { ...meta, [e.id]: next }); setMetaTick(t => t + 1); }
        backend.setMeta(e.id, patch).catch(() => backend.toast("Couldn't save that", false));
        if (patch.star !== undefined) backend.toast(patch.star ? "Starred — this log is kept forever" : "Unstarred");
    };

    // A message link from a right-click ("message:123") opens that message straight away.
    useEffect(() => {
        const m = init.query.match(/^message:(\d+)$/);
        if (m && index?.byId.has(m[1])) setSelectedId(m[1]);
    }, [index]);

    const setScope = (s: Scope) => {
        setScopeRaw(s);
        setPicked(new Set());
        bodyRef.current?.scrollTo(0, 0);
        if (view === "overview" && s.kind === "person") setView("messages");
    };
    const setView = (v: View) => { setViewRaw(v); savePrefs({ view: v }); bodyRef.current?.scrollTo(0, 0); };
    const setFilter = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters(f => ({ ...f, [k]: v }));
    const toggleHas = (h: HasFilter) => setFilters(f => ({ ...f, has: f.has.includes(h) ? f.has.filter(x => x !== h) : [...f.has, h] }));
    const anyFilter = filters.type !== "all" || filters.period !== "all" || filters.has.length > 0 || !!filters.query;
    const clearFilters = () => { setFilters(NO_FILTERS); setTyped(""); };

    const openEntry = (e: Entry) => { setSelectedId(e.id); if (view !== "messages") setView("messages"); };

    const remove = (list: Entry[]) => {
        if (!list.length) return;
        backend.confirm(
            list.length === 1 ? "Delete this log?" : `Delete ${list.length.toLocaleString()} logs?`,
            `${list.length === 1 ? "It's" : "They're"} removed from Message Logger, along with any pictures it saved. The messages themselves aren't touched.`,
            "Delete",
            async () => {
                await backend.remove(list.map(e => e.rec));
                const gone = new Set(list.map(e => e.id));
                setRecords(r => r?.filter(x => !gone.has(x.message_id)) ?? r);
                setPicked(p => new Set([...p].filter(id => !gone.has(id))));
                if (selectedId && gone.has(selectedId)) setSelectedId(null);
                backend.toast(list.length === 1 ? "Log deleted" : `${list.length.toLocaleString()} logs deleted`);
            });
    };
    const clearAll = () => backend.confirm("Clear every log?", "This removes everything Message Logger has saved — deleted, edited, ghost pings and saved pictures. It can't be undone.", "Clear everything", async () => {
        await backend.clearAll();
        setRecords([]);
        setSelectedId(null);
    });

    const pick = (id: string, range?: boolean) => setPicked(p => {
        const next = new Set(p);
        if (range && lastPick) {
            const a = filtered.findIndex(e => e.id === lastPick), b = filtered.findIndex(e => e.id === id);
            if (a >= 0 && b >= 0) { for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(filtered[i].id); setLastPick(id); return next; }
        }
        if (next.has(id)) next.delete(id); else next.add(id);
        setLastPick(id);
        return next;
    });
    const pickedEntries = () => filtered.filter(e => picked.has(e.id));

    /** Where these logs are from, for the top of the picture. */
    const pictureTitle = (list: Entry[]) => {
        const places = new Set(list.map(e => e.channelId));
        return places.size === 1 && list[0] ? whereText(list[0].place) : scope.kind === "person" ? `Messages from ${list[0]?.author.name ?? "someone"}` : "Message Logs";
    };
    const doPicture = async () => {
        const list = picking && picked.size ? pickedEntries() : filtered;
        setExportOpen(false);
        if (!list.length) return;
        backend.toast("Drawing the picture…");
        try {
            const png = await conversationPicture(list, pictureTitle(list));
            backend.save(`message-logs-${scopeSlug(scope, index)}-${new Date().toISOString().slice(0, 10)}.png`, "image/png", png);
            backend.toast(list.length > MAX_PICTURE ? `Saved the first ${MAX_PICTURE} as a picture — pick fewer to choose which` : `Saved ${list.length.toLocaleString()} message${list.length === 1 ? "" : "s"} as a picture`);
        } catch (e: any) {
            backend.toast(e?.message ?? "Couldn't make the picture", false);
        }
    };

    const doExport = (kind: "txt" | "csv" | "json") => {
        const list = picking && picked.size ? pickedEntries() : filtered;
        const stamp = new Date().toISOString().slice(0, 10);
        const name = `message-logs-${scopeSlug(scope, index)}-${stamp}.${kind}`;
        backend.save(name, kind === "json" ? "application/json" : kind === "csv" ? "text/csv" : "text/plain", kind === "json" ? exportJson(list) : kind === "csv" ? exportCsv(list) : exportText(list));
        setExportOpen(false);
        backend.toast(`Exported ${list.length.toLocaleString()} message${list.length === 1 ? "" : "s"}`);
    };

    const move = (dir: 1 | -1) => {
        if (!filtered.length) return;
        const i = selectedId ? filtered.findIndex(e => e.id === selectedId) : -1;
        const next = filtered[Math.max(0, Math.min(filtered.length - 1, i + dir))];
        setSelectedId(next.id);
        requestAnimationFrame(() => bodyRef.current?.querySelector(`[data-mlx-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" }));
    };

    const onKey = (ev: React.KeyboardEvent) => {
        if (lightbox) return;
        const t = ev.target as HTMLElement;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") {
            if (ev.key === "Escape" && t === searchRef.current && typed) { setTyped(""); ev.stopPropagation(); }
            return;
        }
        if (ev.key === "/") { ev.preventDefault(); searchRef.current?.focus(); }
        else if (view === "messages" && (ev.key === "j" || ev.key === "ArrowDown")) { ev.preventDefault(); move(1); }
        else if (view === "messages" && (ev.key === "k" || ev.key === "ArrowUp")) { ev.preventDefault(); move(-1); }
        else if (ev.key === "Delete" && selected) remove([selected]);
        else if (ev.key === "Escape" && (selected || exportOpen)) { ev.stopPropagation(); setSelectedId(null); setExportOpen(false); }
    };

    const title = scopeTitle(scope, index);
    const total = index?.entries.length ?? 0;

    return (
        <Window {...modalProps} size="xxl" title="Message Logs" subtitle="Deleted and edited messages, ghost pings and the pictures in them — saved on this computer">
            <BackendProvider value={backend}>
                <div className={classes("vc-tool-wrap", cl("root"), selected && cl("root-detail"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined} onKeyDown={onKey} tabIndex={-1}>
                    {index && <Side index={index} scope={scope} onScope={setScope} total={total} />}

                    <main className={cl("main")}>
                        {!records && !failed && <div className={classes("vc-tool-empty", cl("center"))}><span className="vc-tool-empty-icon">⏳</span>Opening your logs…</div>}
                        {failed && <div className={classes("vc-tool-empty", cl("center"))}><span className="vc-tool-empty-icon">⚠️</span>Couldn't open the logs: {failed}<button type="button" className="vc-tool-btn" onClick={load}>Try again</button></div>}
                        {index && total === 0 && (
                            <div className={classes("vc-tool-empty", cl("center"))}>
                                <span className="vc-tool-empty-icon">📭</span>
                                <b>Nothing logged yet</b>
                                Deleted and edited messages, and pings that vanish, will show up here as they happen.
                                {backend.importOld && <><span className="vc-tool-hint">Used an older version? Bring its logs in — nothing here gets overwritten.</span><button type="button" className="vc-tool-btn" onClick={() => backend.importOld!().then(load)}>Import old logs</button></>}
                            </div>
                        )}

                        {index && total > 0 && (
                            <>
                                <div className={cl("top")}>
                                    <div className={cl("crumb")}>
                                        {title.icon}
                                        <div className={cl("crumb-text")}>
                                            <b>{title.name}</b>
                                            <span>{scoped.length.toLocaleString()} logged{title.sub ? ` · ${title.sub}` : ""}</span>
                                        </div>
                                        {scope.kind !== "all" && <button type="button" className="vc-tool-icon" title="Back to everywhere" onClick={() => setScope({ kind: "all" })}>✕</button>}
                                    </div>
                                    {fresh > 0 && <button type="button" className={cl("fresh")} onClick={load}><i />{fresh} new · refresh</button>}
                                    <div className={classes("vc-tool-tabs", cl("views"))}>
                                        {([["overview", "📊 Overview"], ["messages", "💬 Messages"], ["media", "🖼️ Media"], ["people", "👥 People"]] as const).map(([v, label]) => (
                                            <button key={v} type="button" className={classes("vc-tool-tab", view === v && "vc-tool-tab-on")} onClick={() => setView(v)}>{label}</button>
                                        ))}
                                    </div>
                                </div>

                                <div className={cl("filters")}>
                                    <div className={cl("search")}>
                                        <span>🔎</span>
                                        <input ref={searchRef} value={typed} onChange={e => setTyped(e.currentTarget.value)} placeholder="Search words, names, files… or from:sam  in:general  has:image  before:2026-10-01  -is:edited" />
                                        {typed && <button type="button" className="vc-tool-icon" onClick={() => setTyped("")} title="Clear">✕</button>}
                                    </div>
                                    <div className="vc-tool-seg">
                                        {([["all", "All"], ["deleted", "🗑️ Deleted"], ["edited", "✏️ Edited"], ["ghost", "👻 Ghost pings"]] as [TypeFilter, string][]).map(([k, label]) => (
                                            <button key={k} type="button" className={classes("vc-tool-seg-btn", filters.type === k && "vc-tool-seg-on")} onClick={() => setFilter("type", k)}>{label} <small>{typeCounts[k].toLocaleString()}</small></button>
                                        ))}
                                    </div>
                                </div>
                                <div className={cl("filters2")}>
                                    <div className="vc-tool-chips">
                                        {([["all", "Any time"], ["day", "24 hours"], ["week", "7 days"], ["month", "30 days"]] as [Period, string][]).map(([k, label]) => (
                                            <button key={k} type="button" className={classes("vc-tool-chip", filters.period === k && "vc-tool-chip-on")} onClick={() => setFilter("period", k)}>{label}</button>
                                        ))}
                                        <span className={cl("sep")} />
                                        {([["star", "★ Starred"], ["media", "🖼️ Pictures"], ["file", "📎 Files"], ["link", "🔗 Links"], ["reply", "↪ Replies"], ["me", "@ Mentions me"], ["quick", "⚡ Gone in a minute"]] as [HasFilter, string][]).map(([k, label]) => (
                                            <button key={k} type="button" className={classes("vc-tool-chip", filters.has.includes(k) && "vc-tool-chip-on")} onClick={() => toggleHas(k)}>{label}</button>
                                        ))}
                                        {anyFilter && <button type="button" className="vc-tool-link" onClick={clearFilters}>Clear filters</button>}
                                    </div>
                                    <span className="vc-tool-spacer" />
                                    <button type="button" className="vc-tool-icon" title="Change the order" onClick={() => { setNewest(n => { savePrefs({ newest: !n }); return !n; }); }}>{newest ? "↓ Newest" : "↑ Oldest"}</button>
                                    {view === "messages" && backend.discordView && (
                                        <button type="button" className="vc-tool-icon" title="Switch between cards and Discord's own look" onClick={() => setLook(l => { const n = l === "cards" ? "discord" : "cards"; savePrefs({ look: n }); return n; })}>{look === "cards" ? "🗂️ Cards" : "💬 Discord"}</button>
                                    )}
                                    {view === "messages" && <button type="button" className={classes("vc-tool-icon", picking && cl("icon-on"))} title="Pick several to export or delete" onClick={() => { setPicking(p => !p); setPicked(new Set()); }}>☑ Select</button>}
                                    <div className={cl("pop-wrap")}>
                                        <button type="button" className="vc-tool-icon" title="Save these logs as a file" onClick={() => setExportOpen(o => !o)}>⤓ Export</button>
                                        {exportOpen && (
                                            <div className={cl("pop")}>
                                                <span className="vc-tool-label">{picking && picked.size ? `${picked.size} selected` : `${filtered.length.toLocaleString()} shown`}</span>
                                                <button type="button" onClick={() => void doPicture()}>🖼️ Picture<small>Looks like the chat (up to {MAX_PICTURE})</small></button>
                                                <button type="button" onClick={() => doExport("txt")}>📝 Text<small>Easy to read</small></button>
                                                <button type="button" onClick={() => doExport("csv")}>📊 Spreadsheet<small>Opens in Excel or Sheets</small></button>
                                                <button type="button" onClick={() => doExport("json")}>🧩 JSON<small>Everything that was logged</small></button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {picking && (
                                    <div className={cl("bulk")}>
                                        <b>{picked.size.toLocaleString()} selected</b>
                                        <button type="button" className="vc-tool-link" onClick={() => setPicked(new Set(filtered.map(e => e.id)))}>Select all {filtered.length.toLocaleString()}</button>
                                        {picked.size > 0 && <button type="button" className="vc-tool-link" onClick={() => setPicked(new Set())}>Clear</button>}
                                        <span className="vc-tool-hint">Shift-click to pick a range</span>
                                        <span className="vc-tool-spacer" />
                                        <button type="button" className="vc-tool-btn vc-tool-danger" disabled={!picked.size} onClick={() => remove(pickedEntries())}>Delete logs</button>
                                        <button type="button" className="vc-tool-btn" onClick={() => { setPicking(false); setPicked(new Set()); }}>Done</button>
                                    </div>
                                )}

                                <div className={cl("body")} ref={bodyRef}>
                                    {!filtered.length ? (
                                        <div className="vc-tool-empty">
                                            <span className="vc-tool-empty-icon">🔍</span>
                                            Nothing here matches{anyFilter ? " these filters" : ""}.
                                            {anyFilter && <button type="button" className="vc-tool-btn" onClick={clearFilters}>Clear filters</button>}
                                            {scope.kind !== "all" && <button type="button" className="vc-tool-link" onClick={() => setScope({ kind: "all" })}>Look everywhere instead</button>}
                                        </div>
                                    ) : view === "overview" ? (
                                        <OverviewView list={filtered} onScope={setScope} onOpen={openEntry} onQuery={q => { setTyped(q); setFilters(f => ({ ...f, query: q })); setView("messages"); }} />
                                    ) : view === "media" ? (
                                        <GalleryView list={filtered} openMedia={(items, i) => setLightbox({ items, index: i })} onShowMessage={openEntry} />
                                    ) : view === "people" ? (
                                        <PeopleView list={filtered} onScope={s => { setScope(s); setView("messages"); }} />
                                    ) : (
                                        <MessagesView list={filtered} selectedId={selectedId} onSelect={e => setSelectedId(id => id === e.id ? null : e.id)} picking={picking} picked={picked} onPick={pick}
                                            onScope={setScope} openMedia={(items, i) => setLightbox({ items, index: i })} look={look} onStar={e => changeMeta(e, { star: !e.star })} />
                                    )}
                                </div>

                                <div className={cl("foot")}>
                                    <span className="vc-tool-hint">{filtered.length.toLocaleString()} of {total.toLocaleString()} logs · <kbd>/</kbd> search · <kbd>J</kbd> <kbd>K</kbd> move · <kbd>Del</kbd> delete log</span>
                                    <span className="vc-tool-spacer" />
                                    <button type="button" className="vc-tool-btn" onClick={() => setStorageOpen(true)}>🧹 Storage &amp; cleanup</button>
                                    <button type="button" className="vc-tool-btn" onClick={load} title="Load the newest logs">↻ Refresh</button>
                                    <button type="button" className="vc-tool-btn vc-tool-danger" onClick={clearAll}>Clear all logs</button>
                                </div>
                            </>
                        )}
                    </main>

                    {selected && index && (
                        <Detail e={selected} index={index} onClose={() => setSelectedId(null)} onScope={s => { setScope(s); setSelectedId(null); }}
                            openMedia={(items, i) => setLightbox({ items, index: i })} onRemove={remove} onMeta={changeMeta} />
                    )}

                    {storageOpen && index && <StoragePanel index={index} onClose={() => setStorageOpen(false)} onCleaned={load} onClearAll={clearAll} />}

                    {lightbox && (
                        <Lightbox items={lightbox.items} index={lightbox.index} onIndex={i => setLightbox(l => l && { ...l, index: i })} onClose={() => setLightbox(null)}
                            onShowMessage={e => { setLightbox(null); openEntry(e); }} />
                    )}
                </div>
            </BackendProvider>
        </Window>
    );
}

/* ── Storage & cleanup ── */

const DAY_CHOICES: [number, string][] = [[0, "Never"], [7, "7 days"], [14, "2 weeks"], [30, "30 days"], [90, "3 months"], [180, "6 months"], [365, "1 year"]];

function StoragePanel({ index, onClose, onCleaned, onClearAll }: { index: LogIndex; onClose(): void; onCleaned(): void; onClearAll(): void; }) {
    const backend = useBackend();
    const [days, setDays] = useState(backend.cleanupDays());
    const [usage, setUsage] = useState<number | null>(null);
    const [ignored, setIgnoredList] = useState(backend.ignored());
    const [watched, setWatchedList] = useState(() => backend.watched?.() ?? []);
    const [busy, setBusy] = useState(false);
    useEffect(() => { backend.storage?.().then(s => setUsage(s?.usage ?? null)).catch(() => { }); }, []);

    const files = index.entries.reduce((a, e) => a + e.media.filter(m => m.saved).length + e.files.filter(m => m.saved).length, 0);
    const starred = index.entries.filter(e => e.star).length;
    const wouldGo = (d: number) => d ? index.entries.filter(e => !e.star && e.sent < Date.now() - d * 86400_000).length : 0;
    const oldest = index.entries.reduce((a, e) => Math.min(a, e.sent), Date.now());

    return (
        <div className={cl("overlay")} onClick={onClose}>
            <div className={cl("panel")} onClick={ev => ev.stopPropagation()}>
                <div className="vc-tool-head">
                    <b className={cl("panel-title")}>🧹 Storage &amp; cleanup</b>
                    <button type="button" className="vc-tool-icon" onClick={onClose}>✕</button>
                </div>
                <div className="vc-tool-stats">
                    <div className="vc-tool-stat vc-tool-stat-accent"><span>Space used</span><b>{usage == null ? "…" : fmtBytes(usage) || "0 B"}</b></div>
                    <div className="vc-tool-stat"><span>Logs</span><b>{index.entries.length.toLocaleString()}</b></div>
                    <div className="vc-tool-stat"><span>Saved files</span><b>{files.toLocaleString()}</b></div>
                    <div className="vc-tool-stat"><span>★ Starred</span><b>{starred.toLocaleString()}</b></div>
                </div>
                <span className="vc-tool-hint">Oldest log: {index.entries.length ? fmtWhen(oldest) : "–"}. Starred logs are never deleted by any cleanup.</span>

                <section className="vc-tool-section">
                    <span className="vc-tool-label">Delete logs older than</span>
                    <div className="vc-tool-chips">
                        {DAY_CHOICES.map(([d, label]) => (
                            <button key={d} type="button" className={classes("vc-tool-chip", days === d && "vc-tool-chip-on")} onClick={() => { setDays(d); backend.setCleanupDays(d); }}>{label}</button>
                        ))}
                    </div>
                    <span className="vc-tool-hint">{days ? `Runs on its own every few hours. Right now that would remove ${wouldGo(days).toLocaleString()} log${wouldGo(days) === 1 ? "" : "s"}.` : "Logs are kept until you delete them."}</span>
                    <div className="vc-tool-footer">
                        <span className="vc-tool-spacer" />
                        <button type="button" className="vc-tool-btn" disabled={!days || busy || !wouldGo(days)} onClick={async () => {
                            setBusy(true);
                            const n = await backend.cleanupNow(days).catch(() => 0);
                            setBusy(false);
                            backend.toast(n ? `Deleted ${n.toLocaleString()} old log${n === 1 ? "" : "s"}` : "Nothing old enough to delete");
                            onCleaned();
                        }}>{busy ? "Cleaning…" : "Clean up now"}</button>
                        <button type="button" className="vc-tool-btn vc-tool-danger" onClick={onClearAll}>Clear all logs</button>
                    </div>
                </section>

                {backend.setWatched && (
                    <section className="vc-tool-section">
                        <span className="vc-tool-label">Watching · {watched.length}</span>
                        {!watched.length ? <span className="vc-tool-hint">Watch someone (👁 in People, or right-click them → Message Logger) to be told the moment they delete or edit a message. Their messages are always logged.</span> : (
                            <div className={classes("vc-tool-list", cl("ignored"))}>
                                {watched.map(id => {
                                    const d = backend.describe(id);
                                    return (
                                        <div key={id} className="vc-tool-item">
                                            {d.icon ? <Avatar src={d.icon} size={26} /> : <span className={cl("node-icon")}>👤</span>}
                                            <span className="vc-tool-item-main"><span className="vc-tool-item-title">{d.name}</span><span className="vc-tool-item-sub">{id}</span></span>
                                            <button type="button" className="vc-tool-btn" onClick={() => { backend.setWatched!(id, false); setWatchedList(backend.watched?.() ?? []); }}>Stop watching</button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>
                )}

                <section className="vc-tool-section">
                    <span className="vc-tool-label">Not logged · {ignored.length}</span>
                    {!ignored.length ? <span className="vc-tool-hint">Everyone is logged. Open a log and choose "Stop logging" to leave out a person, channel or server.</span> : (
                        <div className={classes("vc-tool-list", cl("ignored"))}>
                            {ignored.map(id => {
                                const d = backend.describe(id);
                                return (
                                    <div key={id} className="vc-tool-item">
                                        {d.icon ? <Avatar src={d.icon} size={26} /> : <span className={cl("node-icon")}>{d.kind === "Server" ? "🏠" : d.kind === "Channel" ? "#" : "👤"}</span>}
                                        <span className="vc-tool-item-main"><span className="vc-tool-item-title">{d.name}</span><span className="vc-tool-item-sub">{d.kind} · {id}</span></span>
                                        <button type="button" className="vc-tool-btn" onClick={() => { backend.setIgnored(id, false); setIgnoredList(backend.ignored()); }}>Log again</button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}

/* ── The list down the side: everywhere, DMs, servers › categories › channels ── */

function Side({ index, scope, onScope, total }: { index: LogIndex; scope: Scope; onScope(s: Scope): void; total: number; }) {
    const [find, setFind] = useState("");
    const [open, setOpen] = useState<Set<string>>(() => new Set(["dms"]));
    const [allDms, setAllDms] = useState(false);
    const q = find.trim().toLowerCase();
    const toggle = (id: string) => setOpen(o => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const isOpen = (id: string) => !!q || open.has(id);
    const is = (s: Scope) => sameScope(s, scope);

    // Open the server you're looking at.
    useEffect(() => {
        const g = scope.kind === "guild" ? scope.id : scope.kind === "category" ? scope.guildId : scope.kind === "channel" ? index.entries.find(e => e.channelId === scope.id)?.place.guildId : null;
        if (g) setOpen(o => o.has(g) ? o : new Set([...o, g]));
    }, [scope]);

    const dms = q ? index.dms.filter(d => d.name.toLowerCase().includes(q)) : index.dms;
    const dmTotal = index.dms.reduce((a, d) => a + d.count, 0);
    const guilds = !q ? index.guilds : index.guilds.flatMap(g => {
        if (g.name.toLowerCase().includes(q)) return [g];
        const categories = g.categories.map(c => c.name.toLowerCase().includes(q) ? c : { ...c, channels: c.channels.filter(ch => ch.name.toLowerCase().includes(q)) }).filter(c => c.channels.length);
        return categories.length ? [{ ...g, categories }] : [];
    });

    return (
        <aside className={cl("side")}>
            <input className={classes("vc-tool-input", cl("side-find"))} value={find} onChange={e => setFind(e.currentTarget.value)} placeholder="Find a server, channel or DM" />
            <div className={cl("side-scroll")}>
                <button type="button" className={classes(cl("node"), is({ kind: "all" }) && cl("node-on"))} onClick={() => onScope({ kind: "all" })}>
                    <span className={cl("node-icon")}>🌐</span><span className={cl("node-name")}>Everywhere</span><i>{total.toLocaleString()}</i>
                </button>

                {index.dms.length > 0 && (dms.length > 0 || !q) && (
                    <>
                        <div className={cl("side-head")}>
                            <button type="button" className={cl("caret")} onClick={() => toggle("dms")}>{isOpen("dms") ? "▾" : "▸"}</button>
                            <button type="button" className={classes(cl("side-label"), is({ kind: "dms" }) && cl("side-label-on"))} onClick={() => onScope({ kind: "dms" })}>Direct messages</button>
                            <i>{dmTotal.toLocaleString()}</i>
                        </div>
                        {isOpen("dms") && (allDms || q ? dms : dms.slice(0, 8)).map(d => (
                            <button key={d.id} type="button" className={classes(cl("node"), cl("node-dm"), is({ kind: "channel", id: d.id }) && cl("node-on"))} onClick={() => onScope({ kind: "channel", id: d.id })} title={d.name}>
                                {d.group ? <span className={cl("node-icon")}>👥</span> : <Avatar src={d.avatar} size={22} />}
                                <span className={cl("node-name")}>{d.name}</span><i>{d.count}</i>
                            </button>
                        ))}
                        {isOpen("dms") && !q && dms.length > 8 && <button type="button" className={cl("side-more")} onClick={() => setAllDms(a => !a)}>{allDms ? "Show fewer" : `Show all ${dms.length}`}</button>}
                    </>
                )}

                {guilds.length > 0 && <div className={cl("side-head")}><span className={cl("side-label")} style={{ cursor: "default" }}>Servers</span><i>{index.guilds.length}</i></div>}
                {guilds.map(g => (
                    <div key={g.id} className={cl("guild")}>
                        <div className={classes(cl("node"), cl("node-guild"), is({ kind: "guild", id: g.id }) && cl("node-on"))}>
                            <button type="button" className={cl("caret")} onClick={() => toggle(g.id)}>{isOpen(g.id) ? "▾" : "▸"}</button>
                            <button type="button" className={cl("node-btn")} onClick={() => { onScope({ kind: "guild", id: g.id }); if (!open.has(g.id)) toggle(g.id); }} title={g.name}>
                                <GuildIcon name={g.name} icon={g.icon} size={22} />
                                <span className={cl("node-name")}>{g.name}</span><i>{g.count.toLocaleString()}</i>
                            </button>
                        </div>
                        {isOpen(g.id) && g.categories.map(c => (
                            <div key={c.id || "none"} className={cl("cat")}>
                                <button type="button" className={classes(cl("cat-name"), is({ kind: "category", guildId: g.id, id: c.id }) && cl("cat-on"))} onClick={() => onScope({ kind: "category", guildId: g.id, id: c.id })}>
                                    <span>{c.name}</span><i>{c.count}</i>
                                </button>
                                {c.channels.map(ch => (
                                    <button key={ch.id} type="button" className={classes(cl("node"), cl("node-ch"), is({ kind: "channel", id: ch.id }) && cl("node-on"))} onClick={() => onScope({ kind: "channel", id: ch.id })} title={ch.parentName ? `${ch.name} in #${ch.parentName}` : ch.name}>
                                        <span className={cl("hash")}>{ch.kind === "thread" ? "🧵" : ch.kind === "voice" ? "🔊" : ch.kind === "forum" ? "💬" : ch.kind === "announce" ? "📢" : "#"}</span>
                                        <span className={cl("node-name")}>{ch.name}</span><i>{ch.count}</i>
                                    </button>
                                ))}
                            </div>
                        ))}
                    </div>
                ))}
                {q && !dms.length && !guilds.length && <span className={classes("vc-tool-hint", cl("side-none"))}>No server, channel or DM called “{find}”.</span>}
            </div>
        </aside>
    );
}

function scopeTitle(s: Scope, index: LogIndex | null): { name: string; sub?: string; icon: React.ReactNode; } {
    const icon = (t: string) => <span className={cl("crumb-icon")}>{t}</span>;
    if (!index) return { name: "Everywhere", icon: icon("🌐") };
    switch (s.kind) {
        case "all": return { name: "Everywhere", sub: `${index.guilds.length} servers, ${index.dms.length} DMs`, icon: icon("🌐") };
        case "dms": return { name: "Direct messages", sub: `${index.dms.length} conversations`, icon: icon("✉️") };
        case "guild": {
            const g = index.guilds.find(x => x.id === s.id);
            return { name: g?.name ?? "Server", sub: g ? `${g.categories.reduce((a, c) => a + c.channels.length, 0)} channels` : undefined, icon: <GuildIcon name={g?.name ?? "?"} icon={g?.icon ?? null} size={34} /> };
        }
        case "category": {
            const g = index.guilds.find(x => x.id === s.guildId);
            const c = g?.categories.find(x => x.id === s.id);
            return { name: c?.name ?? "Category", sub: g?.name, icon: icon("📁") };
        }
        case "channel": {
            const e = index.entries.find(x => x.channelId === s.id);
            if (!e) return { name: "Channel", icon: icon("#") };
            const p = e.place;
            if (!p.guildId) return { name: p.kind === "group" ? p.channelName : `DM with ${p.channelName}`, icon: p.dmUser ? <Avatar src={p.dmUser.avatar} size={34} /> : icon(p.kind === "group" ? "👥" : "✉️") };
            return { name: `${p.kind === "thread" ? "🧵 " : "#"}${p.channelName}`, sub: whereText(p).split(" › ")[0] + (p.categoryName ? ` › ${p.categoryName}` : ""), icon: icon("#") };
        }
        case "person": {
            const p = index.people.get(s.id);
            return { name: p ? `${p.name}` : "Someone", sub: p ? `@${p.username} · ${p.deleted} deleted, ${p.edited} edited` : undefined, icon: p ? <Avatar src={p.avatar} size={34} /> : icon("👤") };
        }
    }
}

function scopeSlug(s: Scope, index: LogIndex | null): string {
    const t = scopeTitle(s, index).name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return t || "all";
}
