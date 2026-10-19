/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Link Cleaner's network side: follows a short link's redirects to see where
// it really ends up, without opening the page. Only the redirect answers are
// read (no page content is loaded or run).

import { IpcMainInvokeEvent } from "electron";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

export interface Expanded { ok: boolean; final?: string; hops?: string[]; error?: string; }

export async function expandLink(_: IpcMainInvokeEvent, url: string): Promise<Expanded> {
    let current: URL;
    try { current = new URL(url); } catch { return { ok: false, error: "Not a link" }; }
    if (!/^https?:$/.test(current.protocol)) return { ok: false, error: "Not a web link" };
    const hops: string[] = [current.href];
    for (let i = 0; i < 10; i++) {
        let res: Response;
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 6000);
            // HEAD first; some shorteners only answer GET.
            res = await fetch(current.href, { method: "HEAD", redirect: "manual", headers: { "user-agent": UA }, signal: ctrl.signal }).catch(() => fetch(current.href, { method: "GET", redirect: "manual", headers: { "user-agent": UA }, signal: ctrl.signal }));
            if (res.status === 405 || res.status === 403) res = await fetch(current.href, { method: "GET", redirect: "manual", headers: { "user-agent": UA }, signal: ctrl.signal });
            clearTimeout(t);
        } catch (e) {
            return hops.length > 1 ? { ok: true, final: current.href, hops } : { ok: false, error: e instanceof Error && e.name === "AbortError" ? "It took too long to answer" : "Couldn't reach it" };
        }
        const loc = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && loc) {
            try { current = new URL(loc, current); } catch { break; }
            hops.push(current.href);
            continue;
        }
        // A page that redirects itself with <meta http-equiv="refresh"> (t.co and others do this).
        if (res.status === 200 && res.body && (res.headers.get("content-type") ?? "").includes("html")) {
            const text = (await res.text().catch(() => "")).slice(0, 20000);
            const m = text.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']?\d+;\s*url=([^"'>\s]+)/i);
            if (m) { try { current = new URL(m[1].replace(/&amp;/g, "&"), current); hops.push(current.href); continue; } catch { } }
        }
        break;
    }
    return { ok: true, final: current.href, hops };
}
