/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Cleaning Discord's disk space (part of Sonata's Performance section):
// caches, leftovers (previews, old update downloads, clips if you pick them),
// crash reports and logs, old Discord versions, and
// what Sonata's own features keep — plus automatic cleaning and a history.

import { DataStore } from "@api/index";
import { PlainSettings, Settings } from "@api/Settings";
import { PluginNative } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { showToast } from "@webpack/common";

import { clearMessagesIDB, countMessagesIDB } from "../features/messageLoggerEnhanced/db";
import { QOL_NAME } from "../featureSettings";
import type { CacheKind, CacheKinds, CacheSizes, DeepProcess, LeftoverPart, MemoryInfo, OldVersion } from "./cacheNative";

export type { CacheKind, CacheKinds, CacheSizes, DeepProcess, LeftoverPart, MemoryInfo, OldVersion };
export type Parts = Partial<Record<LeftoverPart, boolean>>;

const ClipsStore = findStoreLazy("ClipsStore");
/** The folder Discord saves your Clips to (empty when Clips were never set up). */
export function clipsDir(): string {
    try { return ClipsStore.getSettings?.()?.storageLocation ?? ""; } catch { return ""; }
}

const Native = VencordNative?.pluginHelpers?.Sonata as PluginNative<typeof import("./cacheNative")> | undefined;
export const hasNative = () => !!Native?.getCacheSizes;
/**
 * Discord's background process only loads new code when Discord fully quits.
 * Until then it can be an older version that lacks the newer helpers.
 */
export const needsRestart = () => !!Native?.getCacheSizes && (typeof Native.getOldVersions !== "function" || typeof Native.getMemory !== "function" || typeof Native.getLeftovers !== "function");

export const KINDS: { id: CacheKind; label: string; detail: string; auto: boolean; }[] = [
    { id: "versions", label: "Old Discord versions", detail: "Copies of Discord kept after each update (and their update files). The version you're running — and any update that's downloading — is never touched.", auto: false },
    { id: "http", label: "Images & media", detail: "Pictures, videos, avatars and other downloads kept so they load faster next time.", auto: true },
    { id: "code", label: "Script cache", detail: "Pre-compiled code that helps Discord start. Rebuilt on the next launch.", auto: true },
    { id: "gpu", label: "Graphics cache", detail: "Compiled graphics shaders. Rebuilt when needed.", auto: true },
    { id: "leftovers", label: "Leftovers", detail: "Files left lying around: Sonata's file previews, update downloads Discord left behind, and — only if you tick it — your saved Clips.", auto: true },
    { id: "logs", label: "Crash reports & logs", detail: "Discord's log files and saved crash reports. Files Discord is writing right now are skipped.", auto: true },
];

const store = () => (PlainSettings.plugins?.[QOL_NAME] ?? {}) as Record<string, any>;
const live = () => Settings.plugins[QOL_NAME] as Record<string, any>;

export const totalOf = (s: CacheSizes, kinds?: CacheKinds) => KINDS.reduce((n, k) => n + (!kinds || kinds[k.id] ? s[k.id] ?? 0 : 0), 0);

export function formatBytes(bytes: number) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const v = bytes / 1024 ** i;
    return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

const missing = () => Promise.reject(new Error("Restart Discord to finish updating Sonata"));
export const getSizes = () => typeof Native?.getCacheSizes === "function" ? Native.getCacheSizes() : missing();
export const getOldVersions = () => typeof Native?.getOldVersions === "function" ? Native.getOldVersions() : missing();
export const getMemory = () => typeof Native?.getMemory === "function" ? Native.getMemory() : missing();
export const deepMemory = () => typeof Native?.deepMemory === "function" ? Native.deepMemory() : missing();
export const getLeftovers = () => typeof Native?.getLeftovers === "function" ? Native.getLeftovers(clipsDir()) : missing();
export const openFolder = (path: string) => void Native?.openFolder?.(path);

// ─── History ───

export interface HistoryEntry { at: number; freed: number; what: string; auto?: boolean; }

export function history(): HistoryEntry[] {
    try { return JSON.parse(store().cacheHistory || "[]"); } catch { return []; }
}

export const totalFreed = () => Number(store().cacheFreedTotal) || 0;

function record(freed: number, kinds: CacheKinds, auto = false) {
    const s = live();
    s.cacheLastCleaned = Date.now();
    s.cacheFreedTotal = totalFreed() + freed;
    const what = KINDS.filter(k => kinds[k.id]).map(k => k.label.toLowerCase()).join(", ");
    s.cacheHistory = JSON.stringify([{ at: Date.now(), freed, what, auto }, ...history()].slice(0, 12));
}

const complete = (s: Partial<CacheSizes>): CacheSizes => ({ http: 0, code: 0, gpu: 0, leftovers: 0, logs: 0, versions: 0, ...s });

/** `parts` picks what Leftovers removes; clips only when asked. Automatic cleaning never includes clips. */
export async function cleanNow(kinds: CacheKinds, auto = false, parts: Parts = { previews: true, updates: true }) {
    if (!Native) return null;
    const clips = !auto && !!parts.clips && !!kinds.leftovers;
    const clipBytes = clips ? (await getLeftovers().catch(() => null))?.clips ?? 0 : 0;
    const before = complete(await Native.getCacheSizes());
    const after = complete(await Native.clearCaches(kinds, { parts: { ...parts, clips }, clipsDir: clipsDir() }));
    const clipsAfter = clips ? (await getLeftovers().catch(() => null))?.clips ?? 0 : 0;
    before.leftovers += clipBytes;
    after.leftovers += clipsAfter;
    const freed = Math.max(0, totalOf(before, kinds) - totalOf(after, kinds));
    record(freed, kinds, auto);
    return { before, after, freed };
}

// ─── Automatic cleaning ───

const WEEK = 7 * 24 * 60 * 60 * 1000;
const AUTO_KINDS: CacheKinds = Object.fromEntries(KINDS.filter(k => k.auto).map(k => [k.id, true]));

let timer: ReturnType<typeof setTimeout> | undefined;

async function autoCheck() {
    const s = store();
    const mode = s.cacheAuto ?? "off";
    if (!Native || mode === "off") return;
    if (mode === "weekly" && Date.now() - (Number(s.cacheLastCleaned) || 0) < WEEK) return;
    if (mode === "limit") {
        const sizes = await Native.getCacheSizes();
        if (totalOf(sizes, AUTO_KINDS) < (Number(s.cacheLimitMB) || 1024) * 1024 * 1024) return;
    }
    const result = await cleanNow(AUTO_KINDS, true);
    if (result?.freed) showToast(`Sonata cleaned Discord's caches — freed ${formatBytes(result.freed)}`, "success");
}

/** Decided a minute after start, so it never slows Discord down while it opens. */
export function startCacheAuto() {
    // Settings from when Cache Cleaner was its own feature.
    const s = live(), old = store();
    if (old.cacheCleaner_autoClean && old.cacheAuto === undefined) s.cacheAuto = old.cacheCleaner_autoClean;
    if (old.cacheCleaner_limitMB && old.cacheLimitMB === undefined) s.cacheLimitMB = old.cacheCleaner_limitMB;
    if (old.cacheCleaner_lastCleaned && !old.cacheLastCleaned) s.cacheLastCleaned = old.cacheCleaner_lastCleaned;
    timer = setTimeout(() => void autoCheck().catch(() => { }), 60_000);
}

export const stopCacheAuto = () => clearTimeout(timer);

// ─── Sonata's own storage ───

export interface StoredThing { key: string; label: string; bytes: number; count?: number; clear(): Promise<void>; }

/** Sonata's saved data, by the name people know it by. */
const LABELS: [RegExp, string][] = [
    [/^Sonata_gif_recent$/, "GIF Maker — recent GIFs"],
    [/^Sonata_gif_presets$/, "GIF Maker — presets"],
    [/^Sonata_sticky_messages$/, "Sticky messages"],
    [/^Sonata_split_view$/, "Split View"],
    [/^Sonata_currency_rates$/, "Currency Converter — exchange rates"],
    [/^Sonata_known_users/, "Sonata Badge — known Sonata users"],
    [/^Sonata_streaks/, "Streaks"],
    [/^Sonata_gifts_opened$/, "Gift Wrap — opened gifts"],
    [/^Sonata_greeter_log$/, "Channel Greeter — sent log"],
    [/^Sonata_SoundStudio$/, "Sound Studio — your sounds"],
    [/^Sonata_autoVolume/, "Auto Volume — saved volumes"],
    [/^Sonata_doctor_backup$/, "Sonata Insights — settings backup"],
    [/^Sonata_StealProfile_backup$/, "Steal Profile — your profile backup"],
    [/^Opticord_birthdays$/, "Birthday Reminders"],
    [/^Opticord_calcHistory$/, "Calculator — history"],
    [/^Opticord_calendarReminders$/, "Calendar — reminders"],
    [/^Opticord_inviteManager$/, "Invite Manager"],
    [/^ScheduledMessages_queue$/, "Scheduled messages (clearing cancels them!)"],
    [/^SpotifyLyricsCache/, "Spotify Controls — lyrics cache"],
    [/^Sonata_/, ""],
];

function sizeOf(v: unknown): number {
    if (v == null) return 0;
    if (v instanceof Blob) return v.size;
    if (Array.isArray(v)) return v.reduce((n: number, x) => n + sizeOf(x), 0);
    if (typeof v === "object") {
        let n = 0;
        for (const [k, x] of Object.entries(v as object)) n += k.length * 2 + (x instanceof Blob ? x.size : sizeOf(x));
        return n;
    }
    return String(v).length * 2;
}

export async function storedThings(): Promise<StoredThing[]> {
    const out: StoredThing[] = [];
    let keys: IDBValidKey[] = [];
    try { keys = await DataStore.keys(); } catch { }
    for (const key of keys) {
        if (typeof key !== "string") continue;
        const match = LABELS.find(([re]) => re.test(key));
        if (!match) continue;
        const value = await DataStore.get(key).catch(() => null);
        out.push({
            key,
            label: match[1] || key.replace(/^Sonata_/, "").replace(/_/g, " "),
            bytes: sizeOf(value),
            count: Array.isArray(value) ? value.length : undefined,
            clear: () => DataStore.del(key),
        });
    }
    // Message Logger Enhanced keeps its own database of logged messages.
    try {
        const count = await countMessagesIDB();
        if (count) out.push({ key: "mle", label: "Message Logger Enhanced — logged messages", bytes: 0, count, clear: () => clearMessagesIDB(false) });
    } catch { }
    return out.sort((a, b) => b.bytes - a.bytes);
}
