/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The preview cache, in Discord's main process. Archives (.rar/.7z/.zip) and
// PDFs up to 1 GB:
//   - are streamed to a cache folder on disk (never held in memory);
//   - are kept while you stay in the channel, so opening one again is instant;
//   - are all deleted when you switch channels (File Previewer calls
//     clearPreviewCache), and any leftovers from a previous session are
//     cleared the first time the cache is used.
// 7-Zip (WebAssembly) runs on a background thread and reads archives straight
// from disk, so Discord stays responsive; only the file list is read up front,
// and a file inside is extracted when you click it.

import { randomUUID } from "crypto";
import { BrowserWindow, IpcMainInvokeEvent } from "electron";
import engineGlue from "file://./vendor/7zz.node.cjs";
import engineBase64 from "file://./vendor/7zz.wasm?base64";
import { mkdir, readFile, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve, sep } from "path";
import { Worker } from "worker_threads";

import { listingError, NO_PASSWORD } from "./archiveText";
import { downloadDiscordFileToDisk } from "./native";

export const MAX_CACHED_BYTES = 1024 * 1048576;
export const MAX_EXTRACT_BYTES = 50 * 1048576;
const ROOT = join(tmpdir(), "opticord-preview-cache");
const IDLE_MS = 60_000;

// Runs inside the background thread. Gets 7-Zip's code + engine via workerData.
const WORKER_SOURCE = `
const { parentPort, workerData } = require("worker_threads");
const mod = { exports: {} };
new Function("module", "exports", "require", "__filename", "__dirname", workerData.glue)(mod, mod.exports, require, "7zz.js", __dirname);
const factory = mod.exports.default || mod.exports;
let out = [], err = [];
const ready = factory({ wasmBinary: workerData.wasm, print: s => out.push(s), printErr: s => err.push(s), stdin: () => null });
const mounted = new Set();
function mount(z, sid, dir) {
    const m = "/s" + sid;
    if (!mounted.has(m)) { z.FS.mkdir(m); z.FS.mount(z.NODEFS, { root: dir }, m); mounted.add(m); }
    return m;
}
function run(z, args) {
    out = []; err = [];
    let code, threw = false;
    try { code = z.callMain(args); } catch (e) { code = 2; threw = true; }
    return { code, threw, out: out.join("\\n"), err: err.join("\\n") };
}
parentPort.on("message", async msg => {
    let result;
    try {
        const z = await ready;
        if (msg.cmd === "list") {
            const m = mount(z, msg.sid, msg.dir);
            result = run(z, ["l", "-slt", "-ba", "-bsp0", "-sccUTF-8", msg.noPassword, m + "/" + msg.file]);
        } else if (msg.cmd === "extract") {
            const m = mount(z, msg.sid, msg.dir);
            result = run(z, ["x", m + "/" + msg.file, "-o" + m + "/" + msg.out, "-spd", "-y", "-sccUTF-8", msg.noPassword, "-bso0", "-bsp0", msg.entry]);
        } else if (msg.cmd === "unmount") {
            const m = "/s" + msg.sid;
            if (mounted.has(m)) { try { z.FS.unmount(m); z.FS.rmdir(m); } catch {} mounted.delete(m); }
            result = { code: 0, threw: false, out: "", err: "" };
        }
    } catch (e) {
        result = { code: 2, threw: true, out: "", err: String(e && e.message || e) };
    }
    parentPort.postMessage({ id: msg.id, ...result });
});
`;

interface RunResult { code: number; threw: boolean; out: string; err: string; }

let worker: Worker | null = null;
let engine: Buffer | null = null;
let seq = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<number, (r: RunResult) => void>();
interface Cached { sid: string; dir: string; file: string; listing?: string; }

/** Cached files by their permanent address (Discord's rotating ?ex=&is=&hm= signature ignored). */
const cache = new Map<string, Promise<Cached>>();
const bySid = new Map<string, Cached>();
let firstUse = true;
let extractSeq = 0;

function stopWorker() {
    const w = worker;
    worker = null;
    w?.terminate().catch(() => { });
    for (const [, resolveRun] of pending) resolveRun({ code: 2, threw: true, out: "", err: "" });
    pending.clear();
}

function getWorker() {
    if (worker) return worker;
    engine ??= Buffer.from(engineBase64, "base64");
    const w = new Worker(WORKER_SOURCE, { eval: true, workerData: { glue: engineGlue, wasm: engine } });
    w.on("message", ({ id, ...r }: RunResult & { id: number; }) => {
        pending.get(id)?.(r);
        pending.delete(id);
    });
    w.on("error", () => { if (worker === w) stopWorker(); });
    w.on("exit", () => { if (worker === w) stopWorker(); });
    w.unref();
    worker = w;
    return w;
}

function call(msg: Record<string, any>): Promise<RunResult> {
    clearTimeout(idleTimer);
    const id = seq++;
    return new Promise(resolveRun => {
        pending.set(id, resolveRun);
        getWorker().postMessage({ ...msg, id, noPassword: NO_PASSWORD });
    }).then((r: any) => {
        // After an internal 7-Zip crash, start fresh next time.
        if (r.threw) stopWorker();
        return r as RunResult;
    });
}

function scheduleIdleStop() {
    clearTimeout(idleTimer);
    if (bySid.size === 0) idleTimer = setTimeout(stopWorker, IDLE_MS);
}

export function cacheKey(url: string) {
    try {
        const u = new URL(url);
        return u.hostname.replace(/^media\.discordapp\.net$/, "cdn.discordapp.com") + u.pathname;
    } catch {
        return url;
    }
}

/** Download a file into the cache once; later calls (same channel) reuse it. */
function cached(url: string, filename: string): Promise<Cached> {
    const key = cacheKey(url);
    let p = cache.get(key);
    if (!p) {
        p = (async () => {
            if (firstUse) {
                firstUse = false;
                // Anything here is from a previous Discord session.
                await rm(ROOT, { recursive: true, force: true }).catch(() => { });
            }
            const sid = randomUUID();
            const dir = join(ROOT, sid);
            const ext = (filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "").replace(/[^.a-z0-9]/g, "");
            const file = `file${ext}`;
            await mkdir(dir, { recursive: true });
            try {
                await downloadDiscordFileToDisk(url, join(dir, file), MAX_CACHED_BYTES);
            } catch (e) {
                await rm(dir, { recursive: true, force: true }).catch(() => { });
                throw e;
            }
            const entry: Cached = { sid, dir, file };
            bySid.set(sid, entry);
            return entry;
        })();
        cache.set(key, p);
        p.catch(() => { if (cache.get(key) === p) cache.delete(key); });
    }
    return p;
}

type Opened = { ok: true; id: string; listing: string; } | { ok: false; error: string; };

export async function openArchive(_: IpcMainInvokeEvent, url: string, filename: string): Promise<Opened> {
    try {
        const c = await cached(url, filename);
        if (c.listing == null) {
            const r = await call({ cmd: "list", sid: c.sid, dir: c.dir, file: c.file });
            if (r.code >= 2 || (!r.out.trim() && /error|password|can ?not/i.test(r.err))) {
                throw new Error(listingError(r.threw, r.err, r.code));
            }
            c.listing = r.out;
        }
        return { ok: true, id: c.sid, listing: c.listing };
    } catch (e: any) {
        scheduleIdleStop();
        return { ok: false, error: String(e?.message ?? e) };
    }
}

export async function extractFromArchive(_: IpcMainInvokeEvent, sid: string, entry: string): Promise<{ ok: true; data: Uint8Array; } | { ok: false; error: string; }> {
    const s = bySid.get(sid);
    if (!s) return { ok: false, error: "The preview cache was cleared (you switched channels) — open the file again." };
    // A fresh folder name every time: 7-Zip's view of the disk remembers folders
    // it has seen, so reusing a deleted one would confuse it.
    const out = `x${extractSeq++}`;
    const outDir = resolve(s.dir, out);
    try {
        const r = await call({ cmd: "extract", sid, dir: s.dir, file: s.file, entry, out });
        const target = resolve(outDir, entry);
        // Never read outside this archive's own folder.
        if (!target.startsWith(outDir + sep)) throw new Error("That file has an unsafe path.");
        const info = await stat(target).catch(() => null);
        if (!info?.isFile()) throw new Error(listingError(r.threw, r.err, r.code));
        if (info.size > MAX_EXTRACT_BYTES) throw new Error(`Too big to preview here (${Math.round(info.size / 1048576)} MB)`);
        return { ok: true, data: new Uint8Array(await readFile(target)) };
    } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) };
    } finally {
        rm(outDir, { recursive: true, force: true }).catch(() => { });
    }
}

/** Open a PDF from the cache in its own small window (Chromium's built-in viewer). */
export async function openPdfWindow(_: IpcMainInvokeEvent, url: string, title: string): Promise<{ ok: true; data: null; } | { ok: false; error: string; }> {
    try {
        const c = await cached(url, title || "file.pdf");
        const win = new BrowserWindow({
            width: 920,
            height: 1040,
            title: title || "PDF preview",
            autoHideMenuBar: true,
            backgroundColor: "#1e1f22",
            webPreferences: { plugins: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
        });
        // A preview window — it can't open new windows or navigate elsewhere.
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        win.webContents.on("will-navigate", e => e.preventDefault());
        await win.loadFile(join(c.dir, c.file));
        return { ok: true, data: null };
    } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) };
    }
}

/** Delete everything in the preview cache (called whenever you switch channels). */
export async function clearPreviewCache(_?: IpcMainInvokeEvent): Promise<void> {
    if (cache.size === 0) return;
    const entries = [...bySid.values()];
    cache.clear();
    bySid.clear();
    // Close 7-Zip's view of the files first, then delete them.
    if (worker) await Promise.all(entries.map(c => call({ cmd: "unmount", sid: c.sid }).catch(() => { })));
    await Promise.all(entries.map(c => rm(c.dir, { recursive: true, force: true }).catch(() => { })));
    scheduleIdleStop();
}
