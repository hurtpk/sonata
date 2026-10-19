/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Where does this short link go? Hover a bit.ly / t.co / tinyurl link (and
// the like) and a small bubble shows the real destination, tracking stripped.

import { cleanUrl } from "./clean";

/** Link shorteners — the links worth looking behind. */
export const SHORTENERS = new Set([
    "bit.ly", "bitly.com", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "v.gd", "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at", "rb.gy", "t.ly",
    "tiny.cc", "lnkd.in", "bit.do", "s.id", "amzn.to", "a.co", "amzn.eu", "spoti.fi", "apple.co", "fb.me", "db.tt", "trib.al", "dlvr.it", "ift.tt", "wp.me",
    "shorturl.com", "tr.im", "x.co", "qr.net", "1url.com", "hyperurl.co", "urlz.fr", "shor.by", "linkin.bio", "msft.it", "aka.ms", "g.co", "youtu.be", "tiny.one",
    "shrtco.de", "go.link", "rotf.lol", "surl.li", "l.ead.me", "clck.ru", "vk.cc", "u.to", "ln.run", "dub.sh", "short.gy",
]);

export const isShortener = (url: string) => { try { return SHORTENERS.has(new URL(url).hostname.replace(/^www\./, "").toLowerCase()); } catch { return false; } };

interface Result { final?: string; hops?: number; error?: string; }
const cache = new Map<string, Promise<Result>>();

export function whereItGoes(url: string): Promise<Result> {
    let p = cache.get(url);
    if (!p) {
        p = VencordNative.pluginHelpers.Sonata.expandLink(url)
            .then((r: any) => r?.ok ? { final: cleanUrl(r.final), hops: Math.max(0, (r.hops?.length ?? 1) - 1) } : { error: r?.error ?? "Couldn't check it" })
            .catch(() => ({ error: "Couldn't check it" }));
        if (cache.size > 300) cache.delete(cache.keys().next().value!);
        cache.set(url, p);
    }
    return p;
}

/* ── The hover bubble ─────────────────────────────────────────────────── */

let tip: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let hovered: HTMLAnchorElement | null = null;
let checkAll = () => false;

function show(a: HTMLAnchorElement, html: string) {
    if (hovered !== a) return;
    tip ??= Object.assign(document.createElement("div"), { className: "vc-lc-tip" });
    if (!tip.isConnected) document.body.appendChild(tip);
    tip.innerHTML = html;
    const r = a.getBoundingClientRect();
    const w = Math.min(460, window.innerWidth - 24);
    tip.style.maxWidth = `${w}px`;
    tip.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - w - 12))}px`;
    const below = r.bottom + 8;
    tip.style.top = `${below + 60 > window.innerHeight ? r.top - 8 - (tip.offsetHeight || 52) : below}px`;
    tip.classList.add("vc-lc-tip-on");
}

function hide() {
    hovered = null;
    if (timer) clearTimeout(timer);
    tip?.classList.remove("vc-lc-tip-on");
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function describe(url: string, r: Result): string {
    if (r.error) return `<b>Couldn't check this link</b><span>${escapeHtml(r.error)}</span>`;
    const final = r.final!;
    let host = "", rest = final;
    try { const u = new URL(final); host = u.hostname.replace(/^www\./, ""); rest = (u.pathname + u.search + u.hash).replace(/^\/$/, ""); } catch { }
    const same = (() => { try { return new URL(url).href === new URL(final).href; } catch { return false; } })();
    const insecure = final.startsWith("http:");
    return `<span class="vc-lc-tip-label">${same ? "This link goes to" : `Goes to${r.hops && r.hops > 1 ? ` (after ${r.hops} hops)` : ""}`}</span>`
        + `<span class="vc-lc-tip-url"><b>${escapeHtml(host)}</b>${escapeHtml(rest.length > 140 ? rest.slice(0, 140) + "…" : rest)}</span>`
        + (insecure ? "<span class=\"vc-lc-tip-warn\">⚠ Not a secure (https) page</span>" : "");
}

function onOver(e: MouseEvent) {
    const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || a === hovered) return;
    if (!a.closest('[id^="chat-messages-"], [class*="messageContent"], [class*="embed"]')) return;
    const url = a.href;
    if (!/^https?:/.test(url) || (!isShortener(url) && !checkAll())) return;
    hide();
    hovered = a;
    // A short wait, so just moving the mouse past a link doesn't check it.
    timer = setTimeout(() => {
        show(a, '<span class="vc-lc-tip-label">Checking where it goes…</span>');
        whereItGoes(url).then(r => show(a, describe(url, r)));
    }, 450);
}

function onOut(e: MouseEvent) {
    const a = (e.target as HTMLElement | null)?.closest?.("a[href]");
    if (a && a === hovered && !(e.relatedTarget instanceof Node && a.contains(e.relatedTarget))) hide();
}

export function startPreview(isCheckAll: () => boolean) {
    checkAll = isCheckAll;
    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    window.addEventListener("scroll", hide, true);
}

export function stopPreview() {
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("mouseout", onOut, true);
    window.removeEventListener("scroll", hide, true);
    hide();
    tip?.remove();
    tip = null;
}
