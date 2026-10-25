/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Logged messages as a picture that looks like Discord's chat: avatars,
// names, times, what was deleted or edited (earlier versions crossed out),
// replies and attachments. Drawn on a canvas, saved as a PNG.

import { UserStore } from "@webpack/common";

import type { Entry } from "./data";

export const MAX_PICTURE = 60;

const W = 900, PAD = 28, AV = 40, GAP = 16, TEXT_X = PAD + AV + 16, TEXT_W = W - TEXT_X - PAD;
const FONT = "\"gg sans\", \"Noto Sans\", \"Segoe UI\", system-ui, sans-serif";
const C = { bg: "#313338", name: "#f2f3f5", text: "#dbdee1", muted: "#949ba4", old: "#80848e", link: "#00a8fc", deleted: "#f23f43", edited: "#f0b232", ghost: "#a47ff0", line: "#3f4147" };

/** Discord's code for mentions and emoji, as people read it. */
function readable(s: string) {
    return String(s ?? "")
        .replace(/<a?:(\w+):\d+>/g, ":$1:")
        .replace(/<@!?(\d+)>/g, (_, id) => `@${UserStore.getUser(id)?.username ?? "someone"}`)
        .replace(/<#(\d+)>/g, "#channel")
        .replace(/<@&(\d+)>/g, "@role")
        .replace(/<t:(\d+)(?::\w)?>/g, (_, t) => new Date(Number(t) * 1000).toLocaleString());
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
    const out: string[] = [];
    for (const para of text.split("\n")) {
        let line = "";
        for (const word of para.split(/(\s+)/)) {
            const tryLine = line + word;
            if (ctx.measureText(tryLine).width <= width || !line) {
                // A single word wider than the line is broken up.
                if (ctx.measureText(tryLine).width > width && !line) {
                    let chunk = "";
                    for (const ch of word) { if (ctx.measureText(chunk + ch).width > width) { out.push(chunk); chunk = ""; } chunk += ch; }
                    line = chunk;
                } else line = tryLine;
            } else { out.push(line.trimEnd()); line = word.trimStart(); }
        }
        out.push(line.trimEnd());
    }
    return out;
}

const loadImage = (url: string) => new Promise<HTMLImageElement | null>(res => {
    if (!url) return res(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    const t = setTimeout(() => res(null), 4000);
    img.onload = () => { clearTimeout(t); res(img); };
    img.onerror = () => { clearTimeout(t); res(null); };
    img.src = url;
});

const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

interface Block { e: Entry; lines: { text: string; font: string; color: string; strike?: boolean; }[]; height: number; }

/** The picture, as PNG bytes. `title` goes at the top (where it's from). */
export async function conversationPicture(entries: Entry[], title: string): Promise<Blob> {
    const list = [...entries].sort((a, b) => a.sent - b.sent).slice(0, MAX_PICTURE);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const body = `400 15px ${FONT}`, small = `400 13px ${FONT}`, oldFont = `400 14px ${FONT}`;

    // First, lay everything out to know how tall it is.
    const blocks: Block[] = list.map(e => {
        const lines: Block["lines"] = [];
        if (e.reply) { ctx.font = small; for (const l of wrap(ctx, `↳ replying to ${e.reply.name}: ${readable(e.reply.content).slice(0, 140)}`, TEXT_W)) lines.push({ text: l, font: small, color: C.muted }); }
        if (e.edited && e.versions.length > 1) {
            ctx.font = oldFont;
            for (const v of e.versions.slice(0, -1)) for (const l of wrap(ctx, readable(v.content) || "(empty)", TEXT_W)) lines.push({ text: l, font: oldFont, color: C.old, strike: true });
        }
        ctx.font = body;
        const now = e.edited ? e.versions.at(-1)?.content ?? e.m.content : e.m.content;
        for (const l of wrap(ctx, readable(now ?? "") || (e.media.length || e.files.length ? "" : "(no text)"), TEXT_W)) if (l || lines.length === 0) lines.push({ text: l, font: body, color: C.text });
        ctx.font = small;
        for (const f of [...e.media, ...e.files]) lines.push({ text: `📎 ${f.name}`, font: small, color: C.link });
        const height = Math.max(AV, 22 + lines.length * 21);
        return { e, lines, height };
    });
    const head = 78, foot = 40;
    const H = head + blocks.reduce((n, b) => n + b.height + GAP, 0) + foot;
    const scale = 2;
    canvas.width = W * scale;
    canvas.height = Math.min(16000, H) * scale;
    ctx.scale(scale, scale);

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = C.name; ctx.font = `700 18px ${FONT}`;
    ctx.fillText(title, PAD, 38);
    ctx.fillStyle = C.muted; ctx.font = small;
    ctx.fillText(`${list.length} logged message${list.length === 1 ? "" : "s"}${entries.length > list.length ? ` (the first ${list.length} of ${entries.length})` : ""} · saved ${when(Date.now())}`, PAD, 60);
    ctx.fillStyle = C.line; ctx.fillRect(PAD, head - 8, W - PAD * 2, 1);

    const avatars = new Map<string, HTMLImageElement | null>();
    await Promise.all([...new Set(list.map(e => e.author.avatar))].map(async u => avatars.set(u, await loadImage(u))));

    let y = head + 6;
    for (const b of blocks) {
        const { e } = b;
        const tag = e.ghost ? ["GHOST PING", C.ghost] : e.deleted ? ["DELETED", C.deleted] : e.edited ? ["EDITED", C.edited] : null;
        if (tag) { ctx.fillStyle = tag[1]; ctx.globalAlpha = 0.07; ctx.fillRect(PAD - 10, y - 4, W - PAD * 2 + 20, b.height + 8); ctx.globalAlpha = 1; ctx.fillRect(PAD - 10, y - 4, 3, b.height + 8); }
        // Avatar (a coloured circle with their first letter if the picture won't load).
        const av = avatars.get(e.author.avatar);
        ctx.save();
        ctx.beginPath(); ctx.arc(PAD + AV / 2, y + AV / 2, AV / 2, 0, Math.PI * 2); ctx.clip();
        if (av) ctx.drawImage(av, PAD, y, AV, AV);
        else { ctx.fillStyle = "#5865f2"; ctx.fillRect(PAD, y, AV, AV); ctx.fillStyle = "#fff"; ctx.font = `700 18px ${FONT}`; ctx.textAlign = "center"; ctx.fillText((e.author.name || "?")[0].toUpperCase(), PAD + AV / 2, y + 27); ctx.textAlign = "left"; }
        ctx.restore();
        // Name, time, tag.
        ctx.font = `600 15px ${FONT}`; ctx.fillStyle = C.name;
        ctx.fillText(e.author.name, TEXT_X, y + 15);
        let x = TEXT_X + ctx.measureText(e.author.name).width + 10;
        ctx.font = `400 12px ${FONT}`; ctx.fillStyle = C.muted;
        const t = when(e.sent);
        ctx.fillText(t, x, y + 15);
        x += ctx.measureText(t).width + 10;
        if (tag) {
            ctx.font = `700 10.5px ${FONT}`;
            const label = tag[0] + (e.deleted && e.gone ? ` ${new Date(e.gone).toLocaleTimeString(undefined, { timeStyle: "short" })}` : e.edited ? ` ×${e.versions.length - 1}` : "");
            const w = ctx.measureText(label).width + 12;
            ctx.fillStyle = tag[1]; ctx.beginPath(); ctx.roundRect(x, y + 3, w, 16, 4); ctx.fill();
            ctx.fillStyle = "#fff"; ctx.fillText(label, x + 6, y + 15);
        }
        // The text, earlier versions first (crossed out).
        let ly = y + 37;
        for (const l of b.lines) {
            ctx.font = l.font; ctx.fillStyle = l.color;
            ctx.fillText(l.text, TEXT_X, ly);
            if (l.strike && l.text) { const w = ctx.measureText(l.text).width; ctx.fillRect(TEXT_X, ly - 5, w, 1.2); }
            ly += 21;
        }
        y += b.height + GAP;
    }
    ctx.fillStyle = C.muted; ctx.font = `400 11.5px ${FONT}`;
    ctx.fillText("Saved with Sonata · Message Logs", PAD, H - 16);

    const out = await new Promise<Blob | null>(res => {
        try { canvas.toBlob(res, "image/png"); } catch { res(null); }
    });
    if (out) return out;
    throw new Error("Couldn't make the picture");
}
