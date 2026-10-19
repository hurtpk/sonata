/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Runs in Discord's main process: measures and clears what Discord keeps on
// disk, and reads how much memory it's using.
//
// Never touched: Local Storage and IndexedDB (your login, settings and plugin
// data), and the Discord version you're running — only versions older than
// it are removed, so an update that's downloading is left alone too.

import { app, contentTracing, IpcMainInvokeEvent, shell, webContents } from "electron";
import { readdir, readFile, rm, stat, unlink } from "fs/promises";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";

import { clearPreviewCache } from "../features/filePreviewer/previewCache";

export type CacheKind = "http" | "code" | "gpu" | "leftovers" | "logs" | "versions";
/** The parts of "Leftovers". Clips are your own videos, so they're only ever removed when picked. */
export type LeftoverPart = "previews" | "updates" | "clips";
export interface ClearOptions { parts?: Partial<Record<LeftoverPart, boolean>>; clipsDir?: string; }
export type CacheSizes = Record<CacheKind, number>;
export type CacheKinds = Partial<Record<CacheKind, boolean>>;

const CODE_DIRS = ["Code Cache"];
const GPU_DIRS = ["GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache", "ShaderCache"];
const LOG_DIRS = ["logs", join("Crashpad", "reports"), join("Crashpad", "attachments")];

async function dirSize(path: string, depth = 0): Promise<number> {
    if (depth > 10) return 0;
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); } catch { return 0; }
    let total = 0;
    for (const entry of entries) {
        const full = join(path, entry.name);
        try {
            if (entry.isDirectory()) total += await dirSize(full, depth + 1);
            else if (entry.isFile()) total += (await stat(full)).size;
        } catch { }
    }
    return total;
}

const userData = () => app.getPath("userData");
const sumDirs = async (names: string[]) => (await Promise.all(names.map(n => dirSize(join(userData(), n))))).reduce((a, b) => a + b, 0);

// ─── Old Discord versions ───

const versionOf = (name: string) => (name.match(/(\d+(?:\.\d+)+)/)?.[1] ?? "0").split(".").map(Number);
function compareVersions(a: string, b: string) {
    const x = versionOf(a), y = versionOf(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] ?? 0) - (y[i] ?? 0);
        if (d) return d;
    }
    return 0;
}

/** The install folder (…\Discord) and the version running now (app-1.0.9260), if this is an installed Discord. */
function install() {
    const appDir = dirname(process.execPath);
    const current = basename(appDir);
    if (!/^app-\d+(\.\d+)+$/.test(current)) return null;
    return { root: dirname(appDir), current };
}

export interface OldVersion { name: string; path: string; size: number; }

/** Version folders older than the running one, and update packages for them. */
async function oldVersions(): Promise<OldVersion[]> {
    const info = install();
    if (!info) return [];
    const out: OldVersion[] = [];
    let names: string[] = [];
    try { names = await readdir(info.root); } catch { }
    for (const n of names) {
        if (!/^app-\d+(\.\d+)+$/.test(n) || compareVersions(n, info.current) >= 0) continue;
        const path = join(info.root, n);
        out.push({ name: n, path, size: await dirSize(path) });
    }
    const pkgDir = join(info.root, "packages");
    let pkgs: string[] = [];
    try { pkgs = await readdir(pkgDir); } catch { }
    for (const p of pkgs) {
        // Keep the package for the running version and anything newer — Discord needs those to update.
        if (!p.endsWith(".nupkg") || compareVersions(p, info.current) >= 0) continue;
        const path = join(pkgDir, p);
        try { out.push({ name: p, path, size: (await stat(path)).size }); } catch { }
    }
    return out;
}

// ─── Leftovers ───

/** Where Sonata's File Previewer unpacks files to show them. */
const PREVIEW_DIR = join(tmpdir(), "opticord-preview-cache");
const DAY = 24 * 60 * 60 * 1000;
const VIDEO = /\.(mp4|mkv|mov|webm)$/i;

/** True while Discord is installing an update (a newer version folder exists than the one running). */
async function updatePending() {
    const info = install();
    if (!info) return true;
    try { return (await readdir(info.root)).some(n => /^app-\d+(\.\d+)+$/.test(n) && compareVersions(n, info.current) > 0); } catch { return true; }
}

/** Update downloads left behind by interrupted updates — older than a day, and only while no update is installing. */
async function updateLeftovers(): Promise<string[]> {
    const info = install();
    if (!info || await updatePending()) return [];
    const out: string[] = [];
    for (const d of [join(info.root, "download"), join(info.root, "packages", "SquirrelTemp")]) {
        let names: string[] = [];
        try { names = await readdir(d); } catch { continue; }
        for (const n of names) {
            const p = join(d, n);
            try { if (Date.now() - (await stat(p)).mtimeMs > DAY) out.push(p); } catch { }
        }
    }
    return out;
}

async function sizeOfPaths(paths: string[]) {
    let n = 0;
    for (const p of paths) {
        try { const s = await stat(p); n += s.isDirectory() ? await dirSize(p) : s.size; } catch { }
    }
    return n;
}

async function clipFiles(clipsDir?: string): Promise<string[]> {
    if (!clipsDir) return [];
    const out: string[] = [];
    const walk = async (d: string, depth: number) => {
        let entries;
        try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const p = join(d, e.name);
            if (e.isDirectory() && depth < 2) await walk(p, depth + 1);
            else if (e.isFile() && VIDEO.test(e.name)) out.push(p);
        }
    };
    await walk(clipsDir, 0);
    return out;
}

export async function getLeftovers(_: IpcMainInvokeEvent, clipsDir?: string) {
    const [previews, updates, clips] = await Promise.all([
        dirSize(PREVIEW_DIR),
        updateLeftovers().then(sizeOfPaths),
        clipFiles(clipsDir).then(async f => ({ bytes: await sizeOfPaths(f), count: f.length })),
    ]);
    return { previews, updates, clips: clips.bytes, clipCount: clips.count, updatePending: await updatePending() };
}

export function openFolder(_: IpcMainInvokeEvent, path: string) {
    return shell.openPath(path);
}

// ─── Measuring & clearing ───

export async function getCacheSizes(event: IpcMainInvokeEvent): Promise<CacheSizes> {
    const [http, code, gpu, leftovers, logs, versions] = await Promise.all([
        event.sender.session.getCacheSize().catch(() => 0),
        sumDirs(CODE_DIRS),
        sumDirs(GPU_DIRS),
        // Clips aren't counted here: they're your videos, shown separately.
        Promise.all([dirSize(PREVIEW_DIR), updateLeftovers().then(sizeOfPaths)]).then(([a, b]) => a + b),
        sumDirs(LOG_DIRS),
        oldVersions().then(v => v.reduce((a, b) => a + b.size, 0)),
    ]);
    return { http, code, gpu, leftovers, logs, versions };
}

export async function getOldVersions(_: IpcMainInvokeEvent) {
    const info = install();
    return { current: info?.current ?? null, old: await oldVersions() };
}

/** Deletes the files in a folder (and below). Files Discord has open right now are skipped. */
async function emptyDir(path: string, depth = 0) {
    if (depth > 10) return;
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
        const full = join(path, entry.name);
        if (entry.isDirectory()) await emptyDir(full, depth + 1);
        else await unlink(full).catch(() => { });
    }
}

export async function clearCaches(event: IpcMainInvokeEvent, kinds: CacheKinds, opts: ClearOptions = {}): Promise<CacheSizes> {
    const { session } = event.sender;
    if (kinds.http) await session.clearCache().catch(() => { });
    if (kinds.code) await session.clearCodeCaches({}).catch(() => { });
    if (kinds.gpu) await session.clearStorageData({ storages: ["shadercache"] }).catch(() => { });
    if (kinds.leftovers) {
        const parts = opts.parts ?? { previews: true, updates: true };
        if (parts.previews) {
            await clearPreviewCache().catch(() => { });
            await emptyDir(PREVIEW_DIR);
        }
        if (parts.updates) for (const p of await updateLeftovers()) await rm(p, { recursive: true, force: true }).catch(() => { });
        if (parts.clips && opts.clipsDir) for (const f of await clipFiles(opts.clipsDir)) await unlink(f).catch(() => { });
    }
    if (kinds.logs) for (const d of LOG_DIRS) await emptyDir(join(userData(), d));
    if (kinds.versions) {
        for (const v of await oldVersions()) {
            // Checked again right before deleting: never the running version or a newer one.
            const info = install();
            if (!info || compareVersions(v.name, info.current) >= 0) continue;
            await rm(v.path, { recursive: true, force: true, maxRetries: 2 }).catch(() => { });
        }
    }
    return getCacheSizes(event);
}

// ─── Memory ───

// ─── Deep memory check ───
// Chromium's own memory report ("memory-infra"): for each of Discord's
// processes, how much each part of the browser engine holds — drawn layers,
// decoded images, page data, JavaScript, fonts, graphics buffers. It records a
// trace for a couple of seconds, reads the numbers, and deletes the file.

export interface DeepPart { name: string; mb: number; }
export interface DeepProcess {
    kind: string; pid: number; total: number; parts: DeepPart[];
    /** Everything over 1 MB at any level ("blink_gc/main/heap/NodeArena"…), for a closer look. */
    all: DeepPart[];
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function deepMemory(_: IpcMainInvokeEvent): Promise<DeepProcess[]> {
    await contentTracing.startRecording({
        included_categories: ["disabled-by-default-memory-infra"],
        excluded_categories: ["*"],
        memory_dump_config: { triggers: [{ mode: "detailed", periodic_interval_ms: 1000 }] },
    } as any);
    // A few dumps, so the busy window process has time to send a complete one.
    await sleep(5200);
    const path = await contentTracing.stopRecording();
    let trace: any;
    try {
        trace = JSON.parse(await readFile(path, "utf8"));
    } finally {
        await unlink(path).catch(() => { });
    }
    const events: any[] = Array.isArray(trace) ? trace : trace.traceEvents ?? [];
    // The most complete dump for each process (the one with the most parts in it).
    const latest = new Map<number, any>();
    for (const e of events) {
        const a = e.ph === "v" ? e.args?.dumps?.allocators : null;
        if (!a) continue;
        const prev = latest.get(e.pid);
        if (!prev || Object.keys(a).length >= Object.keys(prev).length) latest.set(e.pid, a);
    }
    const kindOf = new Map<number, string>();
    for (const m of app.getAppMetrics()) kindOf.set(m.pid, m.type === "Browser" ? "Main" : m.type === "Tab" ? "Window" : m.type === "GPU" ? "Graphics" : m.type === "Utility" ? "Background" : m.type);
    const size = (a: any) => parseInt(a?.attrs?.size?.value ?? "0", 16) || 0;
    const out: DeepProcess[] = [];
    for (const [pid, allocators] of latest) {
        // Top-level parts only ("v8", "partition_alloc"…), not their sub-parts.
        const parts: DeepPart[] = Object.entries<any>(allocators)
            .filter(([name]) => !name.includes("/") && name !== "global" && name !== "tracing")
            .map(([name, a]) => ({ name, mb: Math.round(size(a) / 1048576) }))
            .filter(p => p.mb > 0)
            .sort((a, b) => b.mb - a.mb);
        const all: DeepPart[] = Object.entries<any>(allocators)
            .map(([name, a]) => ({ name, mb: Math.round(size(a) / 1048576 * 10) / 10 }))
            .filter(p => p.mb >= 1)
            .sort((a, b) => a.name.localeCompare(b.name));
        out.push({ kind: kindOf.get(pid) ?? `Process ${pid}`, pid, total: parts.reduce((n, p) => n + p.mb, 0), parts, all });
    }
    return out.sort((a, b) => b.total - a.total);
}

export interface MemoryInfo {
    total: number;
    parts: { kind: string; mb: number; }[];
    /** The same, counting memory shared with other programs too (what "working set" means). */
    sharedTotal: number;
    /** Whether `total` is private memory (Windows) or working set (elsewhere). */
    private: boolean;
    /** Every window process on its own — Discord itself, DevTools, pop-outs — since "Window" adds them all up. */
    windows: { pid: number; mb: number; label: string; isThis: boolean; }[];
}

/** What a window process is showing, in words. */
function windowLabel(pid: number, senderPid: number) {
    const wc = webContents.getAllWebContents().filter(w => { try { return w.getOSProcessId() === pid; } catch { return false; } });
    if (!wc.length) return pid === senderPid ? "Discord" : "Window";
    const labels = wc.map(w => {
        const type = w.getType();
        const url = (() => { try { return w.getURL(); } catch { return ""; } })();
        if (type === "remote" || url.startsWith("devtools://")) return "DevTools";
        if (/discord\.com\/(channels|app|login)|discord\.com\/?$/.test(url)) return "Discord";
        if (url.startsWith("file:")) return "Preview window";
        if (/overlay/i.test(url)) return "Game overlay";
        const title = (() => { try { return w.getTitle(); } catch { return ""; } })();
        return title || (url ? new URL(url).host : "Window");
    });
    return [...new Set(labels)].join(" + ");
}

/**
 * How much memory Discord's processes use right now, in MB, grouped by what they do.
 * On Windows this is private memory — what only Discord uses, like Task Manager's
 * "Memory" column. The working set also counts memory shared with Windows and
 * other programs (fonts, system libraries), so it reads much higher.
 */
export function getMemory(event: IpcMainInvokeEvent): MemoryInfo {
    const groups = new Map<string, number>();
    const windows: MemoryInfo["windows"] = [];
    let senderPid = -1;
    try { senderPid = event.sender.getOSProcessId(); } catch { }
    let shared = 0, isPrivate = false;
    for (const m of app.getAppMetrics()) {
        const mem = m.memory as { workingSetSize?: number; privateBytes?: number; } | undefined;
        const ws = mem?.workingSetSize ?? 0;
        const own = mem?.privateBytes;
        if (own != null) isPrivate = true;
        shared += ws / 1024;
        const kind = m.type === "Browser" ? "Main" : m.type === "Tab" ? "Window" : m.type === "GPU" ? "Graphics" : m.type === "Utility" ? "Background" : m.type;
        groups.set(kind, (groups.get(kind) ?? 0) + (own ?? ws) / 1024);
        if (m.type === "Tab") windows.push({ pid: m.pid, mb: Math.round((own ?? ws) / 1024), label: windowLabel(m.pid, senderPid), isThis: m.pid === senderPid });
    }
    const parts = [...groups].map(([kind, mb]) => ({ kind, mb: Math.round(mb) })).sort((a, b) => b.mb - a.mb);
    return { total: parts.reduce((a, b) => a + b.mb, 0), parts, sharedTotal: Math.round(shared), private: isPrivate, windows: windows.sort((a, b) => b.mb - a.mb) };
}
