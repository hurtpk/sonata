/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// "Disk space & memory" in Sonata's Performance section: what Discord keeps
// on disk (with a clean button), how much memory it's using, automatic
// cleaning, a history, and what Sonata's own features have saved.

import { copyWithToast } from "@utils/discord";
import { classes } from "@utils/misc";
import { React, showToast, useEffect, useState } from "@webpack/common";

import { CacheKinds, CacheSizes, cleanNow, clipsDir, deepMemory, DeepProcess, formatBytes, getLeftovers, getMemory, getOldVersions, getSizes, hasNative, history, KINDS, MemoryInfo, needsRestart, OldVersion, openFolder, Parts, StoredThing, storedThings, totalFreed, totalOf } from "./cache";
import { Breakdown, breakdown, growthPerHour, memorySamples, Sample } from "./memoryWatch";

const LIMITS = [256, 512, 1024, 2048, 4096];
const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

function Graph({ samples }: { samples: Sample[]; }) {
    if (samples.length < 2) return null;
    const w = 260, h = 44;
    const max = Math.max(...samples.map(s => s.window)) * 1.08 || 1;
    const t0 = samples[0].at, span = samples[samples.length - 1].at - t0 || 1;
    const line = (key: "window" | "js") => samples.map(s => `${((s.at - t0) / span * w).toFixed(1)},${(h - s[key] / max * h).toFixed(1)}`).join(" ");
    return (
        <svg className="sonata-cache-graph" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-label="Memory over time">
            <polyline points={line("window")} className="sonata-cache-graph-window" />
            <polyline points={line("js")} className="sonata-cache-graph-js" />
        </svg>
    );
}

/** Chromium's names for the parts of its memory, in words — and what helps when that part is big. */
const DEEP_LABELS: Record<string, [string, string]> = {
    v8: ["JavaScript", "Discord's and plugins' code and data."],
    blink_gc: ["Page objects", "The chat, lists and windows as the page knows them. Grows with long scrolled-back chats and many open panels."],
    partition_alloc: ["Page data", "Layout, text and styles of everything on the page. Themes and very long chats make it bigger."],
    malloc: ["Browser engine", "Chromium's general memory. Goes up with everything else."],
    cc: ["Drawn layers", "Pictures of the page Chromium keeps ready to show — animated things, blur and big scrolling areas add layers."],
    gpu: ["Graphics buffers", "Memory handed to the graphics card for drawing. Blur, animated backgrounds and video use a lot."],
    skia: ["Drawing caches", "Fonts, shapes and images already drawn, kept to redraw faster."],
    discardable: ["Decoded images", "Pictures, GIFs and emoji unpacked to show them. Freed when memory runs low."],
    web_cache: ["Kept downloads", "Images and files Discord keeps in memory after downloading."],
    font_caches: ["Fonts", "Every font in use (Sonata's designs and themes add some)."],
    shared_memory: ["Shared buffers", "Memory shared between Discord's processes (drawing, video)."],
    media: ["Video & audio", "Players, streams and voice."],
    sqlite: ["Storage", "Discord's local databases."],
    leveldatabase: ["Storage", "Discord's local databases."],
    mojo: ["Messages between processes", ""],
    java_heap: ["", ""],
};

// Kept outside the card, so a check that finishes after you've closed Sonata is still here when you come back.
let lastDeep: { at: number; result: DeepProcess[] | string; } | null = null;
let deepWaiting = false;

async function runDeep() {
    try { lastDeep = { at: Date.now(), result: await deepMemory() }; } catch (e) { lastDeep = { at: Date.now(), result: e instanceof Error ? e.message : String(e) }; }
}

function DeepCheck() {
    const [, bump] = useState(0);
    const [busy, setBusy] = useState(false);
    const state = busy ? "busy" : lastDeep?.result ?? "idle";
    const run = async () => {
        setBusy(true);
        await runDeep();
        setBusy(false);
    };
    /** Waits so you can close Sonata first — its animated page would otherwise be measured too. */
    const later = () => {
        deepWaiting = true;
        bump(n => n + 1);
        showToast("Close Sonata now — the memory check runs in 15 seconds", "message");
        setTimeout(async () => {
            await runDeep();
            deepWaiting = false;
            showToast("Memory check done — open Sonata → Performance to see it", "success");
        }, 15_000);
    };
    return (
        <div className="sonata-cache-deep">
            <div className="sonata-cache-row-head">
                <span className="sonata-perf-title">Deep memory check</span>
                <div className="sonata-field-actions">
                    <button type="button" className="sonata-btn sonata-btn-light" disabled={busy || deepWaiting} onClick={later}>{deepWaiting ? "Waiting — close Sonata…" : "Check in 15 s (close Sonata)"}</button>
                    <button type="button" className="sonata-btn" disabled={busy || deepWaiting} onClick={() => void run()}>{busy ? "Checking… (5 s)" : "Check now"}</button>
                </div>
            </div>
            <span className="sonata-field-hint">Asks Chromium (the engine Discord is built on) exactly what each part of Discord is holding. For a fair reading use "Check in 15 s" and close Sonata — this page's animated background is heavy on its own.</span>
            {lastDeep && <span className="sonata-field-hint">Checked {new Date(lastDeep.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.</span>}
            {typeof state === "string" && state !== "idle" && state !== "busy" && <span className="sonata-field-hint">Couldn't check: {state}</span>}
            {Array.isArray(state) && state.filter(p => p.kind === "Window" || p.kind === "Graphics" || p.total > 150).map(p => (
                <div key={p.pid} className="sonata-cache-deep-proc">
                    <span className="sonata-cache-deep-title">{p.kind} · {p.total} MB</span>
                    {p.parts.filter(x => x.mb >= 5).slice(0, 8).map(x => {
                        const [label, why] = DEEP_LABELS[x.name] ?? [x.name, ""];
                        return (
                            <div key={x.name} className="sonata-cache-deep-row" title={why}>
                                <span>{label || x.name}</span>
                                <span className="sonata-cache-bar"><div style={{ width: `${x.mb / Math.max(1, p.parts[0].mb) * 100}%` }} /></span>
                                <b>{x.mb} MB</b>
                            </div>
                        );
                    })}
                </div>
            ))}
            {Array.isArray(state) && (
                <>
                    {state.filter(p => p.kind === "Window").map(p => {
                        // The biggest groups inside "Page objects", one level down.
                        const inner = p.all.filter(x => x.name.startsWith("blink_gc/") && x.name.split("/").length >= 4 && !x.name.includes("/freelist") && !x.name.includes("/pages"))
                            .sort((a, b) => b.mb - a.mb).slice(0, 8);
                        return inner.length ? (
                            <div key={`${p.pid}-gc`} className="sonata-cache-deep-proc">
                                <span className="sonata-cache-deep-title">Inside "Page objects"</span>
                                {inner.map(x => (
                                    <div key={x.name} className="sonata-cache-deep-row" title={x.name}>
                                        <span>{x.name.split("/").slice(3).join(" / ")}</span>
                                        <span className="sonata-cache-bar"><div style={{ width: `${x.mb / Math.max(1, inner[0].mb) * 100}%` }} /></span>
                                        <b>{x.mb} MB</b>
                                    </div>
                                ))}
                            </div>
                        ) : null;
                    })}
                    <div className="sonata-field-actions">
                        <span className="sonata-field-hint">Hover a row to see what it is.</span>
                        <button type="button" className="sonata-btn" onClick={() => {
                            const text = state.map(p => [`## ${p.kind} (${p.total} MB)`, ...p.all.filter(x => x.mb >= 2 && !x.name.startsWith("global") && !/mailbox_|resource_\d|buffer_\d|\/element_/.test(x.name)).map(x => `${x.name}: ${x.mb} MB`)].join("\n")).join("\n\n");
                            copyWithToast(text, "Memory details copied — paste them to Claude");
                        }}>Copy details</button>
                    </div>
                </>
            )}
        </div>
    );
}

function Memory() {
    const [mem, setMem] = useState<MemoryInfo | null>(null);
    const [b, setB] = useState<Breakdown | null>(null);
    useEffect(() => {
        let alive = true;
        const read = () => {
            void getMemory().then(m => alive && setMem(m)).catch(() => { });
            setB(breakdown());
        };
        read();
        const t = setInterval(read, 5000);
        return () => { alive = false; clearInterval(t); };
    }, []);
    if (!mem) return null;
    // This window only (Discord itself) — DevTools and other windows are listed separately.
    const others = (mem.windows ?? []).filter(w => !w.isThis);
    const win = (mem.windows ?? []).find(w => w.isThis)?.mb ?? mem.parts.find(p => p.kind === "Window")?.mb ?? 0;
    const growth = growthPerHour();
    const samples = memorySamples();
    const minutes = samples.length > 1 ? Math.round((samples[samples.length - 1].at - samples[0].at) / 60000) : 0;
    // What's left of the window after JavaScript and pictures: Discord's page itself, fonts, and the browser's own workings.
    const rest = b ? Math.max(0, win - b.jsReserved - b.imageMb - b.canvasMb) : 0;
    return (
        <div className="sonata-cache-memory">
            <div>
                <span className="sonata-cache-big">{mem.total >= 1024 ? `${(mem.total / 1024).toFixed(2)} GB` : `${mem.total} MB`}</span>
                <span className="sonata-field-hint"> {mem.private ? "used only by Discord right now" : "of memory in use by Discord right now"}</span>
                {mem.private && mem.sharedTotal > mem.total && <span className="sonata-field-hint" title="Also counting memory shared with Windows and other programs (fonts, system libraries) — what some tools show"> · {(mem.sharedTotal / 1024).toFixed(2)} GB counting shared memory</span>}
            </div>
            <div className="sonata-cache-parts">
                {mem.parts.map(p => <span key={p.kind} className="sonata-cache-part"><b>{p.mb} MB</b> {p.kind}</span>)}
            </div>
            {others.length > 0 && (
                <div className="sonata-cache-windows">
                    <span className="sonata-perf-title">{others.length + 1} window processes are open</span>
                    <div className="sonata-cache-parts">
                        <span className="sonata-cache-part"><b>{win} MB</b> Discord (this one)</span>
                        {others.map(w => <span key={w.pid} className={classes("sonata-cache-part", w.label.includes("DevTools") && "sonata-cache-part-warn")}><b>{w.mb} MB</b> {w.label}</span>)}
                    </div>
                    {others.some(w => w.label.includes("DevTools")) && <span className="sonata-field-hint"><b>DevTools is open</b> — it holds a lot of memory (especially with a memory snapshot loaded). Close it with Ctrl+Shift+I or its ✕ to free that.</span>}
                </div>
            )}
            {b && (
                <>
                    <span className="sonata-perf-title">Inside Discord's window ({win} MB)</span>
                    <div className="sonata-cache-parts">
                        <span className="sonata-cache-part" title="Memory used by Discord's and plugins' code and data"><b>{b.js} MB</b> JavaScript ({b.jsReserved} MB reserved)</span>
                        <span className="sonata-cache-part" title="The pictures on the page right now, decoded"><b>~{b.imageMb} MB</b> {b.images} pictures{b.gifs ? ` (${b.gifs} animated)` : ""}</span>
                        <span className="sonata-cache-part"><b>~{b.canvasMb} MB</b> {b.canvases} canvases</span>
                        <span className="sonata-cache-part"><b>{b.elements.toLocaleString()}</b> page elements</span>
                        {b.videos > 0 && <span className="sonata-cache-part"><b>{b.videos}</b> videos</span>}
                        <span className="sonata-cache-part" title="Discord's page, fonts and the browser engine"><b>~{rest} MB</b> page & browser</span>
                    </div>
                </>
            )}
            <div className="sonata-cache-trend">
                <Graph samples={samples} />
                <span className="sonata-field-hint">
                    {growth == null
                        ? "Measuring how it changes — a reading every minute. Check back in a few minutes."
                        : `Last ${minutes} min: window ${growth >= 0 ? "+" : ""}${growth} MB/hour${growth > 150 ? " — still climbing; something is holding on to memory." : growth > 40 ? " — creeping up slowly." : " — steady. 👍"}`}
                    <span className="sonata-cache-legend"><i className="w" /> window <i className="j" /> JavaScript</span>
                </span>
            </div>
            <div className="sonata-field-hint">Measured only — memory can't be safely freed from outside Discord. Restarting Discord (tray → Quit) clears it.</div>
            <DeepCheck />
        </div>
    );
}

function SonataStorage() {
    const [things, setThings] = useState<StoredThing[] | null>(null);
    const [confirm, setConfirm] = useState<string | null>(null);
    const measure = () => void storedThings().then(setThings);
    const clear = async (t: StoredThing) => {
        if (confirm !== t.key) { setConfirm(t.key); setTimeout(() => setConfirm(c => c === t.key ? null : c), 3500); return; }
        await t.clear();
        setConfirm(null);
        showToast(`Cleared ${t.label}`, "success");
        measure();
    };
    return (
        <div className="sonata-cache-storage">
            <div className="sonata-cache-row-head">
                <span className="sonata-perf-title">What Sonata has saved</span>
                <button type="button" className="sonata-btn" onClick={measure}>{things ? "Measure again" : "Measure"}</button>
            </div>
            <span className="sonata-field-hint">Things Sonata's features remember — recent GIFs, logged messages, stickies and so on. Clearing one only affects that feature.</span>
            {things && !things.length && <span className="sonata-field-hint">Nothing saved yet.</span>}
            {things?.map(t => (
                <div key={t.key} className="sonata-cache-thing">
                    <span className="sonata-cache-thing-name">{t.label}</span>
                    <span className="sonata-cache-thing-size">{t.bytes ? formatBytes(t.bytes) : ""}{t.count != null ? `${t.bytes ? " · " : ""}${t.count} item${t.count === 1 ? "" : "s"}` : ""}</span>
                    <button type="button" className={classes("sonata-btn", confirm === t.key && "sonata-btn-danger")} onClick={() => void clear(t)}>{confirm === t.key ? "Click again to clear" : "Clear"}</button>
                </div>
            ))}
        </div>
    );
}

export function CacheCard({ store }: { store: any; }) {
    const [sizes, setSizes] = useState<CacheSizes | null>(null);
    const [old, setOld] = useState<{ current: string | null; old: OldVersion[]; } | null>(null);
    const [selected, setSelected] = useState<CacheKinds>(() => Object.fromEntries(KINDS.map(k => [k.id, true])));
    const [parts, setParts] = useState<Parts>({ previews: true, updates: true, clips: false });
    const [left, setLeft] = useState<{ previews: number; updates: number; clips: number; clipCount: number; updatePending: boolean; } | null>(null);
    const [busy, setBusy] = useState(false);
    const [freed, setFreed] = useState<number | null>(null);
    const [showVersions, setShowVersions] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const native = hasNative();

    const refresh = () => {
        if (!native) return;
        void getSizes().then(s => setSizes({ http: 0, code: 0, gpu: 0, leftovers: 0, logs: 0, versions: 0, ...(s as Partial<CacheSizes>) })).catch(() => { });
        void getOldVersions().then(setOld).catch(() => { });
        void getLeftovers().then(setLeft).catch(() => { });
    };
    useEffect(refresh, []);

    if (!native) {
        return <div className="sonata-perf-row sonata-perf-row-static"><span className="sonata-field-hint">Cleaning disk space needs the Discord desktop app.</span></div>;
    }

    const restart = needsRestart();
    const max = sizes ? Math.max(1, ...KINDS.map(k => sizes[k.id])) : 1;
    // Leftovers counts only the parts that are ticked (clips are never in the measured total).
    const leftChosen = left ? (parts.previews ? left.previews : 0) + (parts.updates ? left.updates : 0) + (parts.clips ? left.clips : 0) : sizes?.leftovers ?? 0;
    const chosen = sizes ? totalOf({ ...sizes, leftovers: leftChosen }, selected) : 0;
    const all = sizes ? totalOf(sizes) : 0;
    const clear = async () => {
        setBusy(true);
        const result = await cleanNow(selected, false, parts).catch(() => null);
        setBusy(false);
        if (!result) { showToast("Couldn't clean up", "failure"); return; }
        setSizes(result.after);
        setFreed(result.freed);
        void getOldVersions().then(setOld).catch(() => { });
        void getLeftovers().then(setLeft).catch(() => { });
        showToast(`Freed ${formatBytes(result.freed)}`, "success");
    };
    const auto = store.cacheAuto ?? "off";
    const hist = history();
    const lifetime = totalFreed();

    return (
        <div className="sonata-cache">
            <div className="sonata-cache-head">
                <div>
                    <span className="sonata-cache-big">{sizes ? formatBytes(all) : "…"}</span>
                    <span className="sonata-field-hint"> that Discord keeps on disk and can safely let go of</span>
                </div>
                {lifetime > 0 && <span className="sonata-perf-impact sonata-perf-big">{formatBytes(lifetime)} freed so far</span>}
            </div>

            {restart && (
                <div className="sonata-cache-restart">
                    <b>Fully restart Discord to finish updating this.</b> Right-click Discord's icon in the system tray → <b>Quit Discord</b>, then open it again. Until then, only images, scripts and graphics can be measured and cleaned.
                </div>
            )}
            {KINDS.map(k => {
                const size = sizes?.[k.id] ?? 0;
                return (
                    <div key={k.id} className={classes("sonata-cache-kind", selected[k.id] && "sonata-cache-kind-on")}>
                        <label className="sonata-cache-kind-top">
                            <input type="checkbox" checked={!!selected[k.id]} onChange={e => { const on = e.currentTarget.checked; setSelected(s => ({ ...s, [k.id]: on })); }} />
                            <span className="sonata-cache-kind-name">{k.label}</span>
                            <span className="sonata-cache-kind-size">{sizes ? formatBytes(size) : "…"}</span>
                        </label>
                        <div className="sonata-cache-bar"><div style={{ width: `${sizes ? size / max * 100 : 0}%` }} /></div>
                        <span className="sonata-field-hint">{k.detail}</span>
                        {k.id === "leftovers" && left && (
                            <div className="sonata-cache-parts-list">
                                {([
                                    ["previews", "Sonata's file previews", "Copies Sonata unpacks to show ZIPs, PDFs and other files in chat.", left.previews],
                                    ["updates", "Leftover update downloads", left.updatePending ? "Kept for now — Discord is installing an update." : "Pieces of updates that didn't finish (older than a day).", left.updates],
                                    ["clips", "Clips & recordings", left.clipCount ? `${left.clipCount} saved clip${left.clipCount === 1 ? "" : "s"} — your own videos, deleted for good if ticked.` : clipsDir() ? "No saved clips." : "Discord Clips isn't set up.", left.clips],
                                ] as [keyof Parts, string, string, number][]).map(([id, name, detail, bytes]) => (
                                    <label key={id} className={classes("sonata-cache-subpart", id === "clips" && parts.clips && "sonata-cache-subpart-warn")}>
                                        <input type="checkbox" checked={!!parts[id]} disabled={!selected.leftovers || (id === "clips" && !left.clipCount)}
                                            onChange={e => { const on = e.currentTarget.checked; setParts(p => ({ ...p, [id]: on })); }} />
                                        <span className="sonata-cache-subpart-text">
                                            <span>{name}</span>
                                            <span className="sonata-field-hint">{detail}</span>
                                        </span>
                                        <span className="sonata-cache-kind-size">{formatBytes(bytes)}</span>
                                        {id === "clips" && clipsDir() && <button type="button" className="sonata-btn" onClick={e => { e.preventDefault(); openFolder(clipsDir()); }}>Open folder</button>}
                                    </label>
                                ))}
                            </div>
                        )}
                        {k.id === "versions" && old && (
                            <>
                                <button type="button" className="sonata-link sonata-cache-link" onClick={() => setShowVersions(v => !v)}>
                                    {old.old.length ? `${showVersions ? "Hide" : "Show"} ${old.old.length} old item${old.old.length === 1 ? "" : "s"}` : "Nothing old to remove"}
                                    {old.current ? ` · running ${old.current.replace("app-", "")}` : ""}
                                </button>
                                {showVersions && old.old.map(v => <div key={v.path} className="sonata-cache-version"><span>{v.name}</span><span>{formatBytes(v.size)}</span></div>)}
                            </>
                        )}
                    </div>
                );
            })}

            <div className="sonata-field-actions">
                <button type="button" className="sonata-btn" disabled={busy} onClick={refresh}>Refresh</button>
                <button type="button" className="sonata-btn sonata-btn-light" disabled={busy || !sizes || !chosen} onClick={() => void clear()}>
                    {busy ? "Cleaning…" : `🧹 Clean up ${sizes ? formatBytes(chosen) : ""}`}
                </button>
                {freed != null && <span className="sonata-field-hint">Freed {formatBytes(freed)}.</span>}
            </div>
            <span className="sonata-field-hint">Safe any time: you stay logged in, and your settings and plugin data aren't touched. Images just load fresh the first time you see them again.</span>

            <div className="sonata-cache-auto">
                <span className="sonata-perf-title">Clean automatically</span>
                <div className="sonata-segment sonata-segment-left sonata-perf-seg">
                    {([["off", "Never"], ["weekly", "Once a week"], ["limit", "When it gets big"]] as [string, string][]).map(([id, label]) => (
                        <button key={id} type="button" className={classes("sonata-seg", auto === id && "sonata-seg-on")} onClick={() => { store.cacheAuto = id; }}>{label}</button>
                    ))}
                </div>
                {auto === "limit" && (
                    <div className="sonata-segment sonata-segment-left sonata-perf-seg">
                        {LIMITS.map(mb => <button key={mb} type="button" className={classes("sonata-seg", (Number(store.cacheLimitMB) || 1024) === mb && "sonata-seg-on")} onClick={() => { store.cacheLimitMB = mb; }}>{mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`}</button>)}
                    </div>
                )}
                <span className="sonata-field-hint">
                    {auto === "off" ? "Only when you press Clean up." : `Checked a minute after Discord starts. Cleans images, scripts, graphics, crash reports & logs, and leftovers (never your clips) — old versions only when you choose.${store.cacheLastCleaned ? ` Last cleaned ${ago(store.cacheLastCleaned)}.` : ""}`}
                </span>
            </div>

            {hist.length > 0 && (
                <div className="sonata-cache-history">
                    <button type="button" className="sonata-link sonata-cache-link" onClick={() => setShowHistory(v => !v)}>{showHistory ? "Hide" : "Show"} past clean-ups ({hist.length})</button>
                    {showHistory && hist.map((h, i) => (
                        <div key={i} className="sonata-cache-version">
                            <span>{ago(h.at)}{h.auto ? " · automatic" : ""} — {h.what}</span>
                            <span>{formatBytes(h.freed)}</span>
                        </div>
                    ))}
                </div>
            )}

            {!restart && <Memory />}
            <SonataStorage />
        </div>
    );
}
