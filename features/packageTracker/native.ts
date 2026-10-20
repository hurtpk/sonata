/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Package Tracker's reader: opens a tracking page in a hidden window (the way a
// browser would), waits for it to fill in, and reads a few fixed facts off it.
// The page's text never leaves this file — only those facts do, so addresses
// and names on the page are never shown, sent or saved. Only the carriers' and
// DoorDash's / Uber Eats' own sites can be opened, and nothing is got around:
// a bot check just means "couldn't read it".

import { BrowserWindow, IpcMainInvokeEvent, session } from "electron";

import { hostAllowed } from "./detect";
import { FoodInfo, isBlocked, ParcelInfo, readFood, readParcel } from "./parse";

export type ReadResult =
    | { ok: true; food?: FoodInfo; parcel?: ParcelInfo; }
    | { ok: false; blocked?: boolean; error: string; };

const PARTITION = "sonata-track"; // In memory only: nothing from these sites is kept after Discord closes.
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// One page at a time, so a list of parcels never opens a pile of windows.
let queue: Promise<unknown> = Promise.resolve();

function allowed(url: string) {
    try {
        const u = new URL(url);
        return u.protocol === "https:" && hostAllowed(u.hostname.replace(/^www\./, ""));
    } catch { return false; }
}

async function read(url: string, kind: "food" | "parcel", number?: string): Promise<ReadResult> {
    if (!allowed(url)) return { ok: false, error: "That isn't a tracking page Package Tracker knows." };
    const win = new BrowserWindow({
        show: false,
        width: 1200,
        height: 900,
        webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, images: false, spellcheck: false },
    });
    try {
        win.webContents.setAudioMuted(true);
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        // It may follow the site's own redirects (drd.sh → doordash.com), but never leave these sites.
        const stay = (e: Electron.Event, to: string) => { if (!allowed(to)) e.preventDefault(); };
        win.webContents.on("will-navigate", stay);
        win.webContents.on("will-redirect", stay);

        const loaded = win.loadURL(url).catch(() => null);
        await Promise.race([loaded, sleep(20_000)]);

        // These pages fill themselves in after loading: read until the facts show up or it stops changing.
        let last = "", same = 0, text = "", title = "";
        for (let i = 0; i < 24; i++) {
            await sleep(i < 2 ? 1500 : 1000);
            if (win.isDestroyed()) break;
            const page = await win.webContents.executeJavaScript("({ title: document.title, text: (document.body && document.body.innerText || \"\").slice(0, 60000) })", true).catch(() => null);
            if (!page) continue;
            ({ text, title } = page);
            if (isBlocked(text, title)) return { ok: false, blocked: true, error: "The page asked to check for bots" };
            const facts = kind === "food" ? readFood(text, title) : readParcel(text, Date.now(), number);
            const found = kind === "food" ? !!(facts as FoodInfo).stage : !!(facts as ParcelInfo).status;
            same = text === last ? same + 1 : 0;
            last = text;
            if ((found && same >= 1) || (i > 8 && same >= 3)) break;
        }
        if (!text.trim()) return { ok: false, error: "The page didn't load" };
        if (kind === "food") {
            const food = readFood(text, title);
            return food.stage ? { ok: true, food } : { ok: false, error: "Couldn't find the order's progress on the page (the link may have expired)" };
        }
        const parcel = readParcel(text, Date.now(), number);
        if (parcel.status) return { ok: true, parcel };
        return { ok: false, error: parcel.unknown ? "The carrier has no tracking for this number yet" : "Couldn't find the parcel's status on the page" };
    } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) };
    } finally {
        if (!win.isDestroyed()) win.destroy();
    }
}

export function trackRead(_: IpcMainInvokeEvent, url: string, kind: "food" | "parcel", number?: string): Promise<ReadResult> {
    const next = queue.then(() => read(url, kind, number));
    queue = next.catch(() => { });
    return next;
}

/** Forget everything those sites stored (called when Package Tracker stops). */
export async function trackForget(_?: IpcMainInvokeEvent) {
    await session.fromPartition(PARTITION).clearStorageData().catch(() => { });
}
