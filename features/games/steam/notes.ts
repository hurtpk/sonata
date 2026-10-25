/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Turns a Steam announcement (Steam's BBCode, sometimes HTML) into simple
// blocks to draw: headings, paragraphs, bullets, pictures, short clips and
// YouTube trailers — in the order the developer put them. Steam writes picture
// addresses as {STEAM_CLAN_IMAGE}/… or {STEAM_CLAN_LOC_IMAGE}/… (one with a
// version per language); both live in the same place.

export type NoteBlock =
    | { kind: "h" | "p" | "li"; text: string; }
    | { kind: "img"; src: string; href?: string; }
    | { kind: "clip"; mp4?: string; webm?: string; poster?: string; }
    | { kind: "yt"; id: string; };

const CLAN = "https://clan.akamai.steamstatic.com/images";
const MARK = "\u0001";

/** A usable https address, with Steam's {STEAM_CLAN_IMAGE} (or _LOC_) filled in. */
function url(raw: string | undefined) {
    if (!raw) return undefined;
    let u = raw.trim().replace(/^["']|["']$/g, "").replace(/\{STEAM_[A-Z_]*IMAGE\}/g, CLAN).replace(/&amp;/g, "&");
    if (u.startsWith("//")) u = "https:" + u;
    return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : undefined;
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}\\s*=\\s*\\\\?"([^"\\\\]*)\\\\?"`, "i"))?.[1] ?? tag.match(new RegExp(`${name}\\s*=\\s*([^\\s\\]"]+)`, "i"))?.[1];

export function parseNotes(text: string): NoteBlock[] {
    const media: NoteBlock[] = [];
    const put = (b: NoteBlock) => `\n${MARK}${media.push(b) - 1}\n`;
    const img = (src: string | undefined, href?: string) => {
        const s = url(src);
        return s ? put({ kind: "img", src: s, href: url(href) }) : "\n";
    };

    // [img]address[/img], [img src="address" style="…"][/img], or [img src="…"] with no closing tag.
    const imgTag = (attrs: string | undefined, inner: string, closed: boolean, href?: string) => {
        const src = attr(attrs ?? "", "src");
        if (src) return img(src, href) + (closed ? "" : inner);
        return closed ? img(inner, href) : `${img(inner.trim().split(/\s/)[0], href)}${inner.trim().split(/\s/).slice(1).join(" ")}`;
    };

    const clean = text
        // Pictures inside links: keep the picture, remember where it pointed.
        .replace(/\[url=([^\]]*)\]\s*\[img(\s[^\]]*)?\]([^[\]]*)(\[\/img\])?\s*\[\/url\]/gi, (_, href, attrs, inner, close) => imgTag(attrs, inner, !!close, href.replace(/^["']|["']$/g, "")))
        .replace(/\[img(\s[^\]]*)?\]([^[\]]*)(\[\/img\])?/gi, (_, attrs, inner, close) => imgTag(attrs, inner, !!close))
        .replace(/<img\b[^>]*>/gi, tag => img(tag.match(/src\s*=\s*"([^"]+)"/i)?.[1]))
        .replace(/\[previewyoutube=?"?([\w-]{6,20})[^\]]*\](\s*\[\/previewyoutube\])?/gi, (_, id) => put({ kind: "yt", id }))
        .replace(/\[video\b([^\]]*)\][\s\S]*?\[\/video\]/gi, (_, attrs: string) => {
            const mp4 = url(attr(attrs, "mp4")), webm = url(attr(attrs, "webm")), poster = url(attr(attrs, "poster"));
            return mp4 || webm ? put({ kind: "clip", mp4, webm, poster }) : poster ? put({ kind: "img", src: poster }) : "\n";
        })
        // A bare clan image address on its own.
        .replace(/\{STEAM_[A-Z_]*IMAGE\}\/\S+\.(?:png|jpe?g|gif|webp)/gi, m => img(m))
        .replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "")
        .replace(/\{STEAM_[A-Z_]*IMAGE\}\S*/g, "")
        .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, "$1")
        .replace(/\[\*\]/g, "\n[*]")
        // Headings, lists and paragraphs always start and end their own lines.
        .replace(/\[(\/?(?:h[1-6]|list|olist|p))(=[^\]]*)?\]/gi, "\n[$1]\n")
        .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

    const out: NoteBlock[] = [];
    let inHeading = false;
    for (const raw of clean.split("\n")) {
        const t = raw.trim();
        if (t.startsWith(MARK)) { const b = media[Number(t.slice(1))]; if (b) out.push(b); continue; }
        if (/^\[h[1-6]\]$/i.test(t)) { inHeading = true; continue; }
        if (/^\[\/h[1-6]\]$/i.test(t)) { inHeading = false; continue; }
        const bullet = t.startsWith("[*]");
        const line = t.replace(/(?<!\\)\[\/?[a-z0-9*]+(=[^\]]*)?\]/gi, "").replace(/\\([[\]])/g, "$1").trim();
        if (!line) continue;
        out.push({ kind: inHeading ? "h" : bullet ? "li" : "p", text: line });
    }
    return out;
}
