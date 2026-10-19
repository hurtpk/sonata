/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// QR codes in chat, found by themselves: images in messages are quietly
// checked (once each, one at a time, only when they're on screen, at a small
// size) and any QR code gets a chip under the message showing where it leads.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useEffect, useRef, useState } from "@webpack/common";

import { getBytes } from "../_shared/media";
import { openQrScan } from "./Panel";
import { checkLink, readQrImage } from "./qr";

const cl = classNameFactory("vc-qr-");
const MAX_IMAGES = 4;
const MAX_BYTES = 8 * 1048576;

/** What each image held: its text, or null for none. Kept for this session. */
const found = new Map<string, Promise<string | null>>();
let queue = Promise.resolve();

/** A smaller copy from Discord's media server — plenty for a QR code, and far less to download. */
function small(url: string) {
    try {
        const u = new URL(url);
        if (/(^|\.)discordapp\.(net|com)$/.test(u.hostname)) { u.searchParams.set("width", "900"); u.searchParams.set("format", "png"); }
        return u.toString();
    } catch { return url; }
}

/** What QR code a picture holds (checked once per picture, one at a time). */
export function scan(url: string): Promise<string | null> {
    const hit = found.get(url);
    if (hit) return hit;
    // One at a time, so a channel full of pictures never stutters.
    const p = new Promise<string | null>(resolve => {
        queue = queue.then(async () => {
            try { resolve(await readQrImage(await getBytes(small(url), MAX_BYTES))); } catch { resolve(null); }
        });
    });
    if (found.size > 400) found.delete(found.keys().next().value!);
    found.set(url, p);
    return p;
}

export function imagesOf(message: any): string[] {
    const out: string[] = [];
    for (const a of message?.attachments ?? []) {
        const type = String(a?.content_type ?? "");
        if ((type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(a?.filename ?? "")) && (a?.size ?? 0) <= MAX_BYTES && !/gif/i.test(type)) out.push(a.proxy_url || a.url);
    }
    for (const e of message?.embeds ?? []) {
        const img = e?.image?.proxyURL ?? e?.image?.url ?? (e?.type === "image" ? e?.thumbnail?.proxyURL ?? e?.thumbnail?.url : null);
        if (img) out.push(img);
    }
    return [...new Set(out)].slice(0, MAX_IMAGES);
}

function Chip({ url }: { url: string; }) {
    const [text, setText] = useState<string | null | undefined>(() => undefined);
    useEffect(() => { let alive = true; void scan(url).then(t => alive && setText(t)); return () => { alive = false; }; }, [url]);
    if (!text) return null;
    const link = checkLink(text);
    const warn = !!link?.warnings.length;
    return (
        <button type="button" className={classes(cl("chip"), warn && cl("chip-warn"))} title={link ? `${link.url}${warn ? `\n⚠ ${link.warnings.join("\n⚠ ")}` : ""}` : text} onClick={() => openQrScan(url)}>
            <span aria-hidden>{warn ? "⚠️" : "🔳"}</span>
            <b>QR code</b>
            <span>{link ? `→ ${link.host}` : `“${text.slice(0, 60)}${text.length > 60 ? "…" : ""}”`}</span>
            {warn && <i>check before opening</i>}
        </button>
    );
}

/** Under a message: a chip for each QR code in its images (scanned once it's on screen). */
export function AutoQr({ message }: { message: any; }) {
    const urls = imagesOf(message);
    const box = useRef<HTMLSpanElement>(null);
    const [seen, setSeen] = useState(false);
    useEffect(() => {
        if (!urls.length || seen || !box.current) return;
        const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "200px" });
        io.observe(box.current);
        return () => io.disconnect();
    }, [urls.length, seen]);
    if (!urls.length) return null;
    return <span ref={box} className={cl("auto")}>{seen && urls.map(u => <Chip key={u} url={u} />)}</span>;
}
