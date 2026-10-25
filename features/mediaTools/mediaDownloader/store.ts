/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Media Downloader's settings, and the list of what you've downloaded (kept
// on this computer). Downloads in progress live in the native side; this
// keeps an eye on them and adds each to the list when it's done.

import * as DataStore from "@api/DataStore";
import { OptionType } from "@utils/types";
import { showToast, useEffect, useState } from "@webpack/common";

import { defineFeatureSettings } from "../../../featureSettings";

export const settings = defineFeatureSettings("mediaDownloader", {
    folder: { type: OptionType.STRING, description: "Where downloads go (empty: Downloads\\Sonata)", default: "", hidden: true },
    mode: { type: OptionType.STRING, description: "Video or audio by default", default: "video", hidden: true },
    quality: { type: OptionType.NUMBER, description: "Highest video height by default (0 = best)", default: 1080, hidden: true },
    audio: { type: OptionType.STRING, description: "Audio as MP3, or the site's original", default: "mp3", hidden: true },
    showMenu: { type: OptionType.BOOLEAN, description: "“Download video or audio” when you right-click a message with a link", default: true },
});

export const native = () => VencordNative.pluginHelpers.Sonata as any;

export interface Info { title: string; uploader: string | null; duration: number | null; thumbnail: string | null; site: string | null; url: string; heights: number[]; hasVideo: boolean; isLive: boolean; }
export interface Job { status: "queued" | "starting" | "downloading" | "processing" | "done" | "error" | "cancelled"; percent: number; speed: string; eta: string; file?: string; size?: number; error?: string; }
export interface Item { id: string; url: string; title: string; site: string | null; thumbnail: string | null; mode: "video" | "audio"; at: number; job: Job; /** The playlist it came from. */ group?: string; }
export interface Entry { key: string; title: string; url: string; duration: number | null; thumbnail: string | null; uploader: string | null; }
export interface Playlist { title: string; uploader: string | null; site: string | null; count: number; entries: Entry[]; }

/** How many downloads run at once — the rest of a playlist waits its turn. */
const AT_ONCE = 2;
/** What each waiting download is waiting with. */
const waiting = new Map<string, { quality: number; audio: "mp3" | "original"; }>();

const KEY = "Sonata_downloads";
const MAX = 100;
let items: Item[] = [];
let loaded: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const save = () => DataStore.set(KEY, items.filter(i => i.job.status === "done" || i.job.status === "error").slice(0, MAX));

export const loadItems = () => loaded ??= DataStore.get<Item[]>(KEY).then(v => { items = [...items.filter(i => isActive(i)), ...(v ?? [])]; emit(); }).catch(() => { });

export const isActive = (i: Item) => i.job.status === "queued" || i.job.status === "starting" || i.job.status === "downloading" || i.job.status === "processing";

export function useItems() {
    const [, bump] = useState(0);
    useEffect(() => { void loadItems(); const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    return items;
}

/** Ask the native side how each download is going, until none are left running. */
function watch() {
    if (timer) return;
    timer = setInterval(async () => {
        const now: Record<string, Job> = await native().dlProgress().catch(() => ({}));
        let finished = false;
        items = items.map(i => {
            const j = now[i.id];
            if (!j) return i;
            if (j.status === "done" && i.job.status !== "done") { finished = true; showToast(`Downloaded “${i.title}”`, "success"); }
            if (j.status === "error" && i.job.status !== "error") { finished = true; showToast(`Couldn't download “${i.title}”`, "failure"); }
            return { ...i, job: j };
        });
        emit();
        if (finished) void save();
        await fillSlots();
        if (!items.some(isActive) && timer) { clearInterval(timer); timer = null; }
    }, 600);
}

/** Starts waiting downloads while there are free slots. */
async function fillSlots() {
    let running = items.filter(i => i.job.status === "starting" || i.job.status === "downloading" || i.job.status === "processing").length;
    // Oldest first, so a playlist downloads in order.
    for (const i of [...items].reverse()) {
        if (running >= AT_ONCE) break;
        if (i.job.status !== "queued") continue;
        const w = waiting.get(i.id);
        waiting.delete(i.id);
        i.job = { ...i.job, status: "starting" };
        running++;
        const r = await native().dlStart(i.id, i.url, { mode: i.mode, quality: w?.quality ?? 0, audio: w?.audio ?? "mp3", folder: settings.store.folder || undefined }).catch(() => null);
        if (!r?.ok) { i.job = { ...i.job, status: "error", error: r?.error ?? "Couldn't start" }; running--; }
        items = [...items];
        emit();
    }
}

/** Puts a playlist's picks in line; they download a couple at a time. */
export async function queueMany(list: Playlist, picks: Entry[], mode: "video" | "audio", quality: number, audio: "mp3" | "original") {
    await loadItems();
    const t = Date.now();
    const added: Item[] = picks.map((e, n) => {
        const id = `${(t + n).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        waiting.set(id, { quality, audio });
        return { id, url: e.url, title: e.title, site: list.site, thumbnail: e.thumbnail, mode, at: t + n, group: list.title, job: { status: "queued" as const, percent: 0, speed: "", eta: "" } };
    });
    // Newest at the top, like single downloads.
    items = [...added.reverse(), ...items];
    emit();
    await fillSlots();
    watch();
    showToast(`${picks.length} added — ${Math.min(AT_ONCE, picks.length)} at a time`, "success");
}

export async function startDownload(info: Info, mode: "video" | "audio", quality: number, audio: "mp3" | "original") {
    await loadItems();
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const r = await native().dlStart(id, info.url, { mode, quality, audio, folder: settings.store.folder || undefined });
    if (!r?.ok) { showToast(r?.error ?? "Couldn't start the download", "failure"); return false; }
    items = [{ id, url: info.url, title: info.title, site: info.site, thumbnail: info.thumbnail, mode, at: Date.now(), job: { status: "starting" as const, percent: 0, speed: "", eta: "" } }, ...items].slice(0, MAX + 10);
    emit();
    watch();
    return true;
}

export async function cancelDownload(id: string) {
    if (waiting.delete(id) || items.find(i => i.id === id)?.job.status === "queued") {
        items = items.map(i => i.id === id ? { ...i, job: { ...i.job, status: "cancelled" } } : i);
        emit();
        return;
    }
    await native().dlCancel(id);
    items = items.map(i => i.id === id ? { ...i, job: { ...i.job, status: "cancelled" } } : i);
    emit();
}

/** Off the list only — the file stays where it is. */
export function removeItem(id: string) {
    items = items.filter(i => i.id !== id);
    emit();
    void save();
}

export function clearFinished() {
    items = items.filter(isActive);
    emit();
    void save();
}

/** Cancels everything still waiting its turn (downloads already going carry on). */
export function cancelWaiting() {
    waiting.clear();
    items = items.map(i => i.job.status === "queued" ? { ...i, job: { ...i.job, status: "cancelled" } } : i);
    emit();
}
